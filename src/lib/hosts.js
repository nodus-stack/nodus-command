import fs from 'fs-extra';
import dns from 'dns';
import inquirer from 'inquirer';
import { execa } from 'execa';

const LOOPBACKS = new Set(['127.0.0.1', '::1']);

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `"'"'`)}'`;
}

function isDomainMappedToLoopback(content, domain) {
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(`^\\s*(127\\.0\\.0\\.1|::1)\\s+.*\\b${escapedDomain}\\b`, 'im');
  return lineRegex.test(content);
}

async function resolvesToLoopback(domain) {
  try {
    const records = await dns.promises.lookup(domain, { all: true });
    return records.some((record) => LOOPBACKS.has(record.address));
  } catch {
    return false;
  }
}

async function readHostsFile() {
  const isWindows = process.platform === 'win32';
  const hostsPath = isWindows
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';

  try {
    const content = await fs.readFile(hostsPath, 'utf8');
    return { hostsPath, content };
  } catch {
    return { hostsPath, content: '' };
  }
}

async function appendHostsEntryWithPrivileges(domain) {
  const entry = `127.0.0.1 ${domain}`;

  if (process.platform === 'win32') {
    const escapedEntry = entry.replace(/'/g, "''");
    const psScript = [
      '$hostsPath = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"',
      `$entry = '${escapedEntry}'`,
      '$content = Get-Content -Path $hostsPath -Raw',
      'if ($content -notmatch [regex]::Escape($entry)) {',
      '  Add-Content -Path $hostsPath -Value "`r`n$entry"',
      '}'
    ].join('; ');

    await execa('powershell', [
      '-NoProfile',
      '-Command',
      `Start-Process PowerShell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "${psScript.replace(/"/g, '\\"')}"'`
    ], { stdio: 'inherit' });

    return;
  }

  const command = `grep -qE '^\\s*(127\\.0\\.0\\.1|::1)\\s+.*\\b${domain}\\b' /etc/hosts || echo ${shellEscape(entry)} | sudo tee -a /etc/hosts >/dev/null`;
  await execa('sh', ['-c', command], { stdio: 'inherit' });
}

export async function ensureDomainInHosts(domain, options = {}) {
  if (!domain || typeof domain !== 'string') {
    return { changed: false, skipped: true, reason: 'invalid-domain' };
  }

  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain) {
    return { changed: false, skipped: true, reason: 'empty-domain' };
  }

  const { content } = await readHostsFile();
  if (isDomainMappedToLoopback(content, normalizedDomain)) {
    return { changed: false, skipped: true, reason: 'already-mapped' };
  }

  const dnsLoopback = await resolvesToLoopback(normalizedDomain);
  if (dnsLoopback) {
    return { changed: false, skipped: true, reason: 'dns-loopback' };
  }

  if (options.prompt !== false) {
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'updateHosts',
        message: `Domain ${normalizedDomain} is not mapped to localhost. Add it to hosts file now?`,
        default: true
      }
    ]);

    if (!answer.updateHosts) {
      return { changed: false, skipped: true, reason: 'user-declined' };
    }
  }

  await appendHostsEntryWithPrivileges(normalizedDomain);
  return { changed: true, skipped: false, reason: 'updated' };
}

export function getHostsFilePathForCurrentOs() {
  if (process.platform === 'win32') {
    return 'C:\\Windows\\System32\\drivers\\etc\\hosts';
  }

  return '/etc/hosts';
}
