import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMatchingTaskRecord,
  resolveRenderableStatusRunId,
  shouldPreserveWidgetOpenOnResume,
} from '../dist/continuityAdoption.js';

test('continuation matching prefers boundary over run id and task id', () => {
  const boundaryMatch = {
    taskId: 'task-boundary',
    boundaryId: 'boundary-1',
    pendingRun: { id: 'run-other' },
  };
  const runMatch = {
    taskId: 'task-run',
    boundaryId: 'boundary-2',
    pendingRun: { id: 'run-1' },
  };
  const taskMatch = {
    taskId: 'task-1',
    boundaryId: 'boundary-3',
    pendingRun: { id: 'run-3' },
  };

  const matched = findMatchingTaskRecord(
    [runMatch, boundaryMatch, taskMatch],
    { boundaryId: 'boundary-1', runId: 'run-1', taskId: 'task-1' },
  );

  assert.equal(matched?.taskId, 'task-boundary');
});

test('continuation matching falls back to run id when boundary is absent', () => {
  const matched = findMatchingTaskRecord(
    [
      { taskId: 'task-a', boundaryId: 'boundary-a', pendingRun: { id: 'run-a' } },
      { taskId: 'task-b', boundaryId: 'boundary-b', pendingRun: { id: 'run-b' } },
    ],
    { runId: 'run-b' },
  );

  assert.equal(matched?.taskId, 'task-b');
});

test('continuation matching falls back to task id when run and boundary are absent', () => {
  const matched = findMatchingTaskRecord(
    [
      { taskId: 'task-a', boundaryId: 'boundary-a' },
      { taskId: 'task-b', boundaryId: 'boundary-b' },
    ],
    { taskId: 'task-b' },
  );

  assert.equal(matched?.taskId, 'task-b');
});

test('widget open state is preserved only when handoff explicitly requests it', () => {
  assert.equal(shouldPreserveWidgetOpenOnResume(undefined), false);
  assert.equal(shouldPreserveWidgetOpenOnResume('preserve_if_running'), true);
});

test('observer status rendering uses shared active run only for the displayed task', () => {
  const visible = resolveRenderableStatusRunId({
    sharedActiveRunId: 'run-remote',
    sharedTaskId: 'task-a',
    activeTaskId: 'task-a',
  });
  assert.equal(visible, 'run-remote');

  const hidden = resolveRenderableStatusRunId({
    sharedActiveRunId: 'run-remote',
    sharedTaskId: 'task-a',
    activeTaskId: 'task-b',
  });
  assert.equal(hidden, undefined);
});

test('stale status rendering hides when there is no local or shared active run', () => {
  const visible = resolveRenderableStatusRunId({
    localPendingRunId: undefined,
    sharedActiveRunId: undefined,
    activeTaskId: 'task-a',
  });

  assert.equal(visible, undefined);
});
