import assert from 'node:assert/strict';
import test from 'node:test';

import { executeAgenticSeek } from '../dist/agent/actAgent.js';
import { executeExtract } from '../dist/agent/extractAgent.js';
import { executePlanner } from '../dist/agent/plannerAgent.js';
import { resolveRuntimeTabs } from '../dist/agent/runtimeTabs.js';

function createScopedBridgeRpc() {
  const now = Date.now();
  return async (method) => {
    if (method === 'listSessionTabs') {
      return [
        { logicalTabId: 1, runtimeId: 'runtime-agent', url: 'https://app.example.com', updatedAt: now },
        { logicalTabId: 2, runtimeId: 'runtime-manual', url: 'https://app.example.com/other', updatedAt: now },
        { logicalTabId: 3, runtimeId: 'runtime-agent', url: 'https://app.example.com/details', updatedAt: now },
      ];
    }
    if (method === 'getTabContext') {
      return { activeLogicalTabId: 2 };
    }
    return undefined;
  };
}

function createAgentContext(requests) {
  return {
    siteId: 'site_123',
    llmIntegration: {},
    apiMode: false,
    apiToolsConfig: undefined,
    userTimestamp: new Date().toISOString(),
    userProfile: undefined,
    isCancelled: () => false,
    getPageData: async (tabId) => ({
      url: `https://app.example.com/tab-${tabId}`,
      title: `Tab ${tabId}`,
      content: `content-${tabId}`,
      metadata: {
        logicalTabId: tabId,
      },
    }),
    callExtensionRouter: async (_action, payload) => {
      requests.push(payload);
      const activeTabId = Number(payload?.activeTabId || 1);
      return {
        success: true,
        data: {
          creditsUsed: 0,
          taskComplete: false,
          questions: [],
          tabResponses: {
            [activeTabId]: {
              data: [{ ok: true }],
            },
          },
        },
      };
    },
  };
}

test('resolveRuntimeTabs enforces scope even when active tab is user-opened out-of-scope tab', async () => {
  const bridgeRpc = createScopedBridgeRpc();
  const resolved = await resolveRuntimeTabs(
    bridgeRpc,
    [{ id: 1 }, { id: 3 }],
    { scopedTabIds: [1, 3], seedTabId: 1 },
  );

  assert.deepEqual(resolved.tabOrder, [1, 3]);
  assert.equal(resolved.activeTabId, 1);
  assert.equal(resolved.tabMetaById[2], undefined);
});

test('resolveRuntimeTabs keeps explicitly scoped ids even when listing is partial', async () => {
  const bridgeRpc = async (method) => {
    if (method === 'listSessionTabs') {
      return [
        { logicalTabId: 1, runtimeId: 'runtime-agent', url: 'https://app.example.com', updatedAt: Date.now() },
        { logicalTabId: 3, runtimeId: 'runtime-agent', url: 'https://app.example.com/details', updatedAt: Date.now() },
      ];
    }
    if (method === 'getTabContext') {
      return { activeLogicalTabId: 1 };
    }
    return undefined;
  };

  const resolved = await resolveRuntimeTabs(
    bridgeRpc,
    [{ id: 1 }, { id: 3 }, { id: 99 }],
    { scopedTabIds: [1, 3, 99], seedTabId: 1 },
  );

  assert.deepEqual(resolved.tabOrder, [1, 3, 99]);
  assert.equal(resolved.tabMetaById[99]?.id, 99);
  assert.equal(resolved.tabMetaById[99]?.accessMode, 'live_dom');
});

test('ACT loop keeps tabOrder limited to scoped tabs', async () => {
  const bridgeRpc = createScopedBridgeRpc();
  const requests = [];
  const ctx = createAgentContext(requests);

  const result = await executeAgenticSeek({
    tabOrder: [1, 3],
    scopedTabIds: [1, 3],
    seedTabId: 1,
    userInput: 'collect data from current scoped tabs',
    trajectoryId: 'traj-1',
    bridgeRpc,
    ctx,
  });

  assert.equal(result.error, undefined);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tabOrder, [1, 3]);
  assert.equal(Object.hasOwn(requests[0].webPageMap, 2), false);
});

