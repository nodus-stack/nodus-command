import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { buildLocalManifest, compileIgnore, isIgnored, isSyncablePath, itemOf, loadContext, saveContext, sha1 } from '../src/lib/theme-sync.js';
import { normalizeSite } from '../src/lib/auth.js';

describe('isSyncablePath', () => {
  it('accepts normal theme files', () => {
    for (const p of ['style.css', 'functions.php', 'assets/js/app.js', 'templates/home.twig', 'img/logo.webp']) {
      expect(isSyncablePath(p)).toBe(true);
    }
  });

  it('accepts all development source files', () => {
    for (const p of [
      'src/App.jsx', 'src/index.tsx', 'src/main.ts', 'assets/scss/app.scss', 'src/Comp.vue', 'webpack.config.js',
      'package.json', 'package-lock.json', 'yarn.lock', 'composer.lock', 'docker-compose.yml', 'Makefile', 'LICENSE',
      'src/pages/[slug].jsx', 'src/routes/+page.svelte', 'node/@scope/x.mjs', 'assets/my file.css', 'src/ñandú.js',
    ]) {
      expect(isSyncablePath(p)).toBe(true);
    }
  });

  it('rejects traversal, absolute paths, dotfiles and blocked file types', () => {
    for (const p of ['../evil.php', 'a/../b.php', '/etc/x.php', '.htaccess', 'a/.env', 'x.phtml', 'x.phar', 'a/web.config', 'bin/tool.exe', 'a\\b.php', 'a//b.php', 'a/b:c.js', 'a/b|c.js']) {
      expect(isSyncablePath(p)).toBe(false);
    }
  });
});

describe('ignore rules', () => {
  const rules = compileIgnore(['dist/', 'src/**.ts', '*.log']);

  it('ignores defaults at any depth', () => {
    expect(isIgnored('node_modules', true, rules)).toBe(true);
    expect(isIgnored('a/node_modules/x/i.js', false, rules)).toBe(true);
    expect(isIgnored('assets/app.js.map', false, rules)).toBe(true);
    expect(isIgnored('.git/config', false, rules)).toBe(true);
  });

  it('honours user patterns', () => {
    expect(isIgnored('dist/main.js', false, rules)).toBe(true);
    expect(isIgnored('debug.log', false, rules)).toBe(true);
    expect(isIgnored('assets/app.js', false, rules)).toBe(false);
  });

  it('dir-only patterns do not match files with the same name', () => {
    expect(isIgnored('dist', false, rules)).toBe(false);
    expect(isIgnored('dist', true, rules)).toBe(true);
  });
});

describe('buildLocalManifest', () => {
  it('hashes dev files, honours ignore rules and reports hidden/blocked files as skipped', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-'));
    try {
      await fs.outputFile(path.join(dir, 'style.css'), 'a');
      await fs.outputFile(path.join(dir, 'assets/app.js'), 'b');
      await fs.outputFile(path.join(dir, 'src/x.ts'), 'c');
      await fs.outputFile(path.join(dir, '.env'), 'SECRET');
      await fs.outputFile(path.join(dir, '.eslintrc.json'), '{}');
      await fs.outputFile(path.join(dir, 'bin/x.exe'), 'bin');
      await fs.outputFile(path.join(dir, 'node_modules/p/i.js'), 'd');
      await fs.outputFile(path.join(dir, '.noduscmignore'), 'assets/legacy/\n');
      await fs.outputFile(path.join(dir, 'assets/legacy/old.js'), 'e');

      const { manifest, skipped } = await buildLocalManifest(dir);
      expect(Object.keys(manifest).sort()).toEqual(['assets/app.js', 'src/x.ts', 'style.css']);
      expect(manifest['style.css']).toBe(sha1(Buffer.from('a')));
      expect(skipped.map((s) => s.path).sort()).toEqual(['.eslintrc.json', 'bin/x.exe']);
    } finally {
      await fs.remove(dir);
    }
  });
});

describe('normalizeSite', () => {
  it('adds https and strips trailing slashes', () => {
    expect(normalizeSite('example.com/')).toBe('https://example.com');
    expect(normalizeSite('http://localhost:8080/wp/')).toBe('http://localhost:8080/wp');
  });

  it('requires a value', () => {
    expect(() => normalizeSite('')).toThrow();
  });
});

describe('theme / plugin context', () => {
  it('itemOf keeps legacy theme contexts working', () => {
    expect(itemOf({ site: 'https://a.com', theme: 'mi-tema' })).toEqual({ kind: 'theme', slug: 'mi-tema' });
    expect(itemOf({ site: 'https://a.com', kind: 'plugin', slug: 'mi-plugin' })).toEqual({ kind: 'plugin', slug: 'mi-plugin' });
    expect(itemOf({ site: 'https://a.com', kind: 'mu-plugin', slug: 'mi-mu' })).toEqual({ kind: 'mu-plugin', slug: 'mi-mu' });
  });

  it('stores plugin context in plugin.json and theme context in theme.json', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-ctx-'));
    const themeDir = path.join(tmp, 't');
    const pluginDir = path.join(tmp, 'p');

    await saveContext(themeDir, { site: 'https://a.com', theme: 'mi-tema' });
    await saveContext(pluginDir, { site: 'https://a.com', kind: 'plugin', slug: 'mi-plugin' });

    expect(await fs.pathExists(path.join(themeDir, '.noduscm', 'theme.json'))).toBe(true);
    expect(await fs.pathExists(path.join(pluginDir, '.noduscm', 'plugin.json'))).toBe(true);
    expect(itemOf(await loadContext(themeDir))).toEqual({ kind: 'theme', slug: 'mi-tema' });
    expect(itemOf(await loadContext(pluginDir))).toEqual({ kind: 'plugin', slug: 'mi-plugin' });

    await fs.remove(tmp);
  });

  it('stores mu-plugin context in mu-plugin.json and loads it back', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-ctx-'));
    const muDir = path.join(tmp, 'mu');

    await saveContext(muDir, { site: 'https://a.com', kind: 'mu-plugin', slug: 'mi-mu' });

    expect(await fs.pathExists(path.join(muDir, '.noduscm', 'mu-plugin.json'))).toBe(true);
    expect(itemOf(await loadContext(muDir))).toEqual({ kind: 'mu-plugin', slug: 'mi-mu' });

    await fs.remove(tmp);
  });

  it('loadContext reports context_missing outside a sync folder', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-ctx-'));

    await expect(loadContext(tmp)).rejects.toMatchObject({ code: 'context_missing' });

    await fs.remove(tmp);
  });
});
