import assert from 'node:assert/strict';
import test from 'node:test';

import { assessHtmlTreeStabilization } from '../dist/page-data.js';

function makeDoc({
  readyState = 'complete',
  text = '',
  busy = false,
} = {}) {
  return {
    readyState,
    body: {
      innerText: text,
      textContent: text,
      hasAttribute: () => false,
      getAttribute: (name) => (busy && name === 'aria-busy' ? 'true' : null),
    },
    documentElement: {
      innerText: text,
      textContent: text,
      hasAttribute: () => false,
    },
  };
}

test('small complete page proceeds immediately without stabilization wait', () => {
  const doc = makeDoc({ text: 'Example Domain More information...' });
  const result = assessHtmlTreeStabilization(doc, [1], {
    1: { elementName: 'H1', textContent: 'Example Domain' },
    2: { elementName: 'P', textContent: 'This domain is for use in illustrative examples.' },
    3: { elementName: 'A', textContent: 'More information...' },
  });

  assert.equal(result.proceedImmediately, true);
  assert.equal(result.needsStabilization, false);
  assert.deepEqual(result.reasons, []);
});

test('minimal small page with one meaningful node still proceeds immediately', () => {
  const doc = makeDoc({ text: 'More information...' });
  const result = assessHtmlTreeStabilization(doc, [1], {
    1: { elementName: 'A', textContent: 'More information...' },
  });

  assert.equal(result.proceedImmediately, true);
  assert.equal(result.needsStabilization, false);
  assert.deepEqual(result.reasons, []);
});

test('read-only static page with text structure proceeds immediately', () => {
  const doc = makeDoc({ text: 'Status\nAll systems operational\nRead the incident report.' });
  const result = assessHtmlTreeStabilization(doc, [1], {
    1: { elementName: 'H1', textContent: 'Status' },
    2: { elementName: 'P', textContent: 'All systems operational' },
    3: { elementName: 'A', textContent: 'Read the incident report.' },
  });

  assert.equal(result.proceedImmediately, true);
  assert.equal(result.needsStabilization, false);
  assert.deepEqual(result.reasons, []);
});

test('empty tree requests stabilization for one retry pass', () => {
  const doc = makeDoc({ text: 'Loading page...' });
  const result = assessHtmlTreeStabilization(doc, [], {});

  assert.equal(result.proceedImmediately, false);
  assert.equal(result.needsStabilization, true);
  assert.deepEqual(result.reasons, ['empty_tree']);
});

test('generic shell with visible text mismatch requests stabilization', () => {
  const doc = makeDoc({
    text: 'Welcome to our pricing page with enough text to prove the DOM is richer than the captured semantic tree.',
  });
  const result = assessHtmlTreeStabilization(doc, [1], {
    1: { elementName: 'BODY' },
    2: { elementName: 'DIV' },
    3: { elementName: 'IMG' },
    4: { elementName: 'DIV' },
  });

  assert.equal(result.proceedImmediately, false);
  assert.equal(result.needsStabilization, true);
  assert.deepEqual(result.reasons, ['generic_shell', 'text_semantic_mismatch']);
});

test('busy or incomplete sparse page requests stabilization', () => {
  const doc = makeDoc({
    readyState: 'interactive',
    text: 'Checkout',
    busy: true,
  });
  const result = assessHtmlTreeStabilization(doc, [1], {
    1: { elementName: 'DIV', textContent: 'Checkout' },
    2: { elementName: 'DIV' },
    3: { elementName: 'IMG' },
  });

  assert.equal(result.proceedImmediately, false);
  assert.equal(result.needsStabilization, true);
  assert.deepEqual(result.reasons, ['dom_not_ready']);
});
