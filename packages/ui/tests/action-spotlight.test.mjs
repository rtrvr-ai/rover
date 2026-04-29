import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActionSpotlightSystem,
  deriveElementLabel,
  isActionCueForLocalTab,
} from '../dist/components/action-spotlight.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(value) {
    this.values.add(value);
  }
  remove(value) {
    this.values.delete(value);
  }
  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName = 'DIV', rect = { left: 0, top: 0, right: 90, bottom: 28, width: 90, height: 28 }) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = null;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.classList = new FakeClassList();
    this.textContent = '';
    this.rect = rect;
  }
  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  remove() {
    this.removed = true;
  }
  getAttribute(name) {
    return this.attributes?.[name] ?? null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

function installFakeDom() {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLDivElement: globalThis.HTMLDivElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const docListeners = new Map();
  const winListeners = new Map();
  const visualViewportListeners = new Map();
  const rafCallbacks = new Map();
  let nextRafId = 1;
  const document = {
    hidden: false,
    createElement(tagName) {
      const el = new FakeElement(tagName);
      el.ownerDocument = document;
      return el;
    },
    querySelector() {
      return null;
    },
    addEventListener(type, handler) {
      docListeners.set(type, handler);
    },
    removeEventListener(type) {
      docListeners.delete(type);
    },
  };
  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    visualViewport: {
      width: 1024,
      height: 768,
      addEventListener(type, handler) {
        visualViewportListeners.set(type, handler);
      },
      removeEventListener(type) {
        visualViewportListeners.delete(type);
      },
    },
    addEventListener(type, handler) {
      winListeners.set(type, handler);
    },
    removeEventListener(type) {
      winListeners.delete(type);
    },
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLDivElement = FakeElement;
  globalThis.HTMLInputElement = class {};
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextRafId++;
    rafCallbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
  };

  return {
    document,
    rafCallbacks,
    runNextFrame() {
      const next = rafCallbacks.entries().next().value;
      if (!next) return false;
      const [id, callback] = next;
      rafCallbacks.delete(id);
      callback(Date.now());
      return true;
    },
    dispatchDocument(type) {
      docListeners.get(type)?.();
    },
    restore() {
      globalThis.window = original.window;
      globalThis.document = original.document;
      globalThis.HTMLElement = original.HTMLElement;
      globalThis.HTMLDivElement = original.HTMLDivElement;
      globalThis.HTMLInputElement = original.HTMLInputElement;
      globalThis.requestAnimationFrame = original.requestAnimationFrame;
      globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
    },
  };
}

function createSystem(env, options = {}) {
  const container = new FakeElement('DIV');
  const panel = new FakeElement('DIV', { left: 800, top: 100, right: 1000, bottom: 700, width: 200, height: 600 });
  container.ownerDocument = env.document;
  panel.ownerDocument = env.document;
  return createActionSpotlightSystem({
    container,
    panel,
    ...options,
  });
}

test('action spotlight renders a ring for a visible local target', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  const target = new FakeElement('BUTTON', { left: 100, top: 120, right: 180, bottom: 160, width: 80, height: 40 });
  target.ownerDocument = env.document;
  target.textContent = 'Checkout';
  const system = createSystem(env, {
    resolveElement: () => target,
    getLocalLogicalTabId: () => 1,
  });

  system.addEvent({
    kind: 'tool_start',
    title: 'Running click_element',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  });
  assert.equal(env.runNextFrame(), true);

  const ring = system.overlay.children.find(child => child.className === 'actionSpotlightRing');
  assert.equal(ring.style.display, 'block');
  assert.equal(ring.style.width, '92px');
  assert.match(ring.style.transform, /translate3d\(94px, 114px, 0\)/);
});

test('action spotlight does not render when the cue has no target ids', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  const system = createSystem(env, {
    resolveElement: () => new FakeElement('BUTTON'),
    getLocalLogicalTabId: () => 1,
  });

  system.addEvent({
    kind: 'tool_start',
    title: 'Running goto_url',
    actionCue: { kind: 'navigate', logicalTabId: 1 },
  });

  assert.equal(system.overlay.children.length, 0);
  assert.equal(env.rafCallbacks.size, 0);
});

test('action spotlight renders copy paste and upload chip verbs', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());

  for (const [kind, expected] of [
    ['copy', 'Copy Coupon'],
    ['paste', 'Paste Email'],
    ['upload', 'Upload Resume'],
  ]) {
    const target = new FakeElement('BUTTON', { left: 100, top: 120, right: 180, bottom: 160, width: 80, height: 40 });
    target.ownerDocument = env.document;
    target.textContent = expected.split(' ')[1];
    const system = createSystem(env, {
      resolveElement: () => target,
      getLocalLogicalTabId: () => 1,
    });

    system.addEvent({
      kind: 'tool_start',
      title: `Running ${kind}`,
      actionCue: { kind, primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
    });
    assert.equal(env.runNextFrame(), true);
    const chip = system.overlay.children.find(child => child.className === 'actionSpotlightChip');
    assert.equal(chip.textContent, expected);
    system.destroy();
  }
});

