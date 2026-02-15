import { Bridge } from '@rover/bridge';
import { bindRpc } from '@rover/bridge';
import { mountWidget, type RoverExecutionMode, type RoverTimelineEvent, type RoverUi } from '@rover/ui';
import {
  SessionCoordinator,
  type SharedSessionState,
  type SharedTaskState,
  type SharedTimelineEvent,
  type SharedUiMessage,
  type SharedWorkerContext,
} from './sessionCoordinator.js';
import {
  RoverCloudCheckpointClient,
  type RoverCloudCheckpointPayload,
  type RoverCloudCheckpointState,
} from './cloudCheckpoint.js';
import { createRuntimeStateStore, type RuntimeStateStore } from './runtimeStorage.js';
import type {
  PersistedPendingRun,
  PersistedRuntimeState,
  PersistedTaskState,
  PersistedTimelineEvent,
  PersistedUiMessage,
  PersistedWorkerState,
  UiRole,
} from './runtimeTypes.js';

export type RoverWebToolsConfig = {
  enableExternalWebContext?: boolean;
  allowDomains?: string[];
  denyDomains?: string[];
  scrapeMode?: 'off' | 'on_demand';
};

export type RoverTelemetryConfig = {
  enabled?: boolean;
  sampleRate?: number;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  includePayloads?: boolean;
};

export type RoverInit = {
  siteId: string;
  apiBase?: string;
  apiKey?: string;
  siteKeyId?: string;
  authToken?: string;
  auth?: {
    enableSessionJwt?: boolean;
    sessionJwtEndpoint?: string;
    refreshSkewSec?: number;
  };
  visitorId?: string;
  sessionId?: string;
  sessionScope?: 'shared_site' | 'tab';
  workerUrl?: string;
  mode?: 'safe' | 'full';
  openOnInit?: boolean;
  allowActions?: boolean;
  allowedDomains?: string[];
  domainScopeMode?: 'host_only' | 'registrable_domain';
  externalNavigationPolicy?: 'open_new_tab_notice' | 'block' | 'allow';
  tabPolicy?: {
    observerByDefault?: boolean;
    actionLeaseMs?: number;
  };
  taskRouting?: {
    mode?: 'auto' | 'act' | 'planner';
    actHeuristicThreshold?: number;
    plannerOnActError?: boolean;
  };
  taskContext?: {
    inactivityMs?: number;
    suggestReset?: boolean;
    semanticSimilarityThreshold?: number;
    resetMode?: 'auto' | 'ask' | 'off';
  };
  checkpointing?: {
    enabled?: boolean;
    autoVisitorId?: boolean;
    flushIntervalMs?: number;
    pullIntervalMs?: number;
    minFlushIntervalMs?: number;
    ttlHours?: number;
    onStateChange?: (payload: {
      state: RoverCloudCheckpointState;
      reason?: string;
      action?: 'roverSessionCheckpointUpsert' | 'roverSessionCheckpointGet';
      code?: string;
      message?: string;
    }) => void;
    onError?: (payload: {
      action: 'roverSessionCheckpointUpsert' | 'roverSessionCheckpointGet';
      state: RoverCloudCheckpointState;
      code?: string;
      message: string;
      status?: number;
      paused: boolean;
    }) => void;
  };
  telemetry?: RoverTelemetryConfig;
  apiMode?: boolean;
  apiToolsConfig?: {
    mode?: 'allowlist' | 'profile' | 'none';
    enableAdditionalTools?: string[];
    userDefined?: string[];
  };
  ui?: {
    agent?: {
      name?: string;
    };
    mascot?: {
      disabled?: boolean;
      mp4Url?: string;
      webmUrl?: string;
    };
    muted?: boolean;
    thoughtStyle?: 'concise_cards' | 'minimal';
    panel?: {
      resizable?: boolean;
    };
    showTaskControls?: boolean;
  };
  tools?: {
    client?: ClientToolDefinition[];
    web?: RoverWebToolsConfig;
  };
};

export type ClientToolDefinition = {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  required?: string[];
  schema?: any;
  llmCallable?: boolean;
};

export type RoverEventName =
  | 'ready'
  | 'updated'
  | 'status'
  | 'tool_start'
  | 'tool_result'
  | 'error'
  | 'auth_required'
  | 'navigation_guardrail'
  | 'mode_change'
  | 'task_started'
  | 'task_ended'
  | 'task_suggested_reset'
  | 'context_restored'
  | 'checkpoint_state'
  | 'checkpoint_error'
  | 'open'
  | 'close';

export type RoverEventHandler = (payload?: any) => void;

export type RoverInstance = {
  boot: (cfg: RoverInit) => RoverInstance;
  init: (cfg: RoverInit) => RoverInstance;
  update: (cfg: Partial<RoverInit>) => void;
  shutdown: () => void;
  open: () => void;
  close: () => void;
  show: () => void;
  hide: () => void;
  send: (text: string) => void;
  newTask: (options?: { reason?: string; clearUi?: boolean }) => void;
  endTask: (options?: { reason?: string }) => void;
  getState: () => any;
  registerTool: (
    nameOrDef: string | ClientToolDefinition,
    handler: (args: any) => any | Promise<any>,
  ) => void;
  on: (event: RoverEventName, handler: RoverEventHandler) => () => void;
};

type ToolRegistration = {
  def: ClientToolDefinition;
  handler: (args: any) => any | Promise<any>;
};

const RUNTIME_STATE_VERSION = 1;
const RUNTIME_STATE_PREFIX = 'rover:runtime:';
const RUNTIME_ID_PREFIX = 'rover:runtime-id:';
const VISITOR_ID_PREFIX = 'rover:visitor-id:';
const MAX_UI_MESSAGES = 160;
const MAX_TIMELINE_EVENTS = 240;
const MAX_WORKER_HISTORY = 80;
const MAX_WORKER_STEPS = 40;
const MAX_TEXT_LEN = 8_000;
const MAX_AUTO_RESUME_AGE_MS = 15 * 60_000;
const MAX_AUTO_RESUME_ATTEMPTS = 12;
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const CHECKPOINT_PAYLOAD_VERSION = 1;
const ACTIVE_PENDING_RUN_GRACE_MS = 3_000;
const STALE_PENDING_RUN_MS = 90_000;
const TELEMETRY_DEFAULT_FLUSH_INTERVAL_MS = 12_000;
const TELEMETRY_DEFAULT_MAX_BATCH_SIZE = 30;
const TELEMETRY_MAX_BUFFER_SIZE = 240;

type TelemetryEventRecord = {
  name: RoverEventName;
  ts: number;
  seq: number;
  payload?: unknown;
};

let instance: RoverInstance | null = null;
let bridge: Bridge | null = null;
let worker: Worker | null = null;
let ui: RoverUi | null = null;
let currentConfig: RoverInit | null = null;
let runtimeStorageKey: string | null = null;
let runtimeState: PersistedRuntimeState | null = null;
let runtimeStateStore: RuntimeStateStore<PersistedRuntimeState> | null = null;
let runtimeId: string = '';
let sessionCoordinator: SessionCoordinator | null = null;
let cloudCheckpointClient: RoverCloudCheckpointClient | null = null;
let telemetryFlushTimer: ReturnType<typeof setInterval> | null = null;
let telemetryBuffer: TelemetryEventRecord[] = [];
let telemetryInFlight = false;
let telemetryPausedAuth = false;
let telemetrySeq = 0;
let resolvedVisitorId: string | undefined = undefined;
let suppressCheckpointSync = false;
let currentMode: RoverExecutionMode = 'controller';
let workerReady = false;
let autoResumeAttempted = false;
let runSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let unloadHandlerInstalled = false;
let pendingTaskSuggestion: { text: string; reason: string; createdAt: number } | null = null;
let lastStatusSignature = '';
let lastUserInputText: string | undefined;
const latestAssistantByRunId = new Map<string, string>();
const RUN_SCOPED_WORKER_MESSAGE_TYPES = new Set([
  'run_started',
  'run_completed',
  'assistant',
  'status',
  'tool_start',
  'tool_result',
  'auth_required',
  'navigation_guardrail',
  'error',
]);

const pendingToolRegistrations: ToolRegistration[] = [];
const eventHandlers = new Map<RoverEventName, Set<RoverEventHandler>>();

function emit(event: RoverEventName, payload?: any): void {
  recordTelemetryEvent(event, payload);
  const handlers = eventHandlers.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch {
      // no-op
    }
  }
}

function on(event: RoverEventName, handler: RoverEventHandler): () => void {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, new Set());
  }
  const handlers = eventHandlers.get(event)!;
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

function toToolDef(nameOrDef: string | ClientToolDefinition): ClientToolDefinition {
  return typeof nameOrDef === 'string' ? { name: nameOrDef } : nameOrDef;
}

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}

function getOrCreateRuntimeId(siteId: string): string {
  const key = `${RUNTIME_ID_PREFIX}${siteId}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && existing.trim()) return existing.trim();
    const next = createId('runtime');
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return createId('runtime');
  }
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeVisitorId(input: string): string {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 180);
}

function readCookie(name: string): string | undefined {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (!match) return undefined;
    return decodeURIComponent(match[1] || '');
  } catch {
    return undefined;
  }
}

function writeCookie(name: string, value: string, domain?: string): boolean {
  try {
    const domainPart = domain ? `; domain=${domain}` : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; samesite=lax${domainPart}`;
    return readCookie(name) === value;
  } catch {
    return false;
  }
}

// Returns candidate cookie domains from broadest to narrowest (e.g., .example.com before .sub.example.com).
// Note: Browsers may reject cookies for certain public suffix domains (e.g., .co.uk).
// This is a browser cookie policy limitation — subdomain fragmentation may still occur
// when the browser rejects the broadest domain and falls back to a narrower one.
function candidateCookieDomains(hostname: string): string[] {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return [];
  }

  const segments = host.split('.').filter(Boolean);
  if (segments.length < 2) return [];

  const out: string[] = [];
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    out.push(`.${segments.slice(i).join('.')}`);
  }
  return out;
}

function persistVisitorIdCookie(siteId: string, visitorId: string): void {
  const cookieName = `rover_vid_${stableHash(siteId)}`;

  for (const domain of candidateCookieDomains(window.location.hostname)) {
    if (writeCookie(cookieName, visitorId, domain)) {
      return;
    }
  }

  // Fallback to host-only cookie.
  writeCookie(cookieName, visitorId);
}

/**
 * Persist visitor ID to all available storage mechanisms (localStorage, sessionStorage, cookie).
 * This ensures the ID is recoverable from any fallback path.
 */
function syncVisitorIdToAllStores(siteId: string, visitorId: string): void {
  const key = `${VISITOR_ID_PREFIX}${siteId}`;
  try { window.localStorage.setItem(key, visitorId); } catch { /* ignore */ }
  try { window.sessionStorage.setItem(key, visitorId); } catch { /* ignore */ }
  persistVisitorIdCookie(siteId, visitorId);
}

function resolveVisitorId(cfg: RoverInit): string | undefined {
  const explicit = sanitizeVisitorId(cfg.visitorId || '');
  if (explicit) return explicit;
  if (cfg.checkpointing?.autoVisitorId === false) return undefined;

  const localStorageKey = `${VISITOR_ID_PREFIX}${cfg.siteId}`;
  const cookieName = `rover_vid_${stableHash(cfg.siteId)}`;

  // Try cookie first
  const cookieValue = sanitizeVisitorId(readCookie(cookieName) || '');
  if (cookieValue) {
    syncVisitorIdToAllStores(cfg.siteId, cookieValue);
    return cookieValue;
  }

  // Try localStorage
  try {
    const stored = sanitizeVisitorId(window.localStorage.getItem(localStorageKey) || '');
    if (stored) {
      syncVisitorIdToAllStores(cfg.siteId, stored);
      return stored;
    }
  } catch {
    // ignore local storage failures
  }

  // sessionStorage fallback (incognito / localStorage blocked)
  try {
    const sessionValue = sanitizeVisitorId(window.sessionStorage.getItem(localStorageKey) || '');
    if (sessionValue) {
      syncVisitorIdToAllStores(cfg.siteId, sessionValue);
      return sessionValue;
    }
  } catch {
    // ignore
  }

  // Generate new visitor ID and persist to all stores
  const generated = `v_${stableHash(`${cfg.siteId}:${createId('visitor')}`)}_${Date.now().toString(36)}`;
  syncVisitorIdToAllStores(cfg.siteId, generated);
  return generated;
}

function createVisitorSessionId(siteId: string, visitorId: string): string {
  const digest = stableHash(`${siteId}:${visitorId}`);
  return `visitor-${digest}`;
}

function applyToolRegistration(registration: ToolRegistration): void {
  if (!bridge || !worker) return;
  bridge.registerTool(registration.def, registration.handler);
  worker.postMessage({ type: 'register_tool', tool: registration.def });
}

