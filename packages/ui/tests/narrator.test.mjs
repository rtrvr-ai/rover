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
    this.onend = null;
    this.onerror = null;
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
    finishLast(type = 'end') {
      const utterance = spoken.at(-1);
      if (!utterance) return;
      if (type === 'error') utterance.onerror?.({ error: 'test' });
      else utterance.onend?.({});
    },
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

test('web speech narrator appends burst steps without canceling active speech', () => {
  const fake = installSpeechFakes();
  try {
    const narrator = createWebSpeechNarrator({ lang: 'en-US', voicePreference: 'natural' });
    narrator.speak('Opening checkout so you can review it.', { mode: 'append', key: 'click:checkout' });
    narrator.speak('Clicking checkout now.', { mode: 'append', key: 'click:checkout-confirm' });
    assert.equal(fake.spoken.length, 0);
    narrator.unlock();
    assert.equal(fake.spoken.at(-1).text, 'Opening checkout so you can review it.');
    assert.equal(fake.cancelled, 0);
    fake.finishLast();
    assert.equal(fake.spoken.at(-1).text, 'Clicking checkout now.');
    narrator.speak('Typing in the email field.', { mode: 'append', key: 'type:email' });
    assert.equal(fake.spoken.at(-1).text, 'Clicking checkout now.');
    fake.finishLast();
    assert.equal(fake.spoken.at(-1).text, 'Typing in the email field.');
    narrator.dispose();
  } finally {
    fake.restore();
  }
});

test('web speech narrator replace mode cancels and speaks the newest phrase', () => {
  const fake = installSpeechFakes();
  try {
    const narrator = createWebSpeechNarrator();
    narrator.unlock();
    narrator.speak('Opening checkout.', { mode: 'append', key: 'click:checkout' });
    assert.equal(fake.spoken.at(-1).text, 'Opening checkout.');
    narrator.speak('Starting a new step.', { mode: 'replace', key: 'status:new' });
    assert.ok(fake.cancelled >= 1);
    assert.equal(fake.spoken.at(-1).text, 'Starting a new step.');
    narrator.dispose();
  } finally {
    fake.restore();
  }
});

test('web speech narrator advances the queue on utterance error', () => {
  const fake = installSpeechFakes();
  try {
    const narrator = createWebSpeechNarrator();
    narrator.unlock();
    narrator.speak('Typing the name.', { mode: 'append', key: 'type:name' });
    narrator.speak('Typing the address.', { mode: 'append', key: 'type:address' });
    assert.equal(fake.spoken.at(-1).text, 'Typing the name.');
    fake.finishLast('error');
    assert.equal(fake.spoken.at(-1).text, 'Typing the address.');
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
