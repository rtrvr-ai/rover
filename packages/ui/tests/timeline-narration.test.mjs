import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionSpotlightSystem } from '../dist/components/action-spotlight.js';
import {
  createTimelineNarrationScheduler,
  resolveTimelineNarrationText,
} from '../dist/timeline-narration.js';

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

function installFrameDom() {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLDivElement: globalThis.HTMLDivElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
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
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    visualViewport: {
      width: 1024,
      height: 768,
      addEventListener() {},
      removeEventListener() {},
    },
    addEventListener() {},
    removeEventListener() {},
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
    get queuedFrames() {
      return rafCallbacks.size;
    },
    runNextFrame() {
      const next = rafCallbacks.entries().next().value;
      if (!next) return false;
      const [id, callback] = next;
      rafCallbacks.delete(id);
      callback(Date.now());
      return true;
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

function createFrameQueue() {
  const frames = new Map();
  let nextId = 1;
  return {
    schedule(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancel(id) {
      frames.delete(id);
    },
    runAll() {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(Date.now());
      }
    },
    get size() {
      return frames.size;
    },
  };
}

test('timeline narration text uses explicit narration and no-target action fallback', () => {
  assert.equal(resolveTimelineNarrationText({
    kind: 'tool_start',
    title: 'Running click',
    narration: 'Opening checkout so you can review it.',
  }), 'Opening checkout so you can review it.');

  assert.equal(resolveTimelineNarrationText({
    kind: 'tool_start',
    title: 'Running scroll_page',
    narrationActive: true,
    actionCue: { kind: 'scroll' },
  }), 'Scrolling page');

  assert.equal(resolveTimelineNarrationText({
    kind: 'tool_result',
    title: 'Done',
    narration: 'Should not speak.',
  }), '');

  assert.equal(resolveTimelineNarrationText({
    kind: 'assistant_response',
    title: 'Final response',
    responseKind: 'final',
    narration: 'I finished and posted the result.',
  }), 'I finished and posted the result.');

  assert.equal(resolveTimelineNarrationText({
    kind: 'assistant_response',
    title: 'Needs input',
    responseKind: 'question',
    detail: 'I need a bit more info:\n- What best describes your use case?',
    narrationActive: true,
  }), 'I need a bit more info: - What best describes your use case?');

  assert.equal(resolveTimelineNarrationText({
    kind: 'tool_start',
    title: 'Broken narration',
    get narration() {
      throw new Error('narration getter failed');
    },
  }), '');
});

test('timeline narration scheduler defers speech and queues rapid action steps', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: (text, options) => spoken.push({ text, options }),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({ kind: 'tool_start', title: 'A', narration: 'Opening checkout.', actionCue: { kind: 'click', targetLabel: 'Checkout' } });
  assert.equal(spoken.length, 0);
  assert.equal(frameQueue.size, 1);

  scheduler.scheduleEvent({ kind: 'tool_start', title: 'B', narration: 'Clicking checkout.' });
  assert.equal(frameQueue.size, 1);
  frameQueue.runAll();
  assert.deepEqual(spoken.map(item => item.text), ['Opening checkout.', 'Clicking checkout.']);
  assert.deepEqual(spoken.map(item => item.options.mode), ['append', 'append']);
});

test('timeline narration scheduler collapses duplicate same-target action cues', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: (text, options) => spoken.push({ text, options }),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'Typing name',
    narration: 'Typing the first name.',
    actionCue: { kind: 'type', targetLabel: 'Name' },
  });
  scheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'Typing name again',
    narration: 'Typing the name.',
    actionCue: { kind: 'type', targetLabel: 'Name' },
  });
  frameQueue.runAll();
  assert.deepEqual(spoken.map(item => item.text), ['Typing the name.']);
});

test('timeline narration scheduler caps burst backlog with a catch-up cue', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: (text, options) => spoken.push({ text, options }),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  for (let i = 0; i < 6; i += 1) {
    scheduler.scheduleEvent({
      kind: 'tool_start',
      title: `Hover ${i}`,
      narration: `Checking optional field ${i}.`,
      actionCue: { kind: 'hover', targetLabel: `Optional ${i}` },
    });
  }
  frameQueue.runAll();
  assert.equal(spoken.length, 4);
  assert.equal(spoken[0].text, 'Continuing through the form.');
  assert.deepEqual(spoken.slice(1).map(item => item.text), [
    'Checking optional field 3.',
    'Checking optional field 4.',
    'Checking optional field 5.',
  ]);
});