function getRuntimeStateKey(siteId: string): string {
  return `${RUNTIME_STATE_PREFIX}${siteId}`;
}

function createDefaultTaskState(reason = 'session_start'): PersistedTaskState {
  const startedAt = Date.now();
  return {
    taskId: createId('task'),
    status: 'running',
    startedAt,
    lastUserAt: undefined,
    lastAssistantAt: undefined,
    boundaryReason: reason,
    endedAt: undefined,
  };
}

function createDefaultRuntimeState(sessionId: string, rid: string): PersistedRuntimeState {
  return {
    version: RUNTIME_STATE_VERSION,
    sessionId,
    runtimeId: rid,
    uiOpen: false,
    uiHidden: false,
    uiStatus: undefined,
    uiMessages: [],
    timeline: [],
    executionMode: 'controller',
    workerState: undefined,
    pendingRun: undefined,
    taskEpoch: 1,
    activeTask: createDefaultTaskState(),
    lastRoutingDecision: undefined,
    updatedAt: Date.now(),
  };
}

function truncateText(value: string, max = MAX_TEXT_LEN): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function safeSerialize(value: any): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return truncateText(value, 1200);
  try {
    return truncateText(JSON.stringify(value), 1200);
  } catch {
    try {
      return truncateText(String(value), 1200);
    } catch {
      return undefined;
    }
  }
}

function normalizeTelemetryConfig(cfg: RoverInit | null): {
  enabled: boolean;
  sampleRate: number;
  flushIntervalMs: number;
  maxBatchSize: number;
  includePayloads: boolean;
} {
  const raw = cfg?.telemetry;
  const sampleRateRaw = Number(raw?.sampleRate);
  const sampleRate = Number.isFinite(sampleRateRaw) ? Math.min(1, Math.max(0, sampleRateRaw)) : 1;

  const flushRaw = Number(raw?.flushIntervalMs);
  const flushIntervalMs = Number.isFinite(flushRaw)
    ? Math.min(60_000, Math.max(2_000, Math.floor(flushRaw)))
    : TELEMETRY_DEFAULT_FLUSH_INTERVAL_MS;

  const batchRaw = Number(raw?.maxBatchSize);
  const maxBatchSize = Number.isFinite(batchRaw)
    ? Math.min(80, Math.max(1, Math.floor(batchRaw)))
    : TELEMETRY_DEFAULT_MAX_BATCH_SIZE;

  return {
    enabled: raw?.enabled !== false,
    sampleRate,
    flushIntervalMs,
    maxBatchSize,
    includePayloads: raw?.includePayloads === true,
  };
}

function canUseTelemetry(cfg: RoverInit | null): boolean {
  if (!cfg) return false;
  const telemetry = normalizeTelemetryConfig(cfg);
  if (!telemetry.enabled) return false;
  if (!(cfg.authToken || cfg.apiKey)) return false;
  return true;
}

function summarizeTelemetryPayload(payload: any): unknown {
  if (payload == null) return undefined;
  if (typeof payload === 'string') return truncateText(payload, 260);
  if (typeof payload === 'number' || typeof payload === 'boolean') return payload;
  if (Array.isArray(payload)) {
    return { type: 'array', length: payload.length };
  }
  if (typeof payload === 'object') {
    const keys = Object.keys(payload).slice(0, 20);
    const summary: Record<string, unknown> = { type: 'object', keys };
    const preferredKeys = ['code', 'message', 'stage', 'status', 'reason', 'taskId', 'runId', 'policyAction'];
    for (const key of preferredKeys) {
      const value = payload?.[key];
      if (value == null) continue;
      if (typeof value === 'string') summary[key] = truncateText(value, 180);
      else if (typeof value === 'number' || typeof value === 'boolean') summary[key] = value;
    }
    return summary;
  }
  return undefined;
}

function buildTelemetryPayload(payload: any, includePayloads: boolean): unknown {
  if (!includePayloads) {
    return summarizeTelemetryPayload(payload);
  }
  const cloned = cloneUnknown(payload);
  if (cloned == null) return undefined;
  if (typeof cloned === 'string') return truncateText(cloned, 1_000);
  if (typeof cloned === 'number' || typeof cloned === 'boolean') return cloned;
  if (Array.isArray(cloned)) return { type: 'array', length: cloned.length };
  if (typeof cloned === 'object') return cloned;
  return summarizeTelemetryPayload(payload);
}

function stopTelemetry(): void {
  if (telemetryFlushTimer) {
    clearInterval(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
}

function getTelemetryEndpoint(cfg: RoverInit): string {
  const base = (cfg.apiBase || 'https://us-central1-rtrvr-extension-functions.cloudfunctions.net').replace(/\/$/, '');
  return base.endsWith('/extensionRouter') ? base : `${base}/extensionRouter`;
}

async function flushTelemetry(force = false): Promise<void> {
  if (telemetryInFlight) return;
  if (telemetryPausedAuth) return;
  if (!currentConfig || !canUseTelemetry(currentConfig)) {
    telemetryBuffer = [];
    return;
  }
  if (!telemetryBuffer.length) return;

  const telemetry = normalizeTelemetryConfig(currentConfig);
  const token = String(currentConfig.authToken || currentConfig.apiKey || '').trim();
  if (!token) return;

  const batch = telemetryBuffer.splice(0, telemetry.maxBatchSize);
  if (!batch.length) return;

  telemetryInFlight = true;
  try {
    const response = await fetch(getTelemetryEndpoint(currentConfig), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'roverTelemetryIngest',
        data: {
          siteId: currentConfig.siteId,
          runtimeId,
          sessionId: runtimeState?.sessionId,
          visitorId: resolvedVisitorId,
          flushReason: force ? 'manual' : 'interval',
          sdkVersion: 'rover_sdk_v1',
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
          sampleRate: telemetry.sampleRate,
          events: batch,
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        telemetryPausedAuth = true;
      } else {
        telemetryBuffer = [...batch, ...telemetryBuffer].slice(-TELEMETRY_MAX_BUFFER_SIZE);
      }
      return;
    }

    const payload = await response.json().catch(() => undefined);
    if (payload?.success === false) {
      const code = String(payload?.errorCode || payload?.errorDetails?.code || '').toUpperCase();
      if (code === 'INVALID_API_KEY' || code === 'MISSING_API_KEY' || code === 'UNAUTHENTICATED' || code === 'PERMISSION_DENIED') {
        telemetryPausedAuth = true;
      }
      return;
    }
  } catch {
    telemetryBuffer = [...batch, ...telemetryBuffer].slice(-TELEMETRY_MAX_BUFFER_SIZE);
  } finally {
    telemetryInFlight = false;
  }
}

function setupTelemetry(cfg: RoverInit): void {
  stopTelemetry();
  telemetryPausedAuth = false;
  if (!canUseTelemetry(cfg)) {
    telemetryBuffer = [];
    return;
  }
  const telemetry = normalizeTelemetryConfig(cfg);
  telemetryFlushTimer = setInterval(() => {
    void flushTelemetry(false);
  }, telemetry.flushIntervalMs);
}

function recordTelemetryEvent(event: RoverEventName, payload?: any): void {
  if (!canUseTelemetry(currentConfig) || telemetryPausedAuth) return;
  const telemetry = normalizeTelemetryConfig(currentConfig);
  if (telemetry.sampleRate < 1 && Math.random() > telemetry.sampleRate) return;

  const next: TelemetryEventRecord = {
    name: event,
    ts: Date.now(),
    seq: ++telemetrySeq,
    payload: buildTelemetryPayload(payload, telemetry.includePayloads),
  };
  telemetryBuffer.push(next);
  if (telemetryBuffer.length > TELEMETRY_MAX_BUFFER_SIZE) {
    telemetryBuffer = telemetryBuffer.slice(-TELEMETRY_MAX_BUFFER_SIZE);
  }
  if (telemetryBuffer.length >= telemetry.maxBatchSize) {
    void flushTelemetry(false);
  }
}

function buildInaccessibleTabPageData(
  _cfg: RoverInit,
  tab?: { logicalTabId?: number; url?: string; title?: string; external?: boolean },
  reason = 'tab_not_accessible',
): Record<string, any> {
  const logicalTabId = Number(tab?.logicalTabId) || undefined;
  const url = tab?.url || '';
  const title = tab?.title || (tab?.external ? 'External Tab (Inaccessible)' : 'Inactive Tab');
  const normalizedReason = String(reason || '').trim();
  const reasonLine = normalizedReason ? ` Reason: ${normalizedReason}.` : '';
  const content = tab?.external
    ? `This external tab is tracked in virtual mode only. Live DOM control and accessibility-tree access are unavailable here.${reasonLine}`
    : `This tab is currently not attached to an active Rover runtime. Switch to a live tab or reopen it.${reasonLine}`;

  return {
    url,
    title,
    contentType: 'text/html',
    content,
    metadata: {
      inaccessible: true,
      external: !!tab?.external,
      accessMode: tab?.external ? 'external_placeholder' : 'inactive_tab',
      reason,
      logicalTabId,
    },
  };
}

function buildTabAccessToolError(
  cfg: RoverInit,
  tab?: { logicalTabId?: number; url?: string; external?: boolean },
  reason = 'tab_not_accessible',
): Record<string, any> {
  const logicalTabId = Number(tab?.logicalTabId) || 0;
  const blockedUrl = tab?.url || '';
  const message = tab?.external
    ? `Tab ${logicalTabId} is external to the active runtime and cannot be controlled directly.`
    : `Tab ${logicalTabId} is not attached to an active Rover runtime.`;
  const code = tab?.external ? 'DOMAIN_SCOPE_BLOCKED' : 'TAB_NOT_ACCESSIBLE';

  return {
    success: false,
    error: message,
    allowFallback: true,
    output: {
      success: false,
      error: {
        code,
        message,
        missing: [],
        next_action: tab?.external
          ? 'Use open_new_tab for external context or continue on an in-scope tab.'
          : 'Switch to an active tab and retry.',
        retryable: false,
      },
      blocked_url: blockedUrl || undefined,
      logical_tab_id: logicalTabId || undefined,
      external: !!tab?.external,
      policy_action: tab?.external ? cfg.externalNavigationPolicy || 'open_new_tab_notice' : undefined,
      reason,
    },
    errorDetails: {
      code,
      message,
      retryable: false,
      details: {
        logicalTabId,
        blockedUrl,
        external: !!tab?.external,
        reason,
      },
    },
  };
}

type WorkerStatusStage = 'analyze' | 'route' | 'execute' | 'verify' | 'complete';

function normalizeStatusStage(input: unknown): WorkerStatusStage | undefined {
  if (
    input === 'analyze' ||
    input === 'route' ||
    input === 'execute' ||
    input === 'verify' ||
    input === 'complete'
  ) {
    return input;
  }
  return undefined;
}

function formatStageLabel(stage?: WorkerStatusStage): string {
  if (!stage) return 'Status';
  if (stage === 'analyze') return 'Analyze';
  if (stage === 'route') return 'Route';
  if (stage === 'execute') return 'Execute';
  if (stage === 'verify') return 'Verify';
  if (stage === 'complete') return 'Complete';
  return 'Status';
}

function buildStatusSignature(message?: string, stage?: WorkerStatusStage, compactThought?: string): string {
  return [
    String(stage || ''),
    String(message || '').trim().toLowerCase(),
    String(compactThought || '').trim().toLowerCase(),
  ].join('|');
}

function isInternalThought(text: string, lastUserInput?: string): boolean {
  if (!text) return true;
  const t = text.trim();
  if (lastUserInput && t.toLowerCase() === lastUserInput.trim().toLowerCase()) return true;
  if (/^complexity score\b/i.test(t)) return true;
  if (/\btool loop$/i.test(t)) return true;
  if (/^calling \w[\w\s]*(workflow|sub-agent)$/i.test(t)) return true;
  return false;
}

function getPendingRunId(): string | undefined {
  return runtimeState?.pendingRun?.id;
}

function hasRemoteActiveRun(): boolean {
  const activeRun = sessionCoordinator?.getState()?.activeRun;
  return !!(activeRun && activeRun.runtimeId && activeRun.runtimeId !== runtimeId);
}

function canComposeInObserverMode(): boolean {
  return !hasRemoteActiveRun();
}

function resolveExecutionModeNote(mode: RoverExecutionMode): string | undefined {
  if (mode !== 'observer') return undefined;
  if (hasRemoteActiveRun()) {
    return 'Observing active run in another tab...';
  }
  return 'Send to take control and run here.';
}

function shouldIgnoreRunScopedWorkerMessage(msg: any): boolean {
  const type = typeof msg?.type === 'string' ? msg.type : '';
  if (!RUN_SCOPED_WORKER_MESSAGE_TYPES.has(type)) return false;

  const messageRunId = typeof msg?.runId === 'string' && msg.runId ? msg.runId : undefined;
  const pendingRunId = getPendingRunId();

  if (type === 'run_started') {
    if (!messageRunId || !pendingRunId) return false;
    return pendingRunId !== messageRunId;
  }

  if (!messageRunId) {
    // Backward-compatible: if older workers do not send runId, don't drop message.
    return false;
  }

  if (type === 'run_completed') {
    if (!pendingRunId) {
      const sharedRunId = sessionCoordinator?.getState()?.activeRun?.runId;
      if (sharedRunId && sharedRunId === messageRunId) return false;
      return true;
    }
    return pendingRunId !== messageRunId;
  }

  if (!pendingRunId) return true;
  return pendingRunId !== messageRunId;
}

function normalizeRunCompletionState(msg: any): { taskComplete: boolean; needsUserInput: boolean } {
  if (!msg || typeof msg !== 'object') {
    return { taskComplete: false, needsUserInput: false };
  }
  const needsUserInput = msg.needsUserInput === true;
  const taskComplete = msg.taskComplete === true && !needsUserInput;
  return { taskComplete, needsUserInput };
}

function getLatestAssistantText(runId?: string): string | undefined {
  if (runId && latestAssistantByRunId.has(runId)) {
    return latestAssistantByRunId.get(runId);
  }

  if (!runtimeState?.uiMessages?.length) return undefined;
  for (let i = runtimeState.uiMessages.length - 1; i >= 0; i -= 1) {
    const message = runtimeState.uiMessages[i];
    if (message.role === 'assistant' && message.text) {
      return message.text;
    }
  }
  return undefined;
}

function loadPersistedState(key: string): PersistedRuntimeState | null {
  if (!runtimeStateStore) return null;
  return runtimeStateStore.readSync(key);
}

function cloneUnknown<T>(value: T): T | undefined {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return undefined;
    }
  }
}

