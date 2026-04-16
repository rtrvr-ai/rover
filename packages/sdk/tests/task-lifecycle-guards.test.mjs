import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldAdoptExternalActiveRun,
  canAutoResumePendingRun,
  resolveAutoResumePolicyAction,
  shouldAdoptProjectionRun,
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

  const adoptCancelledSnapshot = shouldAdoptExternalActiveRun({
    taskStatus: 'running',
    localPendingRunId: 'run-cancelled',
    localPendingTaskBoundaryId: 'boundary-current',
    currentTaskBoundaryId: 'boundary-current',
    candidateRunId: 'run-cancelled',
    candidateRunText: 'cancelled task',
    candidateTaskBoundaryId: 'boundary-current',
    ignoredRunIds: ignored,
  });
  assert.equal(adoptCancelledSnapshot, false);
});

test('end task -> no stale run adoption across tabs', () => {
  const adoptWhenEnded = shouldAdoptExternalActiveRun({
    taskStatus: 'ended',
    localPendingRunId: 'stale-run',
    localPendingTaskBoundaryId: 'boundary-current',
    currentTaskBoundaryId: 'boundary-current',
    candidateRunId: 'stale-run',
    candidateRunText: 'stale',
    candidateTaskBoundaryId: 'boundary-current',
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

test('assistant and tool events are ignored when their task boundary mismatches the current task', () => {
  const ignoreAssistantBoundaryMismatch = shouldIgnoreRunScopedMessage({
    type: 'assistant',
    messageRunId: 'run-1',
    messageTaskBoundaryId: 'boundary-old',
    currentTaskBoundaryId: 'boundary-new',
    pendingRunId: 'run-1',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(ignoreAssistantBoundaryMismatch, true);

  const ignoreToolBoundaryMismatch = shouldIgnoreRunScopedMessage({
    type: 'tool_result',
    messageRunId: 'run-1',
    messageTaskBoundaryId: 'boundary-old',
    currentTaskBoundaryId: 'boundary-new',
    pendingRunId: 'run-1',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(ignoreToolBoundaryMismatch, true);

  const allowAssistantWithoutBoundaryWhenRunMatches = shouldIgnoreRunScopedMessage({
    type: 'assistant',
    messageRunId: 'run-1',
    currentTaskBoundaryId: 'boundary-new',
    pendingRunId: 'run-1',
    taskStatus: 'running',
    ignoredRunIds: new Set(),
  });
  assert.equal(allowAssistantWithoutBoundaryWhenRunMatches, false);
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

test('external active run adoption requires matching pending run and boundary ownership', () => {
  assert.equal(
    shouldAdoptExternalActiveRun({
      taskStatus: 'running',
      localPendingRunId: undefined,
      currentTaskBoundaryId: 'boundary-current',
      candidateRunId: 'run-old',
      candidateRunText: 'old task',
      candidateTaskBoundaryId: 'boundary-current',
      ignoredRunIds: new Set(),
    }),
    false,
  );
  assert.equal(
    shouldAdoptExternalActiveRun({
      taskStatus: 'running',
      localPendingRunId: 'run-current',
      localPendingTaskBoundaryId: 'boundary-current',
      currentTaskBoundaryId: 'boundary-current',
      candidateRunId: 'run-old',
      candidateRunText: 'old task',
      candidateTaskBoundaryId: 'boundary-current',
      ignoredRunIds: new Set(),
    }),
    false,
  );
  assert.equal(
    shouldAdoptExternalActiveRun({
      taskStatus: 'running',
      localPendingRunId: 'run-current',
      localPendingTaskBoundaryId: 'boundary-current',
      currentTaskBoundaryId: 'boundary-current',
      candidateRunId: 'run-current',
      candidateRunText: 'current task',
      candidateTaskBoundaryId: 'boundary-other',
      ignoredRunIds: new Set(),
    }),
    false,
  );
  assert.equal(
    shouldAdoptExternalActiveRun({
      taskStatus: 'running',
      localPendingRunId: 'run-current',
      localPendingTaskBoundaryId: 'boundary-current',
      currentTaskBoundaryId: 'boundary-current',
      candidateRunId: 'run-current',
      candidateRunText: 'current task',
      candidateTaskBoundaryId: 'boundary-current',
      ignoredRunIds: new Set(),
    }),
    true,
  );
});

test('projection adoption only refreshes the known current run and never seeds a fresh boundary from stale external state', () => {
  const ignored = new Set(['run_ignored']);
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_ignored',
      taskStatus: 'running',
      localPendingRunId: '',
      localPendingTaskBoundaryId: 'boundary-current',
      currentTaskBoundaryId: 'boundary-current',
      ignoredRunIds: ignored,
    }),
    false,
  );
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_new',
      taskStatus: 'running',
      localPendingRunId: '',
      localPendingTaskBoundaryId: undefined,
      currentTaskBoundaryId: 'boundary-current',
      ignoredRunIds: ignored,
    }),
    false,
  );
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_new',
      taskStatus: 'running',
      localPendingRunId: 'run_old',
      localPendingTaskBoundaryId: 'boundary-current',
      currentTaskBoundaryId: 'boundary-current',
      ignoredRunIds: ignored,
    }),
    false,
  );
  assert.equal(
    shouldAdoptProjectionRun({
      serverRunId: 'run_same',
      taskStatus: 'running',
      localPendingRunId: 'run_same',
      localPendingTaskBoundaryId: 'boundary-current',
      currentTaskBoundaryId: 'boundary-current',
      ignoredRunIds: ignored,
    }),
    true,
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
