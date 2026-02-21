import { Bridge, bindRpc, type NavigationIntentEvent } from '@rover/bridge';
import type { ToolOutput } from '@rover/shared/lib/types/index.js';
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
  type SharedNavigationHandoff,
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
  PersistedNavigationHandoff,
  PersistedRuntimeState,
  PersistedTaskState,
  PersistedTaskTabScope,
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
} from './taskLifecycleGuards.js';
import {
  normalizeTaskBoundaryId,
  shouldAcceptWorkerSnapshot,
  type WorkerBoundarySource,
} from './taskBoundaryGuards.js';
import {
  isTerminalTaskStatus,
  reduceTaskKernel,
  type TaskKernelCommand,
} from './taskKernel.js';
import {
  RoverServerRuntimeClient,
  resolveRoverV1Bases,
  resolveRoverV1Base,
  type TabEventDecisionResponse,
  type RoverServerProjection,
  type RoverServerPolicy,
} from './serverRuntime.js';
import { shouldAdoptCheckpointState } from './checkpointAdoptionGuards.js';
import { resolveNavigationDecision } from './navigationPreflightPolicy.js';
import { resolveNavigationMessageContext } from './navigationMessageContext.js';
import {
  deriveRegistrableDomain,
  isHostInNavigationScope,
} from './navigationScope.js';
import {
  buildInaccessibleTabPageData,
  buildTabAccessToolError,
} from './tabAccessFallbacks.js';
import { shouldStartFreshTaskForPrompt } from './promptDispatchGuards.js';
import { buildHeuristicFollowupChatLog, type FollowupChatEntry } from './followupChatHeuristics.js';

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
  publicKey?: string;
  siteKeyId?: string;
  authToken?: string;
  sessionToken?: string;
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
  timing?: {
    /** Delay (ms) before same-tab navigation executes, allowing state persistence. Default: 80 */
    navigationDelayMs?: number;
    /** Timeout (ms) for bridge RPC calls from the worker. Default: 30000 */
    actionTimeoutMs?: number;
    /** Adaptive DOM settle debounce before a11y tree capture. Default: 24 */
    domSettleDebounceMs?: number;
    /** Adaptive DOM settle max wait before a11y tree capture. Default: 220 */
    domSettleMaxWaitMs?: number;
    /** Adaptive DOM settle bounded retries before capture. Default: 0 */
    domSettleRetries?: number;
    /** Additional delay before sparse-tree retry capture. Default: 35 */
    sparseTreeRetryDelayMs?: number;
    /** Number of sparse-tree retries when roots are too sparse. Default: 1 */
    sparseTreeRetryMaxAttempts?: number;
  };
  task?: {
    singleActiveScope?: 'host_session';
    tabScope?: 'task_touched_only';
    resume?: {
      mode?: 'crash_only';
      ttlMs?: number;
    };
    followup?: {
      mode?: 'heuristic_same_window';
      ttlMs?: number;
      minLexicalOverlap?: number;
    };
    observerInput?: 'read_only';
    autoResumePolicy?: 'auto' | 'confirm' | 'never';
  };
  chat?: {
    inRun?: 'empty';
    resumeFollowup?: {
      mode?: 'deterministic_cues';
      maxTurns?: number;
    };
  };
  external?: {
    intentSelection?: 'auto';
    requireUserConfirm?: boolean;
    adversarialGate?: 'pre_tool_block';
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
      action?: 'session_snapshot_upsert' | 'session_projection_get';
      code?: string;
      message?: string;
    }) => void;
    onError?: (payload: {
      action: 'session_snapshot_upsert' | 'session_projection_get';
      state: RoverCloudCheckpointState;
      code?: string;
      message: string;
      status?: number;
      paused: boolean;
    }) => void;
  };
  telemetry?: RoverTelemetryConfig;
  features?: {
    rover_v1_kernel_runtime?: boolean;
  };
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
  | 'tab_event_conflict_retry'
  | 'tab_event_conflict_exhausted'
  | 'legacy_checkpoint_blocked'
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
const MAX_AUTO_RESUME_ATTEMPTS = 12;
const DEFAULT_CRASH_RESUME_TTL_MS = 15 * 60_000;
const DEFAULT_CHAT_RESUME_MAX_TURNS = 2;
const DEFAULT_FOLLOWUP_TTL_MS = 120_000;
const DEFAULT_FOLLOWUP_MIN_LEXICAL_OVERLAP = 0.18;
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const CHECKPOINT_PAYLOAD_VERSION = 1;
const ACTIVE_PENDING_RUN_GRACE_MS = 3_000;
const STALE_PENDING_RUN_GRACE_MS = 4_500;
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
const NAV_HANDOFF_BOOTSTRAP_PREFIX = 'rover:handoff-bootstrap:';
const NAV_HANDOFF_BOOTSTRAP_TTL_MS = 30_000;

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
let sessionReady = false;
let autoResumeAttempted = false;
let crossDomainResumeActive = false;
let agentNavigationPending = false;
let currentTaskBoundaryId = '';
let runSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let autoResumeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let unloadHandlerInstalled = false;
type PendingTaskSuggestion =
  | { kind: 'task_reset'; text: string; reason: string; createdAt: number }
  | { kind: 'resume_run'; runId: string; text: string; createdAt: number };
let pendingTaskSuggestion: PendingTaskSuggestion | null = null;
let lastStatusSignature = '';
let lastUserInputText: string | undefined;
let lastCompletedTaskInput: string | undefined;
let lastCompletedTaskSummary: string | undefined;
let lastCompletedTaskAt = 0;
const latestAssistantByRunId = new Map<string, string>();
const ignoredRunIds = new Set<string>();
let roverServerRuntime: RoverServerRuntimeClient | null = null;
let runtimeSessionToken: string | undefined;
let runtimeSessionTokenExpiresAt = 0;
let runtimeServerEpoch = 1;
let serverAcceptedRunId: string | undefined;
const RUN_SCOPED_WORKER_MESSAGE_TYPES = new Set([
  'run_started',
  'run_state_transition',
  'run_completed',
  'assistant',
  'status',
  'tool_start',
  'tool_result',
  'runtime_tabs_diagnostics',
  'auth_required',
  'navigation_guardrail',
  'error',
]);

const ROVER_EXTERNAL_CONTEXT_TOOL_NAMES = {
  read: 'rover_external_read_context',
  act: 'rover_external_act_context',
} as const;

type RuntimeToolOutput =
  | ToolOutput
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

const pendingToolRegistrations: ToolRegistration[] = [];
const eventHandlers = new Map<RoverEventName, Set<RoverEventHandler>>();

type NavigationHandoffBootstrap = {
  runId: string;
  text?: string;
  taskBoundaryId?: string;
  resumeReason?: PersistedPendingRun['resumeReason'];
  handoffId?: string;
  ts: number;
};

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

function createTaskBoundaryId(): string {
  return createId('task-boundary');
}

function sanitizeNavigationHandoff(input: any): PersistedNavigationHandoff | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const handoffId = typeof input.handoffId === 'string' ? input.handoffId.trim() : '';
  const targetUrl = typeof input.targetUrl === 'string' ? input.targetUrl.trim() : '';
  if (!handoffId || !targetUrl) return undefined;
  const sourceLogicalTabId = Number(input.sourceLogicalTabId);
  return {
    handoffId,
    targetUrl,
    sourceLogicalTabId: Number.isFinite(sourceLogicalTabId) && sourceLogicalTabId > 0 ? sourceLogicalTabId : undefined,
    runId: typeof input.runId === 'string' && input.runId.trim() ? input.runId.trim() : undefined,
    createdAt: Number(input.createdAt) || Date.now(),
    consumed: input.consumed === true,
  };
}

function toSharedNavigationHandoff(input: PersistedNavigationHandoff | undefined): SharedNavigationHandoff | undefined {
  if (!input) return undefined;
  return {
    handoffId: input.handoffId,
    targetUrl: input.targetUrl,
    sourceLogicalTabId: input.sourceLogicalTabId,
    runId: input.runId,
    ts: input.createdAt,
  };
}

function toPersistedNavigationHandoff(intent: NavigationIntentEvent): PersistedNavigationHandoff {
  return {
    handoffId: intent.handoffId,
    targetUrl: intent.targetUrl,
    sourceLogicalTabId: intent.sourceLogicalTabId,
    runId: intent.runId,
    createdAt: Number(intent.ts) || Date.now(),
    consumed: false,
  };
}

function resolveExistingTaskBoundaryIdFromState(state: PersistedRuntimeState | null | undefined): string | undefined {
  const pendingCandidate =
    typeof state?.pendingRun?.taskBoundaryId === 'string' ? state.pendingRun.taskBoundaryId : undefined;
  if (pendingCandidate) return normalizeTaskBoundaryId(pendingCandidate);
  const workerCandidate =
    typeof state?.workerState?.taskBoundaryId === 'string' ? state.workerState.taskBoundaryId : undefined;
  if (workerCandidate) return normalizeTaskBoundaryId(workerCandidate);
  return undefined;
}

function resolveTaskBoundaryIdFromState(state: PersistedRuntimeState | null): string {
  const existing = resolveExistingTaskBoundaryIdFromState(state);
  if (existing) return existing;
  return createTaskBoundaryId();
}

function resolveCurrentTaskBoundaryCandidate(): string | undefined {
  return normalizeTaskBoundaryId(currentTaskBoundaryId) || resolveExistingTaskBoundaryIdFromState(runtimeState);
}

function shouldAcceptIncomingWorkerBoundary(params: {
  source: WorkerBoundarySource;
  incomingBoundaryId?: string;
  taskEpochAdvanced?: boolean;
  allowBootstrapAdoption?: boolean;
}): boolean {
  const decision = shouldAcceptWorkerSnapshot({
    source: params.source,
    incomingBoundaryId: params.incomingBoundaryId,
    currentBoundaryId: resolveCurrentTaskBoundaryCandidate(),
    taskEpochAdvanced: params.taskEpochAdvanced,
    hasPendingRun: !!runtimeState?.pendingRun,
    taskStatus: runtimeState?.activeTask?.status,
    allowBootstrapAdoption: params.allowBootstrapAdoption,
  });
  if (!decision.accept) return false;
  if (decision.adoptedBoundaryId) {
    currentTaskBoundaryId = decision.adoptedBoundaryId;
  }
  return true;
}

function getUnconsumedNavigationHandoff(maxAgeMs = 120_000): PersistedNavigationHandoff | undefined {
  const handoff = sanitizeNavigationHandoff(runtimeState?.lastNavigationHandoff);
  if (!handoff || handoff.consumed === true) return undefined;
  const ageMs = Date.now() - Number(handoff.createdAt || 0);
  if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > maxAgeMs) return undefined;
  return handoff;
}

