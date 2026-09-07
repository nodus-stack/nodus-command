import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { promptProjectInit } from '../ui/prompts.js';
import { showLogo } from '../ui/banner.js';
import { detectContainerEngine } from '../lib/container.js';
import { saveConfig, projectExists, getProjectPaths } from '../lib/config.js';
import { downloadWordPress, generateWpConfig, getLocalSiteUrl } from '../lib/wordpress.js';
import { generateDockerCompose, generateApacheConfig, generateDockerfile, generatePhpIni, DEFAULT_PHP_INI } from '../lib/templates.js';
import { testSSHConnection } from '../lib/ssh.js';
import { execa } from 'execa';

async function ensureWpContentStructure(wpContentPath) {
  if (await fs.pathExists(wpContentPath)) {
    return;
  }

  await fs.ensureDir(wpContentPath);
  await fs.ensureDir(path.join(wpContentPath, 'themes'));
  await fs.ensureDir(path.join(wpContentPath, 'plugins'));
  await fs.ensureDir(path.join(wpContentPath, 'uploads'));

  await fs.writeFile(path.join(wpContentPath, 'plugins', 'index.php'), '<?php // Silence is golden');
  await fs.writeFile(path.join(wpContentPath, 'uploads', 'index.php'), '<?php // Silence is golden');
}

export default async function initCommand(options = {}) {
  try {
    showLogo();

    // Check if project already exists
    if (await projectExists()) {
      console.log(chalk.red('\n  ❌ NodusCommand project already exists in this directory'));
      console.log(chalk.yellow('  Run this command in a new directory or remove the existing project first\n'));
      return;
    }

    // Detect container engine
    const engine = await detectContainerEngine();

    // Get project configuration
    const config = await promptProjectInit({
      mounts: options.mount || []
    });

    // Test SSH if configured
    if (config.ssh) {
      const sshValid = await testSSHConnection(config.ssh);
      if (!sshValid) {
        console.log(chalk.yellow('\n  ⚠️  SSH connection failed, but continuing anyway'));
        console.log(chalk.gray('  You can fix this later in .noduscm.json\n'));
      }
    }

    const projectPath = process.cwd();
    const paths = getProjectPaths(projectPath);

    // Create project structure
    const spinner = ora('Creating project structure...').start();

    await fs.ensureDir(paths.noduscm);
    await fs.ensureDir(paths.backups);

    if (config.isBlank) {
      // Download WordPress
      spinner.stop();
      await downloadWordPress(config.wpVersion, projectPath);
      spinner.start('Setting up WordPress...');

      // Create empty wp-content if needed
      await ensureWpContentStructure(paths.wpContent);
    } else {
      spinner.text = 'Downloading WordPress core...';
      await downloadWordPress(config.wpVersion, projectPath);
      spinner.text = 'Ensuring wp-content structure...';
      await ensureWpContentStructure(paths.wpContent);
    }

    // Generate wp-config.php
    spinner.text = 'Generating wp-config.php...';

    const localSiteUrl = getLocalSiteUrl({
      domain: config.domain,
      engine,
      localApachePort: config.localApachePort,
      localHttps: config.localHttps,
      localHttpsPort: config.localHttpsPort
    });
    const wpConfigContent = await generateWpConfig(config.database, config.projectName, localSiteUrl, config.tablePrefix || config.database?.tablePrefix || 'wp_');
    await fs.writeFile(path.join(paths.wordpress, 'wp-config.php'), wpConfigContent);

    // Generate docker-compose.yml
    spinner.text = 'Generating docker-compose.yml...';
    await generateDockerCompose(config, projectPath, engine);

    // Generate apache.conf
    spinner.text = 'Generating Apache configuration...';
    await generateApacheConfig(config, projectPath);

    // Generate Dockerfile
    spinner.text = 'Generating Dockerfile...';
    await generateDockerfile(projectPath);

    // Create Traefik network if it doesn't exist
    spinner.text = 'Setting up Traefik network...';
    try {
      await execa(engine, ['network', 'create', 'noduscm']);
    } catch (error) {
      // Network might already exist, that's fine
    }

    // Save configuration
    spinner.text = 'Saving configuration...';
    const fullConfig = {
      name: config.projectName,
      slug: config.slug,
      domain: config.domain,
      wpVersion: config.wpVersion,
      engine: engine,
      database: config.database,
      ssh: config.ssh,
      mounts: config.mounts || [],
      localApachePort: Number(config.localApachePort) || 8080,
      localMysqlPort: Number(config.localMysqlPort) || 3306,
      localHttps: Boolean(config.localHttps),
      localHttpsPort: Number(config.localHttpsPort) || 8443,
      autoManageHosts: config.autoManageHosts !== false,
      tablePrefix: config.tablePrefix || 'wp_',
      phpIni: { ...DEFAULT_PHP_INI },
      createdAt: new Date().toISOString()
    };

    await saveConfig(projectPath, fullConfig);

    spinner.text = 'Generating php.ini...';
    await generatePhpIni(fullConfig, projectPath);

    spinner.succeed(chalk.green('Project initialized successfully!'));

    // Show success message
    console.log(chalk.bold('\n  🎉 NodusCommand project is ready!\n'));
    console.log(chalk.cyan('  Next steps:\n'));
    console.log(`    ${chalk.white('noduscm up')}      Start the project`);
    console.log(`    ${chalk.white('noduscm down')}    Stop the project`);
    if (config.ssh) {
      console.log(`    ${chalk.white('noduscm pull')}    Sync from remote server`);
    }
    console.log('');
    const initialLocalUrl = getLocalSiteUrl({
      domain: config.domain,
      engine,
      localApachePort: config.localApachePort,
      localHttps: config.localHttps,
      localHttpsPort: config.localHttpsPort
    });
    console.log(chalk.gray(`  Your site will be available at: ${chalk.white(initialLocalUrl)}`));
    console.log('');

  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
    process.exit(1);
  }
}