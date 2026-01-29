import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSemanticCheckpointDigest } from '../dist/cloudCheckpoint.js';

function makePayload() {
  const plannerHistory = Array.from({ length: 120 }, (_, idx) => ({ id: `planner_${idx + 1}` }));
  const agentPrevSteps = Array.from({ length: 260 }, (_, idx) => ({ id: `step_${idx + 1}` }));
  return {
    version: 1,
    siteId: 'site_compaction',
    visitorId: 'visitor_compaction',
    sessionId: 'session_compaction',
    updatedAt: 1000,
    sharedState: {
      taskEpoch: 1,
      task: { taskId: 'task_compaction', status: 'running' },
      activeRun: { runId: 'run_compaction' },
      tabs: [{ logicalTabId: 1, scope: 'in_scope', status: 'open', url: 'https://example.com' }],
    },
    runtimeState: {
      taskEpoch: 1,
      activeTask: { taskId: 'task_compaction', status: 'running' },
      workerState: {
        taskBoundaryId: 'boundary_compaction',
        plannerHistory,
        agentPrevSteps,
      },
      taskTabScope: {
        boundaryId: 'boundary_compaction',
        seedTabId: 1,
        touchedTabIds: [1],
      },
    },
  };
}

test('semantic digest reflects high-volume planner and previous-step histories', () => {
  const base = makePayload();
  const digestA = buildSemanticCheckpointDigest(base);

  const changedMiddle = makePayload();
  changedMiddle.runtimeState.workerState.plannerHistory[40].id = 'planner_changed_mid';
  const digestB = buildSemanticCheckpointDigest(changedMiddle);

  const changedTail = makePayload();
  changedTail.runtimeState.workerState.agentPrevSteps[259].id = 'step_changed_tail';
  const digestC = buildSemanticCheckpointDigest(changedTail);

  assert.notEqual(digestA, digestB);
  assert.notEqual(digestA, digestC);
});
