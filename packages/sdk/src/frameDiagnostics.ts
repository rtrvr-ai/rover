import type { PageData } from '@rover/shared/lib/types/index.js';

const DEFAULT_EXTENSION_ROUTER_BASE = 'https://agent.rtrvr.ai';
const MAX_FRAME_DIAGNOSTIC_FRAMES = 50;
const MAX_FRAME_DIAGNOSTIC_BYTES = 64_000;
const MAX_LABEL_CHARS = 120;
const MAX_URL_CHARS = 300;

export type FrameDiagnosticsFrame = {
  hostElementId: number;
  label?: string;
  src?: string;
  origin?: string;
  hasFrameContent: boolean;
  childCount: number;
  capabilityCode?: number;
  unavailableCode?: number;
  reasonLabel?: string;
};

export type FrameDiagnosticsSummary = {
  version: 1;
  captureId: string;
  capturedAt: number;
  pageUrl?: string;
  title?: string;
  frameCount: number;
  frames: FrameDiagnosticsFrame[];
};

export type FrameDiagnosticsDebugRef = {
  kind: 'frame_diagnostics';
  diagnosticId?: string;
  storagePath?: string;
  contentHash?: string;
  expiresAt?: string;
};

const FRAME_UNAVAILABLE_LABELS: Record<number, string> = {
  0: 'Available',
  1: 'Cross-origin frame without a frame agent',
  2: 'Frame DOM is empty',
  3: 'Frame was not ready',
  4: 'Frame scan timed out',
  5: 'Frame sandbox blocked access',
  6: 'Frame adapter unavailable',
  7: 'Frame tree scan failed',
};

function createNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeBaseOrigin(apiBase?: string): string {
  const fallback = DEFAULT_EXTENSION_ROUTER_BASE;
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter/v2/rover')) return base.slice(0, -('/extensionRouter/v2/rover'.length));
  if (base.endsWith('/v2/rover')) return base.slice(0, -('/v2/rover'.length));
  return base;
}

function normalizeRoverV2Base(apiBase?: string): string {
  const raw = String(apiBase || '').trim().replace(/\/+$/, '');
  if (raw.endsWith('/v2/rover')) return raw;
  if (raw.endsWith('/extensionRouter/v2/rover')) return raw.replace('/extensionRouter/v2/rover', '/v2/rover');
  return `${normalizeBaseOrigin(apiBase)}/v2/rover`;
}

function normalizeScopePart(value: unknown, fallback: string): string {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, '_')
    .slice(0, 128) || fallback;
}

function normalizeText(input: unknown, maxChars: number): string | undefined {
  const value = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value ? value.slice(0, maxChars) : undefined;
}

function clampNumber(input: unknown): number | undefined {
  const value = Number(input);
  return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function frameUnavailableLabel(input: unknown): string | undefined {
  const code = clampNumber(input);
  if (code == null) return undefined;
  return FRAME_UNAVAILABLE_LABELS[code] || `Unavailable (${code})`;
}

export function sanitizeFrameDiagnosticsUrl(input: unknown, base?: string): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw, base || undefined);
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, MAX_URL_CHARS);
  } catch {
    const stripped = raw.split('#')[0].split('?')[0].trim();
    return stripped ? stripped.slice(0, MAX_URL_CHARS) : undefined;
  }
}

function extractOrigin(input: unknown, base?: string): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  try {
    return new URL(raw, base || undefined).origin.slice(0, MAX_URL_CHARS);
  } catch {
    return undefined;
  }
}

function isFrameNode(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.isFrameElement === true) return true;
  const tag = String(node.elementTag || node.elementName || '').trim().toLowerCase();
  return tag === 'iframe' || tag === 'frame';
}

function normalizeFrameContentIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids: number[] = [];
  for (const value of input) {
    const id = clampNumber(value);
    if (id == null) continue;
    ids.push(id);
  }
  return ids;
}

function resolveRealmEntry(pageData: PageData, realmId: number | undefined): Record<string, unknown> | undefined {
  if (realmId == null) return undefined;
  const realms = pageData.metadata?.frameRealms?.realms as Record<string, Record<string, unknown>> | undefined;
  return realms?.[String(realmId)] || realms?.[realmId as any];
}

