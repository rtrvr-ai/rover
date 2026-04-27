import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNavigationTabDisposition } from '../../sdk/dist/navigationTabDisposition.js';

if (!globalThis.window) {
  globalThis.window = {
    location: {
      href: 'https://bootstrap.invalid/',
      hostname: 'bootstrap.invalid',
      assign(next) {
        this.href = next;
      },
      reload() {},
    },
    setTimeout,
    clearTimeout,
    open: () => null,
    history: {
      back() {},
      forward() {},
    },
  };
}

if (!globalThis.document) {
  globalThis.document = {
    nodeType: 9,
    defaultView: globalThis.window,
    body: { appendChild() {}, removeChild() {} },
    documentElement: {},
    createElement() {
      return {
        style: {},
        click() {},
        remove() {},
      };
    },
  };
}

if (!globalThis.Element) globalThis.Element = class {};
if (!globalThis.HTMLElement) globalThis.HTMLElement = class extends globalThis.Element {};
if (!globalThis.HTMLAnchorElement) globalThis.HTMLAnchorElement = class extends globalThis.HTMLElement {};

const { Bridge } = await import('../dist/index.js');

class FakeElement {
  constructor(tagName = 'DIV', attrs = {}) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'DIV').toUpperCase();
    this.attributes = { ...attrs };
    this.ownerDocument = null;
    this.lastElementChild = null;
    this.previousElementSibling = null;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  closest(selector) {
    if (selector === 'a[href]' && this instanceof FakeAnchorElement && this.href) return this;
    return null;
  }
}

class FakeAnchorElement extends FakeElement {
  constructor(href, attrs = {}) {
    super('A', attrs);
    this.href = href;
  }
}

function installBrowserEnv(options = {}) {
  const href = options.href || 'https://www.example.com/start';
  const location = {
    href,
    get hostname() {
      return new URL(this.href).hostname;
    },
    assign(next) {
      this.href = next;
    },
    reload() {},
  };
  const win = {
    location,
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {},
    open: options.open || (() => null),
    history: {
      back() {},
      forward() {},
    },
  };
  const root = new FakeElement('DIV');
  const doc = {
    nodeType: 9,
    defaultView: win,
    body: root,
    documentElement: root,
    createElement(tagName) {
      if (String(tagName).toLowerCase() === 'a') {
        const anchor = new FakeAnchorElement('', {});
        anchor.style = {};
        anchor.click = () => {};
        anchor.remove = () => {};
        anchor.ownerDocument = doc;
        return anchor;
      }
      const element = new FakeElement(tagName);
      element.ownerDocument = doc;
      return element;
    },
  };
  root.ownerDocument = doc;
  root.appendChild = (child) => {
    child.ownerDocument = doc;
    child.previousElementSibling = root.lastElementChild;
    root.lastElementChild = child;
  };

  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLAnchorElement: globalThis.HTMLAnchorElement,
  };

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLAnchorElement = FakeAnchorElement;

  return {
    doc,
    restore() {
      globalThis.window = previousGlobals.window;
      globalThis.document = previousGlobals.document;
      globalThis.Element = previousGlobals.Element;
      globalThis.HTMLElement = previousGlobals.HTMLElement;
      globalThis.HTMLAnchorElement = previousGlobals.HTMLAnchorElement;
    },
  };
}

function createBridge(overrides = {}) {
  const bridge = Object.create(Bridge.prototype);
  Object.assign(bridge, {
    allowActions: true,
    runtimeId: 'runtime-1',
    domainScopeMode: 'registrable_domain',
    allowedDomains: ['example.com'],
    navigationDelayMs: 0,
    actionGateContext: { localLogicalTabId: 1 },
    registerOpenedTab: undefined,
    listKnownTabs: undefined,
    switchToLogicalTab: undefined,
    onNavigationGuardrail: undefined,
    onBeforeAgentNavigation: undefined,
    onBeforeCrossHostNavigation: undefined,
    clientTools: new Map(),
  });
  return Object.assign(bridge, overrides);
}

test('click targets with target="_blank" prefer opening a new tab', (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  const anchor = new FakeAnchorElement('https://app.example.com/checkout', {
    'rtrvr-label': '[id=1] Link',
    target: '_blank',
  });
  env.doc.body.appendChild(anchor);

  const bridge = createBridge();
  const clickTarget = bridge.getClickTargetInfo({ element_id: 1 });

  assert.deepEqual(clickTarget, {
    targetUrl: 'https://app.example.com/checkout',
    preferredDisposition: 'new_tab',
  });
});

test('element-targeted actions refresh annotations before resolving targets', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  let flushCalls = 0;
  env.doc.defaultView.__RTRVR_INTERNAL_KEY__ = '__RTRVR_INTERNAL__';
  env.doc.defaultView.__RTRVR_INTERNAL__ = {
    flushScan: async () => {
      flushCalls += 1;
    },
  };
  const anchor = new FakeAnchorElement('https://app.example.com/checkout', {
    'rtrvr-label': '[id=1] Link',
  });
  env.doc.body.appendChild(anchor);

  const bridge = createBridge({
    root: env.doc.body,
    instrumentationStarted: true,
    openUrlInNewTab: async (targetUrl) => ({
      success: true,
      output: { url: targetUrl, navigationOutcome: 'new_tab_opened' },
    }),
  });

  const result = await bridge.executeTool({
    name: 'click_element',
    args: { element_id: 1, open_in_new_tab: true },
  });

  assert.equal(result.success, true);
  assert.equal(result.output.url, 'https://app.example.com/checkout');
  assert.equal(flushCalls, 1);
});

