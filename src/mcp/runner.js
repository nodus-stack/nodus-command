import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { ToolError, firstLine } from './projects.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/noduscm.js');
const MAX_OUTPUT = 12000;
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export function cleanOutput(text) {
  const clean = String(text || '')
    .replace(ANSI, '')
    .replace(/\r(?!\n)/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, i, all) => line !== '' || (all[i - 1] ?? '') !== '')
    .join('\n')
    .trim();
  return clean.length > MAX_OUTPUT ? `… (output truncated)\n${clean.slice(-MAX_OUTPUT)}` : clean;
}

/**
 * Ejecuta un comando de noduscm en la carpeta del proyecto, sin terminal:
 * NODUSCM_NON_INTERACTIVE=1 hace que nada pregunte ni pida sudo.
 */
export async function runCli(root, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const result = await execa(process.execPath, [BIN, ...args], {
    cwd: root,
    env: { ...process.env, NODUSCM_NON_INTERACTIVE: '1', FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    stdin: 'ignore',
    all: true,
    reject: false,
    timeout: timeoutMs,
  });
  const output = cleanOutput(result.all);
  const failed = result.exitCode !== 0 || result.timedOut || /❌ Error:/.test(output);
  return {
    ok: !failed,
    exit_code: result.exitCode ?? null,
    timed_out: Boolean(result.timedOut),
    output,
  };
}

export function apacheContainer(config) {
  return `${config.slug}-apache`;
}

async function containerRunning(engine, container) {
  const { stdout, exitCode } = await execa(engine, ['inspect', '-f', '{{.State.Running}}', container], { reject: false, timeout: 15000 });
  return exitCode === 0 && stdout.trim() === 'true';
}

export async function requireRunning(config) {
  const container = apacheContainer(config);
  if (!(await containerRunning(config.engine, container))) {
    throw new ToolError(`The ${container} container is not running. Start the project with project_up first.`);
  }
  return container;
}

/** Usuario para ejecutar dentro del contenedor: webuser (imagen de noduscm) o www-data. */
async function containerUser(engine, container) {
  const { exitCode } = await execa(engine, ['exec', container, 'id', '-u', 'webuser'], { reject: false, timeout: 15000 });
  return exitCode === 0 ? 'webuser' : 'www-data';
}

const WP_CLI_URL = 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar';

/** wp-cli.phar en la caché de noduscm (para imágenes sin `wp`). */
async function hostWpCliPhar() {
  const dir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'noduscm');
  const file = path.join(dir, 'wp-cli.phar');
  if (await fs.pathExists(file)) return file;
  const res = await fetch(WP_CLI_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new ToolError(`Could not download wp-cli (${res.status}).`);
  await fs.ensureDir(dir);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Ejecuta WP-CLI dentro del contenedor de Apache. args = argv sin "wp". */
export async function runWpCli(config, args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const engine = config.engine;
  const container = await requireRunning(config);
  const user = await containerUser(engine, container);

  const hasWp = (await execa(engine, ['exec', container, 'sh', '-c', 'command -v wp'], { reject: false, timeout: 15000 })).exitCode === 0;
  let base = ['wp'];
  if (!hasWp) {
    const phar = await hostWpCliPhar();
    await execa(engine, ['cp', phar, `${container}:/tmp/wp-cli.phar`], { timeout: 60000 });
    base = ['php', '/tmp/wp-cli.phar'];
  }

  const result = await execa(engine, ['exec', '-u', user, '-w', '/var/www/html', container, ...base, ...args], {
    reject: false,
    all: true,
    timeout: timeoutMs,
  });
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    exit_code: result.exitCode ?? null,
    timed_out: Boolean(result.timedOut),
    user,
    output: cleanOutput(result.all),
  };
}

/** Comando de shell libre dentro del contenedor (solo con --allow-exec). */
export async function runInContainer(config, command, { root = false, timeoutMs = 5 * 60 * 1000 } = {}) {
  const engine = config.engine;
  const container = await requireRunning(config);
  const user = root ? 'root' : await containerUser(engine, container);
  const result = await execa(engine, ['exec', '-u', user, '-w', '/var/www/html', container, 'bash', '-lc', command], {
    reject: false,
    all: true,
    timeout: timeoutMs,
  });
  return { ok: result.exitCode === 0 && !result.timedOut, exit_code: result.exitCode ?? null, user, output: cleanOutput(result.all) };
}

export async function containerLogs(config, service, lines) {
  const container = `${config.slug}-${service}`;
  const result = await execa(config.engine, ['logs', '--tail', String(lines), container], { reject: false, all: true, timeout: 30000 });
  if (result.exitCode !== 0) throw new ToolError(`Could not read logs of ${container}: ${firstLine(result.all)}`);
  return cleanOutput(result.all);
}
