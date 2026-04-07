import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const curatedFiles = [
  'README.md',
  'packages/sdk/README.md',
  'packages/roverbook/README.md',
  'docs/AGENT_IDENTITY.md',
  'docs/SECURITY_MODEL.md',
  'docs/INTEGRATION.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Rover docs publish the vNext discovery and identity model consistently', () => {
  const docs = Object.fromEntries(curatedFiles.map((file) => [file, read(file)]));
  const combined = Object.values(docs).join('\n');

  assert.match(combined, /rover-site\.json/);
  assert.match(combined, /beaconLabel/);
  assert.match(combined, /verified_signed/);
  assert.match(combined, /signed_directory_only/);
  assert.match(combined, /goal/);

  assert.match(docs['README.md'], /\/\.well-known\/rover-site\.json/);
  assert.match(docs['packages/sdk/README.md'], /beaconLabel/);
  assert.match(docs['packages/roverbook/README.md'], /requestedResultModes/);
  assert.match(docs['docs/INTEGRATION.md'], /Compatibility aliases like .*prompt.*still work/);
})

test('Rover docs no longer present pre-vNext canonical guidance', () => {
  const combined = curatedFiles.map((file) => read(file)).join('\n');
  const forbidden = [
    'Publish the well-known card first',
    'Current launch behavior emits `self_reported`, `heuristic`, and `anonymous`',
    '`verified` remains reserved',
  ];

  for (const phrase of forbidden) {
    assert.equal(combined.includes(phrase), false, `unexpected stale phrase present: ${phrase}`);
  }
});
