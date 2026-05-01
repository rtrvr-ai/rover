const MAX_NARRATION_LENGTH = 180;
const MAX_NARRATION_WORDS = 18;

const SENSITIVE_VALUE_PATTERNS = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bapi[-_\s]?key\b/i,
  /\bauthorization\b/i,
  /\bcookie\b/i,
  /\bsession\b/i,
  /\bcredit\s*card\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bssn\b/i,
  /\botp\b/i,
  /\bmfa\b/i,
];

const RAW_VALUE_ARG_KEYS = new Set([
  'content',
  'download_url',
  'field_value',
  'file_name',
  'file_path',
  'file_url',
  'filename',
  'gcs_uri',
  'text',
  'input',
  'name',
  'option_value',
  'path',
  'password',
  'passcode',
  'query',
  'search_text',
  'storage_url',
  'token',
  'typed_text',
  'url',
  'value',
  'api_key',
  'apiKey',
]);

const SHORT_RAW_VALUE_ARG_KEYS = new Set([
  'download_url',
  'field_value',
  'file_name',
  'file_path',
  'file_url',
  'filename',
  'gcs_uri',
  'option_value',
  'path',
  'storage_url',
  'url',
]);

export type ToolUiHints = {
  narration?: string;
  highlight?: boolean;
};

export function sanitizeActionNarration(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  if (SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(normalized))) return undefined;

  const words = normalized.split(/\s+/).slice(0, MAX_NARRATION_WORDS);
  const clipped = words.join(' ').slice(0, MAX_NARRATION_LENGTH).trim();
  return clipped || undefined;
}

function narrationContainsRawArgValue(narration: string, args: Record<string, unknown>): boolean {
  const lowerNarration = narration.toLowerCase();
  for (const [key, value] of Object.entries(args)) {
    if (!RAW_VALUE_ARG_KEYS.has(key) || typeof value !== 'string') continue;
    const normalizedValue = value.replace(/\s+/g, ' ').trim();
    const minLength = SHORT_RAW_VALUE_ARG_KEYS.has(key) ? 1 : 3;
    if (normalizedValue.length < minLength) continue;
    if (lowerNarration.includes(normalizedValue.toLowerCase())) return true;
  }
  return false;
}

export function extractActionNarrationFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const ui = (args as Record<string, unknown>).ui;
  if (!ui || typeof ui !== 'object') return undefined;
  const narration = sanitizeActionNarration((ui as ToolUiHints).narration);
  if (!narration) return undefined;
  if (narrationContainsRawArgValue(narration, args as Record<string, unknown>)) return undefined;
  return narration;
}

export function extractActionHighlightFromArgs(args: unknown): boolean | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const ui = (args as Record<string, unknown>).ui;
  if (!ui || typeof ui !== 'object') return undefined;
  const highlight = (ui as ToolUiHints).highlight;
  if (typeof highlight !== 'boolean') return undefined;
  return highlight;
}

export function stripToolUiHintsFromArgs<T extends Record<string, any> | undefined>(args: T): T {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  if (!Object.prototype.hasOwnProperty.call(args, 'ui')) return args;
  const next = { ...args };
  delete next.ui;
  return next as T;
}
