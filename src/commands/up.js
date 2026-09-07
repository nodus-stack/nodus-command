import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, getProjectPaths } from '../lib/config.js';
import { containerUp, containerExec } from '../lib/container.js';
import fs from 'fs-extra';
import { generateDockerCompose, generateApacheConfig } from '../lib/templates.js';
import pullCommand from './pull.js';
import { getLocalSiteUrl } from '../lib/wordpress.js';
import { ensureDomainInHosts, getHostsFilePathForCurrentOs } from '../lib/hosts.js';
import { ensureLocalHttpsCertificate } from '../lib/certs.js';

function shellEscape(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

function sqlEscape(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function sqlIdentifier(value) {
  return `\`${String(value ?? '').replace(/`/g, '``')}\``;
}

async function waitForMysqlReady(config, containerName, attempts = 24, delayMs = 2500) {
  const rootPassword = config.database.rootPassword || 'root';

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await containerExec(
        config.engine,
        containerName,
        `MYSQL_PWD=${shellEscape(rootPassword)} mysqladmin -h127.0.0.1 -uroot ping >/dev/null 2>&1`,
        { stdio: 'pipe' }
      );
      return true;
    } catch {
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return false;
}

export default async function upCommand() {
  try {
    const config = await loadConfig();
    const paths = getProjectPaths();
    const spinner = ora('Starting NodusCommand...').start();

    if (config.autoManageHosts !== false) {
      spinner.text = `Checking hosts entry for ${config.domain}...`;
      const hostsResult = await ensureDomainInHosts(config.domain, { prompt: true });

      if (hostsResult.changed) {
        spinner.succeed(chalk.green(`Hosts entry added for ${config.domain}`));
        spinner.start('Starting NodusCommand...');
      } else if (hostsResult.reason === 'user-declined') {
        spinner.warn(chalk.yellow(`Hosts entry skipped. If ${config.domain} does not resolve, add it to ${getHostsFilePathForCurrentOs()}`));
        spinner.start('Starting NodusCommand...');
      }
    }

    if (config.localHttps) {
      spinner.stop();
      console.log(chalk.cyan(`\n  Ensuring trusted HTTPS certificate for ${config.domain}...\n`));
      await ensureLocalHttpsCertificate({
        domain: config.domain,
        projectPath: process.cwd(),
        prompt: true
      });
      spinner.start('Continuing startup...');
    }
    
    // Regenerate docker-compose from current config (mounts, db mode, engine, etc.)
    spinner.text = 'Generating docker-compose from config...';
    await generateDockerCompose(config, process.cwd(), config.engine);

    spinner.text = 'Generating apache.conf from config...';
    await generateApacheConfig(config, process.cwd());

    if (!await fs.pathExists(paths.dockerCompose)) {
      spinner.fail(chalk.red('docker-compose.yml not found after generation'));
      console.log(chalk.yellow('\n  Verify your .noduscm.json and run again\n'));
      return;
    }

    const hasWordPress = await fs.pathExists(paths.wordpress);
    const hasWpContent = await fs.pathExists(paths.wpContent);

    if ((!hasWordPress || !hasWpContent) && config.ssh) {
      spinner.stop();
      console.log(chalk.cyan('\n  Missing wordpress/ or wp-content/. Bootstrapping files from remote...\n'));
      await pullCommand({ filesOnly: true, exclude: [] });
      spinner.start('Continuing startup...');
    } else if (!hasWordPress || !hasWpContent) {
      spinner.warn(chalk.yellow('wordpress/ or wp-content/ is missing and SSH is not configured'));
      console.log(chalk.yellow('  Run "noduscm init" or configure SSH and run "noduscm pull --files-only" first\n'));
      spinner.start('Continuing startup...');
    }
    
    // Start containers
    spinner.text = 'Starting containers...';
    spinner.stop();
    
    console.log(chalk.cyan('\n  Starting containers...\n'));
    await containerUp(config.engine, paths.dockerCompose, {
      build: Boolean(config.localHttps)
    });
    
    spinner.start('Waiting for services to be ready...');
    
    // Wait for MySQL to be ready (if local)
    if (config.database.type === 'local') {
      const mysqlContainer = `${config.slug}-mysql`;
      spinner.text = 'Waiting for MySQL readiness...';
      const mysqlReady = await waitForMysqlReady(config, mysqlContainer);

      if (!mysqlReady) {
        spinner.warn(chalk.yellow('MySQL is still starting. Wait a little and run "noduscm up" again.'));
      } else {
        spinner.text = 'Checking database credentials...';

        try {
          await containerExec(
            config.engine,
            mysqlContainer,
            `MYSQL_PWD=${shellEscape(config.database.password)} mysql -u${shellEscape(config.database.user)} -e ${shellEscape('SELECT 1;')} >/dev/null 2>&1`,
            { stdio: 'pipe' }
          );
        } catch (error) {
          spinner.text = 'Reconciling MySQL user from .noduscm.json...';

          try {
            const dbName = config.database.name;
            const dbUser = config.database.user;
            const dbPassword = config.database.password;
            const rootPassword = config.database.rootPassword || 'root';

            const sql = [
              `CREATE DATABASE IF NOT EXISTS ${sqlIdentifier(dbName)};`,
              `CREATE USER IF NOT EXISTS '${sqlEscape(dbUser)}'@'%' IDENTIFIED BY '${sqlEscape(dbPassword)}';`,
              `ALTER USER '${sqlEscape(dbUser)}'@'%' IDENTIFIED BY '${sqlEscape(dbPassword)}';`,
              `GRANT ALL PRIVILEGES ON ${sqlIdentifier(dbName)}.* TO '${sqlEscape(dbUser)}'@'%';`,
              'FLUSH PRIVILEGES;'
            ].join(' ');

            await containerExec(
              config.engine,
              mysqlContainer,
              `MYSQL_PWD=${shellEscape(rootPassword)} mysql -uroot -e ${shellEscape(sql)} >/dev/null 2>&1`,
              { stdio: 'pipe' }
            );

            await containerExec(
              config.engine,
              mysqlContainer,
              `MYSQL_PWD=${shellEscape(dbPassword)} mysql -u${shellEscape(dbUser)} -e ${shellEscape('SELECT 1;')} >/dev/null 2>&1`,
              { stdio: 'pipe' }
            );
          } catch (reconcileError) {
            spinner.warn(chalk.yellow('Database credential reconciliation failed. Check DB user/password and run again.'));
          }
        }
      }
    }
    
    spinner.succeed(chalk.green('NodusCommand is running!'));
    
    // Show URLs
    console.log(chalk.bold('\n  🎉 Your WordPress site is ready!\n'));
    console.log(chalk.cyan('  URLs:\n'));
    
    const localUrl = getLocalSiteUrl({
      domain: config.domain,
      engine: config.engine,
      localApachePort: config.localApachePort,
      localHttps: config.localHttps,
      localHttpsPort: config.localHttpsPort
    });

    console.log(`    Local:        ${chalk.white(localUrl)}`);
    console.log(`    Admin:        ${chalk.white(localUrl + '/wp-admin')}`);
    
    if (config.database.type === 'local') {
      console.log(`    Database:     ${chalk.white(`localhost:${config.localMysqlPort}`)}`);
    }
    
    // Show Traefik dashboard if using it (only for Docker with Traefik)
    if (config.engine === 'docker' && process.platform !== 'win32') {
      console.log(`    Traefik:      ${chalk.gray('http://localhost:8080')}`);
    } else if (config.engine === 'podman') {
      console.log(`    Traefik:      ${chalk.gray('http://localhost:8081')} (if enabled)`);
    }
    
    console.log('');
    console.log(chalk.gray('  Press Ctrl+C to stop (or use "noduscm down")'));
    console.log('');
    
  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
    process.exit(1);
  }
}