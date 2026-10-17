import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { CONFIG_FILE } from './config.js';

/**
 * Registro de proyectos de este equipo (~/.config/noduscm/projects.json).
 * `init` y `up` lo actualizan; el servidor MCP lo usa para encontrar
 * proyectos sin depender del directorio actual.
 */
export function registryPath() {
  if (process.env.NODUSCM_REGISTRY) return process.env.NODUSCM_REGISTRY;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'noduscm', 'projects.json');
}

export async function readRegistry() {
  try {
    const data = await fs.readJson(registryPath());
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

async function writeRegistry(projects) {
  const file = registryPath();
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { projects }, { spaces: 2 });
}

/** Añade o actualiza un proyecto (por ruta). No falla si no puede escribir. */
export async function registerProject(projectPath, config = null) {
  try {
    const root = path.resolve(projectPath);
    const cfg = config || (await fs.readJson(path.join(root, CONFIG_FILE)));
    const projects = (await readRegistry()).filter((p) => path.resolve(p.path) !== root);
    projects.push({ path: root, slug: cfg.slug, name: cfg.name, domain: cfg.domain, lastUsed: new Date().toISOString() });
    await writeRegistry(projects);
    return true;
  } catch {
    return false;
  }
}

export async function unregisterProject(projectPath) {
  try {
    const root = path.resolve(projectPath);
    await writeRegistry((await readRegistry()).filter((p) => path.resolve(p.path) !== root));
  } catch {
    // best effort
  }
}

/** Busca proyectos (.noduscm.json) bajo una carpeta, hasta `depth` niveles. */
export async function scanForProjects(dir, depth = 2) {
  const found = [];
  const skip = new Set(['node_modules', '.git', 'wordpress', 'wp-content', 'vendor', '.noduscm']);

  async function walk(current, level) {
    if (await fs.pathExists(path.join(current, CONFIG_FILE))) {
      found.push(current);
      return;
    }
    if (level >= depth) return;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !skip.has(entry.name)) {
        await walk(path.join(current, entry.name), level + 1);
      }
    }
  }

  await walk(path.resolve(dir), 0);
  return found;
}
