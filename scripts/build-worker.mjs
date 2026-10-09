import { build } from "esbuild";

// Pages advanced mode: run after Vite has written the static assets to dist/.
await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  minify: true,
});

// The logo is served by the Worker; keep even incremental builds text-only.
const { writeFile, rm } = await import("node:fs/promises");
await rm("dist/logo.png", { force: true });

const { execFileSync } = await import("node:child_process");
let sourceCommit = process.env.BUILD_REVISION ?? "unversioned";
try {
  if (sourceCommit === "unversioned")
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
} catch {
  /* An exported source archive may not contain git metadata. */
}
await writeFile(
  "dist/release.json",
  JSON.stringify({ version: "1.0.0", sourceCommit }, null, 2) + "\n",
);
// Preserve runtime dependency licence notices with the deployed client bundle.
const { readFile } = await import("node:fs/promises");
await writeFile(
  "dist/third-party-licenses.txt",
  await readFile("THIRD_PARTY.md"),
);

if (process.argv.includes("--package")) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir("artifacts", { recursive: true });
  await rm("artifacts/source-first-cloudflare.zip", { force: true });
  execFileSync(
    "zip",
    ["-qr", "../artifacts/source-first-cloudflare.zip", "."],
    { cwd: "dist" },
  );
  console.log("Flat Cloudflare upload: artifacts/source-first-cloudflare.zip");
}
