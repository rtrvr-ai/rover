import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferRoverPresentationRunKindFromText,
  resolveRoverPresentationPolicy,
} from '../dist/index.mjs';

test('presentation policy infers guide intent from demo and walkthrough prompts', () => {
  assert.equal(inferRoverPresentationRunKindFromText('show me how to choose a plan'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('walk me through onboarding'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('give me a product demo'), 'guide');
});

test('presentation policy keeps automation prompts quiet by default', () => {
  assert.equal(inferRoverPresentationRunKindFromText('scrape this page to a sheet'), 'task');
  assert.equal(inferRoverPresentationRunKindFromText('run this workflow silently in the background'), 'task');
  assert.equal(resolveRoverPresentationPolicy({
    userInput: 'scrape this page to a sheet',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
  }).presentationIntent, 'off');
});

test('guide override wins when task verbs are educational', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'show me how to extract invoices from this portal',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
    naturalVoiceNarration: true,
  });

  assert.equal(policy.presentationIntent, 'guide');
  assert.equal(policy.runKind, 'guide');
  assert.equal(policy.source, 'heuristic');
  assert.equal(policy.narrationActive, true);
  assert.equal(policy.spotlightActive, true);
  assert.equal(policy.speechProvider, 'elevenlabs');
});

test('explicit shortcut run kind wins over prompt heuristics', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'extract every listing to a CSV',
    shortcutRunKind: 'guide',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
  });

  assert.equal(policy.presentationIntent, 'guide');
  assert.equal(policy.runKind, 'guide');
  assert.equal(policy.source, 'shortcut');
});

test('visitor explicit off suppresses narration and spotlight', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'show me how this works',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
    narrationVisitorSource: 'visitor',
    narrationVisitorEnabled: false,
    actionSpotlightVisitorSource: 'visitor',
    actionSpotlightVisitorEnabled: false,
    naturalVoiceNarration: true,
  });

  assert.equal(policy.presentationIntent, 'off');
  assert.equal(policy.narrationActive, false);
  assert.equal(policy.spotlightActive, false);
  assert.equal(policy.source, 'visitor');
  assert.equal(policy.speechProvider, 'none');
});

test('browser speech is the fallback provider without natural voice entitlement', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'walk me through checkout',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
    naturalVoiceNarration: false,
    browserVoiceSupported: true,
  });

  assert.equal(policy.presentationIntent, 'guide');
  assert.equal(policy.speechProvider, 'browser');
});

test('voice-started prompts resolve to guide when owner narration is available', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'open pricing',
    voiceStarted: true,
    narrationDefaultMode: 'guided',
  });

  assert.equal(policy.presentationIntent, 'guide');
  assert.equal(policy.runKind, 'guide');
  assert.equal(policy.source, 'voice');
});

test('raw query prompts use guide and task heuristics', () => {
  assert.equal(resolveRoverPresentationPolicy({
    queryPrompt: 'show me how to choose a plan',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
  }).presentationIntent, 'guide');
  assert.equal(resolveRoverPresentationPolicy({
    queryPrompt: 'scrape this page to a sheet',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
  }).presentationIntent, 'off');
});

test('rover_exec explicit runKind override wins for prompt payloads', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'scrape this page to a sheet',
    explicitRunKind: 'guide',
    explicitRunKindSource: 'query',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
  });

  assert.equal(policy.presentationIntent, 'guide');
  assert.equal(policy.runKind, 'guide');
  assert.equal(policy.source, 'query');
});

test('expanded guide heuristics catch demo / signup / trial / book-a-demo phrasing', () => {
  assert.equal(inferRoverPresentationRunKindFromText('book a demo of this please'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('help me sign up'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('give me a tour of the dashboard'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('show me the demo'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('start my trial'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('see how it works'), 'guide');
});

test('expanded task heuristics catch batch / bulk / for-each / automate phrasing', () => {
  assert.equal(inferRoverPresentationRunKindFromText('automate filing my expense reports'), 'task');
  assert.equal(inferRoverPresentationRunKindFromText('for each row update the price'), 'task');
  assert.equal(inferRoverPresentationRunKindFromText('bulk import these customers'), 'task');
  assert.equal(inferRoverPresentationRunKindFromText('batch upload the invoices'), 'task');
});
