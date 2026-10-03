import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemOf } from '../src/lib/theme-sync.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'noduscm.js');
const BANNER_RE = /▄██████|Modern WordPress Local Development/;
const ESC = String.fromCharCode(27); // nunca debe aparecer en stdout json (sin chalk)

let base;
let seq = 0;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-cli-json-'));
});

afterAll(async () => {
  await fs.remove(base);
});

function newConfigDir() {
  seq += 1;
  const dir = path.join(base, `cfg-${seq}`);
  fs.ensureDirSync(dir);
  return dir;
}

function run(args, { configDir = newConfigDir(), cwd } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, NODUSCM_CONFIG_DIR: configDir },
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function runAsync(args, { configDir = newConfigDir(), cwd, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, NODUSCM_CONFIG_DIR: configDir },
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.on('error', reject);
  });
}

function parseLines(stdout) {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function expectPureJsonStdout(stdout) {
  expect(stdout).not.toMatch(BANNER_RE);
  expect(stdout.includes(ESC)).toBe(false);
  for (const line of stdout.split('\n').filter(Boolean)) {
    expect(() => JSON.parse(line)).not.toThrow();
  }
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

describe('instant commands in json mode', () => {
  it('sites --format=json -> single parseable envelope, exit 0, no banner (A4)', () => {
    const r = run(['sites', '--format=json']);
    expect(r.status).toBe(0);
    expectPureJsonStdout(r.stdout);
    const lines = parseLines(r.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0].ok).toBe(true);
    expect(lines[0].code).toBe(0);
    expect(lines[0].data.sites).toEqual([]);
    expect(lines[0]).not.toHaveProperty('type');
  });

  it('sites --json (shorthand) behaves the same', () => {
    const r = run(['sites', '--json']);
    expect(r.status).toBe(0);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].ok).toBe(true);
  });

  it('theme list sin sesion -> exit 10 + envelope ok:false (A5/A9)', () => {
    const r = run(['theme', 'list', '--site', 'https://example.com', '--format=json']);
    expect(r.status).toBe(10);
    expectPureJsonStdout(r.stdout);
    const [env] = parseLines(r.stdout);
    expect(env.ok).toBe(false);
    expect(env.code).toBe(10);
    expect(env.data).toBeNull();
    expect(env.message).toMatch(/Not logged in/);
  });

  it('plugin list sin sesion -> exit 10', () => {
    const r = run(['plugin', 'list', '--site', 'https://example.com', '--format=json']);
    expect(r.status).toBe(10);
    expect(parseLines(r.stdout)[0].code).toBe(10);
  });

  it('mu-plugin list sin sesion -> exit 10', () => {
    const r = run(['mu-plugin', 'list', '--site', 'https://example.com', '--format=json']);
    expect(r.status).toBe(10);
    expect(parseLines(r.stdout)[0].code).toBe(10);
  });

  it('whoami sin sesion -> exit 10 (A3)', () => {
    const r = run(['whoami', '--site', 'https://example.com', '--json']);
    expect(r.status).toBe(10);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].code).toBe(10);
  });

  it('login sin --code en json -> exit 50, sin prompt ni token (A3)', () => {
    const r = run(['login', '--site', 'https://example.com', '--format=json']);
    expect(r.status).toBe(50);
    expectPureJsonStdout(r.stdout);
    expect(r.stdout).not.toMatch(/Pairing code:/);
    expect(r.stdout.toLowerCase()).not.toContain('token');
    const [env] = parseLines(r.stdout);
    expect(env.ok).toBe(false);
    expect(env.code).toBe(50);
    expect(env.message).toMatch(/--code/);
  });

  it('theme init sin --name en json -> exit 50 (validacion de argumentos)', () => {
    const r = run(['theme', 'init', '--format=json']);
    expect(r.status).toBe(50);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].code).toBe(50);
  });

  it('theme push sin contexto .noduscm -> exit 40 + result event', () => {
    const cwd = fs.mkdtempSync(path.join(base, 'noctx-'));
    const r = run(['theme', 'push', '--format=json'], { cwd });
    expect(r.status).toBe(40);
    expectPureJsonStdout(r.stdout);
    const [evt] = parseLines(r.stdout);
    expect(evt.type).toBe('result');
    expect(evt.ok).toBe(false);
    expect(evt.code).toBe(40);
    expect(evt.error).toBe('context_missing');
  });

  it('theme push con --site distinto al de la carpeta -> exit 50 + site_mismatch', () => {
    const cwd = fs.mkdtempSync(path.join(base, 'mismatch-'));
    fs.outputJsonSync(path.join(cwd, '.noduscm', 'theme.json'), {
      site: 'https://site-a.test',
      theme: 'mi-tema',
    });
    const r = run(['theme', 'push', '--dir', cwd, '--site', 'https://site-b.test', '--format=json']);
    expect(r.status).toBe(50);
    expectPureJsonStdout(r.stdout);
    const [evt] = parseLines(r.stdout);
    expect(evt.type).toBe('result');
    expect(evt.code).toBe(50);
    expect(evt.error).toBe('site_mismatch');
  });

  it('theme push con --slug distinto al de la carpeta -> exit 50 + slug_mismatch', () => {
    const cwd = fs.mkdtempSync(path.join(base, 'slugmis-'));
    fs.outputJsonSync(path.join(cwd, '.noduscm', 'theme.json'), {
      site: 'https://site-a.test',
      theme: 'mi-tema',
    });
    const r = run([
      'theme',
      'push',
      '--dir',
      cwd,
      '--site',
      'https://site-a.test',
      '--slug',
      'otro-tema',
      '--format=json',
    ]);
    expect(r.status).toBe(50);
    expectPureJsonStdout(r.stdout);
    const [evt] = parseLines(r.stdout);
    expect(evt.type).toBe('result');
    expect(evt.code).toBe(50);
    expect(evt.error).toBe('slug_mismatch');
  });

  it('theme push con --site igual al de la carpeta pasa la validacion (exit 10 sin sesion)', () => {
    const cwd = fs.mkdtempSync(path.join(base, 'match-'));
    fs.outputJsonSync(path.join(cwd, '.noduscm', 'theme.json'), {
      site: 'https://site-a.test',
      theme: 'mi-tema',
    });
    const r = run(['theme', 'push', '--dir', cwd, '--site', 'https://site-a.test', '--format=json']);
    expect(r.status).toBe(10);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].error).toBe('not_authenticated');
  });

  it('API inaccesible -> exit 30 (red/API)', () => {
    const configDir = newConfigDir();
    fs.outputJsonSync(path.join(configDir, 'auth.json'), {
      sites: { 'http://127.0.0.1:1': { token: 'x', savedAt: '2026-01-01T00:00:00.000Z' } },
    });
    const r = run(['theme', 'list', '--site', 'http://127.0.0.1:1', '--format=json'], { configDir });
    expect(r.status).toBe(30);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].code).toBe(30);
  });

  it('noduscm --format=json sin comando -> envelope en stdout, sin banner', () => {
    const r = run(['--format=json']);
    expect(r.status).toBe(50);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].code).toBe(50);
    expect(r.stderr).not.toMatch(BANNER_RE);
  });
});

