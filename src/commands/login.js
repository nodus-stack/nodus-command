import chalk from 'chalk';
import inquirer from 'inquirer';
import os from 'os';
import ora from 'ora';
import { api } from '../lib/api.js';
import {
  listSiteSessions,
  loadAuth,
  normalizeSite,
  removeAuth,
  resolveSite,
  saveAuth,
} from '../lib/auth.js';
import { emitJson, fail, isJsonMode } from '../lib/output.js';

export async function loginCommand(options) {
  try {
    const json = isJsonMode();
    const site = normalizeSite(options.site);
    const label = options.label || os.hostname();
    let code = options.code;

    if (!code) {
      // En modo json nunca se promptea: falta de argumento → exit 50 (spec §3.4).
      if (json) {
        const err = new Error(`Pairing code required in JSON mode: pass --code <code> for ${site}`);
        err.code = 'validation';
        throw err;
      }
      console.log(chalk.gray(`Open ${site}/wp-admin → Nodus Jet → CLI and generate a pairing code.\n`));
      ({ code } = await inquirer.prompt([
        { type: 'password', name: 'code', mask: '*', message: 'Pairing code:' },
      ]));
    }

    const spinner = json ? null : ora('Pairing...').start();
    let result;
    try {
      result = await api(site, 'POST', '/auth/pair', {
        body: { code: String(code).trim(), label },
      });
    } catch (err) {
      if (spinner) spinner.fail('Pairing failed');
      throw err;
    }

    await saveAuth(site, { token: result.token, label });

    if (json) {
      const saved = await loadAuth(site);
      const expiresAt =
        result.expires_at ||
        (result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : null);
      emitJson({
        ok: true,
        code: 0,
        data: {
          site,
          label: saved?.label ?? label,
          expires_in: result.expires_in ?? null,
          expires_at: expiresAt,
          saved_at: saved?.savedAt ?? null,
        },
        error: null,
        message: `Logged in to ${site}`,
      });
      return;
    }

    spinner.succeed(chalk.green(`Logged in to ${site}`));
    console.log(chalk.gray(`Session valid for ${Math.round(result.expires_in / 3600)} h of inactivity.\n`));
  } catch (err) {
    fail(err);
  }
}

export async function logoutCommand(options) {
  try {
    const json = isJsonMode();
    const site = await resolveSite(options.site);
    const auth = await loadAuth(site);

    if (auth?.token) {
      // Revocar en el servidor; si falla igual borramos la sesión local.
      await api(site, 'POST', '/auth/logout', { token: auth.token }).catch(() => {});
    }

    const removed = await removeAuth(site);

    if (json) {
      emitJson({
        ok: true,
        code: 0,
        data: { site, removed },
        error: null,
        message: removed ? `Logged out of ${site}` : `No session for ${site}`,
      });
      return;
    }

    console.log(removed ? chalk.green(`\n✔ Logged out of ${site}\n`) : chalk.yellow(`\nNo session for ${site}\n`));
  } catch (err) {
    fail(err);
  }
}

export async function whoamiCommand(options) {
  try {
    const json = isJsonMode();
    const site = await resolveSite(options.site);
    const auth = await loadAuth(site);
    if (!auth?.token) {
      const err = new Error(`Not logged in to ${site}. Run: noduscm login --site ${site}`);
      err.code = 'not_authenticated';
      throw err;
    }

    const info = await api(site, 'GET', '/auth/whoami', { token: auth.token });

    if (json) {
      emitJson({
        ok: true,
        code: 0,
        data: {
          site: info.site || site,
          user: info.user ?? null,
          plugin_version: info.plugin_version ?? null,
          expires_at: info.expires_at ?? null,
          saved_at: auth.savedAt ?? null,
          label: auth.label ?? null,
        },
        error: null,
        message: `Session for ${site}`,
      });
      return;
    }

    console.log(`\n${chalk.bold('Site')}      ${info.site}`);
    console.log(`${chalk.bold('User')}      ${info.user}`);
    console.log(`${chalk.bold('Plugin')}    Nodus Jet ${info.plugin_version}`);
    console.log(`${chalk.bold('Expires')}   ${info.expires_at}\n`);
  } catch (err) {
    fail(err);
  }
}

/**
 * `noduscm sites` — lista las sesiones locales de auth.json. Sin red.
 * Nunca expone el token (solo `has_token`).
 */
export async function sitesCommand() {
  try {
    const sessions = await listSiteSessions();

    if (isJsonMode()) {
      emitJson({
        ok: true,
        code: 0,
        data: { sites: sessions },
        error: null,
        message: `${sessions.length} saved site session${sessions.length === 1 ? '' : 's'}`,
      });
      return;
    }

    if (sessions.length === 0) {
      console.log(chalk.gray('\nNo saved sessions. Run: noduscm login --site <url>\n'));
      return;
    }

    console.log(`\n${chalk.bold('Saved sessions')}\n`);
    for (const s of sessions) {
      const dot = s.has_token ? chalk.green('●') : chalk.gray('○');
      console.log(
        `  ${dot}  ${s.site}${s.label ? chalk.gray(`  ${s.label}`) : ''}${s.saved_at ? chalk.gray(`  ${s.saved_at}`) : ''}`,
      );
    }
    console.log('');
  } catch (err) {
    fail(err);
  }
}
