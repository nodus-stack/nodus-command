import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emitEvent,
  emitJson,
  emitLog,
  emitResult,
  errorToExit,
  fail,
  isJsonMode,
  isQuiet,
  planEvent,
  progressEvent,
} from '../src/lib/output.js';

const realArgv = process.argv;
let writeSpy;
let logSpy;

beforeEach(() => {
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  writeSpy.mockRestore();
  logSpy.mockRestore();
  process.argv = realArgv;
  process.exitCode = undefined;
});

function lastLine() {
  const calls = writeSpy.mock.calls.map((c) => String(c[0]));
  return JSON.parse(calls[calls.length - 1]);
}

describe('isJsonMode', () => {
  it('detects --format=json anywhere in argv', () => {
    expect(isJsonMode(['node', 'noduscm', 'theme', 'list', '--format=json'])).toBe(true);
  });

  it('detects --format json (space separated)', () => {
    expect(isJsonMode(['node', 'noduscm', '--format', 'json', 'sites'])).toBe(true);
  });

  it('detects the --json shorthand', () => {
    expect(isJsonMode(['node', 'noduscm', 'whoami', '--json'])).toBe(true);
  });

  it('is false for plain runs and other formats', () => {
    expect(isJsonMode(['node', 'noduscm', 'theme', 'list'])).toBe(false);
    expect(isJsonMode(['node', 'noduscm', '--format', 'yaml'])).toBe(false);
    expect(isJsonMode(['node', 'noduscm', '--format=yaml'])).toBe(false);
    expect(isJsonMode(['node', 'noduscm', '--jsonmode'])).toBe(false);
    expect(isJsonMode([])).toBe(false);
  });
});

describe('isQuiet', () => {
  it('mirrors json mode', () => {
    expect(isQuiet(['node', 'x', '--json'])).toBe(true);
    expect(isQuiet(['node', 'x'])).toBe(false);
  });
});

describe('emitJson', () => {
  it('writes a single JSON object plus newline to stdout', () => {
    emitJson({ ok: true, code: 0, data: { a: 1 }, error: null, message: 'done' });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][0]).toBe(
      '{"ok":true,"code":0,"data":{"a":1},"error":null,"message":"done"}\n',
    );
  });
});

