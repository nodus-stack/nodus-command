import chalk from 'chalk';
import chokidar from 'chokidar';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import { api } from '../../lib/api.js';
import { requireToken, resolveSite } from '../../lib/auth.js';
import { loadContext, pullTheme, pushTheme, saveContext, isIgnored, compileIgnore } from '../../lib/theme-sync.js';

function fail(err) {
  console.log(chalk.red(`\n❌ ${err.message}\n`));
  process.exitCode = err.code === 'conflict' ? 2 : 1;
}

function previewUrl(site, theme) {
  return `${site}/?nodus_jet_preview=${theme}`;
}

async function contextFor(options) {
  const dir = path.resolve(options.dir || process.cwd());
  const ctx = await loadContext(dir);
  const token = await requireToken(ctx.site);
  return { dir, ctx, token };
}

function printSummary(kind, s) {
  const list = kind === 'push' ? s.upload : s.download;
  for (const rel of list) console.log(`  ${chalk.green(kind === 'push' ? '↑' : '↓')} ${rel}`);
  for (const rel of s.remove) console.log(`  ${chalk.red('✕')} ${rel}`);
  for (const sk of s.skipped || []) console.log(chalk.gray(`  – skipped ${sk.path} (${sk.reason})`));
}

export async function themeListCommand(options) {
  try {
    const site = await resolveSite(options.site);
    const token = await requireToken(site);
    const { themes } = await api(site, 'GET', '/themes', { token });

    console.log(`\n${chalk.bold(site)}\n`);
    for (const t of themes) {
      const tag = t.origin === 'cli' ? chalk.cyan('cli') : chalk.gray('   ');
      const active = t.active ? chalk.green(' (active)') : '';
      console.log(`  ${tag}  ${t.slug}  ${chalk.gray(`v${t.version}`)}${active}`);
    }
    console.log(chalk.gray('\n  "cli" = managed by noduscm (writable). Others are read-only from the CLI.\n'));
  } catch (err) {
    fail(err);
  }
}

export async function themeInitCommand(options) {
  try {
    if (!options.name) throw new Error('--name is required');
    const site = await resolveSite(options.site);
    const token = await requireToken(site);

    const spinner = ora('Creating theme on the site...').start();
    const created = await api(site, 'POST', '/themes', { token, body: { name: options.name } }).catch((err) => {
      spinner.fail('Could not create the theme');
      throw err;
    });

    const dir = path.resolve(options.dir || created.slug);
    if ((await fs.pathExists(dir)) && (await fs.readdir(dir)).length > 0) {
      spinner.fail(`Local folder ${dir} is not empty`);
      throw new Error(`Theme "${created.slug}" was created on the site, but ${dir} is not empty. Use: noduscm theme clone ${created.slug} --dir <empty-folder>`);
    }

    const ctx = { site, theme: created.slug };
    await fs.ensureDir(dir);
    await saveContext(dir, ctx);
    await pullTheme(dir, ctx, token, {});
    spinner.succeed(chalk.green(`Theme "${created.slug}" created`));

    console.log(`\n  Folder   ${dir}`);
    console.log(`  Preview  ${previewUrl(site, created.slug)}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function themeCloneCommand(slug, options) {
  try {
    const site = await resolveSite(options.site);
    const token = await requireToken(site);
    const dir = path.resolve(options.dir || slug);

    if ((await fs.pathExists(dir)) && (await fs.readdir(dir)).length > 0) {
      throw new Error(`${dir} is not empty`);
    }

    const ctx = { site, theme: slug };
    await fs.ensureDir(dir);
    await saveContext(dir, ctx);
    const spinner = ora('Downloading theme...').start();
    const s = await pullTheme(dir, ctx, token, {}).catch((err) => {
      spinner.fail('Download failed');
      throw err;
    });
    spinner.succeed(chalk.green(`Cloned "${slug}" (${s.downloaded} files) into ${dir}`));
  } catch (err) {
    fail(err);
  }
}

export async function themePushCommand(options) {
  try {
    const { dir, ctx, token } = await contextFor(options);
    const spinner = ora(options.dryRun ? 'Comparing...' : 'Pushing...').start();
    const s = await pushTheme(dir, ctx, token, {
      del: options.delete,
      dryRun: options.dryRun,
      force: options.force,
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
    printSummary('push', s);
    if (!options.delete) console.log(chalk.gray('  (files only on the server are kept; use --delete to remove them)'));
    console.log();
  } catch (err) {
    fail(err);
  }
}

export async function themePullCommand(options) {
  try {
    const { dir, ctx, token } = await contextFor(options);
    const spinner = ora(options.dryRun ? 'Comparing...' : 'Pulling...').start();
    const s = await pullTheme(dir, ctx, token, {
      del: options.delete,
      dryRun: options.dryRun,
      force: options.force,
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
    printSummary('pull', s);
    console.log();
  } catch (err) {
    fail(err);
  }
}

export async function themeDevCommand(options) {
  try {
    const { dir, ctx, token } = await contextFor(options);
    const rules = compileIgnore(); // el ignore de usuario se aplica al construir el manifiesto

    console.log(chalk.bold(`\nWatching ${dir}`));
    console.log(`Preview: ${chalk.cyan(previewUrl(ctx.site, ctx.theme))}\n`);

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