describe('text mode is preserved (no --format)', () => {
  it('theme list sin sesion sigue imprimiendo el error humano con exit 1', () => {
    const r = run(['theme', 'list', '--site', 'https://example.com']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('❌');
    expect(r.stdout).toContain('Not logged in');
    expect(r.stdout).not.toMatch(/"ok":/);
  });

  it('sites sin sesion de config muestra texto humano con exit 0', () => {
    const r = run(['sites']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No saved sessions');
    expect(r.stdout).not.toMatch(/"ok":/);
  });

  it('unknown option sigue fallando con exit 1 y mensaje en stderr', () => {
    const r = run(['theme', 'list', '--bogus']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown option '--bogus'");
  });
});

describe('long operations in json mode (NDJSON plan/progress/result)', () => {
  it('theme push --format=json emite plan + progress + result (A7)', async () => {
    const dir = path.join(base, 'push-proj');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'style.css'), 'body{}');

    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { missing: ['style.css'], changed: [], extra: [], server_hash: 'h1', files: {} });
      } else if (req.method === 'PUT' && /\/themes\/[^/]+\/files$/.test(url.pathname)) {
        const body = await readBody(req);
        json(res, 200, { written: body.files.length, deleted: (body.delete || []).length });
      } else if (req.method === 'GET' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h2', files: { 'style.css': sha1('body{}') } });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });
      await fs.outputJson(path.join(dir, '.noduscm', 'theme.json'), { site: origin, theme: 'mi-tema' });

      const r = await runAsync(['theme', 'push', '--format=json'], { configDir, cwd: dir });
      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      expect(lines.map((l) => l.type)).toEqual(['plan', 'progress', 'result']);

      expect(lines[0]).toEqual({
        type: 'plan',
        op: 'push',
        upload: ['style.css'],
        download: [],
        remove: [],
        skipped: [],
      });
      expect(lines[1].type).toBe('progress');
      expect(lines[1].percent).toBe(100);
      expect(lines[1].current).toBe(1);
      expect(lines[1].total).toBe(1);

      const result = lines[2];
      expect(result.ok).toBe(true);
      expect(result.code).toBe(0);
      expect(result.data).toEqual({
        uploaded: 1,
        deleted: 0,
        unchanged: 0,
        upload: ['style.css'],
        remove: [],
        skipped: [],
      });
    } finally {
      server.close();
    }
  }, 20_000);

  it('theme pull --format=json emite plan + progress + result (A7)', async () => {
    const dir = path.join(base, 'pull-proj');
    await fs.ensureDir(dir);

    const content = 'hello';
    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h1', files: { 'remote.txt': sha1(content) } });
      } else if (req.method === 'POST' && /\/themes\/[^/]+\/download$/.test(url.pathname)) {
        json(res, 200, {
          files: [{ path: 'remote.txt', content_b64: Buffer.from(content).toString('base64') }],
          deferred: [],
        });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });
      await fs.outputJson(path.join(dir, '.noduscm', 'theme.json'), { site: origin, theme: 'mi-tema' });

      const r = await runAsync(['theme', 'pull', '--format=json'], { configDir, cwd: dir });
      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      expect(lines.map((l) => l.type)).toEqual(['plan', 'progress', 'result']);

      expect(lines[0]).toEqual({
        type: 'plan',
        op: 'pull',
        upload: [],
        download: ['remote.txt'],
        remove: [],
        skipped: [],
      });
      expect(lines[1].percent).toBe(100);
      expect(lines[2].data).toEqual({
        downloaded: 1,
        deleted: 0,
        unchanged: 0,
        download: ['remote.txt'],
        remove: [],
        skipped: [],
      });
      expect(await fs.readFile(path.join(dir, 'remote.txt'), 'utf8')).toBe(content);
    } finally {
      server.close();
    }
  }, 20_000);

  it('theme dev --format=json emite logs NDJSON sin terminar (A8)', async () => {
    const dir = path.join(base, 'dev-proj');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'style.css'), 'body{}');

    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { missing: [], changed: [], extra: [], server_hash: 'h1', files: {} });
      } else if (req.method === 'GET' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h1', files: {} });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });
      await fs.outputJson(path.join(dir, '.noduscm', 'theme.json'), { site: origin, theme: 'mi-tema' });

      // dev no termina: esperamos los primeros eventos y lo matamos (la GUI hace lo mismo).
      const child = spawn(process.execPath, [BIN, 'theme', 'dev', '--format=json'], {
        env: { ...process.env, NODUSCM_CONFIG_DIR: configDir },
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let killed = false;
      const r = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('dev did not emit logs in time'));
        }, 15_000);
        child.stdout.on('data', (d) => {
          stdout += d;
          const lines = stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
          if (!killed && lines.some((l) => l.type === 'log' && l.level === 'success')) {
            killed = true;
            // deja registrar el handler SIGTERM (el watcher ya esta armado)
            setTimeout(() => child.kill('SIGTERM'), 750);
          }
        });
        child.on('close', (status) => {
          clearTimeout(timer);
          resolve({ status, stdout });
        });
      });
      server.close();

      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);
      const lines = parseLines(r.stdout);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]).toMatchObject({ type: 'log', level: 'info' });
      expect(lines[0].message).toMatch(/Watching/);
      expect(lines.some((l) => l.type === 'log' && l.level === 'success')).toBe(true);
      expect(lines.some((l) => l.type === 'result')).toBe(false); // dev nunca emite result
    } catch (err) {
      server.close();
      throw err;
    }
  }, 25_000);
});

