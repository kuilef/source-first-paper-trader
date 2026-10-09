/** A raw, bounded public-source proxy. Parsing and trading policy stay in the browser. */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
export interface ProxyEnvironment { ASSETS?: { fetch(request: Request): Promise<Response> } }
export interface ProxyOptions {
  fetch?: typeof globalThis.fetch;
  cache?: CacheLike;
  now?: () => number;
  timeoutMs?: number;
}

interface SourceRoute { url: string; contentType: string; maxBytes: number; ttl: number }

const RSS_URL = 'https://blog.kraken.com/category/product/asset-listings/feed';
const API_ROOT = 'https://api.kraken.com/0/public/';
const JSON_TYPE = 'application/json; charset=utf-8';
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
} as const;

class SourceFailure extends Error {
  constructor(readonly code: string, message: string, readonly status = 502, readonly retryAfter?: string) {
    super(message);
    this.name = 'SourceFailure';
  }
}

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(status: number, code: string, message: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', JSON_TYPE);
  headers.set('cache-control', 'no-store');
  return secure(new Response(JSON.stringify({ error: { code, message } }), { status, headers }));
}

function sourceRoute(url: URL): SourceRoute | Response {
  if (!['/api/listings', '/api/pairs', '/api/ticker'].includes(url.pathname)) {
    return errorResponse(404, 'NOT_FOUND', 'Unknown public-source route.');
  }
  const parameters = [...url.searchParams];
  if (url.pathname === '/api/listings') {
    if (parameters.length !== 0 || url.hash) return errorResponse(400, 'INVALID_QUERY', 'The listings route takes no parameters.');
    return { url: RSS_URL, contentType: 'application/rss+xml; charset=utf-8', maxBytes: 256 * 1024, ttl: 300 };
  }
  if (parameters.length !== 1 || parameters[0]?.[0] !== 'pair' || !/^[A-Za-z0-9/]{1,40}$/.test(parameters[0]?.[1] ?? '') || url.hash) {
    return errorResponse(400, 'INVALID_QUERY', 'Supply exactly one pair of 1–40 ASCII letters, digits, or slashes.');
  }
  const isPairs = url.pathname === '/api/pairs';
  const query = new URLSearchParams(isPairs ? { assetVersion: '1', pair: parameters[0][1] } : { pair: parameters[0][1] });
  return {
    url: `${API_ROOT}${isPairs ? 'AssetPairs' : 'Ticker'}?${query}`,
    contentType: JSON_TYPE,
    maxBytes: isPairs ? 2 * 1024 * 1024 : 64 * 1024,
    ttl: isPairs ? 300 : 15,
  };
}

function validAge(value: string | null): string | null {
  if (value === null || !/^\d{1,16}$/.test(value)) return null;
  const age = Number(value);
  return Number.isSafeInteger(age) && age >= 0 ? String(age) : null;
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new SourceFailure('UPSTREAM_TOO_LARGE', 'The source response exceeded the allowed size.');
  }
  if (!response.body) throw new SourceFailure('UPSTREAM_UNAVAILABLE', 'The source returned no response body.');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  // Fixed storage also bounds memory when a source sends many tiny chunks.
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new SourceFailure('UPSTREAM_TIMEOUT', 'The source did not respond within 10 seconds.', 504);
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        cancel();
        throw new SourceFailure('UPSTREAM_TOO_LARGE', 'The source response exceeded the allowed size.');
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    if (signal.aborted) throw new SourceFailure('UPSTREAM_TIMEOUT', 'The source did not respond within 10 seconds.', 504);
    return bytes.slice(0, size);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function fetchSource(route: SourceRoute, fetcher: typeof fetch, now: () => number, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new SourceFailure('UPSTREAM_TIMEOUT', 'The source did not respond within 10 seconds.', 504));
      controller.abort();
    }, timeoutMs);
  });
  const retrieve = async () => {
    // Do not inherit incoming headers/cookies. Manual redirect handling works in workerd.
    const upstream = await fetcher(route.url, {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: { accept: route.contentType.split(';')[0]! },
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      void upstream.body?.cancel().catch(() => {});
      throw new SourceFailure('UPSTREAM_REDIRECT', 'The fixed source attempted an unsupported redirect.');
    }
    if (upstream.status === 429) {
      void upstream.body?.cancel().catch(() => {});
      const supplied = validAge(upstream.headers.get('retry-after'));
      const retryAfter = String(Math.min(300, Math.max(1, supplied === null ? 60 : Number(supplied))));
      throw new SourceFailure('UPSTREAM_RATE_LIMITED', 'The source is rate-limiting requests. Try again later.', 429, retryAfter);
    }
    if (upstream.status !== 200) {
      void upstream.body?.cancel().catch(() => {});
      throw new SourceFailure('UPSTREAM_UNAVAILABLE', 'The source returned an unsuccessful response.');
    }
    const bytes = await readBounded(upstream, route.maxBytes, controller.signal);
    const headers = new Headers({
      'content-type': route.contentType,
      'cache-control': `public, max-age=${route.ttl}`,
      'x-source-url': route.url,
      'x-source-observed-at': new Date(now()).toISOString(),
      'x-source-cache-age': '0',
    });
    const age = validAge(upstream.headers.get('age'));
    if (age !== null) headers.set('x-source-age', age);
    return new Response(bytes, { headers });
  };
  try { return await Promise.race([retrieve(), deadline]); }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
}

export function createProxyHandler(options: ProxyOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (request: Request, env: ProxyEnvironment = {}): Promise<Response> => {
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!isApi) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Static assets support only GET and HEAD.', { allow: 'GET, HEAD' });
      if (!env.ASSETS) return errorResponse(404, 'NOT_FOUND', 'The requested asset is unavailable.');
      try { return secure(await env.ASSETS.fetch(request)); }
      catch { return errorResponse(502, 'ASSET_UNAVAILABLE', 'The requested asset could not be loaded.'); }
    }
    if (request.method !== 'GET') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Public-source routes support only GET.', { allow: 'GET' });
    const route = sourceRoute(url);
    if (route instanceof Response) return route;
    const cacheKey = new Request(`${url.origin}${url.pathname}${url.search}`, { method: 'GET' });
    try {
      const cached = await options.cache?.match(cacheKey);
      if (cached?.status === 200 && cached.headers.get('x-source-url') === route.url) {
        const observedAt = Date.parse(cached.headers.get('x-source-observed-at') ?? '');
        const elapsedMs = now() - observedAt;
        if (Number.isFinite(observedAt) && elapsedMs >= 0 && elapsedMs < route.ttl * 1000) {
          const headers = new Headers(cached.headers);
          headers.set('x-source-cache-age', String(Math.floor(elapsedMs / 1000)));
          return secure(new Response(cached.body, { headers }));
        }
      }
    } catch { /* Caching is an optimization; source access can still succeed. */ }
    try {
      const result = await fetchSource(route, fetcher, now, timeoutMs);
      try { await options.cache?.put(cacheKey, result.clone()); }
      catch { /* A cache outage must not turn available evidence into a failure. */ }
      return secure(result);
    } catch (error) {
      const failure = error instanceof SourceFailure ? error : new SourceFailure('UPSTREAM_UNAVAILABLE', 'The source could not be reached.');
      return errorResponse(failure.status, failure.code, failure.message, failure.retryAfter ? { 'retry-after': failure.retryAfter } : undefined);
    }
  };
}
