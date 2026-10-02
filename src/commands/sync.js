import chalk from 'chalk';
import chokidar from 'chokidar';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import { api } from '../lib/api.js';
import { requireToken, resolveSite } from '../lib/auth.js';
import { loadContext, pullTheme, pushTheme, saveContext, isIgnored, compileIgnore, itemOf } from '../lib/theme-sync.js';

const ucfirst = (v) => v.charAt(0).toUpperCase() + v.slice(1);

function previewUrl(site, theme) {
  return `${site}/?nodus_jet_preview=${theme}`;
}

/**
 * Comandos de sync para un tipo de elemento: 'theme' o 'plugin'.
 * Mismo flujo para ambos; los plugins no tienen preview y no se activan desde el CLI.
 */
export function createSyncCommands(kind) {
  const Label = ucfirst(kind);

  function fail(err) {
    console.log(chalk.red(`\n❌ ${err.message}\n`));
    process.exitCode = err.code === 'conflict' ? 2 : 1;
  }

  async function contextFor(options) {
    const dir = path.resolve(options.dir || process.cwd());
    const ctx = await loadContext(dir);
    if (itemOf(ctx).kind !== kind) {
      throw new Error(`This folder is a ${itemOf(ctx).kind}, not a ${kind}. Use "noduscm ${itemOf(ctx).kind} ..." here.`);
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
      const site = await resolveSite(options.site);
      const token = await requireToken(site);
      const res = await api(site, 'GET', `/${kind}s`, { token });
      const items = res[`${kind}s`];

      console.log(`\n${chalk.bold(site)}\n`);
      for (const t of items) {
        const tag = t.origin === 'cli' ? chalk.cyan('cli') : chalk.gray('   ');
        const active = t.active ? chalk.green(' (active)') : '';
        console.log(`  ${tag}  ${t.slug}  ${chalk.gray(`v${t.version}`)}${active}`);
      }
      console.log(chalk.gray('\n  "cli" = managed by noduscm (writable). Others are read-only from the CLI.\n'));
    } catch (err) {
      fail(err);
    }
  }

  async function init(options) {
    try {
      if (!options.name) throw new Error('--name is required');
      const site = await resolveSite(options.site);
      const token = await requireToken(site);

      const spinner = ora(`Creating ${kind} on the site...`).start();
      const created = await api(site, 'POST', `/${kind}s`, { token, body: { name: options.name } }).catch((err) => {
        spinner.fail(`Could not create the ${kind}`);
        throw err;
      });

      const dir = path.resolve(options.dir || created.slug);
      if ((await fs.pathExists(dir)) && (await fs.readdir(dir)).length > 0) {
        spinner.fail(`Local folder ${dir} is not empty`);
        throw new Error(`${Label} "${created.slug}" was created on the site, but ${dir} is not empty. Use: noduscm ${kind} clone ${created.slug} --dir <empty-folder>`);
      }

      const ctx = kind === 'plugin' ? { site, kind, slug: created.slug } : { site, theme: created.slug };
      await fs.ensureDir(dir);
      await saveContext(dir, ctx);
      await pullTheme(dir, ctx, token, {});
      spinner.succeed(chalk.green(`${Label} "${created.slug}" created`));

      console.log(`\n  Folder   ${dir}`);
      if (kind === 'theme') console.log(`  Preview  ${previewUrl(site, created.slug)}`);
      else console.log(`  Plugin   ${created.plugin_file}  ${chalk.gray('(activate it in wp-admin → Plugins)')}`);
      console.log();
    } catch (err) {
      fail(err);
    }
  }

  async function clone(slug, options) {
    try {
      const site = await resolveSite(options.site);
      const token = await requireToken(site);
      const dir = path.resolve(options.dir || slug);

      if ((await fs.pathExists(dir)) && (await fs.readdir(dir)).length > 0) {
        throw new Error(`${dir} is not empty`);
      }

      const ctx = kind === 'plugin' ? { site, kind, slug } : { site, theme: slug };
      await fs.ensureDir(dir);
      await saveContext(dir, ctx);
      const spinner = ora(`Downloading ${kind}...`).start();
      const s = await pullTheme(dir, ctx, token, {}).catch((err) => {
        spinner.fail('Download failed');
        throw err;
      });
      spinner.succeed(chalk.green(`Cloned "${slug}" (${s.downloaded} files) into ${dir}`));
    } catch (err) {
      fail(err);
    }
  }

  async function push(options) {
    try {
      const { dir, ctx, token } = await contextFor(options);
      const spinner = ora(options.dryRun ? 'Comparing...' : 'Pushing...').start();
      const s = await pushTheme(dir, ctx, token, {
        del: options.delete,
        dryRun: options.dryRun,
        force: options.force,
        onPlan: (plan) => {
          spinner.stop();
          printSummary('push', plan);
          spinner.start('Pushing...');
        },
        onProgress: (d, t) => (spinner.text = `Pushing ${d}/${t} files...`),
      }).catch((err) => {
        spinner.fail('Push failed');
        throw err;
      });

      spinner.succeed(
        options.dryRun
          ? `Dry run: ${s.upload.length} to upload, ${s.remove.length} to delete`
          : `Pushed ${s.uploaded} files${options.delete ? `, deleted ${s.deleted}` : ''} (${s.unchanged} unchanged)`,
      );
      if (options.dryRun || s.upload.length + s.remove.length === 0) printSummary('push', s);

      if (!options.delete) console.log(chalk.gray('  (files only on the server are kept; use --delete to remove them)'));
      console.log();
    } catch (err) {
      fail(err);
    }
  }

  async function pull(options) {
    try {
      const { dir, ctx, token } = await contextFor(options);
      const spinner = ora(options.dryRun ? 'Comparing...' : 'Pulling...').start();
      const s = await pullTheme(dir, ctx, token, {
        del: options.delete,
        dryRun: options.dryRun,
        force: options.force,
        onPlan: (plan) => {
          spinner.stop();
          printSummary('pull', plan);
          spinner.start('Pulling...');
        },
        onProgress: (d, t) => (spinner.text = `Pulling ${d}/${t} files...`),
      }).catch((err) => {
        spinner.fail('Pull failed');
        throw err;
      });

      spinner.succeed(
        options.dryRun
          ? `Dry run: ${s.download.length} to download, ${s.remove.length} to delete`
          : `Pulled ${s.downloaded} files${options.delete ? `, deleted ${s.deleted}` : ''}`,
      );
      if (options.dryRun) printSummary('pull', s);
      console.log();
    } catch (err) {
      fail(err);
    }
  }

  async function dev(options) {
    try {
      const { dir, ctx, token } = await contextFor(options);
      const rules = compileIgnore(); // el ignore de usuario se aplica al construir el manifiesto

      console.log(chalk.bold(`\nWatching ${dir}`));
      if (kind === 'theme') console.log(`Preview: ${chalk.cyan(previewUrl(ctx.site, itemOf(ctx).slug))}`);
      else console.log(chalk.gray('Plugin files are uploaded on save; activate the plugin in wp-admin.'));
      console.log();

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
            const time = new Date().toLocaleTimeString();
            console.log(`${chalk.gray(time)} ${chalk.green('✔')} ${s.uploaded} uploaded${s.deleted ? `, ${s.deleted} deleted` : ''} ${chalk.gray(`(${Date.now() - started} ms)`)}`);
            for (const rel of s.upload) console.log(`  ${chalk.green('↑')} ${rel}`);
            for (const rel of s.remove) console.log(`  ${chalk.red('✕')} ${rel}`);
            if (initial) for (const sk of s.skipped || []) console.log(`  ${chalk.yellow('⚠ skipped')} ${sk.path} ${chalk.gray(`(${sk.reason})`)}`);
          }
        } catch (err) {
          console.log(`${chalk.gray(new Date().toLocaleTimeString())} ${chalk.red('✖')} ${err.message}`);
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
        console.log(chalk.gray('\nStopped.\n'));
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    } catch (err) {
      fail(err);
    }
  }


  return { list, init, clone, push, pull, dev };
}
