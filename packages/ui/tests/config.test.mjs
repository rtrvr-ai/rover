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