function toWorkerHistoryEntry(input: unknown): { role: string; content: string } | null {
  if (!input || typeof input !== 'object') return null;
  const role = (input as any).role;
  const content = (input as any).content;
  if (typeof role !== 'string' || typeof content !== 'string') return null;
  if (!content) return null;
  return { role, content };
}

function cloneUnknownArrayTail(input: unknown, max: number): unknown[] {
  if (!Array.isArray(input)) return [];
  const out: unknown[] = [];
  for (const entry of input.slice(-max)) {
    const cloned = cloneUnknown(entry);
    if (cloned !== undefined) out.push(cloned);
  }
  return out;
}

async function loadPersistedStateFromAsyncStore(key: string): Promise<PersistedRuntimeState | null> {
  if (!runtimeStateStore) return null;
  try {
    return await runtimeStateStore.readAsync(key);
  } catch {
    return null;
  }
}

function sanitizeUiMessages(input: any): PersistedUiMessage[] {
  if (!Array.isArray(input)) return [];
  const out: PersistedUiMessage[] = [];

  for (const message of input.slice(-MAX_UI_MESSAGES)) {
    const role = message?.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;

    out.push({
      id: typeof message?.id === 'string' && message.id ? message.id : createId('msg'),
      role,
      text: truncateText(String(message?.text || '')),
      ts: Number(message?.ts) || Date.now(),
      sourceRuntimeId: typeof message?.sourceRuntimeId === 'string' ? message.sourceRuntimeId : undefined,
    });
  }

  return out;
}

function sanitizeTimelineEvents(input: any): PersistedTimelineEvent[] {
  if (!Array.isArray(input)) return [];
  const out: PersistedTimelineEvent[] = [];
  for (const event of input.slice(-MAX_TIMELINE_EVENTS)) {
    const title = truncateText(String(event?.title || ''), 400);
    if (!title) continue;
    const kind = String(event?.kind || 'status') as RoverTimelineEvent['kind'];
    const status = event?.status as RoverTimelineEvent['status'] | undefined;

    out.push({
      id: typeof event?.id === 'string' && event.id ? event.id : createId('timeline'),
      kind,
      title,
      detail: event?.detail ? truncateText(String(event.detail), 1200) : undefined,
      status:
        status === 'pending' || status === 'success' || status === 'error' || status === 'info'
          ? status
          : undefined,
      ts: Number(event?.ts) || Date.now(),
      sourceRuntimeId: typeof event?.sourceRuntimeId === 'string' ? event.sourceRuntimeId : undefined,
    });
  }
  return out;
}

function sanitizeWorkerState(input: any): PersistedWorkerState | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const historyRaw: unknown[] = Array.isArray((input as PersistedWorkerState).history)
    ? ((input as PersistedWorkerState).history as unknown[])
    : [];
  const plannerRaw: unknown[] = Array.isArray((input as PersistedWorkerState).plannerHistory)
    ? ((input as PersistedWorkerState).plannerHistory as unknown[])
    : [];
  const agentPrevStepsRaw: unknown[] = Array.isArray((input as PersistedWorkerState).agentPrevSteps)
    ? ((input as PersistedWorkerState).agentPrevSteps as unknown[])
    : Array.isArray((input as PersistedWorkerState).lastToolPreviousSteps)
      ? ((input as PersistedWorkerState).lastToolPreviousSteps as unknown[])
      : [];

  const history = historyRaw
    .slice(-MAX_WORKER_HISTORY)
    .map(message => toWorkerHistoryEntry(message))
    .filter((message): message is { role: string; content: string } => !!message);
  const plannerHistory = cloneUnknownArrayTail(plannerRaw, MAX_WORKER_STEPS);
  const agentPrevSteps = cloneUnknownArrayTail(agentPrevStepsRaw, MAX_WORKER_STEPS * 2);

  return {
    trajectoryId: typeof input.trajectoryId === 'string' ? input.trajectoryId : undefined,
    history,
    plannerHistory,
    agentPrevSteps,
    lastToolPreviousSteps: agentPrevSteps,
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
}

function normalizePersistedState(raw: PersistedRuntimeState | null, sessionId: string, rid: string): PersistedRuntimeState {
  if (!raw || typeof raw !== 'object') {
    return createDefaultRuntimeState(sessionId, rid);
  }

  const fallbackTask = createDefaultTaskState();
  const parsedTask = sanitizeTask(raw.activeTask, fallbackTask);

  return {
    version: RUNTIME_STATE_VERSION,
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : sessionId,
    runtimeId: typeof raw.runtimeId === 'string' && raw.runtimeId ? raw.runtimeId : rid,
    uiOpen: !!raw.uiOpen,
    uiHidden: !!raw.uiHidden,
    uiStatus: typeof raw.uiStatus === 'string' ? truncateText(raw.uiStatus, 300) : undefined,
    uiMessages: sanitizeUiMessages(raw.uiMessages),
    timeline: sanitizeTimelineEvents((raw as any).timeline),
    executionMode:
      (raw as any).executionMode === 'observer' || (raw as any).executionMode === 'controller'
        ? (raw as any).executionMode
        : 'controller',
    workerState: sanitizeWorkerState(raw.workerState),
    pendingRun: sanitizePendingRun(raw.pendingRun),
    taskEpoch: Math.max(1, Number(raw.taskEpoch) || 1),
    activeTask: parsedTask,
    lastRoutingDecision:
      raw.lastRoutingDecision &&
      (raw.lastRoutingDecision.mode === 'act' || raw.lastRoutingDecision.mode === 'planner')
        ? {
            mode: raw.lastRoutingDecision.mode,
            score: Number(raw.lastRoutingDecision.score) || undefined,
            reason:
              typeof raw.lastRoutingDecision.reason === 'string'
                ? truncateText(raw.lastRoutingDecision.reason, 200)
                : undefined,
            ts: Number(raw.lastRoutingDecision.ts) || Date.now(),
          }
        : undefined,
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function sanitizeTask(input: any, fallback: PersistedTaskState): PersistedTaskState {
  if (!input || typeof input !== 'object') return fallback;
  const taskId = typeof input.taskId === 'string' && input.taskId.trim() ? input.taskId.trim() : fallback.taskId;
  const status = input.status === 'ended' || input.status === 'completed' || input.status === 'running' ? input.status : 'running';
  return {
    taskId,
    status,
    startedAt: Number(input.startedAt) || fallback.startedAt,
    lastUserAt: Number(input.lastUserAt) || undefined,
    lastAssistantAt: Number(input.lastAssistantAt) || undefined,
    boundaryReason: typeof input.boundaryReason === 'string' ? truncateText(input.boundaryReason, 120) : fallback.boundaryReason,
    endedAt: Number(input.endedAt) || undefined,
  };
}

function toPersistedTask(task: SharedTaskState | undefined, fallback: PersistedTaskState): PersistedTaskState {
  return sanitizeTask(task, fallback);
}

function toSharedWorkerContext(state: PersistedWorkerState | undefined): SharedWorkerContext | undefined {
  if (!state) return undefined;
  return {
    trajectoryId: state.trajectoryId,
    history: Array.isArray(state.history)
      ? state.history
          .slice(-MAX_WORKER_HISTORY)
          .map(message => toWorkerHistoryEntry(message))
          .filter((message): message is { role: string; content: string } => !!message)
      : [],
    plannerHistory: cloneUnknownArrayTail(state.plannerHistory, MAX_WORKER_STEPS),
    agentPrevSteps: cloneUnknownArrayTail(state.agentPrevSteps, MAX_WORKER_STEPS * 2),
    updatedAt: Number(state.updatedAt) || Date.now(),
  };
}

function sanitizePendingRun(input: any): PersistedPendingRun | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!id || !text) return undefined;

  return {
    id,
    text,
    startedAt: Number(input.startedAt) || Date.now(),
    attempts: Math.max(0, Number(input.attempts) || 0),
    autoResume: input.autoResume !== false,
  };
}

function persistRuntimeState(): void {
  if (!runtimeState || !runtimeStorageKey) return;
  try {
    runtimeState.updatedAt = Date.now();
    runtimeStateStore?.write(runtimeStorageKey, runtimeState);
    if (!suppressCheckpointSync) {
      cloudCheckpointClient?.markDirty();
    }
  } catch {
    // ignore storage failures
  }
}

function ensureUnloadHandler(): void {
  if (unloadHandlerInstalled) return;
  unloadHandlerInstalled = true;

  const onPageHide = () => {
    // If there's an auto-resumable pending run, clear the runtimeId from activeRun
    // so the new runtime (after page reload) isn't blocked by stale runtimeId check
    if (runtimeState?.pendingRun?.autoResume) {
      sessionCoordinator?.clearActiveRunRuntimeId(runtimeState.pendingRun.id);
    }
    sessionCoordinator?.broadcastClosing();
    if (runtimeState?.pendingRun) {
      sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
    }
    persistRuntimeState();
    void flushTelemetry(true);
    stopTelemetry();
    cloudCheckpointClient?.markDirty();
    cloudCheckpointClient?.syncNow();
    cloudCheckpointClient?.stop();
    sessionCoordinator?.stop();
  };

  window.addEventListener('pagehide', onPageHide, { capture: true });

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return; // Only handle bfcache restores
    // Re-read shared state from localStorage after bfcache restore
    if (sessionCoordinator) {
      sessionCoordinator.reloadFromStorage();
      // Re-register current tab (may have been removed by broadcastClosing)
      sessionCoordinator.registerCurrentTab(window.location.href, document.title || undefined);
      sessionCoordinator.claimLease(false);
    }
    autoResumeAttempted = false; // Allow auto-resume after bfcache restore
    if (currentConfig) {
      setupTelemetry(currentConfig);
    }
  };
  window.addEventListener('pageshow', onPageShow);
}

function ensureActiveTask(reason = 'implicit'): PersistedTaskState | undefined {
  if (!runtimeState) return undefined;
  if (!runtimeState.activeTask) {
    runtimeState.activeTask = createDefaultTaskState(reason);
    runtimeState.taskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
  }
  return runtimeState.activeTask;
}

function markTaskActivity(role: UiRole, timestamp = Date.now()): void {
  if (!runtimeState) return;
  const task = ensureActiveTask('implicit');
  if (!task) return;

  if (role === 'user') task.lastUserAt = timestamp;
  if (role === 'assistant') task.lastAssistantAt = timestamp;
  if (task.status === 'ended') {
    task.status = 'running';
    task.endedAt = undefined;
  }
}

function markTaskRunning(reason = 'worker_task_active', timestamp = Date.now()): void {
  if (!runtimeState) return;
  const task = ensureActiveTask(reason);
  if (!task) return;
  task.status = 'running';
  task.endedAt = undefined;
  task.boundaryReason = reason;
  if (!task.lastUserAt && !task.lastAssistantAt) {
    task.lastAssistantAt = timestamp;
  }
  sessionCoordinator?.syncTask({ ...task }, runtimeState.taskEpoch);
  persistRuntimeState();
}

