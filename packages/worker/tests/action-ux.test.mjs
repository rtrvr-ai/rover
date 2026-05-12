import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionUxController } from '../dist/agent/actionUx.js';
import { executeAgenticSeek } from '../dist/agent/actAgent.js';
import { executePlannerWithTools } from '../dist/agent/plannerAgent.js';
import { executeSystemToolCallsSequentially } from '../dist/agent/systemTools.js';

function createCtx(callExtensionRouter) {
  return {
    userTimestamp: '2026-05-12T00:00:00.000Z',
    llmIntegration: { model: 'Gemini Flash' },
    callExtensionRouter,
  };
}

function target(elementId = 1, label = 'Work email') {
  return {
    target: {
      targetId: `element:${elementId}`,
      elementId,
      role: 'textbox',
      label,
      formLabel: 'Demo request',
      sensitivity: 'personal',
      visible: true,
    },
    page: { title: 'Acme', url: 'https://example.com/demo', host: 'example.com' },
  };
}

test('action UX previews spotlight target before executing the tool', async () => {
  const order = [];
  const bridgeRpc = async (method) => {
    order.push(method);
    if (method === 'previewActionTarget') return target();
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const lifecycle = [];
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => undefined),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionSpotlight: true, actionSpotlightDefaultActive: true } },
    actionSpotlight: true,
    actionSpotlightDefaultActive: true,
    postToolLifecycleEvent: (type) => lifecycle.push(type),
    postStatus: () => {},
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'click_element', args: { element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });

  assert.deepEqual(order.slice(0, 2), ['previewActionTarget', 'executeTool']);
  assert.deepEqual(lifecycle.slice(0, 2), ['tool_start', 'tool_result']);
});

test('narration-only target description does not block action execution', async () => {
  const order = [];
  const bridgeRpc = async (method) => {
    if (method === 'describeActionTarget') {
      order.push('describe:start');
      await new Promise(resolve => setTimeout(resolve, 180));
      order.push('describe:end');
      return target();
    }
    order.push(method);
    if (method === 'getTabContext') return { title: 'Acme', url: 'https://example.com/demo' };
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => ({ data: { shouldNarrate: false } })),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true } },
    actionNarration: true,
    actionNarrationDefaultActive: true,
    postToolLifecycleEvent: () => {},
    postStatus: () => {},
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'click_element', args: { element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });

  assert.ok(order.indexOf('executeTool') > order.indexOf('describe:start'));
  assert.ok(order.indexOf('executeTool') < order.indexOf('describe:end'));
  assert.equal(order.includes('previewActionTarget'), false);
});

test('narration compose runs when voice is not default-active for the run', async () => {
  const narrationRequests = [];
  const statuses = [];
  const bridgeRpc = async (method, params) => {
    if (method === 'describeActionTarget') return target(params?.call?.args?.element_id || 1, 'Run workflow');
    if (method === 'getTabContext') return { title: 'RTRVR', url: 'https://www.rtrvr.ai/' };
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async (action, payload) => {
      narrationRequests.push({ action, payload });
      return {
        data: {
          shouldNarrate: true,
          speechText: 'I’ll open the workflow demo.',
          displayText: 'Opening the workflow demo.',
          spotlightTargetIds: ['element:1'],
          captionTtlMs: 2500,
        },
      };
    }),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true, actionNarrationDefaultActive: false } },
    rootUserInput: 'Show me a demo of how to run a workflow on the cloud.',
    actionNarration: true,
    actionNarrationDefaultActive: false,
    postToolLifecycleEvent: () => {},
    postStatus: (message, _thought, _stage, meta) => statuses.push({ message, meta }),
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'click_element', args: { element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(narrationRequests.length, 1);
  assert.equal(narrationRequests[0].action, 'roverNarrationCompose');
  assert.equal(narrationRequests[0].payload.runKind, undefined);
  assert.equal(narrationRequests[0].payload.runKindSource, 'unspecified');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].message, 'Opening the workflow demo.');
  assert.equal(statuses[0].meta.narrationActive, false);
});

test('narration compose is skipped when narration is not available for the run', async () => {
  let narrationCalls = 0;
  const bridgeRpc = async (method) => {
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => {
      narrationCalls += 1;
      return { data: { shouldNarrate: true, speechText: 'Opening.', displayText: 'Opening.' } };
    }),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: false } },
    actionNarration: false,
    actionNarrationDefaultActive: false,
    postToolLifecycleEvent: () => {},
    postStatus: () => {},
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'click_element', args: { element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(narrationCalls, 0);
});

test('fast consecutive form fields are composed as one narration request', async () => {
  const narrationRequests = [];
  const bridgeRpc = async (method, params) => {
    if (method === 'describeActionTarget') return target(params?.call?.args?.element_id || 1);
    if (method === 'getTabContext') return { title: 'Acme', url: 'https://example.com/demo' };
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async (_action, payload) => {
      narrationRequests.push(payload);
      return {
        data: {
          shouldNarrate: true,
          speechText: 'I will complete the demo request details.',
          displayText: 'Completing the demo request details.',
          captionTtlMs: 2500,
        },
      };
    }),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true } },
    actionNarration: true,
    actionNarrationDefaultActive: true,
    postToolLifecycleEvent: () => {},
    postStatus: () => {},
  });

  await executeSystemToolCallsSequentially({
    calls: [
      { name: 'type_into_element', args: { element_id: 1, text: 'private@example.com' } },
      { name: 'type_into_element', args: { element_id: 2, text: 'Ada Lovelace' } },
    ],
    bridgeRpc,
    actionUx,
  });

  assert.equal(narrationRequests.length, 1);
  assert.equal(narrationRequests[0].actions.length, 2);
  assert.doesNotMatch(JSON.stringify(narrationRequests[0]), /private@example\.com|Ada Lovelace/);
});

