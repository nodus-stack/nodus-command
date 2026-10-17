import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { readRegistry, registerProject, scanForProjects, unregisterProject } from '../src/lib/registry.js';
import { listProjects, redactConfig, resolveProject } from '../src/mcp/projects.js';
import { cleanOutput } from '../src/mcp/runner.js';
import { isInteractive } from '../src/lib/interactive.js';

let tmp;

async function makeProject(dir, slug) {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, '.noduscm.json'), {
    name: `Site ${slug}`,
    slug,
    domain: `${slug}.localhost`,
    engine: 'docker',
    database: { type: 'local', name: 'wp', user: 'wp', password: 'db-pass' },
    ssh: { host: 'x', password: 'ssh-pass', database: { password: 'remote-pass' } },
  });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-mcp-'));
  process.env.NODUSCM_REGISTRY = path.join(tmp, 'registry.json');
});

afterEach(async () => {
  delete process.env.NODUSCM_REGISTRY;
  delete process.env.NODUSCM_NON_INTERACTIVE;
  await fs.remove(tmp);
});

describe('registry', () => {
  it('registers, updates and removes projects', async () => {
    await makeProject(path.join(tmp, 'a'), 'alpha');
    expect(await registerProject(path.join(tmp, 'a'))).toBe(true);
    await registerProject(path.join(tmp, 'a'));
    expect(await readRegistry()).toHaveLength(1);
    await unregisterProject(path.join(tmp, 'a'));
    expect(await readRegistry()).toHaveLength(0);
  });

  it('scans nested folders but not wordpress/ or node_modules/', async () => {
    await makeProject(path.join(tmp, 'sites', 'one'), 'one');
    await makeProject(path.join(tmp, 'sites', 'node_modules', 'x'), 'x');
    const found = await scanForProjects(tmp, 2);
    expect(found).toEqual([path.join(tmp, 'sites', 'one')]);
  });
});

describe('projects', () => {
  it('lists and resolves by slug, name and path', async () => {
    await makeProject(path.join(tmp, 'p1'), 'p1');
    const projects = await listProjects([tmp]);
    expect(projects.map((p) => p.slug)).toEqual(['p1']);
    expect((await resolveProject('p1', [tmp])).config.slug).toBe('p1');
    expect((await resolveProject('site p1', [tmp])).config.slug).toBe('p1');
    expect((await resolveProject(path.join(tmp, 'p1'))).root).toBe(path.join(tmp, 'p1'));
    await expect(resolveProject('nope', [tmp])).rejects.toThrow(/not found/);
  });

  it('redacts secrets recursively', () => {
    const out = JSON.stringify(redactConfig({ database: { password: 'a' }, ssh: { password: 'b', database: { password: 'c' } }, name: 'ok' }));
    expect(out).not.toMatch(/"a"|"b"|"c"/);
    expect(out).toContain('(set)');
    expect(out).toContain('"ok"');
  });
});

describe('runner', () => {
  it('strips ANSI codes and collapses blank lines', () => {
    expect(cleanOutput('\u001b[32mOK\u001b[39m\n\n\n\nnext')).toBe('OK\n\nnext');
  });

  it('honours NODUSCM_NON_INTERACTIVE', () => {
    process.env.NODUSCM_NON_INTERACTIVE = '1';
    expect(isInteractive()).toBe(false);
  });
});
