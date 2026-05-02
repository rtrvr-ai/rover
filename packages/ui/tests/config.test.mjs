import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveActionSpotlightTokens,
  normalizeHexColor,
  resolveMountExperienceConfig,
  resolveActionSpotlightDecision,
  resolveNarrationDefaultActiveForRun,
} from '../dist/config.js';

test('action spotlight color normalizes to six-digit hex and falls back to orange', () => {
  assert.equal(normalizeHexColor('2563eb'), '#2563EB');
  assert.equal(normalizeHexColor('#0f9f6e'), '#0F9F6E');
  assert.equal(normalizeHexColor('rgb(255, 0, 0)'), undefined);

  assert.deepEqual(
    {
      color: deriveActionSpotlightTokens('#2563eb')['--rv-action-spotlight'],
      rgb: deriveActionSpotlightTokens('#2563eb')['--rv-action-spotlight-rgb'],
    },
    {
      color: '#2563EB',
      rgb: '37, 99, 235',
    },
  );
  assert.equal(deriveActionSpotlightTokens('bad')['--rv-action-spotlight'], '#FF4C00');
});

test('resolved mount experience defaults action spotlight on with default color', () => {
  const resolved = resolveMountExperienceConfig({}, 'Rover', false);
  assert.deepEqual(resolved.audio?.narration, {
    enabled: true,
    defaultMode: 'guided',
    rate: 1,
    language: 'en-US',
    voicePreference: 'auto',
  });
  assert.equal(resolved.motion?.actionSpotlight, true);
  assert.equal(resolved.motion?.actionSpotlightColor, '#FF4C00');

  const custom = resolveMountExperienceConfig({
    experience: {
      motion: {
        actionSpotlight: false,
        actionSpotlightColor: '#0891b2',
      },
    },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(custom.motion?.actionSpotlight, false);
  assert.equal(custom.motion?.actionSpotlightColor, '#0891B2');

  const customNarration = resolveMountExperienceConfig({
    experience: {
      audio: {
        narration: {
          enabled: false,
          defaultMode: 'always',
          rate: 1.2,
          language: 'en-GB',
          voicePreference: 'natural',
        },
      },
    },
    onSend: () => {},
  }, 'Rover', false);
  assert.deepEqual(customNarration.audio?.narration, {
    enabled: false,
    defaultMode: 'always',
    rate: 1.15,
    language: 'en-GB',
    voicePreference: 'natural',
  });

  const themeFallback = resolveMountExperienceConfig({
    experience: {
      theme: {
        accentColor: '#2563eb',
      },
    },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(themeFallback.motion?.actionSpotlightColor, '#2563EB');
});

test('experienceMode "guided" preset gates spotlight to guide runs only', () => {
  const guided = resolveMountExperienceConfig({
    experience: { experienceMode: 'guided' },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(guided.experienceMode, 'guided');
  assert.equal(guided.motion?.actionSpotlight, true);
  assert.deepEqual(guided.motion?.actionSpotlightRunKinds, ['guide']);
  assert.equal(guided.audio?.narration?.defaultMode, 'guided');
});

test('experienceMode "minimal" preset defaults spotlight and narration quiet without disabling narration', () => {
  const minimal = resolveMountExperienceConfig({
    experience: { experienceMode: 'minimal' },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(minimal.experienceMode, 'minimal');
  assert.equal(minimal.motion?.actionSpotlight, false);
  assert.equal(minimal.audio?.narration?.enabled, true);
  assert.equal(minimal.audio?.narration?.defaultMode, 'off');
  assert.equal(resolveNarrationDefaultActiveForRun(minimal, 'guide'), false);
  assert.equal(resolveNarrationDefaultActiveForRun(minimal, 'task'), false);
  assert.equal(resolveNarrationDefaultActiveForRun(minimal), false);
});

test('narration default active follows defaultMode and run kind', () => {
  const guided = resolveMountExperienceConfig({
    experience: { audio: { narration: { defaultMode: 'guided' } } },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(resolveNarrationDefaultActiveForRun(guided, 'guide'), true);
  assert.equal(resolveNarrationDefaultActiveForRun(guided, 'task'), false);
  assert.equal(resolveNarrationDefaultActiveForRun(guided), true);

  const always = resolveMountExperienceConfig({
    experience: { audio: { narration: { defaultMode: 'always' } } },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(resolveNarrationDefaultActiveForRun(always, 'task'), true);

  const disabled = resolveMountExperienceConfig({
    experience: { audio: { narration: { enabled: false, defaultMode: 'always' } } },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(resolveNarrationDefaultActiveForRun(disabled, 'guide'), false);
});

test('explicit motion.actionSpotlight value wins over preset', () => {
  // Owner picked "guided" preset but then manually flipped spotlight off →
  // explicit value wins, no third "Custom" preset is needed at the schema layer.
  const override = resolveMountExperienceConfig({
    experience: {
      experienceMode: 'guided',
      motion: { actionSpotlight: false },
    },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(override.motion?.actionSpotlight, false);
  // Preset-derived runKinds and narration mode still apply for fields the owner
  // didn't explicitly override.
  assert.deepEqual(override.motion?.actionSpotlightRunKinds, ['guide']);
});

test('explicit actionSpotlightRunKinds wins over guided preset and missing kinds stay back-compatible', () => {
  const explicitKinds = resolveMountExperienceConfig({
    experience: {
      experienceMode: 'guided',
      motion: { actionSpotlightRunKinds: ['task'] },
    },
    onSend: () => {},
  }, 'Rover', false);
  assert.deepEqual(explicitKinds.motion?.actionSpotlightRunKinds, ['task']);

  const legacy = resolveMountExperienceConfig({
    experience: {
      motion: { actionSpotlight: true },
    },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(legacy.experienceMode, undefined);
  assert.equal(legacy.motion?.actionSpotlight, true);
  assert.equal(legacy.motion?.actionSpotlightRunKinds, undefined);
});

// ── Spotlight precedence rule ──────────────────────────────────────────────
//
// Top wins (sacred order):
//   1. Visitor explicit OFF → never fire (accessibility).
//   2. Visitor explicit ON  → fire unless planner per-step explicitly suppresses.
//   3. Visitor default      → planner per-step (when set) overrides site config; otherwise
//                             site default + runKind allowedKinds decides.

test('spotlight: visitor explicit OFF blocks everything (planner cannot re-enable)', () => {
  // Visitor turned off in the header → no override (even from planner) brings it back.
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'visitor', visitorEnabled: false,
      stepOverride: true, currentRunKind: 'guide', allowedRunKinds: ['guide'],
    }),
    false,
  );
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'visitor', visitorEnabled: false,
      stepOverride: undefined, currentRunKind: undefined, allowedRunKinds: undefined,
    }),
    false,
  );
});

test('spotlight: visitor explicit ON fires unless planner explicitly suppresses', () => {
  // Visitor opted in. Planner unset / true → fire.
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'visitor', visitorEnabled: true,
      stepOverride: undefined, currentRunKind: 'task', allowedRunKinds: ['guide'],
    }),
    true, // visitor wants it; runKind suppression doesn't apply when visitor explicit ON
  );
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'visitor', visitorEnabled: true,
      stepOverride: true, currentRunKind: 'guide', allowedRunKinds: ['guide'],
    }),
    true,
  );
  // Planner says false to suppress a noisy step → respect it (visitor opted in but agent
  // has contextual reason to skip this one).
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'visitor', visitorEnabled: true,
      stepOverride: false, currentRunKind: 'guide', allowedRunKinds: ['guide'],
    }),
    false,
  );
});

test('spotlight: visitor default + planner per-step overrides site config', () => {
  // Site OFF (e.g., minimal preset), visitor never set pref, planner forces ON for a critical step.
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'default', visitorEnabled: false,
      stepOverride: true, currentRunKind: 'task', allowedRunKinds: ['guide'],
    }),
    true,
  );
  // Site ON for guide runs, but planner suppresses a noisy step.
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'default', visitorEnabled: true,
      stepOverride: false, currentRunKind: 'guide', allowedRunKinds: ['guide'],
    }),
    false,
  );
});

test('spotlight: visitor default + no planner override falls through to site config + runKind', () => {
  // Guided preset: actionSpotlight=true, allowedKinds=['guide']. Guide run → fires.
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'default', visitorEnabled: true,
      stepOverride: undefined, currentRunKind: 'guide', allowedRunKinds: ['guide'],
    }),
    true,
  );
  // Same site, task run → does not fire (runKind not in allowedKinds).
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'default', visitorEnabled: true,
      stepOverride: undefined, currentRunKind: 'task', allowedRunKinds: ['guide'],
    }),
    false,
  );
  // Free-text prompt (no runKind) on a guided site → fires (fall-through behavior).
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'default', visitorEnabled: true,
      stepOverride: undefined, currentRunKind: undefined, allowedRunKinds: ['guide'],
    }),
    true,
  );
  // Site has actionSpotlight=false (minimal preset) → never fires absent planner override.
  assert.equal(
    resolveActionSpotlightDecision({
      visitorSource: 'default', visitorEnabled: false,
      stepOverride: undefined, currentRunKind: 'guide', allowedRunKinds: undefined,
    }),
    false,
  );
});
