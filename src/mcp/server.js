import http from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { registerProject, scanForProjects } from '../lib/registry.js';
import { ToolError, listProjects, projectStatus, redactConfig, resolveProject, siteUrl } from './projects.js';
import { containerLogs, runCli, runInContainer, runWpCli } from './runner.js';
import { projectRepos, publish, repoStatus, resolveRepo } from './git.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

const INSTRUCTIONS = `NodusCommand (noduscm): entornos WordPress locales en Docker/Podman en este equipo.
1. list_projects → elige el proyecto (slug). Si falta, register_project con su carpeta.
2. project_status / project_info antes de actuar; project_up para arrancarlo.
3. WP-CLI dentro del contenedor con wp_cli (args sin "wp", p. ej. ["plugin","list","--format=json"]).
4. Sincronizar desde producción: project_pull (mode all|db|files|uploads|paths). Haz project_backup antes de traer la base de datos si hay cambios locales.
5. Destructivas (project_remove, import_db con force, restore_backup, pull de db) cambian o borran datos locales: confirma con el usuario y pasa confirm = slug.
Nada pide contraseña ni sudo: si un paso lo necesita (hosts, mkcert -install) la salida lo dice y el usuario debe hacerlo en su terminal.`;

const project = z.string().describe('Slug, nombre o ruta absoluta del proyecto (de list_projects)');

function text(data, summary) {
  return {
    content: [{ type: 'text', text: summary ?? JSON.stringify(data, null, 2) }],
    structuredContent: data && typeof data === 'object' && !Array.isArray(data) ? data : { result: data },
  };
}

