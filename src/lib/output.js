import chalk from 'chalk';

/**
 * Contrato de salida JSON/NDJSON del CLI (SDD-001 §3).
 *
 * - Instantáneo: un solo envelope { ok, code, data, error, message } en stdout.
 * - Operación larga: una línea NDJSON por evento (log/progress/plan) y una
 *   línea final { type: 'result', ... } obligatoria.
 * - En modo json no se imprime banner, chalk, spinners ni texto humano:
 *   stdout SOLO lleva JSON. stderr queda libre para fallos de Node.
 */

/**
 * true si argv contiene --format=json | --format json | --json.
 */
export function isJsonMode(argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') return true;
    if (arg === '--format=json') return true;
    if (arg === '--format' && argv[i + 1] === 'json') return true;
  }
  return false;
}

/** true en json mode → spinners/chalk/printSummary desactivados. */
export function isQuiet(argv) {
  return isJsonMode(argv);
}

/** stdout: un solo JSON + "\n" (envelope completo). */
export function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** stdout: una línea NDJSON (solo en json mode). */
export function emitEvent(obj) {
  if (!isJsonMode()) return;
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** json mode → {type:'log',level,message,timestamp}; text mode → no-op. */
export function emitLog(level, message) {
  if (!isJsonMode()) return;
  emitEvent({ type: 'log', level, message, timestamp: new Date().toISOString() });
}

/** Línea final obligatoria de una operación larga. No-op fuera de json mode. */
export function emitResult(data, message = null) {
  emitEvent({ type: 'result', ok: true, code: 0, data: data ?? null, error: null, message });
}

/** json → {type:'plan', op, upload, download, remove, skipped}. */
export function planEvent(op, plan = {}) {
  if (!isJsonMode()) return;
  emitEvent({
    type: 'plan',
    op,
    upload: plan.upload || [],
    download: plan.download || [],
    remove: plan.remove || [],
    skipped: plan.skipped || [],
  });
}

/** json → {type:'progress',percent,current,total,message}. */
export function progressEvent(done, total, message) {
  if (!isJsonMode()) return;
  const safeTotal = Number(total) || 0;
  const current = Number(done) || 0;
  const percent = safeTotal > 0 ? Math.min(100, Math.round((current / safeTotal) * 100)) : 0;
  emitEvent({ type: 'progress', percent, current, total: safeTotal, message });
}

/**
 * Mapea un error al código de salida de la spec §3.4:
 * 0 éxito · 1 genérico · 2 conflict · 10 no autenticado · 20 runtime ausente ·
 * 30 red/API · 40 recurso/contexto no encontrado · 50 validación de argumentos.
 */
export function errorToExit(err) {
  if (!err) return 0;
  const code = typeof err.code === 'string' ? err.code : '';
  const status = typeof err.status === 'number' ? err.status : null;
  const message = err.message || '';

  if (code === 'conflict') return 2;
  if (status === 401 || status === 403 || code === 'not_authenticated') return 10;
  if (code === 'runtime_missing' || code === 'daemon_down') return 20;
  if (code === 'network_error' || code === 'bad_response' || status === 0 || (status !== null && status >= 500)) return 30;
  if (status === 404 || code === 'context_missing' || code === 'context_mismatch' || code === 'not_found' || code === 'not_managed') return 40;
  if (code === 'validation' || code === 'site_mismatch' || code === 'slug_mismatch') return 50;

  // Fallbacks por mensaje (spec §3.4: "ApiError.status, err.code, o mensaje").
  if (/^Not logged in/i.test(message)) return 10;
  if (/No theme\/plugin context/i.test(message)) return 40;
  if (/Multiple sites logged in/i.test(message)) return 50;

  return 1;
}

/**
 * Manejador único de errores.
 * - json → envelope {ok:false,...} (o {type:'result',...} con { result: true })
 *   + process.exitCode = errorToExit(err).
 * - text → chalk ✗ + código legado (1, o 2 en conflict), como hasta hoy.
 */
export function fail(err, { result = false } = {}) {
  const json = isJsonMode();
  const code = json ? errorToExit(err) : err?.code === 'conflict' ? 2 : 1;
  const message = err?.message || String(err);
  const error = typeof err?.code === 'string' ? err.code : err?.name || 'Error';

  if (json) {
    const envelope = { ok: false, code, data: null, error, message };
    if (result) emitEvent({ type: 'result', ...envelope });
    else emitJson(envelope);
  } else {
    console.log(chalk.red(`\n❌ ${message}\n`));
  }
  process.exitCode = code;
}
