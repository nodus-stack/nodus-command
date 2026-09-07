import path from 'path';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { execa } from 'execa';

function getCertificatePaths(projectPath) {
  const certsDir = path.join(projectPath, 'certs');
  return {
    certsDir,
    certFile: path.join(certsDir, 'local.crt'),
    keyFile: path.join(certsDir, 'local.key')
  };
}

async function hasMkcert() {
  try {
    await execa('mkcert', ['-help'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalHttpsCertificate({ domain, projectPath = process.cwd(), prompt = true } = {}) {
  const { certsDir, certFile, keyFile } = getCertificatePaths(projectPath);

  await fs.ensureDir(certsDir);

  const certExists = await fs.pathExists(certFile);
  const keyExists = await fs.pathExists(keyFile);

  if (certExists && keyExists) {
    return {
      changed: false,
      source: 'existing',
      certFile,
      keyFile
    };
  }

  const mkcertAvailable = await hasMkcert();
  if (!mkcertAvailable) {
    throw new Error('mkcert is required for automatic HTTPS certificates. Install it and run "noduscm up" again.');
  }

  if (prompt) {
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'allowAuth',
        message: 'NodusCommand needs to trust a local CA (mkcert -install). Your system may request authentication. Continue?',
        default: true
      }
    ]);

    if (!answer.allowAuth) {
      throw new Error('HTTPS setup cancelled by user. Certificate generation requires authentication to trust the local CA.');
    }
  }

  await execa('mkcert', ['-install'], {
    stdio: 'inherit'
  });

  await execa(
    'mkcert',
    [
      '-key-file', keyFile,
      '-cert-file', certFile,
      String(domain || 'localhost'),
      'localhost',
      '127.0.0.1',
      '::1'
    ],
    { stdio: 'inherit' }
  );

  return {
    changed: true,
    source: 'mkcert',
    certFile,
    keyFile
  };
}
