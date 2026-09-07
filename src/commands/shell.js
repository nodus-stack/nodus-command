import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { containerShell } from '../lib/container.js';

export default async function shellCommand(options = {}) {
  try {
    const config = await loadConfig();
    const apacheContainer = `${config.slug}-apache`;
    const user = options.root ? 'root' : 'webuser';

    console.log('');
    console.log(chalk.gray(`  Connecting to ${chalk.white(apacheContainer)} as ${chalk.cyan(user)}...`));
    console.log(chalk.gray('  Type "exit" to disconnect\n'));

    await containerShell(config.engine, apacheContainer, { user });

  } catch (error) {
    if (error.exitCode !== undefined) return; // user typed exit — normal
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}
