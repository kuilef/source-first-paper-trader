import { it, expect } from "vitest";
import { createPublicClient } from "../../src/sources/client";
const now = () => new Date("2026-10-09T12:00:00.000Z");
it("uses only same-origin fixed endpoints, validates receipts and spaces requests", async () => {
  const urls: string[] = [],
    waits: number[] = [];
  const c = createPublicClient({
    now,
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetch: async (input) => {
      urls.push(String(input));
      return new Response("{}", {
        headers: {
          "x-source-observed-at": now().toISOString(),
          "x-source-url":
            "https://api.kraken.com/0/public/AssetPairs?assetVersion=1&pair=ZCHFUSD",
        },
      });
    },
  });
  const v = await c.pairs("ZCHFUSD");
  await c.pairs("ZCHFUSD");
  expect(v.receipt.observedAt).toBe(now().toISOString());
  expect(urls).toEqual(["/api/pairs?pair=ZCHFUSD", "/api/pairs?pair=ZCHFUSD"]);
  expect(waits[0]).toBe(1000);
});
it("does not accept a spoofed or missing receipt", async () => {
  const c = createPublicClient({
    now,
    sleep: async () => {},
    fetch: async () => new Response("{}"),
  });
  await expect(c.pairs("ZCHFUSD")).rejects.toThrow(/receipt/i);
});
it("retries temporary failure once and never substitutes a fixture", async () => {
  let calls = 0;
  const c = createPublicClient({
    now,
    sleep: async () => {},
    fetch: async () => {
      calls++;
      return new Response("unavailable", { status: 503 });
    },
  });
  await expect(c.listings()).rejects.toThrow();
  expect(calls).toBe(2);
});
it("rejects arbitrary destination inputs before any fetch", async () => {
  let calls = 0;
  const c = createPublicClient({
    now,
    sleep: async () => {},
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  await expect(c.ticker("https://evil.test")).rejects.toThrow();
  expect(calls).toBe(0);
});
it("records actual receipt time separately from a cached upstream observation", async () => {
  const c = createPublicClient({
    now: () => new Date("2026-10-09T12:00:05.000Z"),
    sleep: async () => {},
    fetch: async () =>
      new Response("{}", {
        headers: {
          "x-source-observed-at": "2026-10-09T12:00:00.000Z",
          "x-source-url":
            "https://api.kraken.com/0/public/AssetPairs?assetVersion=1&pair=ZCHFUSD",
        },
      }),
  });
  const result = await c.pairs("ZCHFUSD");
  expect(result.receivedAt).toBe("2026-10-09T12:00:05.000Z");
  expect(result.receipt.observedAt).toBe("2026-10-09T12:00:00.000Z");
});
