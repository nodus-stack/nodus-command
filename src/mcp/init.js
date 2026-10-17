import fs from 'fs-extra';
import path from 'path';
import { ToolError, listProjects, readProjectConfig } from './projects.js';
import { InitOptionError, buildInitConfig, nextFreePort } from '../lib/init-options.js';
import { slugifyWithPreview } from '../lib/slugify.js';

const MOUNT_TARGET_RE = /^(themes|plugins|mu-plugins)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** ¿`child` está dentro de `parent` (o es la misma carpeta)? Ambas ya resueltas con realpath. */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function realRoots(roots) {
  const out = [];
  for (const root of roots) {
    try {
      out.push(await fs.realpath(root));
    } catch {
      // Un --root que no existe no autoriza nada.
    }
  }
  return out;
}

async function insideRoots(dir, roots) {
  const real = await fs.realpath(dir);
  return roots.some((root) => isInside(root, real)) ? real : null;
}

/** Puertos ya usados por los proyectos conocidos (registro + --root). */
async function takenPorts(roots) {
  const taken = new Set();
  for (const project of await listProjects(roots)) {
    try {
      const config = await readProjectConfig(project.path);
      taken.add(config.localApachePort).add(config.localMysqlPort).add(config.localHttpsPort);
    } catch {
      // ignorado
    }
  }
  return taken;
}

/**
 * Valida la petición de project_init y crea la carpeta vacía del proyecto.
 * Las rutas montadas y la carpeta destino tienen que estar dentro de un --root:
 * el agente no puede montar ~/.ssh ni crear proyectos en cualquier sitio.
 */
export async function prepareInit(input, roots = []) {
  const allowed = await realRoots(roots);
  if (!allowed.length) {
    throw new ToolError('project_init needs a project folder: start the server with --root <folder> (e.g. noduscm mcp --root ~/WorkspacePHP).');
  }

  let projectName;
  try {
    projectName = (await buildInitConfig({ name: input.name, domain: input.domain, wpVersion: input.wp_version })).projectName;
  } catch (error) {
    if (error instanceof InitOptionError) throw new ToolError(error.message);
    throw error;
  }
  const { slug } = slugifyWithPreview(projectName);

  const known = await listProjects(roots);
  if (known.some((p) => p.slug === slug)) {
    throw new ToolError(`A project with slug "${slug}" already exists (see list_projects). Pick another name.`);
  }

  const parentInput = input.parent ?? allowed[0];
  if (!path.isAbsolute(parentInput)) throw new ToolError('parent must be an absolute path.');
  if (!(await fs.pathExists(parentInput))) throw new ToolError(`parent does not exist: ${parentInput}`);
  const parent = await insideRoots(parentInput, allowed);
  if (!parent) throw new ToolError(`parent must be inside a --root folder (${allowed.join(', ')}).`);

  const dir = path.join(parent, slug);
  let created = false;
  if (await fs.pathExists(dir)) {
    if ((await fs.readdir(dir)).length) throw new ToolError(`${dir} already exists and is not empty.`);
  } else {
    created = true;
  }

  const mounts = [];
  for (const mount of input.mounts || []) {
    const source = String(mount.source || '');
    const target = String(mount.target || '');
    if (!path.isAbsolute(source)) throw new ToolError(`Mount source must be absolute: ${source}`);
    if (!(await fs.pathExists(source)) || !(await fs.stat(source)).isDirectory()) {
      throw new ToolError(`Mount source is not a folder: ${source}`);
    }
    const realSource = await insideRoots(source, allowed);
    if (!realSource) throw new ToolError(`Mount source must be inside a --root folder (${allowed.join(', ')}): ${source}`);
    if (!MOUNT_TARGET_RE.test(target)) {
      throw new ToolError(`Mount target must be "themes/<name>", "plugins/<name>" or "mu-plugins/<name>": ${target}`);
    }
    mounts.push(`${realSource}:/var/www/html/wp-content/${target}${mount.read_only ? ':ro' : ''}`);
  }

  const taken = await takenPorts(roots);
  const http = input.http_port ?? nextFreePort(8080, taken);
  taken.add(http);
  const mysql = input.mysql_port ?? nextFreePort(3306, taken);
  taken.add(mysql);
  const https = input.https_port ?? nextFreePort(8443, taken);

  // Validación final con las mismas reglas del CLI (puertos, dominio, versión, mounts)
  try {
    await buildInitConfig({
      name: projectName,
      domain: input.domain,
      wpVersion: input.wp_version,
      httpPort: http,
      mysqlPort: mysql,
      https: input.https,
      httpsPort: https,
      mount: mounts,
    }, dir);
  } catch (error) {
    if (error instanceof InitOptionError) throw new ToolError(error.message);
    throw error;
  }

  await fs.ensureDir(dir);
  return {
    dir,
    slug,
    name: projectName,
    domain: input.domain,
    wpVersion: input.wp_version,
    https: Boolean(input.https),
    ports: { http, mysql, https },
    mounts,
    /** Si init falla, no deja una carpeta a medias que bloquee el siguiente intento. */
    cleanup: async () => {
      if (created) await fs.remove(dir);
      else await fs.emptyDir(dir);
    },
  };
}

/** Argumentos de `noduscm init --yes` (formato --flag=valor: nada se interpreta como otra opción). */
export function initArgs(plan) {
  const args = ['init', '--yes', `--name=${plan.name}`];
  if (plan.domain) args.push(`--domain=${plan.domain}`);
  if (plan.wpVersion) args.push(`--wp-version=${plan.wpVersion}`);
  args.push(`--http-port=${plan.ports.http}`, `--mysql-port=${plan.ports.mysql}`, `--https-port=${plan.ports.https}`);
  if (plan.https) args.push('--https');
  for (const mount of plan.mounts) args.push(`--mount=${mount}`);
  return args;
}
