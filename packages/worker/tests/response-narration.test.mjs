import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveResponseNarrationFromOutput,
  sanitizeResponseNarration,
} from '../dist/agent/responseNarration.js';
import { executePlannerWithTools } from '../dist/agent/plannerAgent.js';

test('response narration prefers user-facing response fields', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({ response: 'I found the checkout settings.' }, { responseKind: 'final' }),
    'I found the checkout settings.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput([{ response: 'I selected the best plan.' }], { responseKind: 'final' }),
    'I selected the best plan.',
  );
});

test('response narration summarizes large arrays instead of reading raw data', () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ name: `Row ${i}`, value: i }));
  assert.equal(
    deriveResponseNarrationFromOutput(rows, { responseKind: 'final', toolName: 'extract' }),
    'I found 24 results and posted them in the chat.',
  );
});

test('response narration strips unsafe URLs, paths, code, and email addresses', () => {
  const text = [
    'Done for bhavani@example.com.',
    '```js\nconsole.log("secret")\n```',
    'Open https://example.com/private?token=abc',
    'Saved at /Users/customer/private.pdf',
  ].join('\n');
  const narration = sanitizeResponseNarration(text, { responseKind: 'checkpoint' });
  assert.equal(narration, 'Done for email address.');
});

test('response narration describes artifacts without raw storage paths', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({
      generatedContentRef: {
        docs: [{ title: 'Guide', url: 'https://docs.google.com/document/d/123' }],
      },
    }, { responseKind: 'final' }),
    'I created a document and posted the link in the chat.',
  );
});

test('planner emits one assistant checkpoint after a completed tool', async () => {
  const checkpoints = [];
  const ctx = {
    isCancelled: () => false,
    callExtensionRouter: async () => ({
      success: true,
      data: {
        plan: {
          toolName: 'extract',
          parameters: {},
          serverResult: {
            success: true,
            data: { response: 'I extracted the pricing details.' },
          },
        },
        taskComplete: true,
        overallThought: 'Pricing details are ready.',
      },
    }),
    getPageData: async () => ({ url: 'https://example.com', title: 'Example', content: '', contentType: 'text/html' }),
  };

  const result = await executePlannerWithTools({
    userInput: 'extract pricing',
    tabs: [{ id: 1, url: 'https://example.com' }],
    trajectoryId: 'traj-test',
    previousSteps: [],
    ctx,
    bridgeRpc: async () => undefined,
    onAssistantCheckpoint: checkpoint => checkpoints.push(checkpoint),
  });

  assert.equal(result.response.taskComplete, true);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(checkpoints[0], {
    responseKind: 'checkpoint',
    sourceToolName: 'extract',
    output: { response: 'I extracted the pricing details.' },
    error: undefined,
  });
});
