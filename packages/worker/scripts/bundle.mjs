import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(pkgDir, 'dist', 'worker.js')],
  bundle: true,
  outfile: resolve(pkgDir, 'dist', 'worker.bundle.js'),
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: false,
  sourcemap: false,
  // The worker runs in a Web Worker context, not Node
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('Worker bundled to dist/worker.bundle.js');
