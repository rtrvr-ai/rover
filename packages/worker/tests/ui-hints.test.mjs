import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractActionNarrationFromArgs,
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

  const stripped = stripToolUiHintsFromArgs(args);
  assert.deepEqual(stripped, {
    tab_id: 1,
    element_id: 42,
    text: 'typed value',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(args, 'ui'), true);
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
      runKind: 'guide',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
