import { rm } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const distDir = path.resolve(root.pathname, 'dist');

await rm(distDir, { recursive: true, force: true });
console.log(`Removed ${distDir}`);