test('PLANNER loop keeps tabOrder limited to scoped tabs', async () => {
  const bridgeRpc = createScopedBridgeRpc();
  const requests = [];
  const ctx = createAgentContext(requests);

  await executePlanner({
    userInput: 'summarize tab context',
    tabs: [{ id: 1 }, { id: 3 }],
    scopedTabIds: [1, 3],
    seedTabId: 1,
    trajectoryId: 'traj-2',
    ctx,
    bridgeRpc,
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tabOrder, [1, 3]);
  assert.equal(Object.hasOwn(requests[0].webPageMap, 2), false);
});

test('EXTRACT loop uses scoped active tab and excludes user-opened out-of-scope tab', async () => {
  const bridgeRpc = createScopedBridgeRpc();
  const requests = [];
  const ctx = createAgentContext(requests);

  await executeExtract({
    tabOrder: [1, 3],
    scopedTabIds: [1, 3],
    seedTabId: 1,
    userInput: 'extract rows',
    trajectoryId: 'traj-3',
    bridgeRpc,
    ctx,
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tabOrder, [1]);
  assert.deepEqual(Object.keys(requests[0].webPageMap), ['1']);
});

test('ACT loop adds agent-opened tabs into runtime scope within the same run', async () => {
  let activeLogicalTabId = 1;
  let openedTabReady = false;
  const requests = [];

  const bridgeRpc = async (method, params) => {
    if (method === 'listSessionTabs') {
      const tabs = [
        { logicalTabId: 1, runtimeId: 'runtime-agent', url: 'https://app.example.com', updatedAt: Date.now() },
      ];
      if (openedTabReady) {
        tabs.push({ logicalTabId: 3, runtimeId: 'runtime-agent', url: 'https://app.example.com/new', updatedAt: Date.now() });
      }
      return tabs;
    }
    if (method === 'getTabContext') {
      return { activeLogicalTabId };
    }
    if (method === 'executeTool') {
      const toolName = String(params?.call?.name || '');
      if (toolName === 'open_new_tab') {
        openedTabReady = true;
        activeLogicalTabId = 3;
        return {
          success: true,
          output: {
            navigationOutcome: 'new_tab_opened',
            openedInNewTab: true,
            logicalTabId: 3,
          },
        };
      }
      if (toolName === 'switch_tab') {
        const next = Number(params?.call?.args?.logical_tab_id || params?.call?.args?.tab_id);
        if (Number.isFinite(next) && next > 0) {
          activeLogicalTabId = next;
        }
        return {
          success: true,
          output: {
            navigationOutcome: 'switch_tab',
            logicalTabId: activeLogicalTabId,
          },
        };
      }
      return { success: true };
    }
    return undefined;
  };

  let callCount = 0;
  const ctx = {
    siteId: 'site_123',
    llmIntegration: {},
    apiMode: false,
    apiToolsConfig: undefined,
    userTimestamp: new Date().toISOString(),
    userProfile: undefined,
    isCancelled: () => false,
    getPageData: async (tabId) => ({
      url: `https://app.example.com/tab-${tabId}`,
      title: `Tab ${tabId}`,
      content: `content-${tabId}`,
      metadata: {
        logicalTabId: tabId,
      },
    }),
    callExtensionRouter: async (_action, payload) => {
      requests.push(payload);
      callCount += 1;
      const activeTabId = Number(payload?.activeTabId || 1);
      if (callCount === 1) {
        return {
          success: true,
          data: {
            creditsUsed: 0,
            taskComplete: false,
            tabResponses: {
              [activeTabId]: {
                thought: 'open destination in new tab',
                functionCalls: [
                  {
                    name: 'open_new_tab',
                    args: { url: 'https://app.example.com/new' },
                  },
                ],
              },
            },
          },
        };
      }
      return {
        success: true,
        data: {
          creditsUsed: 0,
          taskComplete: true,
          tabResponses: {
            [activeTabId]: {
              data: [{ ok: true, tabId: activeTabId }],
            },
          },
        },
      };
    },
  };

  const touchedScopes = [];
  const result = await executeAgenticSeek({
    tabOrder: [1],
    scopedTabIds: [1],
    seedTabId: 1,
    userInput: 'open a new tab and continue there',
    trajectoryId: 'traj-4',
    bridgeRpc,
    ctx,
    onScopedTabIdsTouched: (tabIds) => touchedScopes.push([...tabIds]),
  });

  assert.equal(result.error, undefined);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].activeTabId, 1);
  assert.equal(requests[1].activeTabId, 3);
  assert.equal(requests[1].tabOrder.includes(3), true);
  assert.equal(touchedScopes.some(scope => scope.includes(3)), true);
});
