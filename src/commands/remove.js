import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { loadConfig, getProjectPaths } from '../lib/config.js';
import { containerRemove } from '../lib/container.js';
import { confirmRemove } from '../ui/prompts.js';
import fs from 'fs-extra';

export default async function removeCommand() {
  try {
    const config = await loadConfig();
    const paths = getProjectPaths();
    
    // Ask for confirmation
    const confirmed = await confirmRemove(config.name);
    
    if (!confirmed) {
      console.log(chalk.yellow('\n  Removal cancelled\n'));
      return;
    }
    
    const spinner = ora('Removing NodusCommand project...').start();
    
    // Stop and remove containers
    if (await fs.pathExists(paths.dockerCompose)) {
      spinner.text = 'Removing containers and volumes...';
      spinner.stop();
      
      console.log(chalk.cyan('\n  Removing containers and volumes...\n'));
      
      await containerRemove(config.engine, paths.dockerCompose);
    }
    
    spinner.start('Cleaning up project files...');
    
    // Remove generated files
    const filesToRemove = [
      paths.dockerCompose,
      path.join(paths.root, 'apache.conf'),
      path.join(paths.root, 'Dockerfile.apache'),
      paths.noduscm,
      paths.config
    ];
    
    for (const file of filesToRemove) {
      if (await fs.pathExists(file)) {
        await fs.remove(file);
      }
    }
    
    spinner.succeed(chalk.green('Project removed successfully!'));
    
    console.log(chalk.yellow('\n  Note: WordPress core and wp-content were preserved'));
    console.log(chalk.gray('  Delete them manually if needed\n'));
    
  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
    process.exit(1);
  }
}