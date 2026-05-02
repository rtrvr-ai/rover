import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractActionNarrationFromArgs,
  extractActionHighlightFromArgs,
  sanitizeActionNarration,
  stripToolUiHintsFromArgs,
} from '../dist/agent/uiHints.js';
import { createAgentContext } from '../dist/agent/context.js';

test('tool ui narration is sanitized and stripped from executable args', () => {
  const args = {
    tab_id: 1,
    element_id: 42,
    text: 'typed value',
    ui: {
      narration: '  Opening checkout so you can review the next step.  ',
    },
  };

  assert.equal(extractActionNarrationFromArgs(args), 'Opening checkout so you can review the next step.');
  assert.equal(sanitizeActionNarration('Password is hunter2'), undefined);
  assert.equal(
    extractActionNarrationFromArgs({
      text: 'secret@example.com',
      ui: { narration: 'Typing secret@example.com into the email field.' },
    }),
    undefined,
  );
  assert.equal(
    extractActionNarrationFromArgs({
      option_value: 'XL',
      ui: { narration: 'Selecting XL for the size filter.' },
    }),
    undefined,
  );
  assert.equal(
    extractActionNarrationFromArgs({
      file_name: 'tax-return.pdf',
      file_url: 'https://files.example.com/private/tax-return.pdf',
      ui: { narration: 'Uploading tax-return.pdf to the form.' },
    }),
    undefined,
  );
  assert.equal(
    extractActionNarrationFromArgs({
      path: '/Users/customer/private.pdf',
      ui: { narration: 'Uploading /Users/customer/private.pdf now.' },
    }),
    undefined,
  );
  assert.equal(
    extractActionNarrationFromArgs({
      query: 'winter jackets',
      ui: { narration: 'Searching for products now.' },
    }),
    'Searching for products now.',
  );

  const stripped = stripToolUiHintsFromArgs(args);
  assert.deepEqual(stripped, {
    tab_id: 1,
    element_id: 42,
    text: 'typed value',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(args, 'ui'), true);
});

test('action highlight extraction returns boolean only when explicitly set', () => {
  assert.equal(extractActionHighlightFromArgs({ ui: { highlight: true } }), true);
  assert.equal(extractActionHighlightFromArgs({ ui: { highlight: false } }), false);
  // Omitted highlight → undefined (defer to defaults)
  assert.equal(extractActionHighlightFromArgs({ ui: { narration: 'Click submit' } }), undefined);
  assert.equal(extractActionHighlightFromArgs({ ui: {} }), undefined);
  assert.equal(extractActionHighlightFromArgs({}), undefined);
  assert.equal(extractActionHighlightFromArgs(null), undefined);
  // Non-boolean must be rejected (no truthy coercion)
  assert.equal(extractActionHighlightFromArgs({ ui: { highlight: 'true' } }), undefined);
  assert.equal(extractActionHighlightFromArgs({ ui: { highlight: 1 } }), undefined);
});

test('rover runtime context preserves explicit narration ui hints', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { ok: true } }),
    };
  };

  try {
    const ctx = createAgentContext({
      siteId: 'site_123',
      apiBase: 'https://example.rtrvr.ai',
      sessionToken: 'rvrsess_test_token',
      runtimeContext: {
        mode: 'rover_embed',
        agentName: 'Acme Guide',
        site: {
          siteId: 'site_123',
          siteName: 'Acme Store',
          siteUrl: 'https://example.com/',
          host: 'example.com',
        },
        uiHints: {
          actionNarration: true,
          actionNarrationDefaultActive: false,
          actionSpotlight: true,
          actionSpotlightDefaultActive: true,
          runKind: 'guide',
        },
      },
    }, async () => undefined);

    await ctx.callExtensionRouter('processTabWorkflows', { userInput: 'show me checkout' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.runtimeContext.agentName, 'Acme Guide');
    assert.deepEqual(requests[0].data.runtimeContext.site, {
      siteId: 'site_123',
      siteName: 'Acme Store',
      siteUrl: 'https://example.com/',
      host: 'example.com',
    });
    assert.deepEqual(requests[0].data.runtimeContext.uiHints, {
      actionNarration: true,
      actionNarrationDefaultActive: false,
      actionSpotlight: true,
      actionSpotlightDefaultActive: true,
      runKind: 'guide',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
