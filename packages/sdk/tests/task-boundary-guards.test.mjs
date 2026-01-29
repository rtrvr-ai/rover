import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAcceptWorkerSnapshot } from '../dist/taskBoundaryGuards.js';

test('accepts matching incoming boundary', () => {
  const decision = shouldAcceptWorkerSnapshot({
    source: 'worker_snapshot',
    incomingBoundaryId: 'boundary-1',
    currentBoundaryId: 'boundary-1',
  });
  assert.equal(decision.accept, true);
  assert.equal(decision.reason, 'match');
});

test('rejects missing incoming boundary when local boundary exists', () => {
  const decision = shouldAcceptWorkerSnapshot({
    source: 'shared_worker_context',
    currentBoundaryId: 'boundary-1',
  });
  assert.equal(decision.accept, false);
  assert.equal(decision.reason, 'missing_incoming');
});

test('allows bootstrap adoption when local boundary is missing', () => {
  const decision = shouldAcceptWorkerSnapshot({
    source: 'indexeddb_checkpoint',
    incomingBoundaryId: 'boundary-2',
    currentBoundaryId: undefined,
  });
  assert.equal(decision.accept, true);
  assert.equal(decision.reason, 'bootstrap_adopt');
  assert.equal(decision.adoptedBoundaryId, 'boundary-2');
});

test('allows epoch adoption only when no pending run exists', () => {
  const adoptDecision = shouldAcceptWorkerSnapshot({
    source: 'cloud_checkpoint',
    incomingBoundaryId: 'boundary-next',
    currentBoundaryId: 'boundary-prev',
    taskEpochAdvanced: true,
    hasPendingRun: false,
  });
  assert.equal(adoptDecision.accept, true);
  assert.equal(adoptDecision.reason, 'epoch_adopt');
  assert.equal(adoptDecision.adoptedBoundaryId, 'boundary-next');

  const rejectWithPending = shouldAcceptWorkerSnapshot({
    source: 'cloud_checkpoint',
    incomingBoundaryId: 'boundary-next',
    currentBoundaryId: 'boundary-prev',
    taskEpochAdvanced: true,
    hasPendingRun: true,
  });
  assert.equal(rejectWithPending.accept, false);
  assert.equal(rejectWithPending.reason, 'mismatch');
});
