import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveResponseNarrationFromOutput,
  deriveResponseTextFromOutput,
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

test('response narration reads ACT tab response envelopes', () => {
  const output = {
    tabResponses: {
      3: {
        accTreeId: 'tree-3',
        thought: '',
        data: [
          {
            response: 'To use the rtrvr.ai Chrome extension, open it, sign in, and sync your shortcuts.',
          },
        ],
      },
    },
    creditsUsed: 4.7,
  };

  assert.equal(
    deriveResponseTextFromOutput(output, { responseKind: 'final', activeTabId: 3 }),
    'To use the rtrvr.ai Chrome extension, open it, sign in, and sync your shortcuts.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput(output, { responseKind: 'final', activeTabId: 3 }),
    'To use the rtrvr.ai Chrome extension, open it, sign in, and sync your shortcuts.',
  );
});

test('response narration reads wrapped planner and ACT outputs', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({ output: { response: 'I checked the setup steps.' } }, { responseKind: 'checkpoint' }),
    'I checked the setup steps.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ data: [{ response: 'The extension setup is complete.' }] }, { responseKind: 'final' }),
    'The extension setup is complete.',
  );
});

test('response narration reads audited extension function text fields', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({ text: 'Processed the pasted text.' }, { responseKind: 'checkpoint', toolName: 'process_text' }),
    'Processed the pasted text.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ textOutput: 'The docs say to open the extension and sign in.' }, { responseKind: 'checkpoint', toolName: 'query_rtrvr_docs' }),
    'The docs say to open the extension and sign in.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ statusText: 'Sheet created with 3 data rows.' }, { responseKind: 'checkpoint', toolName: 'create_sheet_from_data' }),
    'Sheet created with 3 data rows.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ llmOutput: 'I created a draft for the onboarding page.' }, { responseKind: 'checkpoint', toolName: 'webpage_generator' }),
    'I created a draft for the onboarding page.',
  );
});

test('response narration summarizes data and sheet outputs safely', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({ jsonData: [{ name: 'A' }, { name: 'B' }] }, { responseKind: 'checkpoint', toolName: 'create_sheet_from_data' }),
    'I finished 2 items and posted the result in the chat.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ data: [{ price: '$10' }, { price: '$20' }] }, { responseKind: 'checkpoint', toolName: 'extract' }),
    'I found 2 results and posted them in the chat.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ schemaHeaderSheetInfo: [{ sheetInfo: { sheetId: 'private-sheet-id' } }] }, { responseKind: 'checkpoint' }),
    'I created a sheet and posted the link in the chat.',
  );
});

test('response narration summarizes generated content and tools without leaking refs', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({
      generatedContentRef: {
        docs: [{ title: 'Guide', storagePath: 'user/private/doc.json', url: 'https://docs.google.com/document/d/123' }],
      },
    }, { responseKind: 'final' }),
    'I created a document and posted the link in the chat.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({
      generatedContentRef: {
        type: 'slides_draft',
        content: '# Secret draft content with https://example.com/private',
      },
    }, { responseKind: 'checkpoint' }),
    'I created a presentation and posted the link in the chat.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput({
      generatedTools: [{ name: 'lookup_order' }, { name: 'refund_order' }],
    }, { responseKind: 'checkpoint', toolName: 'custom_tool_generator' }),
    'I created 2 custom tools and posted the result in the chat.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput([
      { name: 'lookup_order' },
      { name: 'refund_order' },
    ], { responseKind: 'checkpoint', toolName: 'custom_tool_generator' }),
    'I created 2 custom tools and posted the result in the chat.',
  );
});

test('response narration handles execute_multiple_tools results compactly', () => {
  assert.equal(
    deriveResponseNarrationFromOutput([
      { name: 'query_rtrvr_docs', success: true, result: { response: 'I found the install instructions.' } },
    ], { responseKind: 'checkpoint', toolName: 'execute_multiple_tools' }),
    'I found the install instructions.',
  );
  assert.equal(
    deriveResponseNarrationFromOutput([
      { name: 'click_element', success: true, result: { clicked: true } },
      { name: 'type_into_element', success: true, result: { typed: true } },
      { name: 'select_dropdown_value', success: true, result: { selected: true } },
    ], { responseKind: 'checkpoint', toolName: 'execute_multiple_tools' }),
    'I finished 3 steps and posted the result in the chat.',
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

test('response narration speaks questions from tool response output', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({
      status: 'waiting_input',
      questions: [
        {
          key: 'use_case',
          query: 'What best describes your use case?',
          choices: ['Personal', 'Team', 'Enterprise'],
          required: true,
        },
      ],
    }, { responseKind: 'question' }),
    'What best describes your use case?',
  );
});

test('response narration stays compact for multiple tool response questions', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({
      questions: [
        { key: 'role', query: 'What is your role?', required: true },
        { key: 'team_size', query: 'How large is your team?', required: true },
        { key: 'timeline', query: 'When do you want to launch?', required: false },
      ],
    }, { responseKind: 'question' }),
    'I need 3 details: What is your role?',
  );
});

test('response narration skips non-user-facing object output without fallback', () => {
  assert.equal(
    deriveResponseNarrationFromOutput({ status: 'ok', internalId: 'abc123' }, { responseKind: 'checkpoint' }),
    undefined,
  );
  assert.equal(
    deriveResponseNarrationFromOutput({ description: 'Internal object description', result: 'Internal raw result' }, { responseKind: 'checkpoint' }),
    undefined,
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