function buildFrameEntry(pageData: PageData, rawId: string): FrameDiagnosticsFrame | undefined {
  const node = (pageData.nodes as Record<string, any> | undefined)?.[rawId];
  if (!isFrameNode(node)) return undefined;
  const hostElementId = clampNumber(rawId);
  if (hostElementId == null) return undefined;
  const tuple = Array.isArray(node.frameRealm) ? node.frameRealm : [];
  const realmId = clampNumber(tuple[0]);
  const capabilityCode = clampNumber(tuple[1]);
  const unavailableCode = clampNumber(tuple[2]);
  const realm = resolveRealmEntry(pageData, realmId);
  const rawUrl = realm?.url || node.resourceLocator;
  const src = sanitizeFrameDiagnosticsUrl(rawUrl, pageData.url);
  const origin = normalizeText(realm?.origin, MAX_URL_CHARS) || extractOrigin(rawUrl, pageData.url);
  const childIds = normalizeFrameContentIds(node.frameContent);
  const label = normalizeText(
    node.computedName || realm?.title || node.computedDescription,
    MAX_LABEL_CHARS,
  );
  return {
    hostElementId,
    ...(label ? { label } : {}),
    ...(src ? { src } : {}),
    ...(origin ? { origin } : {}),
    hasFrameContent: childIds.length > 0,
    childCount: childIds.length,
    ...(capabilityCode != null ? { capabilityCode } : {}),
    ...(unavailableCode != null ? { unavailableCode } : {}),
    ...(frameUnavailableLabel(unavailableCode) ? { reasonLabel: frameUnavailableLabel(unavailableCode) } : {}),
  };
}

export function buildFrameDiagnosticsSummary(
  pageData: PageData | undefined,
  options: { captureId?: string; now?: number } = {},
): FrameDiagnosticsSummary | undefined {
  if (!pageData?.nodes || typeof pageData.nodes !== 'object') return undefined;
  const frames: FrameDiagnosticsFrame[] = [];
  for (const rawId of Object.keys(pageData.nodes)) {
    const entry = buildFrameEntry(pageData, rawId);
    if (!entry) continue;
    frames.push(entry);
    if (frames.length >= MAX_FRAME_DIAGNOSTIC_FRAMES) break;
  }
  if (!frames.length) return undefined;
  const summary: FrameDiagnosticsSummary = {
    version: 1,
    captureId: normalizeScopePart(options.captureId, `frame-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`),
    capturedAt: Number(options.now || Date.now()),
    ...(sanitizeFrameDiagnosticsUrl(pageData.url) ? { pageUrl: sanitizeFrameDiagnosticsUrl(pageData.url) } : {}),
    ...(normalizeText(pageData.title, MAX_LABEL_CHARS) ? { title: normalizeText(pageData.title, MAX_LABEL_CHARS) } : {}),
    frameCount: frames.length,
    frames,
  };
  const bounded = enforceDiagnosticsBudget(summary);
  return bounded.frames.length ? bounded : undefined;
}

export function buildFrameDiagnosticsDedupeKey(summary: FrameDiagnosticsSummary): string {
  return JSON.stringify({
    pageUrl: summary.pageUrl,
    frames: summary.frames.map(frame => [
      frame.hostElementId,
      frame.src,
      frame.origin,
      frame.childCount,
      frame.capabilityCode,
      frame.unavailableCode,
    ]),
  });
}

export function enforceDiagnosticsBudget(summary: FrameDiagnosticsSummary): FrameDiagnosticsSummary {
  let next: FrameDiagnosticsSummary = {
    ...summary,
    frames: summary.frames.slice(0, MAX_FRAME_DIAGNOSTIC_FRAMES),
    frameCount: Math.min(summary.frameCount, MAX_FRAME_DIAGNOSTIC_FRAMES),
  };
  while (JSON.stringify(next).length > MAX_FRAME_DIAGNOSTIC_BYTES && next.frames.length > 0) {
    next = {
      ...next,
      frames: next.frames.slice(0, -1),
      frameCount: next.frames.length - 1,
    };
  }
  next.frameCount = next.frames.length;
  return next;
}

export class RoverFrameDiagnosticsClient {
  private readonly base: string;
  private readonly getSessionToken?: () => string | undefined;
  private readonly siteId: string;
  private readonly sessionId: string;

  constructor(options: {
    apiBase?: string;
    getSessionToken?: () => string | undefined;
    siteId: string;
    sessionId: string;
  }) {
    this.base = normalizeRoverV2Base(options.apiBase);
    this.getSessionToken = options.getSessionToken;
    this.siteId = options.siteId;
    this.sessionId = options.sessionId;
  }

  async upload(params: {
    diagnostics: FrameDiagnosticsSummary;
    runId?: string;
  }): Promise<FrameDiagnosticsDebugRef | undefined> {
    const token = this.getSessionToken?.();
    if (!token) return undefined;
    const response = await fetch(`${this.base}/debug/frame-diagnostics`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      credentials: 'omit',
      body: JSON.stringify({
        sessionToken: token,
        sessionId: this.sessionId,
        siteId: this.siteId,
        runId: params.runId,
        captureId: params.diagnostics.captureId,
        diagnostics: params.diagnostics,
        requestNonce: createNonce(),
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) {
      throw new Error(String(json?.error || json?.message || `frame diagnostics upload failed (${response.status})`));
    }
    return (json.data?.debugRef || json.debugRef) as FrameDiagnosticsDebugRef | undefined;
  }
}
