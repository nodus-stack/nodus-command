/**
 * Cliente HTTP del API REST de Nodus Jet (/wp-json/nodus-jet/v1).
 * Usa fetch nativo (Node 18+). Si /wp-json no está disponible (permalinks
 * simples), reintenta con ?rest_route=.
 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function send(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json };
}

export async function api(site, method, route, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-Nodus-Token'] = token; // fallback si el hosting elimina Authorization
  }

  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const urls = [
    `${site}/wp-json/nodus-jet/v1${route}`,
    `${site}/index.php?rest_route=/nodus-jet/v1${route}`,
  ];

  let result;
  try {
    result = await send(urls[0], init);
    if (result.json === null && result.res.status === 404) {
      result = await send(urls[1], init);
    }
  } catch (err) {
    throw new ApiError(0, 'network_error', `Could not reach ${site}: ${err.cause?.code || err.message}`);
  }

  const { res, json } = result;
  if (!res.ok) {
    const message = json?.message || `HTTP ${res.status}`;
    throw new ApiError(res.status, json?.code || 'http_error', message);
  }
  if (json === null) {
    throw new ApiError(res.status, 'bad_response', 'Unexpected non-JSON response from the site.');
  }
  return json;
}