test('timeline narration scheduler queues assistant responses without speaking tool results', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: (text, options) => spoken.push({ text, options }),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'A',
    narration: 'Opening checkout.',
    actionCue: { kind: 'click', targetLabel: 'Checkout' },
  });
  scheduler.scheduleEvent({ kind: 'tool_result', title: 'A completed', narration: 'Raw tool result should stay silent.' });
  scheduler.scheduleEvent({
    kind: 'assistant_response',
    title: 'Final response',
    responseKind: 'final',
    narration: 'I finished and posted the result.',
  });

  frameQueue.runAll();
  assert.deepEqual(spoken.map(item => item.text), [
    'Opening checkout.',
    'I finished and posted the result.',
  ]);
  assert.deepEqual(spoken.map(item => item.options.mode), ['append', 'append']);
  assert.equal(spoken[1].options.priority, 'high');
});

test('final response narration prunes stale low-priority backlog', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: (text, options) => spoken.push({ text, options }),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  for (let i = 0; i < 4; i += 1) {
    scheduler.scheduleEvent({
      kind: 'tool_start',
      title: `Hover ${i}`,
      narration: `Checking optional field ${i}.`,
      actionCue: { kind: 'hover', targetLabel: `Optional ${i}` },
    });
  }
  scheduler.scheduleEvent({
    kind: 'assistant_response',
    title: 'Final response',
    responseKind: 'final',
    narration: 'The answer is ready.',
  });

  frameQueue.runAll();
  assert.deepEqual(spoken.map(item => item.text), ['The answer is ready.']);
});

test('timeline narration cancel prevents pending speech', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: text => spoken.push(text),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({ kind: 'tool_start', title: 'A', narration: 'Opening checkout.' });
  scheduler.cancel();
  assert.equal(frameQueue.size, 0);
  frameQueue.runAll();
  assert.deepEqual(spoken, []);
});

test('timeline narration scheduler falls back when frame scheduling fails', async () => {
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: text => spoken.push(text),
    scheduleFrame: () => {
      throw new Error('raf failed');
    },
    cancelFrame: () => undefined,
  });

  assert.doesNotThrow(() => scheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'A',
    narration: 'Opening checkout.',
  }));
  assert.deepEqual(spoken, []);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(spoken, ['Opening checkout.']);
});

test('timeline narration scheduler swallows enablement and speech failures', () => {
  const frameQueue = createFrameQueue();
  const disabledScheduler = createTimelineNarrationScheduler({
    isEnabled: () => {
      throw new Error('preference failed');
    },
    speak: () => {
      throw new Error('should not speak');
    },
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  assert.doesNotThrow(() => disabledScheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'A',
    narration: 'Opening checkout.',
  }));
  assert.equal(frameQueue.size, 0);

  const speakingScheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: () => {
      throw new Error('speech failed');
    },
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });
  speakingScheduler.scheduleEvent({ kind: 'tool_start', title: 'B', narration: 'Clicking checkout.' });
  assert.doesNotThrow(() => frameQueue.runAll());
});

test('action spotlight frame runs before scheduled narration when registered first', (t) => {
  const env = installFrameDom();
  t.after(() => env.restore());
  const target = new FakeElement('BUTTON', { left: 100, top: 120, right: 180, bottom: 160, width: 80, height: 40 });
  target.ownerDocument = env.document;
  target.textContent = 'Checkout';
  const container = new FakeElement('DIV');
  const panel = new FakeElement('DIV', { left: 800, top: 100, right: 1000, bottom: 700, width: 200, height: 600 });
  container.ownerDocument = env.document;
  panel.ownerDocument = env.document;
  const system = createActionSpotlightSystem({
    container,
    panel,
    resolveElement: () => target,
    getLocalLogicalTabId: () => 1,
  });
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: text => spoken.push(text),
  });
  const event = {
    kind: 'tool_start',
    title: 'Running click_element',
    narration: 'Clicking checkout.',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  };

  system.addEvent(event);
  scheduler.scheduleEvent(event);
  assert.equal(spoken.length, 0);
  assert.equal(env.queuedFrames, 2);

  assert.equal(env.runNextFrame(), true);
  const ring = system.overlay.children.find(child => child.className === 'actionSpotlightRing');
  assert.equal(ring.style.display, 'block');
  assert.deepEqual(spoken, []);

  assert.equal(env.runNextFrame(), true);
  assert.deepEqual(spoken, ['Clicking checkout.']);
  system.destroy();
});

test('action spotlight target failures do not prevent scheduled narration', (t) => {
  const env = installFrameDom();
  t.after(() => env.restore());
  const target = new FakeElement('BUTTON');
  target.ownerDocument = env.document;
  target.getBoundingClientRect = () => {
    throw new Error('geometry failed');
  };
  const container = new FakeElement('DIV');
  const panel = new FakeElement('DIV', { left: 800, top: 100, right: 1000, bottom: 700, width: 200, height: 600 });
  container.ownerDocument = env.document;
  panel.ownerDocument = env.document;
  const system = createActionSpotlightSystem({
    container,
    panel,
    resolveElement: () => target,
    getLocalLogicalTabId: () => 1,
  });
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: text => spoken.push(text),
  });
  const event = {
    kind: 'tool_start',
    title: 'Running click_element',
    narration: 'Clicking checkout.',
    actionCue: { kind: 'click', primaryElementId: 3, elementIds: [3], logicalTabId: 1 },
  };

  assert.doesNotThrow(() => system.addEvent(event));
  scheduler.scheduleEvent(event);
  assert.doesNotThrow(() => env.runNextFrame());
  assert.equal(env.runNextFrame(), true);
  assert.deepEqual(spoken, ['Clicking checkout.']);
  system.destroy();
});

