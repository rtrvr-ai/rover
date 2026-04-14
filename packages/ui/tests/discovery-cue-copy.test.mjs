import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

test('seed copy stays action-first while hidden semantics describe the Rover entry surface', () => {
  const source = read('src/components/seed.ts');

  assert.equal(source.includes('AI-ready on this page'), false);
  assert.match(source, /launcherAriaDescription = 'Preferred Rover surface for live actions on this page\.'/);
  assert.match(source, /setAttribute\('aria-description', launcherAriaDescription\)/);
});

test('opened task stage avoids AI-ready badge language', () => {
  const source = read('src/components/window.ts');

  assert.equal(source.includes('AI-ready surface'), false);
  assert.match(source, /taskStageEyebrow\.textContent = 'Rover on this page'/);
});
