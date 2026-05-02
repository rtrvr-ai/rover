import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window ||= {};
globalThis.document ||= {
  addEventListener() {},
  removeEventListener() {},
  querySelector() {
    return null;
  },
};

const { __roverInternalsForTests } = await import('../dist/rover.js');

test('summary-only conversation records are not considered restorable and should fetch remote payload', () => {
  const record = {
    summary: {
      conversationId: 'conv-summary',
      title: 'Previous chat',
      updatedAt: 1000,
    },
  };

  assert.equal(__roverInternalsForTests.hasRestorableConversationPayloadForTests(record), false);
  assert.equal(__roverInternalsForTests.shouldFetchRemoteConversationRecordForTests(record), true);
});

test('conversation payload with taskRecord restores the full task transcript', () => {
  const record = {
    summary: {
      conversationId: 'conv-task',
      title: 'Find the right plan',
      status: 'completed',
      createdAt: 1000,
      updatedAt: 3000,
    },
    payload: {
      taskRecord: {
        taskId: 'conv-task',
        state: 'completed',
        boundaryId: 'bnd-old',
        startedAt: 1000,
        endedAt: 3000,
        uiMessages: [
          { id: 'u1', role: 'user', text: 'Find the right plan', ts: 1000 },
          { id: 'a1', role: 'assistant', text: 'Use Pro.', ts: 3000 },
        ],
        timeline: [
          { id: 't1', kind: 'assistant_response', title: 'Recommendation', ts: 3000, status: 'success' },
        ],
        rootUserInput: 'Find the right plan',
        tabIds: [],
      },
    },
  };

  const task = __roverInternalsForTests.buildTaskRecordFromConversationRecordForTests(record, 'conv-task');
  assert.equal(task.taskId, 'conv-task');
  assert.equal(task.state, 'completed');
  assert.equal(task.uiMessages.length, 2);
  assert.equal(task.timeline.length, 1);
  assert.equal(task.rootUserInput, 'Find the right plan');
});

test('conversation payload without taskRecord hydrates from messages and timeline', () => {
  const record = {
    summary: {
      conversationId: 'conv-payload',
      title: 'Book a demo',
      preview: 'Demo request submitted.',
      status: 'completed',
      createdAt: 2000,
      updatedAt: 5000,
    },
    payload: {
      uiMessages: [
        { id: 'u1', role: 'user', text: 'Book a demo', ts: 2000 },
        { id: 'a1', role: 'assistant', text: 'Demo request submitted.', ts: 5000 },
      ],
      timeline: [],
    },
  };

  const task = __roverInternalsForTests.buildTaskRecordFromConversationRecordForTests(record, 'conv-payload');
  assert.equal(task.taskId, 'conv-payload');
  assert.equal(task.state, 'completed');
  assert.equal(task.uiMessages.length, 2);
  assert.equal(task.rootUserInput, 'Book a demo');
  assert.equal(task.summary, 'Demo request submitted.');
  assert.equal(task.endedAt, 5000);
});

test('conversation switch live-run guard ignores terminal current tasks and stale shared runs', () => {
  assert.equal(
    __roverInternalsForTests.shouldBlockConversationSwitchForLiveRunForTests({
      currentTask: { taskId: 'current', state: 'completed' },
      targetConversationId: 'previous',
      pendingRun: { id: 'run-1', text: 'old', startedAt: 1000, attempts: 1, autoResume: false },
      pendingRunLikelyActive: true,
      sharedActiveRun: { runId: 'run-1', runtimeId: 'runtime-1', updatedAt: 2000 },
      runtimeId: 'runtime-1',
      now: 3000,
    }),
    false,
  );

  assert.equal(
    __roverInternalsForTests.shouldBlockConversationSwitchForLiveRunForTests({
      currentTask: { taskId: 'current', state: 'running' },
      targetConversationId: 'previous',
      sharedActiveRun: { runId: 'stale-run', runtimeId: 'runtime-1', updatedAt: 1 },
      runtimeId: 'runtime-1',
      now: 60_000,
    }),
    false,
  );
});

test('conversation switch live-run guard still blocks genuinely active current runs', () => {
  assert.equal(
    __roverInternalsForTests.shouldBlockConversationSwitchForLiveRunForTests({
      currentTask: { taskId: 'current', state: 'running' },
      targetConversationId: 'previous',
      pendingRun: { id: 'run-2', text: 'working', startedAt: 1000, attempts: 1, autoResume: false },
      pendingRunLikelyActive: true,
      runtimeId: 'runtime-1',
      now: 2000,
    }),
    true,
  );
});
