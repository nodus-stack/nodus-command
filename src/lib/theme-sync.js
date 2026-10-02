import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { api } from './api.js';

export const CONTEXT_DIR = '.noduscm';
export const CONTEXT_FILES = { theme: 'theme.json', plugin: 'plugin.json' };
export const CONTEXT_FILE = CONTEXT_FILES.theme;
export const IGNORE_FILE = '.noduscmignore';

// Deben coincidir con las reglas del servidor (CliSync en Nodus Jet): se sincroniza todo el
// código de desarrollo (jsx, tsx, ts, scss, vue, lock, yml...) salvo estas excepciones.
export const DENIED_EXTENSIONS = new Set([
  'phar', 'phtml', 'pht', 'phps', 'php3', 'php4', 'php5', 'php6', 'php7', 'php8',
  'exe', 'dll', 'so', 'dylib', 'msi',
]);
export const DENIED_FILENAMES = new Set(['web.config']);
export const MAX_FILE_BYTES = 16 * 1024 * 1024; // el sitio puede bajarlo con el filtro nodus_jet_cli_max_file_bytes
const BATCH_FILES = 100;
const BATCH_BYTES = 3 * 1024 * 1024;

const DEFAULT_IGNORE = ['node_modules/', '.git/', '.noduscm/', '.noduscmignore', '*.map', '.env', '.DS_Store'];

// ---------------------------------------------------------------------------
// Contexto local del tema (.noduscm/theme.json)
// ---------------------------------------------------------------------------

/**
 * Tipo y slug del elemento sincronizado. Los contextos antiguos (solo temas)
 * guardan `theme` en lugar de `kind` + `slug`.
 */
export function itemOf(ctx) {
  const kind = ctx.kind === 'plugin' ? 'plugin' : 'theme';
  return { kind, slug: ctx.slug || ctx.theme };
}

function apiBase(ctx) {
  const { kind, slug } = itemOf(ctx);
  return `/${kind}s/${slug}`;
}

export async function loadContext(dir) {
  for (const kind of ['theme', 'plugin']) {
    const file = path.join(dir, CONTEXT_DIR, CONTEXT_FILES[kind]);
    if (await fs.pathExists(file)) {
      const ctx = await fs.readJson(file);
      return kind === 'plugin' ? { ...ctx, kind: 'plugin' } : ctx;
    }
  }
  throw new Error(
    `No theme/plugin context in ${dir}. Run inside a folder created with "noduscm theme|plugin init" or "clone".`,
  );
}

export async function saveContext(dir, ctx) {
  const file = path.join(dir, CONTEXT_DIR, CONTEXT_FILES[itemOf(ctx).kind]);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, ctx, { spaces: 2 });
}

// ---------------------------------------------------------------------------
// Rutas e ignore
// ---------------------------------------------------------------------------

export function isSyncablePath(rel) {
  if (!rel || rel.length > 400 || rel.startsWith('/')) return false;
  if (rel.includes('\\') || !/^[^\x00-\x1F\x7F:*?"<>|]+$/u.test(rel)) return false;
  const segments = rel.split('/');
  if (segments.some((seg) => seg === '' || seg.startsWith('.'))) return false;
  if (DENIED_FILENAMES.has(segments[segments.length - 1].toLowerCase())) return false;
  const ext = path.posix.extname(rel).slice(1).toLowerCase();
  return !DENIED_EXTENSIONS.has(ext);
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

export function compileIgnore(extraPatterns = []) {
  return [...DEFAULT_IGNORE, ...extraPatterns]
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const dirOnly = line.endsWith('/');
      const pattern = dirOnly ? line.slice(0, -1) : line;
      return { dirOnly, anchored: pattern.includes('/'), re: globToRegExp(pattern) };
    });
}

export function isIgnored(rel, isDir, rules) {
  const parts = rel.split('/');
  for (const rule of rules) {
    if (rule.anchored) {
      for (let i = 1; i <= parts.length; i++) {
        const last = i === parts.length;
        if (rule.re.test(parts.slice(0, i).join('/')) && (!rule.dirOnly || !last || isDir)) return true;
      }
    } else {
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        if (rule.re.test(parts[i]) && (!rule.dirOnly || !last || isDir)) return true;
      }
    }
  }
  return false;
}

async function loadIgnoreRules(dir) {
  const file = path.join(dir, IGNORE_FILE);
  const extra = (await fs.pathExists(file)) ? (await fs.readFile(file, 'utf8')).split(/\r?\n/) : [];
  return compileIgnore(extra);
}

// ---------------------------------------------------------------------------
// Manifiesto local
// ---------------------------------------------------------------------------

export function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * @returns {{manifest: Record<string,string>, skipped: {path: string, reason: string}[]}}
 */
export async function buildLocalManifest(dir) {
  const rules = await loadIgnoreRules(dir);
  const manifest = {};
  const skipped = [];

  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (isIgnored(rel, entry.isDirectory(), rules)) continue;

      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        if (!isSyncablePath(rel)) {
          skipped.push({
            path: rel,
            reason: entry.name.startsWith('.') ? 'hidden files are never synced' : 'file type or name blocked by the site',
          });
          continue;
        }
        const buffer = await fs.readFile(path.join(current, entry.name));
        if (buffer.length > MAX_FILE_BYTES) {
          skipped.push({ path: rel, reason: `larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` });
          continue;
        }
        manifest[rel] = sha1(buffer);
      }
    }
  }

  await walk(dir, '');
  return { manifest, skipped };
}