test('action spotlight swallows label and local-tab resolver errors', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  const throwingLabelTarget = new FakeElement('BUTTON', { left: 100, top: 120, right: 180, bottom: 160, width: 80, height: 40 });
  throwingLabelTarget.ownerDocument = env.document;
  throwingLabelTarget.getAttribute = () => {
    throw new Error('label failed');
  };
  assert.equal(deriveElementLabel(throwingLabelTarget), '');

  const system = createSystem(env, {
    resolveElement: () => throwingLabelTarget,
    getLocalLogicalTabId: () => {
      throw new Error('tab lookup failed');
    },
  });

  assert.doesNotThrow(() => system.addEvent({
    kind: 'tool_start',
    title: 'Running click_element',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  }));
  assert.equal(system.overlay.children.length, 0);
});

test('action spotlight isolates bad target geometry and still renders valid targets', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  const badTarget = new FakeElement('BUTTON');
  badTarget.ownerDocument = env.document;
  badTarget.getBoundingClientRect = () => {
    throw new Error('rect failed');
  };
  const goodTarget = new FakeElement('BUTTON', { left: 220, top: 140, right: 300, bottom: 180, width: 80, height: 40 });
  goodTarget.ownerDocument = env.document;
  goodTarget.textContent = 'Continue';
  const system = createSystem(env, {
    resolveElement: (id) => (id === 1 ? badTarget : goodTarget),
    getLocalLogicalTabId: () => 1,
  });

  system.addEvent({
    kind: 'tool_start',
    title: 'Running drag_and_drop',
    actionCue: { kind: 'drag', primaryElementId: 1, elementIds: [1, 2], logicalTabId: 1 },
  });

  assert.doesNotThrow(() => env.runNextFrame());
  const visibleRing = system.overlay.children.find(child => child.className === 'actionSpotlightRing' && child.style.display === 'block');
  assert.equal(visibleRing?.style.width, '92px');
  assert.match(visibleRing?.style.transform || '', /translate3d\(214px, 134px, 0\)/);
});

test('action spotlight clear and fade methods swallow DOM removal errors', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  const target = new FakeElement('BUTTON', { left: 100, top: 120, right: 180, bottom: 160, width: 80, height: 40 });
  target.ownerDocument = env.document;
  const system = createSystem(env, {
    resolveElement: () => target,
    getLocalLogicalTabId: () => 1,
  });

  system.addEvent({
    kind: 'tool_start',
    title: 'Running click_element',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  });
  env.runNextFrame();
  for (const child of system.overlay.children) {
    child.remove = () => {
      throw new Error('remove failed');
    };
  }

  assert.doesNotThrow(() => system.fadeEvent({
    kind: 'tool_result',
    title: 'Done',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  }));
  assert.doesNotThrow(() => system.clearAll());
  assert.doesNotThrow(() => system.destroy());
});

test('action spotlight suppresses other-tab targets', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  const system = createSystem(env, {
    resolveElement: () => new FakeElement('BUTTON'),
    getLocalLogicalTabId: () => 1,
  });

  assert.equal(isActionCueForLocalTab({ kind: 'tool_start', title: 'x', actionCue: { kind: 'click', logicalTabId: 2 } }, 1), false);
  system.addEvent({
    kind: 'tool_start',
    title: 'Running click_element',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 2 },
  });

  assert.equal(system.overlay.children.length, 0);
  assert.equal(env.rafCallbacks.size, 0);
});

test('action spotlight pauses while hidden and resumes on visibilitychange', (t) => {
  const env = installFakeDom();
  t.after(() => env.restore());
  env.document.hidden = true;
  const target = new FakeElement('BUTTON', { left: 12, top: 20, right: 72, bottom: 52, width: 60, height: 32 });
  target.ownerDocument = env.document;
  const system = createSystem(env, {
    resolveElement: () => target,
    getLocalLogicalTabId: () => 1,
  });

  system.addEvent({
    kind: 'tool_start',
    title: 'Running click_element',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  });
  assert.equal(env.rafCallbacks.size, 0);

  env.document.hidden = false;
  env.dispatchDocument('visibilitychange');
  assert.equal(env.runNextFrame(), true);
  const ring = system.overlay.children.find(child => child.className === 'actionSpotlightRing');
  assert.equal(ring.style.display, 'block');
});
