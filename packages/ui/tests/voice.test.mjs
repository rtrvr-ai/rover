import assert from 'node:assert/strict';
import test from 'node:test';

import { createElevenLabsVoiceTranscriber } from '../dist/voice.js';

test('elevenlabs dictation keeps partial text as draft and waits for committed transcript on stop', async () => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = globalThis.navigator;
  const previousWindow = globalThis.window;
  const previousWebSocket = globalThis.WebSocket;
  const fetchCalls = [];
  const sockets = [];
  const results = [];
  const ends = [];
  const processorSizes = [];

  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      sockets.push(this);
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }, 0);
    }
    send(message) {
      this.sent.push(JSON.parse(String(message)));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }

  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor(size) {
      processorSizes.push(size);
      return { onaudioprocess: null, connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    async close() {}
  }

  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      json: async () => ({
        wssUrl: 'wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=sutkn_123',
      }),
    };
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    },
  });
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.WebSocket = FakeWebSocket;

  try {
    const transcriber = createElevenLabsVoiceTranscriber({
      apiBase: 'https://agent.test',
      getAuth: async () => ({ sessionId: 'sess_123', sessionToken: 'rvrsess_123' }),
      handlers: {
        onResult: result => results.push(result),
        onEnd: meta => ends.push(meta),
      },
    });

    assert.equal(transcriber.isSupported(), true);
    transcriber.start({ language: 'en-US' });
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(fetchCalls[0].url, 'https://agent.test/v2/rover/audio/stt-token');
    assert.equal(sockets.length, 1);
    assert.deepEqual(processorSizes, [2048]);
    sockets[0].onmessage?.({
      data: JSON.stringify({ message_type: 'partial_transcript', text: 'open check' }),
    });
    assert.deepEqual(results.at(-1), {
      finalTranscript: '',
      interimTranscript: 'open check',
    });

    transcriber.stop();
    assert.equal(ends.length, 0);
    assert.equal(sockets[0].sent.at(-1).commit, true);

    sockets[0].onmessage?.({
      data: JSON.stringify({ message_type: 'committed_transcript', text: 'open checkout' }),
    });
    assert.deepEqual(results.at(-1), {
      finalTranscript: 'open checkout',
      interimTranscript: '',
    });
    assert.deepEqual(ends, [{ requested: true }]);
    transcriber.dispose();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
    }
    globalThis.window = previousWindow;
    globalThis.WebSocket = previousWebSocket;
  }
});
