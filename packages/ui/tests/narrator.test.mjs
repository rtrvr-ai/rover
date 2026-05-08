import assert from 'node:assert/strict';
import test from 'node:test';

import { createElevenLabsNarrator, createRoverNarrator, createWebSpeechNarrator } from '../dist/narrator.js';

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

test('elevenlabs narrator fetches Rover audio endpoint with session token', async () => {
  const previousFetch = globalThis.fetch;
  const previousAudio = globalThis.Audio;
  const previousUrl = globalThis.URL;
  const previousDocument = globalThis.document;
  const calls = [];
  class FakeAudio {
    constructor() {
      this.src = '';
      this.onended = null;
      this.onerror = null;
    }
    async play() {
      this.onended?.();
    }
    pause() {}
  }
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }),
    };
  };
  globalThis.Audio = FakeAudio;
  globalThis.URL = {
    createObjectURL: () => 'blob:rover-audio',
    revokeObjectURL: () => undefined,
  };
  globalThis.document = { hidden: false };
  try {
    const narrator = createElevenLabsNarrator({
      apiBase: 'https://agent.test',
      getAuth: async () => ({ sessionId: 'sess_123', sessionToken: 'rvrsess_123' }),
    });
    assert.equal(narrator.isSupported(), true);
    narrator.unlock();
    narrator.speak('Opening checkout.', { mode: 'append', key: 'step-1' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls[0].url, 'https://agent.test/v2/rover/audio/narration/stream');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer rvrsess_123');
    assert.match(String(calls[0].init.body), /Opening checkout/);
    narrator.dispose();
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Audio = previousAudio;
    globalThis.URL = previousUrl;
    globalThis.document = previousDocument;
  }
});

test('elevenlabs narrator starts MediaSource playback without waiting for blob fallback', async () => {
  const previousFetch = globalThis.fetch;
  const previousAudio = globalThis.Audio;
  const previousUrl = globalThis.URL;
  const previousDocument = globalThis.document;
  const previousMediaSource = globalThis.MediaSource;
  let blobCalled = false;
  let playCount = 0;
  const appended = [];

  class FakeSourceBuffer {
    constructor() {
      this.listeners = new Map();
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    appendBuffer(chunk) {
      appended.push(chunk);
      setTimeout(() => this.listeners.get('updateend')?.(), 0);
    }
  }
  class FakeMediaSource {
    static isTypeSupported(type) { return type === 'audio/mpeg'; }
    constructor() {
      this.readyState = 'closed';
      this.listeners = new Map();
      setTimeout(() => {
        this.readyState = 'open';
        this.listeners.get('sourceopen')?.();
      }, 0);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    addSourceBuffer() { return new FakeSourceBuffer(); }
    endOfStream() { this.readyState = 'ended'; }
  }
  class FakeAudio {
    constructor() {
      this.src = '';
      this.onended = null;
      this.onerror = null;
    }
    async play() { playCount += 1; }
    pause() {}
  }

  globalThis.fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
    blob: async () => {
      blobCalled = true;
      return new Blob(['audio'], { type: 'audio/mpeg' });
    },
  });
  globalThis.Audio = FakeAudio;
  globalThis.URL = {
    createObjectURL: () => 'blob:rover-stream',
    revokeObjectURL: () => undefined,
  };
  globalThis.MediaSource = FakeMediaSource;
  globalThis.document = { hidden: false };

  try {
    const narrator = createElevenLabsNarrator({
      apiBase: 'https://agent.test',
      getAuth: async () => ({ sessionId: 'sess_123', sessionToken: 'rvrsess_123' }),
    });
    narrator.unlock();
    narrator.speak('Opening checkout.', { mode: 'append', key: 'step-1' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(blobCalled, false);
    assert.equal(playCount, 1);
    assert.equal(appended.length, 1);
    narrator.dispose();
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Audio = previousAudio;
    globalThis.URL = previousUrl;
    globalThis.document = previousDocument;
    globalThis.MediaSource = previousMediaSource;
  }
});

test('rover narrator defaults to ElevenLabs and falls back to browser speech on TTS failure', async () => {
  const fake = installSpeechFakes();
  const previousFetch = globalThis.fetch;
  const previousAudio = globalThis.Audio;
  const previousUrl = globalThis.URL;
  try {
    globalThis.fetch = async () => ({ ok: false, blob: async () => new Blob() });
    globalThis.Audio = class { async play() {} pause() {} };
    globalThis.URL = { createObjectURL: () => 'blob:fail', revokeObjectURL: () => undefined };
    const narrator = createRoverNarrator({
      apiBase: 'https://agent.test',
      getAuth: async () => ({ sessionToken: 'rvrsess_123' }),
    });
    narrator.unlock();
    narrator.speak('Opening checkout.', { mode: 'append', key: 'step-1' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fake.spoken.at(-1).text, 'Opening checkout.');
    narrator.dispose();
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Audio = previousAudio;
    globalThis.URL = previousUrl;
    fake.restore();
  }
});
