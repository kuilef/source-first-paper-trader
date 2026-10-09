import { build } from 'esbuild';

// Pages advanced mode: run after Vite has written the static assets to dist/.
await build({
  entryPoints: ['worker/index.ts'],
  outfile: 'dist/_worker.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  minify: true,
});
