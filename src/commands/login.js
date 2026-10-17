import chalk from 'chalk';
import inquirer from 'inquirer';
import os from 'os';
import ora from 'ora';
import { api } from '../lib/api.js';
import { loadAuth, normalizeSite, removeAuth, resolveSite, saveAuth } from '../lib/auth.js';

function fail(err) {
  console.log(chalk.red(`\n❌ ${err.message}\n`));
  process.exitCode = 1;
}

export async function loginCommand(options) {
  try {
    const site = normalizeSite(options.site);
    let code = options.code;

    if (!code) {
      console.log(chalk.gray(`Open ${site}/wp-admin → Nodus Jet → CLI and generate a pairing code.\n`));
      ({ code } = await inquirer.prompt([
        { type: 'password', name: 'code', mask: '*', message: 'Pairing code:' },
      ]));
    }

    const spinner = ora('Pairing...').start();
    let result;
    try {
      result = await api(site, 'POST', '/auth/pair', {
        body: { code: String(code).trim(), label: options.label || os.hostname() },
      });
    } catch (err) {
      spinner.fail('Pairing failed');
      throw err;
    }

    await saveAuth(site, { token: result.token });
    spinner.succeed(chalk.green(`Logged in to ${site}`));
    console.log(chalk.gray(`Session valid for ${Math.round(result.expires_in / 3600)} h of inactivity.\n`));
  } catch (err) {
    fail(err);
  }
}

export async function logoutCommand(options) {
  try {
    const site = await resolveSite(options.site);
    const auth = await loadAuth(site);

    if (auth?.token) {
      // Revocar en el servidor; si falla igual borramos la sesión local.
      await api(site, 'POST', '/auth/logout', { token: auth.token }).catch(() => {});
    }

    const removed = await removeAuth(site);
    console.log(removed ? chalk.green(`\n✔ Logged out of ${site}\n`) : chalk.yellow(`\nNo session for ${site}\n`));
  } catch (err) {
    fail(err);
  }
}

export async function whoamiCommand(options) {
  try {
    const site = await resolveSite(options.site);
    const auth = await loadAuth(site);
    if (!auth?.token) throw new Error(`Not logged in to ${site}. Run: noduscm login --site ${site}`);

    const info = await api(site, 'GET', '/auth/whoami', { token: auth.token });
    console.log(`\n${chalk.bold('Site')}      ${info.site}`);
    console.log(`${chalk.bold('User')}      ${info.user}`);
    console.log(`${chalk.bold('Plugin')}    Nodus Jet ${info.plugin_version}`);
    console.log(`${chalk.bold('Expires')}   ${info.expires_at}\n`);
  } catch (err) {
    fail(err);
  }
}
