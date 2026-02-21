import test from 'node:test';
import assert from 'node:assert/strict';

import { reduceTaskKernel } from '../dist/taskKernel.js';

function createTask(reason, at, taskId = 'task-1') {
  return {
    taskId,
    status: 'running',
    startedAt: at,
    boundaryReason: reason,
  };
}

test('new_task rotates boundary and clears pending/worker state', () => {
  const result = reduceTaskKernel(
    {
      task: {
        taskId: 'task-old',
        status: 'running',
        startedAt: 100,
      },
      taskEpoch: 4,
    },
    {
      type: 'new_task',
      reason: 'manual_new_task',
      at: 200,
      taskId: 'task-new',
    },
    { createTask },
  );

  assert.equal(result.task.taskId, 'task-new');
  assert.equal(result.task.status, 'running');
  assert.equal(result.taskEpoch, 5);
  assert.equal(result.rotateBoundary, true);
  assert.equal(result.clearPendingRun, true);
  assert.equal(result.clearWorkerState, true);
});

test('terminal transition keeps boundary and clears pending + worker state', () => {
  const result = reduceTaskKernel(
    {
      task: {
        taskId: 'task-1',
        status: 'running',
        startedAt: 100,
      },
      taskEpoch: 3,
    },
    {
      type: 'terminal',
      terminal: 'completed',
      reason: 'worker_task_complete',
      at: 220,
    },
    { createTask },
  );

  assert.equal(result.task.status, 'completed');
  assert.equal(result.lifecycle, 'terminal');
  assert.equal(result.taskEpoch, 3);
  assert.equal(result.rotateBoundary, false);
  assert.equal(result.clearPendingRun, true);
  assert.equal(result.clearWorkerState, true);
});

test('awaiting_user keeps running task without boundary rotation', () => {
  const result = reduceTaskKernel(
    {
      task: {
        taskId: 'task-1',
        status: 'running',
        startedAt: 100,
      },
      taskEpoch: 2,
    },
    {
      type: 'awaiting_user',
      reason: 'worker_waiting_for_input',
      at: 150,
    },
    { createTask },
  );

  assert.equal(result.task.status, 'running');
  assert.equal(result.lifecycle, 'awaiting_user');
  assert.equal(result.taskEpoch, 2);
  assert.equal(result.rotateBoundary, false);
  assert.equal(result.clearPendingRun, false);
  assert.equal(result.clearWorkerState, false);
});
