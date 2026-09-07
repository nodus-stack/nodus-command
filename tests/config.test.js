import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getProjectPaths, saveConfig, loadConfig, projectExists } from '../src/lib/config.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('getProjectPaths', () => {
  it('returns all expected paths relative to given root', () => {
    const paths = getProjectPaths('/some/project');
    expect(paths.root).toBe('/some/project');
    expect(paths.wpContent).toBe('/some/project/wp-content');
    expect(paths.wordpress).toBe('/some/project/wordpress');
    expect(paths.config).toBe('/some/project/.noduscm.json');
    expect(paths.dockerCompose).toBe('/some/project/docker-compose.yml');
    expect(paths.backups).toBe('/some/project/.noduscm/backups');
    expect(paths.noduscm).toBe('/some/project/.noduscm');
  });
});

describe('projectExists', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-config-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('returns false when config file does not exist', async () => {
    expect(await projectExists(tmpDir)).toBe(false);
  });

  it('returns true after saving a config', async () => {
    await saveConfig(tmpDir, { name: 'test' });
    expect(await projectExists(tmpDir)).toBe(true);
  });
});

describe('saveConfig / loadConfig', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-config-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  it('saves and loads config preserving values', async () => {
    const config = {
      name: 'My Site',
      slug: 'my-site',
      domain: 'my-site.localhost',
      localApachePort: 8080,
      localMysqlPort: 3306,
      localHttps: false,
      localHttpsPort: 8443,
      autoManageHosts: true
    };

    await saveConfig(tmpDir, config);
    const loaded = await loadConfig();

    expect(loaded.name).toBe('My Site');
    expect(loaded.slug).toBe('my-site');
    expect(loaded.domain).toBe('my-site.localhost');
  });

  it('coerces port strings to numbers on load', async () => {
    await saveConfig(tmpDir, {
      localApachePort: '9090',
      localMysqlPort: '3307',
      localHttpsPort: '9443'
    });
    const loaded = await loadConfig();

    expect(loaded.localApachePort).toBe(9090);
    expect(loaded.localMysqlPort).toBe(3307);
    expect(loaded.localHttpsPort).toBe(9443);
  });

  it('defaults localApachePort to 8080 if missing', async () => {
    await saveConfig(tmpDir, { name: 'test' });
    const loaded = await loadConfig();
    expect(loaded.localApachePort).toBe(8080);
  });

  it('coerces localHttps to boolean', async () => {
    await saveConfig(tmpDir, { localHttps: 'true' });
    const loaded = await loadConfig();
    expect(loaded.localHttps).toBe(true);
  });

  it('defaults autoManageHosts to true when not set', async () => {
    await saveConfig(tmpDir, { name: 'test' });
    const loaded = await loadConfig();
    expect(loaded.autoManageHosts).toBe(true);
  });

  it('throws when config file does not exist', async () => {
    await expect(loadConfig()).rejects.toThrow('Config file not found');
  });
});
