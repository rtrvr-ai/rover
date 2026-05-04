import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

const delay = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function createWorkerHarness(plannerPayload) {
  const messages = [];
  const previousSelf = globalThis.self;
  const previousFetch = globalThis.fetch;
  const fetchCalls = [];
  const selfMock = {
    onmessage: null,
    postMessage(message) {
      messages.push(message);
    },
  };
  globalThis.self = selfMock;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    fetchCalls.push(body);
    assert.equal(body.action, 'plan');
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: plannerPayload,
      }),
      headers: { get: () => null },
    };
  };

  await import(`../dist/worker.js?planner-completion=${Date.now()}-${Math.random()}`);
  assert.equal(typeof selfMock.onmessage, 'function');

  const channel = new MessageChannel();
  channel.port2.on('message', message => {
    if (!message || message.t !== 'req') return;
    let result;
    if (message.method === 'listSessionTabs') {
      result = [{
        logicalTabId: 1,
        runtimeId: 'runtime-1',
        url: 'https://example.com/docs',
        title: 'Docs',
        updatedAt: Date.now(),
      }];
    } else if (message.method === 'getTabContext') {
      result = {
        logicalTabId: 1,
        url: 'https://example.com/docs',
        title: 'Docs',
      };
    } else if (message.method === 'getPageData') {
      result = {
        url: 'https://example.com/docs',
        title: 'Docs',
        content: 'Documentation page',
        contentType: 'text/html',
      };
    } else {
      result = undefined;
    }
    channel.port2.postMessage({ t: 'res', id: message.id, ok: true, result });
  });
  channel.port2.start?.();

  await selfMock.onmessage({
    data: {
      type: 'init',
      config: {
        siteId: 'site-test',
        apiBase: 'https://agent.test',
        sessionToken: 'rvrsess_test_token',
        sessionId: `session-${Date.now()}-${Math.random()}`,
        taskRouting: { mode: 'planner' },
        ui: {
          experience: {
            audio: {
              narration: {
                enabled: true,
                defaultMode: 'always',
              },
            },
          },
        },
      },
      port: channel.port1,
    },
  });
  await delay();
  messages.length = 0;

  return {
    messages,
    fetchCalls,
    async run() {
      await selfMock.onmessage({
        data: {
          type: 'run',
          runId: `run-${Date.now()}-${Math.random()}`,
          text: 'Use the planner',
          routing: 'planner',
          narrationEnabledForRun: true,
          narrationDefaultActiveForRun: true,
        },
      });
      await delay();
    },
    restore() {
      channel.port1.close();
      channel.port2.close();
      globalThis.self = previousSelf;
      globalThis.fetch = previousFetch;
    },
  };
}

test('planner final response is emitted before terminal completion', async () => {
  const harness = await createWorkerHarness({
    plan: {
      toolName: 'extract',
      parameters: {},
      serverResult: {
        success: true,
        data: { response: 'I extracted the setup steps.' },
      },
    },
    taskComplete: true,
    overallThought: 'The setup steps are ready.',
  });

  try {
    await harness.run();
    const assistantIndex = harness.messages.findIndex(message => message.type === 'assistant' && message.responseKind === 'final');
    const completedIndex = harness.messages.findIndex(message => message.type === 'execution_completed');
    assert.notEqual(assistantIndex, -1);
    assert.notEqual(completedIndex, -1);
    assert.ok(assistantIndex < completedIndex);
    assert.equal(harness.messages[assistantIndex].text, 'The setup steps are ready.');
    assert.equal(harness.messages[completedIndex].terminalState, 'completed');
    assert.equal(harness.messages[completedIndex].runComplete, true);
  } finally {
    harness.restore();
  }
});

test('planner ACT-shaped final output uses user-facing tab response when planner final text is absent', async () => {
  const harness = await createWorkerHarness({
    plan: {
      toolName: 'ACT',
      parameters: {},
      serverResult: {
        success: true,
        data: {
          tabResponses: {
            1: {
              data: [
                {
                  response: 'To use the extension, install it, sign in, and sync your shortcuts.',
                },
              ],
            },
          },
        },
      },
    },
    taskComplete: true,
    overallThought: '',
  });

  try {
    await harness.run();
    const assistant = harness.messages.find(message => message.type === 'assistant' && message.responseKind === 'final');
    const completed = harness.messages.find(message => message.type === 'execution_completed');
    assert.equal(assistant?.text, 'To use the extension, install it, sign in, and sync your shortcuts.');
    assert.equal(completed?.terminalState, 'completed');
    assert.equal(completed?.runComplete, true);
  } finally {
    harness.restore();
  }
});

test('planner questions emit waiting input instead of completed', async () => {
  const harness = await createWorkerHarness({
    questions: [
      {
        key: 'use_case',
        query: 'What are you trying to set up?',
        required: true,
      },
    ],
    taskComplete: false,
    overallThought: 'Need clarification.',
  });

  try {
    await harness.run();
    const question = harness.messages.find(message => message.type === 'assistant' && message.responseKind === 'question');
    const stateTransition = harness.messages.find(message => message.type === 'execution_state_transition');
    const completed = harness.messages.find(message => message.type === 'execution_completed');
    assert.match(question?.text || '', /What are you trying to set up\?/);
    assert.equal(stateTransition?.terminalState, 'waiting_input');
    assert.equal(stateTransition?.needsUserInput, true);
    assert.equal(completed, undefined);
  } finally {
    harness.restore();
  }
});
