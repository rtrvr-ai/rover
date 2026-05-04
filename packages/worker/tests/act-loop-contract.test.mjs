import assert from 'node:assert/strict';
import test from 'node:test';

import { executeAgenticSeek } from '../dist/agent/actAgent.js';

function createActHarness(routerResponses, options = {}) {
  const routerCalls = [];
  const clientToolCalls = [];
  const systemToolCalls = [];
  const pageDataCalls = [];
  let routerIndex = 0;

  const activeTabId = options.activeTabId || 1;
  const bridgeRpc = async (method, params) => {
    if (method === 'listSessionTabs') {
      return [
        {
          logicalTabId: activeTabId,
          runtimeId: 'runtime-agent',
          url: 'https://app.example.com',
          updatedAt: Date.now(),
        },
      ];
    }
    if (method === 'getTabContext') {
      return { activeLogicalTabId: activeTabId };
    }
    if (method === 'executeClientTool') {
      clientToolCalls.push(params);
      return options.clientToolResult ?? { ok: true };
    }
    if (method === 'executeTool') {
      systemToolCalls.push(params);
      return typeof options.executeToolResult === 'function'
        ? options.executeToolResult(params)
        : (options.executeToolResult ?? { success: true });
    }
    return undefined;
  };

  const ctx = {
    siteId: 'site_123',
    llmIntegration: {},
    apiMode: false,
    apiToolsConfig: undefined,
    userTimestamp: new Date().toISOString(),
    userProfile: undefined,
    isCancelled: () => false,
    getPageData: async (tabId, pageDataOptions) => {
      pageDataCalls.push({ tabId, options: pageDataOptions });
      return {
        url: `https://app.example.com/tab-${tabId}`,
        title: `Tab ${tabId}`,
        content: `content-${tabId}`,
        metadata: { logicalTabId: tabId },
      };
    },
    callExtensionRouter: async (_action, payload) => {
      routerCalls.push(payload);
      const response = routerResponses[routerIndex++];
      if (typeof response === 'function') {
        return response(payload);
      }
      return response;
    },
  };

  return {
    activeTabId,
    bridgeRpc,
    clientToolCalls,
    ctx,
    pageDataCalls,
    routerCalls,
    systemToolCalls,
  };
}

function actResponse(activeTabId, tabResponse, extraData = {}) {
  return {
    success: true,
    data: {
      creditsUsed: 0,
      taskComplete: false,
      tabResponses: {
        [activeTabId]: tabResponse,
      },
      ...extraData,
    },
  };
}

async function runAct(harness, options = {}) {
  return executeAgenticSeek({
    tabOrder: [harness.activeTabId],
    scopedTabIds: [harness.activeTabId],
    seedTabId: harness.activeTabId,
    userInput: 'complete the task',
    trajectoryId: options.trajectoryId || 'act-loop-contract',
    bridgeRpc: harness.bridgeRpc,
    ctx: harness.ctx,
    functionDeclarations: options.functionDeclarations,
  });
}

test('ACT stops on structured data from the active tab response', async () => {
  const harness = createActHarness([
    actResponse(1, {
      accTreeId: 'tree-data',
      data: [{ response: 'Done' }],
    }),
  ]);

  const result = await runAct(harness);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, [{ response: 'Done' }]);
  assert.equal(harness.routerCalls.length, 1);
  assert.equal(harness.clientToolCalls.length, 0);
  assert.equal(harness.systemToolCalls.length, 0);
  assert.equal(result.prevSteps?.length, 1);
  assert.equal(result.prevSteps?.[0]?.accTreeId, 'tree-data');
});

