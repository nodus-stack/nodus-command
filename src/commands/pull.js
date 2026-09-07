import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { loadConfig, getProjectPaths } from '../lib/config.js';

function shellEscape(value) {
  if (value === undefined || value === null) return "''";
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function normalizeSpecifiedPath(specifiedPath) {
  const raw = String(specifiedPath || '').trim();
  if (!raw) {
    throw new Error('`--specified-path` cannot be empty');
  }

  const normalized = path.posix.normalize(raw);
  const relativePath = normalized.replace(/^\/+/, '');

  if (!relativePath || relativePath === '.' || relativePath === '..') {
    throw new Error('`--specified-path` must point to a valid subpath');
  }

  if (relativePath.startsWith('../') || relativePath.includes('/../')) {
    throw new Error('`--specified-path` cannot contain parent directory traversal (`..`)');
  }

  return relativePath;
}

function expandBracePathPattern(value) {
  const input = String(value || '').trim();
  const braceMatch = input.match(/^(.*)\{([^{}]+)\}(.*)$/);

  if (!braceMatch) {
    return [input];
  }

  const [, prefix, choices, suffix] = braceMatch;
  return choices
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => expandBracePathPattern(`${prefix}${part}${suffix}`));
}

function normalizeSpecifiedPathList(specifiedPaths = []) {
  const rawValues = Array.isArray(specifiedPaths)
    ? specifiedPaths
    : [specifiedPaths];

  const expandedValues = rawValues.flatMap((rawValue) => {
    const trimmedValue = String(rawValue || '').trim();
    if (!trimmedValue) {
      return [];
    }

    if (trimmedValue.includes('{') && trimmedValue.includes('}')) {
      return expandBracePathPattern(trimmedValue);
    }

    return trimmedValue
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  });

  return Array.from(new Set(expandedValues.map(normalizeSpecifiedPath)));
}

function normalizeExcludePath(excludePath) {
  const raw = String(excludePath || '').trim();
  if (!raw) {
    throw new Error('`--exclude` cannot be empty');
  }

  const normalized = path.posix.normalize(raw);
  const relativePath = normalized.replace(/^\/+/, '');

  if (!relativePath || relativePath === '.' || relativePath === '..') {
    throw new Error(`Invalid exclude path: ${excludePath}`);
  }

  if (relativePath.startsWith('../') || relativePath.includes('/../')) {
    throw new Error(`Exclude path cannot contain parent directory traversal ('..'): ${excludePath}`);
  }

  return relativePath;
}

function normalizeExcludeList(excludes = []) {
  return Array.from(new Set(excludes.map(normalizeExcludePath)));
}

function mapExcludesForSpecifiedPath(relativeSpecifiedPath, excludes = []) {
  const specifiedRoot = relativeSpecifiedPath.replace(/\/+$/, '');

  return Array.from(new Set(
    excludes.map((exclude) => {
      if (exclude === specifiedRoot) {
        return '.';
      }

      if (exclude.startsWith(`${specifiedRoot}/`)) {
        return exclude.slice(specifiedRoot.length + 1);
      }

      return exclude;
    })
  ));
}

async function detectRemotePathType(config, remotePath) {
  const escapedRemotePath = shellEscape(remotePath);
  const { stdout } = await execa('ssh', [
    '-p', config.ssh.port,
    '-i', config.ssh.keyFile,
    `${config.ssh.user}@${config.ssh.host}`,
    `if [ -d ${escapedRemotePath} ]; then echo dir; elif [ -f ${escapedRemotePath} ]; then echo file; else echo missing; fi`
  ]);

  return String(stdout || '').trim();
}

