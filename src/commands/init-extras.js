import fs from 'fs-extra';
import path from 'path';

const DEFAULT_HTACCESS = [
  '# BEGIN WordPress',
  '<IfModule mod_rewrite.c>',
  'RewriteEngine On',
  'RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]',
  'RewriteBase /',
  'RewriteRule ^index\\.php$ - [L]',
  'RewriteCond %{REQUEST_FILENAME} !-f',
  'RewriteCond %{REQUEST_FILENAME} !-d',
  'RewriteRule . /index.php [L]',
  '</IfModule>',
  '# END WordPress',
  ''
].join('\n');

/**
 * The project's ./wp-content is mounted over wordpress/wp-content inside the
 * container, so a fresh wp-content must get the default theme(s) copied in or
 * the site ends up with no theme at all. Does nothing if a theme already exists.
 */
export async function seedDefaultThemes(wpContentPath, wordpressPath) {
  const target = path.join(wpContentPath, 'themes');
  const source = path.join(wordpressPath, 'wp-content', 'themes');
  await fs.ensureDir(target);
  const hasTheme = (await fs.readdir(target, { withFileTypes: true })).some((e) => e.isDirectory());
  if (hasTheme || !(await fs.pathExists(source))) return [];
  const copied = [];
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await fs.copy(path.join(source, entry.name), path.join(target, entry.name));
    copied.push(entry.name);
  }
  return copied;
}

/** Pretty permalinks (and /wp-json) need the standard .htaccess. Never overwrites. */
export async function ensureHtaccess(wordpressPath) {
  const file = path.join(wordpressPath, '.htaccess');
  if (await fs.pathExists(file)) return false;
  await fs.writeFile(file, DEFAULT_HTACCESS);
  return true;
}

const DEFINE_RE = /^\s*define\s*\(\s*['"]([A-Za-z0-9_]+)['"].*\)\s*;\s*$/;

/**
 * `generate` rewrites wp-config.php. Keep the single-line define() calls the
 * user added by hand (constants the generator does not emit itself).
 */
export function preserveCustomDefines(existingContent, generatedContent) {
  if (!existingContent) return generatedContent;
  const generatedKeys = new Set();
  for (const line of generatedContent.split('\n')) {
    const m = line.match(DEFINE_RE);
    if (m) generatedKeys.add(m[1]);
  }
  const custom = [];
  for (const line of existingContent.split('\n')) {
    const m = line.match(DEFINE_RE);
    if (m && !generatedKeys.has(m[1])) custom.push(line.trim());
  }
  if (!custom.length) return generatedContent;
  const marker = '// Table prefix';
  const block = '// Custom settings (preserved by noduscm generate)\n' + custom.join('\n') + '\n\n';
  const idx = generatedContent.indexOf(marker);
  if (idx === -1) return generatedContent + '\n' + block;
  return generatedContent.slice(0, idx) + block + generatedContent.slice(idx);
}
