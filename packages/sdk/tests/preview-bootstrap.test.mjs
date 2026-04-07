import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoverConsoleSnippet,
  createRoverScriptTagSnippet,
  readRoverScriptDataAttributes,
} from '../dist/previewBootstrap.js';

test('script tag snippet includes default-on Rover discovery marker and service links', () => {
  const snippet = createRoverScriptTagSnippet({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
  });

  assert.match(snippet, /application\/agent\+json/);
  assert.match(snippet, /data-rover-agent-discovery="marker"/);
  assert.match(snippet, /rel="service-desc"/);
  assert.match(snippet, /rel="service-doc"/);
  assert.match(snippet, /data-site-id="site_123"/);
});

test('preview bootstrap preserves ui.voice across console and script-tag helpers', () => {
  const config = {
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    ui: {
      voice: {
        enabled: true,
        language: 'en-US',
        autoStopMs: 2800,
      },
    },
  };

  const consoleSnippet = createRoverConsoleSnippet(config);
  const scriptSnippet = createRoverScriptTagSnippet(config);

  assert.match(consoleSnippet, /"voice":\s*\{/);
  assert.match(consoleSnippet, /"enabled":\s*true/);
  assert.match(consoleSnippet, /"language":\s*"en-US"/);
  assert.match(consoleSnippet, /"autoStopMs":\s*2800/);
  assert.match(scriptSnippet, /data-voice-enabled="true"/);
  assert.match(scriptSnippet, /data-voice-language="en-US"/);
  assert.match(scriptSnippet, /data-voice-auto-stop-ms="2800"/);

  const parsed = readRoverScriptDataAttributes({
    getAttribute(name) {
      const attrs = {
        'data-site-id': 'site_123',
        'data-public-key': 'pk_site_123',
        'data-voice-enabled': 'true',
        'data-voice-language': 'en-US',
        'data-voice-auto-stop-ms': '2800',
      };
      return attrs[name] ?? null;
    },
  });

  assert.deepEqual(parsed?.ui, {
    voice: {
      enabled: true,
      language: 'en-US',
      autoStopMs: 2800,
    },
  });
});
