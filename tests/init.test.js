import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { buildInitConfig, nextFreePort, parseMount } from '../src/lib/init-options.js';
import { initArgs, prepareInit } from '../src/mcp/init.js';
import { generateWpConfig } from '../src/lib/wordpress.js';

let tmp;

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-init-')));
  process.env.NODUSCM_REGISTRY = path.join(tmp, 'registry.json');
});

afterEach(async () => {
  delete process.env.NODUSCM_REGISTRY;
  await fs.remove(tmp);
});

describe('buildInitConfig (init --yes)', () => {
  it('fills defaults like the interactive init', async () => {
    const config = await buildInitConfig({ name: 'Mi Tienda Café' }, tmp);
    expect(config).toMatchObject({
      projectName: 'Mi Tienda Café',
      slug: 'mi-tienda-cafe',
      domain: 'mi-tienda-cafe.localhost',
      isBlank: true,
      wpVersion: '6.7',
      ssh: null,
      mounts: [],
      localApachePort: 8080,
      localMysqlPort: 3306,
      localHttps: false,
      autoManageHosts: true,
      database: { type: 'local', host: 'mi-tienda-cafe-mysql', name: 'wordpress', user: 'wordpress', password: 'wordpress' },
    });
  });

  it('takes flags (commander names)', async () => {
    const config = await buildInitConfig(
      {
        name: 'Demo',
        domain: 'shop.demo.localhost',
        wpVersion: '6.8.1',
        existing: true,
        dbName: 'shop',
        httpPort: '8081',
        mysqlPort: '3307',
        https: true,
        httpsPort: '8444',
        hosts: false,
        mount: ['/home/me/theme:/var/www/html/wp-content/themes/apex:z'],
      },
      tmp
    );
    expect(config).toMatchObject({
      domain: 'shop.demo.localhost',
      wpVersion: '6.8.1',
      isBlank: false,
      hasWpContent: false,
      localApachePort: 8081,
      localMysqlPort: 3307,
      localHttps: true,
      localHttpsPort: 8444,
      autoManageHosts: false,
      mounts: ['/home/me/theme:/var/www/html/wp-content/themes/apex:z'],
    });
    expect(config.database.name).toBe('shop');
  });

  it.each([
    [{}, /name is required/],
    [{ name: '   ' }, /name is required/],
    [{ name: 'x */ <?php system($_GET[1]);' }, /invalid characters/],
    [{ name: 'a\nb' }, /invalid characters/],
    [{ name: '***' }, /letters or numbers/],
    [{ name: 'ok', domain: 'ok.com' }, /--domain/],
    [{ name: 'ok', domain: "ok';x.localhost" }, /--domain/],
    [{ name: 'ok', wpVersion: 'latest' }, /--wp-version/],
    [{ name: 'ok', dbPassword: "pw'); system('x" }, /database password/],
    [{ name: 'ok', httpPort: '99999' }, /--http-port/],
    [{ name: 'ok', httpPort: 3306 }, /must be different/],
    [{ name: 'ok', mount: ['relative:/var/www/html/x'] }, /absolute/],
    [{ name: 'ok', mount: ['/a:/etc/passwd'] }, /inside \/var\/www\/html/],
    [{ name: 'ok', mount: ['/a:/var/www/html/../../etc'] }, /bad container path/],
    [{ name: 'ok', mount: ['/a:/var/www/html/x:rw,exec'] }, /mode/],
    [{ name: 'ok', mount: ['/a"\n  - /etc:/var/www/html/x'] }, /unsupported characters/],
    [{ name: 'ok', mount: ['/home/${USER}/x:/var/www/html/x'] }, /unsupported characters/],
  ])('rejects %o', async (opts, error) => {
    await expect(buildInitConfig(opts, tmp)).rejects.toThrow(error);
  });

  it('parses mounts and picks free ports', () => {
    expect(parseMount('/a/b:/var/www/html/wp-content/plugins/p:ro')).toMatchObject({ source: '/a/b', mode: 'ro' });
    expect(nextFreePort(8080, new Set([8080, 8081, 8083]))).toBe(8082);
  });

  it('never lets the project name break out of the wp-config comment', async () => {
    const php = await generateWpConfig({ name: 'n', user: 'u', password: 'p', host: 'h' }, 'evil */ echo 1; /*\nx', 'http://x.localhost');
    expect(php).toContain(' * Project: evil  echo 1; /* x');
    expect(php.match(/\*\//g)).toHaveLength(1);
  });
});

describe('project_init (MCP)', () => {
  async function makeProject(dir, slug, ports) {
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, '.noduscm.json'), { name: slug, slug, domain: `${slug}.localhost`, ...ports });
  }

  it('needs a --root', async () => {
    await expect(prepareInit({ name: 'A' }, [])).rejects.toThrow(/--root/);
  });

  it('creates <root>/<slug>, picks free ports and mounts themes from inside the root', async () => {
    const root = path.join(tmp, 'sites');
    await makeProject(path.join(root, 'old'), 'old', { localApachePort: 8080, localMysqlPort: 3306, localHttpsPort: 8443 });
    await fs.ensureDir(path.join(root, 'themes', 'apex'));

    const plan = await prepareInit(
      { name: 'Nuevo Sitio', mounts: [{ source: path.join(root, 'themes', 'apex'), target: 'themes/nodus-apex' }] },
      [root]
    );
    expect(plan.dir).toBe(path.join(root, 'nuevo-sitio'));
    expect(await fs.pathExists(plan.dir)).toBe(true);
    expect(plan.ports).toEqual({ http: 8081, mysql: 3307, https: 8444 });
    expect(initArgs(plan)).toEqual([
      'init',
      '--yes',
      '--name=Nuevo Sitio',
      '--http-port=8081',
      '--mysql-port=3307',
      '--https-port=8444',
      `--mount=${path.join(root, 'themes', 'apex')}:/var/www/html/wp-content/themes/nodus-apex`,
    ]);

    await plan.cleanup();
    expect(await fs.pathExists(plan.dir)).toBe(false);
  });

  it('keeps the agent inside the --root folders', async () => {
    const root = path.join(tmp, 'sites');
    const outside = path.join(tmp, 'secret');
    await fs.ensureDir(root);
    await fs.ensureDir(outside);
    await fs.symlink(outside, path.join(root, 'link'));

    await expect(prepareInit({ name: 'A', parent: outside }, [root])).rejects.toThrow(/inside a --root/);
    await expect(prepareInit({ name: 'A', parent: 'relative' }, [root])).rejects.toThrow(/absolute/);
    await expect(prepareInit({ name: 'A', mounts: [{ source: outside, target: 'themes/x' }] }, [root])).rejects.toThrow(/inside a --root/);
    // un symlink dentro del root que apunta fuera tampoco vale
    await expect(prepareInit({ name: 'A', mounts: [{ source: path.join(root, 'link'), target: 'themes/x' }] }, [root])).rejects.toThrow(/inside a --root/);
    await fs.ensureDir(path.join(root, 'theme'));
    for (const target of ['../../etc', 'uploads/x', 'themes/', 'themes/a/b', 'themes/.hidden']) {
      await expect(prepareInit({ name: 'A', mounts: [{ source: path.join(root, 'theme'), target }] }, [root])).rejects.toThrow(/Mount target/);
    }
    expect(await fs.pathExists(path.join(root, 'a'))).toBe(false);
  });

  it('refuses existing slugs and non-empty folders', async () => {
    const root = path.join(tmp, 'sites');
    await makeProject(path.join(root, 'taken'), 'taken', {});
    await expect(prepareInit({ name: 'Taken' }, [root])).rejects.toThrow(/already exists/);
    await fs.outputFile(path.join(root, 'busy', 'file.txt'), 'x');
    await expect(prepareInit({ name: 'Busy' }, [root])).rejects.toThrow(/not empty/);
  });
});
