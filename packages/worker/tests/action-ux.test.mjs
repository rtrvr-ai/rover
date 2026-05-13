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

test('narration-only server presentation does not block action execution', async () => {
  const order = [];
  const bridgeRpc = async (method) => {
    order.push(method);
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const statuses = [];
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => {
      throw new Error('worker should not compose narration');
    }),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true } },
    actionNarration: true,
    actionNarrationDefaultActive: true,
    postToolLifecycleEvent: () => {},
    postStatus: message => {
      order.push('status');
      statuses.push(message);
    },
  });
  actionUx.setServerPresentations({
    source: 'act',
    shouldNarrate: true,
    speechText: 'Opening the workflow demo.',
    displayText: 'Opening the workflow demo.',
    spotlightTargetIds: ['element:1'],
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'click_element', args: { element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });

  assert.ok(order.indexOf('status') >= 0);
  assert.ok(order.indexOf('status') < order.indexOf('executeTool'));
  assert.equal(order.includes('previewActionTarget'), false);
  assert.deepEqual(statuses, ['Opening the workflow demo.']);
});

test('server narration presentation does not call extensionRouter and preserves inactive voice meta', async () => {
  const statuses = [];
  const bridgeRpc = async (method) => {
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  let routerCalls = 0;
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => {
      routerCalls += 1;
      return undefined;
    }),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true, actionNarrationDefaultActive: false } },
    rootUserInput: 'Show me a demo of how to run a workflow on the cloud.',
    actionNarration: true,
    actionNarrationDefaultActive: false,
    postToolLifecycleEvent: () => {},
    postStatus: (message, _thought, _stage, meta) => statuses.push({ message, meta }),
  });
  actionUx.setServerPresentations({
    source: 'act',
    shouldNarrate: true,
    speechText: 'I’ll open the workflow demo.',
    displayText: 'Opening the workflow demo.',
    spotlightTargetIds: ['element:1'],
    narrationActive: false,
  });

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'click_element', args: { element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(routerCalls, 0);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].message, 'Opening the workflow demo.');
  assert.equal(statuses[0].meta.narrationActive, false);
});

test('missing server narration presentation does not block action execution', async () => {
  const order = [];
  const bridgeRpc = async (method) => {
    order.push(method);
    if (method === 'executeTool') return { success: true, output: {} };
    return {};
  };
  const actionUx = new ActionUxController({
    ctx: createCtx(async () => undefined),
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

  assert.equal(order.includes('executeTool'), true);
});

test('queued server narration is cleared after navigation output changes the action batch', async () => {
  const statuses = [];
  const bridgeRpc = async (method) => {
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
    ctx: createCtx(async () => undefined),
    bridgeRpc,
    runtimeContext: { mode: 'rover_embed', uiHints: { actionNarration: true } },
    actionNarration: true,
    actionNarrationDefaultActive: true,
    postToolLifecycleEvent: () => {},
    postStatus: message => statuses.push(message),
  });
  actionUx.setServerPresentations([
    {
      source: 'act',
      shouldNarrate: true,
      speechText: 'Opening the next step.',
      displayText: 'Opening the next step.',
      spotlightTargetIds: ['element:1'],
      captionTtlMs: 2500,
    },
    {
      source: 'act',
      shouldNarrate: true,
      speechText: 'This should clear before another batch.',
      displayText: 'This should clear before another batch.',
      spotlightTargetIds: ['element:2'],
      captionTtlMs: 2500,
    },
  ]);

  await executeSystemToolCallsSequentially({
    calls: [{ name: 'goto_url', args: { url: 'https://example.com/next', element_id: 1 } }],
    bridgeRpc,
    actionUx,
  });

  assert.deepEqual(statuses, ['Opening the next step.']);
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
