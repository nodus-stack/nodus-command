import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

export const CONFIG_FILE = '.noduscm.json';

export async function saveConfig(projectPath, config) {
  const configPath = path.join(projectPath, CONFIG_FILE);
  await fs.writeJson(configPath, config, { spaces: 2 });
}

export async function loadConfig() {
  const projectPath = process.cwd();
  const configPath = path.join(projectPath, '.noduscm.json');

  if (!await fs.pathExists(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const config = await fs.readJson(configPath);

  config.localApachePort = Number(config.localApachePort) || 8080;
  config.localMysqlPort = Number(config.localMysqlPort) || 3306;
  config.localHttps = Boolean(config.localHttps);
  config.localHttpsPort = Number(config.localHttpsPort) || 8443;
  config.autoManageHosts = config.autoManageHosts !== false;

  return config;
}


export async function projectExists(projectPath = process.cwd()) {
  const configPath = path.join(projectPath, CONFIG_FILE);
  return await fs.pathExists(configPath);
}

export function getProjectPaths(projectPath = process.cwd()) {
  return {
    root: projectPath,
    wpContent: path.join(projectPath, 'wp-content'),
    wordpress: path.join(projectPath, 'wordpress'),
    config: path.join(projectPath, CONFIG_FILE),
    dockerCompose: path.join(projectPath, 'docker-compose.yml'),
    backups: path.join(projectPath, '.noduscm', 'backups'),
    noduscm: path.join(projectPath, '.noduscm')
  };
}
