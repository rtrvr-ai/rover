import { Bridge } from '@rover/bridge';
import { bindRpc } from '@rover/bridge';
import {
  mountWidget,
  type RoverAskUserAnswerMeta,
  type RoverAskUserQuestion,
  type RoverExecutionMode,
  type RoverMessageBlock,
  type RoverShortcut,
  type RoverTimelineEvent,
  type RoverUi,
} from '@rover/ui';
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
import {
  writeCrossDomainResumeCookie,
  readCrossDomainResumeCookie,
  clearCrossDomainResumeCookie,
  type CrossDomainResumeData,
} from './crossDomainResume.js';
import type {
  PersistedPendingRun,
  PersistedRuntimeState,
  PersistedTaskState,
  PersistedTimelineEvent,
  PersistedUiMessage,
  PersistedWorkerState,
  UiRole,
} from './runtimeTypes.js';
import {
  canAutoResumePendingRun,
  shouldAdoptSnapshotActiveRun,
  shouldClearPendingFromSharedState,
  shouldIgnoreRunScopedMessage,
  shouldStartFreshTask as shouldStartFreshTaskByStatus,
} from './taskLifecycleGuards.js';

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
  navigation?: {
    crossHostPolicy?: 'open_new_tab' | 'same_tab';
  };
  task?: {
    autoResumePolicy?: 'auto' | 'confirm' | 'never';
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
  visitor?: {
    name?: string;
    email?: string;
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
    shortcuts?: RoverShortcut[];
    muted?: boolean;
    thoughtStyle?: 'concise_cards' | 'minimal';
    panel?: {
      resizable?: boolean;
    };
    showTaskControls?: boolean;
    greeting?: {
      text?: string;
      delay?: number;
      duration?: number;
      disabled?: boolean;
    };
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
  identify: (visitor: { name?: string; email?: string }) => void;
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
const SHORTCUTS_CACHE_TTL_MS = 5 * 60_000;
const SHORTCUTS_MAX_STORED = 100;
const SHORTCUTS_MAX_RENDERED = 12;
const SHORTCUT_LABEL_MAX_CHARS = 80;
const SHORTCUT_DESCRIPTION_MAX_CHARS = 200;
const SHORTCUT_PROMPT_MAX_CHARS = 700;
const SHORTCUT_ICON_MAX_CHARS = 8;
const GREETING_TEXT_MAX_CHARS = 240;

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
let resolvedVisitor: { name?: string; email?: string } | undefined = undefined;
let greetingDismissed = false;
let greetingShownInSession = false;
let greetingShowTimer: ReturnType<typeof setTimeout> | null = null;
let greetingAutoDismissTimer: ReturnType<typeof setTimeout> | null = null;
type RoverShortcutLimits = {
  shortcutMaxStored: number;
  shortcutMaxRendered: number;
};
let backendSiteConfig: {
  shortcuts: RoverShortcut[];
  greeting?: { text?: string; delay?: number; duration?: number; disabled?: boolean };
  limits?: RoverShortcutLimits;
  version?: string;
} | null = null;
let suppressCheckpointSync = false;
let currentMode: RoverExecutionMode = 'controller';
let workerReady = false;
let autoResumeAttempted = false;
let runSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let unloadHandlerInstalled = false;
type PendingTaskSuggestion =
  | { kind: 'task_reset'; text: string; reason: string; createdAt: number }
  | { kind: 'resume_run'; runId: string; text: string; createdAt: number };
let pendingTaskSuggestion: PendingTaskSuggestion | null = null;
let lastStatusSignature = '';
let lastUserInputText: string | undefined;
const latestAssistantByRunId = new Map<string, string>();
const ignoredRunIds = new Set<string>();
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

function syncVisitorToAllStores(siteId: string, visitor: { name?: string; email?: string }): void {
  if (runtimeState) {
    runtimeState.visitor = visitor;
    persistRuntimeState();
  }
  try { localStorage.setItem(`rover:visitor:${siteId}`, JSON.stringify(visitor)); } catch { /* ignore */ }
}

function loadPersistedVisitor(siteId: string): { name?: string; email?: string } | undefined {
  if (runtimeState?.visitor?.name || runtimeState?.visitor?.email) {
    return runtimeState.visitor;
  }
  try {
    const raw = localStorage.getItem(`rover:visitor:${siteId}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
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

function normalizeCrossHostPolicy(policy?: 'open_new_tab' | 'same_tab'): 'open_new_tab' | 'same_tab' {
  if (policy === 'same_tab' || policy === 'open_new_tab') return policy;
  return 'same_tab';
}

function resolveActionGateReason(mode: 'controller' | 'observer', allowActions: boolean): string {
  if (mode === 'observer') {
    return 'This tab is in observer mode because another tab currently holds Rover action control.';
  }
  if (!allowActions) {
    return 'Actions are disabled by configuration (allowActions=false).';
  }
  return 'Controller tab ready for actions.';
}

function normalizeTaskAutoResumePolicy(policy?: 'auto' | 'confirm' | 'never'): 'auto' | 'confirm' | 'never' {
  if (policy === 'auto' || policy === 'confirm' || policy === 'never') return policy;
  return 'confirm';
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

const DEFAULT_EXTENSION_ROUTER_BASE = 'https://extensionrouter.rtrvr.ai';

function resolveExtensionRouterEndpoint(apiBase?: string): string {
  const fallback = DEFAULT_EXTENSION_ROUTER_BASE;
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter')) return base;
  try {
    const parsed = new URL(base);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname && pathname !== '/') return base;
    if (parsed.hostname.toLowerCase() === 'extensionrouter.rtrvr.ai') return base;
  } catch {
    // no-op: fallback to legacy suffix behavior
  }
  return `${base}/extensionRouter`;
}

function getTelemetryEndpoint(cfg: RoverInit): string {
  return resolveExtensionRouterEndpoint(cfg.apiBase);
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

function addIgnoredRunId(runId?: string): void {
  if (!runId) return;
  ignoredRunIds.add(runId);
  while (ignoredRunIds.size > 80) {
    const oldest = ignoredRunIds.values().next().value;
    if (!oldest) break;
    ignoredRunIds.delete(oldest);
  }
}

function removeIgnoredRunId(runId?: string): void {
  if (!runId) return;
  ignoredRunIds.delete(runId);
}

function isTaskRunning(): boolean {
  return runtimeState?.activeTask?.status === 'running';
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
  return shouldIgnoreRunScopedMessage({
    type,
    messageRunId,
    pendingRunId: getPendingRunId(),
    sharedActiveRunId: sessionCoordinator?.getState()?.activeRun?.runId,
    taskStatus: runtimeState?.activeTask?.status,
    ignoredRunIds,
  });
}

function normalizeAskUserQuestions(input: any): RoverAskUserQuestion[] {
  if (!Array.isArray(input)) return [];
  const out: RoverAskUserQuestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object') continue;
    const key = String(raw.key || raw.id || '').trim() || `clarification_${i + 1}`;
    const query = String(raw.query || raw.question || '').trim();
    if (!query) continue;
    const hasRequired = typeof raw.required === 'boolean';
    const hasOptional = typeof raw.optional === 'boolean';
    const required = hasRequired ? !!raw.required : (hasOptional ? !raw.optional : true);
    const dedupeKey = `${key}::${query}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const normalized: RoverAskUserQuestion = {
      key,
      query,
      ...(typeof raw.id === 'string' && raw.id.trim() ? { id: raw.id.trim() } : {}),
      ...(typeof raw.question === 'string' && raw.question.trim() ? { question: raw.question.trim() } : {}),
      ...(Array.isArray(raw.choices) ? { choices: raw.choices } : {}),
    };
    if (!required) {
      (normalized as any).required = false;
    }
    out.push(normalized);
  }
  return out.slice(0, 6);
}

function normalizeRunCompletionState(msg: any): { taskComplete: boolean; needsUserInput: boolean; questions?: RoverAskUserQuestion[] } {
  if (!msg || typeof msg !== 'object') {
    return { taskComplete: false, needsUserInput: false };
  }
  const needsUserInput = msg.needsUserInput === true;
  const taskComplete = msg.taskComplete === true && !needsUserInput;
  const questions = normalizeAskUserQuestions(msg.questions);
  return { taskComplete, needsUserInput, ...(questions.length ? { questions } : {}) };
}

function getLatestAssistantText(runId?: string): string | undefined {
  if (runId && latestAssistantByRunId.has(runId)) {
    return latestAssistantByRunId.get(runId);
  }

  if (!runtimeState?.uiMessages?.length) return undefined;
  for (let i = runtimeState.uiMessages.length - 1; i >= 0; i -= 1) {
    const message = runtimeState.uiMessages[i];
    if (message.role === 'assistant') {
      if (message.text) return message.text;
      const fromBlocks = deriveTextFromMessageBlocks(message.blocks);
      if (fromBlocks) return fromBlocks;
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

function sanitizeMessageBlocks(input: any): RoverMessageBlock[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: RoverMessageBlock[] = [];

  for (const block of input) {
    if (!block || typeof block !== 'object') continue;
    const type = block.type;

    if (type === 'text') {
      const text = String(block.text || '');
      if (!text) continue;
      out.push({ type: 'text', text });
      continue;
    }

    if (type === 'tool_output' || type === 'json') {
      out.push({
        type,
        data: cloneUnknown(block.data),
        label: typeof block.label === 'string' ? block.label : undefined,
        toolName: typeof block.toolName === 'string' ? block.toolName : undefined,
      });
    }
  }

  return out.length ? out : undefined;
}

function isSingleTextWrapperObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length !== 1) return false;
  const [key, raw] = entries[0];
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const textKeys = new Set(['response', 'message', 'summary', 'text', 'content', 'result', 'description']);
  return textKeys.has(key);
}

function shouldAttachStructuredBlock(output: unknown, summaryText?: string): boolean {
  if (output == null) return false;
  if (typeof output === 'string') {
    const clean = output.trim();
    if (!clean) return false;
    return !summaryText || clean !== summaryText.trim();
  }
  if (Array.isArray(output)) {
    const meaningful = output.filter(item => item !== undefined && item !== null);
    if (meaningful.length === 1) {
      const first = meaningful[0];
      if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') {
        return false;
      }
      if (isSingleTextWrapperObject(first)) {
        return false;
      }
    }
    return true;
  }
  if (isSingleTextWrapperObject(output)) {
    return false;
  }
  return true;
}

function deriveTextFromMessageBlocks(blocks?: RoverMessageBlock[]): string | undefined {
  if (!Array.isArray(blocks) || !blocks.length) return undefined;
  const textParts = blocks
    .filter((block): block is Extract<RoverMessageBlock, { type: 'text' }> => block.type === 'text')
    .map(block => String(block.text || '').trim())
    .filter(Boolean);
  if (textParts.length) return textParts.join('\n\n');

  const firstStructured = blocks.find(
    (block): block is Extract<RoverMessageBlock, { type: 'tool_output' | 'json' }> =>
      block.type === 'tool_output' || block.type === 'json',
  );
  if (!firstStructured) return undefined;

  if (Array.isArray(firstStructured.data)) {
    return `Received ${firstStructured.data.length} item(s).`;
  }
  if (firstStructured.data && typeof firstStructured.data === 'object') {
    return `Received ${Object.keys(firstStructured.data as Record<string, unknown>).length} field(s).`;
  }
  return typeof firstStructured.data === 'string' ? firstStructured.data : String(firstStructured.data ?? 'Done.');
}

function buildToolResultBlocks(result: any): RoverMessageBlock[] | undefined {
  if (result == null) return undefined;
  const output =
    result?.output
    ?? result?.generatedContentRef
    ?? result?.schemaHeaderSheetInfo
    ?? result;
  const summary = deriveTextFromMessageBlocks(
    sanitizeMessageBlocks([{ type: 'tool_output', data: output }]),
  );
  if (!shouldAttachStructuredBlock(output, summary)) {
    return undefined;
  }
  return sanitizeMessageBlocks([
    {
      type: 'tool_output',
      label: typeof result?.name === 'string' ? `${result.name} output` : 'Tool output',
      data: output,
    },
  ]);
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
      text: String(message?.text || ''),
      blocks: sanitizeMessageBlocks(message?.blocks),
      ts: Number(message?.ts) || Date.now(),
      sourceRuntimeId: typeof message?.sourceRuntimeId === 'string' ? message.sourceRuntimeId : undefined,
    });
  }

  return out.filter(message => !!message.text || !!message.blocks?.length);
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
      detail: event?.detail ? String(event.detail) : undefined,
      detailBlocks: sanitizeMessageBlocks(event?.detailBlocks),
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
  const pendingQuestions = normalizeAskUserQuestions(input?.pendingAskUser?.questions);
  const pendingAskUser: PersistedWorkerState['pendingAskUser'] = pendingQuestions.length
    ? {
        questions: pendingQuestions,
        source: (input?.pendingAskUser?.source === 'planner' ? 'planner' : 'act') as 'act' | 'planner',
        askedAt: Number(input?.pendingAskUser?.askedAt) || Date.now(),
      }
    : undefined;

  return {
    trajectoryId: typeof input.trajectoryId === 'string' ? input.trajectoryId : undefined,
    history,
    plannerHistory,
    agentPrevSteps,
    lastToolPreviousSteps: agentPrevSteps,
    pendingAskUser,
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
}

function normalizePersistedState(raw: PersistedRuntimeState | null, sessionId: string, rid: string): PersistedRuntimeState {
  if (!raw || typeof raw !== 'object') {
    return createDefaultRuntimeState(sessionId, rid);
  }

  const fallbackTask = createDefaultTaskState();
  const parsedTask = sanitizeTask(raw.activeTask, fallbackTask);
  const parsedPendingRun = sanitizePendingRun(raw.pendingRun);
  const pendingRun = parsedTask.status === 'running' ? parsedPendingRun : undefined;

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
    pendingRun,
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
  const pendingQuestions = normalizeAskUserQuestions(state.pendingAskUser?.questions);
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
    pendingAskUser: pendingQuestions.length
      ? {
          questions: pendingQuestions,
          source: state.pendingAskUser?.source === 'planner' ? 'planner' : 'act',
          askedAt: Number(state.pendingAskUser?.askedAt) || Date.now(),
        }
      : undefined,
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
    resumeRequired: input.resumeRequired === true,
    resumeReason:
      input.resumeReason === 'cross_host_navigation'
      || input.resumeReason === 'agent_navigation'
      || input.resumeReason === 'handoff'
      || input.resumeReason === 'page_reload'
        ? input.resumeReason
        : undefined,
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
      const markedPending = sanitizePendingRun({
        ...runtimeState.pendingRun,
        resumeRequired: true,
        resumeReason: runtimeState.pendingRun.resumeReason || 'page_reload',
      });
      runtimeState.pendingRun = markedPending;
      if (markedPending) {
        sessionCoordinator?.clearActiveRunRuntimeId(markedPending.id);
      }
    }
    sessionCoordinator?.broadcastClosing();
    if (runtimeState?.pendingRun) {
      sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
    }
    persistRuntimeState();
    // Write cross-domain resume cookie if there's a pending run —
    // covers user-initiated cross-host navigation where Bridge can't intercept.
    if (runtimeState?.pendingRun && currentConfig?.siteId) {
      writeCrossDomainResumeCookie(currentConfig.siteId, {
        sessionId: runtimeState.sessionId,
        pendingRun: {
          id: runtimeState.pendingRun.id,
          text: runtimeState.pendingRun.text,
          startedAt: runtimeState.pendingRun.startedAt,
          attempts: runtimeState.pendingRun.attempts,
        },
        activeTask: runtimeState.activeTask
          ? { taskId: runtimeState.activeTask.taskId, status: runtimeState.activeTask.status }
          : undefined,
        taskEpoch: runtimeState.taskEpoch,
        timestamp: Date.now(),
      });
    }
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
  if (role === 'system') return;
  const task = ensureActiveTask('implicit');
  if (!task) return;
  if (task.status !== 'running') return;

  if (role === 'user') task.lastUserAt = timestamp;
  if (role === 'assistant') task.lastAssistantAt = timestamp;
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

function showResumeSuggestion(pending: PersistedPendingRun): void {
  pendingTaskSuggestion = {
    kind: 'resume_run',
    runId: pending.id,
    text: pending.text,
    createdAt: Date.now(),
  };
  ui?.setTaskSuggestion({
    visible: true,
    text: 'Previous task was interrupted by navigation. Resume it?',
    primaryLabel: 'Resume',
    secondaryLabel: 'Start fresh',
  });
  setUiStatus('Task paused after navigation. Resume to continue.');
}

function clearTaskUiState(): void {
  ui?.clearMessages();
  ui?.clearTimeline();
  ui?.setQuestionPrompt(undefined);
  hideTaskSuggestion();
}

function syncQuestionPromptFromWorkerState(): void {
  const questions = normalizeAskUserQuestions(runtimeState?.workerState?.pendingAskUser?.questions);
  if (!questions.length) {
    ui?.setQuestionPrompt(undefined);
    return;
  }
  ui?.setQuestionPrompt({ questions });
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

  addIgnoredRunId(pending.id);
  setPendingRun(undefined);
  sessionCoordinator?.clearActiveRunRuntimeId(pending.id);
  sessionCoordinator?.releaseWorkflowLock(pending.id);
  sessionCoordinator?.setActiveRun(undefined);
}

function appendUiMessage(
  role: UiRole,
  text: string,
  persist = true,
  options?: { id?: string; ts?: number; sourceRuntimeId?: string; publishShared?: boolean; blocks?: RoverMessageBlock[] },
): PersistedUiMessage | undefined {
  const clean = String(text || '');
  const blocks = sanitizeMessageBlocks(options?.blocks);
  if (!clean && (!blocks || blocks.length === 0)) return undefined;

  const message: PersistedUiMessage = {
    id: options?.id || createId('msg'),
    role,
    text: clean,
    blocks,
    ts: options?.ts || Date.now(),
    sourceRuntimeId: options?.sourceRuntimeId,
  };

  ui?.addMessage(message.role, message.text, { blocks: message.blocks });

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
      blocks: message.blocks,
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
      blocks: message.blocks,
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
    detail: event.detail ? String(event.detail) : undefined,
    detailBlocks: sanitizeMessageBlocks(event.detailBlocks),
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
      detailBlocks: timelineEvent.detailBlocks,
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
        detailBlocks: event.detailBlocks,
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
  persistRuntimeState();
}

function postRun(
  text: string,
  options?: {
    runId?: string;
    resume?: boolean;
    appendUserMessage?: boolean;
    autoResume?: boolean;
    routing?: 'auto' | 'act' | 'planner';
    askUserAnswers?: RoverAskUserAnswerMeta;
  },
): void {
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
  removeIgnoredRunId(runId);

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
    resumeRequired: false,
    resumeReason: undefined,
  });
  markTaskRunning(resume ? 'worker_task_resumed' : 'worker_task_active');

  lastUserInputText = trimmed;
  sessionCoordinator?.acquireWorkflowLock(runId);
  sessionCoordinator?.setActiveRun({ runId, text: trimmed });
  worker.postMessage({
    type: 'run',
    text: trimmed,
    runId,
    resume,
    routing: options?.routing,
    askUserAnswers: options?.askUserAnswers,
  });

  if (runSafetyTimer) clearTimeout(runSafetyTimer);
  const safetyRunId = runId;
  runSafetyTimer = setTimeout(() => {
    if (runtimeState?.pendingRun?.id === safetyRunId) {
      addIgnoredRunId(safetyRunId);
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
  options?: {
    bypassSuggestion?: boolean;
    startNewTask?: boolean;
    reason?: string;
    routing?: 'auto' | 'act' | 'planner';
    askUserAnswers?: RoverAskUserAnswerMeta;
  },
): void {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  maybeClearStalePendingRun();

  const activeTaskStatus = runtimeState?.activeTask?.status;
  const shouldStartFreshTask = !!options?.startNewTask || shouldStartFreshTaskByStatus(activeTaskStatus);

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
  postRun(trimmed, {
    appendUserMessage: true,
    resume: false,
    autoResume: true,
    routing: options?.routing,
    askUserAnswers: options?.askUserAnswers,
  });
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
  if (!canAutoResumePendingRun(runtimeState.activeTask?.status)) return;

  const pending = runtimeState.pendingRun;
  if (!pending.autoResume) return;
  const resumePolicy = normalizeTaskAutoResumePolicy(currentConfig?.task?.autoResumePolicy);
  if (resumePolicy === 'never') {
    addIgnoredRunId(pending.id);
    setPendingRun(undefined);
    sessionCoordinator?.setActiveRun(undefined);
    setUiStatus('Previous task dismissed after navigation.');
    return;
  }

  // Agent-initiated navigation (same-host or cross-host) bypasses stale-tab check and
  // auto-resumes without confirmation — the agent navigated, not the user.
  const isAgentInitiatedResume =
    pending.resumeReason === 'cross_host_navigation' || pending.resumeReason === 'agent_navigation';

  // sessionStorage flag distinguishes refresh (flag exists) from fresh tab (flag absent)
  const siteId = currentConfig?.siteId || '';
  const isRefresh = !!sessionStorage.getItem(`rover:tab-alive:${siteId}`);
  if (!isRefresh && !isAgentInitiatedResume) {
    // New tab (not a refresh) — check if any other tabs are alive
    const tabs = sessionCoordinator?.listTabs() || [];
    const otherAlive = tabs.some(t =>
      t.runtimeId !== runtimeId && t.updatedAt > Date.now() - 2 * 2000,
    );
    if (!otherAlive && runtimeState?.pendingRun) {
      // All tabs were closed — don't auto-resume stale task
      addIgnoredRunId(runtimeState.pendingRun.id);
      setPendingRun(undefined);
      setUiStatus('Previous task expired.');
      return;
    }
  }

  const ageMs = Date.now() - pending.startedAt;
  if (ageMs > MAX_AUTO_RESUME_AGE_MS) {
    addIgnoredRunId(pending.id);
    setPendingRun(undefined);
    setUiStatus('Previous task expired after navigation.');
    return;
  }

  if (pending.attempts >= MAX_AUTO_RESUME_ATTEMPTS) {
    addIgnoredRunId(pending.id);
    setPendingRun(undefined);
    appendUiMessage('system', 'Auto-resume stopped after too many navigation attempts.', true);
    return;
  }

  // Agent-initiated navigation (same-host or cross-host) — always auto-resume
  if (isAgentInitiatedResume) {
    autoResumeAttempted = true;
    setUiStatus('Resuming task after navigation...');
    postRun(pending.text, {
      runId: pending.id,
      resume: true,
      appendUserMessage: false,
      autoResume: true,
    });
    return;
  }

  if (resumePolicy === 'confirm') {
    autoResumeAttempted = true;
    showResumeSuggestion(pending);
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
    syncQuestionPromptFromWorkerState();
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
          blocks: message.blocks,
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
            detailBlocks: event.detailBlocks,
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

    const localTaskStatus = runtimeState.activeTask?.status;
    const remoteTaskStatus = state.task?.status;
    if (
      state.activeRun
      && state.activeRun.runtimeId !== runtimeId
      && !shouldClearPendingFromSharedState({
        localTaskStatus,
        remoteTaskStatus,
        mode: currentMode,
        hasRemoteActiveRun: true,
      })
    ) {
      setPendingRun(
        sanitizePendingRun({
          id: state.activeRun.runId,
          text: state.activeRun.text,
          startedAt: state.activeRun.startedAt,
          attempts: runtimeState.pendingRun?.attempts || 0,
          autoResume: true,
        }),
      );
    } else {
      const shouldClearPending = shouldClearPendingFromSharedState({
        localTaskStatus,
        remoteTaskStatus,
        mode: currentMode,
        hasRemoteActiveRun: !!state.activeRun,
      });
      if (shouldClearPending) {
        if (runtimeState.pendingRun?.id) {
          addIgnoredRunId(runtimeState.pendingRun.id);
        }
        setPendingRun(undefined);
      }
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
  syncQuestionPromptFromWorkerState();
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
      (bridge as any)?.setActionGateContext?.({
        mode: role,
        controllerRuntimeId: info?.holderRuntimeId ?? sessionCoordinator?.getCurrentHolderRuntimeId(),
        activeLogicalTabId: info?.activeLogicalTabId ?? sessionCoordinator?.getActiveLogicalTabId(),
        localLogicalTabId: info?.localLogicalTabId ?? sessionCoordinator?.getLocalLogicalTabId(),
        reason: resolveActionGateReason(role, allowActions),
      });
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

}

function handleWorkerMessage(msg: any): void {
  if (!msg || typeof msg !== 'object') return;
  if (shouldIgnoreRunScopedWorkerMessage(msg)) return;

  if (msg.type === 'assistant') {
    const blocks = sanitizeMessageBlocks(msg.blocks);
    const text = String(msg.text || deriveTextFromMessageBlocks(blocks) || '');
    if (typeof msg.runId === 'string' && msg.runId) {
      latestAssistantByRunId.set(msg.runId, text);
      if (latestAssistantByRunId.size > 80) {
        const oldestKey = latestAssistantByRunId.keys().next().value;
        if (oldestKey) latestAssistantByRunId.delete(oldestKey);
      }
    }
    appendUiMessage('assistant', text, true, { blocks });
    appendTimelineEvent({
      kind: 'tool_result',
      title: 'Assistant update',
      detail: text,
      detailBlocks: blocks,
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
    const detailBlocks = sanitizeMessageBlocks(msg.detailBlocks) || buildToolResultBlocks(msg.result);
    appendTimelineEvent({
      kind: 'tool_result',
      title: `${msg.call?.name || 'tool'} completed`,
      detail: safeSerialize(msg.result),
      detailBlocks,
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
      const activeRunId = typeof msg?.activeRun?.runId === 'string' && msg.activeRun.runId
        ? msg.activeRun.runId
        : undefined;
      const activeRunText = typeof msg?.activeRun?.text === 'string' ? msg.activeRun.text : undefined;
      const canAdoptActiveRun = shouldAdoptSnapshotActiveRun({
        taskStatus: runtimeState.activeTask?.status,
        hasPendingRun: !!runtimeState.pendingRun,
        activeRunId,
        activeRunText,
        ignoredRunIds,
      });
      if (canAdoptActiveRun) {
        runtimeState.pendingRun = sanitizePendingRun({
          id: activeRunId,
          text: activeRunText,
          startedAt: msg.activeRun.startedAt,
          attempts: 0,
          autoResume: true,
        });
      }
      if (activeRunId && activeRunText && canAdoptActiveRun) {
        sessionCoordinator?.setActiveRun({ runId: activeRunId, text: activeRunText });
      } else if (activeRunId && (!isTaskRunning() || ignoredRunIds.has(activeRunId))) {
        sessionCoordinator?.setActiveRun(undefined);
      }
      if (!isTaskRunning() && runtimeState.pendingRun) {
        setPendingRun(undefined);
      }
      if (runtimeState.workerState) {
        sessionCoordinator?.setWorkerContext(toSharedWorkerContext(runtimeState.workerState));
      }
      syncQuestionPromptFromWorkerState();
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
    if (!isTaskRunning()) {
      sessionCoordinator?.setActiveRun(undefined);
      return;
    }
    const existing = runtimeState?.pendingRun;
    if (typeof msg.runId === 'string' && msg.runId) {
      removeIgnoredRunId(msg.runId);
    }
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
    ui?.setQuestionPrompt(undefined);
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
    const completedRunId = typeof msg.runId === 'string' && msg.runId ? msg.runId : undefined;
    if (completedRunId) {
      addIgnoredRunId(completedRunId);
    }
    if (!msg.ok && msg.error) {
      if (completedRunId) {
        latestAssistantByRunId.delete(completedRunId);
      }
      if (!isTaskRunning()) {
        return;
      }
      ui?.setQuestionPrompt(undefined);
      markTaskRunning('worker_run_failed');
      setUiStatus(`Task failed: ${String(msg.error)}`);
      if (completedRunId) {
        latestAssistantByRunId.delete(completedRunId);
      }
      appendTimelineEvent({
        kind: 'error',
        title: 'Run failed',
        detail: String(msg.error),
        status: 'error',
      });
    } else if (msg.ok) {
      if (!isTaskRunning()) {
        return;
      }
      const completionState = normalizeRunCompletionState(msg);
      const taskComplete = completionState.taskComplete;
      const needsUserInput = completionState.needsUserInput;
      const questions = completionState.questions || normalizeAskUserQuestions(msg.questions);
      if (taskComplete) {
        ui?.setQuestionPrompt(undefined);
        markTaskCompleted('worker_task_complete');
        sessionCoordinator?.pruneTabs({
          dropRuntimeDetached: true,
          dropAllDetachedExternal: true,
        });
        setUiStatus('Task completed');
        finalizeSuccessfulRunTimeline(typeof msg.runId === 'string' ? msg.runId : undefined);
      } else {
        markTaskRunning(needsUserInput ? 'worker_waiting_for_input' : 'worker_continuation');
        if (needsUserInput && questions.length > 0) {
          ui?.setQuestionPrompt({ questions });
        } else {
          ui?.setQuestionPrompt(undefined);
        }
        setUiStatus(needsUserInput ? 'Need more input to continue' : 'Execution finished. Continue when ready.');
        appendTimelineEvent({
          kind: 'status',
          title: needsUserInput ? 'Waiting for your input' : 'Continuation available',
          detail: needsUserInput
            ? (questions.length
              ? `Please answer: ${questions.map(question => `${question.key} (${question.query})`).join('; ')}`
              : 'Planner requested more information before marking the task complete.')
            : 'Task is still active and will continue with your next message.',
          status: 'info',
        });
      }
    }
    return;
  }

  if (msg.type === 'ready') {
    workerReady = true;
    setUiStatus('ready');
    emit('ready');

    // Non-blocking: load backend shortcuts and merge with config shortcuts
    if (currentConfig) {
      loadAndMergeShortcuts(currentConfig);
    }

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

/* ── Site config: shortcuts + greeting (cache, merge, fetch) ── */

type RoverGreetingConfig = {
  text?: string;
  delay?: number;
  duration?: number;
  disabled?: boolean;
};

type RoverResolvedSiteConfig = {
  shortcuts: RoverShortcut[];
  greeting?: RoverGreetingConfig;
  limits?: RoverShortcutLimits;
  version?: string;
};

function normalizeShortcutLimit(
  input: unknown,
  options: { min: number; max: number; fallback: number },
): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return options.fallback;
  return Math.max(options.min, Math.min(options.max, Math.floor(parsed)));
}

function sanitizeSiteConfigLimits(raw: any): RoverShortcutLimits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const shortcutMaxStored = normalizeShortcutLimit(raw.shortcutMaxStored, {
    min: 1,
    max: SHORTCUTS_MAX_STORED,
    fallback: SHORTCUTS_MAX_STORED,
  });
  const shortcutMaxRendered = normalizeShortcutLimit(raw.shortcutMaxRendered, {
    min: 1,
    max: SHORTCUTS_MAX_RENDERED,
    fallback: SHORTCUTS_MAX_RENDERED,
  });
  return { shortcutMaxStored, shortcutMaxRendered };
}

function clearGreetingTimers(): void {
  if (greetingShowTimer) {
    clearTimeout(greetingShowTimer);
    greetingShowTimer = null;
  }
  if (greetingAutoDismissTimer) {
    clearTimeout(greetingAutoDismissTimer);
    greetingAutoDismissTimer = null;
  }
}

function getCachedSiteConfig(siteId: string): RoverResolvedSiteConfig | null {
  try {
    const raw = localStorage.getItem(`rover:site-config:${siteId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.ts !== 'number' || typeof parsed.data !== 'object' || !parsed.data) return null;
      if (Date.now() - parsed.ts > SHORTCUTS_CACHE_TTL_MS) return null;
      return {
        shortcuts: sanitizeShortcutList(parsed.data.shortcuts),
        greeting: sanitizeGreetingConfig(parsed.data.greeting),
        limits: sanitizeSiteConfigLimits(parsed.data.limits),
        version: typeof parsed.version === 'string' ? parsed.version : undefined,
      };
    }
  } catch {
    // no-op
  }

  // Backward-compatible fallback for older cache key.
  try {
    const raw = localStorage.getItem(`rover:shortcuts:${siteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.ts > SHORTCUTS_CACHE_TTL_MS) return null;
    return {
      shortcuts: sanitizeShortcutList(parsed.data),
    };
  } catch {
    return null;
  }
}

function setCachedSiteConfig(siteId: string, data: RoverResolvedSiteConfig): void {
  try {
    localStorage.setItem(`rover:site-config:${siteId}`, JSON.stringify({
      ts: Date.now(),
      version: data.version,
      data: {
        shortcuts: sanitizeShortcutList(data.shortcuts),
        greeting: sanitizeGreetingConfig(data.greeting),
        limits: sanitizeSiteConfigLimits(data.limits),
      },
    }));
  } catch {
    // ignore cache failures
  }
}

function sanitizeGreetingConfig(raw: any): RoverGreetingConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const next: RoverGreetingConfig = {};
  const text = String(raw.text || '').trim();
  if (text) {
    next.text = text.slice(0, GREETING_TEXT_MAX_CHARS);
  }
  const delay = Number(raw.delay);
  if (Number.isFinite(delay)) {
    next.delay = Math.max(0, Math.min(60_000, Math.floor(delay)));
  }
  const duration = Number(raw.duration);
  if (Number.isFinite(duration)) {
    next.duration = Math.max(1_200, Math.min(60_000, Math.floor(duration)));
  }
  if (typeof raw.disabled === 'boolean') {
    next.disabled = raw.disabled;
  }
  return Object.keys(next).length ? next : undefined;
}

function sanitizeShortcut(raw: any): RoverShortcut | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().slice(0, 80);
  const label = String(raw.label || '').trim().slice(0, SHORTCUT_LABEL_MAX_CHARS);
  const prompt = String(raw.prompt || '').trim().slice(0, SHORTCUT_PROMPT_MAX_CHARS);
  if (!id || !label || !prompt) return null;
  const sc: RoverShortcut = {
    id,
    label,
    prompt,
    enabled: raw.enabled !== false,
  };
  if (raw.description) sc.description = String(raw.description).trim().slice(0, SHORTCUT_DESCRIPTION_MAX_CHARS);
  if (raw.icon) sc.icon = String(raw.icon).trim().slice(0, SHORTCUT_ICON_MAX_CHARS);
  if (raw.routing === 'auto' || raw.routing === 'act' || raw.routing === 'planner') sc.routing = raw.routing;
  const order = Number(raw.order);
  if (Number.isFinite(order)) sc.order = Math.trunc(order);
  return sc;
}

function sanitizeShortcutList(raw: any): RoverShortcut[] {
  if (!Array.isArray(raw)) return [];
  const out: RoverShortcut[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= SHORTCUTS_MAX_STORED) break;
    const normalized = sanitizeShortcut(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

function sortShortcuts(shortcuts: RoverShortcut[]): RoverShortcut[] {
  return shortcuts
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aHasOrder = Number.isFinite(a.item.order);
      const bHasOrder = Number.isFinite(b.item.order);
      if (aHasOrder && bHasOrder) return Number(a.item.order) - Number(b.item.order);
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;
      return a.index - b.index;
    })
    .map(entry => entry.item);
}

function mergeShortcuts(configShortcuts: RoverShortcut[], backendShortcuts: RoverShortcut[]): RoverShortcut[] {
  const merged = new Map<string, RoverShortcut>();

  // Boot config wins conflicts.
  for (const shortcut of backendShortcuts) {
    merged.set(shortcut.id, shortcut);
  }
  for (const shortcut of configShortcuts) {
    const prev = merged.get(shortcut.id);
    merged.set(shortcut.id, prev ? { ...prev, ...shortcut } : shortcut);
  }

  return sortShortcuts(Array.from(merged.values())).slice(0, SHORTCUTS_MAX_STORED);
}

function getRenderableShortcuts(shortcuts: RoverShortcut[]): RoverShortcut[] {
  const renderLimit = normalizeShortcutLimit(backendSiteConfig?.limits?.shortcutMaxRendered, {
    min: 1,
    max: SHORTCUTS_MAX_RENDERED,
    fallback: SHORTCUTS_MAX_RENDERED,
  });
  return shortcuts
    .filter(shortcut => shortcut.enabled !== false)
    .slice(0, renderLimit);
}

function resolveEffectiveGreetingConfig(cfg: RoverInit | null): RoverGreetingConfig | undefined {
  if (!cfg) return undefined;
  const fromBackend = sanitizeGreetingConfig(backendSiteConfig?.greeting);
  const fromBoot = sanitizeGreetingConfig(cfg.ui?.greeting);
  if (!fromBackend && !fromBoot) return undefined;
  return {
    ...(fromBackend || {}),
    ...(fromBoot || {}),
  };
}

function buildGreetingText(greetingCfg: RoverGreetingConfig | undefined): string {
  const name = resolvedVisitor?.name;
  const customText = greetingCfg?.text;
  if (customText) {
    return customText.replace(/\{name\}/g, name || '').trim() || (name ? `Hey ${name}! Need any help?` : 'Hey! Need any help?');
  }
  return name ? `Hey ${name}! Need any help?` : 'Hey! Need any help?';
}

function maybeShowGreeting(): void {
  if (greetingDismissed) return;
  if (!ui || !currentConfig) return;
  if (runtimeState?.uiOpen) return;

  const greetingCfg = resolveEffectiveGreetingConfig(currentConfig);
  if (greetingCfg?.disabled === true) return;

  const sessionKey = `rover:greeting-shown:${currentConfig.siteId}`;
  try {
    if (sessionStorage.getItem(sessionKey)) {
      greetingShownInSession = true;
      return;
    }
  } catch {
    // no-op
  }
  if (greetingShownInSession) return;

  clearGreetingTimers();
  const delay = greetingCfg?.delay ?? 3000;
  const duration = greetingCfg?.duration ?? 8000;
  const text = buildGreetingText(greetingCfg);
  greetingShowTimer = setTimeout(() => {
    greetingShowTimer = null;
    if (greetingDismissed || runtimeState?.uiOpen) return;
    ui?.showGreeting(text);
    greetingShownInSession = true;
    try { sessionStorage.setItem(sessionKey, '1'); } catch { /* ignore */ }
    greetingAutoDismissTimer = setTimeout(() => {
      greetingAutoDismissTimer = null;
      ui?.dismissGreeting();
    }, duration);
  }, delay);
}

function applyEffectiveSiteConfig(cfg: RoverInit): void {
  const configShortcuts = sanitizeShortcutList(cfg.ui?.shortcuts || []);
  const backendShortcuts = sanitizeShortcutList(backendSiteConfig?.shortcuts || []);
  const merged = mergeShortcuts(configShortcuts, backendShortcuts);
  ui?.setShortcuts(getRenderableShortcuts(merged));
}

async function fetchBackendSiteConfig(cfg: RoverInit): Promise<RoverResolvedSiteConfig | null> {
  const authToken = String(cfg.authToken || cfg.apiKey || '').trim();
  if (!authToken) return null;

  const resp = await fetch(resolveExtensionRouterEndpoint(cfg.apiBase), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'roverGetSiteConfig',
      data: {
        siteId: cfg.siteId,
        siteKeyId: cfg.siteKeyId,
      },
    }),
  });
  if (!resp.ok) return null;

  const json = await resp.json();
  if (!json?.success) return null;

  const payload = (json.data?.siteConfig && typeof json.data.siteConfig === 'object')
    ? json.data.siteConfig
    : json.data;

  return {
    shortcuts: sanitizeShortcutList(payload?.shortcuts),
    greeting: sanitizeGreetingConfig(payload?.greeting),
    limits: sanitizeSiteConfigLimits(payload?.limits),
    version: payload?.version != null ? String(payload.version) : undefined,
  };
}

function loadAndMergeShortcuts(cfg: RoverInit): void {
  const cached = getCachedSiteConfig(cfg.siteId);
  if (cached) {
    backendSiteConfig = cached;
  }
  applyEffectiveSiteConfig(cfg);
  maybeShowGreeting();

  void fetchBackendSiteConfig(cfg)
    .then(siteConfig => {
      if (!siteConfig) return;
      backendSiteConfig = siteConfig;
      setCachedSiteConfig(cfg.siteId, siteConfig);
      applyEffectiveSiteConfig(cfg);
      if (!greetingDismissed) {
        const greetingCfg = resolveEffectiveGreetingConfig(cfg);
        if (greetingShownInSession && !runtimeState?.uiOpen) {
          ui?.showGreeting(buildGreetingText(greetingCfg));
        } else {
          maybeShowGreeting();
        }
      }
    })
    .catch(() => {
      // no-op; cached/boot config is already applied.
    });
}

export function identify(visitor: { name?: string; email?: string }): void {
  if (!currentConfig) return;
  const next: { name?: string; email?: string } = {
    ...resolvedVisitor,
    ...visitor,
  };
  if (next.name) next.name = String(next.name).trim().slice(0, 120);
  if (next.email) next.email = String(next.email).trim().slice(0, 240);
  resolvedVisitor = next;
  syncVisitorToAllStores(currentConfig.siteId, resolvedVisitor);
  ui?.setVisitorName(resolvedVisitor.name || '');
  if (!greetingDismissed) {
    if (greetingShownInSession && !runtimeState?.uiOpen) {
      ui?.showGreeting(buildGreetingText(resolveEffectiveGreetingConfig(currentConfig)));
    } else {
      maybeShowGreeting();
    }
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
    crossHostPolicy: normalizeCrossHostPolicy(cfg.navigation?.crossHostPolicy),
    registerOpenedTab: (payload: any) => sessionCoordinator?.registerOpenedTab(payload),
    switchToLogicalTab: (logicalTabId: number) => sessionCoordinator?.switchToLogicalTab(logicalTabId) || { ok: false, reason: 'No session coordinator' },
    listKnownTabs: () =>
      (sessionCoordinator?.listTabs() || []).map(tab => ({
        logicalTabId: tab.logicalTabId,
        runtimeId: tab.runtimeId,
        url: tab.url,
        title: tab.title,
        external: !!tab.external,
      })),
    onNavigationGuardrail: (event: any) => {
      emit('navigation_guardrail', event);
      appendTimelineEvent({
        kind: 'status',
        title: 'Navigation guardrail',
        detail: safeSerialize(event),
        status: 'info',
      });
    },
    onBeforeAgentNavigation: (_targetUrl: string) => {
      if (!runtimeState?.pendingRun) return;
      // Only mark for same-host — cross-host is handled by onBeforeCrossHostNavigation
      const currentHost = new URL(window.location.href).hostname;
      const targetHost = new URL(_targetUrl, window.location.href).hostname;
      if (currentHost === targetHost) {
        runtimeState.pendingRun = sanitizePendingRun({
          ...runtimeState.pendingRun,
          resumeRequired: true,
          resumeReason: 'agent_navigation',
        });
        persistRuntimeState();
      }
    },
    onBeforeCrossHostNavigation: (_targetUrl: string) => {
      if (!runtimeState || !currentConfig) return;
      // Mark the pending run for cross-host resume
      if (runtimeState.pendingRun) {
        runtimeState.pendingRun = sanitizePendingRun({
          ...runtimeState.pendingRun,
          resumeRequired: true,
          resumeReason: 'cross_host_navigation',
        });
      }
      // Write a cookie scoped to the registrable domain so the new origin can resume
      writeCrossDomainResumeCookie(currentConfig.siteId, {
        sessionId: runtimeState.sessionId,
        pendingRun: runtimeState.pendingRun
          ? {
              id: runtimeState.pendingRun.id,
              text: runtimeState.pendingRun.text,
              startedAt: runtimeState.pendingRun.startedAt,
              attempts: runtimeState.pendingRun.attempts,
            }
          : undefined,
        activeTask: runtimeState.activeTask
          ? {
              taskId: runtimeState.activeTask.taskId,
              status: runtimeState.activeTask.status,
            }
          : undefined,
        taskEpoch: runtimeState.taskEpoch,
        timestamp: Date.now(),
      });
      persistRuntimeState();
    },
    instrumentationOptions: cfg.mode === 'safe' ? { observeInlineMutations: false } : undefined,
  } as any);
  const initialActionGateMode = currentMode === 'observer' ? 'observer' : 'controller';
  (bridge as any)?.setActionGateContext?.({
    mode: initialActionGateMode,
    controllerRuntimeId: sessionCoordinator?.getCurrentHolderRuntimeId(),
    activeLogicalTabId: sessionCoordinator?.getActiveLogicalTabId(),
    localLogicalTabId: sessionCoordinator?.getLocalLogicalTabId(),
    reason: resolveActionGateReason(initialActionGateMode, initialAllowActions),
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
      const forceLocalExecution = params?.payload?.forceLocal === true;
      if (forceLocalExecution) {
        return bridge!.executeTool(params.call, params.payload);
      }

      // Use tab_id from tool args if specified, otherwise fall back to active tab
      const toolTabId = Number(params?.call?.args?.tab_id);
      const activeTabId = sessionCoordinator?.getActiveLogicalTabId();
      const routeTabId = (Number.isFinite(toolTabId) && toolTabId > 0) ? toolTabId : activeTabId;
      const localTabId = sessionCoordinator?.getLocalLogicalTabId();

      if (!routeTabId || routeTabId === localTabId || !sessionCoordinator) {
        return bridge!.executeTool(params.call, params.payload);
      }

      const tabs = sessionCoordinator.listTabs();
      const targetTab = tabs.find(t => t.logicalTabId === routeTabId);
      if (!targetTab) {
        return buildTabAccessToolError(
          runtimeCfg,
          { logicalTabId: routeTabId, external: true },
          'target_tab_missing',
        );
      }

      if (targetTab.external && runtimeCfg.externalNavigationPolicy !== 'allow') {
        return buildTabAccessToolError(runtimeCfg, targetTab, 'external_tab_action_blocked');
      }

      if (targetTab.runtimeId === runtimeId) {
        return bridge!.executeTool(params.call, params.payload);
      }

      if (!targetTab.runtimeId || !sessionCoordinator.isTabAlive(routeTabId)) {
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
    shortcuts: getRenderableShortcuts(sanitizeShortcutList(cfg.ui?.shortcuts || [])),
    greeting: resolveEffectiveGreetingConfig(cfg),
    visitorName: resolvedVisitor?.name,
    onShortcutClick: (shortcut) => {
      const text = String(shortcut.prompt || '').trim();
      if (!text) return;
      dispatchUserPrompt(text, { routing: shortcut.routing });
    },
    onSend: (text, meta) => {
      dispatchUserPrompt(text, {
        askUserAnswers: meta?.askUserAnswers,
      });
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
        addIgnoredRunId(runtimeState.pendingRun.id);
        worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
        sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
        sessionCoordinator?.setActiveRun(undefined);
        setPendingRun(undefined);
        if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
        ui?.setRunning(false);
        ui?.setQuestionPrompt(undefined);
        setUiStatus('Task cancelled.');
        appendUiMessage('system', 'Task cancelled.', true);
        appendTimelineEvent({
          kind: 'info',
          title: 'Run cancelled',
          status: 'info',
        });
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
      if (suggestion.kind === 'resume_run') {
        hideTaskSuggestion();
        postRun(suggestion.text, {
          runId: suggestion.runId,
          resume: true,
          appendUserMessage: false,
          autoResume: true,
        });
        return;
      }
      dispatchUserPrompt(suggestion.text, {
        bypassSuggestion: true,
        startNewTask: true,
        reason: suggestion.reason,
      });
    },
    onTaskSuggestionSecondary: () => {
      const suggestion = pendingTaskSuggestion;
      if (!suggestion) return;
      if (suggestion.kind === 'resume_run') {
        if (runtimeState?.pendingRun?.id === suggestion.runId) {
          addIgnoredRunId(suggestion.runId);
          sessionCoordinator?.releaseWorkflowLock(suggestion.runId);
          sessionCoordinator?.setActiveRun(undefined);
          setPendingRun(undefined);
        }
        if (runSafetyTimer) {
          clearTimeout(runSafetyTimer);
          runSafetyTimer = null;
        }
        hideTaskSuggestion();
        newTask({ reason: 'resume_declined_start_fresh', clearUi: true });
        return;
      }
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
      greetingDismissed = true;
      clearGreetingTimers();
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
  syncQuestionPromptFromWorkerState();
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

  maybeShowGreeting();
}

export function boot(cfg: RoverInit): RoverInstance {
  if (instance) {
    update(cfg);
    return instance;
  }

  runtimeStateStore = createRuntimeStateStore<PersistedRuntimeState>();
  runtimeId = getOrCreateRuntimeId(cfg.siteId);
  resolvedVisitorId = resolveVisitorId(cfg);
  resolvedVisitor = cfg.visitor || loadPersistedVisitor(cfg.siteId);
  greetingDismissed = false;
  greetingShownInSession = false;
  clearGreetingTimers();
  backendSiteConfig = null;
  runtimeStorageKey = getRuntimeStateKey(cfg.siteId);
  const loaded = loadPersistedState(runtimeStorageKey);

  // Check for cross-domain resume cookie (e.g. navigating from rtrvr.ai → rover.rtrvr.ai).
  // Per-origin storage is empty on the new subdomain, but the cookie carries the session ID
  // and pending run so Rover can pick up where it left off.
  const crossDomainResume = !loaded ? readCrossDomainResumeCookie(cfg.siteId) : null;
  if (crossDomainResume) {
    clearCrossDomainResumeCookie(cfg.siteId);
  }

  const desiredSessionId = cfg.sessionId?.trim();
  const visitorSessionId =
    !desiredSessionId && !loaded?.sessionId && !crossDomainResume?.sessionId && cfg.sessionScope !== 'tab' && resolvedVisitorId
      ? createVisitorSessionId(cfg.siteId, resolvedVisitorId)
      : undefined;
  const fallbackSessionId = desiredSessionId || loaded?.sessionId || crossDomainResume?.sessionId || visitorSessionId || crypto.randomUUID();

  // Seed runtime state from cross-domain cookie when no local state exists
  let effectiveLoaded = loaded;
  if (!loaded && crossDomainResume) {
    const seeded = createDefaultRuntimeState(crossDomainResume.sessionId, runtimeId);
    if (crossDomainResume.pendingRun) {
      seeded.pendingRun = sanitizePendingRun({
        ...crossDomainResume.pendingRun,
        autoResume: true,
        resumeRequired: true,
        resumeReason: 'cross_host_navigation',
      });
    }
    if (crossDomainResume.activeTask) {
      seeded.activeTask = {
        ...createDefaultTaskState('cross_domain_resume'),
        taskId: crossDomainResume.activeTask.taskId,
        status: crossDomainResume.activeTask.status as 'running' | 'completed' | 'ended',
      };
    }
    seeded.taskEpoch = crossDomainResume.taskEpoch || 1;
    // Widget was open (task was running) — preserve that across subdomain navigation
    seeded.uiOpen = true;
    effectiveLoaded = seeded;
  }

  runtimeState = normalizePersistedState(effectiveLoaded, fallbackSessionId, runtimeId);

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
    navigation: {
      crossHostPolicy: normalizeCrossHostPolicy(cfg.navigation?.crossHostPolicy),
    },
    task: {
      autoResumePolicy: normalizeTaskAutoResumePolicy(cfg.task?.autoResumePolicy),
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
  if (resolvedVisitor) syncVisitorToAllStores(cfg.siteId, resolvedVisitor);
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
    identify,
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
    navigation: {
      ...currentConfig.navigation,
      ...cfg.navigation,
      crossHostPolicy: normalizeCrossHostPolicy(cfg.navigation?.crossHostPolicy ?? currentConfig.navigation?.crossHostPolicy),
    },
    task: {
      ...currentConfig.task,
      ...cfg.task,
      autoResumePolicy: normalizeTaskAutoResumePolicy(cfg.task?.autoResumePolicy ?? currentConfig.task?.autoResumePolicy),
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

  const shouldReloadRemoteSiteConfig =
    cfg.apiBase !== undefined
    || cfg.apiKey !== undefined
    || cfg.authToken !== undefined
    || cfg.siteId !== undefined
    || cfg.siteKeyId !== undefined
    || cfg.ui?.shortcuts !== undefined
    || cfg.ui?.greeting !== undefined;

  if (bridge) {
    if (typeof cfg.allowActions === 'boolean') {
      bridge.setAllowActions(cfg.allowActions && currentMode === 'controller');
    }
    const allowActions = currentMode === 'controller' && (currentConfig?.allowActions ?? true);
    const actionGateMode = currentMode === 'observer' ? 'observer' : 'controller';
    (bridge as any)?.setActionGateContext?.({
      mode: actionGateMode,
      controllerRuntimeId: sessionCoordinator?.getCurrentHolderRuntimeId(),
      activeLogicalTabId: sessionCoordinator?.getActiveLogicalTabId(),
      localLogicalTabId: sessionCoordinator?.getLocalLogicalTabId(),
      reason: resolveActionGateReason(actionGateMode, allowActions),
    });
    if (cfg.allowedDomains || cfg.domainScopeMode || cfg.externalNavigationPolicy || cfg.navigation?.crossHostPolicy) {
      bridge.setNavigationPolicy({
        allowedDomains: cfg.allowedDomains,
        domainScopeMode: cfg.domainScopeMode,
        externalNavigationPolicy: cfg.externalNavigationPolicy,
        crossHostPolicy: cfg.navigation?.crossHostPolicy,
      } as any);
    }
  }

  worker.postMessage({ type: 'update_config', config: cfg });

  applyEffectiveSiteConfig(currentConfig);
  if (shouldReloadRemoteSiteConfig) {
    loadAndMergeShortcuts(currentConfig);
  } else {
    maybeShowGreeting();
  }

  if (cfg.visitor) {
    identify(cfg.visitor);
  }

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
  resolvedVisitor = undefined;
  greetingDismissed = false;
  greetingShownInSession = false;
  clearGreetingTimers();
  backendSiteConfig = null;
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
  greetingDismissed = true;
  clearGreetingTimers();
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
    addIgnoredRunId(runtimeState.pendingRun.id);
    worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
    sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
  }
  if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
  ui?.setRunning(false);
  ui?.setQuestionPrompt(undefined);

  autoResumeAttempted = false;
  runtimeState.taskEpoch = taskEpoch;
  runtimeState.activeTask = nextTask;
  setPendingRun(undefined);
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
    addIgnoredRunId(runtimeState.pendingRun.id);
    worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
    sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
  }
  setPendingRun(undefined);
  runtimeState.workerState = undefined;
  if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
  ui?.setRunning(false);
  ui?.setQuestionPrompt(undefined);
  hideTaskSuggestion();
  setUiStatus('Task ended. Start a new task to continue.');
  sessionCoordinator?.endTask(reason);
  sessionCoordinator?.setActiveRun(undefined);
  sessionCoordinator?.setWorkerContext(undefined);
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
