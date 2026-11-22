import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const mod = await import(pathToFileURL(path.join(process.cwd(), 'src/commands/init-extras.js')).href);
const wp = await import(pathToFileURL(path.join(process.cwd(), 'src/lib/wordpress.js')).href);
const { seedDefaultThemes, ensureHtaccess, preserveCustomDefines } = mod;

let tmp;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-extras-')); });
afterEach(async () => { await fs.remove(tmp); });

describe('seedDefaultThemes', () => {
  it('copies the default themes into an empty wp-content', async () => {
    const wpDir = path.join(tmp, 'wordpress');
    await fs.outputFile(path.join(wpDir, 'wp-content/themes/twentytwentyfive/style.css'), 'x');
    await fs.outputFile(path.join(wpDir, 'wp-content/themes/index.php'), '<?php');
    const content = path.join(tmp, 'wp-content');
    await fs.ensureDir(content);
    const copied = await seedDefaultThemes(content, wpDir);
    expect(copied).toEqual(['twentytwentyfive']);
    expect(await fs.pathExists(path.join(content, 'themes/twentytwentyfive/style.css'))).toBe(true);
  });

  it('does not touch a wp-content that already has a theme', async () => {
    const wpDir = path.join(tmp, 'wordpress');
    await fs.outputFile(path.join(wpDir, 'wp-content/themes/twentytwentyfive/style.css'), 'x');
    const content = path.join(tmp, 'wp-content');
    await fs.outputFile(path.join(content, 'themes/mine/style.css'), 'mine');
    expect(await seedDefaultThemes(content, wpDir)).toEqual([]);
    expect(await fs.readdir(path.join(content, 'themes'))).toEqual(['mine']);
  });
});

describe('ensureHtaccess', () => {
  it('creates .htaccess once and never overwrites', async () => {
    expect(await ensureHtaccess(tmp)).toBe(true);
    const file = path.join(tmp, '.htaccess');
    expect(await fs.readFile(file, 'utf8')).toContain('RewriteRule . /index.php [L]');
    await fs.writeFile(file, 'custom');
    expect(await ensureHtaccess(tmp)).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe('custom');
  });
});

describe('wp-config', () => {
  const db = { name: 'db', user: 'u', password: 'p', host: 'mysql' };
  it('defines WP_ENVIRONMENT_TYPE exactly once', async () => {
    const out = await wp.generateWpConfig(db, 'x', 'http://localhost');
    expect(out.match(/WP_ENVIRONMENT_TYPE/g)).toHaveLength(1);
    expect(out).toContain("define( 'WP_ENVIRONMENT_TYPE', 'local' );");
  });

  it('preserveCustomDefines keeps user defines without duplicating generated ones', async () => {
    const generated = await wp.generateWpConfig(db, 'x', 'http://localhost');
    const existing = "<?php\ndefine( 'WP_ENVIRONMENT_TYPE', 'staging' );\ndefine( 'MY_FLAG', true );\n";
    const out = preserveCustomDefines(existing, generated);
    expect(out).toContain("define( 'MY_FLAG', true );");
    expect(out.match(/WP_ENVIRONMENT_TYPE/g)).toHaveLength(1);
    expect(out.indexOf('MY_FLAG')).toBeLessThan(out.indexOf('wp-settings.php'));
    expect(preserveCustomDefines(out, out)).toBe(out);
  });
});

describe('podman templates', () => {
  it.each(['docker-compose-podman.yml', 'docker-compose-podman-simple.yml'])('%s sets oom_score_adj on apache', async (f) => {
    const t = await fs.readFile(path.join(process.cwd(), 'src/templates', f), 'utf8');
    expect(t).toMatch(/container_name: \{\{PROJECT_SLUG\}\}-apache\n\s+oom_score_adj: 1000/);
  });
});
