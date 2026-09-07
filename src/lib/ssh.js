import { NodeSSH } from 'node-ssh';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';

export async function createSSHConnection(sshConfig) {
  const ssh = new NodeSSH();

  const connectOptions = {
    host: sshConfig.host,
    port: sshConfig.port,
    username: sshConfig.user
  };

  if (sshConfig.authType === 'password') {
    connectOptions.password = sshConfig.password;
  } else {
    connectOptions.privateKeyPath = sshConfig.keyFile;
  }

  await ssh.connect(connectOptions);

  return ssh;
}

export async function dumpRemoteDatabase(ssh, dbConfig, localPath) {
  const spinner = ora('Dumping remote database...').start();
  
  const dumpFile = '/tmp/noduscm_dump.sql';
  const command = `mysqldump -u${dbConfig.user} -p${dbConfig.password} -h${dbConfig.host || 'localhost'} ${dbConfig.name} > ${dumpFile}`;
  
  try {
    await ssh.execCommand(command);
    spinner.text = 'Downloading database dump...';
    
    await ssh.getFile(localPath, dumpFile);
    await ssh.execCommand(`rm ${dumpFile}`);
    
    spinner.succeed(chalk.green('Database dumped successfully'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to dump database'));
    throw error;
  }
}

export async function syncRemoteFiles(ssh, remotePath, localPath) {
  const spinner = ora('Syncing files from remote...').start();
  
  try {
    await fs.ensureDir(localPath);
    
    const rsyncTest = await ssh.execCommand('which rsync');
    
    if (rsyncTest.code === 0 && ssh.connection.config.privateKeyPath) {
      await execa('rsync', [
        '-avz',
        '--progress',
        '-e', `ssh -p ${ssh.connection.config.port} -i ${ssh.connection.config.privateKeyPath}`,
        `${ssh.connection.config.username}@${ssh.connection.config.host}:${remotePath}/`,
        localPath
      ], { stdio: 'inherit' });
    } else {
      spinner.text = 'Using SFTP for file transfer...';
      await ssh.getDirectory(localPath, remotePath, {
        recursive: true,
        concurrency: 10
      });
    }
    
    spinner.succeed(chalk.green('Files synced successfully'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to sync files'));
    throw error;
  }
}

export async function testSSHConnection(sshConfig) {
  const spinner = ora('Testing SSH connection...').start();
  
  try {
    const ssh = await createSSHConnection(sshConfig);
    const result = await ssh.execCommand('echo "Connection successful"');
    ssh.dispose();
    
    if (result.code === 0) {
      spinner.succeed(chalk.green('SSH connection successful'));
      return true;
    } else {
      spinner.fail(chalk.red('SSH connection failed'));
      return false;
    }
  } catch (error) {
    spinner.fail(chalk.red('SSH connection failed: ' + error.message));
    return false;
  }
}

/* ✅ NUEVO: rsyncPull */
export async function rsyncPull(sshConfig, localPath, options = {}) {
  const {
    remotePath = sshConfig.remotePath,
    excludes = [],
    deleteFiles = true
  } = options;

  const finalExcludes = [
    '.noduscm',
    'node_modules',
    '.git',
    ...excludes.filter(Boolean)
  ];

  if (sshConfig.authType === 'password') {
    return _sftpPull(sshConfig, localPath, { remotePath, excludes: finalExcludes, deleteFiles });
  }

  const args = [
    '-avz',
    '-e', `ssh -p ${sshConfig.port} -i ${sshConfig.keyFile}`,
    `${sshConfig.user}@${sshConfig.host}:${String(remotePath).replace(/\/+$/, '')}/`,
    `${localPath}/`
  ];

  if (deleteFiles) {
    args.splice(1, 0, '--delete');
  }

  for (const exclude of finalExcludes) {
    args.push('--exclude', exclude);
  }

  return execa('rsync', args, { stdio: 'inherit' });
}

async function _sftpPull(sshConfig, localPath, { remotePath, excludes }) {
  const spinner = ora('Syncing files via SFTP (password auth)...').start();
  const ssh = await createSSHConnection(sshConfig);

  try {
    await fs.ensureDir(localPath);
    await ssh.getDirectory(localPath, remotePath, {
      recursive: true,
      concurrency: 10,
      validate: (itemPath) => {
        const name = path.basename(itemPath);
        return !excludes.includes(name);
      }
    });
    spinner.succeed(chalk.green('Files synced successfully via SFTP'));
  } catch (error) {
    spinner.fail(chalk.red('SFTP sync failed'));
    throw error;
  } finally {
    ssh.dispose();
  }
}

/* ✅ NUEVO: rsyncPush */
export async function rsyncPush(sshConfig, localPath) {
  if (sshConfig.authType === 'password') {
    return _sftpPush(sshConfig, localPath);
  }

  return execa('rsync', [
    '-avz',
    '--delete',
    '-e', `ssh -p ${sshConfig.port} -i ${sshConfig.keyFile}`,
    `${localPath}/`,
    `${sshConfig.user}@${sshConfig.host}:${sshConfig.remotePath}/`,
    '--exclude', '.noduscm',
    '--exclude', 'node_modules',
    '--exclude', '.git'
  ], { stdio: 'inherit' });
}

async function _sftpPush(sshConfig, localPath) {
  const spinner = ora('Pushing files via SFTP (password auth)...').start();
  const ssh = await createSSHConnection(sshConfig);
  const excludes = ['.noduscm', 'node_modules', '.git'];

  try {
    await ssh.putDirectory(localPath, sshConfig.remotePath, {
      recursive: true,
      concurrency: 10,
      validate: (itemPath) => {
        const name = path.basename(itemPath);
        return !excludes.includes(name);
      }
    });
    spinner.succeed(chalk.green('Files pushed successfully via SFTP'));
  } catch (error) {
    spinner.fail(chalk.red('SFTP push failed'));
    throw error;
  } finally {
    ssh.dispose();
  }
}