import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { loadConfig, getProjectPaths } from '../lib/config.js';
import { generateDockerCompose, generateDockerfile, generateApacheConfig, generatePhpIni } from '../lib/templates.js';
import { generateWpConfig, getLocalSiteUrl } from '../lib/wordpress.js';

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

export default async function generateCommand() {
  try {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const paths = getProjectPaths(projectPath);

    const spinner = ora('Generating Docker files from .noduscm.json...').start();

    spinner.text = 'Generating docker-compose.yml...';
    await generateDockerCompose(config, projectPath, config.engine);

    spinner.text = 'Generating apache.conf...';
    await generateApacheConfig(config, projectPath);

    spinner.text = 'Generating Dockerfile.apache...';
    await generateDockerfile(projectPath);

    spinner.text = 'Generating php.ini...';
    await generatePhpIni(config, projectPath);

    spinner.text = 'Generating wordpress/wp-config.php...';
    const projectName = config.name || config.slug || 'NodusCommand Project';
    const dbConfig = getDbConfigWithHost(config);
    const localSiteUrl = getLocalSiteUrl({
      domain: config.domain,
      engine: config.engine,
      localApachePort: config.localApachePort,
      localHttps: config.localHttps,
      localHttpsPort: config.localHttpsPort
    });
    const wpConfigContent = await generateWpConfig(dbConfig, projectName, localSiteUrl, config.tablePrefix || config.database?.tablePrefix || 'wp_');
    const wpConfigPath = path.join(paths.wordpress, 'wp-config.php');
    await fs.ensureDir(paths.wordpress);
    await fs.writeFile(wpConfigPath, wpConfigContent);

    spinner.succeed(chalk.green('Docker files generated successfully!'));

    console.log(chalk.bold('\n  ✅ Generated files\n'));
    console.log(`    ${chalk.white(paths.dockerCompose)}`);
    console.log(`    ${chalk.white(projectPath + '/apache.conf')}`);
    console.log(`    ${chalk.white(projectPath + '/Dockerfile.apache')}`);
    console.log(`    ${chalk.white(projectPath + '/php.ini')}`);
    console.log(`    ${chalk.white(wpConfigPath)}`);
    console.log('');
  } catch (error) {
    console.log(chalk.red('\n  ❌ Error: ' + error.message));
    process.exit(1);
  }
}
