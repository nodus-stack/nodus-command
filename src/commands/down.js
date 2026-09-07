import { execa } from 'execa';
import { getProjectPaths, loadConfig } from '../lib/config.js';
import chalk from 'chalk';

export default async function downCommand() {
  try {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const paths = getProjectPaths(projectPath);

    await execa(config.engine, ['compose', 'down'], {
      cwd: paths.projectRoot,
      stdio: 'inherit'
    });

    console.log(chalk.green('\n✅ Project stopped successfully\n'));
  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
  }
}