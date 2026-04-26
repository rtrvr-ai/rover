import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildTranscriptSegments,
  deriveTimelineBody,
  deriveTimelineHeading,
  deriveTraceKey,
  summarizeTaskText,
} from '../dist/dom-helpers.js';
import { computeChipPlacement } from '../dist/components/action-spotlight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

test('task-stage summary shortens long URLs without mutating the underlying transcript contract', () => {
  const summary = summarizeTaskText(
    'update my menu here pick side items from https://www.goodbites.com.sg/_files/ugd/f53ac9_2f6249e06b12451bb0fe73932f6c15c1.pdf',
    { maxLength: 84, maxUrlLength: 30 },
  );

  assert.ok(summary.length <= 84);
  assert.match(summary, /goodbites\.com\.sg/);
  assert.equal(summary.includes('https://'), false);
});

test('transcript groups contiguous execution steps inline between surrounding messages', () => {
  const segments = buildTranscriptSegments(
    [
      { id: 'user-1', role: 'user', text: 'Update my menu', ts: 1000 },
      { id: 'system-1', role: 'system', text: 'Task cancelled.', ts: 1003 },
    ],
    [
      { id: 'trace-1', kind: 'tool_start', title: 'Open PDF', ts: 1001 },
      { id: 'trace-2', kind: 'tool_result', title: 'Read PDF', ts: 1002, status: 'success' },
      { id: 'trace-3', kind: 'info', title: 'Run cancelled', ts: 1004, status: 'info' },
    ],
  );

  assert.deepEqual(
    segments.map(segment => segment.kind),
    ['message', 'timeline', 'message', 'timeline'],
  );
  assert.equal(segments[0].kind, 'message');
  assert.equal(segments[0].message.role, 'user');
  assert.equal(segments[1].kind, 'timeline');
  assert.deepEqual(segments[1].events.map(event => event.id), ['trace-1', 'trace-2']);
  assert.equal(segments[2].kind, 'message');
  assert.equal(segments[2].message.text, 'Task cancelled.');
  assert.equal(segments[3].kind, 'timeline');
  assert.deepEqual(segments[3].events.map(event => event.id), ['trace-3']);
});

test('same-timestamp replay still favors user message first, then steps, then assistant/system output', () => {
  const segments = buildTranscriptSegments(
    [
      { id: 'user-1', role: 'user', text: 'Find the right plan', ts: 1000 },
      { id: 'assistant-1', role: 'assistant', text: 'Here are the options.', ts: 1000 },
    ],
    [
      { id: 'trace-1', kind: 'thought', title: 'Analyze: Pricing page', ts: 1000 },
    ],
  );

  assert.deepEqual(
    segments.map(segment => segment.kind === 'message' ? `message:${segment.message.role}` : 'timeline'),
    ['message:user', 'timeline', 'message:assistant'],
  );
});

test('mount uses summarized task text for hero and conversation labels instead of raw prompt copies', () => {
  const source = read('src/mount.ts');

  assert.match(source, /taskStageTitle\.textContent = summarizeTaskText\(latestTaskTitle, \{ maxLength: 120, maxUrlLength: 56 \}\)/);
  assert.match(source, /summarizeTaskText\(active\.summary, \{ maxLength: 44, maxUrlLength: 32 \}\) \|\| 'Current task'/);
  assert.match(source, /summary\.textContent = summarizeTaskText\(conv\.summary, \{ maxLength: 64, maxUrlLength: 36 \}\)/);
});

test('action cues drive deterministic timeline text without exposing raw tool details', () => {
  const event = {
    id: 'trace-click',
    kind: 'tool_start',
    title: 'Running click_element',
    detail: '{"element_id":3}',
    toolName: 'click_element',
    actionCue: {
      kind: 'click',
      toolCallId: 'call-1',
      primaryElementId: 3,
      elementIds: [3],
      targetLabel: 'Checkout',
    },
  };

  assert.equal(deriveTraceKey(event), 'tool:call-1');
  assert.equal(deriveTimelineHeading(event), 'Clicking Checkout');
  assert.equal(deriveTimelineBody(event), '');
});

test('action spotlight chip placement avoids target, panel, viewport, and occupied chips', () => {
  const placement = computeChipPlacement({
    target: { left: 100, top: 100, right: 180, bottom: 140, width: 80, height: 40 },
    chip: { width: 90, height: 28 },
    viewport: { left: 0, top: 0, right: 420, bottom: 320, width: 420, height: 320 },
    panel: { left: 260, top: 80, right: 410, bottom: 260, width: 150, height: 180 },
    occupied: [{ left: 4, top: 4, right: 100, bottom: 32, width: 96, height: 28 }],
  });

  assert.ok(placement);
  assert.notEqual(placement.side, 'right');
  assert.ok(placement.left >= 8);
  assert.ok(placement.top >= 8);
});
