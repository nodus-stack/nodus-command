import os from 'os';
import path from 'path';
import { readFileSync } from 'fs';
import inquirer from 'inquirer';
import { pairDevice, readDevice, runBridge, saveDevice } from '../mcp/bridge.js';

const DEFAULT_SERVER = 'https://mcp.nodusproject.dev';
const CODE_RE = /^NCM-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/**
 * noduscm connect — conecta este equipo al conector de Nodus en la nube para
 * que Claude (claude.ai, Claude Desktop…) diseñe en tus sitios locales y use
 * tus comandos de noduscm (Docker, WP-CLI, Git). Conexión saliente, sin abrir
 * puertos.
 */
export default async function connectCommand(options = {}) {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const roots = (options.root || []).map((dir) => path.resolve(dir));

  try {
    let device = options.reset ? null : await readDevice();
    const server = String(options.server || device?.server || DEFAULT_SERVER).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(server)) throw new Error(`Invalid --server: ${server}`);
    if (device && device.server !== server) device = null;

    if (!device) {
      let code = String(options.code || process.env.NODUSCM_DEVICE_CODE || '').trim().toUpperCase();
      if (!code) {
        if (!process.stdin.isTTY || process.env.NODUSCM_NON_INTERACTIVE === '1') {
          throw new Error(`Pass --code. Generate one in ${server}/connect ("Generar código de equipo").`);
        }
        console.log(`Generate a device code in ${server}/connect ("Generar código de equipo").`);
        const answer = await inquirer.prompt([{ type: 'input', name: 'code', message: 'Device code:', validate: (v) => CODE_RE.test(String(v).trim().toUpperCase()) || 'Format: NCM-XXXX-XXXX' }]);
        code = String(answer.code).trim().toUpperCase();
      }
      if (!CODE_RE.test(code)) throw new Error('Invalid code (format NCM-XXXX-XXXX).');
      device = await pairDevice(server, code, String(options.name || os.hostname()).slice(0, 80));
      await saveDevice(device);
      console.log(`Paired as "${device.name}".`);
    }

    if (options.allowExec) console.log('⚠ --allow-exec: Claude can run arbitrary commands in your containers.');
    if (options.confirmPublish === false) console.log('⚠ --no-confirm-publish: pushes to the production branch will not ask for confirmation.');
    const result = await runBridge({ device, roots, allowExec: Boolean(options.allowExec), confirmPublish: options.confirmPublish !== false, version });
    process.exit(result?.unauthorized ? 1 : 0);
  } catch (error) {
    process.stderr.write(`noduscm connect: ${error.message}\n`);
    process.exit(1);
  }
}
