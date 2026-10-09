import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const standalone = process.env.STANDALONE_PREVIEW === "1";
const server = new Miniflare({
  modules: true,
  scriptPath: standalone
    ? "artifacts/source-first-worker.mjs"
    : "dist/_worker.js",
  compatibilityDate: "2026-07-01",
  host: "127.0.0.1",
  port: 4173,
  serviceBindings: standalone
    ? {}
    : {
        ASSETS: async (request) => {
          let path;
          try {
            path = decodeURIComponent(new URL(request.url).pathname);
          } catch {
            return new Response("Invalid path", { status: 400 });
          }
          const file = resolve(
            root,
            "." + (path === "/" ? "/index.html" : path),
          );
          if (!file.startsWith(root + sep))
            return new Response("Not found", { status: 404 });
          try {
            return new Response(await readFile(file), {
              headers: {
                "content-type":
                  mime[extname(file)] ?? "application/octet-stream",
              },
            });
          } catch {
            return new Response("Not found", { status: 404 });
          }
        },
      },
});
console.log(
  `${standalone ? "Standalone" : "Pages"} Worker preview: ${await server.ready}`,
);
process.on("SIGINT", () => {
  void server.dispose().then(() => process.exit(0));
});
