import { build } from 'esbuild';
import { copyFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');
const workerPkgDist = resolve(pkgDir, '..', 'worker', 'dist');

// 1. Copy the bundled worker from @rover/worker (already bundled by its own build step)
const bundledWorkerSrc = resolve(workerPkgDist, 'worker.bundle.js');
const bundledWorkerDest = resolve(pkgDir, 'dist', 'worker', 'rover-worker.js');

try {
  await stat(bundledWorkerSrc);
  await copyFile(bundledWorkerSrc, bundledWorkerDest);
  console.log('Copied bundled worker to dist/worker/rover-worker.js');
} catch {
  console.warn('Warning: worker.bundle.js not found, skipping bundled worker copy');
}

// 2. Bundle the SDK into a single standalone file
await build({
  entryPoints: [resolve(pkgDir, 'dist', 'index.js')],
  bundle: true,
  outfile: resolve(pkgDir, 'dist', 'rover.js'),
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: false,
  // The SDK uses import.meta.url for default worker URL resolution.
  // In standalone mode, users should provide workerUrl explicitly.
});

console.log('SDK bundled to dist/rover.js');
