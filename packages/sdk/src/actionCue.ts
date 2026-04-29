import type { RoverActionCue, RoverActionCueKind, RoverMessageBlock } from '@rover/ui';
import {
  SYSTEM_TOOLS_ELEMENT_ID_KEYS,
  SystemToolNames,
  systemToolNamesSet,
} from '@rover/shared/lib/system-tools/tools.js';

export type ToolCallLike = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

export type BuildRoverActionCueOptions = {
  logicalTabId?: number;
};

const SENSITIVE_KEY_PATTERN = /(?:password|passcode|secret|token|api[_-]?key|authorization|cookie|session|credit|card|cvv|cvc|ssn|otp|mfa|email|phone)/i;
const VALUE_KEY_PATTERN = /^(?:text|value|input|content|typed_text|field_value|option_value|search_text|query)$/i;
const UPLOAD_VALUE_KEY_PATTERN = /^(?:file_url|url|file_name|filename|name|path|file_path|download_url|storage_url|gcs_uri)$/i;

type ActionCueElementKey =
  | 'element_id'
  | 'source_element_id'
  | 'target_element_id'
  | 'center_element_id'
  | 'element_ids';

type ActionCuePolicy = {
  kind: RoverActionCueKind;
  elementKeys?: readonly ActionCueElementKey[];
  emit?: boolean;
};

const ELEMENT_ID_KEY_SET = new Set<string>(SYSTEM_TOOLS_ELEMENT_ID_KEYS);
const PRIMARY_ELEMENT_KEY = ['element_id'] as const;
const DRAG_DROP_ELEMENT_KEYS = ['source_element_id', 'target_element_id'] as const;
const PINCH_ELEMENT_KEYS = ['center_element_id'] as const;
const NO_ELEMENT_KEYS = [] as const;

export const SYSTEM_TOOL_ACTION_CUE_POLICY: Readonly<Record<string, ActionCuePolicy>> = Object.freeze({
  [SystemToolNames.click_element]: { kind: 'click', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.type_into_element]: { kind: 'type', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.type_and_enter]: { kind: 'type', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.select_dropdown_value]: { kind: 'select', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.clear_element]: { kind: 'clear', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.focus_element]: { kind: 'focus', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.check_field_validity]: { kind: 'read', emit: false },
  [SystemToolNames.select_text]: { kind: 'select', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.hover_element]: { kind: 'hover', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.right_click_element]: { kind: 'click', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.double_click_element]: { kind: 'click', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.press_key]: { kind: 'press', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.mouse_wheel]: { kind: 'scroll', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.dispatch_pointer_path]: { kind: 'drag', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.drag_element]: { kind: 'drag', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.drag_and_drop]: { kind: 'drag', elementKeys: DRAG_DROP_ELEMENT_KEYS },
  [SystemToolNames.adjust_slider]: { kind: 'drag', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.scroll_page]: { kind: 'scroll', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.scroll_to_element]: { kind: 'scroll', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.swipe_element]: { kind: 'scroll', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.long_press_element]: { kind: 'click', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.pinch_zoom]: { kind: 'drag', elementKeys: PINCH_ELEMENT_KEYS },
  [SystemToolNames.go_back]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.go_forward]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.goto_url]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.refresh_page]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.open_new_tab]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.switch_tab]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.close_tab]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.describe_images]: { kind: 'read', emit: false },
  [SystemToolNames.google_search]: { kind: 'navigate', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.network_run_recipe]: { kind: 'read', emit: false },
  [SystemToolNames.rover_external_read_context]: { kind: 'read', emit: false },
  [SystemToolNames.rover_external_act_context]: { kind: 'read', emit: false },
  [SystemToolNames.copy_text]: { kind: 'copy', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.paste_text]: { kind: 'paste', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.wait_action]: { kind: 'wait', elementKeys: NO_ELEMENT_KEYS },
  [SystemToolNames.wait_for_element]: { kind: 'wait', emit: false },
  [SystemToolNames.answer_task]: { kind: 'unknown', emit: false },
  [SystemToolNames.upload_file]: { kind: 'upload', elementKeys: PRIMARY_ELEMENT_KEY },
  [SystemToolNames.solve_captcha]: { kind: 'unknown', emit: false },
  discover_and_extract_network_data: { kind: 'read', emit: false },
});

export function getMissingActionCuePolicySystemToolNames(): string[] {
  return [...systemToolNamesSet].filter(name => !Object.prototype.hasOwnProperty.call(SYSTEM_TOOL_ACTION_CUE_POLICY, name)).sort();
}

