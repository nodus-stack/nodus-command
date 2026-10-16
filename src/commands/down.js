import { getProjectPaths, loadConfig } from '../lib/config.js';
import { containerDown } from '../lib/container.js';
import chalk from 'chalk';

export default async function downCommand() {
  try {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const paths = getProjectPaths(projectPath);

    await containerDown(config.engine, paths.dockerCompose);

    console.log(chalk.green('\n✅ Project stopped successfully\n'));
  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}