import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoverBookmarklet,
  createRoverConsoleSnippet,
  createRoverScriptTagSnippet,
  readRoverScriptDataAttributes,
} from '../dist/previewBootstrap.js';

function scriptAttrs(attrs) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}

test('data attributes bootstrap from session token without a public key', () => {
  const config = readRoverScriptDataAttributes(scriptAttrs({
    'data-site-id': 'site_123',
    'data-session-token': 'rvrsess_demo',
    'data-session-id': 'session_abc',
    'data-allowed-domains': 'example.com, app.example.com',
    'data-domain-scope-mode': 'host_only',
    'data-open-on-init': 'true',
  }));

  assert.deepEqual(config, {
    siteId: 'site_123',
    sessionToken: 'rvrsess_demo',
    sessionId: 'session_abc',
    allowedDomains: ['example.com', 'app.example.com'],
    domainScopeMode: 'host_only',
    openOnInit: true,
  });
});

test('console snippets include boot and launch attach commands', () => {
  const snippet = createRoverConsoleSnippet({
    siteId: 'site_123',
    sessionToken: 'rvrsess_demo',
    sessionId: 'session_abc',
    apiBase: 'https://agent.rtrvr.ai',
    attachLaunch: {
      requestId: 'rl_123',
      attachToken: 'rlaunch_attach_demo',
    },
  });

  assert.match(snippet, /rover\('boot'/);
  assert.match(snippet, /rover\('attachLaunch'/);
  assert.match(snippet, /"sessionToken": "rvrsess_demo"/);
  assert.match(snippet, /https:\/\/rover\.rtrvr\.ai\/embed\.js/);
});

test('bookmarklets are javascript urls that reuse the same bootstrap payload', () => {
  const snippet = createRoverBookmarklet({
    siteId: 'site_123',
    sessionToken: 'rvrsess_demo',
    attachLaunch: {
      requestId: 'rl_123',
      attachToken: 'rlaunch_attach_demo',
    },
  });

  assert.equal(snippet.startsWith('javascript:'), true);
  assert.match(snippet, /rover\('attachLaunch'/);
  assert.match(snippet, /rvrsess_demo/);
});

test('script tag snippets can bootstrap with session token only', () => {
  const snippet = createRoverScriptTagSnippet({
    siteId: 'site_123',
    sessionToken: 'rvrsess_demo',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
  });

  assert.match(snippet, /data-site-id="site_123"/);
  assert.match(snippet, /data-session-token="rvrsess_demo"/);
  assert.match(snippet, /data-domain-scope-mode="registrable_domain"/);
});

