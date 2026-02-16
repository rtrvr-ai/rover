import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionCoordinator } from '../dist/sessionCoordinator.js';

function installBrowserEnv() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousBroadcastChannel = globalThis.BroadcastChannel;

  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };

  globalThis.window = {
    localStorage,
    location: { href: 'https://example.com/' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = { title: 'Test Page' };
  globalThis.BroadcastChannel = undefined;

  return {
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;

      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;

      if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
      else globalThis.BroadcastChannel = previousBroadcastChannel;
    },
  };
}

test('navigation handoff adopts logical tab id and rebinds active tab', () => {
  const env = installBrowserEnv();
  try {
    const firstRuntime = new SessionCoordinator({
      siteId: 'site-a',
      sessionId: 'session-a',
      runtimeId: 'runtime-a',
    });

    const originalLogicalTabId = firstRuntime.registerCurrentTab('https://example.com/start', 'Start');
    const handoffTs = Date.now();

    firstRuntime.broadcastClosing({
      handoffId: 'handoff-1',
      targetUrl: 'https://example.com/next',
      sourceLogicalTabId: originalLogicalTabId,
      ts: handoffTs,
    });

    const nextRuntime = new SessionCoordinator({
      siteId: 'site-a',
      sessionId: 'session-a',
      runtimeId: 'runtime-b',
    });

    const adoptedLogicalTabId = nextRuntime.registerCurrentTab(
      'https://example.com/next',
      'Next',
      {
        handoffId: 'handoff-1',
        targetUrl: 'https://example.com/next',
        sourceLogicalTabId: originalLogicalTabId,
        ts: handoffTs,
      },
    );

    assert.equal(adoptedLogicalTabId, originalLogicalTabId);
    assert.equal(nextRuntime.getActiveLogicalTabId(), originalLogicalTabId);

    const contextTabs = nextRuntime.listTabs({ scope: 'context' });
    assert.equal(contextTabs.length, 1);
    assert.equal(contextTabs[0].logicalTabId, originalLogicalTabId);
    assert.equal(contextTabs[0].runtimeId, 'runtime-b');
  } finally {
    env.restore();
  }
});

test('context scope excludes detached internal tabs while all scope keeps them briefly', () => {
  const env = installBrowserEnv();
  try {
    const runtime = new SessionCoordinator({
      siteId: 'site-b',
      sessionId: 'session-b',
      runtimeId: 'runtime-a',
    });

    const logicalTabId = runtime.registerCurrentTab('https://example.com/a', 'A');
    runtime.broadcastClosing({
      handoffId: 'handoff-2',
      targetUrl: 'https://example.com/b',
      sourceLogicalTabId: logicalTabId,
      ts: Date.now(),
    });

    assert.equal(runtime.listTabs({ scope: 'all' }).length, 1);
    assert.equal(runtime.listTabs({ scope: 'context' }).length, 0);
  } finally {
    env.restore();
  }
});

test('boundary pruning keeps active live tab and external placeholders only', () => {
  const env = installBrowserEnv();
  try {
    const runtime = new SessionCoordinator({
      siteId: 'site-c',
      sessionId: 'session-c',
      runtimeId: 'runtime-a',
    });

    const activeLogicalTabId = runtime.registerCurrentTab('https://example.com/home', 'Home');
    const externalLogicalTabId = runtime.registerOpenedTab({
      url: 'https://external.example.net/',
      external: true,
      openerRuntimeId: 'runtime-a',
    }).logicalTabId;
    const internalDetachedTabId = runtime.registerOpenedTab({
      url: 'https://example.com/background',
      external: false,
      openerRuntimeId: 'runtime-a',
    }).logicalTabId;

    runtime.pruneTabs({
      dropRuntimeDetached: true,
      keepOnlyActiveLiveTab: true,
      keepRecentExternalPlaceholders: true,
    });

    const allTabs = runtime.listTabs({ scope: 'all' });
    assert.equal(allTabs.some(tab => tab.logicalTabId === activeLogicalTabId && tab.runtimeId === 'runtime-a'), true);
    assert.equal(allTabs.some(tab => tab.logicalTabId === externalLogicalTabId && tab.external), true);
    assert.equal(allTabs.some(tab => tab.logicalTabId === internalDetachedTabId), false);
  } finally {
    env.restore();
  }
});