// ---------------------------------------------------------------------------
// Push / Pull
// ---------------------------------------------------------------------------

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchServerManifest(ctx, token) {
  return api(ctx.site, 'GET', `${apiBase(ctx)}/manifest`, { token });
}

export async function pushTheme(dir, ctx, token, { del = false, dryRun = false, force = false, onProgress = () => {}, onPlan = () => {} } = {}) {
  const { manifest: local, skipped } = await buildLocalManifest(dir);
  const diff = await api(ctx.site, 'POST', `${apiBase(ctx)}/manifest`, { token, body: { files: local } });

  if (ctx.lastSyncHash && diff.server_hash !== ctx.lastSyncHash && !force) {
    const err = new Error(
      'The server changed since your last sync. Run "noduscm theme pull" first, or use --force to overwrite.',
    );
    err.code = 'conflict';
    throw err;
  }

  const upload = [...diff.missing, ...diff.changed];
  const remove = del ? diff.extra : [];
  const summary = { upload, remove, skipped, uploaded: 0, deleted: 0, unchanged: Object.keys(local).length - upload.length };

  if (dryRun || (upload.length === 0 && remove.length === 0)) {
    return summary;
  }

  onPlan(summary); // lista lo que se va a subir/borrar antes de empezar

  // Lotes por número de archivos y tamaño.
  let batch = [];
  let bytes = 0;
  const batches = [];
  for (const rel of upload) {
    const buffer = await fs.readFile(path.join(dir, rel));
    if (batch.length >= BATCH_FILES || (bytes + buffer.length > BATCH_BYTES && batch.length > 0)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push({ path: rel, content_b64: buffer.toString('base64') });
    bytes += buffer.length;
  }
  if (batch.length) batches.push(batch);

  let done = 0;
  for (const files of batches) {
    const res = await api(ctx.site, 'PUT', `${apiBase(ctx)}/files`, { token, body: { files, delete: [] } });
    summary.uploaded += res.written;
    done += files.length;
    onProgress(done, upload.length);
  }
  for (const paths of chunk(remove, BATCH_FILES)) {
    const res = await api(ctx.site, 'PUT', `${apiBase(ctx)}/files`, { token, body: { files: [], delete: paths } });
    summary.deleted += res.deleted;
  }

  const after = await fetchServerManifest(ctx, token);
  await saveContext(dir, { ...ctx, lastSyncHash: after.server_hash, lastSyncFiles: after.files });

  return summary;
}

export async function pullTheme(dir, ctx, token, { del = false, dryRun = false, force = false, onProgress = () => {}, onPlan = () => {} } = {}) {
  const server = await fetchServerManifest(ctx, token);
  const { manifest: local } = await buildLocalManifest(dir);
  const lastFiles = ctx.lastSyncFiles || {};

  const download = [];
  const conflicts = [];
  for (const [rel, sha] of Object.entries(server.files)) {
    if (local[rel] === sha) continue;
    download.push(rel);
    // el archivo local existe y fue editado desde el último sync
    if (local[rel] !== undefined && lastFiles[rel] !== local[rel]) conflicts.push(rel);
  }
  const remove = del ? Object.keys(local).filter((rel) => server.files[rel] === undefined) : [];

  if (conflicts.length && !force) {
    const err = new Error(
      `Local changes would be overwritten: ${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? '…' : ''}. Push them, or use --force.`,
    );
    err.code = 'conflict';
    throw err;
  }

  const summary = { download, remove, downloaded: 0, deleted: 0 };
  if (dryRun) return summary;

  if (download.length || remove.length) onPlan(summary);

  let done = 0;
  for (const group of chunk(download, 50)) {
    // El servidor limita el tamaño de cada respuesta: lo que no cabe vuelve en `deferred`.
    let paths = group;
    while (paths.length) {
      const res = await api(ctx.site, 'POST', `${apiBase(ctx)}/download`, { token, body: { paths } });
      for (const file of res.files) {
        if (!isSyncablePath(file.path)) continue; // nunca confiar en rutas del servidor
        const target = path.resolve(dir, file.path);
        if (!target.startsWith(path.resolve(dir) + path.sep)) continue;
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, Buffer.from(file.content_b64, 'base64'));
        summary.downloaded++;
      }
      const deferred = (res.deferred || []).filter((rel) => paths.includes(rel));
      done += paths.length - deferred.length;
      onProgress(done, download.length);
      if (deferred.length >= paths.length) break; // sin progreso: evita bucle infinito
      paths = deferred;
    }
  }

  for (const rel of remove) {
    await fs.remove(path.join(dir, rel));
    summary.deleted++;
  }

  await saveContext(dir, { ...ctx, lastSyncHash: server.server_hash, lastSyncFiles: server.files });
  return summary;
}
