import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createProxyHandler } from "../../worker/proxy";

describe("downloadable repository branding", () => {
  it("keeps the original PNG bytes and the public SVG available as ordinary files", async () => {
    const png = readFileSync("branding/logo.png");
    expect(createHash("sha256").update(png).digest("hex")).toBe(
      "e93e5496a201507a123fdb41f200ea116800cf471454529eaebb2bf7099e2f68",
    );
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    const response = await createProxyHandler()(
      new Request("https://paper.example/logo.png"),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(readFileSync("branding/favicon.svg")).toEqual(
      readFileSync("public/favicon.svg"),
    );
  });

  it("contains a real ICO with six bounded, correctly sized PNG entries", () => {
    const ico = readFileSync("branding/favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes = [16, 32, 48, 64, 128, 256];
    expect(ico.readUInt16LE(4)).toBe(sizes.length);
    let expectedOffset = 6 + sizes.length * 16;
    sizes.forEach((size, index) => {
      const entry = 6 + index * 16;
      expect(ico[entry] || 256).toBe(size);
      expect(ico[entry + 1] || 256).toBe(size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset).toBe(expectedOffset);
      expect(length).toBeGreaterThan(24);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      const png = ico.subarray(offset, offset + length);
      expect([...png.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expectedOffset += length;
    });
    expect(expectedOffset).toBe(ico.length);
  });
});

describe("embedded website favicon", () => {
  it("serves exact ICO bytes with matching GET/HEAD metadata and no upstream access", async () => {
    const upstream = vi.fn<typeof fetch>();
    const assets = { fetch: vi.fn<typeof fetch>() };
    const handle = createProxyHandler({ fetch: upstream });
    const get = await handle(
      new Request("https://paper.example/favicon.ico?v=1"),
      {
        ASSETS: assets,
      },
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/x-icon");
    expect(get.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(get.headers.get("content-security-policy")).toContain(
      "img-src 'self'",
    );
    expect(get.headers.get("x-frame-options")).toBe("DENY");
    const bytes = Buffer.from(await get.arrayBuffer());
    expect(bytes).toEqual(readFileSync("branding/favicon.ico"));
    expect(get.headers.get("content-length")).toBe(String(bytes.length));
    const head = await handle(
      new Request("https://paper.example/favicon.ico", { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(await head.text()).toBe("");
    expect(upstream).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "DELETE", "OPTIONS"])(
    "rejects %s",
    async (method) => {
      const response = await createProxyHandler()(
        new Request("https://paper.example/favicon.ico", { method }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    },
  );

  it.each([
    "/favicon.ico/",
    "/FAVICON.ico",
    "/%66avicon.ico",
    "/not/favicon.ico",
  ])("does not match a different path: %s", async (path) => {
    const response = await createProxyHandler()(
      new Request(`https://paper.example${path}`),
    );
    expect(response.status).toBe(404);
  });
});
