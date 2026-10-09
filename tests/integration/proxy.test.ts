// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxyHandler, type CacheLike } from "../../worker/proxy";

const START = Date.parse("2026-10-09T12:00:00.000Z");
const request = (path: string, init?: RequestInit) =>
  new Request(`https://paper.example${path}`, init);
const responseBody = "<rss>Unparsed official bytes &amp; text</rss>";

class MemoryCache implements CacheLike {
  entries = new Map<string, Response>();
  async match(key: Request) {
    return this.entries.get(key.url)?.clone();
  }
  async put(key: Request, value: Response) {
    this.entries.set(key.url, value.clone());
  }
}

function setup(body = responseBody, headers: HeadersInit = {}) {
  const upstream = vi.fn<typeof fetch>(
    async () => new Response(body, { headers }),
  );
  const cache = new MemoryCache();
  const handle = createProxyHandler({
    fetch: upstream,
    cache,
    now: () => START,
  });
  return { upstream, cache, handle };
}

afterEach(() => vi.useRealTimers());

describe("fixed source allowlist", () => {
  it.each([
    [
      "/api/listings",
      "https://blog.kraken.com/category/product/asset-listings/feed",
      "application/rss+xml; charset=utf-8",
      300,
    ],
    [
      "/api/pairs?pair=PNT%2FUSD",
      "https://api.kraken.com/0/public/AssetPairs?assetVersion=1&pair=PNT%2FUSD",
      "application/json; charset=utf-8",
      300,
    ],
    [
      "/api/ticker?pair=XBTUSD",
      "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
      "application/json; charset=utf-8",
      15,
    ],
  ])(
    "fetches only the fixed endpoint for %s",
    async (path, expectedUrl, contentType, ttl) => {
      const { handle, upstream, cache } = setup();
      const result = await handle(
        request(path as string, {
          headers: {
            cookie: "session=private",
            authorization: "Bearer private",
          },
        }),
      );
      expect(result.status).toBe(200);
      expect(await result.text()).toBe(responseBody);
      expect(upstream).toHaveBeenCalledOnce();
      const [url, init] = upstream.mock.calls[0]!;
      expect(String(url)).toBe(expectedUrl);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(new Headers(init?.headers).has("cookie")).toBe(false);
      expect(result.headers.get("content-type")).toBe(contentType);
      expect(result.headers.get("x-source-url")).toBe(expectedUrl);
      expect(result.headers.get("x-source-observed-at")).toBe(
        "2026-10-09T12:00:00.000Z",
      );
      expect([...cache.entries.values()][0]?.headers.get("cache-control")).toBe(
        `public, max-age=${ttl}`,
      );
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "rejects %s on API routes without fetching",
    async (method) => {
      const { handle, upstream } = setup();
      const result = await handle(request("/api/listings", { method }));
      expect(result.status).toBe(405);
      expect(result.headers.get("allow")).toBe("GET");
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/api/pairs",
    "/api/ticker",
    "/api/ticker?pair=",
    "/api/ticker?pair=A&pair=B",
    "/api/pairs?pair=BTCUSD&assetVersion=1",
    "/api/ticker?pair=BTCUSD&url=https://evil.example",
    "/api/listings?url=https://evil.example",
    "/api/listings?pair=BTCUSD",
    "/api/ticker?pair=https%3A%2F%2Fevil.example",
    "/api/ticker?pair=BTC%26USD",
    "/api/ticker?pair=BTC%20USD",
    "/api/ticker?pair=BT%C3%87USD",
    "/api/ticker?pair=%250a",
    "/api/ticker?pair=%0d%0aHost%3Aevil.example",
    `/api/pairs?pair=${"A".repeat(41)}`,
    "/api/pairs?pair=A,B",
  ])("rejects invalid query %s before upstream access", async (path) => {
    const { handle, upstream } = setup();
    const result = await handle(request(path));
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe("INVALID_QUERY");
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    "/api",
    "/api/",
    "/api/unknown",
    "/api/ticker/",
    "/api/%74icker?pair=BTCUSD",
    "/api/listings/feed",
    "/api/%2e%2e%2flistings",
    "/api/listings%2f..",
    "/api/https://evil.example",
  ])("rejects unknown API path %s", async (path) => {
    const { handle, upstream } = setup();
    const assets = { fetch: vi.fn(async () => new Response("app")) };
    const result = await handle(request(path), { ASSETS: assets });
    expect(result.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("accepts the maximum pair length but cannot turn it into a destination", async () => {
    const { handle, upstream } = setup();
    const pair = "A".repeat(40);
    expect((await handle(request(`/api/ticker?pair=${pair}`))).status).toBe(
      200,
    );
    expect(String(upstream.mock.calls[0]![0])).toBe(
      `https://api.kraken.com/0/public/Ticker?pair=${pair}`,
    );
  });
});

describe("original source receipts and safe cache", () => {
  it("preserves the initial receipt and upstream age on a cache hit", async () => {
    let now = START;
    const cache = new MemoryCache();
    const upstream = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          headers: { age: "42", "set-cookie": "private=true" },
        }),
    );
    const handle = createProxyHandler({
      fetch: upstream,
      cache,
      now: () => now,
    });
    const first = await handle(request("/api/ticker?pair=XBTUSD"));
    now += 8_000;
    const second = await handle(request("/api/ticker?pair=XBTUSD"));
    expect(upstream).toHaveBeenCalledOnce();
    expect(second.headers.get("x-source-observed-at")).toBe(
      first.headers.get("x-source-observed-at"),
    );
    expect(second.headers.get("x-source-age")).toBe("42");
    expect(second.headers.has("set-cookie")).toBe(false);
    expect(second.headers.get("x-source-cache-age")).toBe("8");
  });

  it.each(["-1", "1.5", "invalid", "1e6", "9007199254740992"])(
    "does not fabricate valid source age for %s",
    async (age) => {
      const { handle } = setup("{}", { age });
      const result = await handle(request("/api/ticker?pair=XBTUSD"));
      expect(result.status).toBe(200);
      expect(result.headers.has("x-source-age")).toBe(false);
    },
  );

  it.each([
    ["/api/listings", 300],
    ["/api/pairs?pair=BTCUSD", 300],
    ["/api/ticker?pair=BTCUSD", 15],
  ])(
    "does not serve %s beyond its original cache lifetime",
    async (path, ttl) => {
      let now = START;
      const cache = new MemoryCache();
      const upstream = vi.fn<typeof fetch>(
        async () => new Response("{}", { headers: { age: "0" } }),
      );
      const handle = createProxyHandler({
        fetch: upstream,
        cache,
        now: () => now,
      });
      await handle(request(path as string));
      now += (ttl as number) * 1000;
      const result = await handle(request(path as string));
      expect(result.status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
      expect(result.headers.get("x-source-observed-at")).toBe(
        new Date(now).toISOString(),
      );
      expect(result.headers.get("x-source-age")).toBe("0");
    },
  );

  it("keeps source availability when the edge cache fails", async () => {
    const cache: CacheLike = {
      match: async () => {
        throw new Error("cache offline");
      },
      put: async () => {
        throw new Error("cache full");
      },
    };
    const handle = createProxyHandler({
      cache,
      fetch: async () => new Response("{}"),
      now: () => START,
    });
    expect((await handle(request("/api/pairs?pair=BTCUSD"))).status).toBe(200);
  });
});

describe("bounded requests and honest failures", () => {
  it.each([301, 302, 303, 307, 308])(
    "rejects upstream redirect %s without visiting its target",
    async (status) => {
      const upstream = vi.fn<typeof fetch>(
        async () =>
          new Response(null, {
            status,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
      );
      const cache = new MemoryCache();
      const result = await createProxyHandler({ fetch: upstream, cache })(
        request("/api/listings"),
      );
      expect(result.status).toBe(502);
      expect((await result.json()).error.code).toBe("UPSTREAM_REDIRECT");
      expect(upstream).toHaveBeenCalledOnce();
      expect(cache.entries.size).toBe(0);
    },
  );

  it.each([404, 500, 503])(
    "reports upstream %s without leaking or caching its body",
    async (status) => {
      const cache = new MemoryCache();
      const handle = createProxyHandler({
        fetch: async () => new Response("secret diagnostic", { status }),
        cache,
      });
      const result = await handle(request("/api/listings"));
      expect(result.status).toBe(502);
      expect(await result.text()).not.toContain("secret diagnostic");
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(cache.entries.size).toBe(0);
    },
  );

  it("returns a bounded retry-after for upstream rate limiting", async () => {
    const cache = new MemoryCache();
    const handle = createProxyHandler({
      fetch: async () =>
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "20" },
        }),
      cache,
    });
    const result = await handle(request("/api/listings"));
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("20");
    expect((await result.json()).error.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(cache.entries.size).toBe(0);
  });

  it("reports an unavailable source on a network error", async () => {
    const handle = createProxyHandler({
      fetch: async () => {
        throw new Error("internal network diagnostics");
      },
    });
    const result = await handle(request("/api/listings"));
    expect(result.status).toBe(502);
    expect((await result.json()).error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it.each([
    ["/api/listings", 256 * 1024],
    ["/api/pairs?pair=BTCUSD", 2 * 1024 * 1024],
    ["/api/ticker?pair=BTCUSD", 64 * 1024],
  ])("stops chunked overflow for %s", async (path, limit) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(limit as number));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const cache = new MemoryCache();
    const handle = createProxyHandler({
      fetch: async () => new Response(stream),
      cache,
    });
    const result = await handle(request(path as string));
    expect(result.status).toBe(502);
    expect((await result.json()).error.code).toBe("UPSTREAM_TOO_LARGE");
    expect(cancel).toHaveBeenCalled();
    expect(cache.entries.size).toBe(0);
  });

  it("rejects oversized content-length before reading the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    const handle = createProxyHandler({
      fetch: async () =>
        new Response(body, { headers: { "content-length": "262145" } }),
    });
    const result = await handle(request("/api/listings"));
    expect(result.status).toBe(502);
    expect((await result.json()).error.code).toBe("UPSTREAM_TOO_LARGE");
    expect(cancel).toHaveBeenCalled();
  });

  it("accepts a body exactly at its limit without parsing it", async () => {
    const body = "x".repeat(64 * 1024);
    const { handle } = setup(body);
    const result = await handle(request("/api/ticker?pair=BTCUSD"));
    expect(result.status).toBe(200);
    expect((await result.text()).length).toBe(64 * 1024);
  });

  it("aborts stalled fetches after ten seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined | null;
    const handle = createProxyHandler({
      fetch: async (_url, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      },
    });
    const pending = handle(request("/api/listings"));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect((await result.json()).error.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("applies the deadline while streaming a stalled body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const handle = createProxyHandler({
      fetch: async () => new Response(body),
    });
    const pending = handle(request("/api/listings"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(504);
    expect(cancel).toHaveBeenCalled();
  });
});

describe("assets and defensive headers", () => {
  it("serves ASSETS without upstream access and secures all responses", async () => {
    const { handle, upstream } = setup();
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("<html>Application</html>", {
            headers: { "content-type": "text/html" },
          }),
      ),
    };
    const result = await handle(request("/replay"), { ASSETS: assets });
    expect(result.status).toBe(200);
    expect(await result.text()).toContain("Application");
    expect(upstream).not.toHaveBeenCalled();
    expect(result.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(result.headers.get("content-security-policy")).not.toContain(
      "unsafe-eval",
    );
    expect(result.headers.get("content-security-policy")).not.toContain(
      "unsafe-inline",
    );
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("x-frame-options")).toBe("DENY");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(result.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("returns an explicit missing asset response when no binding exists", async () => {
    const { handle } = setup();
    const result = await handle(request("/"));
    expect(result.status).toBe(404);
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("secures API error responses as well as success", async () => {
    const { handle } = setup();
    const result = await handle(
      request("/api/ticker?url=https://evil.example"),
    );
    expect(result.headers.get("x-frame-options")).toBe("DENY");
    expect(result.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });
});

describe("embedded project logo", () => {
  it("serves the unchanged 512px PNG with security headers without upstream or assets", async () => {
    const { handle, upstream, cache } = setup();
    const result = await handle(request("/logo.png"));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("image/png");
    expect(result.headers.get("content-length")).toBe("13136");
    expect(result.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(result.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("x-frame-options")).toBe("DENY");
    const bytes = new Uint8Array(await result.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(512);
    expect(new DataView(bytes.buffer).getUint32(20)).toBe(512);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "e93e5496a201507a123fdb41f200ea116800cf471454529eaebb2bf7099e2f68",
    );
    expect(upstream).not.toHaveBeenCalled();
    expect(cache.entries.size).toBe(0);
  });
  it("returns the same headers but no body for HEAD", async () => {
    const { handle } = setup();
    const get = await handle(request("/logo.png"));
    const head = await handle(request("/logo.png", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(await head.text()).toBe("");
  });
  it.each(["POST", "PUT", "DELETE", "OPTIONS"])(
    "rejects %s without upstream access",
    async (method) => {
      const { handle, upstream } = setup();
      const result = await handle(request("/logo.png", { method }));
      expect(result.status).toBe(405);
      expect(result.headers.get("allow")).toBe("GET, HEAD");
      expect(result.headers.get("x-content-type-options")).toBe("nosniff");
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it.each(["/logo.png/", "/LOGO.png", "/%6cogo.png", "/not/logo.png"])(
    "does not serve the logo for a different path: %s",
    async (path) => {
      const { handle } = setup();
      expect((await handle(request(path))).status).toBe(404);
    },
  );
  it("treats a query string as the same static logo without forwarding it", async () => {
    const { handle, upstream } = setup();
    const result = await handle(request("/logo.png?v=1"));
    expect(result.headers.get("content-type")).toBe("image/png");
    expect((await result.arrayBuffer()).byteLength).toBe(13136);
    expect(upstream).not.toHaveBeenCalled();
  });
});
