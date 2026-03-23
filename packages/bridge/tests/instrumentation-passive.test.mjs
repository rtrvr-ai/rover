import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('instrumentation stays passive until explicitly started', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  const originalEventTarget = globalThis.EventTarget;
  const originalMutationObserver = globalThis.MutationObserver;

  const attributeWrites = [];
  const docListeners = new Map();
  const documentElement = {
    nodeType: 1,
    children: [],
    lastElementChild: null,
    setAttribute(name, value) {
      attributeWrites.push([name, value]);
    },
    removeAttribute() {},
    hasAttribute() {
      return false;
    },
    getAttribute() {
      return null;
    },
    getAttributeNames() {
      return [];
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  class FakeEventTarget {}
  class FakeElement extends FakeEventTarget {}
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }

  const fakeWindow = {
    document: null,
    EventTarget: FakeEventTarget,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
  };

  const fakeDocument = {
    readyState: 'loading',
    hidden: false,
    body: {
      nodeType: 1,
      children: [],
      lastElementChild: null,
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getAttributeNames() {
        return [];
      },
      hasAttribute() {
        return false;
      },
    },
    documentElement,
    defaultView: fakeWindow,
    addEventListener(type, handler) {
      docListeners.set(type, handler);
    },
    removeEventListener(type) {
      docListeners.delete(type);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  fakeWindow.document = fakeDocument;
  documentElement.ownerDocument = fakeDocument;
  fakeDocument.body.ownerDocument = fakeDocument;

  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.Element = FakeElement;
  globalThis.EventTarget = FakeEventTarget;
  globalThis.MutationObserver = FakeMutationObserver;

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('/Users/bhavanikalisetty/work/act_2/rover/packages/instrumentation/dist/index.js')).href}?test=${Date.now()}`;
    const { installInstrumentation, startInstrumentation } = await import(moduleUrl);

    assert.equal(typeof globalThis.window.rtrvrAIMarkInteractiveElements, 'undefined');
    installInstrumentation();
    assert.equal(typeof globalThis.window.rtrvrAIMarkInteractiveElements, 'undefined');
    assert.deepEqual(attributeWrites, []);

    startInstrumentation();
    assert.equal(typeof globalThis.window.rtrvrAIMarkInteractiveElements, 'function');
    assert.equal(typeof globalThis.window.rtrvrAISetObserverPaused, 'function');
    assert.equal(typeof globalThis.window.rtrvrAIClearObserverPause, 'function');
    assert.ok(docListeners.has('DOMContentLoaded'));
    assert.deepEqual(attributeWrites, []);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.Element = originalElement;
    globalThis.EventTarget = originalEventTarget;
    globalThis.MutationObserver = originalMutationObserver;
  }
});