// ── Precedence: visitor explicit > planner per-step > site default ────────────
//
// The scheduler accepts an optional `shouldSpeakEvent(event)` predicate that takes
// precedence over the global `isEnabled()` gate at scheduleEvent time. mount.ts
// implements three-tier precedence (visitor explicit OFF blocks; visitor default
// lets explicit per-step narration text override site default 'off'). These tests
// exercise the scheduler-side mechanics that make that possible.

test('shouldSpeakEvent overrides isEnabled at scheduleEvent (planner narration on site-off)', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  // Simulate: visitor=default, site narration mode='off' (isEnabled false), planner emits text.
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true, // permissive: visitor not explicit OFF, so flush is allowed
    shouldSpeakEvent: (event) => {
      // Mirror mount.ts logic: site default false, but explicit text → speak.
      const explicitText = typeof event.narration === 'string' && event.narration.trim().length > 0;
      return explicitText; // site default off; only explicit per-step wins
    },
    speak: (text) => spoken.push(text),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  // Event with explicit narration text (planner per-step override) — should speak.
  scheduler.scheduleEvent({ kind: 'tool_start', title: 'Submit', narration: 'Submitting now.' });
  // Event without explicit text and site default off — should be skipped.
  scheduler.scheduleEvent({ kind: 'tool_start', title: 'Scroll', narrationActive: true, actionCue: { kind: 'scroll' } });
  frameQueue.runAll();

  assert.deepEqual(spoken, ['Submitting now.']);
});

test('explicit ACT action narration speaks when fallback narration is quiet', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    // Permissive local gate: visitor has not explicitly turned narration off.
    isEnabled: () => true,
    shouldSpeakEvent: (event) => {
      // Simulates ACT on a task/default-off run: explicit args.ui.narration wins,
      // but deterministic fallback narration stays quiet.
      const explicitText = typeof event.narration === 'string' && event.narration.trim().length > 0;
      return explicitText;
    },
    speak: (text) => spoken.push(text),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'Running click_element',
    toolName: 'click_element',
    narration: 'Opening pricing.',
    narrationActive: false,
    actionCue: { kind: 'click', targetLabel: 'Pricing' },
  });
  scheduler.scheduleEvent({
    kind: 'tool_start',
    title: 'Running type_into_element',
    toolName: 'type_into_element',
    narrationActive: false,
    actionCue: { kind: 'type', targetLabel: 'Email' },
  });

  frameQueue.runAll();
  assert.deepEqual(spoken, ['Opening pricing.']);
});

test('shouldSpeakEvent returning false bails even when isEnabled is true', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  // Simulate: visitor=explicit OFF — hard block regardless of event content.
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => false, // visitor explicit OFF means flush would also bail
    shouldSpeakEvent: () => false, // visitor explicit OFF — never speak
    speak: (text) => spoken.push(text),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({ kind: 'tool_start', title: 'Submit', narration: 'Submitting now.' });
  frameQueue.runAll();
  assert.deepEqual(spoken, []);
});

test('flush still respects isEnabled when visitor flips OFF mid-batch', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  // Permissive at scheduleEvent (event passes), but visitor flips to explicit OFF
  // before flush runs; isEnabled goes false and the queue is dropped.
  let visitorExplicitOff = false;
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => !visitorExplicitOff,
    shouldSpeakEvent: () => true, // accept events
    speak: (text) => spoken.push(text),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({ kind: 'tool_start', title: 'A', narration: 'A' });
  scheduler.scheduleEvent({ kind: 'tool_start', title: 'B', narration: 'B' });
  // Visitor explicit OFF after queueing
  visitorExplicitOff = true;
  frameQueue.runAll();
  assert.deepEqual(spoken, []);
});

test('without shouldSpeakEvent, scheduler falls back to isEnabled (back-compat)', () => {
  const frameQueue = createFrameQueue();
  const spoken = [];
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: (text) => spoken.push(text),
    scheduleFrame: callback => frameQueue.schedule(callback),
    cancelFrame: id => frameQueue.cancel(id),
  });

  scheduler.scheduleEvent({ kind: 'tool_start', title: 'A', narration: 'A' });
  frameQueue.runAll();
  assert.deepEqual(spoken, ['A']);
});
