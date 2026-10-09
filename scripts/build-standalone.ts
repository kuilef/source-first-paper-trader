import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** Package trusted build outputs without changing the ordinary Pages directory. */
export async function buildStandalone(options: {
  assetsDirectory: string;
  outfile: string;
}): Promise<void> {
  const root = resolve(options.assetsDirectory);
  const assets: Array<[string, { body: string; contentType: string }]> = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = resolve(entry.parentPath, entry.name);
    const path = relative(root, file).split(sep).join("/");
    if (
      ["_worker.js", "_routes.json"].includes(path) ||
      file === resolve(options.outfile)
    )
      continue;
    const contentType = contentTypes[extname(path)];
    if (!contentType) throw new Error(`Unsupported public text asset: ${path}`);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(file),
    );
    assets.push(["/" + path, { body, contentType }]);
  }
  assets.sort(([a], [b]) => a.localeCompare(b, "en"));
  if (
    !["/index.html", "/release.json"].every((path) =>
      assets.some(([key]) => key === path),
    )
  )
    throw new Error("Build the app before packaging its standalone Worker.");
  // Asset strings are JSON-encoded, never interpolated as executable markup.
  const contents = `import worker from ${JSON.stringify(resolve(repository, "worker/index.ts"))};
const assets = new Map(${JSON.stringify(assets)});
export default {
  fetch(request) {
    return worker.fetch(request, { ASSETS: { fetch: async (assetRequest) => {
      let path;
      try { path = decodeURIComponent(new URL(assetRequest.url).pathname); }
      catch { return new Response('Invalid path', { status: 400 }); }
      const asset = assets.get(path === '/' ? '/index.html' : path);
      if (!asset) return new Response('Not found', { status: 404 });
      return new Response(assetRequest.method === 'HEAD' ? null : asset.body, {
        headers: { 'content-type': asset.contentType }
      });
    } } });
  }
};`;
  const result = await build({
    stdin: { contents, loader: "js", resolveDir: repository },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    minify: true,
  });
  const code = result.outputFiles[0].text.replace(/\n?$/, "\n");
  if (Buffer.byteLength(code) >= 3 * 1024 * 1024)
    throw new Error(
      "Standalone Worker exceeds the project's 3 MiB raw size bound.",
    );
  await mkdir(dirname(resolve(options.outfile)), { recursive: true });
  await writeFile(options.outfile, code, "utf8");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildStandalone({
    assetsDirectory: "dist",
    outfile: "artifacts/source-first-worker.mjs",
  });
  console.log("Standalone module Worker: artifacts/source-first-worker.mjs");
}