function markTaskCompleted(reason = 'worker_task_complete', timestamp = Date.now()): void {
  if (!runtimeState) return;
  const task = ensureActiveTask(reason);
  if (!task) return;
  task.status = 'completed';
  task.endedAt = timestamp;
  task.boundaryReason = reason;
  sessionCoordinator?.syncTask({ ...task }, runtimeState.taskEpoch);
  persistRuntimeState();
}

function hideTaskSuggestion(): void {
  pendingTaskSuggestion = null;
  ui?.setTaskSuggestion({ visible: false });
}

function clearTaskUiState(): void {
  ui?.clearMessages();
  ui?.clearTimeline();
  hideTaskSuggestion();
}

function isPendingRunLikelyActive(): boolean {
  const pending = runtimeState?.pendingRun;
  if (!pending) return false;
  if (!sessionCoordinator) return true;

  const sharedActiveRun = sessionCoordinator?.getState()?.activeRun;
  if (sharedActiveRun?.runId && sharedActiveRun.runId === pending.id) {
    return true;
  }
  if (sharedActiveRun?.runtimeId && sharedActiveRun.runtimeId !== runtimeId) {
    return true;
  }

  const ageMs = Date.now() - Number(pending.startedAt || 0);
  return ageMs >= 0 && ageMs <= ACTIVE_PENDING_RUN_GRACE_MS;
}

function maybeClearStalePendingRun(): void {
  if (!runtimeState?.pendingRun) return;
  if (isPendingRunLikelyActive()) return;
  if (!sessionCoordinator) return;

  const pending = runtimeState.pendingRun;
  const ageMs = Date.now() - Number(pending.startedAt || 0);
  if (!Number.isFinite(ageMs) || ageMs < STALE_PENDING_RUN_MS) return;

  setPendingRun(undefined);
  sessionCoordinator?.clearActiveRunRuntimeId(pending.id);
  sessionCoordinator?.releaseWorkflowLock(pending.id);
  sessionCoordinator?.setActiveRun(undefined);
}

function appendUiMessage(
  role: UiRole,
  text: string,
  persist = true,
  options?: { id?: string; ts?: number; sourceRuntimeId?: string; publishShared?: boolean },
): PersistedUiMessage | undefined {
  const clean = truncateText(String(text || ''));
  if (!clean) return undefined;

  const message: PersistedUiMessage = {
    id: options?.id || createId('msg'),
    role,
    text: clean,
    ts: options?.ts || Date.now(),
    sourceRuntimeId: options?.sourceRuntimeId,
  };

  ui?.addMessage(message.role, message.text);

  if (runtimeState && persist) {
    runtimeState.uiMessages.push(message);
    if (runtimeState.uiMessages.length > MAX_UI_MESSAGES) {
      runtimeState.uiMessages = runtimeState.uiMessages.slice(-MAX_UI_MESSAGES);
    }
    markTaskActivity(message.role, message.ts);
    persistRuntimeState();
  }

  if (sessionCoordinator && options?.publishShared !== false) {
    sessionCoordinator.appendMessage({
      id: message.id,
      role: message.role,
      text: message.text,
      ts: message.ts,
    });
    sessionCoordinator.markTaskActivity(message.role, message.ts);
  }

  return message;
}

function replayUiMessages(messages: PersistedUiMessage[]): void {
  for (const message of messages) {
    appendUiMessage(message.role, message.text, false, {
      id: message.id,
      ts: message.ts,
      sourceRuntimeId: message.sourceRuntimeId,
      publishShared: false,
    });
  }
}

function appendTimelineEvent(
  event: Omit<PersistedTimelineEvent, 'id' | 'ts'> & { id?: string; ts?: number; publishShared?: boolean },
  persist = true,
): PersistedTimelineEvent {
  const timelineEvent: PersistedTimelineEvent = {
    id: event.id || createId('timeline'),
    kind: event.kind,
    title: truncateText(event.title, 400),
    detail: event.detail ? truncateText(event.detail, 1200) : undefined,
    status: event.status,
    ts: event.ts || Date.now(),
    sourceRuntimeId: event.sourceRuntimeId,
  };

  ui?.addTimelineEvent(timelineEvent);

  if (runtimeState && persist) {
    runtimeState.timeline.push(timelineEvent);
    if (runtimeState.timeline.length > MAX_TIMELINE_EVENTS) {
      runtimeState.timeline = runtimeState.timeline.slice(-MAX_TIMELINE_EVENTS);
    }
    persistRuntimeState();
  }

  if (sessionCoordinator && event.publishShared !== false) {
    sessionCoordinator.appendTimeline({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      detail: timelineEvent.detail,
      status: timelineEvent.status,
      ts: timelineEvent.ts,
    });
  }

  return timelineEvent;
}

function replayTimeline(events: PersistedTimelineEvent[]): void {
  ui?.clearTimeline();
  for (const event of events) {
    appendTimelineEvent(
      {
        id: event.id,
        kind: event.kind,
        title: event.title,
        detail: event.detail,
        status: event.status,
        ts: event.ts,
        sourceRuntimeId: event.sourceRuntimeId,
        publishShared: false,
      },
      false,
    );
  }
}

function setUiStatus(text: string, options?: { publishShared?: boolean }): void {
  ui?.setStatus(text);
  if (runtimeState) {
    runtimeState.uiStatus = truncateText(text, 300);
    persistRuntimeState();
  }
  if (sessionCoordinator && options?.publishShared !== false) {
    sessionCoordinator.setStatus(text);
  }
}

function setExecutionMode(
  mode: RoverExecutionMode,
  info?: { localLogicalTabId?: number; activeLogicalTabId?: number; holderRuntimeId?: string },
): void {
  currentMode = mode;
  if (runtimeState) {
    runtimeState.executionMode = mode;
    persistRuntimeState();
  }
  ui?.setExecutionMode(mode, {
    controllerRuntimeId: info?.holderRuntimeId ?? sessionCoordinator?.getCurrentHolderRuntimeId(),
    localLogicalTabId: info?.localLogicalTabId ?? sessionCoordinator?.getLocalLogicalTabId(),
    activeLogicalTabId: info?.activeLogicalTabId ?? sessionCoordinator?.getActiveLogicalTabId(),
    canTakeControl: true,
    canComposeInObserver: canComposeInObserverMode(),
    note: resolveExecutionModeNote(mode),
  });
  emit('mode_change', { mode, ...info });
}

function setPendingRun(next: PersistedPendingRun | undefined): void {
  if (!runtimeState) return;
  runtimeState.pendingRun = next;
  const task = ensureActiveTask('implicit');
  if (task) {
    if (next) {
      task.status = 'running';
      task.endedAt = undefined;
    } else if (task.status === 'running') {
      task.status = 'completed';
    }
  }
  persistRuntimeState();
}

function postRun(text: string, options?: { runId?: string; resume?: boolean; appendUserMessage?: boolean; autoResume?: boolean }): void {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  if (!worker) return;

  if (currentMode === 'observer') {
    const claimed = sessionCoordinator?.requestControl() ?? false;
    if (!claimed) {
      appendUiMessage(
        'system',
        'Unable to take control right now because another tab is still running Rover actions.',
        true,
      );
      appendTimelineEvent({
        kind: 'info',
        title: 'Observer mode',
        detail: 'Action execution is currently owned by another tab runtime.',
        status: 'info',
      });
      return;
    }
  }

  const runId = options?.runId || crypto.randomUUID();
  const resume = !!options?.resume;
  const appendUserMessageFlag = options?.appendUserMessage !== false;

  if (appendUserMessageFlag) {
    appendUiMessage('user', trimmed, true);
  }

  const previousAttempts = runtimeState?.pendingRun?.id === runId ? runtimeState.pendingRun.attempts : 0;

  setPendingRun({
    id: runId,
    text: trimmed,
    startedAt: Date.now(),
    attempts: resume ? previousAttempts + 1 : 0,
    autoResume: options?.autoResume !== false,
  });

  lastUserInputText = trimmed;
  sessionCoordinator?.acquireWorkflowLock(runId);
  sessionCoordinator?.setActiveRun({ runId, text: trimmed });
  worker.postMessage({ type: 'run', text: trimmed, runId, resume });

  if (runSafetyTimer) clearTimeout(runSafetyTimer);
  const safetyRunId = runId;
  runSafetyTimer = setTimeout(() => {
    if (runtimeState?.pendingRun?.id === safetyRunId) {
      setPendingRun(undefined);
      sessionCoordinator?.releaseWorkflowLock(safetyRunId);
      sessionCoordinator?.setActiveRun(undefined);
      setUiStatus('Task timed out.');
      appendUiMessage('system', 'Task timed out after 5 minutes with no response.', true);
      emit('error', { message: 'Run safety timeout' });
    }
    runSafetyTimer = null;
  }, 5 * 60_000);
}

function dispatchUserPrompt(
  text: string,
  options?: { bypassSuggestion?: boolean; startNewTask?: boolean; reason?: string },
): void {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  maybeClearStalePendingRun();

  const activeTaskStatus = runtimeState?.activeTask?.status;
  const shouldStartFreshTask =
    !!options?.startNewTask ||
    activeTaskStatus === 'completed' ||
    activeTaskStatus === 'ended';

  sessionCoordinator?.pruneTabs({
    dropRuntimeDetached: true,
    dropAllDetachedExternal: shouldStartFreshTask,
  });

  if (shouldStartFreshTask) {
    const autoReason =
      options?.reason ||
      (activeTaskStatus === 'completed' ? 'auto_after_task_complete' : 'auto_after_task_end');
    newTask({ reason: autoReason, clearUi: true });
  }

  hideTaskSuggestion();
  postRun(trimmed, { appendUserMessage: true, resume: false, autoResume: true });
}

function maybeAutoResumePendingRun(): void {
  if (currentMode === 'observer') return;
  const sharedActiveRun = sessionCoordinator?.getState()?.activeRun;
  if (sharedActiveRun?.runtimeId && sharedActiveRun.runtimeId !== runtimeId) {
    // Allow resume if this is our own pending run (same runId survives page reload)
    const isPendingRunMatch = runtimeState?.pendingRun?.id === sharedActiveRun.runId;
    if (!isPendingRunMatch) {
      return;
    }
  }
  if (!workerReady || !worker || autoResumeAttempted || !runtimeState?.pendingRun) return;
  if (runtimeState.activeTask?.status === 'ended') return;

  const pending = runtimeState.pendingRun;
  if (!pending.autoResume) return;

  // sessionStorage flag distinguishes refresh (flag exists) from fresh tab (flag absent)
  const siteId = currentConfig?.siteId || '';
  const isRefresh = !!sessionStorage.getItem(`rover:tab-alive:${siteId}`);
  if (!isRefresh) {
    // New tab (not a refresh) — check if any other tabs are alive
    const tabs = sessionCoordinator?.listTabs() || [];
    const otherAlive = tabs.some(t =>
      t.runtimeId !== runtimeId && t.updatedAt > Date.now() - 2 * 2000,
    );
    if (!otherAlive && runtimeState?.pendingRun) {
      // All tabs were closed — don't auto-resume stale task
      setPendingRun(undefined);
      setUiStatus('Previous task expired.');
      return;
    }
  }

  const ageMs = Date.now() - pending.startedAt;
  if (ageMs > MAX_AUTO_RESUME_AGE_MS) {
    setPendingRun(undefined);
    setUiStatus('Previous task expired after navigation.');
    return;
  }

  if (pending.attempts >= MAX_AUTO_RESUME_ATTEMPTS) {
    setPendingRun(undefined);
    appendUiMessage('system', 'Auto-resume stopped after too many navigation attempts.', true);
    return;
  }

  autoResumeAttempted = true;
  setUiStatus('Resuming previous task after navigation...');
  postRun(pending.text, {
    runId: pending.id,
    resume: true,
    appendUserMessage: false,
    autoResume: true,
  });
}

