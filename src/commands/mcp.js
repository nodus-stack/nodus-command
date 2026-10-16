import path from 'path';
import { startHttp, startStdio } from '../mcp/server.js';

/**
 * noduscm mcp — servidor MCP local para Claude Code, Claude Desktop o tu
 * propia interfaz de agentes. Por defecto stdio; --http para HTTP local.
 */
export default async function mcpCommand(options = {}) {
  const roots = (options.root || []).map((dir) => path.resolve(dir));
  const serverOptions = { roots, allowExec: Boolean(options.allowExec) };

  try {
    if (options.http) {
      const port = options.http === true ? 7337 : Number(options.http);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${options.http}`);
      }
      await startHttp(serverOptions, { port, token: options.token, cors: options.cors || [] });
    } else {
      await startStdio(serverOptions);
    }
  } catch (error) {
    process.stderr.write(`noduscm mcp: ${error.message}\n`);
    process.exit(1);
  }
}