describe('emitEvent / emitLog', () => {
  it('emitEvent writes one NDJSON line in json mode', () => {
    process.argv = ['node', 'x', '--json'];
    emitEvent({ type: 'log', level: 'info', message: 'hi' });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][0]).toBe('{"type":"log","level":"info","message":"hi"}\n');
  });

  it('emitEvent is a no-op outside json mode', () => {
    process.argv = ['node', 'x'];
    emitEvent({ type: 'log', level: 'info', message: 'hi' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('emitLog builds {type,level,message,timestamp} in json mode', () => {
    process.argv = ['node', 'x', '--format=json'];
    emitLog('warn', 'careful');
    const evt = lastLine();
    expect(evt.type).toBe('log');
    expect(evt.level).toBe('warn');
    expect(evt.message).toBe('careful');
    expect(Number.isNaN(Date.parse(evt.timestamp))).toBe(false);
  });

  it('emitLog is a no-op outside json mode', () => {
    process.argv = ['node', 'x'];
    emitLog('info', 'quiet');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('emitResult', () => {
  it('emits the mandatory terminal result event in json mode', () => {
    process.argv = ['node', 'x', '--json'];
    emitResult({ slug: 'a' }, 'created');
    expect(lastLine()).toEqual({
      type: 'result',
      ok: true,
      code: 0,
      data: { slug: 'a' },
      error: null,
      message: 'created',
    });
  });

  it('is a no-op outside json mode', () => {
    process.argv = ['node', 'x'];
    emitResult({ slug: 'a' }, 'created');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('planEvent', () => {
  it('normalizes the four arrays and sets op', () => {
    process.argv = ['node', 'x', '--json'];
    planEvent('push', { upload: ['style.css'], remove: ['old.css'] });
    expect(lastLine()).toEqual({
      type: 'plan',
      op: 'push',
      upload: ['style.css'],
      download: [],
      remove: ['old.css'],
      skipped: [],
    });
  });

  it('maps pull plans with download array', () => {
    process.argv = ['node', 'x', '--json'];
    planEvent('pull', { download: ['a.txt'], remove: [], skipped: [{ path: 'x', reason: 'r' }] });
    expect(lastLine()).toEqual({
      type: 'plan',
      op: 'pull',
      upload: [],
      download: ['a.txt'],
      remove: [],
      skipped: [{ path: 'x', reason: 'r' }],
    });
  });

  it('is a no-op outside json mode', () => {
    process.argv = ['node', 'x'];
    planEvent('push', { upload: [] });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('progressEvent', () => {
  it('computes percent and keeps current/total/message', () => {
    process.argv = ['node', 'x', '--json'];
    progressEvent(10, 40, 'Pushing...');
    expect(lastLine()).toEqual({
      type: 'progress',
      percent: 25,
      current: 10,
      total: 40,
      message: 'Pushing...',
    });
  });

  it('returns percent 0 for an empty total', () => {
    process.argv = ['node', 'x', '--json'];
    progressEvent(0, 0, 'x');
    expect(lastLine().percent).toBe(0);
  });

  it('is a no-op outside json mode', () => {
    process.argv = ['node', 'x'];
    progressEvent(1, 2, 'x');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('errorToExit', () => {
  it('maps every code from spec §3.4', () => {
    expect(errorToExit(null)).toBe(0); // 0 éxito
    expect(errorToExit(new Error('boom'))).toBe(1); // 1 genérico
    expect(errorToExit(Object.assign(new Error('server changed'), { code: 'conflict' }))).toBe(2); // 2 conflict
    expect(
      errorToExit(Object.assign(new Error('Not logged in to x'), { code: 'not_authenticated' })),
    ).toBe(10); // 10 no autenticado
    expect(errorToExit({ message: 'Unauthorized', status: 401 })).toBe(10);
    expect(errorToExit({ message: 'Forbidden', status: 403 })).toBe(10);
    expect(errorToExit(Object.assign(new Error('no docker'), { code: 'runtime_missing' }))).toBe(20); // 20 runtime
    expect(errorToExit(Object.assign(new Error('daemon down'), { code: 'daemon_down' }))).toBe(20);
    expect(errorToExit({ message: 'boom', status: 503 })).toBe(30); // 30 red/API
    expect(errorToExit({ message: 'bad', status: 0, code: 'network_error' })).toBe(30);
    expect(errorToExit({ message: 'nope', status: 404 })).toBe(40); // 40 no encontrado
    expect(
      errorToExit(Object.assign(new Error('No theme/plugin context in /x'), { code: 'context_missing' })),
    ).toBe(40);
    expect(
      errorToExit(Object.assign(new Error('This folder is a theme'), { code: 'context_mismatch' })),
    ).toBe(40);
    expect(errorToExit(Object.assign(new Error('--name required'), { code: 'validation' }))).toBe(50); // 50 validación
  });

  it('falls back to the message when there is no code', () => {
    expect(errorToExit(new Error('Not logged in. Run: noduscm login --site <url>'))).toBe(10);
    expect(errorToExit(new Error('No theme/plugin context in /tmp/x. Run inside...'))).toBe(40);
    expect(errorToExit(new Error('Multiple sites logged in; pass --site. (a, b)'))).toBe(50);
  });
});

describe('fail', () => {
  it('json mode: emits an envelope with the mapped code and sets exitCode', () => {
    process.argv = ['node', 'x', '--json'];
    fail(Object.assign(new Error('Not logged in to x'), { code: 'not_authenticated' }));
    expect(lastLine()).toEqual({
      ok: false,
      code: 10,
      data: null,
      error: 'not_authenticated',
      message: 'Not logged in to x',
    });
    expect(process.exitCode).toBe(10);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('json mode with { result: true }: emits a terminal result event', () => {
    process.argv = ['node', 'x', '--format=json'];
    fail(Object.assign(new Error('server changed'), { code: 'conflict' }), { result: true });
    const evt = lastLine();
    expect(evt.type).toBe('result');
    expect(evt.ok).toBe(false);
    expect(evt.code).toBe(2);
    expect(evt.error).toBe('conflict');
    expect(process.exitCode).toBe(2);
  });

  it('text mode: prints the human ✗ line and keeps legacy exit codes', () => {
    process.argv = ['node', 'x'];
    fail(Object.assign(new Error('Not logged in to x'), { code: 'not_authenticated' }));
    expect(String(logSpy.mock.calls[0][0])).toContain('Not logged in to x');
    expect(String(logSpy.mock.calls[0][0])).toContain('❌');
    expect(process.exitCode).toBe(1); // 10 solo aplica en json mode
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('text mode: conflict keeps exit code 2', () => {
    process.argv = ['node', 'x'];
    fail(Object.assign(new Error('server changed'), { code: 'conflict' }));
    expect(process.exitCode).toBe(2);
  });
});
