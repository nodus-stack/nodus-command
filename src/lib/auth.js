import fs from 'fs-extra';
import os from 'os';
import path from 'path';

/**
 * Almacén de credenciales del CLI. Los tokens viven en el directorio de
 * configuración del usuario (nunca dentro de un proyecto), con permisos 600.
 */
export function authFilePath() {
  const base =
    process.env.NODUSCM_CONFIG_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'noduscm');
  return path.join(base, 'auth.json');
}

export function normalizeSite(input) {
  let value = String(input || '').trim();
  if (!value) {
    const err = new Error('Site URL is required (e.g. --site https://example.com)');
    err.code = 'validation';
    throw err;
  }
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    const err = new Error(cause.message);
    err.code = 'validation';
    throw err;
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

async function readAll() {
  try {
    const data = await fs.readJson(authFilePath());
    return { sites: data.sites || {} };
  } catch {
    return { sites: {} };
  }
}

export async function saveAuth(site, data) {
  const all = await readAll();
  all.sites[site] = { ...data, savedAt: new Date().toISOString() };
  const file = authFilePath();
  await fs.ensureDir(path.dirname(file), { mode: 0o700 });
  await fs.writeJson(file, all, { spaces: 2, mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function loadAuth(site) {
  const all = await readAll();
  return all.sites[site] || null;
}

export async function removeAuth(site) {
  const all = await readAll();
  if (!all.sites[site]) return false;
  delete all.sites[site];
  await fs.writeJson(authFilePath(), all, { spaces: 2, mode: 0o600 });
  return true;
}

export async function listSites() {
  return Object.keys((await readAll()).sites);
}

/**
 * Sesiones guardadas completas (para `noduscm sites`). 100% local, sin red.
 * Nunca incluye el token: solo `has_token`.
 */
export async function listSiteSessions() {
  const { sites } = await readAll();
  return Object.entries(sites).map(([site, entry]) => ({
    site,
    label: entry.label ?? null,
    saved_at: entry.savedAt ?? null,
    has_token: Boolean(entry.token),
  }));
}

/**
 * Resuelve el sitio: --site, o el único sitio con sesión guardada.
 */
export async function resolveSite(explicit) {
  if (explicit) return normalizeSite(explicit);
  const sites = await listSites();
  if (sites.length === 1) return sites[0];
  if (sites.length === 0) {
    const err = new Error('Not logged in. Run: noduscm login --site <url>');
    err.code = 'not_authenticated';
    throw err;
  }
  const err = new Error(`Multiple sites logged in; pass --site. (${sites.join(', ')})`);
  err.code = 'validation';
  throw err;
}

export async function requireToken(site) {
  const auth = await loadAuth(site);
  if (!auth?.token) {
    const err = new Error(`Not logged in to ${site}. Run: noduscm login --site ${site}`);
    err.code = 'not_authenticated';
    throw err;
  }
  return auth.token;
}
