import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');
const rollsEntry = resolve(pkgDir, '..', '..', 'apps', 'rolls', 'src', 'index.mjs');

await build({
  entryPoints: [rollsEntry],
  bundle: true,
  outfile: resolve(pkgDir, 'dist', 'rolls-cli.mjs'),
  format: 'esm',
  target: 'es2022',
  platform: 'node',
  minify: false,
  sourcemap: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});

console.log('Rolls CLI bundled to dist/rolls-cli.mjs');
