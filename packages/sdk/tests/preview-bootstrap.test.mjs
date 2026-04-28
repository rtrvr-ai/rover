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
  assert.doesNotMatch(snippet, /"task"/);
});

test('preview bootstrap preserves ui voice, experience, cloud sandbox, and page config across helpers', () => {
  const config = {
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    sessionId: 'sess_123',
    sessionScope: 'shared_site',
    cloudSandboxEnabled: true,
    pageConfig: {
      disableAutoScroll: true,
    },
    ui: {
      voice: {
        enabled: true,
        language: 'en-US',
        autoStopMs: 2800,
      },
      experience: {
        audio: {
          narration: {
            enabled: false,
            defaultMode: 'always',
            rate: 1.2,
            language: 'en-US<script>',
            voicePreference: 'natural',
          },
        },
        motion: {
          actionSpotlight: false,
          actionSpotlightColor: '#2563eb',
        },
      },
    },
  };

  const consoleSnippet = createRoverConsoleSnippet(config);
  const scriptSnippet = createRoverScriptTagSnippet(config);

  assert.match(consoleSnippet, /"voice":\s*\{/);
  assert.match(consoleSnippet, /"enabled":\s*true/);
  assert.match(consoleSnippet, /"language":\s*"en-US"/);
  assert.match(consoleSnippet, /"autoStopMs":\s*2800/);
  assert.match(consoleSnippet, /"cloudSandboxEnabled":\s*true/);
  assert.match(consoleSnippet, /"disableAutoScroll":\s*true/);
  assert.match(consoleSnippet, /"narration":\s*\{/);
  assert.match(consoleSnippet, /"defaultMode":\s*"always"/);
  assert.match(consoleSnippet, /"rate":\s*1\.15/);
  assert.match(consoleSnippet, /"actionSpotlight":\s*false/);
  assert.match(consoleSnippet, /"actionSpotlightColor":\s*"#2563EB"/);
  assert.match(consoleSnippet, /"sessionId":\s*"sess_123"/);
  assert.match(consoleSnippet, /"sessionScope":\s*"shared_site"/);
  assert.match(scriptSnippet, /data-session-id="sess_123"/);
  assert.match(scriptSnippet, /data-session-scope="shared_site"/);
  assert.match(scriptSnippet, /data-cloud-sandbox-enabled="true"/);
  assert.match(scriptSnippet, /data-disable-auto-scroll="true"/);
  assert.match(scriptSnippet, /data-voice-enabled="true"/);
  assert.match(scriptSnippet, /data-voice-language="en-US"/);
  assert.match(scriptSnippet, /data-voice-auto-stop-ms="2800"/);
  assert.match(scriptSnippet, /data-narration-enabled="false"/);
  assert.match(scriptSnippet, /data-narration-default-mode="always"/);
  assert.match(scriptSnippet, /data-narration-rate="1.15"/);
  assert.match(scriptSnippet, /data-narration-language="en-USscript"/);
  assert.match(scriptSnippet, /data-narration-voice-preference="natural"/);
  assert.match(scriptSnippet, /data-action-spotlight="false"/);
  assert.match(scriptSnippet, /data-action-spotlight-color="#2563EB"/);

  const parsed = readRoverScriptDataAttributes({
    getAttribute(name) {
      const attrs = {
        'data-site-id': 'site_123',
        'data-public-key': 'pk_site_123',
        'data-session-id': 'sess_123',
        'data-session-scope': 'shared_site',
        'data-cloud-sandbox-enabled': 'true',
        'data-disable-auto-scroll': 'true',
        'data-voice-enabled': 'true',
        'data-voice-language': 'en-US',
        'data-voice-auto-stop-ms': '2800',
        'data-narration-enabled': 'false',
        'data-narration-default-mode': 'always',
        'data-narration-rate': '1.2',
        'data-narration-language': 'en-US<script>',
        'data-narration-voice-preference': 'natural',
        'data-action-spotlight': 'false',
        'data-action-spotlight-color': '#2563eb',
      };
      return attrs[name] ?? null;
    },
  });

  assert.equal(parsed?.sessionId, 'sess_123');
  assert.equal(parsed?.sessionScope, 'shared_site');
  assert.equal(parsed?.cloudSandboxEnabled, true);
  assert.deepEqual(parsed?.pageConfig, {
    disableAutoScroll: true,
  });
  assert.deepEqual(parsed?.ui, {
    voice: {
      enabled: true,
      language: 'en-US',
      autoStopMs: 2800,
    },
    experience: {
      audio: {
        narration: {
          enabled: false,
          defaultMode: 'always',
          rate: 1.15,
          language: 'en-USscript',
          voicePreference: 'natural',
        },
      },
      motion: {
        actionSpotlight: false,
        actionSpotlightColor: '#2563EB',
      },
    },
  });
});

test('preview bootstrap preserves explicit auto-scroll enabled data attribute', () => {
  const scriptSnippet = createRoverScriptTagSnippet({
    siteId: 'site_scroll_on',
    publicKey: 'pk_site_scroll_on',
    pageConfig: {
      disableAutoScroll: false,
    },
  });

  assert.match(scriptSnippet, /data-disable-auto-scroll="false"/);

  const parsed = readRoverScriptDataAttributes({
    getAttribute(name) {
      const attrs = {
        'data-site-id': 'site_scroll_on',
        'data-public-key': 'pk_site_scroll_on',
        'data-disable-auto-scroll': 'false',
      };
      return attrs[name] ?? null;
    },
  });

  assert.deepEqual(parsed?.pageConfig, { disableAutoScroll: false });
});
