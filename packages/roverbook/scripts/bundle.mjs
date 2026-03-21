import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(pkgDir, 'dist', 'index.js')],
  bundle: true,
  outfile: resolve(pkgDir, 'dist', 'roverbook.js'),
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: false,
});

console.log('RoverBook bundled to dist/roverbook.js');
