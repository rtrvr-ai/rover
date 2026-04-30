import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFrameDiagnosticsDedupeKey,
  buildFrameDiagnosticsSummary,
  RoverFrameDiagnosticsClient,
  sanitizeFrameDiagnosticsUrl,
} from '../dist/frameDiagnostics.js';

test('builds compact frame diagnostics from page data metadata', () => {
  const summary = buildFrameDiagnosticsSummary({
    url: 'https://example.com/page?private=1#top',
    title: 'Checkout',
    nodes: {
      12: {
        isFrameElement: true,
        computedName: 'Payment frame',
        resourceLocator: 'https://pay.example.com/embed?session=secret#card',
        frameContent: [],
        frameRealm: [1, 3, 1],
        nodeCategory: 1,
      },
      13: {
        isFrameElement: true,
        computedName: 'Address frame',
        resourceLocator: '/address',
        frameContent: [3001, 3002],
        frameRealm: [2, 1, 0],
        nodeCategory: 1,
      },
    },
    metadata: {
      frameRealms: {
        version: 1,
        realms: {
          1: {
            origin: 'https://pay.example.com',
            url: 'https://pay.example.com/embed?session=secret#card',
            title: 'Payment',
            hostElementId: 12,
          },
          2: {
            origin: 'https://example.com',
            url: 'https://example.com/address?token=hidden',
            title: 'Address',
            hostElementId: 13,
          },
        },
      },
    },
  }, { captureId: 'cap-1', now: 123 });

  assert.equal(summary.captureId, 'cap-1');
  assert.equal(summary.pageUrl, 'https://example.com/page');
  assert.equal(summary.frameCount, 2);
  assert.equal(summary.frames[0].src, 'https://pay.example.com/embed');
  assert.equal(summary.frames[0].reasonLabel, 'Cross-origin frame without a frame agent');
  assert.equal(summary.frames[1].hasFrameContent, true);
  assert.equal(summary.frames[1].childCount, 2);
});

test('returns undefined when page data has no frames', () => {
  assert.equal(buildFrameDiagnosticsSummary({ nodes: { 1: { nodeCategory: 1 } } }, { captureId: 'none' }), undefined);
});

test('diagnostic URLs omit query and hash', () => {
  assert.equal(
    sanitizeFrameDiagnosticsUrl('https://calendar.google.com/embed?src=private#week'),
    'https://calendar.google.com/embed',
  );
});

test('dedupe key ignores capture timestamp', () => {
  const first = buildFrameDiagnosticsSummary({
    url: 'https://example.com',
    nodes: {
      1: {
        isFrameElement: true,
        resourceLocator: 'https://calendar.google.com/embed',
        frameContent: [],
        frameRealm: [1, 3, 1],
        nodeCategory: 1,
      },
    },
  }, { captureId: 'a', now: 1 });
  const second = buildFrameDiagnosticsSummary({
    url: 'https://example.com',
    nodes: {
      1: {
        isFrameElement: true,
        resourceLocator: 'https://calendar.google.com/embed',
        frameContent: [],
        frameRealm: [1, 3, 1],
        nodeCategory: 1,
      },
    },
  }, { captureId: 'b', now: 2 });
  assert.equal(buildFrameDiagnosticsDedupeKey(first), buildFrameDiagnosticsDedupeKey(second));
});

test('diagnostics upload silently skips when no session token is available', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called');
  };
  try {
    const client = new RoverFrameDiagnosticsClient({
      apiBase: 'https://agent.example.test',
      getSessionToken: () => undefined,
      siteId: 'site_123',
      sessionId: 'session_123',
    });
    const result = await client.upload({
      diagnostics: {
        version: 1,
        captureId: 'cap-1',
        capturedAt: 123,
        frameCount: 1,
        frames: [
          {
            hostElementId: 1,
            hasFrameContent: false,
            childCount: 0,
            unavailableCode: 1,
          },
        ],
      },
    });
    assert.equal(result, undefined);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
