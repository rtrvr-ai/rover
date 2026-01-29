import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSemanticCheckpointDigest } from '../dist/cloudCheckpoint.js';

const basePayload = {
  version: 1,
  siteId: 'site_1',
  visitorId: 'visitor_1',
  sessionId: 'session_1',
  updatedAt: 1000,
  sharedState: {
    taskEpoch: 2,
    task: { taskId: 'task_a', status: 'running' },
    activeRun: { runId: 'run_a', status: 'running' },
    tabs: [{ logicalTabId: 1, scope: 'in_scope', status: 'open', url: 'https://example.com/path' }],
  },
  runtimeState: {
    taskEpoch: 2,
    activeTask: { taskId: 'task_a', status: 'running' },
    pendingRun: { id: 'run_a', resumeRequired: false },
    workerState: {
      taskBoundaryId: 'boundary_1',
      trajectoryId: 'traj_1',
      plannerHistory: [{ id: 'p1' }],
      agentPrevSteps: [{ id: 'a1' }],
    },
    taskTabScope: {
      boundaryId: 'boundary_1',
      seedTabId: 1,
      touchedTabIds: [1],
    },
  },
};

test('semantic digest is stable for identical semantic payload', () => {
  const digestA = buildSemanticCheckpointDigest(basePayload);
  const digestB = buildSemanticCheckpointDigest(JSON.parse(JSON.stringify(basePayload)));
  assert.equal(digestA, digestB);
});

test('semantic digest changes on meaningful run state transition', () => {
  const running = buildSemanticCheckpointDigest(basePayload);
  const completed = buildSemanticCheckpointDigest({
    ...basePayload,
    runtimeState: {
      ...basePayload.runtimeState,
      activeTask: { taskId: 'task_a', status: 'completed' },
    },
  });
  assert.notEqual(running, completed);
});

test('semantic digest ignores timestamp-only noise fields', () => {
  const digestA = buildSemanticCheckpointDigest(basePayload);
  const digestB = buildSemanticCheckpointDigest({
    ...basePayload,
    updatedAt: 9999,
    runtimeState: {
      ...basePayload.runtimeState,
      updatedAt: 5555,
      workerState: {
        ...basePayload.runtimeState.workerState,
        updatedAt: 7777,
      },
    },
  });
  assert.equal(digestA, digestB);
});
