import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { replaceVariables, generateDockerCompose, generateApacheConfig } from '../src/lib/templates.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('replaceVariables', () => {
  it('replaces a single variable', () => {
    expect(replaceVariables('Hello {{NAME}}!', { NAME: 'World' })).toBe('Hello World!');
  });

  it('replaces multiple different variables', () => {
    const result = replaceVariables('{{A}} and {{B}}', { A: 'foo', B: 'bar' });
    expect(result).toBe('foo and bar');
  });

  it('replaces the same variable multiple times', () => {
    const result = replaceVariables('{{X}} {{X}} {{X}}', { X: 'hi' });
    expect(result).toBe('hi hi hi');
  });

  it('leaves unknown placeholders untouched', () => {
    const result = replaceVariables('Hello {{UNKNOWN}}', { NAME: 'World' });
    expect(result).toBe('Hello {{UNKNOWN}}');
  });

  it('handles empty variables object', () => {
    const result = replaceVariables('Hello {{NAME}}', {});
    expect(result).toBe('Hello {{NAME}}');
  });

  it('handles empty template', () => {
    expect(replaceVariables('', { NAME: 'World' })).toBe('');
  });
});

const baseConfig = {
  slug: 'my-site',
  domain: 'my-site.localhost',
  localHttps: false,
  localApachePort: 8080,
  localMysqlPort: 3306,
  localHttpsPort: 8443,
  database: {
    type: 'local',
    name: 'wordpress',
    user: 'wordpress',
    password: 'wordpress',
    rootPassword: 'root'
  },
  mounts: [],
  env: {}
};

describe('generateDockerCompose', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-compose-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates docker-compose.yml for docker engine', async () => {
    const outputPath = await generateDockerCompose(baseConfig, tmpDir, 'docker');
    expect(await fs.pathExists(outputPath)).toBe(true);
    expect(path.basename(outputPath)).toBe('docker-compose.yml');
  });

  it('replaces all template variables (no {{ left)', async () => {
    const outputPath = await generateDockerCompose(baseConfig, tmpDir, 'docker');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).not.toContain('{{');
    expect(content).not.toContain('}}');
  });

  it('includes the project slug in the output', async () => {
    const outputPath = await generateDockerCompose(baseConfig, tmpDir, 'docker');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('my-site');
  });

  it('includes the domain in the output', async () => {
    const outputPath = await generateDockerCompose(baseConfig, tmpDir, 'docker');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('my-site.localhost');
  });

  it('generates valid output for podman engine', async () => {
    const outputPath = await generateDockerCompose(baseConfig, tmpDir, 'podman');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).not.toContain('{{');
  });

  it('includes custom mounts in the output', async () => {
    const config = { ...baseConfig, mounts: ['./local:/var/www/extra:z'] };
    const outputPath = await generateDockerCompose(config, tmpDir, 'docker');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('./local:/var/www/extra:z');
  });

  it('uses remote-db template when database type is remote', async () => {
    const config = {
      ...baseConfig,
      database: {
        type: 'remote',
        remote: { host: 'db.example.com' },
        name: 'wordpress',
        user: 'wordpress',
        password: 'wordpress'
      }
    };
    const outputPath = await generateDockerCompose(config, tmpDir, 'docker');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).not.toContain('{{');
  });

  it('includes port bindings in the output', async () => {
    const outputPath = await generateDockerCompose(baseConfig, tmpDir, 'docker');
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('8080:80');
  });
});

describe('generateApacheConfig', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-apache-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates apache.conf file', async () => {
    const config = { domain: 'my-site.localhost', localHttps: false, localHttpsPort: 8443 };
    const outputPath = await generateApacheConfig(config, tmpDir);
    expect(await fs.pathExists(outputPath)).toBe(true);
    expect(path.basename(outputPath)).toBe('apache.conf');
  });

  it('replaces all template variables', async () => {
    const config = { domain: 'my-site.localhost', localHttps: false, localHttpsPort: 8443 };
    const outputPath = await generateApacheConfig(config, tmpDir);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).not.toContain('{{');
  });

  it('includes the domain in the output', async () => {
    const config = { domain: 'my-site.localhost', localHttps: false, localHttpsPort: 8443 };
    const outputPath = await generateApacheConfig(config, tmpDir);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('my-site.localhost');
  });

  it('includes HTTPS VirtualHost block when localHttps is true', async () => {
    const config = { domain: 'my-site.localhost', localHttps: true, localHttpsPort: 8443 };
    const outputPath = await generateApacheConfig(config, tmpDir);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('VirtualHost *:443');
    expect(content).toContain('SSLEngine on');
  });

  it('does not include HTTPS block when localHttps is false', async () => {
    const config = { domain: 'my-site.localhost', localHttps: false, localHttpsPort: 8443 };
    const outputPath = await generateApacheConfig(config, tmpDir);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).not.toContain('SSLEngine on');
  });

  it('includes HTTP to HTTPS redirect when localHttps is true', async () => {
    const config = { domain: 'my-site.localhost', localHttps: true, localHttpsPort: 8443 };
    const outputPath = await generateApacheConfig(config, tmpDir);
    const content = await fs.readFile(outputPath, 'utf8');
    expect(content).toContain('RewriteEngine On');
    expect(content).toContain('R=301');
  });
});