async function applyAsyncRuntimeStateHydration(key: string): Promise<void> {
  if (!runtimeState) return;
  const loaded = await loadPersistedStateFromAsyncStore(key);
  if (!loaded || !runtimeState) return;

  const localUpdatedAt = Number(runtimeState.updatedAt) || 0;
  const normalized = normalizePersistedState(
    {
      ...loaded,
      sessionId: runtimeState.sessionId,
      runtimeId,
    },
    runtimeState.sessionId,
    runtimeId,
  );
  const incomingUpdatedAt = Number(normalized.updatedAt) || 0;
  if (incomingUpdatedAt <= localUpdatedAt + 200) return;

  runtimeState = normalizePersistedState(
    {
      ...runtimeState,
      ...normalized,
      sessionId: runtimeState.sessionId,
      runtimeId,
    } as PersistedRuntimeState,
    runtimeState.sessionId,
    runtimeId,
  );
  persistRuntimeState();

  if (ui) {
    ui.clearMessages();
    replayUiMessages(runtimeState.uiMessages);
    replayTimeline(runtimeState.timeline);
    if (runtimeState.uiStatus) {
      ui.setStatus(runtimeState.uiStatus);
    }
    if (runtimeState.uiHidden) {
      ui.hide();
    } else {
      ui.show();
      if (runtimeState.uiOpen) ui.open();
      else ui.close();
    }
  }

  if (workerReady && worker && runtimeState.workerState && currentMode === 'controller') {
    worker.postMessage({ type: 'hydrate_state', state: runtimeState.workerState });
    emit('context_restored', { source: 'indexeddb_checkpoint', ts: Date.now() });
  }
}

function applyCoordinatorState(state: SharedSessionState, source: 'local' | 'remote'): void {
  if (!runtimeState) return;

  if (source === 'remote') {
    const localTaskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
    const remoteTaskEpoch = Math.max(1, Number(state.taskEpoch) || 1);
    const taskEpochAdvanced = remoteTaskEpoch > localTaskEpoch;
    runtimeState.taskEpoch = Math.max(localTaskEpoch, remoteTaskEpoch);

    const fallbackTask = runtimeState.activeTask || createDefaultTaskState('shared_sync');
    runtimeState.activeTask = toPersistedTask(state.task, fallbackTask);

    if (taskEpochAdvanced) {
      runtimeState.uiMessages = [];
      runtimeState.timeline = [];
      clearTaskUiState();
      setPendingRun(undefined);
      hideTaskSuggestion();
    }

    const incomingMessages = sanitizeUiMessages(state.uiMessages as SharedUiMessage[]);
    const incomingMessageIds = new Set(incomingMessages.map(message => message.id));
    const shouldReplaceMessages =
      incomingMessages.length < runtimeState.uiMessages.length ||
      runtimeState.uiMessages.some(message => !incomingMessageIds.has(message.id));

    if (shouldReplaceMessages) {
      runtimeState.uiMessages = incomingMessages;
      ui?.clearMessages();
      replayUiMessages(runtimeState.uiMessages);
    } else {
      const existingMessageIds = new Set(runtimeState.uiMessages.map(message => message.id));
      for (const message of incomingMessages) {
        if (existingMessageIds.has(message.id)) continue;
        appendUiMessage(message.role, message.text, true, {
          id: message.id,
          ts: message.ts,
          sourceRuntimeId: message.sourceRuntimeId,
          publishShared: false,
        });
        existingMessageIds.add(message.id);
      }
    }

    const incomingTimeline = sanitizeTimelineEvents(state.timeline as SharedTimelineEvent[]);
    const incomingTimelineIds = new Set(incomingTimeline.map(event => event.id));
    const shouldReplaceTimeline =
      incomingTimeline.length < runtimeState.timeline.length ||
      runtimeState.timeline.some(event => !incomingTimelineIds.has(event.id));

    if (shouldReplaceTimeline) {
      runtimeState.timeline = incomingTimeline;
      replayTimeline(runtimeState.timeline);
    } else {
      const existingTimelineIds = new Set(runtimeState.timeline.map(event => event.id));
      for (const event of incomingTimeline) {
        if (existingTimelineIds.has(event.id)) continue;
        appendTimelineEvent(
          {
            id: event.id,
            kind: event.kind as RoverTimelineEvent['kind'],
            title: event.title,
            detail: event.detail,
            status: event.status,
            ts: event.ts,
            sourceRuntimeId: event.sourceRuntimeId,
            publishShared: false,
          },
          true,
        );
        existingTimelineIds.add(event.id);
      }
    }

    if (typeof state.uiStatus === 'string') {
      setUiStatus(state.uiStatus, { publishShared: false });
    }

    if (state.activeRun && state.activeRun.runtimeId !== runtimeId) {
      setPendingRun(
        sanitizePendingRun({
          id: state.activeRun.runId,
          text: state.activeRun.text,
          startedAt: state.activeRun.startedAt,
          attempts: runtimeState.pendingRun?.attempts || 0,
          autoResume: true,
        }),
      );
    } else if (!state.activeRun && currentMode === 'observer') {
      setPendingRun(undefined);
    }

    if (currentMode === 'observer') {
      setExecutionMode('observer', {
        localLogicalTabId: sessionCoordinator?.getLocalLogicalTabId(),
        activeLogicalTabId: sessionCoordinator?.getActiveLogicalTabId(),
        holderRuntimeId: sessionCoordinator?.getCurrentHolderRuntimeId(),
      });
    }

    if (state.workerContext) {
      const incomingWorker = sanitizeWorkerState(state.workerContext);
      const localUpdatedAt = Number(runtimeState.workerState?.updatedAt) || 0;
      const incomingUpdatedAt = Number(incomingWorker?.updatedAt) || 0;
      if (incomingWorker && incomingUpdatedAt > localUpdatedAt + 100) {
        runtimeState.workerState = incomingWorker;
        if (workerReady && worker && currentMode === 'controller') {
          worker.postMessage({ type: 'hydrate_state', state: incomingWorker });
          emit('context_restored', { source: 'shared_session', ts: Date.now() });
        }
      }
    }
  }

  runtimeState.uiMessages = sanitizeUiMessages(runtimeState.uiMessages);
  runtimeState.timeline = sanitizeTimelineEvents(runtimeState.timeline);
  runtimeState.workerState = sanitizeWorkerState(runtimeState.workerState);
  runtimeState.activeTask = sanitizeTask(runtimeState.activeTask, createDefaultTaskState('implicit'));
  persistRuntimeState();
}

function cloneRuntimeStateForCheckpoint(state: PersistedRuntimeState): PersistedRuntimeState {
  const fallbackTask = createDefaultTaskState('checkpoint_clone');
  return {
    version: RUNTIME_STATE_VERSION,
    sessionId: state.sessionId,
    runtimeId: state.runtimeId,
    uiOpen: !!state.uiOpen,
    uiHidden: !!state.uiHidden,
    uiStatus: typeof state.uiStatus === 'string' ? truncateText(state.uiStatus, 300) : undefined,
    uiMessages: sanitizeUiMessages(state.uiMessages),
    timeline: sanitizeTimelineEvents(state.timeline),
    executionMode:
      state.executionMode === 'observer' || state.executionMode === 'controller'
        ? state.executionMode
        : 'controller',
    workerState: sanitizeWorkerState(state.workerState),
    pendingRun: sanitizePendingRun(state.pendingRun),
    taskEpoch: Math.max(1, Number(state.taskEpoch) || 1),
    activeTask: sanitizeTask(state.activeTask, fallbackTask),
    lastRoutingDecision:
      state.lastRoutingDecision &&
      (state.lastRoutingDecision.mode === 'act' || state.lastRoutingDecision.mode === 'planner')
        ? {
            mode: state.lastRoutingDecision.mode,
            score: Number(state.lastRoutingDecision.score) || undefined,
            reason: state.lastRoutingDecision.reason,
            ts: Number(state.lastRoutingDecision.ts) || Date.now(),
          }
        : undefined,
    updatedAt: Number(state.updatedAt) || Date.now(),
  };
}

function shouldEnableCloudCheckpointing(cfg: RoverInit): boolean {
  if (cfg.sessionScope === 'tab') return false;
  // Default off to keep hot-path execution local and avoid remote read latency.
  if (cfg.checkpointing?.enabled !== true) return false;
  if (!(cfg.apiKey || cfg.authToken)) return false;
  if (!resolvedVisitorId) return false;
  return true;
}

function buildCloudCheckpointPayload(): RoverCloudCheckpointPayload | null {
  if (!runtimeState || !currentConfig || !resolvedVisitorId) return null;
  const sharedState = sessionCoordinator?.getState();
  const runtimeSnapshot = cloneRuntimeStateForCheckpoint(runtimeState);
  const updatedAt = Math.max(
    Number(sharedState?.updatedAt || 0),
    Number(runtimeSnapshot.updatedAt || 0),
    Date.now(),
  );

  return {
    version: CHECKPOINT_PAYLOAD_VERSION,
    siteId: currentConfig.siteId,
    visitorId: resolvedVisitorId,
    sessionId: runtimeState.sessionId,
    updatedAt,
    sharedState,
    runtimeState: runtimeSnapshot,
  };
}

function applyCloudCheckpointPayload(payload: RoverCloudCheckpointPayload): void {
  if (!payload || typeof payload !== 'object') return;
  if (!runtimeState || !currentConfig) return;
  if (payload.siteId && payload.siteId !== currentConfig.siteId) return;
  if (resolvedVisitorId && payload.visitorId && payload.visitorId !== resolvedVisitorId) return;

  const remoteSessionId = typeof payload.sessionId === 'string' && payload.sessionId.trim() ? payload.sessionId.trim() : runtimeState.sessionId;

  suppressCheckpointSync = true;
  try {
    if (remoteSessionId && runtimeState.sessionId !== remoteSessionId) {
      runtimeState.sessionId = remoteSessionId;
      currentConfig = { ...currentConfig, sessionId: remoteSessionId };
      setupSessionCoordinator(currentConfig);
      worker?.postMessage({ type: 'update_config', config: { sessionId: remoteSessionId } });
    }

    if (payload.sharedState && sessionCoordinator) {
      const hydrated = sessionCoordinator.hydrateExternalState(payload.sharedState);
      if (hydrated) {
        applyCoordinatorState(sessionCoordinator.getState(), 'remote');
        setExecutionMode(sessionCoordinator.getRole(), {
          localLogicalTabId: sessionCoordinator.getLocalLogicalTabId(),
          activeLogicalTabId: sessionCoordinator.getActiveLogicalTabId(),
          holderRuntimeId: sessionCoordinator.getCurrentHolderRuntimeId(),
        });
      }
    }

    if (payload.runtimeState && typeof payload.runtimeState === 'object') {
      const incomingState = normalizePersistedState(
        {
          ...(payload.runtimeState as PersistedRuntimeState),
          sessionId: remoteSessionId,
          runtimeId,
        },
        remoteSessionId,
        runtimeId,
      );
      const localUpdatedAt = Number(runtimeState.updatedAt) || 0;
      const incomingUpdatedAt = Number(incomingState.updatedAt) || 0;
      if (incomingUpdatedAt > localUpdatedAt + 200) {
        runtimeState = normalizePersistedState(
          {
            ...runtimeState,
            ...incomingState,
            sessionId: remoteSessionId,
            runtimeId,
          } as PersistedRuntimeState,
          remoteSessionId,
          runtimeId,
        );
        persistRuntimeState();

        if (runtimeState.uiStatus) {
          ui?.setStatus(runtimeState.uiStatus);
        }

        if (runtimeState.uiHidden) {
          ui?.hide();
        } else {
          ui?.show();
          if (runtimeState.uiOpen) ui?.open();
          else ui?.close();
        }

        if (workerReady && runtimeState.workerState) {
          worker?.postMessage({ type: 'hydrate_state', state: runtimeState.workerState });
          emit('context_restored', { source: 'cloud_checkpoint', ts: Date.now() });
        }
        if (currentMode === 'controller') {
          maybeAutoResumePendingRun();
        }
      }
    }
  } finally {
    suppressCheckpointSync = false;
  }
}

function setupCloudCheckpointing(cfg: RoverInit): void {
  cloudCheckpointClient?.stop();
  cloudCheckpointClient = null;

  if (!shouldEnableCloudCheckpointing(cfg)) return;
  if (!resolvedVisitorId) return;

  try {
    const emitCheckpointState = (payload: {
      state: RoverCloudCheckpointState;
      reason?: string;
      action?: 'roverSessionCheckpointUpsert' | 'roverSessionCheckpointGet';
      code?: string;
      message?: string;
    }) => {
      emit('checkpoint_state', payload);
      cfg.checkpointing?.onStateChange?.(payload);
    };

    cloudCheckpointClient = new RoverCloudCheckpointClient({
      apiBase: cfg.apiBase,
      apiKey: cfg.apiKey,
      authToken: cfg.authToken,
      siteId: cfg.siteId,
      visitorId: resolvedVisitorId,
      ttlHours: cfg.checkpointing?.ttlHours ?? 1,
      flushIntervalMs: cfg.checkpointing?.flushIntervalMs,
      pullIntervalMs: cfg.checkpointing?.pullIntervalMs,
      minFlushIntervalMs: cfg.checkpointing?.minFlushIntervalMs,
      shouldWrite: () => currentMode === 'controller',
      buildCheckpoint: () => buildCloudCheckpointPayload(),
      onCheckpoint: payload => {
        applyCloudCheckpointPayload(payload);
      },
      onStateChange: (state, context) => {
        emitCheckpointState({
          state,
          reason: context.reason,
          action: context.action,
          code: context.code,
          message: context.message,
        });
        if (state === 'paused_auth') {
          emit('checkpoint_error', {
            action: context.action,
            code: context.code || 'INVALID_API_KEY',
            message: context.message || 'Checkpoint sync paused due to auth failure.',
            disabled: true,
            reason: context.reason || 'auth_failed',
          });
        }
      },
      onError: (_error, context) => {
        cfg.checkpointing?.onError?.(context);
        if (!context.paused) {
          emit('checkpoint_error', {
            action: context.action,
            code: context.code,
            message: context.message,
            status: context.status,
            disabled: false,
            reason: 'transient_failure',
          });
        }
      },
    });
    cloudCheckpointClient.start();
    cloudCheckpointClient.markDirty();
  } catch {
    cloudCheckpointClient = null;
  }
}

