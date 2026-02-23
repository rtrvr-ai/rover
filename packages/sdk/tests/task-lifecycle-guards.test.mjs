import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAutoResumePendingRun,
  resolveAutoResumePolicyAction,
  shouldAdoptProjectionRun,
  shouldAdoptSnapshotActiveRun,
  shouldClearPendingFromSharedState,
  shouldIgnoreRunScopedMessage,
  shouldQueueCancelForIgnoredProjectionRun,
  shouldStartFreshTask,
} from '../dist/taskLifecycleGuards.js';

test('complete -> follow-up starts fresh task', () => {
  assert.equal(shouldStartFreshTask('completed'), true);
  assert.equal(shouldStartFreshTask('failed'), true);
  assert.equal(shouldStartFreshTask('cancelled'), true);
  assert.equal(shouldStartFreshTask('ended'), true);
  assert.equal(shouldStartFreshTask('running'), false);
  assert.equal(canAutoResumePendingRun('running'), true);
  assert.equal(canAutoResumePendingRun('completed'), false);
});

test('cancel -> no late resume from stale run id', () => {
  const ignored = new Set(['run-cancelled']);

  const ignoreLateCompletion = shouldIgnoreRunScopedMessage({
    type: 'run_completed',
    messageRunId: 'run-cancelled',
    pendingRunId: undefined,
    taskStatus: 'running',
    ignoredRunIds: ignored,
  });
  assert.equal(ignoreLateCompletion, true);

  const adoptCancelledSnapshot = shouldAdoptSnapshotActiveRun({
    taskStatus: 'running',
    hasPendingRun: false,
    activeRunId: 'run-cancelled',
    activeRunText: 'cancelled task',
    ignoredRunIds: ignored,
  });
  assert.equal(adoptCancelledSnapshot, false);
});

test('end task -> no stale run adoption across tabs', () => {
  const adoptWhenEnded = shouldAdoptSnapshotActiveRun({
    taskStatus: 'ended',
    hasPendingRun: false,
    activeRunId: 'stale-run',
    activeRunText: 'stale',
    ignoredRunIds: new Set(),
  });
  assert.equal(adoptWhenEnded, false);

  const clearPendingForEndedTask = shouldClearPendingFromSharedState({
    localTaskStatus: 'ended',
    remoteTaskStatus: 'running',
    mode: 'controller',
    hasRemoteActiveRun: true,
  });
  assert.equal(clearPendingForEndedTask, true);
});

test('run lifecycle messages are gated by task boundary id', () => {
  const ignoreBoundaryMismatch = shouldIgnoreRunScopedMessage({
    type: 'run_started',
    messageRunId: 'run-1',
    messageTaskBoundaryId: 'boundary-old',
    currentTaskBoundaryId: 'boundary-new',
    pendingRunId: 'run-1',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(ignoreBoundaryMismatch, true);

  const ignoreMissingBoundaryForNonPending = shouldIgnoreRunScopedMessage({
    type: 'run_completed',
    messageRunId: 'run-2',
    currentTaskBoundaryId: 'boundary-new',
    pendingRunId: 'run-1',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(ignoreMissingBoundaryForNonPending, true);

  const acceptMatchingBoundary = shouldIgnoreRunScopedMessage({
    type: 'run_completed',
    messageRunId: 'run-1',
    messageTaskBoundaryId: 'boundary-new',
    currentTaskBoundaryId: 'boundary-new',
    pendingRunId: 'run-1',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(acceptMatchingBoundary, false);
});

test('pending completion is accepted even if boundary metadata is missing', () => {
  const acceptPendingCompletion = shouldIgnoreRunScopedMessage({
    type: 'run_completed',
    messageRunId: 'run-pending',
    messageTaskBoundaryId: undefined,
    currentTaskBoundaryId: 'boundary-current',
    pendingRunId: 'run-pending',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(acceptPendingCompletion, false);
});

test('auto-resume policy branching honors auto, confirm, never, and remote owner defer', () => {
  assert.equal(
    resolveAutoResumePolicyAction({
      policy: 'auto',
      resumeRequired: true,
      hasLiveRemoteController: false,
    }),
    'auto_resume',
  );
  assert.equal(
    resolveAutoResumePolicyAction({
      policy: 'confirm',
      resumeRequired: true,
      hasLiveRemoteController: false,
    }),
    'prompt_resume',
  );
  assert.equal(
    resolveAutoResumePolicyAction({
      policy: 'never',
      resumeRequired: true,
      hasLiveRemoteController: false,
    }),
    'cancel_resume',
  );
  assert.equal(
    resolveAutoResumePolicyAction({
      policy: 'auto',
      resumeRequired: true,
      hasLiveRemoteController: true,
    }),
    'defer_remote_owner',
  );
  assert.equal(
    resolveAutoResumePolicyAction({
      policy: 'confirm',
      resumeRequired: false,
      hasLiveRemoteController: false,
    }),
    'noop',
  );
});

test('projection adoption skips ignored run ids and queues cancel only for non-terminal ignored runs', () => {
  const ignored = new Set(['run_ignored']);
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_ignored',
      localPendingRunId: '',
      ignoredRunIds: ignored,
    }),
    false,
  );
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_new',
      localPendingRunId: 'run_old',
      ignoredRunIds: ignored,
    }),
    true,
  );
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_same',
      localPendingRunId: 'run_same',
      ignoredRunIds: ignored,
    }),
    false,
  );
  assert.equal(
    shouldQueueCancelForIgnoredProjectionRun({
      serverRunId: 'run_ignored',
      runStatus: 'running',
      ignoredRunIds: ignored,
    }),
    true,
  );
  assert.equal(
    shouldQueueCancelForIgnoredProjectionRun({
      serverRunId: 'run_ignored',
      runStatus: 'cancelled',
      ignoredRunIds: ignored,
    }),
    false,
  );
});
