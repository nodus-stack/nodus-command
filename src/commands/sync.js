import chalk from 'chalk';
import chokidar from 'chokidar';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import { api } from '../lib/api.js';
import { normalizeSite, requireToken, resolveSite } from '../lib/auth.js';
import { loadContext, pullTheme, pushTheme, saveContext, isIgnored, compileIgnore, itemOf } from '../lib/theme-sync.js';
import { emitJson, emitLog, emitResult, fail, isJsonMode, planEvent, progressEvent } from '../lib/output.js';

const ucfirst = (v) => v.charAt(0).toUpperCase() + v.slice(1);

function previewUrl(site, theme) {
  return `${site}/?nodus_jet_preview=${theme}`;
}

/**
 * Comandos de sync para un tipo de elemento: 'theme', 'plugin' o 'mu-plugin'.
 * Mismo flujo para los tres; los temas tienen preview, los plugins no se
 * activan desde el CLI y los mu-plugins los carga WordPress solos.
 *
 * Cada comando soporta --format=json (spec §3.2): sin banner/chalk/spinners,
 * envelope único para operaciones instantáneas (list) y NDJSON con `result`
 * final obligatorio para las largas (init, clone, push, pull, dev).
 */
export function createSyncCommands(kind) {
  const Label = ucfirst(kind);

  /**
   * Servidores antiguos de Nodus Jet rechazaban los elementos con origin
   * distinto de "cli" con un 404 genérico ("Not found or not managed by the
   * CLI"). El servidor actual acepta cualquier tema/plugin/mu-plugin instalado,
   * así que solo traducimos ese mensaje legado a un error con código propio;
   * un 404 común ("Not found.") se propaga tal cual. El chequeo es por mensaje,
   * no por código: el servidor devuelve siempre `nodus_jet_theme_not_found`.
   */
  function notManaged(err, slug) {
    if (err?.code === 'not_managed') return err;
    if (/not managed/i.test(err?.message || '')) {
      const mapped = new Error(
        `"${slug}" is not managed by Nodus (origin is not "cli"; only items created with noduscm can be downloaded).`,
      );
      mapped.code = 'not_managed';
      mapped.status = err.status;
      return mapped;
    }
    return err;
  }

  async function contextFor(options) {
    const dir = path.resolve(options.dir || process.cwd());
    const ctx = await loadContext(dir);
    if (itemOf(ctx).kind !== kind) {
      const err = new Error(
        `This folder is a ${itemOf(ctx).kind}, not a ${kind}. Use "noduscm ${itemOf(ctx).kind} ..." here.`,
      );
      err.code = 'context_mismatch';
      throw err;
    }
    if (options.site) {
      const wanted = normalizeSite(options.site);
      if (wanted !== ctx.site) {
        const err = new Error(
          `This folder belongs to ${ctx.site}, not ${wanted}. Pick a folder created for ${wanted}.`,
        );
        err.code = 'site_mismatch';
        throw err;
      }
    }
    if (options.slug) {
      const current = itemOf(ctx).slug;
      if (current !== options.slug) {
        const err = new Error(
          `This folder contains ${kind} "${current}", not "${options.slug}". Use an empty folder with: noduscm ${kind} clone ${options.slug} --dir <empty-folder>`,
        );
        err.code = 'slug_mismatch';
        throw err;
      }
    }
    const token = await requireToken(ctx.site);
    return { dir, ctx, token };
  }

  function printSummary(kind, s) {
    const list = kind === 'push' ? s.upload : s.download;
    for (const rel of list) console.log(`  ${chalk.green(kind === 'push' ? '↑' : '↓')} ${rel}`);
    for (const rel of s.remove) console.log(`  ${chalk.red('✕')} ${rel}`);
    for (const sk of s.skipped || []) console.log(`  ${chalk.yellow('⚠ skipped')} ${sk.path} ${chalk.gray(`(${sk.reason})`)}`);
  }

  async function list(options) {
    try {
      const json = isJsonMode();
      const site = await resolveSite(options.site);
      const token = await requireToken(site);
      const res = await api(site, 'GET', `/${kind}s`, { token });
      const items = res[`${kind}s`];

      if (json) {
        emitJson({
          ok: true,
          code: 0,
          data: {
            site,
            items: items.map((t) => ({
              slug: t.slug ?? null,
              version: t.version ?? null,
              active: Boolean(t.active),
              origin: t.origin ?? null,
            })),
          },
          error: null,
          message: `${items.length} ${kind}(s) on ${site}`,
        });
        return;
      }

      console.log(`\n${chalk.bold(site)}\n`);
      for (const t of items) {
        const tag = t.origin === 'cli' ? chalk.cyan('cli') : chalk.gray('   ');
        const active = t.active ? chalk.green(' (active)') : '';
        console.log(`  ${tag}  ${t.slug}  ${chalk.gray(`v${t.version}`)}${active}`);
      }
      console.log(chalk.gray('\n  "cli" = created with noduscm. Every item can be read and written from the CLI.\n'));
    } catch (err) {
      fail(err);
    }
  }

  async function init(options) {
    try {
      const json = isJsonMode();
      if (!options.name) {
        const err = new Error('--name is required');
        err.code = 'validation';
        throw err;
      }
      const site = await resolveSite(options.site);
      const token = await requireToken(site);

      const spinner = json ? null : ora(`Creating ${kind} on the site...`).start();
      if (json) emitLog('info', `Creating ${kind} on the site...`);

      const created = await api(site, 'POST', `/${kind}s`, { token, body: { name: options.name } }).catch((err) => {
        if (spinner) spinner.fail(`Could not create the ${kind}`);
        throw err;
      });

      const dir = path.resolve(options.dir || created.slug);
      if ((await fs.pathExists(dir)) && (await fs.readdir(dir)).length > 0) {
        if (spinner) spinner.fail(`Local folder ${dir} is not empty`);
        throw new Error(`${Label} "${created.slug}" was created on the site, but ${dir} is not empty. Use: noduscm ${kind} clone ${created.slug} --dir <empty-folder>`);
      }

      const ctx = kind === 'theme' ? { site, theme: created.slug } : { site, kind, slug: created.slug };
      await fs.ensureDir(dir);
      await saveContext(dir, ctx);

      if (json) emitLog('info', `Downloading ${kind} files...`);
      await pullTheme(dir, ctx, token, {
        onProgress: json ? (d, t) => progressEvent(d, t, `Downloading ${d}/${t} files`) : undefined,
      });

      if (json) {
        const data = { site, slug: created.slug, dir };
        if (kind !== 'theme' && created.plugin_file) data.plugin_file = created.plugin_file;
        emitResult(data, `${Label} "${created.slug}" created`);
        return;
      }

      spinner.succeed(chalk.green(`${Label} "${created.slug}" created`));

      console.log(`\n  Folder   ${dir}`);
      if (kind === 'theme') console.log(`  Preview  ${previewUrl(site, created.slug)}`);
      else if (kind === 'mu-plugin') console.log(`  Mu-plugin  ${created.plugin_file}  ${chalk.gray('(WordPress loads it automatically: no activation)')}`);
      else console.log(`  Plugin   ${created.plugin_file}  ${chalk.gray('(activate it in wp-admin → Plugins)')}`);
      console.log();
    } catch (err) {
      fail(err, { result: true });
    }
  }

  async function clone(slug, options) {
    try {
      const json = isJsonMode();
      const site = await resolveSite(options.site);
      const token = await requireToken(site);
      const dir = path.resolve(options.dir || slug);
      const existed = await fs.pathExists(dir);

      if (existed && (await fs.readdir(dir)).length > 0) {
        throw new Error(`${dir} is not empty`);
      }

      const ctx = kind === 'theme' ? { site, theme: slug } : { site, kind, slug };
      await fs.ensureDir(dir);
      await saveContext(dir, ctx);

      const spinner = json ? null : ora(`Downloading ${kind}...`).start();
      if (json) emitLog('info', `Downloading ${kind}...`);

      const s = await pullTheme(dir, ctx, token, {
        onProgress: json ? (d, t) => progressEvent(d, t, `Downloading ${d}/${t} files`) : undefined,
      }).catch(async (err) => {
        if (spinner) spinner.fail('Download failed');
        if (!existed) await fs.remove(dir).catch(() => {});
        throw notManaged(err, slug);
      });

      if (json) {
        emitResult({ slug, dir, files: s.downloaded }, `Cloned "${slug}" (${s.downloaded} files) into ${dir}`);
        return;
      }

      spinner.succeed(chalk.green(`Cloned "${slug}" (${s.downloaded} files) into ${dir}`));
    } catch (err) {
      fail(err, { result: true });
    }
  }

  async function push(options) {
    try {
      const json = isJsonMode();
      const { dir, ctx, token } = await contextFor(options);
      let planSent = false;
      const spinner = json ? null : ora(options.dryRun ? 'Comparing...' : 'Pushing...').start();

      const s = await pushTheme(dir, ctx, token, {
        del: options.delete,
        dryRun: options.dryRun,
        force: options.force,
        onPlan: (plan) => {
          if (json) {
            planSent = true;
            planEvent('push', plan);
            return;
          }
          spinner.stop();
          printSummary('push', plan);
          spinner.start('Pushing...');
        },
        onProgress: (d, t) => {
          if (json) progressEvent(d, t, `Pushing ${d}/${t} files`);
          else spinner.text = `Pushing ${d}/${t} files...`;
        },
      }).catch((err) => {
        if (spinner) spinner.fail('Push failed');
        throw err;
      });

      if (json) {
        // dry-run o sin cambios: pushTheme no llama onPlan → emite el plan igual.
        if (!planSent) planEvent('push', s);
        emitResult(
          {
            uploaded: s.uploaded,
            deleted: s.deleted,
            unchanged: s.unchanged,
            upload: s.upload,
            remove: s.remove,
            skipped: s.skipped || [],
          },
          options.dryRun
            ? `Dry run: ${s.upload.length} to upload, ${s.remove.length} to delete`
            : `Pushed ${s.uploaded} files${options.delete ? `, deleted ${s.deleted}` : ''} (${s.unchanged} unchanged)`,
        );
        return;
      }

      spinner.succeed(
        options.dryRun
          ? `Dry run: ${s.upload.length} to upload, ${s.remove.length} to delete`
          : `Pushed ${s.uploaded} files${options.delete ? `, deleted ${s.deleted}` : ''} (${s.unchanged} unchanged)`,
      );
      if (options.dryRun || s.upload.length + s.remove.length === 0) printSummary('push', s);

      if (!options.delete) console.log(chalk.gray('  (files only on the server are kept; use --delete to remove them)'));
      console.log();
    } catch (err) {
      fail(err, { result: true });
    }
  }

  async function pull(options) {
    try {
      const json = isJsonMode();
      const { dir, ctx, token } = await contextFor(options);
      let planSent = false;
      const spinner = json ? null : ora(options.dryRun ? 'Comparing...' : 'Pulling...').start();

      const s = await pullTheme(dir, ctx, token, {
        del: options.delete,
        dryRun: options.dryRun,
        force: options.force,
        onPlan: (plan) => {
          if (json) {
            planSent = true;
            planEvent('pull', plan);
            return;
          }
          spinner.stop();
          printSummary('pull', plan);
          spinner.start('Pulling...');
        },
        onProgress: (d, t) => {
          if (json) progressEvent(d, t, `Pulling ${d}/${t} files`);
          else spinner.text = `Pulling ${d}/${t} files...`;
        },
      }).catch((err) => {
        if (spinner) spinner.fail('Pull failed');
        throw err;
      });

      if (json) {
        if (!planSent) planEvent('pull', s);
        emitResult(
          {
            downloaded: s.downloaded,
            deleted: s.deleted,
            unchanged: s.unchanged,
            download: s.download,
            remove: s.remove,
            skipped: s.skipped || [],
          },
          options.dryRun
            ? `Dry run: ${s.download.length} to download, ${s.remove.length} to delete`
            : `Pulled ${s.downloaded} files${options.delete ? `, deleted ${s.deleted}` : ''}`,
        );
        return;
      }

      spinner.succeed(
        options.dryRun
          ? `Dry run: ${s.download.length} to download, ${s.remove.length} to delete`
          : `Pulled ${s.downloaded} files${options.delete ? `, deleted ${s.deleted}` : ''}`,
      );
      if (options.dryRun) printSummary('pull', s);
      console.log();
    } catch (err) {
      fail(err, { result: true });
    }
  }

  async function dev(options) {
    try {
      const json = isJsonMode();
      const { dir, ctx, token } = await contextFor(options);
      const rules = compileIgnore(); // el ignore de usuario se aplica al construir el manifiesto

      if (json) {
        emitLog('info', `Watching ${dir}`);
        if (kind === 'theme') emitLog('info', `Preview: ${previewUrl(ctx.site, itemOf(ctx).slug)}`);
        else emitLog('info', 'Plugin files are uploaded on save; activate the plugin in wp-admin.');
      } else {
        console.log(chalk.bold(`\nWatching ${dir}`));
        if (kind === 'theme') console.log(`Preview: ${chalk.cyan(previewUrl(ctx.site, itemOf(ctx).slug))}`);
        else console.log(chalk.gray('Plugin files are uploaded on save; activate the plugin in wp-admin.'));
        console.log();
      }

      let running = false;
      let pending = false;

      const sync = async (initial = false) => {
        if (running) {
          pending = true;
          return;
        }
        running = true;
        try {
          // el contexto cambia tras cada push (lastSyncHash)
          const current = await loadContext(dir);
          const started = Date.now();
          const s = await pushTheme(dir, current, token, { del: options.delete, force: options.force });
          if (s.uploaded || s.deleted || initial) {
            if (json) {
              emitLog(
                'success',
                `${s.uploaded} uploaded${s.deleted ? `, ${s.deleted} deleted` : ''} (${Date.now() - started} ms)`,
              );
              for (const rel of s.upload) emitLog('info', `↑ ${rel}`);
              for (const rel of s.remove) emitLog('info', `✕ ${rel}`);
              if (initial) for (const sk of s.skipped || []) emitLog('warn', `skipped ${sk.path} (${sk.reason})`);
            } else {
              const time = new Date().toLocaleTimeString();
              console.log(`${chalk.gray(time)} ${chalk.green('✔')} ${s.uploaded} uploaded${s.deleted ? `, ${s.deleted} deleted` : ''} ${chalk.gray(`(${Date.now() - started} ms)`)}`);
              for (const rel of s.upload) console.log(`  ${chalk.green('↑')} ${rel}`);
              for (const rel of s.remove) console.log(`  ${chalk.red('✕')} ${rel}`);
              if (initial) for (const sk of s.skipped || []) console.log(`  ${chalk.yellow('⚠ skipped')} ${sk.path} ${chalk.gray(`(${sk.reason})`)}`);
            }
          }
        } catch (err) {
          if (json) emitLog('error', err.message);
          else console.log(`${chalk.gray(new Date().toLocaleTimeString())} ${chalk.red('✖')} ${err.message}`);
        } finally {
          running = false;
          if (pending) {
            pending = false;
            sync();
          }
        }
      };

      await sync(true);

      let timer = null;
      const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        ignored: (p) => {
          const rel = path.relative(dir, p).split(path.sep).join('/');
          return rel !== '' && isIgnored(rel, false, rules);
        },
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      });

      watcher.on('all', () => {
        clearTimeout(timer);
        timer = setTimeout(() => sync(), 250);
      });

      const stop = async () => {
        await watcher.close();
        if (json) emitLog('info', 'Stopped.');
        else console.log(chalk.gray('\nStopped.\n'));
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    } catch (err) {
      fail(err, { result: true });
    }
  }


  return { list, init, clone, push, pull, dev };
}
