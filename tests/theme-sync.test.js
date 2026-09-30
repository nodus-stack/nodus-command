import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { buildLocalManifest, compileIgnore, isIgnored, isSyncablePath, sha1 } from '../src/lib/theme-sync.js';
import { normalizeSite } from '../src/lib/auth.js';

describe('isSyncablePath', () => {
  it('accepts normal theme files', () => {
    for (const p of ['style.css', 'functions.php', 'assets/js/app.js', 'templates/home.twig', 'img/logo.webp']) {
      expect(isSyncablePath(p)).toBe(true);
    }
  });

  it('rejects traversal, absolute paths, dotfiles and unknown extensions', () => {
    for (const p of ['../evil.php', 'a/../b.php', '/etc/x.php', '.htaccess', 'a/.env', 'x.phtml', 'x.sh', 'noext', 'a\\b.php', 'a//b.php']) {
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
  it('hashes syncable files and reports skipped ones', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-'));
    try {
      await fs.outputFile(path.join(dir, 'style.css'), 'a');
      await fs.outputFile(path.join(dir, 'assets/app.js'), 'b');
      await fs.outputFile(path.join(dir, 'src/x.ts'), 'c');
      await fs.outputFile(path.join(dir, '.env'), 'SECRET');
      await fs.outputFile(path.join(dir, 'node_modules/p/i.js'), 'd');
      await fs.outputFile(path.join(dir, '.noduscmignore'), 'assets/legacy/\n');
      await fs.outputFile(path.join(dir, 'assets/legacy/old.js'), 'e');

      const { manifest, skipped } = await buildLocalManifest(dir);
      expect(Object.keys(manifest).sort()).toEqual(['assets/app.js', 'style.css']);
      expect(manifest['style.css']).toBe(sha1(Buffer.from('a')));
      expect(skipped.map((s) => s.path)).toEqual(['src/x.ts']);
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
