import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildToolStartDetailBlocks,
  buildRoverActionCue,
  classifyToolActionKind,
  extractElementIdsFromToolArgs,
  extractLogicalTabIdFromToolArgs,
  getMissingActionCuePolicySystemToolNames,
  sanitizeToolArgsForDisplay,
  SYSTEM_TOOL_ACTION_CUE_POLICY,
} from '../dist/actionCue.js';
import { SystemToolNames } from '@rover/shared/lib/system-tools/tools.js';

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
  assert.equal(classifyToolActionKind('copy_text'), 'copy');
  assert.equal(classifyToolActionKind('paste_text'), 'paste');
  assert.equal(classifyToolActionKind('upload_file'), 'upload');
  assert.equal(classifyToolActionKind('my_custom_click_tool'), 'unknown');
});

test('has explicit action cue policy coverage for every Rover system tool', () => {
  assert.deepEqual(getMissingActionCuePolicySystemToolNames(), []);
  assert.equal(SYSTEM_TOOL_ACTION_CUE_POLICY.discover_and_extract_network_data.emit, false);
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

test('skips read-only and internal element-bearing tools for spotlight cues', () => {
  assert.equal(
    buildRoverActionCue({
      name: SystemToolNames.describe_images,
      args: { element_ids: [3, 4], element_id: 5 },
    }),
    undefined,
  );
  assert.equal(
    buildRoverActionCue({
      name: SystemToolNames.check_field_validity,
      args: { element_id: 7 },
    }),
    undefined,
  );
  assert.equal(
    buildRoverActionCue({
      name: 'discover_and_extract_network_data',
      args: { element_id: 9 },
    }),
    undefined,
  );
});

test('only optional-target tools spotlight when their element target is present', () => {
  assert.deepEqual(
    buildRoverActionCue({
      id: 'scroll-page',
      name: SystemToolNames.scroll_page,
      args: { tab_id: 1, direction: 'DOWN' },
    }),
    {
      kind: 'scroll',
      toolCallId: 'scroll-page',
      primaryElementId: undefined,
      elementIds: undefined,
      logicalTabId: 1,
      valueRedacted: undefined,
    },
  );
  assert.deepEqual(
    buildRoverActionCue({
      id: 'scroll-container',
      name: SystemToolNames.scroll_page,
      args: { tab_id: 1, element_id: 12, direction: 'DOWN' },
    })?.elementIds,
    [12],
  );
  assert.equal(
    buildRoverActionCue({
      name: SystemToolNames.pinch_zoom,
      args: { tab_id: 1, element_id: 3, scale: 1.25 },
    })?.primaryElementId,
    undefined,
  );
  assert.equal(
    buildRoverActionCue({
      name: SystemToolNames.pinch_zoom,
      args: { tab_id: 1, center_element_id: 6, scale: 1.25 },
    })?.primaryElementId,
    6,
  );
  assert.equal(
    buildRoverActionCue({
      name: SystemToolNames.press_key,
      args: { tab_id: 1, key: 'Enter' },
    })?.primaryElementId,
    undefined,
  );
});

test('navigation and final tools do not produce element highlights', () => {
  for (const name of [
    SystemToolNames.goto_url,
    SystemToolNames.open_new_tab,
    SystemToolNames.switch_tab,
    SystemToolNames.wait_action,
  ]) {
    const cue = buildRoverActionCue({ name, args: { tab_id: 1, element_id: 99, url: 'https://example.com' } });
    assert.equal(cue?.primaryElementId, undefined, `${name} should not choose a primary element`);
    assert.equal(cue?.elementIds, undefined, `${name} should not expose element ids`);
  }
  assert.equal(
    buildRoverActionCue({ name: SystemToolNames.answer_task, args: { tab_id: 1, element_id: 99 } }),
    undefined,
  );
});

test('copy paste and upload cues use exact kinds and redact private args', () => {
  assert.deepEqual(
    buildRoverActionCue({
      id: 'copy-call',
      name: SystemToolNames.copy_text,
      args: { tab_id: 1, element_id: 4 },
    }),
    {
      kind: 'copy',
      toolCallId: 'copy-call',
      primaryElementId: 4,
      elementIds: [4],
      logicalTabId: 1,
      valueRedacted: undefined,
    },
  );

  const pasteCue = buildRoverActionCue({
    name: SystemToolNames.paste_text,
    args: { tab_id: 1, element_id: 5, text: 'secret paste' },
  });
  assert.equal(pasteCue?.kind, 'paste');
  assert.equal(pasteCue?.valueRedacted, true);

  const uploadBlocks = buildToolStartDetailBlocks({
    name: SystemToolNames.upload_file,
    args: {
      tab_id: 1,
      element_id: 6,
      file_url: 'https://files.example/private.pdf',
      file_name: 'private.pdf',
      file_index: 0,
    },
  });
  const uploadArgs = uploadBlocks?.[0]?.data;
  assert.match(String(uploadArgs?.file_url), /^\[REDACTED/);
  assert.match(String(uploadArgs?.file_name), /^\[REDACTED/);
  assert.equal(uploadArgs?.file_index, 0);
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