function setupSessionCoordinator(cfg: RoverInit): void {
  if (!runtimeState) return;

  sessionCoordinator?.stop();
  sessionCoordinator = null;

  if (cfg.sessionScope === 'tab') {
    setExecutionMode('controller');
    return;
  }

  sessionCoordinator = new SessionCoordinator({
    siteId: cfg.siteId,
    sessionId: runtimeState.sessionId,
    runtimeId,
    leaseMs: cfg.tabPolicy?.actionLeaseMs,
    onRoleChange: (role, info) => {
      setExecutionMode(role, info);
      const allowActions = role === 'controller' && (currentConfig?.allowActions ?? true);
      bridge?.setAllowActions(allowActions);
      if (role === 'controller') {
        const sharedWorkerContext = sessionCoordinator?.getWorkerContext();
        if (sharedWorkerContext) {
          const incomingWorker = sanitizeWorkerState(sharedWorkerContext);
          const localUpdatedAt = Number(runtimeState?.workerState?.updatedAt) || 0;
          const incomingUpdatedAt = Number(incomingWorker?.updatedAt) || 0;
          if (incomingWorker && incomingUpdatedAt > localUpdatedAt + 100) {
            if (runtimeState) {
              runtimeState.workerState = incomingWorker;
              persistRuntimeState();
            }
            if (workerReady && worker) {
              worker.postMessage({ type: 'hydrate_state', state: incomingWorker });
              emit('context_restored', { source: 'controller_handoff', ts: Date.now() });
            }
          }
        }
        maybeAutoResumePendingRun();
      }
    },
    onStateChange: (state, source) => {
      applyCoordinatorState(state, source);
    },
    onSwitchRequested: logicalTabId => {
      if (logicalTabId > 0) {
        open();
        appendTimelineEvent({
          kind: 'status',
          title: `Switched to tab #${logicalTabId}`,
          status: 'info',
        });
      }
    },
  });

  sessionCoordinator.start();

  // Register local RPC handler for cross-tab requests
  sessionCoordinator.setRpcRequestHandler(async (request) => {
    if (!bridge) throw new Error('Bridge not available');
    if (request.method === 'getPageData') return bridge.getPageData(request.params);
    if (request.method === 'executeTool') return bridge.executeTool(request.params.call, request.params.payload);
    throw new Error(`Unknown RPC method: ${request.method}`);
  });

  if (runtimeState?.activeTask) {
    sessionCoordinator.syncTask(
      {
        ...runtimeState.activeTask,
        taskId: runtimeState.activeTask.taskId,
      },
      runtimeState.taskEpoch,
    );
  }
  if (runtimeState?.workerState) {
    sessionCoordinator.setWorkerContext(toSharedWorkerContext(runtimeState.workerState));
  }
}

function finalizeSuccessfulRunTimeline(runId?: string): void {
  const detail = truncateText(getLatestAssistantText(runId) || 'Done.', 1200);

  ui?.clearTimeline();
  if (runtimeState) {
    runtimeState.timeline = [];
  }
  sessionCoordinator?.clearTimeline();

  appendTimelineEvent({
    id: runId ? `run:${runId}:final` : undefined,
    kind: 'tool_result',
    title: 'Execution completed',
    detail,
    status: 'success',
  });
}

function handleWorkerMessage(msg: any): void {
  if (!msg || typeof msg !== 'object') return;
  if (shouldIgnoreRunScopedWorkerMessage(msg)) return;

  if (msg.type === 'assistant') {
    const text = String(msg.text || '');
    if (typeof msg.runId === 'string' && msg.runId) {
      latestAssistantByRunId.set(msg.runId, text);
      if (latestAssistantByRunId.size > 80) {
        const oldestKey = latestAssistantByRunId.keys().next().value;
        if (oldestKey) latestAssistantByRunId.delete(oldestKey);
      }
    }
    appendUiMessage('assistant', text, true);
    appendTimelineEvent({
      kind: 'tool_result',
      title: 'Assistant update',
      detail: text,
      status: 'success',
    });
    return;
  }

  if (msg.type === 'status') {
    const stage = normalizeStatusStage(msg.stage);
    const message = msg.message ? String(msg.message) : undefined;
    const compactThought = msg.compactThought ? String(msg.compactThought) : undefined;
    const signature = buildStatusSignature(message, stage, compactThought);

    if (message) {
      setUiStatus(message);
    }

    if (signature && signature !== lastStatusSignature) {
      lastStatusSignature = signature;
      if (message) {
        const hasThought = !!(msg.thought || compactThought);
        const thoughtText = compactThought || (msg.thought ? String(msg.thought) : '');
        // Only classify as 'thought' kind for execute/verify stages with meaningful thoughts
        const useThoughtKind = hasThought
          && stage !== 'analyze' && stage !== 'route' && stage !== 'complete'
          && !isInternalThought(thoughtText, lastUserInputText);

        if (useThoughtKind) {
          appendTimelineEvent({
            kind: 'thought',
            title: thoughtText,
            detail: msg.thought ? String(msg.thought) : compactThought,
            status: 'pending',
          });
        } else {
          const title = stage ? `${formatStageLabel(stage)}: ${message}` : message;
          appendTimelineEvent({
            kind: 'status',
            title,
            detail: compactThought || (msg.thought ? String(msg.thought) : undefined),
            status: stage === 'complete' ? 'success' : 'info',
          });
        }
      }
    }
    emit('status', msg);
    return;
  }

  if (msg.type === 'tool_start') {
    appendTimelineEvent({
      kind: 'tool_start',
      title: `Running ${msg.call?.name || 'tool'}`,
      detail: safeSerialize(msg.call?.args),
      status: 'pending',
    });
    emit('tool_start', msg);
    return;
  }

  if (msg.type === 'tool_result') {
    appendTimelineEvent({
      kind: 'tool_result',
      title: `${msg.call?.name || 'tool'} completed`,
      detail: safeSerialize(msg.result),
      status: msg?.result?.success === false ? 'error' : 'success',
    });
    emit('tool_result', msg);
    return;
  }

  if (msg.type === 'auth_required') {
    emit('auth_required', msg.error);
    if (msg.error?.message) {
      appendUiMessage('system', `Auth required: ${msg.error.message}`, true);
      appendTimelineEvent({
        kind: 'error',
        title: 'Auth required',
        detail: String(msg.error.message),
        status: 'error',
      });
    }
    return;
  }

  if (msg.type === 'navigation_guardrail') {
    emit('navigation_guardrail', msg);
    appendTimelineEvent({
      kind: 'status',
      title: 'Navigation guardrail',
      detail: safeSerialize(msg),
      status: 'info',
    });
    return;
  }

  if (msg.type === 'error') {
    appendUiMessage('system', `Error: ${msg.message || 'unknown'}`, true);
    appendTimelineEvent({
      kind: 'error',
      title: 'Execution error',
      detail: String(msg.message || 'unknown'),
      status: 'error',
    });
    emit('error', msg);
    return;
  }

  if (msg.type === 'state_snapshot') {
    if (runtimeState) {
      runtimeState.workerState = sanitizeWorkerState({
        ...(msg.state || {}),
        updatedAt: Date.now(),
      });
      if (msg?.activeRun?.runId && msg?.activeRun?.text && !runtimeState.pendingRun) {
        runtimeState.pendingRun = sanitizePendingRun({
          id: msg.activeRun.runId,
          text: msg.activeRun.text,
          startedAt: msg.activeRun.startedAt,
          attempts: 0,
          autoResume: true,
        });
      }
      if (msg?.activeRun?.runId && msg?.activeRun?.text) {
        sessionCoordinator?.setActiveRun({ runId: msg.activeRun.runId, text: msg.activeRun.text });
      }
      if (runtimeState.workerState) {
        sessionCoordinator?.setWorkerContext(toSharedWorkerContext(runtimeState.workerState));
      }
      persistRuntimeState();
    }
    return;
  }

  if (msg.type === 'task_started') {
    emit('task_started', {
      taskId: msg.taskId,
      reason: 'worker',
    });
    return;
  }

  if (msg.type === 'run_started') {
    lastStatusSignature = '';
    hideTaskSuggestion();
    if (typeof msg.runId === 'string' && msg.runId) {
      latestAssistantByRunId.delete(msg.runId);
    }
    const existing = runtimeState?.pendingRun;
    setPendingRun(
      sanitizePendingRun({
        id: msg.runId,
        text: msg.text,
        startedAt: existing?.startedAt || Date.now(),
        attempts: existing?.attempts || 0,
        autoResume: existing?.autoResume !== false,
      }),
    );
    sessionCoordinator?.setActiveRun({ runId: msg.runId, text: String(msg.text || '') });
    ui?.setRunning(true);
    const startEventId = `run:${String(msg.runId || '')}:start`;
    if (!runtimeState?.timeline.some(event => event.id === startEventId)) {
      appendTimelineEvent({
        id: startEventId,
        kind: 'plan',
        title: msg.resume ? 'Run resumed' : 'Run started',
        detail: String(msg.text || ''),
        status: 'pending',
      });
    }
    return;
  }

  if (msg.type === 'run_completed') {
    lastStatusSignature = '';
    autoResumeAttempted = false;
    ui?.setRunning(false);
    if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
    if (runtimeState?.pendingRun?.id === msg.runId) {
      setPendingRun(undefined);
    }
    if (typeof msg.runId === 'string' && msg.runId) {
      sessionCoordinator?.releaseWorkflowLock(msg.runId);
    }
    if (
      runtimeState &&
      msg?.route &&
      (msg.route.mode === 'act' || msg.route.mode === 'planner')
    ) {
      runtimeState.lastRoutingDecision = {
        mode: msg.route.mode,
        score: Number(msg.route.score) || undefined,
        reason: typeof msg.route.reason === 'string' ? truncateText(msg.route.reason, 200) : undefined,
        ts: Date.now(),
      };
      persistRuntimeState();
    }
    sessionCoordinator?.setActiveRun(undefined);
    if (!msg.ok && msg.error) {
      markTaskRunning('worker_run_failed');
      setUiStatus(`Task failed: ${String(msg.error)}`);
      latestAssistantByRunId.delete(String(msg.runId || ''));
      appendTimelineEvent({
        kind: 'error',
        title: 'Run failed',
        detail: String(msg.error),
        status: 'error',
      });
    } else if (msg.ok) {
      const completionState = normalizeRunCompletionState(msg);
      const taskComplete = completionState.taskComplete;
      const needsUserInput = completionState.needsUserInput;
      if (taskComplete) {
        markTaskCompleted('worker_task_complete');
        sessionCoordinator?.pruneTabs({
          dropRuntimeDetached: true,
          dropAllDetachedExternal: true,
        });
        setUiStatus('Task completed');
        finalizeSuccessfulRunTimeline(typeof msg.runId === 'string' ? msg.runId : undefined);
      } else {
        markTaskRunning(needsUserInput ? 'worker_waiting_for_input' : 'worker_continuation');
        setUiStatus(needsUserInput ? 'Need more input to continue' : 'Execution finished. Continue when ready.');
        appendTimelineEvent({
          kind: 'status',
          title: needsUserInput ? 'Waiting for your input' : 'Continuation available',
          detail: needsUserInput
            ? 'Planner requested more information before marking the task complete.'
            : 'Task is still active and will continue with your next message.',
          status: 'info',
        });
      }
      if (typeof msg.runId === 'string' && msg.runId) {
        latestAssistantByRunId.delete(msg.runId);
      }
    }
    return;
  }

  if (msg.type === 'ready') {
    workerReady = true;
    setUiStatus('ready');
    emit('ready');

    const sharedWorkerContext = sessionCoordinator?.getWorkerContext();
    const sharedWorkerState = sanitizeWorkerState(sharedWorkerContext);
    const localUpdatedAt = Number(runtimeState?.workerState?.updatedAt) || 0;
    const sharedUpdatedAt = Number(sharedWorkerState?.updatedAt) || 0;
    const stateToHydrate =
      sharedWorkerState && sharedUpdatedAt > localUpdatedAt + 100
        ? sharedWorkerState
        : runtimeState?.workerState;

    if (runtimeState && stateToHydrate && stateToHydrate !== runtimeState.workerState) {
      runtimeState.workerState = stateToHydrate;
      persistRuntimeState();
    }

    if (stateToHydrate) {
      worker?.postMessage({ type: 'hydrate_state', state: stateToHydrate });
      emit('context_restored', { source: 'runtime_start', ts: Date.now() });
    } else {
      maybeAutoResumePendingRun();
    }
    return;
  }

  if (msg.type === 'hydrated') {
    maybeAutoResumePendingRun();
    return;
  }

  if (msg.type === 'updated') {
    emit('updated');
  }
}