test('stale narration is dropped after navigation output changes the action batch', async () => {
  const statuses = [];
  const bridgeRpc = async (method, params) => {
    if (method === 'describeActionTarget') return target(params?.call?.args?.element_id || 1, 'Continue');
    if (method === 'getTabContext') return { title: 'Acme', url: 'https://example.com/demo' };
    if (method === 'executeTool') {
      return {
        success: true,
        output: {
          navigationPending: true,
          navigationOutcome: 'same_tab_scheduled',
          logicalTabId: 1,
        },
      };
    }
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return {
        data: {
          shouldNarrate: true,
          speechText: 'Opening the next step.',
          displayText: 'Opening the next step.',
          spotlightTargetIds: ['element:1'],
          captionTtlMs: 2500,
        },
      };
    }),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true } },
    actionNarration: true,
    actionNarrationDefaultActive: true,
    postToolLifecycleEvent: () => {},
    postStatus: message => statuses.push(message),
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'goto_url', args: { url: 'https://example.com/next', element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });

  assert.deepEqual(statuses, []);
});

test('spotlight cleanup runs after cancellation before tool execution', async () => {
  const calls = [];
  let cancelled = false;
  const bridgeRpc = async (method) => {
    calls.push(method);
    if (method === 'previewActionTarget') {
      cancelled = true;
      return target();
    }
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => undefined),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionSpotlight: true } },
    actionSpotlight: true,
    actionSpotlightDefaultActive: true,
    postToolLifecycleEvent: () => {},
    postStatus: () => {},
    isCancelled: () => cancelled,
  });

  await assert.rejects(
    executeSystemToolCallsSequentially({
      calls: [{ name: 'click_element', args: { element_id: 1 } }],
      bridgeRpc,
      isCancelled: () => cancelled,
      actionUx,
    }),
    /Run cancelled/,
  );

  assert.deepEqual(calls, ['previewActionTarget', 'clearActionTarget']);
});

function createActHarness(routerResponses, options = {}) {
  const routerCalls = [];
  const hookCalls = [];
  let routerIndex = 0;
  const bridgeRpc = async (method, params) => {
    if (method === 'listSessionTabs') {
      return [{
        logicalTabId: 1,
        runtimeId: 'runtime-1',
        url: 'https://app.example.com',
        updatedAt: Date.now(),
      }];
    }
    if (method === 'getTabContext') return { activeLogicalTabId: 1 };
    if (method === 'executeTool') return { success: true, output: { ok: true, call: params?.call } };
    return {};
  };
  const ctx = {
    siteId: 'site_123',
    llmIntegration: {},
    apiMode: false,
    apiToolsConfig: undefined,
    userTimestamp: '2026-05-12T00:00:00.000Z',
    isCancelled: () => false,
    getPageData: async tabId => ({
      url: `https://app.example.com/tab-${tabId}`,
      title: `Tab ${tabId}`,
      content: `content-${tabId}`,
      metadata: { logicalTabId: tabId },
    }),
    callExtensionRouter: async (action, payload) => {
      routerCalls.push({ action, payload });
      const response = routerResponses[routerIndex++];
      return typeof response === 'function' ? response(action, payload) : response;
    },
  };
  const actionUx = {
    beforeTool(call) {
      hookCalls.push(`before:${call.name}`);
      return call;
    },
    afterTool(call) {
      hookCalls.push(`after:${call.name}`);
    },
    onBatchFinish() {
      hookCalls.push('finish');
    },
  };
  return { bridgeRpc, ctx, routerCalls, hookCalls, actionUx, ...options };
}

function actRouterResponse(tabResponse) {
  return {
    success: true,
    data: {
      creditsUsed: 0,
      tabResponses: {
        1: tabResponse,
      },
    },
  };
}

test('direct ACT system actions run through Action UX hooks', async () => {
  const harness = createActHarness([
    actRouterResponse({
      accTreeId: 'tree-action',
      functionCalls: [{ name: 'click_element', args: { element_id: 7 } }],
    }),
    actRouterResponse({
      accTreeId: 'tree-final',
      data: [{ response: 'Done' }],
    }),
  ]);

  const result = await executeAgenticSeek({
    tabOrder: [1],
    scopedTabIds: [1],
    seedTabId: 1,
    userInput: 'click continue',
    trajectoryId: 'act-action-ux',
    bridgeRpc: harness.bridgeRpc,
    ctx: harness.ctx,
    actionUx: harness.actionUx,
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(harness.hookCalls, ['before:click_element', 'after:click_element', 'finish']);
});

test('planner-selected ACT system actions preserve Action UX hooks', async () => {
  const harness = createActHarness([
    {
      success: true,
      data: {
        plan: {
          toolName: 'act_on_tab',
          parameters: { user_input: 'click continue' },
        },
        taskComplete: true,
        overallThought: 'Use ACT for this browser action.',
      },
    },
    actRouterResponse({
      accTreeId: 'tree-planner-action',
      functionCalls: [{ name: 'click_element', args: { element_id: 9 } }],
    }),
    actRouterResponse({
      accTreeId: 'tree-planner-final',
      data: [{ response: 'Done' }],
    }),
  ]);

  const result = await executePlannerWithTools({
    userInput: 'click continue',
    tabs: [{ id: 1, url: 'https://app.example.com' }],
    trajectoryId: 'planner-action-ux',
    previousSteps: [],
    ctx: harness.ctx,
    bridgeRpc: harness.bridgeRpc,
    actionUx: harness.actionUx,
  });

  assert.equal(result.response.error, undefined);
  assert.deepEqual(harness.hookCalls, ['before:click_element', 'after:click_element', 'finish']);
});
