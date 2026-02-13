import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(pkgDir, 'dist', 'index.js')],
  bundle: true,
  outfile: resolve(pkgDir, 'dist', 'embed.js'),
  format: 'iife',
  globalName: '__roverSDK',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  sourcemap: false,
  banner: {
    js: `var __ROVER_SCRIPT_URL__=(document.currentScript&&document.currentScript.src)||'';`,
  },
  define: {
    'import.meta.url': '__ROVER_SCRIPT_URL__',
  },
});

console.log('Embed script bundled to dist/embed.js');
