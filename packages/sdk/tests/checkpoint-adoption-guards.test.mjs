import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeCheckpointContinuityScore,
  shouldAdoptCheckpointState,
} from '../dist/checkpointAdoptionGuards.js';

test('newer incoming checkpoint timestamp is adopted', () => {
  const adopted = shouldAdoptCheckpointState({
    localUpdatedAt: 1_000,
    incomingUpdatedAt: 1_500,
    localState: {},
    incomingState: {},
    crossDomainResumeActive: false,
  });
  assert.equal(adopted, true);
});

test('cross-domain resume adopts older timestamp when incoming state is richer', () => {
  const localState = {
    taskEpoch: 3,
    activeTask: { status: 'running' },
  };
  const incomingState = {
    taskEpoch: 3,
    activeTask: { status: 'running' },
    pendingRun: { id: 'run_123', resumeRequired: true, taskBoundaryId: 'b1' },
    workerState: {
      rootUserInput: 'continue task',
      history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      plannerHistory: [{ step: 'x' }],
      agentPrevSteps: [{ tool: 'click' }],
    },
  };

  assert.ok(computeCheckpointContinuityScore(incomingState) > computeCheckpointContinuityScore(localState));
  const adopted = shouldAdoptCheckpointState({
    localUpdatedAt: 2_000,
    incomingUpdatedAt: 1_950,
    localState,
    incomingState,
    crossDomainResumeActive: true,
  });
  assert.equal(adopted, true);
});

test('older richer checkpoint is not adopted outside cross-domain resume mode', () => {
  const adopted = shouldAdoptCheckpointState({
    localUpdatedAt: 2_000,
    incomingUpdatedAt: 1_950,
    localState: {},
    incomingState: {
      pendingRun: { id: 'run_123', resumeRequired: true },
    },
    crossDomainResumeActive: false,
  });
  assert.equal(adopted, false);
});

test('boundary mismatch with lower incoming epoch is rejected', () => {
  const adopted = shouldAdoptCheckpointState({
    localUpdatedAt: 2_000,
    incomingUpdatedAt: 1_950,
    localState: {
      taskEpoch: 5,
      pendingRun: { id: 'run_local', taskBoundaryId: 'boundary-local' },
    },
    incomingState: {
      taskEpoch: 4,
      pendingRun: { id: 'run_remote', taskBoundaryId: 'boundary-remote', resumeRequired: true },
      workerState: {
        history: [{ role: 'user', content: 'x' }],
      },
    },
    crossDomainResumeActive: true,
  });
  assert.equal(adopted, false);
});
