import type {
  AgentIdentitySource,
  AgentIdentityTrust,
  LaunchSource,
  ResolvedAgentIdentity,
} from './types.js';

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

export function normalizeAgentTrust(value: unknown): AgentIdentityTrust | undefined {
  switch (asString(value)) {
    case 'verified':
    case 'verified_signed':
      return 'verified_signed';
    case 'signed_directory_only':
      return 'signed_directory_only';
    case 'self_reported':
      return 'self_reported';
    case 'heuristic':
      return 'heuristic';
    case 'anonymous':
      return 'anonymous';
    default:
      return undefined;
  }
}

export function normalizeAgentSource(value: unknown): AgentIdentitySource | undefined {
  switch (asString(value)) {
    case 'public_run_agent':
      return 'public_run_agent';
    case 'handoff_agent':
      return 'handoff_agent';
    case 'webmcp_agent':
      return 'webmcp_agent';
    case 'signature_agent':
      return 'signature_agent';
    case 'user_agent':
      return 'user_agent';
    case 'owner_resolver':
      return 'owner_resolver';
    case 'anonymous':
      return 'anonymous';
    default:
      return undefined;
  }
}

export function normalizeLaunchSource(value: unknown): LaunchSource | undefined {
  switch (asString(value)) {
    case 'public_run_api':
      return 'public_run_api';
    case 'delegated_handoff':
      return 'delegated_handoff';
    case 'webmcp':
      return 'webmcp';
    case 'embedded_widget':
      return 'embedded_widget';
    default:
      return undefined;
  }
}

export function buildAgentMemoryKey(identity: {
  key?: string;
  memoryKey?: string;
  vendor?: string;
  signatureAgent?: string;
  anonymous?: boolean;
}): string | undefined {
  const key = asString(identity.key);
  if (key) return key;
  const memoryKey = asString(identity.memoryKey);
  if (memoryKey) return memoryKey;
  const vendor = asString(identity.vendor) || asString(identity.signatureAgent);
  if (vendor) return `vendor:${slugify(vendor, 'agent')}`;
  if (identity.anonymous) return `anon:${createId('agent')}`;
  return undefined;
}

function fromIdentityLike(value: Record<string, unknown> | undefined): ResolvedAgentIdentity | null {
  if (!value) return null;
  const key =
    asString(value.agentKey)
    || asString(value.key)
    || asString(value.agentMemoryKey)
    || asString(value.memoryKey)
    || undefined;
  const name = asString(value.agentName) || asString(value.displayName) || asString(value.name);
  const vendor = asString(value.agentVendor) || asString(value.vendor);
  const model = asString(value.agentModel) || asString(value.model);
  const version = asString(value.agentVersion) || asString(value.version);
  const homepage = asString(value.agentHomepage) || asString(value.homepage);
  const trust = normalizeAgentTrust(value.agentTrust || value.trust);
  const source = normalizeAgentSource(value.agentSource || value.source);
  const memoryKey = asString(value.agentMemoryKey) || asString(value.memoryKey) || undefined;
  const clientId = asString(value.agentClientId) || asString(value.clientId);
  const signatureAgent = asString(value.agentSignatureAgent) || asString(value.signatureAgent);
  const userAgent = asString(value.agentUserAgent) || asString(value.userAgent);
  const launchSource = normalizeLaunchSource(value.launchSource);
  const anonymous = trust === 'anonymous' || source === 'anonymous' || Boolean(value.anonymous);
  const resolvedKey = key || memoryKey || (vendor ? `vendor:${slugify(vendor, 'agent')}` : undefined);
  if (!resolvedKey && !name && !vendor && !model) return null;
  return {
    key: resolvedKey || `anon:${createId('agent')}`,
    name: name || vendor || undefined,
    vendor,
    model,
    version,
    homepage,
    trust: trust || (anonymous ? 'anonymous' : undefined),
    source: source || (anonymous ? 'anonymous' : undefined),
    memoryKey: memoryKey || resolvedKey || undefined,
    clientId,
    signatureAgent,
    userAgent,
    launchSource,
    anonymous,
  };
}

export function resolveRuntimeAgentIdentity(state: any): ResolvedAgentIdentity | null {
  const activeTaskId = asString(state?.runtimeState?.activeTaskId);
  const activeTask =
    activeTaskId && state?.runtimeState?.tasks && typeof state.runtimeState.tasks === 'object'
      ? state.runtimeState.tasks[activeTaskId]
      : undefined;

  const candidates: Array<Record<string, unknown> | undefined> = [
    activeTask?.agentAttribution,
    state?.runtimeState?.currentAgentAttribution,
    state?.currentAgentAttribution,
    state?.agentAttribution,
    state?.sessionClaims,
  ];

  for (const candidate of candidates) {
    const resolved = fromIdentityLike(candidate);
    if (resolved) return resolved;
  }
  return null;
}
