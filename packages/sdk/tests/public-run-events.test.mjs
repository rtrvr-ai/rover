import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicRunLifecyclePayload,
  buildPublicRunStartedPayload,
  normalizePromptContextEntry,
} from '../dist/publicRunEvents.js';

test('run_started payload exposes public run metadata', () => {
  const payload = buildPublicRunStartedPayload({
    msg: {
      runId: 'run-1',
      taskBoundaryId: 'task-boundary-1',
      text: 'Check pricing',
    },
    taskId: 'task-1',
    currentTaskBoundaryId: 'task-boundary-1',
    pageUrl: 'https://example.com/pricing',
    now: 123,
  });

  assert.equal(payload.taskId, 'task-1');
  assert.equal(payload.runId, 'run-1');
  assert.equal(payload.taskBoundaryId, 'task-boundary-1');
  assert.equal(payload.text, 'Check pricing');
  assert.equal(payload.startedAt, 123);
});

test('run lifecycle payload keeps terminal state, outcome, and summary', () => {
  const payload = buildPublicRunLifecyclePayload({
    msg: {
      runId: 'run-2',
      taskBoundaryId: 'task-boundary-2',
      summary: 'Completed checkout',
      ok: true,
    },
    taskId: 'task-2',
    currentTaskBoundaryId: 'task-boundary-2',
    pageUrl: 'https://example.com/checkout',
    now: 456,
    completionState: {
      taskComplete: true,
      needsUserInput: false,
      terminalState: 'completed',
      contextResetRecommended: true,
    },
  });

  assert.equal(payload.taskId, 'task-2');
  assert.equal(payload.runId, 'run-2');
  assert.equal(payload.taskBoundaryId, 'task-boundary-2');
  assert.equal(payload.terminalState, 'completed');
  assert.equal(payload.taskComplete, true);
  assert.equal(payload.outcome, 'success');
  assert.equal(payload.summary, 'Completed checkout');
  assert.equal(payload.endedAt, 456);
});

test('prompt context entries normalize strings and reject blanks', () => {
  assert.deepEqual(normalizePromptContextEntry('Remember the pricing path'), {
    role: 'model',
    message: 'Remember the pricing path',
  });
  assert.equal(normalizePromptContextEntry('   '), null);
  assert.deepEqual(normalizePromptContextEntry({ message: 'Shared note' }), {
    role: 'model',
    message: 'Shared note',
  });
});
