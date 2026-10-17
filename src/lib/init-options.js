import fs from 'fs-extra';
import path from 'path';
import { slugifyWithPreview } from './slugify.js';

/**
 * Opciones de `noduscm init --yes` (y de la tool project_init del MCP).
 * Devuelve la misma forma que promptProjectInit, sin preguntar nada.
 * Solo cubre base de datos local y sin SSH: las credenciales remotas no
 * viajan por flags; para eso sigue estando el init interactivo.
 */

export const DEFAULT_WP_VERSION = '6.7';

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.localhost$/;
const VERSION_RE = /^\d+\.\d+(\.\d+)?$/;
const DB_VALUE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MOUNT_TARGET_RE = /^\/[A-Za-z0-9._/-]+$/;
const SOURCE_RE = /^\/[^\0\r\n"'`$\\#{}\[\],&*?|<>!%@]*$/;
const MOUNT_MODE_RE = /^(ro|rw|z|Z)(,(ro|rw|z|Z))*$/;

export class InitOptionError extends Error {}

function fail(message) {
  throw new InitOptionError(message);
}

/** Nombre del proyecto: texto de una línea, sin "*\/" (va dentro de un comentario PHP). */
export function validateProjectName(name) {
  const value = String(name ?? '').trim();
  if (!value) fail('Project name is required (--name).');
  if (value.length > 80) fail('Project name is too long (max 80 characters).');
  if (/[\u0000-\u001f\u007f]/.test(value) || value.includes('*/')) fail('Project name contains invalid characters.');
  if (!slugifyWithPreview(value).slug) fail('Project name must contain letters or numbers.');
  return value;
}

export function validatePortValue(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid ${flag}: ${value} (1-65535).`);
  return port;
}

/** <ruta-local>:<ruta-contenedor>[:modo] con ruta local absoluta y destino bajo /var/www/html. */
export function parseMount(entry) {
  const value = String(entry ?? '').trim();
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) fail(`Invalid --mount "${value}": use <local-path>:<container-path>[:mode].`);
  const [source, target, mode] = parts;
  if (!path.isAbsolute(source)) fail(`Invalid --mount "${value}": the local path must be absolute.`);
  // Va tal cual a docker-compose.yml: nada de comillas, saltos de línea ni variables
  if (!SOURCE_RE.test(source)) fail(`Invalid --mount "${value}": the local path has unsupported characters.`);
  if (!MOUNT_TARGET_RE.test(target) || target.split('/').includes('..')) fail(`Invalid --mount "${value}": bad container path.`);
  if (target !== '/var/www/html' && !target.startsWith('/var/www/html/')) {
    fail(`Invalid --mount "${value}": the container path must be inside /var/www/html.`);
  }
  if (mode !== undefined && !MOUNT_MODE_RE.test(mode)) fail(`Invalid --mount "${value}": mode must be ro, rw, z or Z.`);
  return { source, target, mode, entry: value };
}

/**
 * @param {object} opts  flags de commander (name, domain, wpVersion, existing, dbName, dbUser,
 *                       dbPassword, httpPort, mysqlPort, https, httpsPort, hosts, mount)
 * @param {string} cwd   carpeta del proyecto
 */
export async function buildInitConfig(opts = {}, cwd = process.cwd()) {
  const projectName = validateProjectName(opts.name);
  const { slug } = slugifyWithPreview(projectName);

  const domain = String(opts.domain || `${slug}.localhost`).trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) fail(`Invalid --domain "${domain}": use letters, numbers and dashes, ending in .localhost.`);

  const wpVersion = String(opts.wpVersion || DEFAULT_WP_VERSION).trim();
  if (!VERSION_RE.test(wpVersion)) fail(`Invalid --wp-version "${wpVersion}" (e.g. 6.7 or 6.7.1).`);

  const db = {
    name: opts.dbName ?? 'wordpress',
    user: opts.dbUser ?? 'wordpress',
    password: opts.dbPassword ?? 'wordpress',
  };
  for (const [key, value] of Object.entries(db)) {
    if (!DB_VALUE_RE.test(String(value))) fail(`Invalid database ${key}: use letters, numbers, "_" or "-" (max 64).`);
  }

  const localApachePort = validatePortValue(opts.httpPort ?? 8080, '--http-port');
  const localMysqlPort = validatePortValue(opts.mysqlPort ?? 3306, '--mysql-port');
  const localHttps = Boolean(opts.https);
  const localHttpsPort = validatePortValue(opts.httpsPort ?? 8443, '--https-port');
  const used = [localApachePort, localMysqlPort, ...(localHttps ? [localHttpsPort] : [])];
  if (new Set(used).size !== used.length) fail('HTTP, MySQL and HTTPS ports must be different.');

  const mounts = (opts.mount || []).map((entry) => parseMount(entry).entry);
  const isBlank = !opts.existing;

  return {
    projectName,
    slug,
    domain,
    isBlank,
    wpVersion,
    hasWpContent: isBlank ? false : await fs.pathExists(path.join(cwd, 'wp-content')),
    database: {
      type: 'local',
      host: `${slug}-mysql`,
      name: db.name,
      user: db.user,
      password: db.password,
      rootPassword: 'root',
    },
    ssh: null,
    mounts,
    localApachePort,
    localMysqlPort,
    localHttps,
    localHttpsPort,
    autoManageHosts: opts.hosts !== false,
  };
}

/** Primer puerto libre desde `start` que no esté en `taken`. */
export function nextFreePort(start, taken) {
  let port = start;
  while (taken.has(port)) port += 1;
  return port;
}
