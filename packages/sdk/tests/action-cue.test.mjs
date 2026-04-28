import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRoverActionCue,
  classifyToolActionKind,
  extractElementIdsFromToolArgs,
  extractLogicalTabIdFromToolArgs,
  sanitizeToolArgsForDisplay,
} from '../dist/actionCue.js';

test('extracts all supported system-tool element id keys in order', () => {
  assert.deepEqual(
    extractElementIdsFromToolArgs({
      element_id: 4,
      source_element_id: 8,
      target_element_id: '9',
      center_element_id: 8,
      element_ids: [12, '13', 0, 4],
    }),
    [4, 8, 9, 12, 13],
  );
});

test('classifies common browser actions into action cue kinds', () => {
  assert.equal(classifyToolActionKind('click_element'), 'click');
  assert.equal(classifyToolActionKind('type_into_element'), 'type');
  assert.equal(classifyToolActionKind('select_dropdown_value'), 'select');
  assert.equal(classifyToolActionKind('scroll_to_element'), 'scroll');
  assert.equal(classifyToolActionKind('drag_and_drop'), 'drag');
  assert.equal(classifyToolActionKind('goto_url'), 'navigate');
  assert.equal(classifyToolActionKind('wait_for_element'), 'wait');
});

test('builds action cues with stable call id and primary element', () => {
  assert.deepEqual(
    buildRoverActionCue({
      id: 'call-1',
      name: 'drag_and_drop',
      args: { source_element_id: 7, target_element_id: 11 },
    }),
    {
      kind: 'drag',
      toolCallId: 'call-1',
      primaryElementId: 7,
      elementIds: [7, 11],
      logicalTabId: undefined,
      valueRedacted: undefined,
    },
  );
});

test('preserves explicit and fallback logical tab ids on action cues', () => {
  assert.equal(extractLogicalTabIdFromToolArgs({ logical_tab_id: 4 }), 4);
  assert.equal(extractLogicalTabIdFromToolArgs({ tab_id: '5' }), 5);

  assert.deepEqual(
    buildRoverActionCue({
      id: 'call-tab',
      name: 'click_element',
      args: { element_id: 3, tab_id: 8 },
    }, undefined, { logicalTabId: 2 }),
    {
      kind: 'click',
      toolCallId: 'call-tab',
      primaryElementId: 3,
      elementIds: [3],
      logicalTabId: 8,
      valueRedacted: undefined,
    },
  );

  assert.equal(
    buildRoverActionCue({
      name: 'scroll_to_element',
      args: { element_id: 9 },
    }, 'call-fallback', { logicalTabId: 12 })?.logicalTabId,
    12,
  );
});

test('redacts typed values and sensitive fields from display args', () => {
  const result = sanitizeToolArgsForDisplay({
    element_id: 3,
    text: 'private typed value',
    metadata: { password: 'secret', visible: 'ok' },
  }, 'type');

  assert.equal(result.valueRedacted, true);
  assert.equal(result.args.element_id, 3);
  assert.match(String(result.args.text), /^\[REDACTED/);
  assert.equal(result.args.metadata.visible, 'ok');
  assert.equal(result.args.metadata.password, '[REDACTED 6 chars]');
});
