import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');
const distDir = resolve(pkgDir, 'dist');
const deployDir = resolve(distDir, 'deploy');
const deployWorkerDir = resolve(deployDir, 'worker');

// Create deploy directories
await mkdir(deployWorkerDir, { recursive: true });

const filesToCopy = [
  // embed.js — IIFE bundle for <script> tag embedding
  { src: resolve(distDir, 'embed.js'), dest: resolve(deployDir, 'embed.js') },
  // rover.js — ESM bundle for <script type="module"> or npm users
  { src: resolve(distDir, 'rover.js'), dest: resolve(deployDir, 'rover.js') },
  // worker/worker.js — worker bundle for auto-resolution via import.meta.url
  { src: resolve(distDir, 'worker', 'rover-worker.js'), dest: resolve(deployWorkerDir, 'worker.js') },
];

for (const { src, dest } of filesToCopy) {
  try {
    await stat(src);
  } catch {
    console.error(`Missing build artifact: ${src}`);
    process.exit(1);
  }
  await copyFile(src, dest);
  console.log(`Copied ${src} → ${dest}`);
}

console.log('\nDeploy directory ready at dist/deploy/');