function positiveInteger(value: unknown): number | undefined {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function extractElementIdsFromToolArgs(args?: Record<string, unknown>): number[] {
  if (!args || typeof args !== 'object') return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const key of SYSTEM_TOOLS_ELEMENT_ID_KEYS) {
    const raw = (args as Record<string, unknown>)[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const id = positiveInteger(value);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function extractElementIdsFromToolArgsForKeys(
  args: Record<string, unknown> | undefined,
  keys: readonly ActionCueElementKey[],
): number[] {
  if (!args || typeof args !== 'object') return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const key of keys) {
    if (!ELEMENT_ID_KEY_SET.has(key)) continue;
    const raw = args[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const id = positiveInteger(value);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function extractLogicalTabIdFromToolArgs(args?: Record<string, unknown>): number | undefined {
  if (!args || typeof args !== 'object') return undefined;
  return positiveInteger(args.logical_tab_id)
    ?? positiveInteger(args.tab_id)
    ?? positiveInteger(args.logicalTabId)
    ?? positiveInteger(args.tabId);
}

export function classifyToolActionKind(toolName?: string): RoverActionCueKind {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name) return 'unknown';
  return SYSTEM_TOOL_ACTION_CUE_POLICY[name]?.kind || 'unknown';
}

function shouldRedactValue(key: string, kind: RoverActionCueKind): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  if ((kind === 'type' || kind === 'select' || kind === 'paste') && VALUE_KEY_PATTERN.test(key)) return true;
  if (kind === 'upload' && UPLOAD_VALUE_KEY_PATTERN.test(key)) return true;
  return false;
}

function redactValue(value: unknown): string {
  if (typeof value === 'string') {
    const length = [...value].length;
    return length > 0 ? `[REDACTED ${length} chars]` : '[REDACTED]';
  }
  return '[REDACTED]';
}

function sanitizeValueForDisplay(value: unknown, kind: RoverActionCueKind, key = '', depth = 0): { value: unknown; redacted: boolean } {
  if (depth > 5) return { value: '[Truncated]', redacted: false };
  if (shouldRedactValue(key, kind)) {
    return { value: redactValue(value), redacted: true };
  }
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.slice(0, 40).map(item => {
      const sanitized = sanitizeValueForDisplay(item, kind, key, depth + 1);
      redacted = redacted || sanitized.redacted;
      return sanitized.value;
    });
    if (value.length > 40) next.push(`[${value.length - 40} more items]`);
    return { value: next, redacted };
  }
  if (value && typeof value === 'object') {
    let redacted = false;
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      const sanitized = sanitizeValueForDisplay(childValue, kind, childKey, depth + 1);
      redacted = redacted || sanitized.redacted;
      next[childKey] = sanitized.value;
    }
    return { value: next, redacted };
  }
  return { value, redacted: false };
}

export function sanitizeToolArgsForDisplay(args: unknown, kind: RoverActionCueKind): { args: Record<string, unknown>; valueRedacted: boolean } {
  if (!args || typeof args !== 'object') return { args: {}, valueRedacted: false };
  const sanitized = sanitizeValueForDisplay(args, kind);
  return {
    args: sanitized.value && typeof sanitized.value === 'object' && !Array.isArray(sanitized.value)
      ? sanitized.value as Record<string, unknown>
      : {},
    valueRedacted: sanitized.redacted,
  };
}

export function buildRoverActionCue(
  call?: ToolCallLike,
  toolCallId?: string,
  options: BuildRoverActionCueOptions = {},
): RoverActionCue | undefined {
  if (!call || typeof call !== 'object') return undefined;
  const toolName = String(call.name || '').trim().toLowerCase();
  const policy = SYSTEM_TOOL_ACTION_CUE_POLICY[toolName];
  if (!policy || policy.emit === false) return undefined;
  const kind = policy.kind;
  const elementIds = extractElementIdsFromToolArgsForKeys(
    call.args,
    policy.elementKeys || NO_ELEMENT_KEYS,
  );
  const primaryElementId = elementIds[0];
  const logicalTabId = extractLogicalTabIdFromToolArgs(call.args) ?? positiveInteger(options.logicalTabId);
  const safeArgs = sanitizeToolArgsForDisplay(call.args, kind);
  return {
    kind,
    toolCallId: String(toolCallId || call.id || '').trim() || undefined,
    primaryElementId,
    elementIds: elementIds.length ? elementIds : undefined,
    logicalTabId,
    valueRedacted: safeArgs.valueRedacted || undefined,
  };
}

export function buildToolStartDetailBlocks(call?: ToolCallLike): RoverMessageBlock[] | undefined {
  if (!call?.args) return undefined;
  const kind = classifyToolActionKind(call.name);
  const safeArgs = sanitizeToolArgsForDisplay(call.args, kind);
  if (!Object.keys(safeArgs.args).length) return undefined;
  return [
    {
      type: 'json',
      label: `${call.name || 'tool'} args`,
      toolName: call.name,
      data: safeArgs.args,
    },
  ];
}
