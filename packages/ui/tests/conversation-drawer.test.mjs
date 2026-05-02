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

test('conversation drawer items delegate selection to the SDK switch handler', () => {
  const source = readSource('src/mount.ts');

  assert.match(source, /item\.addEventListener\('click', \(\) => \{ drawerOpen = false; win\.conversationDrawer\.classList\.remove\('open'\); opts\.onSwitchConversation\?\.?\(conv\.id\); \}\);/);
});

test('transcript restore marks prior messages as active content instead of showing the new-chat shortcuts', () => {
  const source = readSource('src/mount.ts');

  assert.match(source, /feedComp\.setTranscript\(messages, timeline\.map\(withResolvedActionCueLabel\)\);/);
  assert.match(source, /hasMessages = messages\.length > 0 \|\| timeline\.length > 0;/);
  assert.match(source, /shortcutsComp\.syncVisibility\(hasMessages, isRunning, !!currentQuestionPrompt\?\.questions\?\.length\);/);
});
