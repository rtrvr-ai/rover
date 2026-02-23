import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesResumeTargetUrl, readCrossDomainResumeCookie } from '../dist/crossDomainResume.js';

function cookieKey(siteId) {
  return `rover_xdr_${String(siteId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
}

function withDom(url, cookie, run) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const parsed = new URL(url);

  globalThis.window = {
    location: {
      href: parsed.toString(),
      hostname: parsed.hostname,
      protocol: parsed.protocol,
    },
  };
  globalThis.document = { cookie };

  try {
    run();
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

test('cross-domain cookie accepts target path match with query subset', () => {
  const siteId = 'site_a';
  const payload = {
    sessionId: 'visitor-abc',
    handoffId: 'handoff-123',
    sourceHost: 'www.rtrvr.ai',
    targetUrl: 'https://rover.rtrvr.ai/workspace?sessionId=visitor-abc',
    timestamp: Date.now(),
  };
  const cookie = `${cookieKey(siteId)}=${encodeURIComponent(JSON.stringify(payload))}`;

  withDom('https://rover.rtrvr.ai/workspace?sessionId=visitor-abc&sessionToken=rvrsess_x', cookie, () => {
    const result = readCrossDomainResumeCookie(siteId, {
      currentUrl: globalThis.window.location.href,
      currentHost: globalThis.window.location.hostname,
      requireTargetMatch: true,
    });
    assert.equal(result?.sessionId, 'visitor-abc');
    assert.equal(result?.handoffId, 'handoff-123');
  });
});

test('cross-domain cookie rejects payload without handoff id', () => {
  const siteId = 'site_a';
  const payload = {
    sessionId: 'visitor-abc',
    sourceHost: 'www.rtrvr.ai',
    targetUrl: 'https://rover.rtrvr.ai/workspace',
    timestamp: Date.now(),
  };
  const cookie = `${cookieKey(siteId)}=${encodeURIComponent(JSON.stringify(payload))}`;

  withDom('https://rover.rtrvr.ai/workspace', cookie, () => {
    const result = readCrossDomainResumeCookie(siteId, {
      currentUrl: globalThis.window.location.href,
      currentHost: globalThis.window.location.hostname,
      requireTargetMatch: true,
    });
    assert.equal(result, null);
  });
});

test('cross-domain cookie rejects target mismatch', () => {
  const siteId = 'site_a';
  const payload = {
    sessionId: 'visitor-abc',
    handoffId: 'handoff-123',
    sourceHost: 'www.rtrvr.ai',
    targetUrl: 'https://rover.rtrvr.ai/pricing',
    timestamp: Date.now(),
  };
  const cookie = `${cookieKey(siteId)}=${encodeURIComponent(JSON.stringify(payload))}`;

  withDom('https://rover.rtrvr.ai/workspace', cookie, () => {
    const result = readCrossDomainResumeCookie(siteId, {
      currentUrl: globalThis.window.location.href,
      currentHost: globalThis.window.location.hostname,
      requireTargetMatch: true,
    });
    assert.equal(result, null);
  });
});

test('target url matcher accepts same path with trailing slash and extra query params', () => {
  withDom('https://rover.rtrvr.ai/workspace/?sessionId=abc&mode=full', '', () => {
    assert.equal(
      matchesResumeTargetUrl(
        'https://rover.rtrvr.ai/workspace?sessionId=abc',
        globalThis.window.location.href,
      ),
      true,
    );
  });
});

test('target url matcher rejects different origin', () => {
  withDom('https://rover.rtrvr.ai/workspace?sessionId=abc', '', () => {
    assert.equal(
      matchesResumeTargetUrl(
        'https://www.rtrvr.ai/workspace?sessionId=abc',
        globalThis.window.location.href,
      ),
      false,
    );
  });
});
