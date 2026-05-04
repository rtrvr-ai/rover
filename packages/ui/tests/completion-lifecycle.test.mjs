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

test('successful completion can clear live execution visuals without clearing the transcript timeline', () => {
  const source = readSource('src/mount.ts');

  assert.match(source, /function clearLiveExecutionVisuals\(options\?: \{ preserveNarration\?: boolean \}\): void \{/);
  assert.match(source, /clearLiveExecution: clearLiveExecutionVisuals/);

  const helperStart = source.indexOf('function clearLiveExecutionVisuals');
  const helperEnd = source.indexOf('function setRunning', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.match(helperSource, /liveStack\.clear\(\)/);
  assert.match(helperSource, /actionSpotlightSystem\.clearAll\(\)/);
  assert.doesNotMatch(helperSource, /feedComp\.clearTimeline\(\)/);
  assert.doesNotMatch(helperSource, /sessionCoordinator\.clearTimeline\(\)/);
});

test('normal completion stop can preserve final response narration and open the full panel', () => {
  const source = readSource('src/mount.ts');

  assert.match(source, /if \(!options\?\.preserveNarration\) cancelNarration\(\);/);
  assert.match(source, /options\?\.openOnStop === true/);
});
