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

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf('\n  function ', start + 1);
  return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('running progress opens the inspector without a blurred backdrop', () => {
  const source = readSource('src/mount.ts');
  const maximizeSource = extractFunction(source, 'maximize');
  const backdropSource = extractFunction(source, 'shouldShowPanelBackdrop');

  assert.match(source, /type PanelOpenReason = 'manual' \| 'progress' \| 'result';/);
  assert.match(backdropSource, /&& !isRunning/);
  assert.doesNotMatch(maximizeSource, /win\.backdrop\.classList\.add\('visible'\)/);
  assert.match(maximizeSource, /const isProgressOpen = reason === 'progress' \|\| isRunning;/);
  assert.match(maximizeSource, /if \(isProgressOpen\) feedComp\.setTraceExpanded\(true, experience\.stream\?\.maxVisibleLiveCards\);/);
  assert.match(source, /liveStack\.setOnExpand\(\(\) => \{[\s\S]*?maximize\('progress'\);/);
});

test('run lifecycle stays compact while running and opens result stage only after stop', () => {
  const source = readSource('src/mount.ts');
  const setRunningSource = extractFunction(source, 'setRunning');

  assert.match(setRunningSource, /if \(running\) \{[\s\S]*?win\.panel\.classList\.remove\('open'\);[\s\S]*?stateMachine\.setState\('bar'\);/);
  assert.match(setRunningSource, /liveStack\.show\(\);/);
  assert.match(setRunningSource, /maximize\('result'\);/);
  assert.doesNotMatch(setRunningSource, /win\.backdrop\.classList\.add\('visible'\)/);
  assert.match(source, /syncBackdropState\(\{ forceHidden: true \}\);/);
});