function createRuntime(cfg: RoverInit): void {
  setupSessionCoordinator(cfg);
  if (sessionCoordinator) {
    const initialRole = sessionCoordinator.getRole();
    currentMode = initialRole;
    if (runtimeState) {
      runtimeState.executionMode = initialRole;
    }
  }
  setupCloudCheckpointing(cfg);
  setupTelemetry(cfg);

  const initialAllowActions =
    (cfg.allowActions ?? true) && (sessionCoordinator ? sessionCoordinator.isController() : true);

  bridge = new Bridge({
    allowActions: initialAllowActions,
    runtimeId,
    allowedDomains: cfg.allowedDomains,
    domainScopeMode: cfg.domainScopeMode,
    externalNavigationPolicy: cfg.externalNavigationPolicy,
    registerOpenedTab: payload => sessionCoordinator?.registerOpenedTab(payload),
    switchToLogicalTab: logicalTabId => sessionCoordinator?.switchToLogicalTab(logicalTabId) || { ok: false, reason: 'No session coordinator' },
    listKnownTabs: () =>
      (sessionCoordinator?.listTabs() || []).map(tab => ({
        logicalTabId: tab.logicalTabId,
        runtimeId: tab.runtimeId,
        url: tab.url,
        title: tab.title,
        external: !!tab.external,
      })),
    onNavigationGuardrail: event => {
      emit('navigation_guardrail', event);
      appendTimelineEvent({
        kind: 'status',
        title: 'Navigation guardrail',
        detail: safeSerialize(event),
        status: 'info',
      });
    },
    instrumentationOptions: cfg.mode === 'safe' ? { observeInlineMutations: false } : undefined,
  });

  const channel = new MessageChannel();
  bindRpc(channel.port1, {
    getSnapshot: () => bridge!.getSnapshot(),
    getPageData: async (params: any) => {
      const runtimeCfg = currentConfig || cfg;
      const tabId = Number(params?.tabId);
      const localTabId = sessionCoordinator?.getLocalLogicalTabId();

      // Local tab, no tabId, or no coordinator → direct local bridge
      if (!Number.isFinite(tabId) || tabId <= 0 || tabId === localTabId || !sessionCoordinator) {
        return bridge!.getPageData(params);
      }

      // Check if target tab belongs to this runtime
      const tabs = sessionCoordinator.listTabs();
      const targetTab = tabs.find(t => t.logicalTabId === tabId);
      if (!targetTab) {
        return buildInaccessibleTabPageData(
          runtimeCfg,
          { logicalTabId: tabId, external: true },
          'target_tab_missing',
        );
      }

      if (targetTab.runtimeId === runtimeId) {
        return bridge!.getPageData(params);
      }

      if (targetTab.external && runtimeCfg.externalNavigationPolicy !== 'allow') {
        return buildInaccessibleTabPageData(runtimeCfg, targetTab, 'external_domain_inaccessible');
      }

      // Never fall back to local-tab page data for an inaccessible different tab.
      if (!targetTab.runtimeId || !sessionCoordinator.isTabAlive(tabId)) {
        return buildInaccessibleTabPageData(runtimeCfg, targetTab, 'target_tab_inactive');
      }

      try {
        return await sessionCoordinator.sendCrossTabRpc(targetTab.runtimeId, 'getPageData', params, 15000);
      } catch {
        return buildInaccessibleTabPageData(runtimeCfg, targetTab, 'cross_tab_rpc_failed');
      }
    },
    executeTool: async (params: any) => {
      const runtimeCfg = currentConfig || cfg;
      const activeTabId = sessionCoordinator?.getActiveLogicalTabId();
      const localTabId = sessionCoordinator?.getLocalLogicalTabId();

      if (!activeTabId || activeTabId === localTabId || !sessionCoordinator) {
        return bridge!.executeTool(params.call, params.payload);
      }

      const tabs = sessionCoordinator.listTabs();
      const targetTab = tabs.find(t => t.logicalTabId === activeTabId);
      if (!targetTab) {
        return buildTabAccessToolError(
          runtimeCfg,
          { logicalTabId: activeTabId, external: true },
          'target_tab_missing',
        );
      }

      if (targetTab.external && runtimeCfg.externalNavigationPolicy !== 'allow') {
        return buildTabAccessToolError(runtimeCfg, targetTab, 'external_tab_action_blocked');
      }

      if (targetTab.runtimeId === runtimeId) {
        return bridge!.executeTool(params.call, params.payload);
      }

      if (!targetTab.runtimeId || !sessionCoordinator.isTabAlive(activeTabId)) {
        return buildTabAccessToolError(runtimeCfg, targetTab, 'target_tab_inactive');
      }

      try {
        return await sessionCoordinator.sendCrossTabRpc(targetTab.runtimeId, 'executeTool', params, 20000);
      } catch {
        return buildTabAccessToolError(runtimeCfg, targetTab, 'cross_tab_execute_failed');
      }
    },
    executeClientTool: (params: any) => bridge!.executeClientTool(params.name, params.args),
    listClientTools: () => bridge!.listClientTools(),
    getTabContext: () => {
      const localLogicalTabId = sessionCoordinator?.getLocalLogicalTabId();
      const activeLogicalTabId = sessionCoordinator?.getActiveLogicalTabId();
      return {
        id: localLogicalTabId || 1,
        logicalTabId: localLogicalTabId || 1,
        activeLogicalTabId: activeLogicalTabId || localLogicalTabId || 1,
        runtimeId,
        mode: currentMode,
        url: window.location.href,
        title: document.title,
      };
    },
    listSessionTabs: () => sessionCoordinator?.listTabs() || [],
  });
  channel.port1.start?.();

  const workerUrl = cfg.workerUrl ? cfg.workerUrl : new URL('./worker/worker.js', import.meta.url).toString();
  // Cross-origin Workers are blocked by browsers. If the worker URL is on a
  // different origin (e.g. embed.js on www.rtrvr.ai, worker on rover.rtrvr.ai),
  // create a same-origin blob URL that imports the remote script.
  let effectiveWorkerUrl = workerUrl;
  try {
    const pageOrigin = window.location.origin;
    const scriptOrigin = new URL(workerUrl).origin;
    if (pageOrigin !== scriptOrigin) {
      const blob = new Blob(
        [`import '${workerUrl}';`],
        { type: 'application/javascript' },
      );
      effectiveWorkerUrl = URL.createObjectURL(blob);
    }
  } catch (_e) { /* fall through to direct URL */ }
  worker = new Worker(effectiveWorkerUrl, { type: 'module' });
  worker.postMessage({ type: 'init', config: cfg, port: channel.port2 }, [channel.port2]);

  ui = mountWidget({
    onSend: text => {
      dispatchUserPrompt(text);
    },
    onRequestControl: () => {
      const claimed = sessionCoordinator?.requestControl() ?? false;
      if (!claimed) {
        appendUiMessage('system', 'Unable to acquire control right now. Try again in a moment.', true);
      } else {
        appendTimelineEvent({
          kind: 'status',
          title: 'Control requested',
          detail: 'This tab is now the active Rover controller.',
          status: 'info',
        });
      }
    },
    onCancelRun: () => {
      if (runtimeState?.pendingRun) {
        worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
        sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
        sessionCoordinator?.setActiveRun(undefined);
        setPendingRun(undefined);
        setUiStatus('Task cancelled.');
        appendUiMessage('system', 'Task cancelled.', true);
      }
    },
    onNewTask: () => {
      newTask({ reason: 'manual_new_task', clearUi: true });
    },
    onEndTask: () => {
      endTask({ reason: 'manual_end_task' });
    },
    onTaskSuggestionPrimary: () => {
      const suggestion = pendingTaskSuggestion;
      if (!suggestion) return;
      dispatchUserPrompt(suggestion.text, {
        bypassSuggestion: true,
        startNewTask: true,
        reason: suggestion.reason,
      });
    },
    onTaskSuggestionSecondary: () => {
      const suggestion = pendingTaskSuggestion;
      if (!suggestion) return;
      dispatchUserPrompt(suggestion.text, {
        bypassSuggestion: true,
      });
    },
    showTaskControls: cfg.ui?.showTaskControls !== false,
    muted: cfg.ui?.muted,
    agent: {
      name: cfg.ui?.agent?.name,
    },
    mascot: {
      disabled: cfg.ui?.mascot?.disabled,
      mp4Url: cfg.ui?.mascot?.mp4Url,
      webmUrl: cfg.ui?.mascot?.webmUrl,
    },
    onOpen: () => {
      if (runtimeState) {
        runtimeState.uiOpen = true;
        runtimeState.uiHidden = false;
        persistRuntimeState();
      }
      emit('open');
    },
    onClose: () => {
      if (runtimeState) {
        runtimeState.uiOpen = false;
        persistRuntimeState();
      }
      emit('close');
    },
  });

  hideTaskSuggestion();

  if (runtimeState?.uiMessages?.length) {
    replayUiMessages(runtimeState.uiMessages);
  }
  if (runtimeState?.timeline?.length) {
    replayTimeline(runtimeState.timeline);
  }
  if (runtimeState?.uiStatus) {
    ui.setStatus(runtimeState.uiStatus);
  }
  if (runtimeState?.executionMode) {
    ui.setExecutionMode(runtimeState.executionMode, {
      localLogicalTabId: sessionCoordinator?.getLocalLogicalTabId(),
      activeLogicalTabId: sessionCoordinator?.getActiveLogicalTabId(),
      controllerRuntimeId: sessionCoordinator?.getCurrentHolderRuntimeId(),
      canTakeControl: true,
      canComposeInObserver: canComposeInObserverMode(),
      note: resolveExecutionModeNote(runtimeState.executionMode),
    });
  }

  worker.onmessage = ev => {
    handleWorkerMessage(ev.data || {});
  };

  // Navigation tracking: detect SPA navigations and broadcast to other tabs
  if (sessionCoordinator) {
    const navigationHandler = () => {
      sessionCoordinator?.registerCurrentTab(window.location.href, document.title);
      sessionCoordinator?.broadcastNavigation(window.location.href, document.title);
    };

    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);
    history.pushState = function (...args: Parameters<typeof origPushState>) {
      const result = origPushState(...args);
      setTimeout(navigationHandler, 0);
      return result;
    };
    history.replaceState = function (...args: Parameters<typeof origReplaceState>) {
      const result = origReplaceState(...args);
      setTimeout(navigationHandler, 0);
      return result;
    };
    window.addEventListener('popstate', navigationHandler);
  }

  if (runtimeState?.uiHidden) {
    ui.hide();
  } else {
    ui.show();
    const shouldOpen = runtimeState?.uiOpen ?? !!cfg.openOnInit;
    if (shouldOpen) ui.open();
    else ui.close();
  }

  if (runtimeState) {
    runtimeState.uiHidden = !!runtimeState.uiHidden;
    runtimeState.uiOpen = !!runtimeState.uiOpen;
    persistRuntimeState();
  }

  if (sessionCoordinator) {
    applyCoordinatorState(sessionCoordinator.getState(), 'remote');
    setExecutionMode(sessionCoordinator.getRole(), {
      localLogicalTabId: sessionCoordinator.getLocalLogicalTabId(),
      activeLogicalTabId: sessionCoordinator.getActiveLogicalTabId(),
      holderRuntimeId: sessionCoordinator.getCurrentHolderRuntimeId(),
    });
  }
}

