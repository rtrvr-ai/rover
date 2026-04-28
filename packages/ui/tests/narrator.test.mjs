import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebSpeechNarrator } from '../dist/narrator.js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
  }
}

function installSpeechFakes({ hidden = false } = {}) {
  const spoken = [];
  let cancelled = 0;
  const listeners = new Map();
  const previousSpeech = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  const previousDocument = globalThis.document;
  globalThis.speechSynthesis = {
    getVoices: () => [{ name: 'Google US English', lang: 'en-US', localService: false, voiceURI: 'google-us' }],
    speak: (utterance) => spoken.push(utterance),
    cancel: () => { cancelled += 1; },
    resume: () => undefined,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  globalThis.document = {
    hidden,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  return {
    spoken,
    get cancelled() { return cancelled; },
    setHidden(nextHidden) {
      globalThis.document.hidden = nextHidden;
      listeners.get('visibilitychange')?.();
    },
    restore() {
      globalThis.speechSynthesis = previousSpeech;
      globalThis.SpeechSynthesisUtterance = previousUtterance;
      globalThis.document = previousDocument;
    },
  };
}

test('web speech narrator queues until unlocked and keeps latest step only', () => {
  const fake = installSpeechFakes();
  try {
    const narrator = createWebSpeechNarrator({ lang: 'en-US', voicePreference: 'natural' });
    narrator.speak('Opening checkout so you can review it.');
    narrator.speak('Clicking checkout now.');
    assert.equal(fake.spoken.length, 0);
    narrator.unlock();
    assert.equal(fake.spoken.at(-1).text, 'Clicking checkout now.');
    narrator.speak('Typing in the email field.');
    assert.equal(fake.spoken.at(-1).text, 'Typing in the email field.');
    assert.ok(fake.cancelled >= 2);
    narrator.dispose();
  } finally {
    fake.restore();
  }
});

test('web speech narrator cancels and suppresses speech while the document is hidden', () => {
  const fake = installSpeechFakes();
  try {
    const narrator = createWebSpeechNarrator();
    narrator.unlock();
    fake.setHidden(true);
    const before = fake.spoken.length;
    narrator.speak('This should not play in a hidden tab.');
    assert.equal(fake.spoken.length, before);
    assert.ok(fake.cancelled >= 1);
    narrator.dispose();
  } finally {
    fake.restore();
  }
});
