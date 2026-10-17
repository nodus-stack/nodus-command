/**
 * Modo no interactivo: lo activa el servidor MCP (y CI) con
 * NODUSCM_NON_INTERACTIVE=1. En ese modo ningún comando debe preguntar ni
 * pedir sudo: se omite el paso y se avisa en la salida.
 */
export function isInteractive() {
  if (process.env.NODUSCM_NON_INTERACTIVE === '1') return false;
  return Boolean(process.stdin.isTTY);
}
