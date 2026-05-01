import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveActionSpotlightTokens,
  normalizeHexColor,
  resolveMountExperienceConfig,
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

test('experienceMode "minimal" preset turns spotlight + narration off', () => {
  const minimal = resolveMountExperienceConfig({
    experience: { experienceMode: 'minimal' },
    onSend: () => {},
  }, 'Rover', false);
  assert.equal(minimal.experienceMode, 'minimal');
  assert.equal(minimal.motion?.actionSpotlight, false);
  assert.equal(minimal.audio?.narration?.enabled, false);
  assert.equal(minimal.audio?.narration?.defaultMode, 'off');
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