function syncCurrentTaskBoundaryId(options?: { rotateIfMissing?: boolean }): void {
  const pendingBoundary = sanitizePendingRun(runtimeState?.pendingRun)?.taskBoundaryId;
  if (pendingBoundary) {
    currentTaskBoundaryId = pendingBoundary;
    return;
  }
  const workerBoundary = sanitizeWorkerState(runtimeState?.workerState)?.taskBoundaryId;
  if (workerBoundary) {
    currentTaskBoundaryId = workerBoundary;
    return;
  }
  if (!currentTaskBoundaryId || options?.rotateIfMissing) {
    currentTaskBoundaryId = createTaskBoundaryId();
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

function getNavigationHandoffBootstrapKey(siteId: string): string {
  return `${NAV_HANDOFF_BOOTSTRAP_PREFIX}${siteId}`;
}

function writeNavigationHandoffBootstrap(siteId: string, payload: NavigationHandoffBootstrap): void {
  try {
    sessionStorage.setItem(getNavigationHandoffBootstrapKey(siteId), JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

function consumeNavigationHandoffBootstrap(siteId: string): NavigationHandoffBootstrap | undefined {
  try {
    const key = getNavigationHandoffBootstrapKey(siteId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    sessionStorage.removeItem(key);
    const parsed = JSON.parse(raw) as NavigationHandoffBootstrap;
    const ts = Number(parsed?.ts) || 0;
    if (!parsed?.runId || !ts) return undefined;
    if (Date.now() - ts > NAV_HANDOFF_BOOTSTRAP_TTL_MS) return undefined;
    return {
      runId: String(parsed.runId),
      text: typeof parsed.text === 'string' ? parsed.text : undefined,
      taskBoundaryId:
        typeof parsed.taskBoundaryId === 'string' && parsed.taskBoundaryId.trim()
          ? parsed.taskBoundaryId.trim()
          : undefined,
      resumeReason:
        parsed.resumeReason === 'cross_host_navigation'
        || parsed.resumeReason === 'agent_navigation'
        || parsed.resumeReason === 'handoff'
        || parsed.resumeReason === 'page_reload'
          ? parsed.resumeReason
          : undefined,
      handoffId: typeof parsed.handoffId === 'string' ? parsed.handoffId : undefined,
      ts,
    };
  } catch {
    return undefined;
  }
}

function clearNavigationHandoffBootstrap(siteId?: string): void {
  if (!siteId) return;
  try {
    sessionStorage.removeItem(getNavigationHandoffBootstrapKey(siteId));
  } catch {
    // ignore
  }
}

function createDefaultTaskState(reason = 'session_start', startedAt = Date.now(), taskId?: string): PersistedTaskState {
  return {
    taskId: taskId || createId('task'),
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
    lastNavigationHandoff: undefined,
    taskEpoch: 1,
    activeTask: createDefaultTaskState(),
    taskTabScope: undefined,
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

function normalizeTaskSingleActiveScope(_scope?: 'host_session'): 'host_session' {
  return 'host_session';
}

function normalizeTaskTabScope(_scope?: 'task_touched_only'): 'task_touched_only' {
  return 'task_touched_only';
}

function normalizeTaskResumeMode(_mode?: 'crash_only'): 'crash_only' {
  return 'crash_only';
}

function normalizeTaskResumeTtlMs(input?: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return DEFAULT_CRASH_RESUME_TTL_MS;
  return Math.max(60_000, Math.min(30 * 60_000, Math.floor(parsed)));
}

function normalizeTaskObserverInput(_input?: 'read_only'): 'read_only' {
  return 'read_only';
}

function normalizeTaskFollowupMode(_mode?: 'heuristic_same_window'): 'heuristic_same_window' {
  return 'heuristic_same_window';
}

function normalizeTaskFollowupTtlMs(input?: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return DEFAULT_FOLLOWUP_TTL_MS;
  return Math.max(10_000, Math.min(10 * 60_000, Math.floor(parsed)));
}

function normalizeTaskFollowupMinLexicalOverlap(input?: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return DEFAULT_FOLLOWUP_MIN_LEXICAL_OVERLAP;
  return Math.max(0.05, Math.min(0.9, parsed));
}

function normalizeChatInRun(_policy?: 'empty'): 'empty' {
  return 'empty';
}

function normalizeChatResumeMode(_mode?: 'deterministic_cues'): 'deterministic_cues' {
  return 'deterministic_cues';
}

function normalizeChatResumeMaxTurns(maxTurns?: number): number {
  const parsed = Number(maxTurns);
  if (!Number.isFinite(parsed)) return DEFAULT_CHAT_RESUME_MAX_TURNS;
  return Math.max(1, Math.min(4, Math.floor(parsed)));
}

function normalizeExternalIntentSelection(_mode?: 'auto'): 'auto' {
  return 'auto';
}

function normalizeExternalRequireUserConfirm(_value?: boolean): false {
  return false;
}

function normalizeExternalAdversarialGate(_value?: 'pre_tool_block'): 'pre_tool_block' {
  return 'pre_tool_block';
}

function resolveNavigationPreflightMessageContext(): string {
  return resolveNavigationMessageContext({
    pendingRunText: runtimeState?.pendingRun?.text,
    activeRunText: sessionCoordinator?.getState()?.activeRun?.text,
    rootWorkerInput: runtimeState?.workerState?.rootUserInput,
    lastUserInputText,
    fallback: 'navigation request',
  });
}

function normalizeKernelRuntimeFeature(value?: boolean): boolean {
  return value !== false;
}

function normalizeTimingNumber(input: unknown, min: number, max: number): number | undefined {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function canUseTelemetry(cfg: RoverInit | null): boolean {
  if (!cfg) return false;
  const telemetry = normalizeTelemetryConfig(cfg);
  if (!telemetry.enabled) return false;
  if (!getRuntimeSessionToken(cfg)) return false;
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
  return `${resolveRoverV1Base(cfg.apiBase)}/telemetry/ingest`;
}

function getBootstrapRuntimeAuthToken(cfg?: RoverInit | null): string {
  const source = cfg || currentConfig;
  const publicKey = String(source?.publicKey || '').trim();
  if (publicKey.startsWith('pk_site_')) return publicKey;
  const authToken = String(source?.authToken || '').trim();
  if (authToken.startsWith('pk_site_')) return authToken;
  return '';
}

function getRuntimeSessionToken(cfg?: RoverInit | null): string {
  if (runtimeSessionToken && runtimeSessionTokenExpiresAt > Date.now() + 10_000) {
    return runtimeSessionToken;
  }
  const source = cfg || currentConfig;
  const fallbackToken = String(source?.sessionToken || source?.authToken || '').trim();
  return fallbackToken.startsWith('rvrsess_') ? fallbackToken : '';
}

function updateRuntimeSessionToken(token?: string, expiresAt?: number): void {
  const normalized = String(token || '').trim();
  runtimeSessionToken = normalized || undefined;
  runtimeSessionTokenExpiresAt = Number(expiresAt) > 0 ? Number(expiresAt) : 0;
  // Persist for same-origin navigation resume (sessionStorage survives refresh)
  try {
    const siteId = currentConfig?.siteId || '';
    if (normalized && runtimeSessionTokenExpiresAt > Date.now()) {
      sessionStorage.setItem(`rover:sess:${siteId}`, JSON.stringify({ t: normalized, e: runtimeSessionTokenExpiresAt }));
    } else {
      sessionStorage.removeItem(`rover:sess:${siteId}`);
    }
  } catch { /* ignore */ }
}

function applyServerPolicy(policy?: RoverServerPolicy): void {
  if (!policy || !currentConfig) return;
  currentConfig.externalNavigationPolicy = policy.externalNavigationPolicy || currentConfig.externalNavigationPolicy;
  if (policy.domainScopeMode) {
    currentConfig.domainScopeMode = policy.domainScopeMode;
  }
  if (policy.crossHostPolicy === 'open_new_tab' || policy.crossHostPolicy === 'same_tab') {
    currentConfig.navigation = {
      ...(currentConfig.navigation || {}),
      crossHostPolicy: normalizeCrossHostPolicy(policy.crossHostPolicy),
    };
  }
  if (!currentConfig.tools) currentConfig.tools = {};
  if (!currentConfig.tools.web) currentConfig.tools.web = {};
  currentConfig.tools.web.enableExternalWebContext = policy.enableExternalWebContext ?? currentConfig.tools.web.enableExternalWebContext;
  currentConfig.tools.web.scrapeMode = policy.externalScrapeMode ?? currentConfig.tools.web.scrapeMode;
  if (Array.isArray(policy.externalAllowDomains)) {
    currentConfig.tools.web.allowDomains = policy.externalAllowDomains;
  }
  if (Array.isArray(policy.externalDenyDomains)) {
    currentConfig.tools.web.denyDomains = policy.externalDenyDomains;
  }
}

function applyServerProjection(projection: RoverServerProjection): void {
  if (!runtimeState || !projection) return;
  runtimeServerEpoch = Math.max(1, Number(projection.epoch || runtimeServerEpoch));

  const serverRunId = typeof projection.activeRunId === 'string' ? projection.activeRunId : '';
  setServerAcceptedRunId(serverRunId || undefined);
  const localPending = runtimeState.pendingRun;
  const localRunId = localPending?.id || '';

  if (!serverRunId && localRunId) {
    const runStatus = String(projection.runStatus || '').trim().toLowerCase();
    const isProjectionTerminal =
      runStatus === 'completed'
      || runStatus === 'cancelled'
      || runStatus === 'failed';
    if (isProjectionTerminal || runtimeState.activeTask?.status !== 'running') {
      addIgnoredRunId(localRunId);
      setPendingRun(undefined);
      sessionCoordinator?.setActiveRun(undefined);
    }
  } else if (serverRunId && (!localPending || localRunId !== serverRunId)) {
    setPendingRun({
      id: serverRunId,
      text: localPending?.text || '',
      startedAt: localPending?.startedAt || Date.now(),
      attempts: localPending?.attempts || 0,
      autoResume: true,
      taskBoundaryId: localPending?.taskBoundaryId || currentTaskBoundaryId,
      resumeRequired: localPending?.resumeRequired === true,
      resumeReason: localPending?.resumeReason,
    });
  }

  if (projection.snapshot && typeof projection.snapshot === 'object') {
    const maybeRuntime = (projection.snapshot as any)?.runtimeState;
    const maybeShared = (projection.snapshot as any)?.sharedState;
    if (maybeRuntime && typeof maybeRuntime === 'object') {
      suppressCheckpointSync = true;
      try {
        applyCloudCheckpointPayload({
          version: CHECKPOINT_PAYLOAD_VERSION,
          siteId: currentConfig?.siteId || runtimeState.sessionId,
          visitorId: resolvedVisitorId || 'server_projection',
          sessionId: runtimeState.sessionId,
          updatedAt: Number((projection.snapshot as any)?.updatedAt) || Date.now(),
          runtimeState: maybeRuntime as PersistedRuntimeState,
          sharedState: maybeShared as SharedSessionState,
        });
      } finally {
        suppressCheckpointSync = false;
      }
    }
  }
}

async function ensureRoverServerRuntime(cfg: RoverInit): Promise<void> {
  if (!runtimeState) return;
  if (!cfg.apiBase && !cfg.publicKey && !cfg.authToken && !cfg.sessionToken) return;

  const bootstrapToken = getBootstrapRuntimeAuthToken(cfg);
  if (!bootstrapToken && !runtimeSessionToken) return;

  if (!roverServerRuntime) {
    roverServerRuntime = new RoverServerRuntimeClient({
      apiBase: cfg.apiBase,
      siteId: cfg.siteId,
      getSessionId: () => runtimeState?.sessionId,
      getBootstrapToken: () => getBootstrapRuntimeAuthToken(currentConfig),
      getHost: () => window.location.hostname,
      getPageUrl: () => window.location.href,
      getTaskBoundaryId: () => currentTaskBoundaryId,
      onSession: session => {
        updateRuntimeSessionToken(session.sessionToken, session.sessionTokenExpiresAt);
        runtimeServerEpoch = Math.max(1, Number(session.epoch || runtimeServerEpoch));
        if (runtimeState && session.sessionId && runtimeState.sessionId !== session.sessionId) {
          runtimeState.sessionId = session.sessionId;
          persistRuntimeState();
        }
        applyServerPolicy(session.policy);
        if (session.siteConfig && typeof session.siteConfig === 'object' && currentConfig) {
          const resolvedSiteConfig: RoverResolvedSiteConfig = {
            shortcuts: sanitizeShortcutList((session.siteConfig as any)?.shortcuts),
            greeting: sanitizeGreetingConfig((session.siteConfig as any)?.greeting),
            limits: sanitizeSiteConfigLimits((session.siteConfig as any)?.limits),
            version: (session.siteConfig as any)?.version != null ? String((session.siteConfig as any).version) : undefined,
          };
          backendSiteConfig = resolvedSiteConfig;
          setCachedSiteConfig(currentConfig.siteId, resolvedSiteConfig);
          applyEffectiveSiteConfig(currentConfig);
        }
        if (session.projection) {
          applyServerProjection(session.projection);
        }
        if (worker) {
          worker.postMessage({
            type: 'update_config',
            config: {
              ...buildWorkerBoundaryConfig(),
              publicKey: undefined,
              sessionToken: runtimeSessionToken,
              authToken: getRuntimeSessionToken(currentConfig),
              sessionId: runtimeState?.sessionId,
              activeRunId: runtimeState?.pendingRun?.id,
              sessionEpoch: roverServerRuntime?.getEpoch?.() ?? runtimeServerEpoch,
              sessionSeq: roverServerRuntime?.getLastSeq?.() ?? 0,
            },
          });
        }
        if (bridge) {
          bridge.setNavigationPolicy({
            allowedDomains: currentConfig?.allowedDomains,
            domainScopeMode: currentConfig?.domainScopeMode,
            externalNavigationPolicy: currentConfig?.externalNavigationPolicy,
            crossHostPolicy: currentConfig?.navigation?.crossHostPolicy,
          } as any);
        }
        if (currentConfig) {
          setupCloudCheckpointing(currentConfig);
          setupTelemetry(currentConfig);
        }
        // Session is now ready — allow auto-resume of pending runs
        sessionReady = true;
        maybeAutoResumePendingRun();
      },
      onProjection: projection => {
        applyServerProjection(projection);
        if (worker) {
          worker.postMessage({
            type: 'update_config',
            config: {
              ...buildWorkerBoundaryConfig(),
              sessionToken: runtimeSessionToken,
              authToken: getRuntimeSessionToken(currentConfig),
              sessionId: runtimeState?.sessionId,
              activeRunId: runtimeState?.pendingRun?.id,
              sessionEpoch: roverServerRuntime?.getEpoch?.() ?? runtimeServerEpoch,
              sessionSeq: roverServerRuntime?.getLastSeq?.() ?? 0,
            },
          });
        }
      },
      onError: error => {
        recordTelemetryEvent('error', {
          message: (error as Error)?.message || 'server runtime sync failed',
          scope: 'server_runtime',
        });
      },
    });
  } else {
    roverServerRuntime.setApiBase(cfg.apiBase);
  }

  try {
    await roverServerRuntime.start();
  } catch (error) {
    if (currentConfig?.apiMode !== false) {
      emit('error', {
        message: (error as Error)?.message || 'server runtime sync failed',
        scope: 'server_runtime_start',
      });
    }
  }
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
  const token = getRuntimeSessionToken(currentConfig);
  if (!token) return;

  const batch = telemetryBuffer.splice(0, telemetry.maxBatchSize);
  if (!batch.length) return;

  telemetryInFlight = true;
  try {
    const response = await fetch(getTelemetryEndpoint(currentConfig), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionToken: token,
        sessionId: runtimeState?.sessionId,
        runId: runtimeState?.pendingRun?.id,
        siteId: currentConfig.siteId,
        runtimeId,
        visitorId: resolvedVisitorId,
        flushReason: force ? 'manual' : 'interval',
        sdkVersion: 'rover_sdk_v1',
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        sampleRate: telemetry.sampleRate,
        events: batch,
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

function setServerAcceptedRunId(runId?: string): void {
  const normalized = String(runId || '').trim();
  serverAcceptedRunId = normalized || undefined;
}

function getServerRunIdForDispatch(): string | undefined {
  const pendingRunId = runtimeState?.pendingRun?.id;
  if (!pendingRunId) return undefined;
  if (!roverServerRuntime) return pendingRunId;
  const activeRunId = roverServerRuntime.getActiveRunId();
  const effectiveServerRunId = String(activeRunId || serverAcceptedRunId || '').trim();
  if (!effectiveServerRunId) return undefined;
  return effectiveServerRunId === pendingRunId ? pendingRunId : undefined;
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

function hasSharedActiveRun(): boolean {
  return !!sessionCoordinator?.getState()?.activeRun;
}

function hasRemoteActiveRun(): boolean {
  const activeRun = sessionCoordinator?.getState()?.activeRun;
  return !!(activeRun && activeRun.runtimeId && activeRun.runtimeId !== runtimeId);
}

function hasLiveRemoteWorkflowLock(): boolean {
  const coordinator = sessionCoordinator;
  if (!coordinator?.isWorkflowLocked()) return false;
  const lockInfo = coordinator.getWorkflowLockInfo();
  const activeRun = coordinator.getState()?.activeRun;
  if (!lockInfo.locked || !activeRun?.runId) return false;
  if (lockInfo.holderRuntimeId && activeRun.runtimeId && lockInfo.holderRuntimeId !== activeRun.runtimeId) {
    return false;
  }
  if (lockInfo.runId && lockInfo.runId !== activeRun.runId) return false;
  return true;
}

function hasRemoteExecutionOwner(): boolean {
  return hasRemoteActiveRun() || hasLiveRemoteWorkflowLock();
}

function resolveEffectiveExecutionMode(mode: RoverExecutionMode): RoverExecutionMode {
  if (mode !== 'observer') return mode;
  return hasRemoteExecutionOwner() ? 'observer' : 'controller';
}

function canComposeInObserverMode(): boolean {
  const observerPolicy = normalizeTaskObserverInput(currentConfig?.task?.observerInput);
  if (observerPolicy === 'read_only') {
    return !hasRemoteExecutionOwner();
  }
  return !hasRemoteActiveRun();
}

function resolveExecutionModeNote(mode: RoverExecutionMode): string | undefined {
  if (mode !== 'observer') return undefined;
  if (hasRemoteExecutionOwner()) {
    return 'Observing active run in another tab...';
  }
  return 'Send to take control and run here.';
}

function shouldIgnoreRunScopedWorkerMessage(msg: any): boolean {
  const type = typeof msg?.type === 'string' ? msg.type : '';
  if (!RUN_SCOPED_WORKER_MESSAGE_TYPES.has(type)) return false;

  const messageRunId = typeof msg?.runId === 'string' && msg.runId ? msg.runId : undefined;
  const messageTaskBoundaryId =
    typeof msg?.taskBoundaryId === 'string' && msg.taskBoundaryId
      ? msg.taskBoundaryId
      : undefined;
  const authoritativeActiveRunId =
    String(roverServerRuntime?.getActiveRunId() || serverAcceptedRunId || '').trim() || undefined;
  return shouldIgnoreRunScopedMessage({
    type,
    messageRunId,
    messageTaskBoundaryId,
    currentTaskBoundaryId: resolveCurrentTaskBoundaryCandidate(),
    pendingRunId: getPendingRunId(),
    sharedActiveRunId: sessionCoordinator?.getState()?.activeRun?.runId,
    authoritativeActiveRunId,
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

function buildAskUserDispatchText(
  text: string,
  askUserAnswers?: RoverAskUserAnswerMeta,
): string {
  const trimmed = String(text || '').trim();
  if (trimmed) return trimmed;
  if (!askUserAnswers || typeof askUserAnswers !== 'object') return '';

  const answersByKey =
    askUserAnswers.answersByKey && typeof askUserAnswers.answersByKey === 'object'
      ? askUserAnswers.answersByKey
      : {};

  const pendingQuestions = normalizeAskUserQuestions(runtimeState?.workerState?.pendingAskUser?.questions);
  const rawKeys = Array.isArray(askUserAnswers.keys) ? askUserAnswers.keys : [];
  const resolvedKeys = rawKeys
    .map(key => String(key || '').trim())
    .filter(Boolean);
  if (resolvedKeys.length === 0) {
    for (const question of pendingQuestions) {
      const key = String(question.key || '').trim();
      if (key) resolvedKeys.push(key);
    }
  }
  if (resolvedKeys.length === 0) {
    for (const key of Object.keys(answersByKey)) {
      const normalizedKey = String(key || '').trim();
      if (normalizedKey) resolvedKeys.push(normalizedKey);
    }
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const key of resolvedKeys) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    const value = String((answersByKey as Record<string, unknown>)[normalizedKey] || '').trim();
    lines.push(`${normalizedKey}: ${value || '(no answer provided)'}`);
  }

  if (lines.length > 0) {
    return lines.join('\n');
  }

  return String(askUserAnswers.rawText || '').trim();
}

function normalizeRunCompletionState(msg: any): {
  taskComplete: boolean;
  needsUserInput: boolean;
  terminalState: 'waiting_input' | 'in_progress' | 'completed' | 'failed';
  contextResetRecommended: boolean;
  continuationReason?: 'loop_continue' | 'same_tab_navigation_handoff' | 'awaiting_user';
  questions?: RoverAskUserQuestion[];
} {
  if (!msg || typeof msg !== 'object') {
    return {
      taskComplete: false,
      needsUserInput: false,
      terminalState: 'in_progress',
      contextResetRecommended: false,
    };
  }
  const incomingTerminal = String(msg.terminalState || '').trim().toLowerCase();
  const needsUserInput = msg.needsUserInput === true;
  const inferredTerminalState: 'waiting_input' | 'in_progress' | 'completed' | 'failed' =
    incomingTerminal === 'waiting_input' || incomingTerminal === 'in_progress' || incomingTerminal === 'completed' || incomingTerminal === 'failed'
      ? incomingTerminal
      : needsUserInput
        ? 'waiting_input'
        : msg.taskComplete === true
          ? 'completed'
          : msg.ok === false
            ? 'failed'
            : 'in_progress';
  const taskComplete = inferredTerminalState === 'completed' || (msg.taskComplete === true && inferredTerminalState !== 'waiting_input');
  const questions = normalizeAskUserQuestions(msg.questions);
  const continuationRaw = String(msg.continuationReason || '').trim().toLowerCase();
  const continuationReason =
    continuationRaw === 'loop_continue'
    || continuationRaw === 'same_tab_navigation_handoff'
    || continuationRaw === 'awaiting_user'
      ? continuationRaw
      : inferredTerminalState === 'waiting_input'
        ? 'awaiting_user'
        : inferredTerminalState === 'in_progress'
          ? 'loop_continue'
          : undefined;
  return {
    taskComplete,
    needsUserInput: inferredTerminalState === 'waiting_input' || needsUserInput,
    terminalState: inferredTerminalState,
    contextResetRecommended: msg.contextResetRecommended === true || inferredTerminalState === 'completed',
    continuationReason,
    ...(questions.length ? { questions } : {}),
  };
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

  if (typeof firstStructured.data === 'string' && firstStructured.data.trim()) {
    return firstStructured.data.trim();
  }
  if (typeof firstStructured.data === 'number' || typeof firstStructured.data === 'boolean') {
    return String(firstStructured.data);
  }
  return undefined;
}

function buildToolResultBlocks(
  result:
    | {
        output?: RuntimeToolOutput;
        generatedContentRef?: RuntimeToolOutput;
        schemaHeaderSheetInfo?: RuntimeToolOutput;
        name?: string;
      }
    | RuntimeToolOutput,
): RoverMessageBlock[] | undefined {
  if (result == null) return undefined;
  const recordResult = typeof result === 'object' && result !== null
    ? (result as {
        output?: RuntimeToolOutput;
        generatedContentRef?: RuntimeToolOutput;
        schemaHeaderSheetInfo?: RuntimeToolOutput;
        name?: string;
      })
    : undefined;
  const output =
    recordResult?.output
    ?? recordResult?.generatedContentRef
    ?? recordResult?.schemaHeaderSheetInfo
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
      label: typeof recordResult?.name === 'string' ? `${recordResult.name} output` : 'Tool output',
      data: output,
    },
  ]);
}

function toPositiveTabId(value: unknown): number | undefined {
  const candidate = Number(value);
  if (!Number.isFinite(candidate) || candidate <= 0) return undefined;
  return candidate;
}

function extractTabIdsFromToolArgs(args: unknown): number[] {
  if (!args || typeof args !== 'object') return [];
  const record = args as Record<string, unknown>;
  const candidates = [
    toPositiveTabId(record.tab_id),
    toPositiveTabId(record.logical_tab_id),
    toPositiveTabId(record.tabId),
    toPositiveTabId(record.logicalTabId),
  ].filter((id): id is number => !!id);
  return dedupePositiveTabIds(candidates);
}

function extractTabIdsFromToolResult(result: unknown): number[] {
  if (!result || typeof result !== 'object') return [];
  const record = result as Record<string, unknown>;
  const output =
    record.output && typeof record.output === 'object'
      ? record.output as Record<string, unknown>
      : undefined;
  const candidates = [
    toPositiveTabId(record.tab_id),
    toPositiveTabId(record.logical_tab_id),
    toPositiveTabId(record.tabId),
    toPositiveTabId(record.logicalTabId),
    toPositiveTabId(output?.tab_id),
    toPositiveTabId(output?.logical_tab_id),
    toPositiveTabId(output?.tabId),
    toPositiveTabId(output?.logicalTabId),
  ].filter((id): id is number => !!id);
  return dedupePositiveTabIds(candidates);
}

function isToolResultFailure(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const record = result as Record<string, unknown>;
  const output =
    record.output && typeof record.output === 'object'
      ? record.output as Record<string, unknown>
      : undefined;
  const status = String(record.status || record.taskStatus || output?.status || output?.taskStatus || '')
    .trim()
    .toLowerCase();
  if (status === 'failure' || status === 'failed' || status === 'error') return true;
  if (record.success === false || output?.success === false) return true;
  if (record.error || output?.error) return true;
  return false;
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

  const taskBoundaryIdCandidate = String(input.taskBoundaryId || '').trim();

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
  const pendingStepRefRaw = input?.pendingAskUser?.stepRef;
  const pendingStepRef =
    pendingStepRefRaw
    && Number.isFinite(Number(pendingStepRefRaw.stepIndex))
    && Number(pendingStepRefRaw.stepIndex) >= 0
    && Number.isFinite(Number(pendingStepRefRaw.functionIndex))
    && Number(pendingStepRefRaw.functionIndex) >= 0
      ? {
          stepIndex: Number(pendingStepRefRaw.stepIndex),
          functionIndex: Number(pendingStepRefRaw.functionIndex),
          ...(typeof pendingStepRefRaw.accTreeId === 'string' && pendingStepRefRaw.accTreeId.trim()
            ? { accTreeId: pendingStepRefRaw.accTreeId.trim() }
            : {}),
        }
      : undefined;
  let pendingAskUser: PersistedWorkerState['pendingAskUser'] = pendingQuestions.length
    ? {
        questions: pendingQuestions,
        source: (input?.pendingAskUser?.source === 'planner' ? 'planner' : 'act') as 'act' | 'planner',
        askedAt: Number(input?.pendingAskUser?.askedAt) || Date.now(),
        boundaryId:
          typeof input?.pendingAskUser?.boundaryId === 'string' && input.pendingAskUser.boundaryId.trim()
            ? input.pendingAskUser.boundaryId.trim()
            : undefined,
        ...(pendingStepRef ? { stepRef: pendingStepRef } : {}),
      }
    : undefined;
  const normalizedWorkerBoundaryId = normalizeTaskBoundaryId(taskBoundaryIdCandidate || undefined);
  const normalizedPendingBoundaryId = normalizeTaskBoundaryId(pendingAskUser?.boundaryId || normalizedWorkerBoundaryId);
  if (
    pendingAskUser
    && normalizedWorkerBoundaryId
    && normalizedPendingBoundaryId
    && normalizedPendingBoundaryId !== normalizedWorkerBoundaryId
  ) {
    pendingAskUser = undefined;
  }
  const rootUserInput = typeof input.rootUserInput === 'string' ? input.rootUserInput.trim() : '';

  return {
    trajectoryId: typeof input.trajectoryId === 'string' ? input.trajectoryId : undefined,
    taskBoundaryId: taskBoundaryIdCandidate || undefined,
    rootUserInput: rootUserInput || undefined,
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
  const taskBoundaryFallback =
    (pendingRun?.taskBoundaryId && String(pendingRun.taskBoundaryId).trim())
    || (typeof raw?.workerState?.taskBoundaryId === 'string' ? String(raw.workerState.taskBoundaryId).trim() : '')
    || undefined;
  const parsedTaskTabScope = sanitizeTaskTabScope((raw as any).taskTabScope, taskBoundaryFallback);

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
    taskTabScope: parsedTaskTabScope,
    lastNavigationHandoff: sanitizeNavigationHandoff((raw as any).lastNavigationHandoff),
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
  const status =
    input.status === 'ended'
    || input.status === 'completed'
    || input.status === 'cancelled'
    || input.status === 'failed'
    || input.status === 'running'
      ? input.status
      : 'running';
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
    taskBoundaryId: typeof state.taskBoundaryId === 'string' ? state.taskBoundaryId : undefined,
    rootUserInput: typeof state.rootUserInput === 'string' ? state.rootUserInput : undefined,
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
          boundaryId:
            typeof state.pendingAskUser?.boundaryId === 'string' && state.pendingAskUser.boundaryId.trim()
              ? state.pendingAskUser.boundaryId.trim()
              : undefined,
          ...(state.pendingAskUser?.stepRef
            && Number.isFinite(Number(state.pendingAskUser.stepRef.stepIndex))
            && Number(state.pendingAskUser.stepRef.stepIndex) >= 0
            && Number.isFinite(Number(state.pendingAskUser.stepRef.functionIndex))
            && Number(state.pendingAskUser.stepRef.functionIndex) >= 0
              ? {
                  stepRef: {
                    stepIndex: Number(state.pendingAskUser.stepRef.stepIndex),
                    functionIndex: Number(state.pendingAskUser.stepRef.functionIndex),
                    ...(typeof state.pendingAskUser.stepRef.accTreeId === 'string'
                      && state.pendingAskUser.stepRef.accTreeId.trim()
                      ? { accTreeId: state.pendingAskUser.stepRef.accTreeId.trim() }
                      : {}),
                  },
                }
              : {}),
        }
      : undefined,
    updatedAt: Number(state.updatedAt) || Date.now(),
  };
}

function dedupePositiveTabIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of input) {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sanitizeTaskTabScope(
  input: any,
  fallbackBoundaryId?: string,
): PersistedTaskTabScope | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const boundaryId =
    typeof input.boundaryId === 'string' && input.boundaryId.trim()
      ? input.boundaryId.trim()
      : (typeof fallbackBoundaryId === 'string' && fallbackBoundaryId.trim() ? fallbackBoundaryId.trim() : undefined);
  if (!boundaryId) return undefined;
  const seedTabId = Number(input.seedTabId);
  if (!Number.isFinite(seedTabId) || seedTabId <= 0) return undefined;
  const touchedTabIds = dedupePositiveTabIds(input.touchedTabIds);
  if (!touchedTabIds.includes(seedTabId)) touchedTabIds.unshift(seedTabId);
  return {
    boundaryId,
    seedTabId,
    touchedTabIds: touchedTabIds.slice(0, 24),
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
}

function sanitizePendingRun(input: any): PersistedPendingRun | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
  const textCandidate = typeof input.text === 'string' ? input.text.trim() : '';
  const fallbackTextCandidate =
    typeof input.lastUserInputText === 'string' && input.lastUserInputText.trim()
      ? input.lastUserInputText.trim()
      : (typeof lastUserInputText === 'string' && lastUserInputText.trim()
        ? lastUserInputText.trim()
        : 'Continue task');
  const text = textCandidate || fallbackTextCandidate;
  const taskBoundaryId = typeof input.taskBoundaryId === 'string' && input.taskBoundaryId.trim()
    ? input.taskBoundaryId.trim()
    : undefined;
  if (!id) return undefined;

  return {
    id,
    text,
    startedAt: Number(input.startedAt) || Date.now(),
    attempts: Math.max(0, Number(input.attempts) || 0),
    autoResume: input.autoResume !== false,
    taskBoundaryId,
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
      const effectiveReason =
        runtimeState.pendingRun.resumeReason
        || (agentNavigationPending ? 'agent_navigation' : 'page_reload');
      const markedPending = sanitizePendingRun({
        ...runtimeState.pendingRun,
        resumeRequired: true,
        resumeReason: effectiveReason,
      });
      runtimeState.pendingRun = markedPending;
      if (markedPending) {
        sessionCoordinator?.clearActiveRunRuntimeId(markedPending.id);
        if (currentConfig?.siteId) {
          const handoffForBootstrap = sanitizeNavigationHandoff(runtimeState?.lastNavigationHandoff);
          writeNavigationHandoffBootstrap(currentConfig.siteId, {
            runId: markedPending.id,
            text: markedPending.text,
            taskBoundaryId: markedPending.taskBoundaryId || currentTaskBoundaryId,
            resumeReason: effectiveReason,
            handoffId: handoffForBootstrap?.handoffId,
            ts: Date.now(),
          });
        }
      }
    }
    const pendingHandoff = getUnconsumedNavigationHandoff();
    sessionCoordinator?.broadcastClosing(toSharedNavigationHandoff(pendingHandoff));
    if (runtimeState?.pendingRun) {
      sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
    }
    persistRuntimeState();
    // Write cross-domain resume cookie if there's a pending run —
    // covers user-initiated cross-host navigation where Bridge can't intercept.
    if (runtimeState?.pendingRun && currentConfig?.siteId) {
      writeCrossDomainResumeCookie(currentConfig.siteId, {
        sessionId: runtimeState.sessionId,
        sessionToken: runtimeSessionToken,
        sessionTokenExpiresAt: runtimeSessionTokenExpiresAt,
        pendingRun: {
          id: runtimeState.pendingRun.id,
          text: runtimeState.pendingRun.text,
          startedAt: runtimeState.pendingRun.startedAt,
          attempts: runtimeState.pendingRun.attempts,
          taskBoundaryId: runtimeState.pendingRun.taskBoundaryId || currentTaskBoundaryId,
        },
        handoff: pendingHandoff
          ? {
              handoffId: pendingHandoff.handoffId,
              sourceLogicalTabId: pendingHandoff.sourceLogicalTabId,
              runId: pendingHandoff.runId,
              targetUrl: pendingHandoff.targetUrl,
              createdAt: pendingHandoff.createdAt,
            }
          : undefined,
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

function applyTaskKernelCommand(
  command: TaskKernelCommand,
  options?: { syncShared?: boolean; persist?: boolean; rotateBoundary?: boolean },
): PersistedTaskState | undefined {
  if (!runtimeState) return undefined;
  const transition = reduceTaskKernel(
    {
      task: runtimeState.activeTask,
      taskEpoch: runtimeState.taskEpoch,
    },
    command,
    {
      createTask: (reason, at, taskId) => createDefaultTaskState(reason, at, taskId),
    },
  );

  runtimeState.activeTask = transition.task;
  runtimeState.taskEpoch = transition.taskEpoch;

  if (transition.rotateBoundary && options?.rotateBoundary !== false) {
    currentTaskBoundaryId = createTaskBoundaryId();
    ensureTaskTabScopeSeed({ forceReset: true, persist: false });
  } else {
    ensureTaskTabScopeSeed({ persist: false, appendSeed: false });
  }

  if (transition.clearPendingRun && runtimeState.pendingRun) {
    setPendingRun(undefined);
  }

  if (transition.clearWorkerState && runtimeState.workerState) {
    runtimeState.workerState = undefined;
    sessionCoordinator?.setWorkerContext(undefined);
  }
  if (transition.lifecycle === 'terminal') {
    if (autoResumeRetryTimer) {
      clearTimeout(autoResumeRetryTimer);
      autoResumeRetryTimer = null;
    }
    clearResumeArtifacts();
  }

  if (options?.syncShared !== false) {
    sessionCoordinator?.syncTask({ ...transition.task }, runtimeState.taskEpoch);
  }
  if (options?.persist !== false) {
    persistRuntimeState();
  }

  return transition.task;
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
  applyTaskKernelCommand({
    type: 'ensure_running',
    reason,
    at: timestamp,
  });
}

function markTaskCompleted(reason = 'worker_task_complete', timestamp = Date.now()): void {
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'completed',
    reason,
    at: timestamp,
  });
}

function markTaskFailed(reason = 'worker_task_failed', timestamp = Date.now()): void {
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'failed',
    reason,
    at: timestamp,
  });
}

function markTaskEnded(reason = 'worker_task_ended', timestamp = Date.now()): void {
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'ended',
    reason,
    at: timestamp,
  });
}

function markTaskCancelled(reason = 'worker_task_cancelled', timestamp = Date.now()): void {
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'cancelled',
    reason,
    at: timestamp,
  });
}

function hideTaskSuggestion(): void {
  pendingTaskSuggestion = null;
  ui?.setTaskSuggestion({ visible: false });
}

function clearResumeArtifacts(): void {
  crossDomainResumeActive = false;
  if (currentConfig?.siteId) {
    clearCrossDomainResumeCookie(currentConfig.siteId);
    clearNavigationHandoffBootstrap(currentConfig.siteId);
  }
  cloudCheckpointClient?.markDirty();
  cloudCheckpointClient?.syncNow();
}

function clearTaskUiState(): void {
  ui?.clearMessages();
  ui?.clearTimeline();
  ui?.setQuestionPrompt(undefined);
  hideTaskSuggestion();
}

function resolveWorkerPendingBoundaryId(state: PersistedWorkerState | undefined): string | undefined {
  if (!state) return undefined;
  return normalizeTaskBoundaryId(state.pendingAskUser?.boundaryId || state.taskBoundaryId);
}

function dropMismatchedPendingAskUserForBoundary(
  state: PersistedWorkerState | undefined,
  expectedBoundaryId?: string,
): PersistedWorkerState | undefined {
  if (!state?.pendingAskUser) return state;
  const expectedBoundary = normalizeTaskBoundaryId(expectedBoundaryId);
  if (!expectedBoundary) return state;
  const pendingBoundary = resolveWorkerPendingBoundaryId(state);
  if (pendingBoundary && pendingBoundary !== expectedBoundary) {
    return {
      ...state,
      pendingAskUser: undefined,
      updatedAt: Number(state.updatedAt) || Date.now(),
    };
  }
  return state;
}

function syncQuestionPromptFromWorkerState(): void {
  if (runtimeState?.activeTask?.status !== 'running') {
    ui?.setQuestionPrompt(undefined);
    return;
  }
  const currentBoundaryId = resolveCurrentTaskBoundaryCandidate();
  const pendingBoundaryId = resolveWorkerPendingBoundaryId(runtimeState?.workerState);
  if (
    currentBoundaryId
    && pendingBoundaryId
    && pendingBoundaryId !== normalizeTaskBoundaryId(currentBoundaryId)
  ) {
    ui?.setQuestionPrompt(undefined);
    return;
  }
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
  if (
    pending.resumeRequired === true
    && canAutoResumePendingRun(runtimeState.activeTask?.status)
  ) {
    return;
  }
  const serverActiveRunId = String(roverServerRuntime?.getActiveRunId() || '').trim();
  if (serverActiveRunId && serverActiveRunId === pending.id) return;
  if (hasRemoteExecutionOwner()) return;
  const ageMs = Date.now() - Number(pending.startedAt || 0);
  if (!Number.isFinite(ageMs) || ageMs < STALE_PENDING_RUN_GRACE_MS) return;

  addIgnoredRunId(pending.id);
  setPendingRun(undefined);
  sessionCoordinator?.clearActiveRunRuntimeId(pending.id);
  sessionCoordinator?.releaseWorkflowLock(pending.id);
  sessionCoordinator?.setActiveRun(undefined);
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }
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
  const effectiveMode = resolveEffectiveExecutionMode(mode);
  currentMode = effectiveMode;
  const localLogicalTabId = info?.localLogicalTabId ?? sessionCoordinator?.getLocalLogicalTabId();
  const activeLogicalTabId = info?.activeLogicalTabId ?? sessionCoordinator?.getActiveLogicalTabId();
  const controllerRuntimeId = info?.holderRuntimeId ?? sessionCoordinator?.getCurrentHolderRuntimeId();
  const allowActions = effectiveMode === 'controller' && !!(currentConfig?.allowActions ?? true);
  bridge?.setAllowActions(allowActions);
  (bridge as any)?.setActionGateContext?.({
    mode: effectiveMode,
    controllerRuntimeId,
    activeLogicalTabId,
    localLogicalTabId,
    reason: resolveActionGateReason(effectiveMode, allowActions),
  });
  if (runtimeState) {
    runtimeState.executionMode = effectiveMode;
    persistRuntimeState();
  }
  ui?.setExecutionMode(effectiveMode, {
    controllerRuntimeId,
    localLogicalTabId,
    activeLogicalTabId,
    canTakeControl: true,
    canComposeInObserver: canComposeInObserverMode(),
    note: resolveExecutionModeNote(effectiveMode),
  });
  emit('mode_change', { mode: effectiveMode, rawMode: mode, ...info });
}

function setPendingRun(next: PersistedPendingRun | undefined): void {
  if (!runtimeState) return;
  if (next) {
    runtimeState.pendingRun = sanitizePendingRun({
      ...next,
      taskBoundaryId: next.taskBoundaryId || currentTaskBoundaryId,
    });
  } else {
    runtimeState.pendingRun = undefined;
    setServerAcceptedRunId(undefined);
  }
  persistRuntimeState();
}

function setLatestNavigationHandoff(next: PersistedNavigationHandoff | undefined): void {
  if (!runtimeState) return;
  runtimeState.lastNavigationHandoff = sanitizeNavigationHandoff(next);
  persistRuntimeState();
}

function resolveLocalSeedTabId(): number {
  const candidate = Number(
    sessionCoordinator?.getLocalLogicalTabId()
    || sessionCoordinator?.getActiveLogicalTabId()
    || 1,
  );
  if (!Number.isFinite(candidate) || candidate <= 0) return 1;
  return candidate;
}

function ensureTaskTabScopeSeed(
  options?: { forceReset?: boolean; persist?: boolean; appendSeed?: boolean },
): PersistedTaskTabScope | undefined {
  if (!runtimeState) return undefined;
  const boundaryId = normalizeTaskBoundaryId(currentTaskBoundaryId) || createTaskBoundaryId();
  if (!currentTaskBoundaryId) currentTaskBoundaryId = boundaryId;
  const seedTabId = resolveLocalSeedTabId();
  const appendSeed = options?.appendSeed !== false;
  const existing = sanitizeTaskTabScope(runtimeState.taskTabScope, boundaryId);
  const shouldReset =
    !!options?.forceReset
    || !existing
    || normalizeTaskBoundaryId(existing.boundaryId) !== boundaryId;
  if (shouldReset) {
    const nextScope: PersistedTaskTabScope = {
      boundaryId,
      seedTabId,
      touchedTabIds: [seedTabId],
      updatedAt: Date.now(),
    };
    runtimeState.taskTabScope = nextScope;
    if (options?.persist !== false) persistRuntimeState();
    return nextScope;
  }
  const touched = dedupePositiveTabIds(existing.touchedTabIds);
  if (appendSeed && !touched.includes(seedTabId)) touched.unshift(seedTabId);
  const nextScope: PersistedTaskTabScope = {
    ...existing,
    seedTabId: Number.isFinite(Number(existing.seedTabId)) && Number(existing.seedTabId) > 0
      ? Number(existing.seedTabId)
      : seedTabId,
    touchedTabIds: touched.slice(0, 24),
    updatedAt: Date.now(),
  };
  runtimeState.taskTabScope = nextScope;
  if (options?.persist) persistRuntimeState();
  return nextScope;
}

function touchTaskTabIds(tabIds: Array<number | undefined>, options?: { persist?: boolean }): PersistedTaskTabScope | undefined {
  if (!runtimeState) return undefined;
  const scope = ensureTaskTabScopeSeed({ persist: false });
  if (!scope) return undefined;
  const nextTouched = dedupePositiveTabIds([
    scope.seedTabId,
    ...(scope.touchedTabIds || []),
    ...tabIds,
  ]);
  const nextScope: PersistedTaskTabScope = {
    ...scope,
    touchedTabIds: nextTouched.slice(0, 24),
    updatedAt: Date.now(),
  };
  runtimeState.taskTabScope = nextScope;
  if (options?.persist !== false) persistRuntimeState();
  return nextScope;
}

function getTaskScopedTabIds(): number[] {
  const scope = ensureTaskTabScopeSeed({ persist: false, appendSeed: false });
  if (!scope) return [resolveLocalSeedTabId()];
  const touched = dedupePositiveTabIds(scope.touchedTabIds);
  return touched.length ? touched : [scope.seedTabId];
}

function toWorkerTaskTabScopePayload(): { boundaryId: string; seedTabId: number; touchedTabIds: number[] } | undefined {
  const scope = ensureTaskTabScopeSeed({ persist: false, appendSeed: false });
  if (!scope) return undefined;
  return {
    boundaryId: scope.boundaryId,
    seedTabId: scope.seedTabId,
    touchedTabIds: dedupePositiveTabIds(scope.touchedTabIds),
  };
}

function buildFollowupChatLogForFreshPrompt(prompt: string, previousTaskStatus?: PersistedTaskState['status']): {
  chatLog?: FollowupChatEntry[];
  reason: string;
  overlap: number;
} {
  const followupCfg = currentConfig?.task?.followup;
  const decision = buildHeuristicFollowupChatLog({
    mode: followupCfg?.mode,
    previousTaskStatus,
    previousTaskUserInput: lastCompletedTaskInput,
    previousTaskAssistantOutput: lastCompletedTaskSummary,
    previousTaskCompletedAt: lastCompletedTaskAt,
    currentPrompt: prompt,
    ttlMs: normalizeTaskFollowupTtlMs(followupCfg?.ttlMs),
    minLexicalOverlap: normalizeTaskFollowupMinLexicalOverlap(followupCfg?.minLexicalOverlap),
  });
  return {
    chatLog: decision.chatLog,
    reason: decision.reason,
    overlap: decision.overlap,
  };
}

function isRoverExternalContextToolName(name: unknown): boolean {
  const toolName = String(name || '').trim();
  return toolName === ROVER_EXTERNAL_CONTEXT_TOOL_NAMES.read || toolName === ROVER_EXTERNAL_CONTEXT_TOOL_NAMES.act;
}

function buildExternalContextToolFailure(params: {
  code: string;
  message: string;
  retryable?: boolean;
  status?: number;
  details?: unknown;
}): Record<string, unknown> {
  const code = String(params.code || 'EXTERNAL_CONTEXT_FAILED').trim() || 'EXTERNAL_CONTEXT_FAILED';
  const message = String(params.message || 'External context request failed').trim() || 'External context request failed';
  return {
    success: false,
    error: `${code}: ${message}`,
    allowFallback: params.retryable !== false,
    output: {
      success: false,
      error: {
        code,
        message,
        retryable: params.retryable === true,
        status: Number.isFinite(Number(params.status)) ? Number(params.status) : undefined,
      },
      details: params.details,
    },
  };
}

async function executeRoverExternalContextToolCall(params: {
  call: any;
  routeTabId?: number;
  runtimeCfg: RoverInit;
}): Promise<Record<string, unknown>> {
  const toolName = String(params.call?.name || '').trim();
  const args = params.call?.args && typeof params.call.args === 'object' ? params.call.args : {};
  const intent: 'read_context' | 'act' =
    toolName === ROVER_EXTERNAL_CONTEXT_TOOL_NAMES.act ? 'act' : 'read_context';
  const tabIdCandidate = Number(args.tab_id);
  const tabId =
    Number.isFinite(tabIdCandidate) && tabIdCandidate > 0
      ? Math.trunc(tabIdCandidate)
      : (Number.isFinite(Number(params.routeTabId)) && Number(params.routeTabId) > 0
        ? Math.trunc(Number(params.routeTabId))
        : undefined);

  const knownTabs = sessionCoordinator?.listTabs({ scope: 'all' }) || [];
  const targetTab = tabId ? knownTabs.find(tab => tab.logicalTabId === tabId) : undefined;
  const explicitUrl = String(args.url || '').trim();
  const targetUrl = explicitUrl || String(targetTab?.url || '').trim();
  const message = String(args.message || args.user_input || '').trim() || undefined;
  const source = String(args.source || '').trim().toLowerCase() === 'google_search'
    ? 'google_search'
    : 'direct_url';

  if (!targetUrl) {
    return buildExternalContextToolFailure({
      code: 'MISSING_URL',
      message: 'External context tools require a target url or tab with a url.',
      retryable: false,
    });
  }

  if (!roverServerRuntime) {
    return buildExternalContextToolFailure({
      code: 'RUNTIME_UNAVAILABLE',
      message: 'Rover server runtime is not initialized.',
      retryable: true,
    });
  }

  const runId = String(
    runtimeState?.pendingRun?.id
    || roverServerRuntime.getActiveRunId()
    || serverAcceptedRunId
    || '',
  ).trim() || undefined;

  if (!runId) {
    return buildExternalContextToolFailure({
      code: 'NO_ACTIVE_RUN',
      message: 'External context tools can only run during an active run.',
      retryable: false,
    });
  }

  try {
    const response = await roverServerRuntime.fetchExternalContext({
      runId,
      tabId,
      url: targetUrl,
      intent,
      message,
      source,
    });
    if (!response) {
      return buildExternalContextToolFailure({
        code: 'EMPTY_RESPONSE',
        message: 'Server returned no external context response.',
        retryable: true,
      });
    }

    const pageData =
      response.pageData && typeof response.pageData === 'object'
        ? response.pageData
        : undefined;
    const outputPayload = pageData || response;
    return {
      success: true,
      output: {
        ...outputPayload,
        metadata: {
          ...(outputPayload && typeof outputPayload === 'object' ? (outputPayload as any).metadata || {} : {}),
          external: true,
          accessMode: 'external_scraped',
          logicalTabId: tabId,
          sourceTool: toolName,
        },
        intent,
      },
    };
  } catch (error: any) {
    const code = String(error?.code || '').trim().toUpperCase() || 'EXTERNAL_CONTEXT_FAILED';
    const status = Number(error?.status);
    const retryable = status >= 500 || code === 'STALE_SEQ' || code === 'STALE_EPOCH';
    return buildExternalContextToolFailure({
      code,
      message: String(error?.message || 'External context request failed'),
      retryable,
      status: Number.isFinite(status) ? status : undefined,
      details: error?.details,
    });
  }
}

function buildWorkerBoundaryConfig(extra?: Record<string, unknown>): Record<string, unknown> {
  const scopedTabIds = getTaskScopedTabIds();
  return {
    taskBoundaryId: currentTaskBoundaryId,
    taskTabScope: toWorkerTaskTabScopePayload(),
    scopedTabIds,
    ...(extra || {}),
  };
}

function postWorkerBoundaryConfig(extra?: Record<string, unknown>): void {
  if (!worker) return;
  worker.postMessage({
    type: 'update_config',
    config: buildWorkerBoundaryConfig(extra),
  });
}

function postRun(
  text: string,
  options?: {
    runId?: string;
    resume?: boolean;
    preserveHistory?: boolean;
    followupChatLog?: FollowupChatEntry[];
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
    if (hasRemoteExecutionOwner()) {
      appendUiMessage(
        'system',
        'This tab is read-only while another tab is actively running Rover.',
        true,
      );
      appendTimelineEvent({
        kind: 'info',
        title: 'Observer mode',
        detail: 'Input is disabled while the active run is controlled by another tab.',
        status: 'info',
      });
      return;
    }
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
    const localLogicalTabId = sessionCoordinator?.getLocalLogicalTabId();
    const activeLogicalTabId = sessionCoordinator?.getActiveLogicalTabId();
    const holderRuntimeId = sessionCoordinator?.getCurrentHolderRuntimeId() || runtimeId;
    setExecutionMode('controller', {
      localLogicalTabId,
      activeLogicalTabId,
      holderRuntimeId,
    });
    const allowActions = !!(currentConfig?.allowActions ?? true);
    bridge?.setAllowActions(allowActions);
    (bridge as any)?.setActionGateContext?.({
      mode: 'controller',
      controllerRuntimeId: holderRuntimeId,
      activeLogicalTabId,
      localLogicalTabId,
      reason: resolveActionGateReason('controller', allowActions),
    });
  }

  const runId = options?.runId || crypto.randomUUID();
  const resume = !!options?.resume;
  const appendUserMessageFlag = options?.appendUserMessage !== false;
  removeIgnoredRunId(runId);

  if (appendUserMessageFlag) {
    appendUiMessage('user', trimmed, true);
  }

  const previousAttempts = runtimeState?.pendingRun?.id === runId ? runtimeState.pendingRun.attempts : 0;
  const boundaryForRun =
    runtimeState?.pendingRun?.id === runId
      ? (runtimeState.pendingRun.taskBoundaryId || currentTaskBoundaryId)
      : currentTaskBoundaryId;
  touchTaskTabIds([resolveLocalSeedTabId()], { persist: true });
  const scopedTabIds = getTaskScopedTabIds();

  agentNavigationPending = false;
  setPendingRun({
    id: runId,
    text: trimmed,
    startedAt: Date.now(),
    attempts: resume ? previousAttempts + 1 : 0,
    autoResume: options?.autoResume !== false,
    taskBoundaryId: boundaryForRun,
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
    preserveHistory: !!options?.preserveHistory,
    followupChatLog: Array.isArray(options?.followupChatLog) ? options?.followupChatLog : undefined,
    routing: options?.routing,
    askUserAnswers: options?.askUserAnswers,
    scopedTabIds,
    taskTabScope: toWorkerTaskTabScopePayload(),
  });

  if (runSafetyTimer) clearTimeout(runSafetyTimer);
  const safetyRunId = runId;
  runSafetyTimer = setTimeout(() => {
    if (runtimeState?.pendingRun?.id === safetyRunId) {
      addIgnoredRunId(safetyRunId);
      setPendingRun(undefined);
      sessionCoordinator?.releaseWorkflowLock(safetyRunId);
      sessionCoordinator?.setActiveRun(undefined);
      markTaskCancelled('run_timeout_terminal');
      setUiStatus('Task timed out.');
      appendUiMessage('system', 'Task timed out after 5 minutes with no response.', true);
      emit('error', { message: 'Run safety timeout' });
    }
    runSafetyTimer = null;
  }, 5 * 60_000);
}

async function dispatchUserPromptAsync(
  text: string,
  options?: {
    bypassSuggestion?: boolean;
    startNewTask?: boolean;
    reason?: string;
    routing?: 'auto' | 'act' | 'planner';
    askUserAnswers?: RoverAskUserAnswerMeta;
    continueExistingRun?: boolean;
    continueRunId?: string;
  },
): Promise<void> {
  const trimmed = buildAskUserDispatchText(text, options?.askUserAnswers);
  if (!trimmed) return;
  maybeClearStalePendingRun();

  const activeTaskStatus = runtimeState?.activeTask?.status;
  const pendingQuestionCount = normalizeAskUserQuestions(runtimeState?.workerState?.pendingAskUser?.questions).length;
  const pendingAskUserBoundaryId = runtimeState?.workerState?.pendingAskUser?.boundaryId;
  const shouldStartFreshTask = shouldStartFreshTaskForPrompt({
    startNewTask: !!options?.startNewTask,
    taskStatus: activeTaskStatus,
    pendingAskUserQuestionCount: pendingQuestionCount,
    hasAskUserAnswers: !!options?.askUserAnswers,
    pendingAskUserBoundaryId,
    currentTaskBoundaryId,
  });
  const shouldContinueAskUserBoundary = !shouldStartFreshTask;
  const continuationRunId = shouldContinueAskUserBoundary
    ? (
      options?.continueRunId
      || runtimeState?.pendingRun?.id
      || roverServerRuntime?.getActiveRunId()
    )
    : undefined;
  const followupChatDecision = shouldStartFreshTask
    ? buildFollowupChatLogForFreshPrompt(trimmed, activeTaskStatus)
    : { reason: 'mode_disabled', overlap: 0 };
  const followupChatLog = followupChatDecision.chatLog;
  recordTelemetryEvent('status', {
    event: 'task_boundary_decision',
    startFreshTask: shouldStartFreshTask,
    askUserContinuation: shouldContinueAskUserBoundary,
    pendingAskUserQuestionCount: pendingQuestionCount,
    activeTaskStatus: activeTaskStatus || 'none',
  });
  recordTelemetryEvent('status', {
    event: 'followup_chat_cue',
    attached: Array.isArray(followupChatLog) && followupChatLog.length > 0,
    reason: followupChatDecision.reason,
    overlap: followupChatDecision.overlap,
  });

  sessionCoordinator?.pruneTabs(
    shouldStartFreshTask
      ? {
          dropRuntimeDetached: true,
          keepOnlyActiveLiveTab: true,
          keepRecentExternalPlaceholders: true,
        }
      : {
          dropRuntimeDetached: true,
        },
  );

  if (shouldStartFreshTask) {
    const hadActiveRun = !!runtimeState?.pendingRun;
    const autoReason =
      options?.reason ||
      (activeTaskStatus === 'completed'
        ? 'auto_after_task_complete'
        : activeTaskStatus === 'running'
          ? 'auto_new_prompt_boundary'
          : 'auto_after_task_end');
    recordTelemetryEvent('status', {
      event: 'task_boundary_reset',
      reason: autoReason,
      hadActiveRun,
    });
    newTask({ reason: autoReason, clearUi: true });
    // Allow cancel to propagate to server before starting new run
    if (hadActiveRun && roverServerRuntime) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  hideTaskSuggestion();
  let runId = continuationRunId;
  let routing: 'auto' | 'act' | 'planner' | undefined = options?.routing;
  if (roverServerRuntime && currentConfig) {
    try {
      const server = await roverServerRuntime.submitRunInput({
        message: trimmed,
        clientEventId: crypto.randomUUID(),
        continueRun: shouldContinueAskUserBoundary,
        forceNewRun: shouldStartFreshTask,
        runId: shouldContinueAskUserBoundary ? continuationRunId : undefined,
        requestedMode: options?.routing || currentConfig.taskRouting?.mode || 'act',
      });
      if (!server) {
        throw new Error('Server run/input returned no data; run was not accepted.');
      }
      if (Number.isFinite(Number(server.epoch || server.currentEpoch))) {
        runtimeServerEpoch = Math.max(1, Number(server.epoch || server.currentEpoch));
      }
      const acceptedRunId =
        typeof server.runId === 'string' && server.runId.trim()
          ? server.runId.trim()
          : '';
      if (!acceptedRunId) {
        const conflictType = String((server as any)?.conflict?.type || '').trim();

        // If server says there's an active run we don't know about, cancel it and retry
        if (conflictType === 'active_run_exists' && roverServerRuntime && shouldStartFreshTask) {
          const staleRunId = (server as any)?.conflict?.runId || server.runId;
          if (staleRunId) {
            await roverServerRuntime.controlRun({
              action: 'cancel',
              runId: staleRunId,
              reason: 'stale_run_cleanup',
            });
            // Retry submitRunInput once
            const retry = await roverServerRuntime.submitRunInput({
              message: trimmed,
              clientEventId: crypto.randomUUID(),
              continueRun: false,
              forceNewRun: true,
              requestedMode: options?.routing || currentConfig.taskRouting?.mode || 'act',
            });
            if (retry?.runId) {
              runId = retry.runId.trim();
              setServerAcceptedRunId(runId);
              if (retry.acceptedMode === 'act' || retry.acceptedMode === 'planner') {
                routing = retry.acceptedMode;
              }
            }
          }
        }

        if (!runId) {
          const reason = String(server.decisionReason || conflictType || server.message || 'run_not_accepted').trim();
          throw new Error(`Server did not accept this run (${reason}).`);
        }
      }
      if (!runId) runId = acceptedRunId;
      setServerAcceptedRunId(runId);
      if (server.acceptedMode === 'act' || server.acceptedMode === 'planner') {
        routing = server.acceptedMode;
      }
    } catch (error: any) {
      const message = String(error?.message || 'server run submission failed');
      setServerAcceptedRunId(undefined);
      appendTimelineEvent({
        kind: 'error',
        title: 'Run start failed',
        detail: message,
        status: 'error',
      });
      appendUiMessage('system', `Unable to start task: ${message}`, true);
      setUiStatus(`Task could not start (${message})`);
      emit('error', { message, scope: 'run_input' });
      return;
    }
  }

  postRun(trimmed, {
    runId,
    appendUserMessage: true,
    resume: false,
    preserveHistory: false,
    followupChatLog,
    autoResume: true,
    routing,
    askUserAnswers: options?.askUserAnswers,
  });
}

function dispatchUserPrompt(
  text: string,
  options?: {
    bypassSuggestion?: boolean;
    startNewTask?: boolean;
    reason?: string;
    routing?: 'auto' | 'act' | 'planner';
    askUserAnswers?: RoverAskUserAnswerMeta;
    continueExistingRun?: boolean;
    continueRunId?: string;
  },
): void {
  void dispatchUserPromptAsync(text, options);
}

function clearPendingRunForResume(reason: string, statusText: string): void {
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }
  const pending = runtimeState?.pendingRun;
  if (pending?.id) {
    addIgnoredRunId(pending.id);
    sessionCoordinator?.releaseWorkflowLock(pending.id);
  }
  setPendingRun(undefined);
  sessionCoordinator?.setActiveRun(undefined);
  clearResumeArtifacts();
  setUiStatus(statusText || reason);
}

function hasLiveRemoteControllerForPendingRun(pendingRunId: string): boolean {
  const sharedActiveRun = sessionCoordinator?.getState()?.activeRun;
  if (!sharedActiveRun?.runtimeId || sharedActiveRun.runtimeId === runtimeId) return false;
  if (sharedActiveRun.runId !== pendingRunId) return true;
  const remoteTab = sessionCoordinator
    ?.listTabs({ scope: 'all' })
    .find(tab => tab.runtimeId === sharedActiveRun.runtimeId);
  if (!remoteTab) return false;
  return Number(remoteTab.updatedAt) > Date.now() - 5_000;
}

function scheduleAutoResumeRetry(delayMs = 450): void {
  if (autoResumeRetryTimer) return;
  autoResumeRetryTimer = setTimeout(() => {
    autoResumeRetryTimer = null;
    maybeAutoResumePendingRun();
  }, Math.max(120, delayMs));
}

function maybeAutoResumePendingRun(): void {
  if (!runtimeState?.pendingRun) {
    if (autoResumeRetryTimer) {
      clearTimeout(autoResumeRetryTimer);
      autoResumeRetryTimer = null;
    }
    return;
  }
  const pending = sanitizePendingRun(runtimeState.pendingRun);
  if (!pending) return;

  if (currentMode === 'observer' && !hasRemoteExecutionOwner()) {
    setExecutionMode('controller', {
      localLogicalTabId: sessionCoordinator?.getLocalLogicalTabId(),
      activeLogicalTabId: sessionCoordinator?.getActiveLogicalTabId(),
      holderRuntimeId: sessionCoordinator?.getCurrentHolderRuntimeId(),
    });
  }
  if (currentMode === 'observer') return;

  const allowWithoutSessionReady =
    pending.resumeReason === 'agent_navigation'
    || pending.resumeReason === 'handoff'
    || pending.resumeReason === 'page_reload'
    || pending.resumeReason === 'cross_host_navigation';
  if (!workerReady || !worker || autoResumeAttempted) return;
  if (!sessionReady && !allowWithoutSessionReady) return;
  if (!canAutoResumePendingRun(runtimeState.activeTask?.status)) return;
  if (isTerminalTaskStatus(runtimeState.activeTask?.status)) {
    clearPendingRunForResume('terminal_task', 'Previous task already ended.');
    return;
  }
  if (!pending.autoResume) return;
  const resumeMode = normalizeTaskResumeMode(currentConfig?.task?.resume?.mode);
  if (resumeMode !== 'crash_only') {
    clearPendingRunForResume('unsupported_resume_mode', 'Previous task dismissed.');
    return;
  }
  if (pending.resumeRequired !== true) {
    if (autoResumeRetryTimer) {
      clearTimeout(autoResumeRetryTimer);
      autoResumeRetryTimer = null;
    }
    return;
  }
  if (hasLiveRemoteControllerForPendingRun(pending.id)) {
    scheduleAutoResumeRetry(650);
    return;
  }
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }

  const ttlMs = normalizeTaskResumeTtlMs(currentConfig?.task?.resume?.ttlMs);
  const ageMs = Date.now() - Number(pending.startedAt || 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlMs) {
    clearPendingRunForResume('resume_ttl_expired', 'Previous task expired.');
    return;
  }

  if (pending.attempts >= MAX_AUTO_RESUME_ATTEMPTS) {
    clearPendingRunForResume('resume_attempt_limit', 'Previous task dismissed.');
    return;
  }

  autoResumeAttempted = true;
  crossDomainResumeActive = false;
  setUiStatus('Resuming interrupted task...');
  postRun(pending.text, {
    runId: pending.id,
    resume: true,
    appendUserMessage: false,
    autoResume: true,
  });
}

function shouldAdoptIncomingRuntimeState(params: {
  localState: PersistedRuntimeState;
  incomingState: PersistedRuntimeState;
  allowRicherIncomingOnResume?: boolean;
}): boolean {
  return shouldAdoptCheckpointState({
    localUpdatedAt: Number(params.localState.updatedAt) || 0,
    incomingUpdatedAt: Number(params.incomingState.updatedAt) || 0,
    localState: params.localState,
    incomingState: params.incomingState,
    crossDomainResumeActive: !!params.allowRicherIncomingOnResume && crossDomainResumeActive,
  });
}

async function applyAsyncRuntimeStateHydration(key: string): Promise<void> {
  if (!runtimeState) return;
  const loaded = await loadPersistedStateFromAsyncStore(key);
  if (!loaded || !runtimeState) return;
  const normalized = normalizePersistedState(
    {
      ...loaded,
      sessionId: runtimeState.sessionId,
      runtimeId,
    },
    runtimeState.sessionId,
    runtimeId,
  );
  if (
    !shouldAdoptIncomingRuntimeState({
      localState: runtimeState,
      incomingState: normalized,
      allowRicherIncomingOnResume: true,
    })
  ) {
    return;
  }
  const localTaskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
  const incomingTaskEpoch = Math.max(1, Number(normalized.taskEpoch) || 1);
  const incomingBoundaryId = resolveExistingTaskBoundaryIdFromState(normalized);
  if (
    !shouldAcceptIncomingWorkerBoundary({
      source: 'indexeddb_checkpoint',
      incomingBoundaryId,
      taskEpochAdvanced: incomingTaskEpoch > localTaskEpoch,
      allowBootstrapAdoption: true,
    })
  ) {
    return;
  }

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
  syncCurrentTaskBoundaryId({ rotateIfMissing: !currentTaskBoundaryId });
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

  if (workerReady && worker) {
    postWorkerBoundaryConfig();
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
      runtimeState.workerState = undefined;
      currentTaskBoundaryId = createTaskBoundaryId();
      runtimeState.taskTabScope = undefined;
      ensureTaskTabScopeSeed({ forceReset: true, persist: false });
      postWorkerBoundaryConfig();
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
      const existingPending = sanitizePendingRun(runtimeState.pendingRun);
      const incomingBoundaryId = normalizeTaskBoundaryId(state.workerContext?.taskBoundaryId);
      const sameRun =
        existingPending?.id === state.activeRun.runId
        && (
          !existingPending?.taskBoundaryId
          || normalizeTaskBoundaryId(existingPending.taskBoundaryId)
            === (incomingBoundaryId || normalizeTaskBoundaryId(currentTaskBoundaryId))
        );
      const incomingResumeRequired =
        sameRun
          ? existingPending?.resumeRequired === true
          : String(state.activeRun.runtimeId || '').trim() === '';
      setPendingRun(
        sanitizePendingRun({
          id: state.activeRun.runId,
          text: state.activeRun.text,
          startedAt: state.activeRun.startedAt,
          attempts: sameRun ? (existingPending?.attempts || 0) : 0,
          autoResume: true,
          taskBoundaryId:
            (sameRun ? existingPending?.taskBoundaryId : undefined)
            || incomingBoundaryId
            || existingPending?.taskBoundaryId
            || currentTaskBoundaryId,
          resumeRequired: incomingResumeRequired,
          resumeReason: sameRun
            ? existingPending?.resumeReason
            : (incomingResumeRequired ? 'agent_navigation' : undefined),
        }),
      );
    } else {
      const shouldClearPending = shouldClearPendingFromSharedState({
        localTaskStatus,
        remoteTaskStatus,
        mode: currentMode,
        hasRemoteActiveRun: !!state.activeRun,
      });
      const existingPending = sanitizePendingRun(runtimeState.pendingRun);
      const preserveResumePending =
        existingPending?.resumeRequired === true
        && canAutoResumePendingRun(localTaskStatus);
      if (shouldClearPending && !preserveResumePending) {
        if (runtimeState.pendingRun?.id) {
          addIgnoredRunId(runtimeState.pendingRun.id);
        }
        setPendingRun(undefined);
        if (remoteTaskStatus && remoteTaskStatus !== 'running') {
          clearResumeArtifacts();
        }
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
      if (
        incomingWorker
        && incomingUpdatedAt > localUpdatedAt + 100
        && shouldAcceptIncomingWorkerBoundary({
          source: 'shared_worker_context',
          incomingBoundaryId: incomingWorker.taskBoundaryId,
          taskEpochAdvanced,
          allowBootstrapAdoption: true,
        })
      ) {
        runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
          incomingWorker,
          resolveCurrentTaskBoundaryCandidate(),
        );
        syncCurrentTaskBoundaryId();
        if (workerReady && worker && currentMode === 'controller') {
          postWorkerBoundaryConfig();
          worker.postMessage({ type: 'hydrate_state', state: runtimeState.workerState });
          emit('context_restored', { source: 'shared_session', ts: Date.now() });
        }
      }
    }
  }

  runtimeState.uiMessages = sanitizeUiMessages(runtimeState.uiMessages);
  runtimeState.timeline = sanitizeTimelineEvents(runtimeState.timeline);
  runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
    sanitizeWorkerState(runtimeState.workerState),
    resolveCurrentTaskBoundaryCandidate(),
  );
  syncCurrentTaskBoundaryId();
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
    taskTabScope: sanitizeTaskTabScope(
      state.taskTabScope,
      sanitizePendingRun(state.pendingRun)?.taskBoundaryId
      || sanitizeWorkerState(state.workerState)?.taskBoundaryId,
    ),
    lastNavigationHandoff: sanitizeNavigationHandoff(state.lastNavigationHandoff),
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
  // V1 default is enabled when token + visitor prerequisites are available.
  if (cfg.checkpointing?.enabled === false) return false;
  if (!getRuntimeSessionToken(cfg)) return false;
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
      postWorkerBoundaryConfig({ sessionId: remoteSessionId });
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
      if (
        shouldAdoptIncomingRuntimeState({
          localState: runtimeState,
          incomingState,
          allowRicherIncomingOnResume: true,
        })
      ) {
        const localTaskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
        const incomingTaskEpoch = Math.max(1, Number(incomingState.taskEpoch) || 1);
        const incomingBoundaryId = resolveExistingTaskBoundaryIdFromState(incomingState);
        if (
          !shouldAcceptIncomingWorkerBoundary({
            source: 'cloud_checkpoint',
            incomingBoundaryId,
            taskEpochAdvanced: incomingTaskEpoch > localTaskEpoch,
            allowBootstrapAdoption: true,
          })
        ) {
          return;
        }
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
        syncCurrentTaskBoundaryId();
        runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
          runtimeState.workerState,
          resolveCurrentTaskBoundaryCandidate(),
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

        if (workerReady) {
          postWorkerBoundaryConfig();
        }
        if (workerReady && runtimeState.workerState) {
          worker?.postMessage({ type: 'hydrate_state', state: runtimeState.workerState });
          emit('context_restored', { source: 'cloud_checkpoint', ts: Date.now() });
        }
        if (currentMode === 'controller') {
          maybeAutoResumePendingRun();
        }
        crossDomainResumeActive = false;
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
  const checkpointToken = getRuntimeSessionToken(cfg);
  if (!checkpointToken) {
    emit('legacy_checkpoint_blocked', {
      reason: 'missing_or_invalid_session_token',
      expectedPrefix: 'rvrsess_',
      action: 'disabled_cloud_checkpoint_client',
    });
    return;
  }

  try {
    const emitCheckpointState = (payload: {
      state: RoverCloudCheckpointState;
      reason?: string;
      action?: 'session_snapshot_upsert' | 'session_projection_get';
      code?: string;
      message?: string;
    }) => {
      emit('checkpoint_state', payload);
      cfg.checkpointing?.onStateChange?.(payload);
    };

    cloudCheckpointClient = new RoverCloudCheckpointClient({
      apiBase: cfg.apiBase,
      authToken: checkpointToken,
      getSessionToken: () => getRuntimeSessionToken(currentConfig),
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
      const effectiveRole = resolveEffectiveExecutionMode(role);
      setExecutionMode(effectiveRole, info);
      const allowActions = effectiveRole === 'controller' && (currentConfig?.allowActions ?? true);
      bridge?.setAllowActions(allowActions);
      (bridge as any)?.setActionGateContext?.({
        mode: effectiveRole,
        controllerRuntimeId: info?.holderRuntimeId ?? sessionCoordinator?.getCurrentHolderRuntimeId(),
        activeLogicalTabId: info?.activeLogicalTabId ?? sessionCoordinator?.getActiveLogicalTabId(),
        localLogicalTabId: info?.localLogicalTabId ?? sessionCoordinator?.getLocalLogicalTabId(),
        reason: resolveActionGateReason(effectiveRole, allowActions),
      });
      if (effectiveRole === 'controller') {
        ensureTaskTabScopeSeed({ persist: true, appendSeed: false });
        const sharedWorkerContext = sessionCoordinator?.getWorkerContext();
        if (sharedWorkerContext) {
          const incomingWorker = sanitizeWorkerState(sharedWorkerContext);
          const localUpdatedAt = Number(runtimeState?.workerState?.updatedAt) || 0;
          const incomingUpdatedAt = Number(incomingWorker?.updatedAt) || 0;
          if (
            incomingWorker
            && incomingUpdatedAt > localUpdatedAt + 100
            && shouldAcceptIncomingWorkerBoundary({
              source: 'controller_handoff',
              incomingBoundaryId: incomingWorker.taskBoundaryId,
              allowBootstrapAdoption: true,
            })
          ) {
            if (runtimeState) {
              runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
                incomingWorker,
                resolveCurrentTaskBoundaryCandidate(),
              );
              syncCurrentTaskBoundaryId();
              persistRuntimeState();
            }
            if (workerReady && worker) {
              postWorkerBoundaryConfig();
              worker.postMessage({ type: 'hydrate_state', state: runtimeState?.workerState });
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

  const startupHandoff = getUnconsumedNavigationHandoff();
  sessionCoordinator.start(toSharedNavigationHandoff(startupHandoff));
  ensureTaskTabScopeSeed({ persist: true, appendSeed: false });
  const bootstrapPending = sanitizePendingRun(runtimeState?.pendingRun);
  if (bootstrapPending?.resumeRequired === true) {
    sessionCoordinator.requestControl();
  }
  if (runtimeState?.lastNavigationHandoff && startupHandoff) {
    runtimeState.lastNavigationHandoff = sanitizeNavigationHandoff({
      ...runtimeState.lastNavigationHandoff,
      consumed: true,
    });
    persistRuntimeState();
  }

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
  if (runId) {
    latestAssistantByRunId.delete(runId);
  }

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

  if (msg.type === 'runtime_tabs_diagnostics') {
    const diagnostics = msg?.diagnostics && typeof msg.diagnostics === 'object' ? msg.diagnostics : {};
    const scopedTabIds = dedupePositiveTabIds((diagnostics as any).keptScopedTabIds || []);
    const listedTabIds = dedupePositiveTabIds((diagnostics as any).listedTabIds || []);
    const resolvedTabOrder = dedupePositiveTabIds((diagnostics as any).resolvedTabOrder || []);
    const missingScopedTabIds = scopedTabIds.filter(tabId => !listedTabIds.includes(tabId));
    if (missingScopedTabIds.length > 0) {
      appendTimelineEvent({
        kind: 'status',
        title: 'Scoped tab placeholder retained',
        detail: `missing_in_listing=${missingScopedTabIds.join(',')}; resolved_order=${resolvedTabOrder.join(',') || 'none'}`,
        status: 'info',
      });
      recordTelemetryEvent('status', {
        event: 'scoped_tab_missing_from_listing',
        missingScopedTabIds,
        listedTabIds,
        resolvedTabOrder,
      });
    }
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
    if (!isToolResultFailure(msg.result)) {
      const touchedTabIds = dedupePositiveTabIds([
        ...extractTabIdsFromToolArgs(msg.call?.args),
        ...extractTabIdsFromToolResult(msg.result),
      ]);
      if (touchedTabIds.length) {
        touchTaskTabIds(touchedTabIds, { persist: true });
        postWorkerBoundaryConfig();
      }
    }
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
      const incomingWorkerState = sanitizeWorkerState({
        ...(msg.state || {}),
        updatedAt: Date.now(),
      });
      if (
        !incomingWorkerState
        || !shouldAcceptIncomingWorkerBoundary({
          source: 'worker_snapshot',
          incomingBoundaryId: incomingWorkerState.taskBoundaryId,
          allowBootstrapAdoption: true,
        })
      ) {
        return;
      }
      runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
        incomingWorkerState,
        resolveCurrentTaskBoundaryCandidate(),
      );
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
    const messageTaskBoundaryId =
      typeof msg?.taskBoundaryId === 'string' ? normalizeTaskBoundaryId(msg.taskBoundaryId) : undefined;
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
        taskBoundaryId: messageTaskBoundaryId || existing?.taskBoundaryId || currentTaskBoundaryId,
        resumeReason: existing?.resumeReason,
        resumeRequired: existing?.resumeRequired,
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

  if (msg.type === 'run_completed' || msg.type === 'run_state_transition') {
    lastStatusSignature = '';
    autoResumeAttempted = false;
    const completionState = normalizeRunCompletionState(msg);
    const terminalState = completionState.terminalState;
    const continuationReason = completionState.continuationReason;
    const isTerminalRunCompletion =
      msg?.ok === false
      || terminalState === 'completed'
      || terminalState === 'failed';
    const shouldShowRunningIndicator =
      !isTerminalRunCompletion
      && terminalState === 'in_progress'
      && continuationReason !== 'awaiting_user';
    ui?.setRunning(shouldShowRunningIndicator);
    if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
    const completedRunId = typeof msg.runId === 'string' && msg.runId ? msg.runId : undefined;
    const messageTaskBoundaryId =
      typeof msg?.taskBoundaryId === 'string' ? normalizeTaskBoundaryId(msg.taskBoundaryId) : undefined;
    if (isTerminalRunCompletion) {
      const pendingBeforeClear = sanitizePendingRun(runtimeState?.pendingRun);
      const completedInput = String(
        pendingBeforeClear?.text
        || lastUserInputText
        || '',
      ).trim();
      const completedSummary = String(
        (completedRunId ? latestAssistantByRunId.get(completedRunId) : '')
        || '',
      ).trim();
      lastCompletedTaskInput = completedInput || lastCompletedTaskInput;
      lastCompletedTaskSummary = completedSummary || lastCompletedTaskSummary;
      lastCompletedTaskAt = Date.now();

      if (pendingBeforeClear?.id) {
        sessionCoordinator?.releaseWorkflowLock(pendingBeforeClear.id);
      }
      if (completedRunId) {
        sessionCoordinator?.releaseWorkflowLock(completedRunId);
      }
      setPendingRun(undefined);
      setServerAcceptedRunId(undefined);
      sessionCoordinator?.setActiveRun(undefined);
      if (completedRunId) {
        addIgnoredRunId(completedRunId);
      }
    } else if (isTaskRunning() && completedRunId) {
      removeIgnoredRunId(completedRunId);
      setServerAcceptedRunId(completedRunId);
      const existing = runtimeState?.pendingRun;
      const resumedText =
        existing?.id === completedRunId && existing?.text
          ? existing.text
          : (lastUserInputText || existing?.text || 'Continue task');
      setPendingRun(
        sanitizePendingRun({
          id: completedRunId,
          text: resumedText,
          startedAt: existing?.startedAt || Date.now(),
          attempts: existing?.attempts || 0,
          autoResume: existing?.autoResume !== false,
          taskBoundaryId: messageTaskBoundaryId || existing?.taskBoundaryId || currentTaskBoundaryId,
          resumeRequired:
            terminalState === 'in_progress'
            && continuationReason === 'same_tab_navigation_handoff',
          resumeReason:
            terminalState === 'in_progress'
            && continuationReason === 'same_tab_navigation_handoff'
              ? (existing?.resumeReason || 'agent_navigation')
              : undefined,
        }),
      );
      sessionCoordinator?.setActiveRun({ runId: completedRunId, text: resumedText });
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
    if (!msg.ok && msg.error) {
      if (completedRunId) {
        latestAssistantByRunId.delete(completedRunId);
      }
      if (completedRunId) {
        void roverServerRuntime?.controlRun({
          action: 'cancel',
          runId: completedRunId,
          reason: 'worker_run_failed',
        });
      }
      if (!isTaskRunning()) {
        return;
      }
        ui?.setQuestionPrompt(undefined);
        if (completionState.contextResetRecommended) {
          markTaskFailed('worker_run_failed_terminal');
          sessionCoordinator?.resetTabsToCurrent(window.location.href, document.title || undefined);
          setUiStatus(`Task failed: ${String(msg.error)}. Start a new task to continue.`);
        } else {
          // Safety net: terminal failure should still mark task ended even if
          // contextResetRecommended was somehow false. This prevents false auto-resume.
          markTaskFailed('worker_run_failed_terminal');
          setUiStatus(`Task failed: ${String(msg.error)}`);
        }
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
      const taskComplete = completionState.taskComplete;
      const needsUserInput = completionState.needsUserInput;
      const completionQuestions = completionState.questions || normalizeAskUserQuestions(msg.questions);
      const pendingStateQuestions = normalizeAskUserQuestions(runtimeState?.workerState?.pendingAskUser?.questions);
      const questions = completionQuestions.length
        ? completionQuestions
        : (needsUserInput ? pendingStateQuestions : []);
      if (terminalState === 'failed') {
        if (completedRunId) {
          void roverServerRuntime?.controlRun({
            action: 'cancel',
            runId: completedRunId,
            reason: 'worker_terminal_failed',
          });
        }
        ui?.setQuestionPrompt(undefined);
        if (completionState.contextResetRecommended) {
          markTaskFailed('worker_run_failed_terminal');
          sessionCoordinator?.resetTabsToCurrent(window.location.href, document.title || undefined);
          setUiStatus('Task failed. Start a new task to continue.');
        } else {
          // Safety net: terminal failure should still mark task ended even if
          // contextResetRecommended was somehow false. This prevents false auto-resume.
          markTaskFailed('worker_run_failed_terminal');
          setUiStatus('Task failed.');
        }
        appendTimelineEvent({
          kind: 'error',
          title: 'Run failed',
          detail: typeof msg.error === 'string' ? msg.error : 'Run reported failure state.',
          status: 'error',
        });
      } else if (taskComplete || terminalState === 'completed') {
        if (completedRunId) {
          void roverServerRuntime?.controlRun({
            action: 'end_task',
            runId: completedRunId,
            reason: 'worker_task_complete',
          });
        }
        ui?.setQuestionPrompt(undefined);
        markTaskCompleted('worker_task_complete');
        sessionCoordinator?.resetTabsToCurrent(window.location.href, document.title || undefined);
        setUiStatus('Task completed');
        finalizeSuccessfulRunTimeline(typeof msg.runId === 'string' ? msg.runId : undefined);
      } else {
        const nextReason =
          needsUserInput
            ? 'worker_waiting_for_input'
            : continuationReason === 'same_tab_navigation_handoff'
              ? 'worker_navigation_handoff'
              : terminalState === 'in_progress'
                ? 'worker_loop_continue'
              : 'worker_task_active';
        if (needsUserInput) {
          applyTaskKernelCommand({
            type: 'awaiting_user',
            reason: nextReason,
            at: Date.now(),
          });
        } else {
          markTaskRunning(nextReason);
        }
        if (needsUserInput && questions.length > 0) {
          ui?.setQuestionPrompt({ questions });
        } else if (needsUserInput) {
          syncQuestionPromptFromWorkerState();
        } else {
          ui?.setQuestionPrompt(undefined);
        }
        if (needsUserInput) {
          setUiStatus('Need more input to continue');
          appendTimelineEvent({
            kind: 'status',
            title: 'Waiting for your input',
            detail: questions.length
              ? `Please answer: ${questions.map(question => `${question.key} (${question.query})`).join('; ')}`
              : 'Planner requested more information before marking the task complete.',
            status: 'info',
          });
        } else if (continuationReason === 'same_tab_navigation_handoff') {
          setUiStatus('Navigating to continue task...');
          appendTimelineEvent({
            kind: 'status',
            title: 'Navigation handoff',
            detail: 'Rover will resume after same-tab navigation completes.',
            status: 'pending',
          });
        } else {
          setUiStatus('Working...');
        }
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
    const sharedWorkerStateCandidate = dropMismatchedPendingAskUserForBoundary(
      sanitizeWorkerState(sharedWorkerContext),
      resolveCurrentTaskBoundaryCandidate(),
    );
    const sharedWorkerState =
      sharedWorkerStateCandidate
      && shouldAcceptIncomingWorkerBoundary({
        source: 'ready_hydrate',
        incomingBoundaryId: sharedWorkerStateCandidate.taskBoundaryId,
        allowBootstrapAdoption: true,
      })
        ? sharedWorkerStateCandidate
        : undefined;
    const localWorkerStateCandidate = dropMismatchedPendingAskUserForBoundary(
      sanitizeWorkerState(runtimeState?.workerState),
      resolveCurrentTaskBoundaryCandidate(),
    );
    const localWorkerState =
      localWorkerStateCandidate
      && shouldAcceptIncomingWorkerBoundary({
        source: 'ready_hydrate',
        incomingBoundaryId: localWorkerStateCandidate.taskBoundaryId,
        allowBootstrapAdoption: true,
      })
        ? localWorkerStateCandidate
        : undefined;
    const localUpdatedAt = Number(localWorkerState?.updatedAt) || 0;
    const sharedUpdatedAt = Number(sharedWorkerState?.updatedAt) || 0;
    const stateToHydrate =
      sharedWorkerState && sharedUpdatedAt > localUpdatedAt + 100
        ? sharedWorkerState
        : localWorkerState;

    if (runtimeState) {
      if (stateToHydrate && stateToHydrate !== runtimeState.workerState) {
        runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
          stateToHydrate,
          resolveCurrentTaskBoundaryCandidate(),
        );
        persistRuntimeState();
      } else if (!stateToHydrate && runtimeState.workerState) {
        runtimeState.workerState = undefined;
        persistRuntimeState();
      }
    }

    if (stateToHydrate) {
      worker?.postMessage({ type: 'hydrate_state', state: stateToHydrate });
      emit('context_restored', { source: 'runtime_start', ts: Date.now() });
    } else if (crossDomainResumeActive && cloudCheckpointClient) {
      // Cross-domain resume: worker has no local state. Trigger cloud checkpoint pull
      // to recover workerState. applyCloudCheckpointPayload will hydrate the worker
      // and call maybeAutoResumePendingRun() when ready.
      cloudCheckpointClient.syncNow();
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
  let payload: any = null;
  const runtimeToken = getBootstrapRuntimeAuthToken(cfg) || getRuntimeSessionToken(cfg);
  if (!runtimeToken) return null;

  const startBody: Record<string, unknown> = {
    siteId: cfg.siteId,
    sessionId: runtimeState?.sessionId || cfg.sessionId,
    host: window.location.hostname,
    url: window.location.href,
  };
  if (runtimeToken.startsWith('rvrsess_')) {
    startBody.sessionToken = runtimeToken;
  } else {
    startBody.bootstrapToken = runtimeToken;
  }

  const baseCandidates = resolveRoverV1Bases(cfg.apiBase);
  for (const base of baseCandidates) {
    try {
      const v1Resp = await fetch(`${base}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startBody),
      });
      const v1Json = await v1Resp.json().catch(() => undefined);
      if (!v1Resp.ok || !v1Json?.success) continue;
      payload = v1Json?.data?.siteConfig || null;
      if (payload) break;
    } catch {
      // try next candidate
    }
  }

  if (!payload) return null;

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
    const initialRole = resolveEffectiveExecutionMode(sessionCoordinator.getRole());
    currentMode = initialRole;
    if (runtimeState) {
      runtimeState.executionMode = initialRole;
    }
  }
  setupCloudCheckpointing(cfg);
  setupTelemetry(cfg);

  const initialAllowActions =
    (cfg.allowActions ?? true) && (sessionCoordinator ? sessionCoordinator.isController() : true);

  const ensureNavigationPendingRun = (
    reason: 'agent_navigation' | 'cross_host_navigation',
  ): PersistedPendingRun | undefined => {
    if (!runtimeState) return undefined;

    const existingPending = sanitizePendingRun(runtimeState.pendingRun);
    if (existingPending) {
      const updated = sanitizePendingRun({
        ...existingPending,
        taskBoundaryId: existingPending.taskBoundaryId || currentTaskBoundaryId,
        resumeRequired: true,
        resumeReason: reason,
      });
      runtimeState.pendingRun = updated;
      if (updated) {
        sessionCoordinator?.setActiveRun({ runId: updated.id, text: updated.text });
      }
      return updated;
    }

    const sharedActiveRun = sessionCoordinator?.getState().activeRun;
    const activeRunId = String(
      roverServerRuntime?.getActiveRunId()
      || serverAcceptedRunId
      || sharedActiveRun?.runId
      || '',
    ).trim();
    if (!activeRunId) return undefined;

    const activeRunText = String(
      sharedActiveRun?.text
      || lastUserInputText
      || 'Continue task',
    ).trim() || 'Continue task';

    const synthesized = sanitizePendingRun({
      id: activeRunId,
      text: activeRunText,
      startedAt: Date.now(),
      attempts: 0,
      autoResume: true,
      taskBoundaryId: currentTaskBoundaryId,
      resumeRequired: true,
      resumeReason: reason,
    });
    runtimeState.pendingRun = synthesized;
    if (synthesized) {
      sessionCoordinator?.setActiveRun({ runId: synthesized.id, text: synthesized.text });
    }
    return synthesized;
  };

  bridge = new Bridge({
    allowActions: initialAllowActions,
    runtimeId,
    allowedDomains: cfg.allowedDomains,
    domainScopeMode: cfg.domainScopeMode,
    externalNavigationPolicy: cfg.externalNavigationPolicy,
    crossHostPolicy: normalizeCrossHostPolicy(cfg.navigation?.crossHostPolicy),
    navigationDelayMs: cfg.timing?.navigationDelayMs,
    domSettle: {
      debounceMs: normalizeTimingNumber(cfg.timing?.domSettleDebounceMs, 8, 500),
      maxWaitMs: normalizeTimingNumber(cfg.timing?.domSettleMaxWaitMs, 80, 5000),
      retries: normalizeTimingNumber(cfg.timing?.domSettleRetries, 0, 6),
      sparseTreeRetryDelayMs: normalizeTimingNumber(cfg.timing?.sparseTreeRetryDelayMs, 20, 1000),
      sparseTreeRetryMaxAttempts: normalizeTimingNumber(cfg.timing?.sparseTreeRetryMaxAttempts, 0, 4),
    },
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
      if (roverServerRuntime && event?.blockedUrl) {
        const runId = getServerRunIdForDispatch();
        if (!runId) return;
        const currentHost = String(window.location.hostname || '').toLowerCase();
        const targetHost = (() => {
          try {
            return new URL(String(event.blockedUrl)).hostname.toLowerCase();
          } catch {
            return undefined;
          }
        })();
        void roverServerRuntime
          .sendTabEvent({
            runId,
            currentUrl: String(event.currentUrl || window.location.href),
            targetUrl: String(event.blockedUrl),
            message: String(event.reason || ''),
            currentHost: currentHost || undefined,
            targetHost,
            isCrossHost: !!targetHost && !!currentHost && targetHost !== currentHost,
          })
          .then(decision => {
            if (!decision) return;
            if (decision.retryAttempted) {
              emit('tab_event_conflict_retry', {
                runId: decision.runId || runId,
                decisionReason: decision.decisionReason,
                conflict: decision.conflict,
              });
            }
            if (decision.retryExhausted) {
              emit('tab_event_conflict_exhausted', {
                runId: decision.runId || runId,
                decisionReason: decision.decisionReason,
                conflict: decision.conflict,
              });
            }
          })
          .catch(() => undefined);
      }
    },
    onBeforeAgentNavigation: async (intent: NavigationIntentEvent) => {
      const runId = getServerRunIdForDispatch();
      const currentHost = String(window.location.hostname || '').toLowerCase();
      const targetHost = (() => {
        try {
          return new URL(String(intent?.targetUrl || '')).hostname.toLowerCase();
        } catch {
          return undefined;
        }
      })();
      const crossRegistrableDomain =
        !!currentHost
        && !!targetHost
        && deriveRegistrableDomain(currentHost) !== deriveRegistrableDomain(targetHost);
      const targetInScope = isHostInNavigationScope({
        host: targetHost,
        currentHost,
        allowedDomains: currentConfig?.allowedDomains,
        domainScopeMode: currentConfig?.domainScopeMode,
      });
      const fallbackDecision: 'allow_same_tab' | 'open_new_tab' | 'block' =
        targetInScope
          ? 'allow_same_tab'
          : currentConfig?.externalNavigationPolicy === 'block'
            ? 'block'
            : currentConfig?.externalNavigationPolicy === 'allow'
              ? 'allow_same_tab'
              : 'open_new_tab';
      const preflightMessage = resolveNavigationPreflightMessageContext();

      let serverDecision: TabEventDecisionResponse | null = null;
      if (intent?.targetUrl && roverServerRuntime && runId) {
        const isCrossHost = !!targetHost && !!currentHost && targetHost !== currentHost;
        serverDecision = await roverServerRuntime
          .sendTabEvent({
            runId,
            currentUrl: window.location.href,
            targetUrl: intent.targetUrl,
            message: preflightMessage,
            currentHost: currentHost || undefined,
            targetHost,
            isCrossHost,
          })
          .catch(() => null);

        if (serverDecision?.retryAttempted) {
          emit('tab_event_conflict_retry', {
            runId: serverDecision.runId || runId,
            decisionReason: serverDecision.decisionReason,
            conflict: serverDecision.conflict,
            targetUrl: intent.targetUrl,
          });
        }
        if (serverDecision?.retryExhausted) {
          emit('tab_event_conflict_exhausted', {
            runId: serverDecision.runId || runId,
            decisionReason: serverDecision.decisionReason,
            conflict: serverDecision.conflict,
            targetUrl: intent.targetUrl,
          });
        }
      }

      const resolvedDecision = resolveNavigationDecision({
        crossRegistrableDomain,
        fallbackDecision,
        serverDecision: serverDecision?.decision,
        serverAvailable: !!serverDecision,
      });
      const decision = resolvedDecision.decision;
      if (decision === 'block') {
        return {
          decision: 'block',
          reason: resolvedDecision.failSafeBlocked
            ? 'Cross-domain navigation blocked because preflight policy check is unavailable.'
            : (serverDecision?.reason || 'Navigation blocked by policy.'),
          decisionReason: resolvedDecision.failSafeBlocked
            ? 'preflight_unavailable_block'
            : (serverDecision?.decisionReason || 'policy_blocked'),
        };
      }
      if (decision === 'open_new_tab') {
        const usedFallback = resolvedDecision.decisionReason === 'preflight_unavailable_fallback' && !serverDecision;
        return {
          decision: 'open_new_tab',
          reason: serverDecision?.reason
            || (usedFallback
              ? 'Preflight is unavailable; using local policy to open in a new tab and preserve runtime continuity.'
              : 'Open in new tab to preserve runtime continuity.'),
          decisionReason: serverDecision?.decisionReason || resolvedDecision.decisionReason || 'open_new_tab',
        };
      }

      // Same-tab navigation handoff path.
      agentNavigationPending = true;
      if (!runtimeState) {
        const usedFallback = resolvedDecision.decisionReason === 'preflight_unavailable_fallback' && !serverDecision;
        return {
          decision: 'allow_same_tab',
          reason: serverDecision?.reason
            || (usedFallback
              ? 'Preflight is unavailable; allowing navigation using local policy.'
              : 'Navigation allowed.'),
          decisionReason: serverDecision?.decisionReason || resolvedDecision.decisionReason || 'allow_same_tab',
        };
      }
      setLatestNavigationHandoff(toPersistedNavigationHandoff(intent));
      const pendingRun = ensureNavigationPendingRun(
        intent.isCrossHost ? 'cross_host_navigation' : 'agent_navigation',
      );
      if (pendingRun) {
        persistRuntimeState();
      }
      // Flush to cloud so cross-domain resume can recover workerState
      cloudCheckpointClient?.markDirty();
      cloudCheckpointClient?.syncNow();
      return {
        decision: 'allow_same_tab',
        reason: serverDecision?.reason
          || (resolvedDecision.decisionReason === 'preflight_unavailable_fallback' && !serverDecision
            ? 'Preflight is unavailable; allowing navigation using local policy.'
            : 'Navigation allowed.'),
        decisionReason: serverDecision?.decisionReason || resolvedDecision.decisionReason || 'allow_same_tab',
      };
    },
    onBeforeCrossHostNavigation: (intent: NavigationIntentEvent) => {
      agentNavigationPending = true;
      if (!runtimeState || !currentConfig) return;
      setLatestNavigationHandoff(toPersistedNavigationHandoff(intent));
      const handoffForCookie = getUnconsumedNavigationHandoff();
      const pendingRun = ensureNavigationPendingRun('cross_host_navigation');
      // Write a cookie scoped to the registrable domain so the new origin can resume
      writeCrossDomainResumeCookie(currentConfig.siteId, {
        sessionId: runtimeState.sessionId,
        sessionToken: runtimeSessionToken,
        sessionTokenExpiresAt: runtimeSessionTokenExpiresAt,
        pendingRun: pendingRun
          ? {
              id: pendingRun.id,
              text: pendingRun.text,
              startedAt: pendingRun.startedAt,
              attempts: pendingRun.attempts,
              taskBoundaryId: pendingRun.taskBoundaryId || currentTaskBoundaryId,
            }
          : undefined,
        handoff: handoffForCookie
          ? {
              handoffId: handoffForCookie.handoffId,
              sourceLogicalTabId: handoffForCookie.sourceLogicalTabId,
              runId: handoffForCookie.runId,
              targetUrl: handoffForCookie.targetUrl,
              createdAt: handoffForCookie.createdAt,
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
      // Flush to cloud so the new origin can recover workerState via cloud checkpoint
      cloudCheckpointClient?.markDirty();
      cloudCheckpointClient?.syncNow();
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
          { logicalTabId: tabId, external: false },
          'target_tab_missing',
        );
      }

      if (targetTab.runtimeId === runtimeId) {
        return bridge!.getPageData(params);
      }

      if (targetTab.external && runtimeCfg.externalNavigationPolicy !== 'allow') {
        return buildInaccessibleTabPageData(targetTab, 'external_domain_inaccessible');
      }

      // Never fall back to local-tab page data for an inaccessible different tab.
      if (!targetTab.runtimeId || !sessionCoordinator.isTabAlive(tabId)) {
        return buildInaccessibleTabPageData(targetTab, 'target_tab_inactive');
      }

      try {
        return await sessionCoordinator.sendCrossTabRpc(targetTab.runtimeId, 'getPageData', params, 15000);
      } catch {
        return buildInaccessibleTabPageData(targetTab, 'cross_tab_rpc_failed');
      }
    },
    executeTool: async (params: any) => {
      const runtimeCfg = currentConfig || cfg;
      const forceLocalExecution = params?.payload?.forceLocal === true;
      const toolName = String(params?.call?.name || '').trim();
      const toolTabId = Number(params?.call?.args?.tab_id);
      const activeTabId = sessionCoordinator?.getActiveLogicalTabId();
      const routeTabId = (Number.isFinite(toolTabId) && toolTabId > 0) ? toolTabId : activeTabId;

      if (isRoverExternalContextToolName(toolName)) {
        return executeRoverExternalContextToolCall({
          call: params?.call,
          routeTabId: Number.isFinite(Number(routeTabId)) ? Number(routeTabId) : undefined,
          runtimeCfg,
        });
      }

      if (forceLocalExecution) {
        return bridge!.executeTool(params.call, params.payload);
      }

      const localTabId = sessionCoordinator?.getLocalLogicalTabId();

      if (!routeTabId || routeTabId === localTabId || !sessionCoordinator) {
        return bridge!.executeTool(params.call, params.payload);
      }

      const tabs = sessionCoordinator.listTabs();
      const targetTab = tabs.find(t => t.logicalTabId === routeTabId);
      if (!targetTab) {
        return buildTabAccessToolError(
          runtimeCfg,
          { logicalTabId: routeTabId, external: false },
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
    listSessionTabs: () => sessionCoordinator?.listTabs({ scope: 'all' }) || [],
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
  worker.postMessage(
    {
      type: 'init',
      config: {
        ...cfg,
        ...buildWorkerBoundaryConfig(),
        publicKey: undefined,
        authToken: getRuntimeSessionToken(cfg),
        sessionToken: runtimeSessionToken,
        sessionId: runtimeState?.sessionId,
        activeRunId: runtimeState?.pendingRun?.id,
      },
      port: channel.port2,
    },
    [channel.port2],
  );

  const cancelCurrentFlow = (reason: 'manual_cancel_task' | 'question_prompt_cancel' = 'manual_cancel_task') => {
    if (!runtimeState) return;
    const pendingRun = runtimeState.pendingRun;
    if (pendingRun) {
      addIgnoredRunId(pendingRun.id);
      worker?.postMessage({ type: 'cancel_run', runId: pendingRun.id });
      roverServerRuntime?.controlRun({
        action: 'cancel',
        runId: pendingRun.id,
        reason,
      }).catch(() => { /* best-effort — local state already cleared */ });
      sessionCoordinator?.releaseWorkflowLock(pendingRun.id);
      sessionCoordinator?.setActiveRun(undefined);
      setPendingRun(undefined);
      runtimeState.workerState = undefined;
      sessionCoordinator?.setWorkerContext(undefined);
      currentTaskBoundaryId = createTaskBoundaryId();
      runtimeState.taskTabScope = undefined;
      ensureTaskTabScopeSeed({ forceReset: true, persist: false });
      postWorkerBoundaryConfig();
      if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
      ui?.setRunning(false);
      ui?.setQuestionPrompt(undefined);
      markTaskCancelled(reason);
      setUiStatus('Task cancelled.');
      appendUiMessage('system', 'Task cancelled.', true);
      lastCompletedTaskInput = undefined;
      lastCompletedTaskSummary = undefined;
      lastCompletedTaskAt = 0;
      appendTimelineEvent({
        kind: 'info',
        title: 'Run cancelled',
        status: 'info',
      });
      persistRuntimeState();
      return;
    }

    const hasPendingQuestions = normalizeAskUserQuestions(runtimeState.workerState?.pendingAskUser?.questions).length > 0;
    const activeStatus = runtimeState.activeTask?.status;
    if (!hasPendingQuestions && activeStatus !== 'running') {
      return;
    }

    currentTaskBoundaryId = createTaskBoundaryId();
    runtimeState.workerState = undefined;
    runtimeState.taskTabScope = undefined;
    ensureTaskTabScopeSeed({ forceReset: true, persist: false });
    postWorkerBoundaryConfig();
    if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
    ui?.setRunning(false);
    ui?.setQuestionPrompt(undefined);
    hideTaskSuggestion();
    setPendingRun(undefined);

    markTaskEnded(reason);
    roverServerRuntime?.controlRun({
      action: 'cancel',
      runId: runtimeState.pendingRun?.id,
      reason,
    }).catch(() => { /* best-effort — local state already cleared */ });
    sessionCoordinator?.endTask(reason);
    sessionCoordinator?.setActiveRun(undefined);
    sessionCoordinator?.setWorkerContext(undefined);
    setUiStatus(reason === 'question_prompt_cancel' ? 'Input request cancelled.' : 'Task cancelled.');
    lastCompletedTaskInput = undefined;
    lastCompletedTaskSummary = undefined;
    lastCompletedTaskAt = 0;
    appendTimelineEvent({
      kind: 'info',
      title: reason === 'question_prompt_cancel' ? 'Input request cancelled' : 'Task cancelled',
      status: 'info',
    });
    persistRuntimeState();
  };

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
      cancelCurrentFlow('manual_cancel_task');
    },
    onCancelQuestionFlow: () => {
      cancelCurrentFlow('question_prompt_cancel');
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
    crossDomainResumeActive = true;
    // Restore session token from cross-domain cookie so the worker can authenticate immediately
    if (crossDomainResume.sessionToken) {
      updateRuntimeSessionToken(crossDomainResume.sessionToken, crossDomainResume.sessionTokenExpiresAt);
    }
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
    const crossDomainTaskStatus = String(crossDomainResume.activeTask?.status || '').trim().toLowerCase();
    const canSeedPendingRun = !crossDomainTaskStatus || crossDomainTaskStatus === 'running';
    if (crossDomainResume.pendingRun && canSeedPendingRun) {
      seeded.pendingRun = sanitizePendingRun({
        ...crossDomainResume.pendingRun,
        autoResume: true,
        taskBoundaryId: crossDomainResume.pendingRun.taskBoundaryId,
        resumeRequired: true,
        resumeReason: 'cross_host_navigation',
      });
    }
    if (crossDomainResume.handoff) {
      seeded.lastNavigationHandoff = sanitizeNavigationHandoff({
        ...crossDomainResume.handoff,
        createdAt: crossDomainResume.handoff.createdAt,
      });
    }
    if (crossDomainResume.activeTask) {
      seeded.activeTask = {
        ...createDefaultTaskState('cross_domain_resume'),
        taskId: crossDomainResume.activeTask.taskId,
        status: crossDomainResume.activeTask.status as 'running' | 'completed' | 'cancelled' | 'failed' | 'ended',
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
  const handoffBootstrap = consumeNavigationHandoffBootstrap(cfg.siteId);

  currentTaskBoundaryId = resolveTaskBoundaryIdFromState(runtimeState);
  if (handoffBootstrap && runtimeState.activeTask?.status === 'running') {
    runtimeState.pendingRun = sanitizePendingRun({
      ...(runtimeState.pendingRun || {}),
      id: runtimeState.pendingRun?.id || handoffBootstrap.runId,
      text: runtimeState.pendingRun?.text || handoffBootstrap.text || lastUserInputText || 'Continue task',
      startedAt: runtimeState.pendingRun?.startedAt || Date.now(),
      attempts: runtimeState.pendingRun?.attempts || 0,
      autoResume: true,
      taskBoundaryId:
        runtimeState.pendingRun?.taskBoundaryId
        || handoffBootstrap.taskBoundaryId
        || currentTaskBoundaryId,
      resumeRequired: true,
      resumeReason:
        handoffBootstrap.resumeReason
        || runtimeState.pendingRun?.resumeReason
        || 'agent_navigation',
    });
  }
  if (runtimeState.pendingRun && !runtimeState.pendingRun.taskBoundaryId) {
    runtimeState.pendingRun = sanitizePendingRun({
      ...runtimeState.pendingRun,
      taskBoundaryId: currentTaskBoundaryId,
    });
  }
  if (runtimeState.workerState && !runtimeState.workerState.taskBoundaryId) {
    runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
      sanitizeWorkerState({
        ...runtimeState.workerState,
        taskBoundaryId: currentTaskBoundaryId,
      }),
      currentTaskBoundaryId,
    );
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
    timing: {
      navigationDelayMs: normalizeTimingNumber(cfg.timing?.navigationDelayMs, 0, 3000),
      actionTimeoutMs: normalizeTimingNumber(cfg.timing?.actionTimeoutMs, 5_000, 120_000),
      domSettleDebounceMs: normalizeTimingNumber(cfg.timing?.domSettleDebounceMs, 8, 500),
      domSettleMaxWaitMs: normalizeTimingNumber(cfg.timing?.domSettleMaxWaitMs, 80, 5000),
      domSettleRetries: normalizeTimingNumber(cfg.timing?.domSettleRetries, 0, 6),
      sparseTreeRetryDelayMs: normalizeTimingNumber(cfg.timing?.sparseTreeRetryDelayMs, 20, 1000),
      sparseTreeRetryMaxAttempts: normalizeTimingNumber(cfg.timing?.sparseTreeRetryMaxAttempts, 0, 4),
    },
    task: {
      singleActiveScope: normalizeTaskSingleActiveScope(cfg.task?.singleActiveScope),
      tabScope: normalizeTaskTabScope(cfg.task?.tabScope),
      resume: {
        mode: normalizeTaskResumeMode(cfg.task?.resume?.mode),
        ttlMs: normalizeTaskResumeTtlMs(cfg.task?.resume?.ttlMs),
      },
      followup: {
        mode: normalizeTaskFollowupMode(cfg.task?.followup?.mode),
        ttlMs: normalizeTaskFollowupTtlMs(cfg.task?.followup?.ttlMs),
        minLexicalOverlap: normalizeTaskFollowupMinLexicalOverlap(cfg.task?.followup?.minLexicalOverlap),
      },
      observerInput: normalizeTaskObserverInput(cfg.task?.observerInput),
      autoResumePolicy: normalizeTaskAutoResumePolicy(cfg.task?.autoResumePolicy),
    },
    chat: {
      inRun: normalizeChatInRun(cfg.chat?.inRun),
      resumeFollowup: {
        mode: normalizeChatResumeMode(cfg.chat?.resumeFollowup?.mode),
        maxTurns: normalizeChatResumeMaxTurns(cfg.chat?.resumeFollowup?.maxTurns),
      },
    },
    external: {
      intentSelection: normalizeExternalIntentSelection(cfg.external?.intentSelection),
      requireUserConfirm: normalizeExternalRequireUserConfirm(cfg.external?.requireUserConfirm),
      adversarialGate: normalizeExternalAdversarialGate(cfg.external?.adversarialGate),
    },
    taskContext: {
      ...cfg.taskContext,
    },
    features: {
      rover_v1_kernel_runtime: normalizeKernelRuntimeFeature(cfg.features?.rover_v1_kernel_runtime),
    },
  };

  runtimeState.sessionId = currentConfig.sessionId!;
  runtimeState.runtimeId = runtimeId;
  runtimeState.executionMode = runtimeState.executionMode || 'controller';
  runtimeState.timeline = sanitizeTimelineEvents(runtimeState.timeline);
  runtimeState.uiMessages = sanitizeUiMessages(runtimeState.uiMessages);
  runtimeState.activeTask = sanitizeTask(runtimeState.activeTask, createDefaultTaskState('boot'));
  if (isTerminalTaskStatus(runtimeState.activeTask?.status)) {
    runtimeState.pendingRun = undefined;
    runtimeState.workerState = undefined;
    crossDomainResumeActive = false;
    clearCrossDomainResumeCookie(cfg.siteId);
    clearNavigationHandoffBootstrap(cfg.siteId);
  }
  runtimeState.taskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
  currentMode = runtimeState.executionMode;
  if (resolvedVisitor) syncVisitorToAllStores(cfg.siteId, resolvedVisitor);
  persistRuntimeState();

  // Mark this tab as alive — sessionStorage survives refresh but is cleared on tab close
  try { sessionStorage.setItem(`rover:tab-alive:${cfg.siteId}`, '1'); } catch { /* ignore */ }

  workerReady = false;
  sessionReady = false;
  autoResumeAttempted = false;

  // Restore session token from sessionStorage (survives same-origin navigation/refresh)
  try {
    const cached = sessionStorage.getItem(`rover:sess:${cfg.siteId}`);
    if (cached) {
      const { t, e } = JSON.parse(cached);
      if (t && typeof t === 'string' && t.startsWith('rvrsess_') && Number(e) > Date.now() + 10_000) {
        updateRuntimeSessionToken(t, Number(e));
      }
    }
  } catch { /* ignore */ }

  createRuntime(currentConfig);
  void ensureRoverServerRuntime(currentConfig);

  // If no server runtime needed (no auth config), or if we already have a valid
  // session token (from sessionStorage/cross-domain cookie), mark session ready
  // immediately. onSession callback will re-confirm when the server responds.
  if (!roverServerRuntime || (runtimeSessionToken && runtimeSessionTokenExpiresAt > Date.now() + 10_000)) {
    sessionReady = true;
  }
  if (runtimeStorageKey) {
    void applyAsyncRuntimeStateHydration(runtimeStorageKey);
  }
  ensureUnloadHandler();

  // Safety timeout: if cross-domain cloud checkpoint never arrives, resume anyway
  if (crossDomainResumeActive) {
    setTimeout(() => {
      if (crossDomainResumeActive && !autoResumeAttempted) {
        crossDomainResumeActive = false;
        maybeAutoResumePendingRun();
      }
    }, 8_000);
  }

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
    timing: {
      ...currentConfig.timing,
      ...cfg.timing,
      navigationDelayMs: normalizeTimingNumber(
        cfg.timing?.navigationDelayMs ?? currentConfig.timing?.navigationDelayMs,
        0,
        3000,
      ),
      actionTimeoutMs: normalizeTimingNumber(
        cfg.timing?.actionTimeoutMs ?? currentConfig.timing?.actionTimeoutMs,
        5_000,
        120_000,
      ),
      domSettleDebounceMs: normalizeTimingNumber(
        cfg.timing?.domSettleDebounceMs ?? currentConfig.timing?.domSettleDebounceMs,
        8,
        500,
      ),
      domSettleMaxWaitMs: normalizeTimingNumber(
        cfg.timing?.domSettleMaxWaitMs ?? currentConfig.timing?.domSettleMaxWaitMs,
        80,
        5000,
      ),
      domSettleRetries: normalizeTimingNumber(
        cfg.timing?.domSettleRetries ?? currentConfig.timing?.domSettleRetries,
        0,
        6,
      ),
      sparseTreeRetryDelayMs: normalizeTimingNumber(
        cfg.timing?.sparseTreeRetryDelayMs ?? currentConfig.timing?.sparseTreeRetryDelayMs,
        20,
        1000,
      ),
      sparseTreeRetryMaxAttempts: normalizeTimingNumber(
        cfg.timing?.sparseTreeRetryMaxAttempts ?? currentConfig.timing?.sparseTreeRetryMaxAttempts,
        0,
        4,
      ),
    },
    task: {
      ...currentConfig.task,
      ...cfg.task,
      singleActiveScope: normalizeTaskSingleActiveScope(cfg.task?.singleActiveScope ?? currentConfig.task?.singleActiveScope),
      tabScope: normalizeTaskTabScope(cfg.task?.tabScope ?? currentConfig.task?.tabScope),
      resume: {
        mode: normalizeTaskResumeMode(cfg.task?.resume?.mode ?? currentConfig.task?.resume?.mode),
        ttlMs: normalizeTaskResumeTtlMs(cfg.task?.resume?.ttlMs ?? currentConfig.task?.resume?.ttlMs),
      },
      followup: {
        mode: normalizeTaskFollowupMode(
          cfg.task?.followup?.mode ?? currentConfig.task?.followup?.mode,
        ),
        ttlMs: normalizeTaskFollowupTtlMs(
          cfg.task?.followup?.ttlMs ?? currentConfig.task?.followup?.ttlMs,
        ),
        minLexicalOverlap: normalizeTaskFollowupMinLexicalOverlap(
          cfg.task?.followup?.minLexicalOverlap ?? currentConfig.task?.followup?.minLexicalOverlap,
        ),
      },
      observerInput: normalizeTaskObserverInput(cfg.task?.observerInput ?? currentConfig.task?.observerInput),
      autoResumePolicy: normalizeTaskAutoResumePolicy(cfg.task?.autoResumePolicy ?? currentConfig.task?.autoResumePolicy),
    },
    chat: {
      ...currentConfig.chat,
      ...cfg.chat,
      inRun: normalizeChatInRun(cfg.chat?.inRun ?? currentConfig.chat?.inRun),
      resumeFollowup: {
        mode: normalizeChatResumeMode(
          cfg.chat?.resumeFollowup?.mode ?? currentConfig.chat?.resumeFollowup?.mode,
        ),
        maxTurns: normalizeChatResumeMaxTurns(
          cfg.chat?.resumeFollowup?.maxTurns ?? currentConfig.chat?.resumeFollowup?.maxTurns,
        ),
      },
    },
    external: {
      ...currentConfig.external,
      ...cfg.external,
      intentSelection: normalizeExternalIntentSelection(
        cfg.external?.intentSelection ?? currentConfig.external?.intentSelection,
      ),
      requireUserConfirm: normalizeExternalRequireUserConfirm(
        cfg.external?.requireUserConfirm ?? currentConfig.external?.requireUserConfirm,
      ),
      adversarialGate: normalizeExternalAdversarialGate(
        cfg.external?.adversarialGate ?? currentConfig.external?.adversarialGate,
      ),
    },
    taskContext: {
      ...currentConfig.taskContext,
      ...cfg.taskContext,
    },
    features: {
      ...currentConfig.features,
      ...cfg.features,
      rover_v1_kernel_runtime: normalizeKernelRuntimeFeature(
        cfg.features?.rover_v1_kernel_runtime ?? currentConfig.features?.rover_v1_kernel_runtime,
      ),
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
  void ensureRoverServerRuntime(currentConfig);

  const shouldReloadRemoteSiteConfig =
    cfg.apiBase !== undefined
    || cfg.publicKey !== undefined
    || cfg.authToken !== undefined
    || cfg.sessionToken !== undefined
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

  worker.postMessage({
    type: 'update_config',
    config: {
      ...cfg,
      ...buildWorkerBoundaryConfig(),
      publicKey: undefined,
      authToken: getRuntimeSessionToken(currentConfig),
      sessionToken: runtimeSessionToken,
      sessionId: runtimeState?.sessionId,
      activeRunId: runtimeState?.pendingRun?.id,
      sessionEpoch: roverServerRuntime?.getEpoch?.() ?? runtimeServerEpoch,
      sessionSeq: roverServerRuntime?.getLastSeq?.() ?? 0,
    },
  });

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
  roverServerRuntime?.stop();
  roverServerRuntime = null;
  runtimeSessionToken = undefined;
  runtimeSessionTokenExpiresAt = 0;
  runtimeServerEpoch = 1;
  setServerAcceptedRunId(undefined);
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
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }
  agentNavigationPending = false;
  currentTaskBoundaryId = '';
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
  lastCompletedTaskInput = undefined;
  lastCompletedTaskSummary = undefined;
  lastCompletedTaskAt = 0;

  // Cancel any running task in the worker
  if (runtimeState.pendingRun) {
    addIgnoredRunId(runtimeState.pendingRun.id);
    worker?.postMessage({ type: 'cancel_run', runId: runtimeState.pendingRun.id });
    void roverServerRuntime?.controlRun({
      action: 'cancel',
      runId: runtimeState.pendingRun.id,
      reason,
    });
    sessionCoordinator?.releaseWorkflowLock(runtimeState.pendingRun.id);
  }
  if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
  ui?.setRunning(false);
  ui?.setQuestionPrompt(undefined);

  autoResumeAttempted = false;
  clearResumeArtifacts();
  const nextTask = applyTaskKernelCommand(
    {
      type: 'new_task',
      reason,
      at: Date.now(),
    },
    { syncShared: false, persist: false },
  );
  if (!nextTask) return;
  const taskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);

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
  ensureTaskTabScopeSeed({ forceReset: true, persist: false });
  sessionCoordinator?.setActiveRun(undefined);
  sessionCoordinator?.setWorkerContext(undefined);
  setUiStatus('New task started.');
  persistRuntimeState();

  worker?.postMessage({
    type: 'start_new_task',
    taskId: nextTask.taskId,
    ...buildWorkerBoundaryConfig(),
  });
  void roverServerRuntime?.controlRun({ action: 'new_task', reason });
  emit('task_started', {
    taskId: nextTask.taskId,
    reason,
    taskEpoch,
  });
}

export function endTask(options?: { reason?: string }): void {
  if (!runtimeState) return;
  const reason = options?.reason || 'manual_end_task';
  lastCompletedTaskInput = undefined;
  lastCompletedTaskSummary = undefined;
  lastCompletedTaskAt = 0;
  const pendingRunId = runtimeState.pendingRun?.id;
  const task = applyTaskKernelCommand(
    {
      type: 'terminal',
      terminal: 'ended',
      reason,
      at: Date.now(),
    },
    { syncShared: false, persist: false, rotateBoundary: false },
  );
  if (!task) return;

  if (pendingRunId) {
    addIgnoredRunId(pendingRunId);
    worker?.postMessage({ type: 'cancel_run', runId: pendingRunId });
    void roverServerRuntime?.controlRun({
      action: 'cancel',
      runId: pendingRunId,
      reason,
    });
    sessionCoordinator?.releaseWorkflowLock(pendingRunId);
  }
  setPendingRun(undefined);
  currentTaskBoundaryId = createTaskBoundaryId();
  runtimeState.workerState = undefined;
  runtimeState.taskTabScope = undefined;
  ensureTaskTabScopeSeed({ forceReset: true, persist: false });
  postWorkerBoundaryConfig();
  if (runSafetyTimer) { clearTimeout(runSafetyTimer); runSafetyTimer = null; }
  ui?.setRunning(false);
  ui?.setQuestionPrompt(undefined);
  hideTaskSuggestion();
  setUiStatus('Task ended. Start a new task to continue.');
  void roverServerRuntime?.controlRun({
    action: 'end_task',
    runId: pendingRunId,
    reason,
  });
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
      const dataPublicKey = scriptEl.getAttribute('data-public-key');

      if (dataSiteId && dataPublicKey) {
        const dataConfig: RoverInit = {
          siteId: dataSiteId,
          publicKey: dataPublicKey,
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
