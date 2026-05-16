import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFeedbackQueueModel,
  describeFeedbackStatus,
  generateFeedbackId,
} from './feedback-queue.js';

test('generateFeedbackId: returns a non-empty string with the fb- prefix', () => {
  const a = generateFeedbackId();
  const b = generateFeedbackId();
  assert.ok(a.startsWith('fb-'), `expected fb- prefix, got: ${a}`);
  assert.ok(b.startsWith('fb-'), `expected fb- prefix, got: ${b}`);
  assert.notEqual(a, b, 'two ids should not collide');
});

test('generateFeedbackId: monotonic-ish for monotonic timestamps (lex-sortable)', () => {
  const a = generateFeedbackId(1700000000000);
  const b = generateFeedbackId(1700000001000);
  // Stripped of the random suffix, the timestamp portion of b > a.
  const tsA = a.split('-')[1];
  const tsB = b.split('-')[1];
  assert.ok(tsB >= tsA, `expected later ts (b=${tsB}) >= earlier ts (a=${tsA})`);
});

test('enqueue: creates a queued card with the supplied text + source', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: 'use search', source: 'text' });
  assert.equal(card.text, 'use search');
  assert.equal(card.source, 'text');
  assert.equal(card.status, 'queued');
  assert.ok(card.id);
  assert.equal(model.list().length, 1);
  assert.equal(model.get(card.id)?.id, card.id);
});

test('enqueue: trims whitespace from the text', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: '   click button   ', source: 'text' });
  assert.equal(card.text, 'click button');
});

test('enqueue: respects an explicit id; deduplicates on re-enqueue', () => {
  const model = createFeedbackQueueModel();
  const a = model.enqueue({ id: 'fixed-id', text: 'first', source: 'text' });
  const b = model.enqueue({ id: 'fixed-id', text: 'second', source: 'voice' });
  assert.equal(a.id, 'fixed-id');
  assert.equal(b.id, 'fixed-id');
  assert.equal(b.text, 'first', 'duplicate enqueue should keep original');
  assert.equal(model.list().length, 1);
});

test('enqueue: normalizes unknown source values to "text"', () => {
  const model = createFeedbackQueueModel();
  // Caller passes a bad source (e.g., from untrusted SDK consumer); helper must coerce safely.
  const card = model.enqueue({ text: 'x', source: 'gibberish' as never });
  assert.equal(card.source, 'text');
});

test('markApplied: transitions a queued card to applied with step index', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: 'guide', source: 'text' });
  const next = model.markApplied(card.id, 3);
  assert.equal(next?.status, 'applied');
  assert.equal(next?.appliedAtStepIndex, 3);
  assert.equal(model.get(card.id)?.status, 'applied');
});

test('markApplied: clamps negative step index to 0', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: 'guide', source: 'text' });
  const next = model.markApplied(card.id, -5);
  assert.equal(next?.appliedAtStepIndex, 0);
});

test('markApplied: no-op for unknown id', () => {
  const model = createFeedbackQueueModel();
  const result = model.markApplied('does-not-exist', 1);
  assert.equal(result, undefined);
});

test('markApplied: no-op after a card is already dropped (terminal state is sticky)', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: 'g', source: 'text' });
  model.markDropped(card.id, 'run_ended');
  const result = model.markApplied(card.id, 7);
  assert.equal(result?.status, 'dropped');
  assert.equal(model.get(card.id)?.status, 'dropped');
});

test('markDropped: transitions queued -> dropped with reason', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: 'g', source: 'text' });
  const next = model.markDropped(card.id, 'run_canceled');
  assert.equal(next?.status, 'dropped');
  assert.equal(next?.dropReason, 'run_canceled');
});

test('markDropped: no-op after a card is already applied (terminal state is sticky)', () => {
  const model = createFeedbackQueueModel();
  const card = model.enqueue({ text: 'g', source: 'text' });
  model.markApplied(card.id, 2);
  model.markDropped(card.id, 'run_ended');
  assert.equal(model.get(card.id)?.status, 'applied');
});

test('dropAllQueued: flips only queued cards; leaves terminals alone', () => {
  const model = createFeedbackQueueModel();
  const a = model.enqueue({ text: 'a', source: 'text' });
  const b = model.enqueue({ text: 'b', source: 'text' });
  const c = model.enqueue({ text: 'c', source: 'voice' });
  model.markApplied(a.id, 1);
  const flipped = model.dropAllQueued('run_ended');
  assert.equal(flipped.length, 2);
  assert.ok(flipped.every(card => card.status === 'dropped' && card.dropReason === 'run_ended'));
  assert.equal(model.get(a.id)?.status, 'applied');
  assert.equal(model.get(b.id)?.status, 'dropped');
  assert.equal(model.get(c.id)?.status, 'dropped');
});

test('list: preserves submission order', () => {
  const model = createFeedbackQueueModel();
  const a = model.enqueue({ text: 'first', source: 'text' });
  const b = model.enqueue({ text: 'second', source: 'voice' });
  const c = model.enqueue({ text: 'third', source: 'text' });
  assert.deepEqual(model.list().map(card => card.id), [a.id, b.id, c.id]);
});

test('reset: clears all state', () => {
  const model = createFeedbackQueueModel();
  model.enqueue({ text: 'a', source: 'text' });
  model.enqueue({ text: 'b', source: 'voice' });
  model.reset();
  assert.equal(model.list().length, 0);
});

test('describeFeedbackStatus: human-readable strings for every status', () => {
  const queuedCard = { id: '1', text: 't', source: 'text' as const, status: 'queued' as const, submittedAt: 0 };
  assert.match(describeFeedbackStatus(queuedCard), /Queued/);

  const appliedCard = { ...queuedCard, status: 'applied' as const, appliedAtStepIndex: 4 };
  assert.match(describeFeedbackStatus(appliedCard), /Applied at step 5/);

  const droppedRun = { ...queuedCard, status: 'dropped' as const, dropReason: 'run_ended' as const };
  assert.match(describeFeedbackStatus(droppedRun), /run ended/);

  const droppedFull = { ...queuedCard, status: 'dropped' as const, dropReason: 'queue_full' as const };
  assert.match(describeFeedbackStatus(droppedFull), /too many/);
});
