import type { RoverActionCue, RoverActionCueKind, RoverMessageBlock } from '@rover/ui';
import { SYSTEM_TOOLS_ELEMENT_ID_KEYS } from '@rover/shared/lib/system-tools/tools.js';

export type ToolCallLike = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERN = /(?:password|passcode|secret|token|api[_-]?key|authorization|cookie|session|credit|card|cvv|cvc|ssn|otp|mfa|email|phone)/i;
const VALUE_KEY_PATTERN = /^(?:text|value|input|content|typed_text|field_value|option_value|search_text|query)$/i;

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

export function classifyToolActionKind(toolName?: string): RoverActionCueKind {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name) return 'unknown';
  if (/double_click|right_click|click|tap|long_press/.test(name)) return 'click';
  if (/type|fill|set_value|input|paste/.test(name)) return 'type';
  if (/select_dropdown|select_text|select/.test(name)) return 'select';
  if (/clear/.test(name)) return 'clear';
  if (/focus/.test(name)) return 'focus';
  if (/hover/.test(name)) return 'hover';
  if (/press_key|press/.test(name)) return 'press';
  if (/scroll|wheel|swipe/.test(name)) return 'scroll';
  if (/drag|drop|pointer_path|slider|pinch/.test(name)) return 'drag';
  if (/goto|navigate|open_new_tab|switch_tab|go_back|go_forward|refresh|url/.test(name)) return 'navigate';
  if (/read|describe|get|extract|scrape|search|context|screenshot|snapshot/.test(name)) return 'read';
  if (/wait|monitor|observe/.test(name)) return 'wait';
  return 'unknown';
}

function shouldRedactValue(key: string, kind: RoverActionCueKind): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  if ((kind === 'type' || kind === 'select') && VALUE_KEY_PATTERN.test(key)) return true;
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

export function buildRoverActionCue(call?: ToolCallLike, toolCallId?: string): RoverActionCue | undefined {
  if (!call || typeof call !== 'object') return undefined;
  const kind = classifyToolActionKind(call.name);
  const elementIds = extractElementIdsFromToolArgs(call.args);
  const primaryElementId = elementIds[0];
  const safeArgs = sanitizeToolArgsForDisplay(call.args, kind);
  return {
    kind,
    toolCallId: String(toolCallId || call.id || '').trim() || undefined,
    primaryElementId,
    elementIds: elementIds.length ? elementIds : undefined,
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
