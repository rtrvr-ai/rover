import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSubmittedFromVoice } from './voice-origin.js';

test('explicit fromVoice flag wins regardless of voiceOriginText', () => {
  assert.equal(resolveSubmittedFromVoice({ explicitFromVoice: true, voiceOriginText: '' }), true);
  assert.equal(resolveSubmittedFromVoice({ explicitFromVoice: true, voiceOriginText: 'anything' }), true);
});

test('auto-submit path with explicit flag → true (no voiceOriginText needed)', () => {
  assert.equal(resolveSubmittedFromVoice({ explicitFromVoice: true }), true);
});

test('manual-review path: dictated, unedited (voiceOriginText present) → true', () => {
  // onTextInput would have cleared voiceOriginText if the visitor had edited;
  // a non-empty value means "from voice, unedited."
  assert.equal(resolveSubmittedFromVoice({ voiceOriginText: 'run a workflow' }), true);
});

test('manual-review path: visitor edited the dictated text (voiceOriginText cleared) → false', () => {
  assert.equal(resolveSubmittedFromVoice({ voiceOriginText: '' }), false);
});

test('typed (no voice ever) → false', () => {
  assert.equal(resolveSubmittedFromVoice({}), false);
  assert.equal(resolveSubmittedFromVoice({ voiceOriginText: undefined }), false);
});

test('whitespace-only voiceOriginText → false (treated as empty)', () => {
  assert.equal(resolveSubmittedFromVoice({ voiceOriginText: '   ' }), false);
  assert.equal(resolveSubmittedFromVoice({ voiceOriginText: '\n\t  ' }), false);
});

test('regression: interim/final transcript divergence no longer breaks the manual-review path', () => {
  // Original bug: textarea held interim transcript, voiceOriginText held final;
  // they differed by a trailing word. With the new fallback, voiceOriginText
  // presence alone is enough.
  assert.equal(resolveSubmittedFromVoice({ voiceOriginText: 'show me a demo' }), true);
});
