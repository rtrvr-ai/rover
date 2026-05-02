import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('spotlight header button uses the shared header button styling', () => {
  const windowStyles = readSource('src/styles/window.css.ts');
  const responsiveStyles = readSource('src/styles/responsive.css.ts');

  assert.match(windowStyles, /\.sizeBtn,\s*\.narrationBtn,\s*\.spotlightBtn,\s*\.overflowBtn,\s*\.closeBtn\s*\{/);
  assert.match(windowStyles, /\.narrationBtn svg,\s*\.spotlightBtn svg\s*\{/);
  assert.match(windowStyles, /\.sizeBtn:hover,\s*\.narrationBtn:hover,\s*\.spotlightBtn:hover,\s*\.overflowBtn:hover,\s*\.closeBtn:hover\s*\{/);
  assert.match(windowStyles, /\.narrationBtn\.enabled,\s*\.spotlightBtn\.enabled\s*\{/);
  assert.match(responsiveStyles, /\.sizeBtn,\s*\.conversationListBtn,\s*\.narrationBtn,\s*\.spotlightBtn,\s*\.overflowBtn,\s*\.closeBtn\s*\{/);
});

test('overflow menu uses Guidance wording for voice and highlight controls', () => {
  const headerSource = readSource('src/components/header.ts');
  assert.match(headerSource, /menuGuidanceCaption\.textContent = 'Guidance'/);
  assert.doesNotMatch(headerSource, /Playback/);
  assert.match(headerSource, /Hide step narration/);
  assert.match(headerSource, /Hide action highlights/);
});