async function syncRemoteProjectFiles(config, paths, spinner, excludes = []) {
  const remoteBasePath = String(config.ssh.remotePath || '').replace(/\/+$/, '');
  const wpContentRemotePath = `${remoteBasePath}/wp-content`;

  await fs.ensureDir(paths.wordpress);
  await fs.ensureDir(paths.wpContent);

  spinner.start('Syncing WordPress core into wordpress/...');
  await execa('rsync', [
    '-avz',
    '--delete',
    '--progress',
    '--no-perms',
    '--no-owner',
    '--no-group',
    '--omit-dir-times',
    '--ignore-errors',
    '-e', `ssh -p ${config.ssh.port} -i ${config.ssh.keyFile}`,
    '--exclude', 'wp-content',
    '--exclude', 'wp-config.php',
    `${config.ssh.user}@${config.ssh.host}:${remoteBasePath}/`,
    `${paths.wordpress}/`
  ], { stdio: 'inherit' });

  spinner.succeed('WordPress core synced');

  spinner.start('Syncing wp-content/...');
  await execa('rsync', [
    '-avz',
    '--delete',
    '--progress',
    '--no-perms',
    '--no-owner',
    '--no-group',
    '--omit-dir-times',
    '--ignore-errors',
    '-e', `ssh -p ${config.ssh.port} -i ${config.ssh.keyFile}`,
    ...excludes
      .map((exclude) => mapExcludesForSpecifiedPath('wp-content', exclude === 'wp-content' ? [] : [exclude]))
      .flat()
      .filter((exclude) => exclude !== '.' && exclude !== 'wp-content')
      .flatMap((exclude) => ['--exclude', exclude]),
    `${config.ssh.user}@${config.ssh.host}:${wpContentRemotePath}/`,
    `${paths.wpContent}/`
  ], { stdio: 'inherit' });

  spinner.succeed('wp-content synced');
}