function safe(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (error) {
      const message = error instanceof ToolError ? error.message : `Error: ${error.shortMessage || error.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  };
}

function cliResult(label, result) {
  const head = result.ok ? `${label}: OK` : `${label}: FAILED${result.timed_out ? ' (timeout)' : ''} (exit ${result.exit_code})`;
  return { ...text(result, `${head}\n\n${result.output || '(no output)'}`), isError: !result.ok };
}

function requireConfirm(config, confirm, what) {
  if (confirm !== config.slug) {
    throw new ToolError(`${what} Confirm with the user, then pass confirm="${config.slug}".`);
  }
}

/**
 * @param {{roots?: string[], allowExec?: boolean}} options
 */
export function buildServer({ roots = [], allowExec = false } = {}) {
  const server = new McpServer({ name: 'nodus-command', version: VERSION }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const rw = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const danger = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    'list_projects',
    {
      title: 'Proyectos locales',
      description: 'Proyectos de NodusCommand en este equipo (registro de noduscm y carpetas --root): slug, ruta, dominio, URL local, motor y si tienen sync remoto.',
      inputSchema: {},
      annotations: ro,
    },
    safe(async () => {
      const projects = await listProjects(roots);
      return text({ projects }, projects.length ? undefined : 'No projects yet. Use register_project with a folder that has .noduscm.json, or run "noduscm init".');
    })
  );

  server.registerTool(
    'register_project',
    {
      title: 'Registrar proyecto',
      description: 'Añade al registro una carpeta con .noduscm.json (o busca proyectos dentro de ella, hasta 2 niveles).',
      inputSchema: { path: z.string().describe('Ruta absoluta del proyecto o de una carpeta que los contiene') },
      annotations: rw,
    },
    safe(async ({ path: dir }) => {
      if (!path.isAbsolute(dir)) throw new ToolError('path must be absolute.');
      const found = await scanForProjects(dir, 2);
      if (!found.length) throw new ToolError(`No .noduscm.json found in ${dir} (2 levels deep).`);
      for (const root of found) await registerProject(root);
      return text({ registered: found });
    })
  );

  server.registerTool(
    'project_info',
    {
      title: 'Información del proyecto',
      description: 'Configuración del proyecto (.noduscm.json sin contraseñas), URLs locales, puertos, SSH remoto y estado de los contenedores.',
      inputSchema: { project },
      annotations: ro,
    },
    safe(async ({ project: ref }) => {
      const { root, config } = await resolveProject(ref, roots);
      const url = siteUrl(config);
      return text({
        path: root,
        url,
        admin_url: `${url}/wp-admin`,
        status: await projectStatus(config),
        config: redactConfig(config),
      });
    })
  );

  server.registerTool(
    'project_status',
    {
      title: 'Estado de los contenedores',
      description: 'Si el proyecto está corriendo y el estado de cada contenedor (apache, mysql).',
      inputSchema: { project },
      annotations: ro,
    },
    safe(async ({ project: ref }) => {
      const { config } = await resolveProject(ref, roots);
      const status = await projectStatus(config);
      return text({ slug: config.slug, url: siteUrl(config), ...status });
    })
  );

  server.registerTool(
    'project_up',
    {
      title: 'Arrancar proyecto',
      description: 'noduscm up: regenera docker-compose/apache.conf desde la config y levanta los contenedores. Si faltan wordpress/ o wp-content/ y hay SSH, los trae del servidor. Puede tardar varios minutos la primera vez.',
      inputSchema: { project },
      annotations: rw,
    },
    safe(async ({ project: ref }) => {
      const { root, config } = await resolveProject(ref, roots);
      const result = await runCli(root, ['up']);
      return cliResult(`noduscm up (${config.slug})`, { ...result, url: siteUrl(config) });
    })
  );

  server.registerTool(
    'project_down',
    {
      title: 'Detener proyecto',
      description: 'noduscm down: detiene los contenedores (los datos se conservan).',
      inputSchema: { project },
      annotations: rw,
    },
    safe(async ({ project: ref }) => {
      const { root, config } = await resolveProject(ref, roots);
      return cliResult(`noduscm down (${config.slug})`, await runCli(root, ['down'], { timeoutMs: 3 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'project_logs',
    {
      title: 'Logs del contenedor',
      description: 'Últimas líneas del log de Apache (errores PHP) o MySQL.',
      inputSchema: {
        project,
        service: z.enum(['apache', 'mysql']).default('apache'),
        lines: z.number().int().min(1).max(1000).default(200),
      },
      annotations: ro,
    },
    safe(async ({ project: ref, service, lines }) => {
      const { config } = await resolveProject(ref, roots);
      const logs = await containerLogs(config, service, lines);
      return text({ service, lines, logs }, logs || '(empty)');
    })
  );

  server.registerTool(
    'wp_cli',
    {
      title: 'WP-CLI',
      description:
        'Ejecuta WP-CLI en el contenedor de Apache del proyecto. args = argumentos sin "wp", p. ej. ["plugin","list","--format=json"], ' +
        '["option","get","siteurl"], ["cache","flush"], ["search-replace","old","new","--dry-run"]. Comandos que borran o reescriben datos ' +
        '(db reset, search-replace sin --dry-run, plugin delete…) solo tras confirmarlo con el usuario.',
      inputSchema: {
        project,
        args: z.array(z.string().max(2000)).min(1).max(50),
      },
      annotations: { ...rw, destructiveHint: true },
    },
    safe(async ({ project: ref, args }) => {
      const { config } = await resolveProject(ref, roots);
      if (args[0] === 'wp') args = args.slice(1);
      // Ejecutar PHP arbitrario (eval, shell, --exec, --require, paquetes) solo con --allow-exec.
      const runsCode = ['shell', 'eval', 'eval-file', 'package'].includes(args[0]) || args.some((a) => /^--(exec|require)(=|$)/.test(a));
      if (runsCode && !allowExec) {
        throw new ToolError('That WP-CLI command runs arbitrary PHP: start the server with --allow-exec to enable it.');
      }
      const result = await runWpCli(config, args);
      return cliResult(`wp ${args.join(' ')}`, result);
    })
  );

  server.registerTool(
    'project_pull',
    {
      title: 'Traer desde producción',
      description:
        'noduscm pull: sincroniza desde el servidor remoto por SSH (o desde un contenedor remoto, modo Coolify). mode: all (archivos + DB), ' +
        'db, files, uploads o paths (solo remote_paths). Traer la DB reemplaza la base local: haz project_backup antes y pasa confirm = slug.',
      inputSchema: {
        project,
        mode: z.enum(['all', 'db', 'files', 'uploads', 'paths']).default('files'),
        remote_paths: z.array(z.string().max(500)).max(20).optional().describe('Rutas relativas a la raíz remota (mode paths)'),
        exclude: z.array(z.string().max(500)).max(50).optional().describe('Rutas/patrones a excluir del sync de archivos'),
        container_id: z.string().max(200).regex(/^[A-Za-z0-9_.-]+$/).optional().describe('Contenedor remoto (modo Coolify): usa los modos *-container-only'),
        confirm: z.string().optional().describe('slug del proyecto, requerido si se trae la base de datos'),
      },
      annotations: danger,
    },
    safe(async ({ project: ref, mode, remote_paths, exclude, container_id, confirm }) => {
      const { root, config } = await resolveProject(ref, roots);
      if (!config.ssh) throw new ToolError(`${config.slug} has no SSH remote configured in .noduscm.json.`);
      if (mode === 'all' || mode === 'db') {
        requireConfirm(config, confirm, 'Pulling the database replaces the local one.');
      }
      const args = ['pull'];
      if (container_id) {
        if (!['files', 'db', 'uploads'].includes(mode)) throw new ToolError('With container_id use mode files, db or uploads.');
        args.push(`--${mode}-container-only`, '--container-id', container_id);
      } else if (mode === 'db') args.push('--db-only');
      else if (mode === 'files') args.push('--files-only');
      else if (mode === 'uploads') args.push('--uploads-only');
      else if (mode === 'paths') {
        if (!remote_paths?.length) throw new ToolError('mode paths needs remote_paths.');
        for (const p of remote_paths) args.push('--specified-path', p);
      }
      for (const e of exclude ?? []) args.push('--exclude', e);
      return cliResult(`noduscm ${args.join(' ')}`, await runCli(root, args, { timeoutMs: 30 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'project_backup',
    {
      title: 'Backup de la base de datos',
      description: 'noduscm backup: exporta la base de datos local a .noduscm/backups/backup-<fecha>.sql.',
      inputSchema: { project },
      annotations: rw,
    },
    safe(async ({ project: ref }) => {
      const { root, config } = await resolveProject(ref, roots);
      return cliResult(`noduscm backup (${config.slug})`, await runCli(root, ['backup'], { timeoutMs: 10 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'list_backups',
    {
      title: 'Backups disponibles',
      description: 'Backups SQL del proyecto en .noduscm/backups (más recientes primero).',
      inputSchema: { project },
      annotations: ro,
    },
    safe(async ({ project: ref }) => {
      const { paths } = await resolveProject(ref, roots);
      const files = (await fs.pathExists(paths.backups)) ? (await fs.readdir(paths.backups)).filter((f) => f.endsWith('.sql')) : [];
      const backups = [];
      for (const file of files) {
        const stat = await fs.stat(path.join(paths.backups, file));
        backups.push({ file, size_kb: Math.round(stat.size / 1024), modified: stat.mtime.toISOString() });
      }
      backups.sort((a, b) => b.modified.localeCompare(a.modified));
      return text({ directory: paths.backups, backups });
    })
  );

  server.registerTool(
    'restore_backup',
    {
      title: 'Restaurar backup',
      description: 'Reemplaza la base de datos local con un backup de list_backups (import-db --force). Pasa confirm = slug tras confirmarlo con el usuario.',
      inputSchema: { project, file: z.string().describe('Nombre del archivo de list_backups'), confirm: z.string().optional() },
      annotations: danger,
    },
    safe(async ({ project: ref, file, confirm }) => {
      const { root, config, paths } = await resolveProject(ref, roots);
      if (path.basename(file) !== file || !file.endsWith('.sql')) throw new ToolError('file must be a backup file name from list_backups.');
      const full = path.join(paths.backups, file);
      if (!(await fs.pathExists(full))) throw new ToolError(`Backup ${file} not found (list_backups).`);
      requireConfirm(config, confirm, 'Restoring replaces the local database.');
      return cliResult(`restore ${file}`, await runCli(root, ['import-db', full, '--force'], { timeoutMs: 20 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'import_db',
    {
      title: 'Importar SQL',
      description:
        'noduscm import-db: importa un .sql del equipo en la base local. force=true borra las tablas antes y ajusta la URL del sitio a la local (requiere confirm = slug).',
      inputSchema: {
        project,
        file: z.string().describe('Ruta absoluta del .sql'),
        force: z.boolean().default(false),
        confirm: z.string().optional(),
      },
      annotations: danger,
    },
    safe(async ({ project: ref, file, force, confirm }) => {
      const { root, config } = await resolveProject(ref, roots);
      if (!path.isAbsolute(file) || !file.endsWith('.sql')) throw new ToolError('file must be an absolute path to a .sql file.');
      if (!(await fs.pathExists(file))) throw new ToolError(`File not found: ${file}`);
      if (force) requireConfirm(config, confirm, 'force drops the local tables before importing.');
      const args = ['import-db', file, ...(force ? ['--force'] : [])];
      return cliResult(`noduscm import-db (${config.slug})`, await runCli(root, args, { timeoutMs: 20 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'project_generate',
    {
      title: 'Regenerar archivos Docker',
      description: 'noduscm generate: regenera docker-compose.yml, Dockerfile, apache.conf y wp-config.php desde .noduscm.json (tras cambiar la config). Luego project_up.',
      inputSchema: { project },
      annotations: rw,
    },
    safe(async ({ project: ref }) => {
      const { root, config } = await resolveProject(ref, roots);
      return cliResult(`noduscm generate (${config.slug})`, await runCli(root, ['generate'], { timeoutMs: 2 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'project_rebootstrap',
    {
      title: 'Reconstruir wordpress/ y wp-content/',
      description: 'noduscm rebootstrap: restaura wordpress/ y wp-content/ desde la config (SSH o descarga). force=true los reconstruye aunque existan (requiere confirm = slug).',
      inputSchema: { project, force: z.boolean().default(false), confirm: z.string().optional() },
      annotations: danger,
    },
    safe(async ({ project: ref, force, confirm }) => {
      const { root, config } = await resolveProject(ref, roots);
      if (force) requireConfirm(config, confirm, 'force rebuilds wordpress/ and wp-content/ even if they exist.');
      return cliResult(`noduscm rebootstrap (${config.slug})`, await runCli(root, ['rebootstrap', ...(force ? ['--force'] : [])], { timeoutMs: 30 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'project_remove',
    {
      title: 'Eliminar proyecto',
      description:
        'noduscm remove: borra contenedores, volúmenes (base de datos local) y archivos generados; conserva wordpress/ y wp-content/. Pasa confirm = slug tras confirmarlo con el usuario.',
      inputSchema: { project, confirm: z.string().optional() },
      annotations: danger,
    },
    safe(async ({ project: ref, confirm }) => {
      const { root, config } = await resolveProject(ref, roots);
      requireConfirm(config, confirm, 'This deletes the local containers and database.');
      return cliResult(`noduscm remove (${config.slug})`, await runCli(root, ['remove', '--yes'], { timeoutMs: 5 * 60 * 1000 }));
    })
  );

  server.registerTool(
    'site_pair_code',
    {
      title: 'Código de vinculación del sitio local',
      description:
        'Genera un código de Nodus Jet en el WordPress local (para vincularlo al conector de Nodus Designer) y devuelve la URL local. ' +
        'Lo usa link_local_site del conector remoto; el proyecto debe estar corriendo con Nodus Jet y Nodus Designer activos.',
      inputSchema: { project },
      annotations: rw,
    },
    safe(async ({ project: ref }) => {
      const { config } = await resolveProject(ref, roots);
      const php = String.raw`
        if (!class_exists('\Vanjex\NodusStack\NodusJet\CliTokens')) { fwrite(STDERR, 'Nodus Jet is not active'); exit(1); }
        if (!class_exists('\Vanjex\NodusStack\NodusDesigner\McpApi')) { fwrite(STDERR, 'Nodus Designer is not active'); exit(1); }
        $admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
        if (!$admins) { fwrite(STDERR, 'No administrator user'); exit(1); }
        echo \Vanjex\NodusStack\NodusJet\CliTokens::create_pair_code((int) $admins[0])['code'];`;
      const result = await runWpCli(config, ['eval', php]);
      const code = result.output.split('\n').pop()?.trim() ?? '';
      if (!result.ok || !/^[A-Za-z0-9_-]{6,}$/.test(code)) {
        throw new ToolError(`Could not create the pairing code: ${result.output || 'unknown error'}`);
      }
      return text({ url: siteUrl(config), code }, `Pairing code created for ${siteUrl(config)}.`);
    })
  );

  server.registerTool(
    'project_repos',
    {
      title: 'Repos Git del proyecto',
      description:
        'Temas y plugins del proyecto que son clones Git montados desde tu equipo (mounts de .noduscm.json): rama, remoto, ' +
        'cambios sin commit y commits sin subir. Es donde Nodus Designer guarda lo que se crea en el sitio local.',
      inputSchema: { project },
      annotations: ro,
    },
    safe(async ({ project: ref }) => {
      const { root, config } = await resolveProject(ref, roots);
      const repos = await projectRepos(root, config);
      const out = [];
      for (const repo of repos) {
        const status = await repoStatus(repo.path);
        out.push({ ...repo, branch: status.branch, github: status.github, changes_count: status.changes_count, ahead: status.ahead, behind: status.behind });
      }
      return text({ repos: out }, out.length ? undefined : 'No Git repos mounted in this project (mounts in .noduscm.json).');
    })
  );

  server.registerTool(
    'git_status',
    {
      title: 'Estado Git',
      description: 'Rama, archivos cambiados, commits sin subir (ahead) y commits nuevos en GitHub (behind) de un repo del proyecto. fetch=true consulta GitHub antes.',
      inputSchema: { project, repo: z.string().optional().describe('Nombre de project_repos (opcional si solo hay uno)'), fetch: z.boolean().default(true) },
      annotations: ro,
    },
    safe(async ({ project: ref, repo, fetch }) => {
      const { root, config } = await resolveProject(ref, roots);
      const target = await resolveRepo(root, config, repo);
      return text({ repo: target.name, ...(await repoStatus(target.path, { fetch })) });
    })
  );

  server.registerTool(
    'git_publish',
    {
      title: 'Publicar cambios en GitHub',
      description:
        'Hace commit de los cambios del repo y los lleva a target_branch, la rama conectada en producción (jet.repos_list en el conector). ' +
        'mode "direct": commit, rebase/merge e integra directo en target_branch. mode "pr": rama de trabajo, push y PR hacia target_branch ' +
        '(merge_pr=true lo mergea con GitHub CLI). Después, en producción: jet.repo_pull. Pide aprobación del usuario antes.',
      inputSchema: {
        project,
        repo: z.string().optional().describe('Nombre de project_repos (opcional si solo hay uno)'),
        message: z.string().min(3).max(500).describe('Mensaje del commit / título del PR'),
        target_branch: z.string().max(200).describe('Rama conectada en producción, p. ej. "main"'),
        mode: z.enum(['direct', 'pr']).default('direct'),
        paths: z.array(z.string().max(500)).max(200).optional().describe('Solo estos archivos (relativos al repo); por defecto todos los cambios'),
        branch: z.string().max(200).optional().describe('mode pr: nombre de la rama de trabajo'),
        merge_pr: z.boolean().default(false),
      },
      annotations: { ...rw, openWorldHint: true },
    },
    safe(async ({ project: ref, repo, message, target_branch, mode, paths, branch, merge_pr }) => {
      const { root, config } = await resolveProject(ref, roots);
      const target = await resolveRepo(root, config, repo);
      const result = await publish(target.path, {
        message,
        targetBranch: target_branch,
        mode,
        paths,
        branch,
        mergePr: merge_pr,
        slug: config.slug,
      });
      const summary =
        mode === 'pr'
          ? `Changes pushed to ${result.branch}${result.pr_url ? `; PR: ${result.pr_url}` : ''}${result.merged ? ' (merged)' : ''}.`
          : `Changes integrated into ${target_branch} (${result.commit}) and pushed.`;
      return text({ repo: target.name, ...result }, `${summary}\nNext: pull in production (jet.repo_pull) once ${target_branch} has the changes.`);
    })
  );

  if (allowExec) {
    server.registerTool(
      'container_exec',
      {
        title: 'Comando en el contenedor',
        description: 'Ejecuta un comando de shell en el contenedor de Apache (como webuser, o root con root=true), en /var/www/html. Úsalo solo cuando wp_cli no alcance.',
        inputSchema: { project, command: z.string().min(1).max(4000), root: z.boolean().default(false) },
        annotations: danger,
      },
      safe(async ({ project: ref, command, root }) => {
        const { config } = await resolveProject(ref, roots);
        return cliResult(`exec (${config.slug})`, await runInContainer(config, command, { root }));
      })
    );
  }

  return server;
}

// ---------------------------------------------------------------------------
// Transportes
// ---------------------------------------------------------------------------

export async function startStdio(options) {
  const server = buildServer(options);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`noduscm MCP ${VERSION} (stdio) ready\n`);
}

function tokenMatches(header, token) {
  const given = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** HTTP local (127.0.0.1) con token Bearer, para interfaces web en este equipo. */
export async function startHttp(options, { port = 7337, host = '127.0.0.1', token, cors = [] } = {}) {
  const secret = token || process.env.NODUSCM_MCP_TOKEN || randomBytes(24).toString('hex');
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || host}`);

    // CORS solo para los orígenes indicados con --cors (interfaces web locales).
    const origin = String(req.headers.origin || '');
    if (origin && cors.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(origin && cors.includes(origin) ? 204 : 403).end();
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, version: VERSION }));
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (!allowedHosts.includes(String(req.headers.host))) {
      res.writeHead(403).end('Forbidden host');
      return;
    }
    if (!tokenMatches(req.headers.authorization, secret)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized');
      return;
    }

    // Sin estado: un servidor MCP por petición.
    const server = buildServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error.message));
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });

  process.stderr.write(
    `noduscm MCP ${VERSION} listening on http://${host}:${port}/mcp\n` +
      (token || process.env.NODUSCM_MCP_TOKEN ? '' : `Token (Authorization: Bearer …): ${secret}\n`)
  );
  return { httpServer, token: secret };
}
