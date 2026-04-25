import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMutePreferenceStorageKey,
  isMascotSoundEnabled,
  resolveMascotMutePreference,
} from '../dist/audio.js';

test('mascot audio stays disabled unless the owner explicitly enables it', () => {
  assert.equal(isMascotSoundEnabled({ mascot: {} }), false);
  assert.equal(isMascotSoundEnabled({ mascot: { soundEnabled: false } }), false);
  assert.equal(isMascotSoundEnabled({ muted: true, mascot: {} }), false);
  assert.equal(isMascotSoundEnabled({ muted: false, mascot: {} }), false);
  assert.equal(isMascotSoundEnabled({ mascot: { imageUrl: 'https://cdn.example.com/mascot.png', soundEnabled: true } }), false);
  assert.equal(isMascotSoundEnabled({ mascot: { mp4Url: 'https://cdn.example.com/mascot.mp4', soundEnabled: true } }), true);
});

test('mute storage is scoped per Rover site and falls back to host', () => {
  assert.equal(
    buildMutePreferenceStorageKey({ siteId: 'site_AbC-123', host: 'Example.com' }),
    'rover:muted:site_abc-123',
  );
  assert.equal(
    buildMutePreferenceStorageKey({ host: 'Docs.Example.com' }),
    'rover:muted:docs.example.com',
  );
});

test('stored mute preference is ignored when mascot audio is owner-disabled', () => {
  const state = resolveMascotMutePreference({
    siteId: 'site_123',
    mascot: { soundEnabled: false },
    muted: false,
    readStored: () => 'false',
  });

  assert.deepEqual(state, {
    soundEnabled: false,
    isMuted: true,
  });
});

test('stored mute preference only applies when mascot audio is enabled', () => {
  const enabled = resolveMascotMutePreference({
    siteId: 'site_123',
    mascot: { soundEnabled: true },
    readStored: () => 'false',
  });
  const otherSite = resolveMascotMutePreference({
    siteId: 'site_456',
    mascot: { soundEnabled: true },
    readStored: () => null,
  });

  assert.equal(enabled.soundEnabled, true);
  assert.equal(enabled.isMuted, false);
  assert.equal(enabled.storageKey, 'rover:muted:site_123');
  assert.equal(otherSite.soundEnabled, true);
  assert.equal(otherSite.isMuted, true);
  assert.equal(otherSite.storageKey, 'rover:muted:site_456');
});
