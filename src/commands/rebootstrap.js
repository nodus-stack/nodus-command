import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { loadConfig, getProjectPaths } from '../lib/config.js';
import { downloadWordPress, generateWpConfig, getLocalSiteUrl } from '../lib/wordpress.js';
import pullCommand from './pull.js';

async function ensureWpContentStructure(wpContentPath) {
  if (!await fs.pathExists(wpContentPath)) {
    await fs.ensureDir(wpContentPath);
  }

  await fs.ensureDir(path.join(wpContentPath, 'themes'));
  await fs.ensureDir(path.join(wpContentPath, 'plugins'));
  await fs.ensureDir(path.join(wpContentPath, 'uploads'));

  const pluginsIndex = path.join(wpContentPath, 'plugins', 'index.php');
  const uploadsIndex = path.join(wpContentPath, 'uploads', 'index.php');

  if (!await fs.pathExists(pluginsIndex)) {
    await fs.writeFile(pluginsIndex, '<?php // Silence is golden');
  }

  if (!await fs.pathExists(uploadsIndex)) {
    await fs.writeFile(uploadsIndex, '<?php // Silence is golden');
  }
}

function getDbConfigWithHost(config) {
  const dbConfig = { ...(config.database || {}) };

  if (!dbConfig.host) {
    if (dbConfig.type === 'local') {
      dbConfig.host = `${config.slug}-mysql`;
    } else {
      dbConfig.host = dbConfig.remote?.host || 'localhost';
    }
  }

  return dbConfig;
}

export default async function rebootstrapCommand(options = {}) {
  try {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const paths = getProjectPaths(projectPath);

    const hasWordPress = await fs.pathExists(paths.wordpress);
    const hasWpContent = await fs.pathExists(paths.wpContent);
    const shouldForce = Boolean(options.force);

    if (!shouldForce && hasWordPress && hasWpContent) {
      console.log(chalk.yellow('\n  ⚠️  wordpress/ and wp-content/ already exist'));
      console.log(chalk.gray('  Nothing to bootstrap. Use --force to rebuild both folders\n'));
      return;
    }

    const spinner = ora('Rebootstrapping project files...').start();

    if (shouldForce) {
      spinner.text = 'Removing existing wordpress/ and wp-content/...';
      await fs.remove(paths.wordpress);
      await fs.remove(paths.wpContent);
    }

    if (config.ssh) {
      spinner.stop();
      console.log(chalk.cyan('\n  Using SSH bootstrap (remote files)...\n'));
      await pullCommand({ filesOnly: true, exclude: [] });
      spinner.start('Ensuring wp-content structure...');
      await ensureWpContentStructure(paths.wpContent);
    } else {
      const wpVersion = config.wpVersion || '6.7';
      spinner.stop();
      await downloadWordPress(wpVersion, projectPath);
      spinner.start('Ensuring wp-content structure...');
      await ensureWpContentStructure(paths.wpContent);
    }

    spinner.text = 'Regenerating wp-config.php...';
    const projectName = config.name || config.slug || 'NodusCommand Project';
    const dbConfig = getDbConfigWithHost(config);
    const localSiteUrl = getLocalSiteUrl({
      domain: config.domain,
      engine: config.engine,
      localApachePort: config.localApachePort,
      localHttps: config.localHttps,
      localHttpsPort: config.localHttpsPort
    });
    const wpConfigContent = await generateWpConfig(dbConfig, projectName, localSiteUrl);
    await fs.writeFile(path.join(paths.wordpress, 'wp-config.php'), wpConfigContent);

    spinner.succeed(chalk.green('Rebootstrap completed successfully!'));
    console.log(chalk.green('\n✅ Project files are ready again (wordpress/ + wp-content/)\n'));
  } catch (error) {
    console.log(chalk.red(`\n  ❌ Error: ${error.message}`));
    process.exit(1);
  }
}