test('ACT loops after external function calls and returns final structured data', async () => {
  const harness = createActHarness(
    [
      actResponse(1, {
        accTreeId: 'tree-function',
        functionCalls: [
          {
            name: 'lookup_plan',
            args: { planId: 'pro' },
          },
        ],
      }),
      actResponse(1, {
        accTreeId: 'tree-final',
        data: [{ response: 'Plan selected' }],
      }),
    ],
    {
      clientToolResult: { planName: 'Pro' },
    },
  );

  const result = await runAct(harness, {
    functionDeclarations: [
      {
        name: 'lookup_plan',
        description: 'Lookup a plan by id',
        parameters: {
          type: 'object',
          properties: {
            planId: { type: 'string' },
          },
        },
      },
    ],
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, [{ response: 'Plan selected' }]);
  assert.equal(harness.routerCalls.length, 2);
  assert.equal(harness.clientToolCalls.length, 1);
  assert.deepEqual(harness.clientToolCalls[0], {
    name: 'lookup_plan',
    args: { planId: 'pro' },
  });
  assert.equal(result.prevSteps?.some(step => step.functions?.[0]?.name === 'lookup_plan'), true);
});

test('ACT returns waiting input for ask_user and does not execute sibling tools', async () => {
  const harness = createActHarness([
    actResponse(1, {
      accTreeId: 'tree-question',
      functionCalls: [
        {
          name: 'ask_user',
          args: {
            questions_to_ask: [
              {
                key: 'use_case',
                query: 'What are you trying to accomplish?',
                required: true,
              },
            ],
          },
        },
        {
          name: 'lookup_plan',
          args: { planId: 'pro' },
        },
      ],
    }),
  ]);

  const result = await runAct(harness, {
    functionDeclarations: [
      {
        name: 'lookup_plan',
        description: 'Lookup a plan by id',
      },
    ],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.needsUserInput, true);
  assert.deepEqual(result.questions, [
    {
      key: 'use_case',
      query: 'What are you trying to accomplish?',
      required: true,
    },
  ]);
  assert.equal(harness.routerCalls.length, 1);
  assert.equal(harness.clientToolCalls.length, 0);
  assert.equal(harness.systemToolCalls.length, 0);
  assert.equal(result.prevSteps?.[0]?.functions?.[0]?.name, 'ask_user');
  assert.equal(result.prevSteps?.[0]?.functions?.[1]?.response?.output?.status, 'deferred_after_ask_user');
});

test('ACT continues after navigation tool output before returning final data', async () => {
  const harness = createActHarness(
    [
      actResponse(1, {
        accTreeId: 'tree-nav',
        functionCalls: [
          {
            name: 'goto_url',
            args: { url: 'https://app.example.com/next' },
          },
        ],
      }),
      actResponse(1, {
        accTreeId: 'tree-after-nav',
        data: [{ response: 'Arrived' }],
      }),
    ],
    {
      executeToolResult: {
        success: true,
        output: {
          navigationPending: true,
          navigationOutcome: 'same_tab_scheduled',
          logicalTabId: 1,
        },
      },
    },
  );

  const result = await runAct(harness);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, [{ response: 'Arrived' }]);
  assert.equal(harness.routerCalls.length, 2);
  assert.equal(harness.systemToolCalls.length, 1);
  assert.deepEqual(harness.systemToolCalls[0]?.call, {
    name: 'goto_url',
    args: { url: 'https://app.example.com/next' },
  });
  assert.equal(harness.clientToolCalls.length, 0);
});

test('ACT retries empty or missing active tab responses and fails deterministically', async () => {
  const harness = createActHarness([
    {
      success: true,
      data: {
        creditsUsed: 0,
        tabResponses: {},
      },
    },
    actResponse(1, {
      accTreeId: 'tree-empty-one',
      thought: 'empty response one',
    }),
    actResponse(1, {
      accTreeId: 'tree-empty-two',
      thought: 'empty response two',
      functionCalls: [],
      data: [],
    }),
  ]);

  const result = await runAct(harness);

  assert.equal(result.error, 'Max retries reached');
  assert.equal(result.data, undefined);
  assert.equal(result.needsUserInput, undefined);
  assert.equal(harness.routerCalls.length, 3);
  assert.equal(harness.clientToolCalls.length, 0);
  assert.equal(harness.systemToolCalls.length, 0);
  assert.equal(result.prevSteps?.some(step => step.fail === 'Empty or unusable response'), true);
});
