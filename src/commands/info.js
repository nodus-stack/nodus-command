import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { getLocalSiteUrl } from '../lib/wordpress.js';

function row(label, value, valueColor = chalk.white) {
  const paddedLabel = label.padEnd(20);
  console.log(`  ${chalk.gray(paddedLabel)} ${valueColor(value)}`);
}

function section(title) {
  console.log('');
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log(chalk.gray('  ' + '─'.repeat(40)));
}

export default async function infoCommand() {
  try {
    const config = await loadConfig();

    const localUrl = getLocalSiteUrl({
      domain: config.domain,
      engine: config.engine,
      localApachePort: config.localApachePort,
      localHttps: config.localHttps,
      localHttpsPort: config.localHttpsPort
    });

    console.log('');
    console.log(chalk.bold(`  Project: ${chalk.white(config.name)}`));

    // ── Project ──────────────────────────────────────────
    section('Project');
    row('Name',        config.name);
    row('Slug',        config.slug);
    row('WordPress',   config.wpVersion || '—');
    row('Engine',      config.engine || '—');
    row('Created',     config.createdAt ? new Date(config.createdAt).toLocaleString() : '—', chalk.gray);

    // ── Local URL ─────────────────────────────────────────
    section('Local URL');
    if (config.localHttps) {
      row('HTTP',   `http://${config.domain}:${config.localApachePort}`, chalk.gray);
      row('HTTPS',  localUrl, chalk.green);
      row('SSL',    'Self-signed certificate', chalk.yellow);
    } else {
      row('URL',    localUrl, chalk.green);
      row('SSL',    'Disabled', chalk.gray);
    }

    // ── Local Database ────────────────────────────────────
    section('Local Database');
    if (config.database) {
      const db = config.database;
      row('Name',     db.name  || '—');
      row('User',     db.user  || '—');
      row('Password', db.password ? '••••••••' : '—', chalk.gray);
      row('Host',     db.host  || '—');
      row('Port',     String(config.localMysqlPort || 3306));
    } else {
      console.log(chalk.gray('  No local database configured'));
    }

    // ── Remote Database ───────────────────────────────────
    if (config.ssh?.database) {
      section('Remote Database');
      const rdb = config.ssh.database;
      row('Name',     rdb.name     || '—');
      row('User',     rdb.user     || '—');
      row('Password', rdb.password ? '••••••••' : '—', chalk.gray);
      row('Host',     rdb.host     || 'localhost');
    }

    // ── SSH ───────────────────────────────────────────────
    if (config.ssh) {
      section('SSH');
      const ssh = config.ssh;
      row('Host',     ssh.host || '—');
      row('User',     ssh.user || '—');
      row('Port',     String(ssh.port || 22));
      row('Auth',     ssh.authType === 'password' ? 'Password' : `Key file: ${ssh.keyFile}`);
      row('Remote path', ssh.remotePath || '—');
    }

    // ── Ports ─────────────────────────────────────────────
    section('Ports');
    row('Apache (HTTP)',  String(config.localApachePort  || 8080));
    row('MySQL',          String(config.localMysqlPort   || 3306));
    if (config.localHttps) {
      row('Apache (HTTPS)', String(config.localHttpsPort || 8443));
    }

    console.log('');

  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}
