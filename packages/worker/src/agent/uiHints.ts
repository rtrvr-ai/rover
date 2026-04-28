const MAX_NARRATION_LENGTH = 180;
const MAX_NARRATION_WORDS = 18;

const SENSITIVE_VALUE_PATTERNS = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bapi[-_\s]?key\b/i,
  /\bcredit\s*card\b/i,
  /\bcvv\b/i,
  /\bssn\b/i,
];

const RAW_VALUE_ARG_KEYS = new Set([
  'text',
  'value',
  'query',
  'password',
  'passcode',
  'token',
  'api_key',
  'apiKey',
]);

export type ToolUiHints = {
  narration?: string;
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
    if (normalizedValue.length < 3) continue;
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

export function stripToolUiHintsFromArgs<T extends Record<string, any> | undefined>(args: T): T {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  if (!Object.prototype.hasOwnProperty.call(args, 'ui')) return args;
  const next = { ...args };
  delete next.ui;
  return next as T;
}
