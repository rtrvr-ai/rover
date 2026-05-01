import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const curatedFiles = [
  'README.md',
  'SKILLS.md',
  'llms.txt',
  'docs/AGENT_IDENTITY.md',
  'docs/INTEGRATION.md',
  'packages/sdk/README.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('public A2W docs teach prompt and shortcutId as canonical fields', () => {
  const combined = curatedFiles.map(file => read(file)).join('\n');

  assert.match(combined, /\/v1\/a2w\/runs/);
  assert.match(combined, /\bprompt\b/);
  assert.match(combined, /\bshortcutId\b/);
  assert.match(combined, /goal[^.]+compatibility alias|goal[^.]+accepted as (?:a )?compatibility alias|goal[^.]+accepted as an alias/i);
  assert.equal(/"goal"\s*:/.test(combined), false, 'canonical examples must not use "goal"');
  assert.equal(/"shortcut"\s*:/.test(combined), false, 'canonical examples must not use "shortcut"');
});

test('public A2W docs do not reintroduce legacy Rover protocol terms', () => {
  const combined = curatedFiles.map(file => read(file)).join('\n');
  const forbidden = [
    'Agent Task Protocol',
    'Canonical Rover ATP',
    '/v1/tasks',
    '/v1/workflows',
    'taskEndpoint',
    'publicTasks',
    'agent-tasks',
  ];

  for (const phrase of forbidden) {
    assert.equal(combined.includes(phrase), false, `unexpected legacy A2W phrase present: ${phrase}`);
  }
  assert.equal(/\bATP\b/.test(combined), false, 'unexpected legacy ATP abbreviation present');
});
