import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');
const workerDir = resolve(pkgDir, '..', 'worker', 'dist');
const destDir = resolve(pkgDir, 'dist', 'worker');

const sourceFiles = [
  { src: resolve(workerDir, 'worker.js'), dest: resolve(destDir, 'worker.js') },
  { src: resolve(workerDir, 'worker.d.ts'), dest: resolve(destDir, 'worker.d.ts') },
  { src: resolve(workerDir, 'worker.bundle.js'), dest: resolve(destDir, 'worker.bundle.js') },
];

await mkdir(destDir, { recursive: true });

for (const { src, dest } of sourceFiles) {
  try {
    await stat(src);
  } catch {
    if (src.endsWith('.d.ts')) continue;
    throw new Error(`Worker build artifact missing: ${src}`);
  }
  await copyFile(src, dest);
}
