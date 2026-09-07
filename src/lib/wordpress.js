import { execa } from 'execa';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import * as tar from 'tar';

const streamPipeline = promisify(pipeline);

export async function downloadWordPress(version, destPath) {
  const spinner = ora(`Downloading WordPress ${version}...`).start();
  
  try {
    const wpUrl = `https://wordpress.org/wordpress-${version}.tar.gz`;
    const tmpFile = path.join(destPath, 'wordpress.tar.gz');
    
    await fs.ensureDir(destPath);
    
    // Download
    await new Promise((resolve, reject) => {
      https.get(wpUrl, (response) => {
        const fileStream = createWriteStream(tmpFile);
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
      }).on('error', reject);
    });
    
    spinner.text = 'Extracting WordPress...';
    
    // Extract
    await tar.x({
      file: tmpFile,
      cwd: destPath
    });
    
    // Clean up downloaded tar
    await fs.remove(tmpFile);
    
    // Clean wp-content (keep only default theme)
    const wpContentPath = path.join(destPath, 'wordpress', 'wp-content');
    const themesPath = path.join(wpContentPath, 'themes');
    const pluginsPath = path.join(wpContentPath, 'plugins');
    
    // Remove all plugins
    await fs.emptyDir(pluginsPath);
    await fs.writeFile(path.join(pluginsPath, 'index.php'), '<?php // Silence is golden');
    
    // Keep only latest default theme
    const themes = await fs.readdir(themesPath);
    const defaultThemes = themes.filter(t => t.startsWith('twenty'));
    const latestTheme = defaultThemes.sort().reverse()[0];
    
    for (const theme of themes) {
      if (theme !== latestTheme && theme !== 'index.php') {
        await fs.remove(path.join(themesPath, theme));
      }
    }
    
    spinner.succeed(chalk.green(`WordPress ${version} downloaded successfully`));
  } catch (error) {
    spinner.fail(chalk.red('Failed to download WordPress'));
    throw error;
  }
}

export function getLocalSiteUrl({
  domain,
  engine,
  platform = process.platform,
  localApachePort = 8080,
  localHttps = false,
  localHttpsPort = 8443
} = {}) {
  const isDirectLocalAccess = platform === 'win32' || engine === 'podman';
  const normalizedDomain = String(domain || 'localhost').trim() || 'localhost';

  if (isDirectLocalAccess) {
    if (localHttps) {
      return `https://${normalizedDomain}:${localHttpsPort}`;
    }

    return `http://${normalizedDomain}:${localApachePort}`;
  }

  return `http://${domain}`;
}

export async function generateWpConfig(dbConfig, projectName, localSiteUrl = null, tablePrefix = 'wp_') {
  const keys = await generateSalts();
  const normalizedLocalSiteUrl = localSiteUrl || 'http://localhost';
  
  return `<?php
/**
 * WordPress Configuration - NodusCommand
 * Project: ${projectName}
 */

// Database settings
define( 'DB_NAME', '${dbConfig.name}' );
define( 'DB_USER', '${dbConfig.user}' );
define( 'DB_PASSWORD', '${dbConfig.password}' );
define( 'DB_HOST', '${dbConfig.host}' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );

// Security keys
${keys}

// WordPress debugging
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
define( 'FS_METHOD', 'direct' );
define( 'WP_HOME', '${normalizedLocalSiteUrl}' );
define( 'WP_SITEURL', '${normalizedLocalSiteUrl}' );
define( 'FORCE_SSL_ADMIN', false );

// Table prefix
$table_prefix = '${tablePrefix}';

// Absolute path
if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}

require_once ABSPATH . 'wp-settings.php';
`;
}

async function generateSalts() {
  try {
    const response = await fetch('https://api.wordpress.org/secret-key/1.1/salt/');
    return await response.text();
  } catch {
    // Fallback to random strings if API fails
    const random = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    return `define('AUTH_KEY',         '${random()}');
define('SECURE_AUTH_KEY',  '${random()}');
define('LOGGED_IN_KEY',    '${random()}');
define('NONCE_KEY',        '${random()}');
define('AUTH_SALT',        '${random()}');
define('SECURE_AUTH_SALT', '${random()}');
define('LOGGED_IN_SALT',   '${random()}');
define('NONCE_SALT',       '${random()}');`;
  }
}