test('open_new_tab reuses an exact target tab instead of duplicating it', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  const switched = [];
  const bridge = createBridge({
    listKnownTabs: () => [
      { logicalTabId: 1, url: 'https://www.example.com/start' },
      { logicalTabId: 7, url: 'https://app.example.com/checkout' },
    ],
    switchToLogicalTab: async (logicalTabId) => {
      switched.push(logicalTabId);
      return { ok: true };
    },
  });

  const result = await bridge.executeTool({
    name: 'open_new_tab',
    args: { url: 'https://app.example.com/checkout' },
  });

  assert.equal(result.success, true);
  assert.equal(result.output.logicalTabId, 7);
  assert.equal(result.output.reusedExistingTab, true);
  assert.equal(result.output.reusedBy, 'exact_url');
  assert.equal(result.output.navigationOutcome, 'switch_tab');
  assert.deepEqual(switched, [7]);
});

test('open_new_tab reuses a same-host tab when the exact target tab is not already known', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  const switched = [];
  const bridge = createBridge({
    listKnownTabs: () => [
      { logicalTabId: 1, url: 'https://www.example.com/start' },
      { logicalTabId: 8, url: 'https://app.example.com/orders' },
    ],
    switchToLogicalTab: async (logicalTabId) => {
      switched.push(logicalTabId);
      return { ok: true };
    },
  });

  const result = await bridge.executeTool({
    name: 'open_new_tab',
    args: { url: 'https://app.example.com/checkout?step=shipping' },
  });

  assert.equal(result.success, true);
  assert.equal(result.output.logicalTabId, 8);
  assert.equal(result.output.reusedExistingTab, true);
  assert.equal(result.output.reusedBy, 'same_host');
  assert.deepEqual(switched, [8]);
});

test('goto_url preserves the source tab when preflight decides the target should stay separate', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  let openCall = null;
  let lastIntent = null;
  const bridge = createBridge({
    onBeforeAgentNavigation: (event) => {
      lastIntent = event;
      return {
        decision: resolveNavigationTabDisposition({
          currentUrl: window.location.href,
          targetUrl: event.targetUrl,
          allowedDomains: ['example.com'],
          domainScopeMode: 'registrable_domain',
          preferredDisposition: event.preferredDisposition,
          taskScopedTabIds: [1, 4],
          sourceLogicalTabId: event.sourceLogicalTabId,
        }),
        decisionReason: 'open_new_tab',
      };
    },
    openUrlInNewTab: async (targetUrl, options) => {
      openCall = { targetUrl, options };
      return {
        success: true,
        output: {
          url: targetUrl,
          navigationOutcome: 'new_tab_opened',
          decisionReason: options?.decisionReason,
        },
      };
    },
    scheduleSameTabNavigation: () => {
      throw new Error('same-tab handoff should not run for preserved source-tab navigation');
    },
  });

  const result = await bridge.executeTool({
    name: 'goto_url',
    args: { url: 'https://app.example.com/checkout' },
  });

  assert.equal(result.success, true);
  assert.equal(result.output.navigationOutcome, 'new_tab_opened');
  assert.equal(openCall?.targetUrl, 'https://app.example.com/checkout');
  assert.equal(openCall?.options?.decisionReason, 'open_new_tab');
  assert.equal(lastIntent?.sourceLogicalTabId, 1);
});

test('goto_url uses same-tab handoff when no preserve signal exists', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  let scheduleCall = null;
  const bridge = createBridge({
    onBeforeAgentNavigation: (event) => ({
      decision: resolveNavigationTabDisposition({
        currentUrl: window.location.href,
        targetUrl: event.targetUrl,
        allowedDomains: ['example.com'],
        domainScopeMode: 'registrable_domain',
        preferredDisposition: event.preferredDisposition,
        taskScopedTabIds: [1],
        sourceLogicalTabId: event.sourceLogicalTabId,
      }),
      decisionReason: 'allow_same_tab',
    }),
    openUrlInNewTab: async () => {
      throw new Error('new-tab path should not run when same-tab handoff is allowed');
    },
    scheduleSameTabNavigation: (targetUrl, intent, options) => {
      scheduleCall = { targetUrl, intent, options };
      return {
        success: true,
        output: {
          url: targetUrl,
          navigation: 'same_tab',
          navigationOutcome: 'subdomain_navigated',
          decisionReason: options?.decisionReason,
        },
      };
    },
  });

  const result = await bridge.executeTool({
    name: 'goto_url',
    args: { url: 'https://app.example.com/checkout' },
  });

  assert.equal(result.success, true);
  assert.equal(result.output.navigation, 'same_tab');
  assert.equal(result.output.navigationOutcome, 'subdomain_navigated');
  assert.equal(scheduleCall?.targetUrl, 'https://app.example.com/checkout');
  assert.equal(scheduleCall?.options?.decisionReason, 'allow_same_tab');
});

test('popup-blocked external tab opens return actionable fallback messaging', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());
  const bridge = createBridge({
    listKnownTabs: () => [{ logicalTabId: 1, url: 'https://www.example.com/start' }],
    openVerifiedPopup: () => ({ opened: false, verified: false }),
    reconcileOpenedTab: async () => undefined,
  });

  const result = await bridge.openUrlInNewTab('https://docs.other-site.com/help', {
    policyBlocked: true,
    reason: 'Opened in a new tab to preserve Rover runtime continuity.',
    decisionReason: 'open_new_tab',
  });

  assert.equal(result.success, false);
  assert.equal(result.error, 'open_new_tab blocked by browser popup settings');
  assert.equal(result.output.navigationOutcome, 'blocked');
  assert.equal(result.output.decisionReason, 'open_new_tab');
  assert.match(result.errorDetails.next_action, /Allow popups/i);
});
