import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { lookup as dnsLookup } from 'dns';
import readline from 'readline/promises';
import WebSocket from 'ws';
import { Agent, fetch as undiciFetch } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';
import { listProjects } from './projects.js';

/**
 * Puente con el conector de Nodus en la nube (`noduscm connect`).
 *
 * Abre un WebSocket saliente hacia el servidor (no se abre ningún puerto en
 * este equipo) y atiende sus peticiones:
 *   - http:  peticiones a los sitios locales de tus proyectos (solo a esos
 *            orígenes), para que las tools de diseño funcionen con ellos.
 *   - tools / tool: los mismos comandos del MCP local (noduscm mcp).
 */

const MAX_BODY = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Credenciales del equipo
// ---------------------------------------------------------------------------

export function deviceFile() {
  if (process.env.NODUSCM_DEVICE_FILE) return process.env.NODUSCM_DEVICE_FILE;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'noduscm', 'device.json');
}

export async function readDevice() {
  try {
    return await fs.readJson(deviceFile());
  } catch {
    return null;
  }
}

export async function saveDevice(data) {
  const file = deviceFile();
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, data, { spaces: 2, mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function pairDevice(server, code, name) {
  const res = await fetch(`${server}/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.message || `Pairing failed (HTTP ${res.status})`);
  return { server, device_id: body.device_id, name: body.name, token: body.token };
}

// ---------------------------------------------------------------------------
// HTTP hacia los sitios locales
// ---------------------------------------------------------------------------

/** *.localhost siempre a loopback (no depende de /etc/hosts ni del resolver). */
function localLookup(hostname, options, callback) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (options && options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }]);
    return callback(null, '127.0.0.1', 4);
  }
  // Solo llegan IPs loopback literales (allowedOrigins); cualquier otra cosa se rechaza.
  return dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.every((a) => isLoopbackHost(a.address))) return callback(new Error(`${hostname} is not a loopback address`));
    return callback(null, address, family);
  });
}

// Certificados locales (mkcert) pueden no estar en el almacén de Node: solo se
// usa contra los orígenes de tus proyectos.
const localAgent = new Agent({ connect: { rejectUnauthorized: false, lookup: localLookup } });

/** Solo loopback: localhost, *.localhost o 127.x / ::1 (nada de la red local). */
export function isLoopbackHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(h) || h === '::1';
}

async function allowedOrigins(roots) {
  const origins = new Set();
  for (const p of await listProjects(roots)) {
    try {
      const u = new URL(p.url);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackHost(u.hostname)) origins.add(u.origin);
    } catch {
      // URL inválida
    }
  }
  return origins;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'accept-encoding']);

export async function handleHttp(msg, roots) {
  const url = new URL(String(msg.url));
  const origins = await allowedOrigins(roots);
  if (!origins.has(url.origin)) {
    throw new Error(`${url.origin} is not one of this machine's NodusCommand projects.`);
  }
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(String(msg.method))) {
    throw new Error('Unsupported method');
  }
  const headers = {};
  for (const [k, v] of Object.entries(msg.headers || {})) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = String(v);
  }
  let res;
  try {
    res = await undiciFetch(url, {
    method: msg.method,
    headers,
    body: msg.body ? Buffer.from(msg.body, 'base64') : undefined,
    redirect: 'manual',
    dispatcher: localAgent,
    signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    const cause = error?.cause;
    throw new Error(`${url.origin}: ${cause?.code || cause?.message || error.message}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BODY) throw new Error('Response too large');
  const outHeaders = {};
  res.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(key)) outHeaders[key] = value;
  });
  return { status: res.status, headers: outHeaders, body: buf.toString('base64') };
}

// ---------------------------------------------------------------------------
// Confirmación en la terminal antes de publicar en la rama de producción
// ---------------------------------------------------------------------------

const CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;

/** ¿Esta llamada sube cambios a la rama conectada en producción? */
export function needsPublishConfirm(name, args = {}) {
  if (name !== 'git_publish') return false;
  return (args.mode ?? 'direct') === 'direct' || args.merge_pr === true;
}

let promptQueue = Promise.resolve();

/** Pregunta s/N en la terminal (una a la vez). Sin TTY o sin respuesta en 10 min: no. */
export function askInTerminal(question, { input = process.stdin, output = process.stdout, timeoutMs = CONFIRM_TIMEOUT_MS } = {}) {
  const run = async () => {
    if (!input.isTTY) return false;
    const rl = readline.createInterface({ input, output });
    try {
      output.write('\x07'); // campana: llama la atención si la terminal está en segundo plano
      const answer = await rl.question(question, { signal: AbortSignal.timeout(timeoutMs) });
      return /^(s|si|sí|y|yes)$/i.test(answer.trim());
    } catch {
      output.write('\n(no answer, rejected)\n');
      return false;
    } finally {
      rl.close();
    }
  };
  const result = promptQueue.then(run, run);
  promptQueue = result.catch(() => undefined);
  return result;
}

async function confirmPublish(client, args, log) {
  let details = '';
  try {
    const status = await client.callTool({ name: 'git_status', arguments: { project: args.project, ...(args.repo ? { repo: args.repo } : {}) } });
    const s = status.structuredContent || {};
    const files = (s.changes || []).map((c) => `    ${c.status.padEnd(2)} ${c.file}`);
    const shown = args.paths?.length ? args.paths.map((p) => `    ${p}`) : files;
    details = [
      `  Repo:    ${s.github || s.remote || s.path || '?'} (local branch ${s.branch || '?'})`,
      `  Changes: ${shown.length ? '' : 'none (only commits already made)'}`,
      ...shown.slice(0, 15),
      ...(shown.length > 15 ? [`    … and ${shown.length - 15} more`] : []),
    ].join('\n');
  } catch {
    // sin detalles
  }
  const how = (args.mode ?? 'direct') === 'direct' ? 'direct merge + push' : 'PR + merge';
  log(
    [
      '',
      '━━━ Claude wants to publish to production ━━━',
      `  Project: ${args.project}`,
      `  Target:  ${args.target_branch} (${how})`,
      `  Message: ${args.message}`,
      details,
      '',
    ]
      .filter((l) => l !== '')
      .join('\n')
  );
  return askInTerminal('Allow? [y/N] ');
}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

/**
 * Mantiene la conexión con el servidor (reconecta sola). Resuelve solo si el
 * servidor rechaza el token (equipo quitado en /connect).
 */
export async function runBridge({ device, roots = [], allowExec = false, confirmPublish: mustConfirm = true, version = '0.0.0', log = console.log }) {
  const mcp = buildServer({ roots, allowExec });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: 'noduscm-bridge', version });
  await client.connect(clientTransport);

  const wsUrl = `${device.server.replace(/^http/, 'ws')}/devices/ws`;
  let attempt = 0;

  return new Promise((resolve) => {
    const open = () => {
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${device.token}` }, maxPayload: 32 * 1024 * 1024 });
      let alive = true;

      ws.on('open', () => {
        attempt = 0;
        log(`Connected to ${device.server} as "${device.name}". Waiting for requests… (Ctrl+C to stop)`);
        ws.send(JSON.stringify({ type: 'hello', name: device.name, version, allow_exec: allowExec, confirm_publish: mustConfirm, platform: process.platform }));
      });

      ws.on('ping', () => {
        alive = true;
      });

      ws.on('message', async (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg.id) return;
        const reply = (payload) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: msg.id, ...payload }));
        };
        try {
          let result;
          if (msg.type === 'http') {
            result = await handleHttp(msg, roots);
          } else if (msg.type === 'tools') {
            const { tools } = await client.listTools();
            result = { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) };
          } else if (msg.type === 'tool') {
            log(`→ ${msg.name}`);
            if (mustConfirm && needsPublishConfirm(msg.name, msg.args)) {
              const allowed = await confirmPublish(client, msg.args || {}, log);
              if (!allowed) {
                log('✗ Rejected.');
                throw new Error(
                  process.stdin.isTTY
                    ? `The user rejected the publish in the "${device.name}" terminal (or did not answer in 10 min). Nothing was committed or pushed.`
                    : `Publishing to ${msg.args?.target_branch} needs confirmation in the "noduscm connect" terminal, but it is not running in an interactive terminal. Run it in a terminal, or start it with --no-confirm-publish.`
                );
              }
              log('✓ Allowed.');
            }
            result = await client.callTool({ name: String(msg.name), arguments: msg.args || {} }, undefined, { timeout: 35 * 60 * 1000 });
          } else {
            throw new Error(`Unknown request type: ${msg.type}`);
          }
          reply({ ok: true, result });
        } catch (error) {
          reply({ ok: false, error: String(error?.message || error).slice(0, 2000) });
        }
      });

      const retry = (reason) => {
        attempt++;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        log(`Disconnected (${reason}). Reconnecting in ${Math.round(delay / 1000)} s…`);
        setTimeout(open, delay);
      };

      ws.on('unexpected-response', (req, res) => {
        ws.__done = true;
        res.resume();
        req.destroy();
        if (res.statusCode === 401) {
          log('The server rejected this device (removed in /connect?). Run "noduscm connect --reset" to pair it again.');
          resolve({ unauthorized: true });
          return;
        }
        retry(`HTTP ${res.statusCode}`);
      });

      ws.on('close', (code) => {
        if (code === 4001) {
          log('This device was removed in /connect. Run "noduscm connect --reset" to pair it again.');
          resolve({ unauthorized: true });
          return;
        }
        if (code === 4000) {
          log('⚠ Another "noduscm connect" took over this device. If it was not you, remove the device in /connect and run "noduscm connect --reset".');
          resolve({ replaced: true });
          return;
        }
        if (ws.__done) return;
        retry(`code ${code}`);
      });

      ws.on('error', (err) => {
        // 'close' llega después y reintenta.
        if (ws.readyState === WebSocket.CONNECTING) log(`Connection error: ${err.message}`);
      });

      // Si el servidor deja de hacer ping (conexión zombi), se reconecta.
      const watchdog = setInterval(() => {
        if (!alive && ws.readyState === WebSocket.OPEN) ws.terminate();
        alive = false;
      }, 70000);
      ws.on('close', () => clearInterval(watchdog));
    };

    open();
  });
}
