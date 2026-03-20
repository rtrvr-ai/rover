import assert from 'node:assert/strict';
import test from 'node:test';

import { clearCrossDomainResumeCookie, writeCrossDomainResumeCookie } from '../dist/crossDomainResume.js';

function withCookieCapture(url, run) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const parsed = new URL(url);
  const writes = [];

  globalThis.window = {
    location: {
      href: parsed.toString(),
      hostname: parsed.hostname,
      protocol: parsed.protocol,
    },
  };
  globalThis.document = {};
  Object.defineProperty(globalThis.document, 'cookie', {
    configurable: true,
    get() {
      return '';
    },
    set(value) {
      writes.push(String(value || ''));
    },
  });

  try {
    run(writes);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

test('cross-domain resume cookie scopes to the full private registrable domain', () => {
  withCookieCapture('https://beta.sphere-demo-nine.vercel.app/workspace', writes => {
    writeCrossDomainResumeCookie('site_private_suffix', {
      sessionId: 'session_123',
      handoffId: 'handoff_123',
      timestamp: Date.now(),
    });

    assert.equal(writes.length, 1);
    assert.match(writes[0], /domain=\.sphere-demo-nine\.vercel\.app/i);
    assert.doesNotMatch(writes[0], /domain=\.vercel\.app/i);
  });
});

test('cross-domain resume cookie does not set a domain attribute for localhost or IP hosts', () => {
  withCookieCapture('http://localhost:3000/workspace', writes => {
    writeCrossDomainResumeCookie('site_localhost', {
      sessionId: 'session_local',
      handoffId: 'handoff_local',
      timestamp: Date.now(),
    });

    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0], /domain=/i);
  });

  withCookieCapture('http://[::1]:3000/workspace', writes => {
    writeCrossDomainResumeCookie('site_ipv6', {
      sessionId: 'session_ipv6',
      handoffId: 'handoff_ipv6',
      timestamp: Date.now(),
    });

    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0], /domain=/i);
  });
});

test('clearing cross-domain resume cookie reuses the hardened domain scope', () => {
  withCookieCapture('https://beta.sphere-demo-nine.vercel.app/workspace', writes => {
    clearCrossDomainResumeCookie('site_private_suffix');

    assert.equal(writes.length, 1);
    assert.match(writes[0], /max-age=0/i);
    assert.match(writes[0], /domain=\.sphere-demo-nine\.vercel\.app/i);
  });
});