export default async function pullCommand(options) {
  try {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const paths = getProjectPaths(projectPath);

    console.log(chalk.bold('\n📥 Pulling from remote server\n'));

    if (!config.ssh) {
      console.log(chalk.red('❌ SSH is not configured for this project\n'));
      return;
    }

    const specifiedPaths = normalizeSpecifiedPathList(options.specifiedPath || []);
    const configDefaultExcludes = [
      ...(Array.isArray(config.pullDefaults?.exclude) ? config.pullDefaults.exclude : []),
      ...(Array.isArray(config.pull?.exclude) ? config.pull.exclude : [])
    ];
    const requestedExcludes = normalizeExcludeList([
      ...configDefaultExcludes,
      ...(options.exclude || [])
    ]);

    const enabledModes = [
      options.dbOnly,
      options.filesOnly,
      options.uploadsOnly,
      options.filesContainerOnly,
      options.dbContainerOnly,
      options.uploadsContainerOnly,
      specifiedPaths.length > 0
    ].filter(Boolean).length;

    if (enabledModes > 1) {
      console.log(chalk.red('❌ Use only one mode at a time: --db-only, --files-only, --uploads-only, --specified-path, --files-container-only, --db-container-only, or --uploads-container-only\n'));
      return;
    }

    if ((options.dbContainerOnly || options.uploadsContainerOnly || options.filesContainerOnly) && !options.containerId) {
      console.log(chalk.red('❌ --container-id is required when using --files-container-only, --db-container-only, or --uploads-container-only\n'));
      return;
    }

    if (
      requestedExcludes.length > 0 &&
      (options.dbOnly || options.dbContainerOnly || options.uploadsOnly || options.uploadsContainerOnly)
    ) {
      console.log(chalk.yellow('⚠️  --exclude is ignored for DB-only and uploads-only pull modes'));
    }

    const spinner = ora('Connecting to remote server...').start();

    // Test SSH connection
    try {
      await execa('ssh', [
        '-p', config.ssh.port,
        '-i', config.ssh.keyFile,
        `${config.ssh.user}@${config.ssh.host}`,
        'echo ok'
      ]);
      spinner.succeed('Connected to remote server');
    } catch {
      spinner.fail('SSH connection failed');
      return;
    }

    // --uploads-only: Solo sincronizar carpeta uploads
    if (options.uploadsOnly) {
      spinner.start('Syncing uploads folder...');
      const uploadsPath = path.join(paths.wpContent, 'uploads');
      await fs.ensureDir(uploadsPath);

      // Limpiar ruta remota (evitar doble slash)
      const remotePath = config.ssh.remotePath.endsWith('/')
        ? config.ssh.remotePath
        : config.ssh.remotePath + '/';

      await execa('rsync', [
        '-avz',
        '--progress',
        '--no-perms',
        '--no-owner',
        '--no-group',
        '--omit-dir-times',     // ← AGREGA: No cambiar timestamps de directorios
        '--ignore-errors',
        '-e', `ssh -p ${config.ssh.port} -i ${config.ssh.keyFile}`,
        `${config.ssh.user}@${config.ssh.host}:${remotePath}wp-content/uploads/`,
        uploadsPath
      ], { stdio: 'inherit' });

      spinner.succeed('Uploads synced successfully');
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // --files-container-only: Solo archivos desde contenedor remoto (Coolify)
    if (options.filesContainerOnly) {
      await pullFilesFromContainer(config, paths, spinner, options.containerId, requestedExcludes);
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // --db-container-only: Solo DB desde contenedor remoto (Coolify)
    if (options.dbContainerOnly) {
      await pullDatabaseFromContainer(config, paths, spinner, options.containerId);
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // --uploads-container-only: Solo uploads desde contenedor remoto (Coolify)
    if (options.uploadsContainerOnly) {
      await pullUploadsFromContainer(config, paths, spinner, options.containerId);
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // --specified-path: Solo sincronizar una ruta específica remota->local
    if (specifiedPaths.length > 0) {
      for (const specifiedPath of specifiedPaths) {
        await pullSpecifiedPath(config, paths, spinner, specifiedPath, requestedExcludes);
      }
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // --files-only: Solo archivos, no DB
    if (options.filesOnly) {
      await syncRemoteProjectFiles(config, paths, spinner, requestedExcludes);
      spinner.succeed('Files synced successfully');
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // --db-only: Solo DB, no archivos
    if (options.dbOnly) {
      await pullDatabase(config, paths, spinner);
      console.log(chalk.green('\n✅ Pull completed successfully!\n'));
      return;
    }

    // Sin flags: Sincronizar todo (archivos + DB)
    await syncRemoteProjectFiles(config, paths, spinner, requestedExcludes);
    spinner.succeed('Files synced successfully');

    await pullDatabase(config, paths, spinner);

    console.log(chalk.green('\n✅ Pull completed successfully!\n'));

  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
  }
}

async function pullDatabaseFromContainer(config, paths, spinner, containerId) {
  if (!config.ssh.database) {
    console.log(chalk.yellow('\n⚠️  No remote database configured, skipping DB pull\n'));
    return;
  }

  const dumpName = `remote-container-dump-${Date.now()}.sql`;
  const dumpLocalPath = path.join(paths.root, dumpName);

  console.log(chalk.cyan('\n🗄 Pulling remote database from container...\n'));

  const db = config.ssh.database;
  const escapedContainerId = shellEscape(containerId);
  const escapedDbUser = shellEscape(db.user);
  const escapedDbPassword = shellEscape(db.password);
  const escapedDbName = shellEscape(db.name);

  const remoteDumpCommand = [
    'if command -v docker >/dev/null 2>&1; then',
    `  docker exec ${escapedContainerId} sh -c "mysqldump -u${escapedDbUser} -p${escapedDbPassword} ${escapedDbName}"`,
    'elif command -v podman >/dev/null 2>&1; then',
    `  podman exec ${escapedContainerId} sh -c "mysqldump -u${escapedDbUser} -p${escapedDbPassword} ${escapedDbName}"`,
    'else',
    '  echo "Neither docker nor podman found on remote host" >&2',
    '  exit 127',
    'fi'
  ].join(' ');

  // 1. Dump remote DB from container
  spinner.start('Dumping remote database from container...');
  try {
    const dumpStream = fs.createWriteStream(dumpLocalPath);

    const sshProcess = execa('ssh', [
      '-p', config.ssh.port,
      '-i', config.ssh.keyFile,
      `${config.ssh.user}@${config.ssh.host}`,
      remoteDumpCommand
    ]);

    sshProcess.stdout.pipe(dumpStream);
    await sshProcess;

    spinner.succeed('Database dumped successfully from container');
  } catch (err) {
    spinner.fail('Failed to dump database from remote container');
    console.log(err.message);
    throw err;
  }

  // 2. Copy dump into local MySQL container
  spinner.start('Copying dump into local MySQL container...');
  try {
    await execa(config.engine, [
      'cp',
      dumpLocalPath,
      `${config.slug}-mysql:/tmp/temp-dump.sql`
    ]);
    spinner.succeed('Dump copied to container');
  } catch (err) {
    spinner.fail('Failed to copy dump into container');
    console.log(err.message);
    throw err;
  }

  // 3. Import dump inside container
  spinner.start('Importing database into local container...');
  try {
    await execa(config.engine, [
      'exec',
      `${config.slug}-mysql`,
      'sh',
      '-c',
      `mysql -u${config.database.user} -p${config.database.password} ${config.database.name} < /tmp/temp-dump.sql`
    ], { stdio: 'inherit' });

    spinner.succeed('Database imported successfully');
  } catch (err) {
    spinner.fail('Failed to import database');
    console.log(err.message);
    throw err;
  }

  // 4. Cleanup local dump
  await fs.remove(dumpLocalPath);
}

async function pullUploadsFromContainer(config, paths, spinner, containerId) {
  const uploadsPath = path.join(paths.wpContent, 'uploads');
  await fs.ensureDir(paths.wpContent);

  console.log(chalk.cyan('\n📁 Pulling uploads from remote container...\n'));

  const escapedContainerId = shellEscape(containerId);
  const remoteUploadsStreamCommand = [
    'if command -v docker >/dev/null 2>&1; then',
    `  docker exec ${escapedContainerId} sh -c "cd /var/www/html/wp-content && tar -cf - uploads"`,
    'elif command -v podman >/dev/null 2>&1; then',
    `  podman exec ${escapedContainerId} sh -c "cd /var/www/html/wp-content && tar -cf - uploads"`,
    'else',
    '  echo "Neither docker nor podman found on remote host" >&2',
    '  exit 127',
    'fi'
  ].join(' ');

  // Reemplazar uploads local para reflejar remoto
  spinner.start('Preparing local uploads folder...');
  await fs.remove(uploadsPath);
  await fs.ensureDir(paths.wpContent);
  spinner.succeed('Local uploads folder prepared');

  spinner.start('Streaming uploads from remote container...');
  try {
    const sshProcess = execa('ssh', [
      '-p', config.ssh.port,
      '-i', config.ssh.keyFile,
      `${config.ssh.user}@${config.ssh.host}`,
      remoteUploadsStreamCommand
    ]);

    const tarProcess = execa('tar', ['-xf', '-', '-C', paths.wpContent]);

    sshProcess.stdout.pipe(tarProcess.stdin);

    await Promise.all([sshProcess, tarProcess]);

    spinner.succeed('Uploads synced successfully from container');
  } catch (err) {
    spinner.fail('Failed to sync uploads from remote container');
    console.log(err.message);
    throw err;
  }
}

async function pullFilesFromContainer(config, paths, spinner, containerId, excludes = []) {
  console.log(chalk.cyan('\n📦 Pulling project files from remote container...\n'));

  const escapedContainerId = shellEscape(containerId);
  const remoteFilesStreamCommand = [
    'if command -v docker >/dev/null 2>&1; then',
    `  docker exec ${escapedContainerId} sh -c "cd /var/www/html && tar -cf - ."`,
    'elif command -v podman >/dev/null 2>&1; then',
    `  podman exec ${escapedContainerId} sh -c "cd /var/www/html && tar -cf - ."`,
    'else',
    '  echo "Neither docker nor podman found on remote host" >&2',
    '  exit 127',
    'fi'
  ].join(' ');

  const tempDir = path.join(paths.noduscm, `pull-container-${Date.now()}`);
  await fs.ensureDir(tempDir);

  spinner.start('Streaming project files from remote container...');
  try {
    const sshProcess = execa('ssh', [
      '-p', config.ssh.port,
      '-i', config.ssh.keyFile,
      `${config.ssh.user}@${config.ssh.host}`,
      remoteFilesStreamCommand
    ]);

    const tarProcess = execa('tar', ['-xf', '-', '-C', tempDir]);

    sshProcess.stdout.pipe(tarProcess.stdin);
    await Promise.all([sshProcess, tarProcess]);

    spinner.succeed('Remote files extracted locally');
  } catch (err) {
    spinner.fail('Failed to stream files from remote container');
    console.log(err.message);
    throw err;
  }

  spinner.start('Syncing extracted files into project...');
  try {
    await execa('rsync', [
      '-avz',
      '--delete',
      `${tempDir}/`,
      `${paths.root}/`,
      '--exclude', '.noduscm',
      '--exclude', 'node_modules',
      '--exclude', '.git',
      ...excludes.flatMap((exclude) => ['--exclude', exclude])
    ], { stdio: 'inherit' });

    spinner.succeed('Project files synced successfully from container');
  } catch (err) {
    spinner.fail('Failed to sync extracted files into project');
    console.log(err.message);
    throw err;
  } finally {
    await fs.remove(tempDir);
  }
}

async function pullDatabase(config, paths, spinner) {
  if (!config.ssh.database) {
    console.log(chalk.yellow('\n⚠️  No remote database configured, skipping DB pull\n'));
    return;
  }

  const dumpName = `remote-dump-${Date.now()}.sql`;
  const dumpLocalPath = path.join(paths.root, dumpName);

  console.log(chalk.cyan('\n🗄 Pulling remote database...\n'));

  // 1. Dump remote DB
  spinner.start('Dumping remote database...');
  try {
    const dumpStream = fs.createWriteStream(dumpLocalPath);

    const sshProcess = execa('ssh', [
      '-p', config.ssh.port,
      '-i', config.ssh.keyFile,
      `${config.ssh.user}@${config.ssh.host}`,
      `mysqldump -h${config.ssh.database.host} -u${config.ssh.database.user} -p${config.ssh.database.password} ${config.ssh.database.name}`
    ]);

    sshProcess.stdout.pipe(dumpStream);

    await sshProcess;

    spinner.succeed('Database dumped successfully');
  } catch (err) {
    spinner.fail('Failed to dump remote database');
    console.log(err.message);
    throw err;
  }

  // 2. Copy dump into MySQL container
  spinner.start('Copying dump into local MySQL container...');
  try {
    await execa(config.engine, [
      'cp',
      dumpLocalPath,
      `${config.slug}-mysql:/tmp/temp-dump.sql`
    ]);
    spinner.succeed('Dump copied to container');
  } catch (err) {
    spinner.fail('Failed to copy dump into container');
    console.log(err.message);
    throw err;
  }

  // 3. Import dump inside container
  spinner.start('Importing database into local container...');
  try {
    await execa(config.engine, [
      'exec',
      `${config.slug}-mysql`,
      'sh',
      '-c',
      `mysql -u${config.database.user} -p${config.database.password} ${config.database.name} < /tmp/temp-dump.sql`
    ], { stdio: 'inherit' });

    spinner.succeed('Database imported successfully');
  } catch (err) {
    spinner.fail('Failed to import database');
    console.log(err.message);
    throw err;
  }

  // 4. Cleanup local dump
  await fs.remove(dumpLocalPath);
}

async function pullSpecifiedPath(config, paths, spinner, specifiedPath, excludes = []) {
  const relativeSpecifiedPath = normalizeSpecifiedPath(specifiedPath);
  const remoteBasePath = String(config.ssh.remotePath || '').replace(/\/+$/, '');
  const remoteSpecifiedPath = `${remoteBasePath}/${relativeSpecifiedPath}`;
  const localSpecifiedPath = path.join(paths.root, ...relativeSpecifiedPath.split('/'));
  const remotePathType = await detectRemotePathType(config, remoteSpecifiedPath);

  if (remotePathType === 'missing') {
    throw new Error(`Remote path not found: /${relativeSpecifiedPath}`);
  }

  if (remotePathType === 'file') {
    await fs.ensureDir(path.dirname(localSpecifiedPath));
  } else {
    await fs.ensureDir(localSpecifiedPath);
  }

  console.log(chalk.cyan(`\n📁 Pulling specified path: /${relativeSpecifiedPath}\n`));

  spinner.start('Syncing specified path...');
  try {
    const args = [
      '-avz',
      '--progress',
      '--no-perms',
      '--no-owner',
      '--no-group',
      '--omit-dir-times',
      '--ignore-errors',
      '-e', `ssh -p ${config.ssh.port} -i ${config.ssh.keyFile}`,
    ];

    if (remotePathType === 'dir') {
      args.splice(1, 0, '--delete');

      for (const exclude of mapExcludesForSpecifiedPath(relativeSpecifiedPath, excludes)) {
        args.push('--exclude', exclude);
      }

      args.push(
        `${config.ssh.user}@${config.ssh.host}:${remoteSpecifiedPath}/`,
        `${localSpecifiedPath}/`
      );
    } else {
      if (excludes.length > 0) {
        console.log(chalk.yellow('⚠️  --exclude is ignored when --specified-path points to a single file'));
      }

      args.push(
        `${config.ssh.user}@${config.ssh.host}:${remoteSpecifiedPath}`,
        `${localSpecifiedPath}`
      );
    }

    await execa('rsync', args, { stdio: 'inherit' });

    spinner.succeed('Specified path synced successfully');
  } catch (err) {
    spinner.fail('Failed to sync specified path');
    console.log(err.message);
    throw err;
  }
}