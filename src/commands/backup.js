import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { loadConfig, getProjectPaths } from '../lib/config.js';
import { containerExec } from '../lib/container.js';
import inquirer from 'inquirer';

export default async function backupCommand(options) {
  try {
    const config = await loadConfig();
    const paths = getProjectPaths();
    
    // Check if using local database
    if (config.database.type !== 'local') {
      console.log(chalk.yellow('\n  Backup is only available for local databases\n'));
      return;
    }
    
    // If subcommand is list
    if (options && options._name === 'backup:list') {
      await listBackups(paths);
      return;
    }
    
    // If subcommand is restore
    if (options && options._name === 'backup:restore') {
      await restoreBackup(paths, config);
      return;
    }
    
    // Create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `backup-${timestamp}.sql`;
    const backupPath = path.join(paths.backups, backupFile);
    
    const spinner = ora('Creating database backup...').start();
    
    await fs.ensureDir(paths.backups);
    
    try {
      // Export database from container
      const result = await containerExec(
        config.engine,
        `${config.slug}-mysql`,
        `mysqldump -u${config.database.user} -p${config.database.password} ${config.database.name}`
      );
      
      // Save to file
      await fs.writeFile(backupPath, result.stdout);
      
      const stats = await fs.stat(backupPath);
      const size = (stats.size / 1024).toFixed(2) + ' KB';
      
      spinner.succeed(chalk.green('Backup created successfully!'));
      
      console.log(chalk.bold('\n  📦 Backup Information\n'));
      console.log(`    File:     ${chalk.white(backupFile)}`);
      console.log(`    Size:     ${chalk.white(size)}`);
      console.log(`    Location: ${chalk.gray(backupPath)}`);
      console.log('');
      
    } catch (error) {
      spinner.fail(chalk.red('Backup failed'));
      throw error;
    }
    
  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
    process.exit(1);
  }
}

async function listBackups(paths) {
  try {
    const backupFiles = await fs.readdir(paths.backups);
    const sqlFiles = backupFiles.filter(f => f.endsWith('.sql'));
    
    if (sqlFiles.length === 0) {
      console.log(chalk.yellow('\n  No backups found\n'));
      return;
    }
    
    console.log(chalk.bold('\n  📦 Available Backups\n'));
    
    for (const file of sqlFiles.sort().reverse()) {
      const filePath = path.join(paths.backups, file);
      const stats = await fs.stat(filePath);
      const size = (stats.size / 1024).toFixed(2) + ' KB';
      const date = new Date(stats.mtime).toLocaleString();
      
      console.log(`    ${chalk.cyan(file)}`);
      console.log(`      Date: ${chalk.gray(date)}  Size: ${chalk.gray(size)}`);
      console.log('');
    }
    
  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
  }
}

async function restoreBackup(paths, config) {
  try {
    const backupFiles = await fs.readdir(paths.backups);
    const sqlFiles = backupFiles.filter(f => f.endsWith('.sql'));
    
    if (sqlFiles.length === 0) {
      console.log(chalk.yellow('\n  No backups found\n'));
      return;
    }
    
    const choices = [];
    for (const file of sqlFiles.sort().reverse()) {
      const filePath = path.join(paths.backups, file);
      const stats = await fs.stat(filePath);
      const size = (stats.size / 1024).toFixed(2) + ' KB';
      const date = new Date(stats.mtime).toLocaleString();
      
      choices.push({
        name: `${file} - ${date} (${size})`,
        value: file
      });
    }
    
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'backup',
        message: 'Select backup to restore:',
        choices: choices
      },
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow('This will replace your current database. Continue?'),
        default: false
      }
    ]);
    
    if (!answer.confirm) {
      console.log(chalk.yellow('\n  Restore cancelled\n'));
      return;
    }
    
    const spinner = ora('Restoring backup...').start();
    
    const backupPath = path.join(paths.backups, answer.backup);
    const backupContent = await fs.readFile(backupPath, 'utf8');
    
    // Write to temp file accessible by container
    const tempPath = path.join(paths.root, 'temp-restore.sql');
    await fs.writeFile(tempPath, backupContent);
    
    // Import to database
    await containerExec(
      config.engine,
      `${config.slug}-mysql`,
      `mysql -u${config.database.user} -p${config.database.password} ${config.database.name} < /var/lib/mysql/../../temp-restore.sql`
    );
    
    // Clean up
    await fs.remove(tempPath);
    
    spinner.succeed(chalk.green('Backup restored successfully!'));
    console.log('');
    
  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
  }
}