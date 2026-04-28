import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRoverActionElement } from '../dist/actionTarget.js';

function fakeElement(tagName, attrs = {}) {
  return {
    nodeType: 1,
    tagName,
    ownerDocument: null,
    lastElementChild: null,
    previousElementSibling: null,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
  };
}

test('resolves current Rover annotations, not only historical data-rveid attributes', () => {
  const root = fakeElement('DIV');
  const target = fakeElement('BUTTON', { 'rtrvr-label': '[id=42] Checkout' });
  root.lastElementChild = target;

  const doc = {
    nodeType: 9,
    documentElement: root,
    body: root,
    querySelector() {
      throw new Error('data-rveid fallback should not be needed');
    },
  };
  root.ownerDocument = doc;
  target.ownerDocument = doc;

  assert.equal(resolveRoverActionElement(42, doc), target);
});

test('keeps data-rveid fallback for older stamped pages', () => {
  const fallback = fakeElement('BUTTON', { 'data-rveid': '7' });
  const doc = {
    nodeType: 9,
    documentElement: fakeElement('DIV'),
    body: fakeElement('DIV'),
    querySelector(selector) {
      return selector === '[data-rveid="7"]' ? fallback : null;
    },
  };

  assert.equal(resolveRoverActionElement(7, doc), fallback);
});
