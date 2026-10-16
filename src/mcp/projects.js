import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';
import { CONFIG_FILE, getProjectPaths } from '../lib/config.js';
import { readRegistry, registerProject, scanForProjects } from '../lib/registry.js';
import { getLocalSiteUrl } from '../lib/wordpress.js';

/** Errores que el servidor MCP devuelve tal cual al agente. */
export class ToolError extends Error {}

const SECRET_KEYS = new Set(['password', 'rootPassword', 'passphrase', 'privateKey', 'token', 'secret']);

/** Config sin contraseñas (se marcan como "(set)"). */
export function redactConfig(value) {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.has(key) ? (item ? '(set)' : item) : redactConfig(item)])
  );
}

export async function readProjectConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!(await fs.pathExists(file))) throw new ToolError(`No ${CONFIG_FILE} in ${root}`);
  const config = await fs.readJson(file);
  config.localApachePort = Number(config.localApachePort) || 8080;
  config.localMysqlPort = Number(config.localMysqlPort) || 3306;
  config.localHttps = Boolean(config.localHttps);
  config.localHttpsPort = Number(config.localHttpsPort) || 8443;
  config.engine = config.engine || 'docker';
  config.database = config.database || {};
  return config;
}

export function siteUrl(config) {
  return getLocalSiteUrl({
    domain: config.domain,
    engine: config.engine,
    localApachePort: config.localApachePort,
    localHttps: config.localHttps,
    localHttpsPort: config.localHttpsPort,
  });
}

/**
 * Proyectos conocidos: registro (~/.config/noduscm/projects.json) + los que
 * haya bajo las carpetas --root del servidor. Los que ya no existen se omiten.
 */
export async function listProjects(roots = []) {
  const seen = new Map();
  for (const entry of await readRegistry()) {
    seen.set(path.resolve(entry.path), entry);
  }
  for (const root of roots) {
    for (const found of await scanForProjects(root, 2)) {
      if (!seen.has(path.resolve(found))) seen.set(path.resolve(found), { path: found });
    }
  }

  const projects = [];
  for (const [root, entry] of seen) {
    try {
      const config = await readProjectConfig(root);
      projects.push({
        slug: config.slug,
        name: config.name,
        path: root,
        domain: config.domain,
        url: siteUrl(config),
        engine: config.engine,
        database: config.database?.type || 'local',
        remote_sync: Boolean(config.ssh),
        last_used: entry.lastUsed || null,
      });
    } catch {
      // Proyecto borrado o config ilegible: no se lista.
    }
  }
  return projects.sort((a, b) => String(b.last_used).localeCompare(String(a.last_used)));
}

/** Busca un proyecto por slug, nombre o ruta absoluta. */
export async function resolveProject(ref, roots = []) {
  const value = String(ref || '').trim();
  if (!value) throw new ToolError('Pass "project" (slug, name or absolute path; see list_projects).');

  if (path.isAbsolute(value)) {
    const root = path.resolve(value);
    const config = await readProjectConfig(root);
    await registerProject(root, config);
    return { root, config, paths: getProjectPaths(root) };
  }

  const projects = await listProjects(roots);
  const lower = value.toLowerCase();
  const matches = projects.filter((p) => p.slug === value || String(p.name).toLowerCase() === lower);
  if (matches.length === 0) {
    const known = projects.map((p) => p.slug).join(', ') || 'none';
    throw new ToolError(`Project "${value}" not found. Known projects: ${known}. Use register_project with its folder if it is missing.`);
  }
  if (matches.length > 1) {
    throw new ToolError(`"${value}" matches several projects (${matches.map((p) => p.path).join(', ')}): pass the absolute path.`);
  }
  const root = matches[0].path;
  return { root, config: await readProjectConfig(root), paths: getProjectPaths(root) };
}

/** Contenedores del proyecto (<slug>-apache, <slug>-mysql) y su estado. */
export async function projectStatus(config) {
  const engine = config.engine;
  try {
    const { stdout } = await execa(engine, ['ps', '-a', '--filter', `name=${config.slug}-`, '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'], {
      timeout: 15000,
    });
    const containers = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, state, status] = line.split('\t');
        return { name, state: String(state || '').toLowerCase(), status };
      })
      .filter((c) => c.name.startsWith(`${config.slug}-`));
    const running = containers.filter((c) => c.state === 'running').length;
    return {
      engine,
      running: containers.length > 0 && running === containers.length,
      containers,
    };
  } catch (error) {
    return { engine, running: false, containers: [], error: `${engine} not available: ${firstLine(error.shortMessage || error.message)}` };
  }
}

export function firstLine(text) {
  return String(text || '').split('\n')[0].slice(0, 300);
}
