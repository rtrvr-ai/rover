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

test('guide override fires when prompt explicitly requests a demo / tour / walkthrough of X (regression for "show me a demo of how to run a workflow")', () => {
  // The exact prompt that exposed the bug: "demo of" + "run a workflow" both fired
  // before, and task won the tie. Override must force guide here.
  assert.equal(
    inferRoverPresentationRunKindFromText('show me a demo of how to run a workflow on the cloud'),
    'guide',
  );
  // Other phrasings that should all be guide overrides even when task verbs co-occur.
  assert.equal(inferRoverPresentationRunKindFromText('give me a tour of the new dashboard'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('tutorial on extracting invoices'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('walkthrough of the signup process'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('demonstration of how to use the API'), 'guide');
  assert.equal(inferRoverPresentationRunKindFromText('demo of the export feature'), 'guide');
});

test('task prompts that happen to mention "demo" or "tutorial" as data terms stay task', () => {
  // The word "demo" appears but NOT in a "demo of/on/for" or "give/show me a demo" phrase.
  assert.equal(inferRoverPresentationRunKindFromText('extract every demo signup from this page'), 'task');
  assert.equal(inferRoverPresentationRunKindFromText('scrape the demo screenshots from the gallery'), 'task');
  assert.equal(inferRoverPresentationRunKindFromText('download all the tutorial PDFs'), 'task');
});

test('regression: "show me a demo of how to run a workflow" lands on guide narration end-to-end', () => {
  const policy = resolveRoverPresentationPolicy({
    userInput: 'show me a demo of how to run a workflow on the cloud',
    narrationDefaultMode: 'guided',
    actionSpotlightAllowedRunKinds: ['guide'],
    naturalVoiceNarration: true,
  });
  assert.equal(policy.runKind, 'guide');
  assert.equal(policy.presentationIntent, 'guide');
  assert.equal(policy.narrationActive, true);
  assert.equal(policy.spotlightActive, true);
  assert.equal(policy.source, 'heuristic');
  assert.equal(policy.speechProvider, 'elevenlabs');
});

// ── Broad coverage suites for the 4 user-requested categories ────────────────

test('demo intent classifies as guide across many phrasings', () => {
  const prompts = [
    'show me a demo of how to run a workflow on the cloud',
    'show me a demo',
    'show me the demo',
    'give me a demo of the new dashboard',
    'give me a quick demo',
    'demo of the export feature',
    'demo of how to use X',
    'demo about how this works',
    'live demo please',
    'quick demo of pricing',
    'interactive demo',
    'product demo',
    'video demo of checkout',
    'can you demo this for me',
    'could you demo the new feature',
    'I want to see a demo',
    'i want a demo',
    'book a demo',
  ];
  for (const prompt of prompts) {
    assert.equal(
      inferRoverPresentationRunKindFromText(prompt),
      'guide',
      `Expected guide for: "${prompt}"`,
    );
  }
});

test('walkthrough intent classifies as guide across many phrasings', () => {
  const prompts = [
    'walk me through how to extract invoices',
    'walk me through the signup',
    'walkthrough of the signup process',
    'walkthrough of how to set up',
    'walkthrough about the dashboard',
    'product walkthrough',
    'guided walkthrough of features',
    'show me a walkthrough',
    'give me a walkthrough',
    'take me through this',
    'take me on a tour of features',
    'go through it with me step by step',
    'step-by-step walkthrough',
  ];
  for (const prompt of prompts) {
    assert.equal(
      inferRoverPresentationRunKindFromText(prompt),
      'guide',
      `Expected guide for: "${prompt}"`,
    );
  }
});

test('presentation intent (when explicit) classifies as guide', () => {
  const prompts = [
    'give me a presentation of the dashboard',
    'show me a presentation',
    'presentation of how to use the API',
    'presentation about how this works',
  ];
  for (const prompt of prompts) {
    assert.equal(
      inferRoverPresentationRunKindFromText(prompt),
      'guide',
      `Expected guide for: "${prompt}"`,
    );
  }
});

test('onboarding intent classifies as guide across many phrasings', () => {
  const prompts = [
    'onboard me',
    'help me onboard',
    'onboarding please',
    'I am new here',
    "I'm new here",
    'I am new to this',
    "i'm new to rover",
    'new to this platform',
    'new to the app',
    'first time using this',
    'first-time user here',
    'first time here',
    'getting started',
    'help me get started',
    'sign me up',
    'where do I start',
    'where do I begin',
    'where should I start',
    'what should I do first',
    'newbie here',
    'show me how to get started',
    'how do I get started',
    'how can I get started',
  ];
  for (const prompt of prompts) {
    assert.equal(
      inferRoverPresentationRunKindFromText(prompt),
      'guide',
      `Expected guide for: "${prompt}"`,
    );
  }
});

test('how-to questions classify as guide even when task verbs co-occur', () => {
  const prompts = [
    'how do I extract invoices',
    'how can I export this data',
    'how do we run a workflow',
    'how do I scrape this page step by step',
  ];
  for (const prompt of prompts) {
    assert.equal(
      inferRoverPresentationRunKindFromText(prompt),
      'guide',
      `Expected guide for: "${prompt}"`,
    );
  }
});

test('negative: creating slides / decks / sheets is not guide-misclassified', () => {
  // These should classify as undefined (no heuristic match) or task — but NOT guide.
  const ambiguousPrompts = [
    'create a presentation about Q4 metrics',
    'make me a slide deck about pricing',
    'build a presentation from this data',
  ];
  for (const prompt of ambiguousPrompts) {
    const result = inferRoverPresentationRunKindFromText(prompt);
    assert.notEqual(
      result,
      'guide',
      `Expected NOT guide for: "${prompt}", got ${result}`,
    );
  }
});
