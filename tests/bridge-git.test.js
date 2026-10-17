import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execa } from 'execa';
import { registerProject } from '../src/lib/registry.js';
import { handleHttp } from '../src/mcp/bridge.js';
import { isValidBranch, projectRepos, publish, repoStatus } from '../src/mcp/git.js';

let tmp;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-bridge-'));
  process.env.NODUSCM_REGISTRY = path.join(tmp, 'registry.json');
});

afterEach(async () => {
  delete process.env.NODUSCM_REGISTRY;
  await fs.remove(tmp);
});

describe('bridge http allowlist', () => {
  it('rejects origins that are not registered projects', async () => {
    const dir = path.join(tmp, 'site');
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, '.noduscm.json'), { name: 'S', slug: 's', domain: 's.localhost', engine: 'docker' });
    await registerProject(dir, { slug: 's', name: 'S', domain: 's.localhost' });
    for (const url of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:5432/', 'http://other.localhost/', 'file:///etc/passwd']) {
      await expect(handleHttp({ method: 'GET', url, headers: {} }, [])).rejects.toThrow(/not one of/);
    }
  });

  it('rejects unsupported methods', async () => {
    const dir = path.join(tmp, 'site');
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, '.noduscm.json'), { name: 'S', slug: 's', domain: 's.localhost', engine: 'podman', localApachePort: 1 });
    await registerProject(dir, { slug: 's', name: 'S', domain: 's.localhost' });
    await expect(handleHttp({ method: 'CONNECT', url: 'http://s.localhost:1/', headers: {} }, [])).rejects.toThrow(/Unsupported/);
  });
});

describe('git', () => {
  it('validates branch names', () => {
    expect(isValidBranch('main')).toBe(true);
    expect(isValidBranch('feature/x-1')).toBe(true);
    for (const bad of ['--force', '-x', 'a..b', 'a b', 'x.lock', 'a//b', '', 'a/', 'a;rm']) expect(isValidBranch(bad)).toBe(false);
  });

  it('publishes directly to the target branch and via a work branch', async () => {
    const remote = path.join(tmp, 'remote.git');
    const work = path.join(tmp, 'theme');
    const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    Object.assign(process.env, env);
    await execa('git', ['init', '-q', '--bare', '-b', 'production', remote]);
    await execa('git', ['clone', '-q', remote, work]);
    await execa('git', ['checkout', '-q', '-b', 'production'], { cwd: work });
    await fs.writeFile(path.join(work, 'a.txt'), '1');
    await execa('git', ['add', '.'], { cwd: work });
    await execa('git', ['commit', '-qm', 'init'], { cwd: work });
    await execa('git', ['push', '-q', 'origin', 'production'], { cwd: work });

    const repos = await projectRepos(tmp, { mounts: [`${work}:/var/www/html/wp-content/themes/apex`] });
    expect(repos).toEqual([expect.objectContaining({ name: 'apex', type: 'theme', path: work })]);

    await fs.writeFile(path.join(work, 'b.txt'), '2');
    expect((await repoStatus(work)).changes_count).toBe(1);
    const direct = await publish(work, { message: 'add b', targetBranch: 'production' });
    expect(direct.pushed).toBe(true);
    const log1 = await execa('git', ['--git-dir', remote, 'log', '-1', '--format=%s', 'production']);
    expect(log1.stdout).toBe('add b');

    // Rama de trabajo distinta → se integra en production sin tocar el working tree.
    await execa('git', ['checkout', '-q', '-b', 'nodus/feature'], { cwd: work });
    await fs.writeFile(path.join(work, 'c.txt'), '3');
    const merged = await publish(work, { message: 'add c', targetBranch: 'production' });
    expect(merged.merged_into_target).toBe(true);
    const files = await execa('git', ['--git-dir', remote, 'ls-tree', '--name-only', 'production']);
    expect(files.stdout.split('\n')).toContain('c.txt');
    expect((await execa('git', ['branch', '--show-current'], { cwd: work })).stdout).toBe('nodus/feature');

    await expect(publish(work, { message: 'x', targetBranch: 'missing' })).rejects.toThrow(/does not exist/);
    await expect(publish(work, { message: 'x', targetBranch: 'production', paths: ['../etc'] })).rejects.toThrow(/Invalid path/);
  });
});

describe('git hardening', () => {
  it('never runs repo hooks and refuses dangerous local config', async () => {
    const remote = path.join(tmp, 'r.git');
    const work = path.join(tmp, 'w');
    Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
    await execa('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    await execa('git', ['clone', '-q', remote, work]);
    await execa('git', ['checkout', '-q', '-b', 'main'], { cwd: work });
    await fs.writeFile(path.join(work, 'a'), '1');
    const marker = path.join(tmp, 'pwned');
    await fs.writeFile(path.join(work, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    await execa('git', ['add', '.'], { cwd: work });
    await execa('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'init'], { cwd: work });
    await execa('git', ['push', '-q', 'origin', 'main'], { cwd: work });
    await fs.writeFile(path.join(work, 'b'), '2');
    await publish(work, { message: 'second', targetBranch: 'main' });
    expect(await fs.pathExists(marker)).toBe(false);

    await execa('git', ['config', '--local', 'core.fsmonitor', `touch ${marker}`], { cwd: work });
    await expect(repoStatus(work)).rejects.toThrow(/Refusing/);
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it('bridge only allows loopback project origins', async () => {
    const { isLoopbackHost } = await import('../src/mcp/bridge.js');
    expect(isLoopbackHost('demo.localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    for (const h of ['192.168.1.1', '169.254.169.254', 'localhost.evil.com', 'example.com', '10.0.0.1']) expect(isLoopbackHost(h)).toBe(false);
  });
});