export function boot(cfg: RoverInit): RoverInstance {
  if (instance) {
    update(cfg);
    return instance;
  }

  runtimeStateStore = createRuntimeStateStore<PersistedRuntimeState>();
  runtimeId = getOrCreateRuntimeId(cfg.siteId);
  resolvedVisitorId = resolveVisitorId(cfg);
  runtimeStorageKey = getRuntimeStateKey(cfg.siteId);
  const loaded = loadPersistedState(runtimeStorageKey);
  const desiredSessionId = cfg.sessionId?.trim();
  const visitorSessionId =
    !desiredSessionId && !loaded?.sessionId && cfg.sessionScope !== 'tab' && resolvedVisitorId
      ? createVisitorSessionId(cfg.siteId, resolvedVisitorId)
      : undefined;
  const fallbackSessionId = desiredSessionId || loaded?.sessionId || visitorSessionId || crypto.randomUUID();

  runtimeState = normalizePersistedState(loaded, fallbackSessionId, runtimeId);

  if (desiredSessionId && runtimeState.sessionId !== desiredSessionId) {
    runtimeState = createDefaultRuntimeState(desiredSessionId, runtimeId);
  }

  currentConfig = {
    ...cfg,
    visitorId: resolvedVisitorId || cfg.visitorId,
    sessionId: desiredSessionId || runtimeState.sessionId,
    taskRouting: {
      mode: cfg.taskRouting?.mode || 'act',
      actHeuristicThreshold: cfg.taskRouting?.actHeuristicThreshold,
      plannerOnActError: cfg.taskRouting?.plannerOnActError,
    },
    taskContext: {
      ...cfg.taskContext,
    },
  };

  runtimeState.sessionId = currentConfig.sessionId!;
  runtimeState.runtimeId = runtimeId;
  runtimeState.executionMode = runtimeState.executionMode || 'controller';
  runtimeState.timeline = sanitizeTimelineEvents(runtimeState.timeline);
  runtimeState.uiMessages = sanitizeUiMessages(runtimeState.uiMessages);
  runtimeState.activeTask = sanitizeTask(runtimeState.activeTask, createDefaultTaskState('boot'));
  runtimeState.taskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
  currentMode = runtimeState.executionMode;
  persistRuntimeState();

  // Mark this tab as alive — sessionStorage survives refresh but is cleared on tab close
  try { sessionStorage.setItem(`rover:tab-alive:${cfg.siteId}`, '1'); } catch { /* ignore */ }

  workerReady = false;
  autoResumeAttempted = false;

  createRuntime(currentConfig);
  if (runtimeStorageKey) {
    void applyAsyncRuntimeStateHydration(runtimeStorageKey);
  }
  ensureUnloadHandler();

  instance = {
    boot,
    init,
    update,
    shutdown,
    open,
    close,
    show,
    hide,
    send,
    newTask,
    endTask,
    getState,
    registerTool,
    on,
  };

  if (pendingToolRegistrations.length) {
    for (const pending of pendingToolRegistrations) {
      applyToolRegistration(pending);
    }
    pendingToolRegistrations.length = 0;
  }

  return instance;
}

export function init(cfg: RoverInit): RoverInstance {
  return boot(cfg);
}

export function update(cfg: Partial<RoverInit>): void {
  if (!instance || !worker || !currentConfig) return;
  currentConfig = {
    ...currentConfig,
    ...cfg,
    taskRouting: {
      ...currentConfig.taskRouting,
      ...cfg.taskRouting,
    },
    taskContext: {
      ...currentConfig.taskContext,
      ...cfg.taskContext,
    },
    ui: {
      ...currentConfig.ui,
      ...cfg.ui,
      agent: {
        ...currentConfig.ui?.agent,
        ...cfg.ui?.agent,
      },
      panel: {
        ...currentConfig.ui?.panel,
        ...cfg.ui?.panel,
      },
    },
    tools: {
      ...currentConfig.tools,
      ...cfg.tools,
      client: cfg.tools?.client ?? currentConfig.tools?.client,
      web: {
        ...currentConfig.tools?.web,
        ...cfg.tools?.web,
      },
    },
  };
  resolvedVisitorId = resolveVisitorId(currentConfig);
  if (resolvedVisitorId) {
    currentConfig.visitorId = resolvedVisitorId;
  }

  if (cfg.sessionId && runtimeState) {
    runtimeState.sessionId = cfg.sessionId;
    persistRuntimeState();
    setupSessionCoordinator(currentConfig);
  } else if (cfg.sessionScope || cfg.tabPolicy) {
    setupSessionCoordinator(currentConfig);
  }

  setupCloudCheckpointing(currentConfig);
  setupTelemetry(currentConfig);

  if (bridge) {
    if (typeof cfg.allowActions === 'boolean') {
      bridge.setAllowActions(cfg.allowActions && currentMode === 'controller');
    }
    if (cfg.allowedDomains || cfg.domainScopeMode || cfg.externalNavigationPolicy) {
      bridge.setNavigationPolicy({
        allowedDomains: cfg.allowedDomains,
        domainScopeMode: cfg.domainScopeMode,
        externalNavigationPolicy: cfg.externalNavigationPolicy,
      });
    }
  }

  worker.postMessage({ type: 'update_config', config: cfg });

  if (typeof cfg.openOnInit === 'boolean') {
    if (cfg.openOnInit) open();
    else close();
  }
}

export function shutdown(): void {
  hideTaskSuggestion();
  persistRuntimeState();
  void flushTelemetry(true);
  stopTelemetry();
  cloudCheckpointClient?.markDirty();
  cloudCheckpointClient?.syncNow();
  cloudCheckpointClient?.stop();
  cloudCheckpointClient = null;
  sessionCoordinator?.stop();
  sessionCoordinator = null;

  worker?.terminate();
  worker = null;
  ui?.destroy();
  ui = null;
  bridge = null;
  currentConfig = null;
  workerReady = false;
  autoResumeAttempted = false;
  runtimeId = '';
  resolvedVisitorId = undefined;
  suppressCheckpointSync = false;
  telemetryInFlight = false;
  telemetryPausedAuth = false;
  telemetryBuffer = [];
  telemetrySeq = 0;
  currentMode = 'controller';
  pendingTaskSuggestion = null;
  runtimeStateStore = null;
  instance = null;
}

export function open(): void {
  ui?.show();
  ui?.open();
  if (runtimeState) {
    runtimeState.uiHidden = false;
    runtimeState.uiOpen = true;
    persistRuntimeState();
  }
}

export function close(): void {
  ui?.close();
  if (runtimeState) {
    runtimeState.uiOpen = false;
    persistRuntimeState();
  }
}

export function show(): void {
  ui?.show();
  if (runtimeState) {
    runtimeState.uiHidden = false;
    persistRuntimeState();
  }
}

export function hide(): void {
  ui?.hide();
  if (runtimeState) {
    runtimeState.uiHidden = true;
    runtimeState.uiOpen = false;
    persistRuntimeState();
  }
}

export function send(text: string): void {
  if (!text?.trim()) return;
  dispatchUserPrompt(text);
}

export function newTask(options?: { reason?: string; clearUi?: boolean }): void {
  if (!runtimeState) return;

  const reason = options?.reason || 'manual_new_task';
  const clearUi = options?.clearUi !== false;
  const taskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1) + 1;
  const nextTask = createDefaultTaskState(reason);

  // Cancel any running task in the worker
  if (runtimeState.pendingRun) {
    worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
    sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
  }

  autoResumeAttempted = false;
  runtimeState.taskEpoch = taskEpoch;
  runtimeState.activeTask = nextTask;
  runtimeState.pendingRun = undefined;
  runtimeState.workerState = undefined;

  if (clearUi) {
    runtimeState.uiMessages = [];
    runtimeState.timeline = [];
    runtimeState.uiStatus = undefined;
    clearTaskUiState();
  }

  sessionCoordinator?.startNewTask({
    taskId: nextTask.taskId,
    startedAt: nextTask.startedAt,
    boundaryReason: reason,
    status: 'running',
    lastUserAt: undefined,
    lastAssistantAt: undefined,
  });
  sessionCoordinator?.setActiveRun(undefined);
  sessionCoordinator?.setWorkerContext(undefined);
  setUiStatus('New task started.');
  persistRuntimeState();

  worker?.postMessage({ type: 'start_new_task', taskId: nextTask.taskId });
  appendTimelineEvent({
    kind: 'info',
    title: 'Started new task',
    detail: reason,
    status: 'info',
  });
  emit('task_started', {
    taskId: nextTask.taskId,
    reason,
    taskEpoch,
  });
}

export function endTask(options?: { reason?: string }): void {
  if (!runtimeState) return;
  const reason = options?.reason || 'manual_end_task';
  const task = ensureActiveTask('manual_end_task');
  if (!task) return;

  task.status = 'ended';
  task.endedAt = Date.now();
  task.boundaryReason = reason;
  if (runtimeState.pendingRun) {
    worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
    sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
  }
  runtimeState.pendingRun = undefined;
  hideTaskSuggestion();
  setUiStatus('Task ended. Start a new task to continue.');
  sessionCoordinator?.endTask(reason);
  sessionCoordinator?.setActiveRun(undefined);
  persistRuntimeState();

  appendTimelineEvent({
    kind: 'info',
    title: 'Task ended',
    detail: 'Start a new task when you are ready.',
    status: 'info',
  });
  emit('task_ended', {
    taskId: task.taskId,
    reason,
    endedAt: task.endedAt,
  });
}

export function getState(): any {
  return {
    mode: currentMode,
    runtimeId,
    runtimeState: runtimeState ? cloneRuntimeStateForCheckpoint(runtimeState) : null,
    sharedState: sessionCoordinator?.getState() || null,
    pendingTaskSuggestion,
  };
}

export function registerTool(
  nameOrDef: string | ClientToolDefinition,
  handler: (args: any) => any | Promise<any>,
): void {
  const def = toToolDef(nameOrDef);
  if (!instance || !bridge || !worker) {
    pendingToolRegistrations.push({ def, handler });
    return;
  }
  applyToolRegistration({ def, handler });
}

function normalizeCommandName(command: string): keyof RoverInstance | undefined {
  if (!command) return undefined;
  const c = String(command);
  if (c === 'init') return 'init';
  if (c === 'boot') return 'boot';
  if (c === 'update') return 'update';
  if (c === 'shutdown') return 'shutdown';
  if (c === 'open') return 'open';
  if (c === 'close') return 'close';
  if (c === 'show') return 'show';
  if (c === 'hide') return 'hide';
  if (c === 'send') return 'send';
  if (c === 'newTask') return 'newTask';
  if (c === 'endTask') return 'endTask';
  if (c === 'getState') return 'getState';
  if (c === 'registerTool') return 'registerTool';
  if (c === 'on') return 'on';
  return undefined;
}

type RoverGlobalFn = ((command: string, ...args: any[]) => any) & Partial<RoverInstance> & { q?: any[]; l?: number };

export function installGlobal(): void {
  const w = window as any;
  const existing = w.rover;

  const apiFn = ((command: string, ...args: any[]) => {
    const name = normalizeCommandName(command);
    const target = name ? (apiFn as any)[name] : undefined;
    if (typeof target === 'function') {
      return target(...args);
    }
  }) as RoverGlobalFn;

  apiFn.boot = boot;
  apiFn.init = init;
  apiFn.update = update;
  apiFn.shutdown = shutdown;
  apiFn.open = open;
  apiFn.close = close;
  apiFn.show = show;
  apiFn.hide = hide;
  apiFn.send = send;
  apiFn.newTask = newTask;
  apiFn.endTask = endTask;
  apiFn.getState = getState;
  apiFn.registerTool = registerTool;
  apiFn.on = on;

  w.rover = apiFn;

  if (typeof existing === 'function' && Array.isArray(existing.q)) {
    for (const call of existing.q) {
      const [method, ...args] = Array.isArray(call) ? call : Array.from(call as any);
      if (typeof method === 'string') {
        apiFn(method, ...args);
      }
    }
  }

  // Auto-boot from data attributes on the script element
  if (!instance) {
    const scriptEl: HTMLScriptElement | null =
      typeof (globalThis as any).__ROVER_SCRIPT_EL__ !== 'undefined'
        ? (globalThis as any).__ROVER_SCRIPT_EL__
        : null;

    if (scriptEl) {
      const dataSiteId = scriptEl.getAttribute('data-site-id');
      const dataApiKey = scriptEl.getAttribute('data-api-key');

      if (dataSiteId && dataApiKey) {
        const dataConfig: RoverInit = {
          siteId: dataSiteId,
          apiKey: dataApiKey,
        };

        const dataAllowedDomains = scriptEl.getAttribute('data-allowed-domains');
        if (dataAllowedDomains) {
          dataConfig.allowedDomains = dataAllowedDomains.split(',').map((d) => d.trim()).filter(Boolean);
        }

        const dataSiteKeyId = scriptEl.getAttribute('data-site-key-id');
        if (dataSiteKeyId) dataConfig.siteKeyId = dataSiteKeyId;

        const dataWorkerUrl = scriptEl.getAttribute('data-worker-url');
        if (dataWorkerUrl) dataConfig.workerUrl = dataWorkerUrl;

        boot(dataConfig);
      }
    }
  }
}

installGlobal();