describe('init / clone in json mode (NDJSON log/progress/result, A6)', () => {
  it('theme clone --format=json emite log + progress + result con files', async () => {
    const dir = path.join(base, 'clone-dest');
    const content = 'body{clone}';
    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h1', files: { 'style.css': sha1(content) } });
      } else if (req.method === 'POST' && /\/themes\/[^/]+\/download$/.test(url.pathname)) {
        json(res, 200, {
          files: [{ path: 'style.css', content_b64: Buffer.from(content).toString('base64') }],
          deferred: [],
        });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });

      const r = await runAsync(
        ['theme', 'clone', 'mi-tema', '--site', origin, '--dir', dir, '--format=json'],
        { configDir },
      );
      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      expect(lines.map((l) => l.type)).toEqual(['log', 'progress', 'result']);
      expect(lines[0].level).toBe('info');
      expect(lines[1].percent).toBe(100);

      const result = lines[2];
      expect(result.ok).toBe(true);
      expect(result.code).toBe(0);
      expect(result.data).toEqual({ slug: 'mi-tema', dir, files: 1 });
      expect(await fs.readFile(path.join(dir, 'style.css'), 'utf8')).toBe(content);
      expect(await fs.pathExists(path.join(dir, '.noduscm', 'theme.json'))).toBe(true);
    } finally {
      server.close();
    }
  }, 20_000);

  it('theme clone de un elemento no gestionado -> exit 40 + not_managed y carpeta creada eliminada', async () => {
    const dir = path.join(base, 'clone-not-managed');
    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 404, {
          code: 'nodus_jet_theme_not_found',
          message: 'Not found or not managed by the CLI.',
        });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });

      const r = await runAsync(
        ['theme', 'clone', 'core-theme', '--site', origin, '--dir', dir, '--format=json'],
        { configDir },
      );
      expect(r.status).toBe(40);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      const result = lines[lines.length - 1];
      expect(result.type).toBe('result');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(40);
      expect(result.error).toBe('not_managed');
      expect(result.message).toMatch(/not managed by Nodus/);
      expect(await fs.pathExists(dir)).toBe(false);
    } finally {
      server.close();
    }
  }, 20_000);

  it('theme init --format=json emite log + result con {site,slug,dir}', async () => {
    const dir = path.join(base, 'init-dest');
    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/wp-json/nodus-jet/v1/themes') {
        json(res, 200, { slug: 'mi-tema' });
      } else if (req.method === 'GET' && /\/themes\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h1', files: {} });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });

      const r = await runAsync(
        ['theme', 'init', '--name', 'Mi Tema', '--site', origin, '--dir', dir, '--format=json'],
        { configDir },
      );
      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      expect(lines.map((l) => l.type)).toEqual(['log', 'log', 'result']);
      expect(lines[0].message).toMatch(/Creating theme/);
      expect(lines[1].message).toMatch(/Downloading/);

      const result = lines[2];
      expect(result.ok).toBe(true);
      expect(result.code).toBe(0);
      expect(result.data).toEqual({ site: origin, slug: 'mi-tema', dir });
      expect(await fs.pathExists(path.join(dir, '.noduscm', 'theme.json'))).toBe(true);
    } finally {
      server.close();
    }
  }, 20_000);
});

