import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadTemplate(templateName) {
  const templatePath = path.join(__dirname, '..', 'templates', templateName);
  return await fs.readFile(templatePath, 'utf8');
}

export function replaceVariables(template, variables) {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.split(placeholder).join(value);
  }

  return result;
}

function buildExtraVolumesYaml(mounts = []) {
  if (!Array.isArray(mounts) || mounts.length === 0) {
    return '';
  }

  return mounts
    .map((mount) => `      - ${String(mount).trim()}`)
    .join('\n');
}

function escapeYamlSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function buildApacheExtraEnvYaml(env = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return '';
  }

  const entries = Object.entries(env).filter(([key, value]) => {
    return typeof key === 'string' && key.trim() !== '' && value !== undefined;
  });

  if (entries.length === 0) {
    return '';
  }

  return entries
    .map(([key, value]) => {
      const normalizedKey = key.trim();
      const normalizedValue = value === null ? '' : String(value);
      const envPair = `${normalizedKey}=${normalizedValue}`;
      return `      - '${escapeYamlSingleQuoted(envPair)}'`;
    })
    .join('\n');
}

function buildApachePortBindingsYaml({ localApachePort = 8080, localHttps = false, localHttpsPort = 8443 } = {}) {
  const lines = [`      - "${localApachePort}:80"`];

  if (localHttps) {
    lines.push(`      - "${localHttpsPort}:443"`);
  }

  return lines.join('\n');
}

function buildMysqlPortBindingYaml(localMysqlPort = 3306) {
  return `      - "${localMysqlPort}:3306"`;
}

export const DEFAULT_PHP_INI = {
  'memory_limit': '512M',
  'max_execution_time': 300,
  'max_input_time': 300,
  'max_input_vars': 3000,
  'upload_max_filesize': '64M',
  'post_max_size': '64M',
  'file_uploads': 'On',
  'display_errors': 'On',
  'log_errors': 'On',
  'error_reporting': 'E_ALL',
  'expose_php': 'Off',
  'zlib.output_compression': 'Off',
  'allow_url_fopen': 'On'
};

function buildPhpIniVolumeYaml() {
  return '      - ./php.ini:/usr/local/etc/php/conf.d/custom.ini:z';
}

function buildApacheHttpsCertVolumeYaml(localHttps = false) {
  if (!localHttps) {
    return '';
  }

  return '      - ./certs:/etc/apache2/ssl:ro,z';
}

function buildApacheHttpRedirectBlock(domain, localHttps = false, localHttpsPort = 8443) {
  if (!localHttps) {
    return '';
  }

  const normalizedDomain = String(domain || 'localhost').trim() || 'localhost';

  return `
    RewriteEngine On
    RewriteCond %{HTTPS} !=on
    RewriteRule ^ https://${normalizedDomain}:${localHttpsPort}%{REQUEST_URI} [L,R=301]`;
}

function buildApacheHttpsVhost(domain, localHttps = false) {
  if (!localHttps) {
    return '';
  }

  return `

<VirtualHost *:443>
    ServerName ${domain}
    ServerAlias localhost
    DocumentRoot /var/www/html

    SSLEngine on
    SSLCertificateFile /etc/apache2/ssl/local.crt
    SSLCertificateKeyFile /etc/apache2/ssl/local.key

    <Directory /var/www/html>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
        RewriteEngine On
        RewriteBase /
    </Directory>

    ErrorLog \${APACHE_LOG_DIR}/error-ssl.log
    CustomLog \${APACHE_LOG_DIR}/access-ssl.log combined
</VirtualHost>`;
}

