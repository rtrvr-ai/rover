import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentContext } from '../dist/agent/context.js';

function createConfig() {
  return {
    siteId: 'site_123',
    apiBase: 'https://example.rtrvr.ai',
    sessionToken: 'rvrsess_test_token',
    sessionId: 'session_123',
    activeRunId: 'run_123',
    sessionEpoch: 2,
    sessionSeq: 8,
    tools: {
      web: {
        enableExternalWebContext: true,
        scrapeMode: 'on_demand',
      },
    },
    runtimeContext: {
      mode: 'rover_embed',
      agentName: 'Rover',
      tabIdContract: 'tree_index_mapped_by_tab_order',
    },
  };
}

function createBridgeRpc(activeLogicalTabId = 7) {
  return async (method, params) => {
    if (method === 'getTabContext') {
      return { activeLogicalTabId };
    }
    if (method === 'getPageData') {
      const tabId = Number(params?.tabId || activeLogicalTabId);
      return {
        url: 'https://external.example/path',
        title: `External ${tabId}`,
        contentType: 'text/html',
        content: `placeholder-${tabId}`,
        metadata: {
          external: true,
          accessMode: 'external_placeholder',
          logicalTabId: tabId,
        },
      };
    }
    return undefined;
  };
}

test('navigation-only external intent auto-routes to read_context', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          pageData: {
            url: body.url,
            title: 'External Read Context',
            contentType: 'text/html',
            content: 'external-read-context',
            metadata: {
              provider: 'test',
            },
          },
        },
      }),
    };
  };

  try {
    const ctx = createAgentContext(createConfig(), createBridgeRpc());
    const pageData = await ctx.getPageData(7, {
      __roverAllowExternalFetch: true,
      __roverExternalIntent: 'auto',
      __roverExternalMessage: 'open https://external.example/path',
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].intent, 'read_context');
    assert.equal(pageData?.metadata?.accessMode, 'external_scraped');
    assert.equal(pageData?.content, 'external-read-context');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('explicit open_only intent preserves placeholder page data', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          intent: 'open_only',
          mode: 'open_only',
          url: body.url,
        },
      }),
    };
  };

  try {
    const ctx = createAgentContext(createConfig(), createBridgeRpc());
    const pageData = await ctx.getPageData(7, {
      __roverAllowExternalFetch: true,
      __roverExternalIntent: 'open_only',
      __roverExternalMessage: 'open this external page',
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].intent, 'open_only');
    assert.equal(pageData?.metadata?.accessMode, 'external_placeholder');
    assert.equal(pageData?.content, 'placeholder-7');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('context-seeking external intent routes to read_context and returns scraped metadata', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          pageData: {
            url: body.url,
            title: 'Scraped External',
            contentType: 'text/html',
            content: 'scraped-content',
            metadata: {
              provider: 'test',
            },
          },
        },
      }),
    };
  };

  try {
    const ctx = createAgentContext(createConfig(), createBridgeRpc());
    const pageData = await ctx.getPageData(7, {
      __roverAllowExternalFetch: true,
      __roverExternalIntent: 'auto',
      __roverExternalMessage: 'summarize this page for me',
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].intent, 'read_context');
    assert.equal(pageData?.metadata?.accessMode, 'external_scraped');
    assert.equal(pageData?.content, 'scraped-content');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mutation-style external intent routes to act', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          pageData: {
            url: body.url,
            title: 'Cloud Action Context',
            contentType: 'text/html',
            content: 'acted-context',
            metadata: {
              mode: 'act',
            },
          },
        },
      }),
    };
  };

  try {
    const ctx = createAgentContext(createConfig(), createBridgeRpc());
    const pageData = await ctx.getPageData(7, {
      __roverAllowExternalFetch: true,
      __roverExternalIntent: 'auto',
      __roverExternalMessage: 'apply to this job now',
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].intent, 'act');
    assert.equal(pageData?.metadata?.accessMode, 'external_scraped');
    assert.equal(pageData?.content, 'acted-context');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
