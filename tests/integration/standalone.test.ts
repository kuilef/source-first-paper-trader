// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, createFetchMock } from "miniflare";
import { buildStandalone } from "../../scripts/build-standalone";

let directory: string;
let code: string;
let runtime: Miniflare | undefined;
const assets = {
  "index.html": "<!doctype html><title>Evidence ✓</title>\n",
  "assets/app.js": "console.log('Evidence ✓');\n",
  "assets/app.css": "body { color: teal; }\n",
  "favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  "release.json": '{"sourceCommit":"fixture-revision"}\n',
  "third-party-licenses.txt": "MIT fixture notice\n",
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "source-first-standalone-"));
  await mkdir(join(directory, "assets"));
  for (const [path, body] of Object.entries(assets))
    await writeFile(join(directory, path), body);
  await writeFile(join(directory, "_routes.json"), "{}\n");
  await writeFile(join(directory, "_worker.js"), "not a public resource\n");
  const output = join(directory, "output", "worker.mjs");
  await buildStandalone({ assetsDirectory: directory, outfile: output });
  code = await readFile(output, "utf8");
});
afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup() {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  runtime = new Miniflare({
    modules: true,
    script: code,
    compatibilityDate: "2026-07-01",
    cf: false,
    fetchMock,
  });
  return { runtime, fetchMock };
}

describe("self-contained Worker release", () => {
  it("is LF-terminated UTF-8 module code under 3 MiB", () => {
    expect(code.endsWith("\n")).toBe(true);
    expect(Buffer.byteLength(code)).toBeLessThan(3 * 1024 * 1024);
    expect(code).toContain("export{");
  });
  it("serves exact public bytes and HEAD without any asset binding", async () => {
    const { runtime } = setup();
    for (const [path, body] of Object.entries(assets)) {
      const get = await runtime.dispatchFetch("https://paper.example/" + path);
      expect(get.status).toBe(200);
      expect(await get.text()).toBe(body);
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get.headers.get("content-security-policy")).toContain(
        "connect-src 'self'",
      );
      const head = await runtime.dispatchFetch(
        "https://paper.example/" + path,
        { method: "HEAD" },
      );
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("content-type")).toBe(
        get.headers.get("content-type"),
      );
    }
    expect(
      await (await runtime.dispatchFetch("https://paper.example/")).text(),
    ).toBe(assets["index.html"]);
    const logo = await runtime.dispatchFetch("https://paper.example/logo.png");
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect((await logo.arrayBuffer()).byteLength).toBe(13136);
    const favicon = await runtime.dispatchFetch(
      "https://paper.example/favicon.ico",
    );
    const iconBytes = await readFile("branding/favicon.ico");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toBe("image/x-icon");
    expect(Buffer.from(await favicon.arrayBuffer())).toEqual(iconBytes);
    const iconHead = await runtime.dispatchFetch(
      "https://paper.example/favicon.ico",
      { method: "HEAD" },
    );
    expect(iconHead.status).toBe(200);
    expect(iconHead.headers.get("content-length")).toBe(
      String(iconBytes.length),
    );
    expect(iconHead.headers.get("content-type")).toBe("image/x-icon");
    expect(await iconHead.text()).toBe("");
  });
  it("rejects invalid, private, unknown paths and disallowed methods", async () => {
    const { runtime } = setup();
    for (const path of [
      "/_worker.js",
      "/_routes.json",
      "/__proto__",
      "/missing",
      "/index.html/",
    ]) {
      const result = await runtime.dispatchFetch(
        "https://paper.example" + path,
      );
      expect(result.status).toBe(404);
      expect(result.headers.get("x-frame-options")).toBe("DENY");
    }
    expect(
      (await runtime.dispatchFetch("https://paper.example/%zz")).status,
    ).toBe(400);
    expect(
      (
        await runtime.dispatchFetch("https://paper.example/", {
          method: "POST",
        })
      ).status,
    ).toBe(405);
  });
  it("keeps the fixed-source proxy, original cache observations and input restrictions", async () => {
    const { runtime, fetchMock } = setup();
    fetchMock
      .get("https://blog.kraken.com")
      .intercept({
        method: "GET",
        path: "/category/product/asset-listings/feed",
      })
      .reply(200, "<rss>fixture</rss>");
    const first = await runtime.dispatchFetch(
      "https://paper.example/api/listings",
    );
    const observed = first.headers.get("x-source-observed-at");
    expect(await first.text()).toBe("<rss>fixture</rss>");
    const second = await runtime.dispatchFetch(
      "https://paper.example/api/listings",
    );
    expect(second.headers.get("x-source-observed-at")).toBe(observed);
    expect(await second.text()).toBe("<rss>fixture</rss>");
    for (const [route, target] of [
      ["pairs", "AssetPairs?assetVersion=1&pair=ZCHFUSD"],
      ["ticker", "Ticker?pair=ZCHFUSD"],
    ]) {
      fetchMock
        .get("https://api.kraken.com")
        .intercept({ method: "GET", path: "/0/public/" + target })
        .reply(200, "{}");
      expect(
        await (
          await runtime.dispatchFetch(
            "https://paper.example/api/" + route + "?pair=ZCHFUSD",
          )
        ).text(),
      ).toBe("{}");
    }
    expect(
      (
        await runtime.dispatchFetch(
          "https://paper.example/api/ticker?pair=https://untrusted.example",
        )
      ).status,
    ).toBe(400);
    fetchMock.assertNoPendingInterceptors();
  });
  it("fails packaging rather than corrupting binary input", async () => {
    const invalid = await mkdtemp(join(tmpdir(), "source-first-invalid-"));
    try {
      await writeFile(join(invalid, "index.html"), new Uint8Array([255]));
      await writeFile(join(invalid, "release.json"), "{}\n");
      await expect(
        buildStandalone({
          assetsDirectory: invalid,
          outfile: join(invalid, "out.mjs"),
        }),
      ).rejects.toThrow();
    } finally {
      await rm(invalid, { recursive: true, force: true });
    }
  });
});
