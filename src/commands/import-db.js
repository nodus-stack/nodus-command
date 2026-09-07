import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { loadConfig } from '../lib/config.js';
import { containerExec } from '../lib/container.js';
import { getLocalSiteUrl } from '../lib/wordpress.js';

function shellEscape(value) {
  if (value === undefined || value === null) return "''";
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function sqlEscape(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function sqlIdentifier(value) {
  return `\`${String(value ?? '').replace(/`/g, '``')}\``;
}

export default async function importDbCommand(sqlFile, options = {}) {
  try {
    const config = await loadConfig();

    const resolvedPath = path.resolve(sqlFile);

    if (!(await fs.pathExists(resolvedPath))) {
      console.log(chalk.red(`\n❌ File not found: ${resolvedPath}\n`));
      process.exit(1);
    }

    if (!resolvedPath.endsWith('.sql')) {
      console.log(chalk.red('\n❌ File must be a .sql file\n'));
      process.exit(1);
    }

    const containerName = `${config.slug}-mysql`;
    const apacheContainerName = `${config.slug}-apache`;
    const remoteTmp = '/tmp/noduscm-import.sql';
    const force = Boolean(options.force);

    console.log(chalk.bold('\n📥 Importing database into local container\n'));
    console.log(`  File:      ${chalk.white(resolvedPath)}`);
    console.log(`  Container: ${chalk.white(containerName)}`);
    if (force) {
      console.log(`  Mode:      ${chalk.yellow('--force (drops existing tables first)')}`);
    }
    console.log('');

    const spinner = ora('Copying SQL file into container...').start();

    try {
      await execa(config.engine, ['cp', resolvedPath, `${containerName}:${remoteTmp}`]);
      spinner.succeed('SQL file copied to container');
    } catch (err) {
      spinner.fail('Failed to copy SQL file into container');
      throw err;
    }

    if (force) {
      spinner.start('Dropping and recreating local database...');
      try {
        const rootPassword = config.database.rootPassword || 'root';
        const dbName = config.database.name;
        const dbUser = config.database.user;
        const dbPassword = config.database.password;

        const sql = [
          `DROP DATABASE IF EXISTS ${sqlIdentifier(dbName)};`,
          `CREATE DATABASE ${sqlIdentifier(dbName)};`,
          `GRANT ALL PRIVILEGES ON ${sqlIdentifier(dbName)}.* TO '${sqlEscape(dbUser)}'@'%';`,
          'FLUSH PRIVILEGES;'
        ].join(' ');

        await containerExec(
          config.engine,
          containerName,
          `MYSQL_PWD=${shellEscape(rootPassword)} mysql -uroot -e ${shellEscape(sql)}`,
          { stdio: 'pipe' }
        );

        spinner.succeed('Database dropped and recreated');
      } catch (err) {
        spinner.fail('Failed to drop/recreate database (check database.rootPassword in .noduscm.json)');
        throw err;
      }
    }

    spinner.start('Importing database...');
    try {
      await execa(config.engine, [
        'exec',
        containerName,
        'sh', '-c',
        `grep -v -iE '^(USE|CREATE DATABASE|DROP DATABASE)' ${remoteTmp} | mysql -u${config.database.user} -p${config.database.password} ${config.database.name}`
      ], { stdio: 'inherit' });
      spinner.succeed(chalk.green('Database imported successfully'));
    } catch (err) {
      spinner.fail('Failed to import database');
      if (!force) {
        console.log(chalk.yellow('\n💡 Tip: if the target database already has tables (e.g. from a previous local install),\n   re-run with --force to drop and recreate it before importing.\n'));
      }
      throw err;
    }

    // Cleanup temp file inside container
    try {
      await execa(config.engine, ['exec', containerName, 'rm', '-f', remoteTmp]);
    } catch {
      // non-critical
    }

    if (force) {
      await fixLocalSiteUrl(config, apacheContainerName, spinner);
    }

    console.log(chalk.green('\n✅ Import completed successfully!\n'));

  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Tras un --force import, wp_options.siteurl/home (y cualquier URL
 * embebida en datos serializados) todavía apunta al dominio del dump
 * importado. WP_HOME/WP_SITEURL en wp-config.php ya fuerzan la carga
 * local sin esto, pero contenido/serialized data (imágenes, links, etc.)
 * se queda apuntando a producción si no se corre el search-replace.
 */
async function fixLocalSiteUrl(config, apacheContainerName, spinner) {
  spinner.start('Detecting site URL from imported dump...');

  let oldUrl;
  try {
    const { stdout } = await execa(config.engine, [
      'exec', apacheContainerName,
      // `wp option get siteurl` está enmascarado por las constantes
      // WP_HOME/WP_SITEURL de wp-config.php (WordPress las prioriza
      // sobre el valor real de la tabla) — siempre devolvería la URL
      // local, nunca la del dump importado. Hay que leer la fila cruda.
      'wp', 'eval', 'global $wpdb; echo $wpdb->get_var("SELECT option_value FROM " . $wpdb->prefix . "options WHERE option_name = \'siteurl\'");',
      '--allow-root'
    ]);
    oldUrl = String(stdout || '').trim();
  } catch (err) {
    spinner.warn('Could not read siteurl from imported database (wp-cli unavailable?) — skipping URL fix');
    return;
  }

  const newUrl = getLocalSiteUrl({
    domain: config.domain,
    engine: config.engine,
    localApachePort: config.localApachePort,
    localHttps: config.localHttps,
    localHttpsPort: config.localHttpsPort
  });

  if (!oldUrl || oldUrl === newUrl) {
    spinner.succeed('Site URL already matches local — nothing to replace');
    return;
  }

  spinner.text = `Replacing ${oldUrl} → ${newUrl} across all tables...`;
  try {
    await execa(config.engine, [
      'exec', apacheContainerName,
      'wp', 'search-replace', oldUrl, newUrl, '--all-tables', '--allow-root'
    ], { stdio: 'inherit' });
    spinner.succeed(chalk.green(`Site URL replaced: ${oldUrl} → ${newUrl}`));
  } catch (err) {
    spinner.warn('search-replace failed — site content may still reference the old domain');
  }
}