export async function generateDockerCompose(config, projectPath, engine) {
  const useRemoteDb = config.database.type === 'remote';
  const isPodman = engine === 'podman';
  const isWindows = process.platform === 'win32';
  const localHttps = Boolean(config.localHttps);
  const localApachePort = Number(config.localApachePort) || 8080;
  const localMysqlPort = Number(config.localMysqlPort) || 3306;
  const localHttpsPort = Number(config.localHttpsPort) || 8443;

  let templateName = 'docker-compose.yml';

  // En Windows, usa template sin Traefik
  if (isWindows) {
    templateName = 'docker-compose-windows.yml';
  } 
  // Para Podman, usa template simple sin Traefik (más confiable)
  else if (isPodman && !useRemoteDb) {
    templateName = 'docker-compose-podman-simple.yml';
  }
  // Si usa Podman con DB remota
  else if (isPodman && useRemoteDb) {
    templateName = 'docker-compose-remote-db.yml';
  }
  // Para remote DB con Docker
  else if (useRemoteDb) {
    templateName = 'docker-compose-remote-db.yml';
  }

  const template = await loadTemplate(templateName);

  const variables = {
    PROJECT_SLUG: config.slug,
    DOMAIN: config.domain,
    LOCAL_HTTPS: localHttps ? 'true' : 'false',
    DB_HOST: useRemoteDb ? config.database.remote.host : `${config.slug}-mysql`,
    DB_NAME: config.database.name,
    DB_USER: config.database.user,
    DB_PASSWORD: config.database.password,
    MYSQL_ROOT_PASSWORD: config.database.rootPassword || 'root',
    APACHE_EXTRA_VOLUMES: buildExtraVolumesYaml(config.mounts),
    APACHE_EXTRA_ENV: buildApacheExtraEnvYaml(config.env),
    APACHE_HTTPS_CERT_VOLUME: buildApacheHttpsCertVolumeYaml(localHttps),
    PHP_INI_VOLUME: buildPhpIniVolumeYaml(),
    APACHE_PORT_BINDINGS: buildApachePortBindingsYaml({ localApachePort, localHttps, localHttpsPort }),
    MYSQL_PORT_BINDING: buildMysqlPortBindingYaml(localMysqlPort)
  };

  const content = replaceVariables(template, variables);
  const outputPath = path.join(projectPath, 'docker-compose.yml');

  await fs.writeFile(outputPath, content);
  return outputPath;
}

export async function generateApacheConfig(config, projectPath) {
  const template = await loadTemplate('apache.conf');
  const localHttps = Boolean(config.localHttps);
  const localHttpsPort = Number(config.localHttpsPort) || 8443;

  const variables = {
    DOMAIN: config.domain,
    APACHE_HTTP_REDIRECT_TO_HTTPS: buildApacheHttpRedirectBlock(config.domain, localHttps, localHttpsPort),
    APACHE_HTTPS_VHOST: buildApacheHttpsVhost(config.domain, localHttps)
  };

  const content = replaceVariables(template, variables);
  const outputPath = path.join(projectPath, 'apache.conf');

  if (await fs.pathExists(outputPath)) {
    const stats = await fs.stat(outputPath);
    if (stats.isDirectory()) {
      await fs.remove(outputPath);
    }
  }

  await fs.writeFile(outputPath, content);
  return outputPath;
}

export async function generatePhpIni(config, projectPath) {
  const phpIni = (config.phpIni && typeof config.phpIni === 'object' && Object.keys(config.phpIni).length > 0)
    ? config.phpIni
    : DEFAULT_PHP_INI;

  const lines = [
    '; Generated by NodusCommand',
    '; To customize: edit the phpIni section in .noduscm.json and run noduscm generate',
    ''
  ];

  for (const [key, value] of Object.entries(phpIni)) {
    lines.push(`${key} = ${value}`);
  }

  const content = lines.join('\n') + '\n';
  const outputPath = path.join(projectPath, 'php.ini');
  await fs.writeFile(outputPath, content);
  return outputPath;
}

export async function generateDockerfile(projectPath) {
  const template = await loadTemplate('Dockerfile.apache');
  const outputPath = path.join(projectPath, 'Dockerfile.apache');
  await fs.writeFile(outputPath, template);
  return outputPath;
}