// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFetchMock, Miniflare, Response as RuntimeResponse, type Request as RuntimeRequest } from 'miniflare';

let workerCode: string;
let runtime: Miniflare | undefined;

beforeAll(() => {
  // Exercise exactly the bundle script used after Vite in the release build.
  execFileSync(process.execPath, ['scripts/build-worker.mjs'], { cwd: process.cwd() });
  workerCode = readFileSync('dist/_worker.js', 'utf8');
});

afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

function setup() {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  runtime = new Miniflare({
    modules: true, script: workerCode, compatibilityDate: '2026-07-30',
    cf: false, fetchMock,
    serviceBindings: { ASSETS: async () => new RuntimeResponse('<html>Source-First Paper Trader</html>', { headers: { 'content-type': 'text/html' } }) },
  });
  return { runtime, fetchMock };
}

describe('production bundle in the actual workerd runtime', () => {
  it('proxies raw RSS and preserves its original observation in the real Cache API', async () => {
    const { runtime, fetchMock } = setup();
    fetchMock.get('https://blog.kraken.com').intercept({ method: 'GET', path: '/category/product/asset-listings/feed' })
      .reply(200, '<rss>fixture bytes</rss>', { headers: { age: '21' } });
    const first = await runtime.dispatchFetch('https://paper.example/api/listings');
    expect(first.status).toBe(200);
    const firstObserved = first.headers.get('x-source-observed-at');
    expect(firstObserved).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(await first.text()).toBe('<rss>fixture bytes</rss>');
    // There is deliberately no second upstream interceptor: this must hit Cache API.
    const second = await runtime.dispatchFetch('https://paper.example/api/listings');
    expect(second.status).toBe(200);
    expect(second.headers.get('x-source-observed-at')).toBe(firstObserved);
    expect(second.headers.get('x-source-age')).toBe('21');
    expect(second.headers.get('x-source-url')).toBe('https://blog.kraken.com/category/product/asset-listings/feed');
    expect(await second.text()).toBe('<rss>fixture bytes</rss>');
    fetchMock.assertNoPendingInterceptors();
  });

  it('constructs the exact bounded pair and ticker destinations', async () => {
    const { runtime, fetchMock } = setup();
    const api = fetchMock.get('https://api.kraken.com');
    api.intercept({ method: 'GET', path: '/0/public/AssetPairs?assetVersion=1&pair=PNT%2FUSD' }).reply(200, '{unparsed-pairs');
    api.intercept({ method: 'GET', path: '/0/public/Ticker?pair=PNT%2FUSD' }).reply(200, '{unparsed-ticker');
    const pairs = await runtime.dispatchFetch('https://paper.example/api/pairs?pair=PNT%2FUSD');
    const ticker = await runtime.dispatchFetch('https://paper.example/api/ticker?pair=PNT%2FUSD');
    expect(pairs.status).toBe(200);
    expect(await pairs.text()).toBe('{unparsed-pairs');
    expect(ticker.status).toBe(200);
    expect(await ticker.text()).toBe('{unparsed-ticker');
    expect(ticker.headers.get('cache-control')).toBe('public, max-age=15');
    fetchMock.assertNoPendingInterceptors();
  });

  it('uses manual redirect rejection supported by workerd and never caches the failure', async () => {
    const outgoing: string[] = [];
    // Miniflare's fetchMock bridge itself follows redirects in Node. A direct
    // outbound service lets workerd receive the 302 and exercise redirect:manual.
    runtime = new Miniflare({
      modules: true, script: workerCode, compatibilityDate: '2026-07-30', cf: false,
      outboundService: async (request: RuntimeRequest) => {
        outgoing.push(request.url);
        return outgoing.length === 1
          ? new RuntimeResponse('', { status: 302, headers: { location: 'https://untrusted.example/private' } })
          : new RuntimeResponse('{"error":[],"result":{}}');
      },
    });
    const failed = await runtime.dispatchFetch('https://paper.example/api/ticker?pair=XBTUSD');
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: { code: 'UPSTREAM_REDIRECT' } });
    expect(outgoing).toEqual(['https://api.kraken.com/0/public/Ticker?pair=XBTUSD']);
    const recovered = await runtime.dispatchFetch('https://paper.example/api/ticker?pair=XBTUSD');
    expect(recovered.status).toBe(200);
    expect(outgoing).toEqual(Array(2).fill('https://api.kraken.com/0/public/Ticker?pair=XBTUSD'));
  });

  it('enforces the ticker byte limit in workerd', async () => {
    const { runtime, fetchMock } = setup();
    fetchMock.get('https://api.kraken.com').intercept({ method: 'GET', path: '/0/public/Ticker?pair=XBTUSD' })
      .reply(200, 'x'.repeat(64 * 1024 + 1));
    const result = await runtime.dispatchFetch('https://paper.example/api/ticker?pair=XBTUSD');
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({ error: { code: 'UPSTREAM_TOO_LARGE' } });
    expect(result.headers.get('cache-control')).toBe('no-store');
    fetchMock.assertNoPendingInterceptors();
  });

  it('returns 504 after the production ten-second upstream deadline', async () => {
    const { runtime, fetchMock } = setup();
    fetchMock.get('https://api.kraken.com').intercept({ method: 'GET', path: '/0/public/Ticker?pair=SLOWUSD' })
      .reply(200, '{}').delay(11_000);
    const result = await runtime.dispatchFetch('https://paper.example/api/ticker?pair=SLOWUSD');
    expect(result.status).toBe(504);
    expect(await result.json()).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(result.headers.get('cache-control')).toBe('no-store');
    fetchMock.assertNoPendingInterceptors();
  }, 15_000);

  it('rejects methods and URL-shaped input before any runtime fetch', async () => {
    const { runtime } = setup();
    const method = await runtime.dispatchFetch('https://paper.example/api/listings', { method: 'POST' });
    const input = await runtime.dispatchFetch('https://paper.example/api/ticker?pair=https%3A%2F%2Flocalhost');
    const unknown = await runtime.dispatchFetch('https://paper.example/api/proxy?url=https://localhost');
    expect(method.status).toBe(405);
    expect(input.status).toBe(400);
    expect(unknown.status).toBe(404);
  });

  it('serves the assets binding with restrictive same-origin security headers', async () => {
    const { runtime } = setup();
    const result = await runtime.dispatchFetch('https://paper.example/');
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('Source-First Paper Trader');
    expect(result.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('x-frame-options')).toBe('DENY');
    const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8'));
    expect(routes).toMatchObject({ version: 1, include: ['/*'], exclude: [] });
  });
});
