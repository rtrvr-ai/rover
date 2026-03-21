export function createId(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cloneJson<T>(value: T): T {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = asString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function slugify(value: string, fallback = 'item'): string {
  const trimmed = asString(value);
  if (!trimmed) return fallback;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function truncate(value: string | undefined, max = 280): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}\u2026`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function summarizeValue(value: unknown, maxLength = 280): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return truncate(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return truncate(JSON.stringify(value), maxLength);
  } catch {
    return undefined;
  }
}

export function inferTarget(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  return asString(record.selector)
    || asString(record.url)
    || asString(record.href)
    || asString(record.target)
    || asString(record.element)
    || asString(record.text);
}

export function defaultPageUrl(): string {
  return typeof window !== 'undefined' ? window.location.href : '';
}

export function defaultHost(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '';
}

export function hashQuestion(question: string): string {
  return `question_${slugify(question, 'question')}`;
}

export function pushLimited<T>(items: T[], item: T, max: number): void {
  items.push(item);
  if (items.length > max) {
    items.splice(0, items.length - max);
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