describe('mu-plugin commands in json mode', () => {
  it('mu-plugin init --format=json crea el mu-plugin en el servidor y guarda mu-plugin.json', async () => {
    const dir = path.join(base, 'mu-init-dest');
    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/wp-json/nodus-jet/v1/mu-plugins') {
        json(res, 200, { slug: 'mi-mu', plugin_file: 'mi-mu.php' });
      } else if (req.method === 'GET' && /\/mu-plugins\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h1', files: {} });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });

      const r = await runAsync(
        ['mu-plugin', 'init', '--name', 'Mi MU', '--site', origin, '--dir', dir, '--format=json'],
        { configDir },
      );
      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      expect(lines.map((l) => l.type)).toEqual(['log', 'log', 'result']);
      expect(lines[0].message).toMatch(/Creating mu-plugin/);

      const result = lines[2];
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ site: origin, slug: 'mi-mu', dir, plugin_file: 'mi-mu.php' });

      const ctx = await fs.readJson(path.join(dir, '.noduscm', 'mu-plugin.json'));
      expect(ctx).toMatchObject({ site: origin, kind: 'mu-plugin', slug: 'mi-mu' });
      expect(itemOf(ctx)).toEqual({ kind: 'mu-plugin', slug: 'mi-mu' });
    } finally {
      server.close();
    }
  }, 20_000);

  it('mu-plugin push --format=json usa /mu-plugins y emite plan + progress + result', async () => {
    const dir = path.join(base, 'mu-push-proj');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'mi-mu.php'), '<?php // mu');

    const seen = [];
    const { server, origin } = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      seen.push(`${req.method} ${url.pathname}`);
      if (req.method === 'POST' && /\/mu-plugins\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { missing: ['mi-mu.php'], changed: [], extra: [], server_hash: 'h1', files: {} });
      } else if (req.method === 'PUT' && /\/mu-plugins\/[^/]+\/files$/.test(url.pathname)) {
        const body = await readBody(req);
        json(res, 200, { written: body.files.length, deleted: (body.delete || []).length });
      } else if (req.method === 'GET' && /\/mu-plugins\/[^/]+\/manifest$/.test(url.pathname)) {
        json(res, 200, { server_hash: 'h2', files: { 'mi-mu.php': sha1('<?php // mu') } });
      } else {
        json(res, 404, { message: 'not found' });
      }
    });

    try {
      const configDir = newConfigDir();
      await fs.outputJson(path.join(configDir, 'auth.json'), {
        sites: { [origin]: { token: 'tok', savedAt: '2026-01-01T00:00:00.000Z' } },
      });
      await fs.outputJson(path.join(dir, '.noduscm', 'mu-plugin.json'), {
        site: origin,
        kind: 'mu-plugin',
        slug: 'mi-mu',
      });

      const r = await runAsync(['mu-plugin', 'push', '--format=json'], { configDir, cwd: dir });
      expect(r.status).toBe(0);
      expectPureJsonStdout(r.stdout);

      const lines = parseLines(r.stdout);
      expect(lines.map((l) => l.type)).toEqual(['plan', 'progress', 'result']);
      expect(lines[0]).toEqual({
        type: 'plan',
        op: 'push',
        upload: ['mi-mu.php'],
        download: [],
        remove: [],
        skipped: [],
      });
      expect(lines[2].ok).toBe(true);
      expect(lines[2].data).toMatchObject({ uploaded: 1, deleted: 0 });

      expect(seen.some((p) => p === 'PUT /wp-json/nodus-jet/v1/mu-plugins/mi-mu/files')).toBe(true);
      expect(seen.some((p) => p.includes('/themes/') || p.includes('/plugins/'))).toBe(false);
    } finally {
      server.close();
    }
  }, 20_000);

  it('mu-plugin push en una carpeta de tema -> exit 40 + context_mismatch', () => {
    const cwd = fs.mkdtempSync(path.join(base, 'mu-mismatch-'));
    fs.outputJsonSync(path.join(cwd, '.noduscm', 'theme.json'), {
      site: 'https://site-a.test',
      theme: 'mi-tema',
    });
    const r = run(['mu-plugin', 'push', '--dir', cwd, '--format=json']);
    expect(r.status).toBe(40);
    expectPureJsonStdout(r.stdout);
    const [evt] = parseLines(r.stdout);
    expect(evt.type).toBe('result');
    expect(evt.code).toBe(40);
    expect(evt.error).toBe('context_mismatch');
  });

  it('mu-plugin push sin contexto -> exit 40 + context_missing', () => {
    const cwd = fs.mkdtempSync(path.join(base, 'mu-noctx-'));
    const r = run(['mu-plugin', 'push', '--format=json'], { cwd });
    expect(r.status).toBe(40);
    expectPureJsonStdout(r.stdout);
    expect(parseLines(r.stdout)[0].error).toBe('context_missing');
  });
});
