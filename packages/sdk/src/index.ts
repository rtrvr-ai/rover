import { Bridge, bindRpc, type NavigationIntentEvent } from '@rover/bridge';
import { sanitizeRoverPageCaptureConfig } from '@rover/shared/lib/page/index.js';
import type { PageConfig, RoverPageCaptureConfig, ToolOutput } from '@rover/shared/lib/types/index.js';
import {
  mountWidget,
  type ConversationListItem,
  type RoverAskUserAnswerMeta,
  type RoverAskUserQuestion,
  type RoverExecutionMode,
  type RoverMessageBlock,
  type RoverShortcut,
  type RoverTimelineEvent,
  type RoverUi,
  type RoverVoiceConfig,
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
  parseDeepLinkRequest,
  resolveDeepLinkConfig,
  stripDeepLinkParams,
  type ResolvedDeepLinkConfig,
  type RoverDeepLinkRequest,
} from './deepLink.js';
import {
  parseLaunchRequest,
  stripLaunchParams,
  type RoverLaunchRequest,
} from './launchParams.js';
import {
  parseBrowserReceiptRequest,
  stripBrowserReceiptParams,
  type RoverBrowserReceiptRequest,
} from './receiptLink.js';
import {
  RoverCloudCheckpointClient,
  type RoverCloudCheckpointPayload,
  type RoverCloudCheckpointState,
} from './cloudCheckpoint.js';
import { createRuntimeStateStore, type RuntimeStateStore } from './runtimeStorage.js';
import {
  buildPublicRunLifecyclePayload as buildPublicRunLifecyclePayloadHelper,
  buildPublicRunStartedPayload as buildPublicRunStartedPayloadHelper,
  normalizePromptContextEntry as normalizePromptContextEntryHelper,
} from './publicRunEvents.js';
import {
  writeCrossDomainResumeCookie,
  readCrossDomainResumeCookie,
  clearCrossDomainResumeCookie,
  matchesResumeTargetUrl,
  type CrossDomainResumeData,
} from './crossDomainResume.js';
import type {
  PersistedChatLogEntry,
  PersistedPendingRun,
  PersistedNavigationHandoff,
  PersistedRuntimeState,
  PersistedTaskState,
  PersistedTaskTabScope,
  PersistedTimelineEvent,
  PersistedTransientStatus,
  PersistedUiMessage,
  PersistedWorkerState,
  TaskState,
  TaskRecord,
  UiRole,
} from './runtimeTypes.js';
import {
  canAutoResumePendingRun,
  resolveAutoResumePolicyAction,
  shouldAdoptProjectionRun,
  shouldAdoptSnapshotActiveRun,
  shouldClearPendingFromSharedState,
  shouldIgnoreRunScopedMessage,
  shouldQueueCancelForIgnoredProjectionRun,
} from './taskLifecycleGuards.js';
import {
  normalizeTaskBoundaryId,
  shouldAcceptWorkerSnapshot,
  type WorkerBoundarySource,
} from './taskBoundaryGuards.js';
import {
  reduceTaskState,
  isTerminalState,
  statusFromState,
  stateFromLegacyStatus,
  applyTaskEvent,
  createTaskRecord,
  type TaskEvent,
  type TaskTransitionResult,
  type TaskSideEffect,
} from './taskStateMachine.js';
// Backward-compat shim for isTerminalTaskStatus (used throughout index.ts)
import {
  isTerminalTaskStatus,
  reduceTaskKernel,
  type TaskKernelCommand,
} from './taskKernel.js';
import {
  RoverServerRuntimeClient,
  resolveRoverBase,
  resolveRoverBases,
  type TabEventDecisionResponse,
  type RoverLaunchAttachResponse,
  type RoverPublicTaskPayload,
  type RoverTaskBrowserClaimResponse,
  type RoverLaunchIngestEvent,
  type RoverServerProjection,
  type RoverServerPolicy,
  type RoverServerAiAccessConfig,
  type RoverServerSiteConfig,
} from './serverRuntime.js';
import {
  describeCheckpointContinuity,
  shouldAdoptCheckpointState,
} from './checkpointAdoptionGuards.js';
import {
  findMatchingTaskRecord,
  resolveRenderableStatusRunId,
  shouldPreserveWidgetOpenOnResume,
} from './continuityAdoption.js';
import { TaskOrchestrator, type TaskOrchestratorOptions } from './taskOrchestrator.js';
import { WorkerPool, type WorkerConfig } from './workerPool.js';
import { shouldBlockNavigation, computeAdversarialScore } from './adversarialGuard.js';
import { applyFaviconBadge, removeFaviconBadge } from './faviconBadge.js';
import { resolveNavigationDecision } from './navigationPreflightPolicy.js';
import { resolveNavigationMessageContext } from './navigationMessageContext.js';
import {
  deriveRegistrableDomain,
  isHostInNavigationScope,
} from './navigationScope.js';
import {
  ROVER_V2_PERSIST_CAPS,
  ROVER_V2_TRANSPORT_DEFAULTS,
} from '@rover/shared';
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

export type RoverDeepLinkConfig = {
  enabled?: boolean;
  promptParam?: string;
  shortcutParam?: string;
  consume?: boolean;
};

type RoverAiAccessConfig = {
  enabled?: boolean;
  allowPromptLaunch?: boolean;
  allowShortcutLaunch?: boolean;
  allowCloudBrowser?: boolean;
  allowDelegatedHandoffs?: boolean;
  debugStreaming?: boolean;
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
  deepLink?: RoverDeepLinkConfig;
  allowActions?: boolean;
  pageConfig?: RoverPageCaptureConfig;
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
  transport?: {
    activation?: 'on_demand';
    idleCloseMs?: number;
  };
  stability?: {
    maxPersistBytes?: number;
    maxSnapshotBytes?: number;
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
    /** Maximum concurrent Web Workers. Default: 2, max: 3 */
    maxConcurrentWorkers?: number;
    /** Maximum queued tasks waiting for a worker. Default: 5 */
    maxQueuedTasks?: number;
    /** Maximum archived (terminal) tasks to keep. Default: 10 */
    maxArchivedTasks?: number;
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
    rover_v2_kernel_runtime?: boolean;
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
    voice?: RoverVoiceConfig;
    /** Tab highlighting indicators when Rover is active. */
    tabIndicator?: {
      /** Prepend "[Rover] " to document.title during task execution. Default: true */
      titlePrefix?: boolean;
      /** Overlay a colored dot on the favicon. Default: false (opt-in due to CORS). */
      faviconBadge?: boolean;
      /** Show in-widget tab bar of agent-controlled tabs. Default: true */
      widgetTabBar?: boolean;
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
  | 'run_started'
  | 'run_state_transition'
  | 'run_completed'
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
  | 'checkpoint_token_missing'
  | 'open'
  | 'close';

export type RoverEventHandler = (payload?: any) => void;

export type RoverPromptContextEntry = {
  role?: 'model';
  message: string;
  source?: string;
};

export type RoverPromptContextInput = {
  userText: string;
  isFreshTask: boolean;
  pageUrl: string;
  taskId?: string;
  taskBoundaryId?: string;
  visitorId?: string;
  visitor?: { name?: string; email?: string };
};

export type RoverPromptContextProvider = (
  input: RoverPromptContextInput,
) =>
  | string
  | RoverPromptContextEntry
  | Array<string | RoverPromptContextEntry>
  | null
  | undefined
  | Promise<string | RoverPromptContextEntry | Array<string | RoverPromptContextEntry> | null | undefined>;

type RoverVoiceTelemetryEventName =
  | 'voice_started'
  | 'voice_stopped'
  | 'voice_transcript_ready'
  | 'voice_error'
  | 'voice_permission_denied'
  | 'voice_provider_selected';

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
  requestSigned: (input: string | URL, init?: RequestInit) => Promise<Response>;
  registerPromptContextProvider: (provider: RoverPromptContextProvider) => () => void;
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

const RUNTIME_STATE_VERSION = 2;
const RUNTIME_STATE_PREFIX = 'rover:runtime:';
const RUNTIME_ID_PREFIX = 'rover:runtime-id:';
const VISITOR_ID_PREFIX = 'rover:visitor-id:';
const MAX_UI_MESSAGES = ROVER_V2_PERSIST_CAPS.uiMessages;
const MAX_TIMELINE_EVENTS = ROVER_V2_PERSIST_CAPS.timelineEvents;
const MAX_WORKER_HISTORY = ROVER_V2_PERSIST_CAPS.uiMessages;
const MAX_SEED_CHATLOG_ENTRIES = 4;
const MAX_WORKER_PLANNER_STEPS = ROVER_V2_PERSIST_CAPS.plannerHistory;
const MAX_WORKER_AGENT_PREV_STEPS = ROVER_V2_PERSIST_CAPS.prevSteps;
const MAX_TEXT_LEN = 8_000;
const MAX_AUTO_RESUME_ATTEMPTS = 12;
const DEFAULT_CRASH_RESUME_TTL_MS = 15 * 60_000;
const DEFAULT_CHAT_RESUME_MAX_TURNS = 2;
const DEFAULT_FOLLOWUP_TTL_MS = 120_000;
const DEFAULT_FOLLOWUP_MIN_LEXICAL_OVERLAP = 0.18;
const MAX_AUTO_RESUME_SESSION_WAIT_ATTEMPTS = 30;
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
const VOICE_LANGUAGE_MAX_CHARS = 48;
const VOICE_AUTO_STOP_DEFAULT_MS = 2600;
const VOICE_AUTO_STOP_MIN_MS = 800;
const VOICE_AUTO_STOP_MAX_MS = 5000;
const NAV_HANDOFF_BOOTSTRAP_PREFIX = 'rover:handoff-bootstrap:';
const NAV_HANDOFF_BOOTSTRAP_TTL_MS = 30_000;
const PRESERVED_WIDGET_OPEN_GUARD_TTL_MS = 120_000;
const CROSS_DOMAIN_PULL_FIRST_TIMEOUT_MS = 2_500;
const TASK_SCOPE_DETACHED_EXTERNAL_MAX_AGE_MS = 2 * 60_000;
const TASK_SCOPE_NAV_HANDOFF_MAX_AGE_MS = 45_000;
const TASK_SCOPE_PENDING_ATTACH_MAX_AGE_MS = 20_000;
const SERVER_CANCEL_REPAIR_BASE_DELAY_MS = 400;
const SERVER_CANCEL_REPAIR_MAX_DELAY_MS = 15_000;
const SERVER_CANCEL_REPAIR_MAX_ATTEMPTS = 7;
const SERVER_CANCEL_REPAIR_MAX_QUEUE = 80;
const DEEP_LINK_SHORTCUT_WAIT_MS = 2_500;
const DEEP_LINK_SHORTCUT_RETRY_MS = 250;
const LAUNCH_ATTACH_WAIT_MS = 10_000;
const LAUNCH_ATTACH_RETRY_MS = 400;
const LAUNCH_EVENT_MAX_BATCH_SIZE = 40;
const LAUNCH_EVENT_RETRY_DELAY_MS = 1_000;
const RECEIPT_CLAIM_RETRY_MS = 350;
const RECEIPT_CLAIM_WAIT_MS = 10_000;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const HANDOFF_TOOL_POLL_SLICE_SECONDS = 20;

type TelemetryEventName = RoverEventName | RoverVoiceTelemetryEventName;

type TelemetryEventRecord = {
  name: TelemetryEventName;
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
let runtimeStorageLegacyKey: string | null = null;
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
let telemetryLastStatusAt = 0;
let telemetryLastCheckpointStateAt = 0;
let telemetryLastFlushAt = 0;
let telemetryFlushPending = false;
let telemetryFastLaneTimer: ReturnType<typeof setTimeout> | null = null;
const TELEMETRY_STATUS_MIN_INTERVAL_MS = 1_500;
const TELEMETRY_CHECKPOINT_STATE_MIN_INTERVAL_MS = 5_000;
const TELEMETRY_MIN_FLUSH_COOLDOWN_MS = 10_000;
const TELEMETRY_FAST_LANE_MAX_DELAY_MS = 1_200;
const TELEMETRY_FAST_LANE_EVENTS = new Set<TelemetryEventName>([
  'error',
  'navigation_guardrail',
  'checkpoint_error',
  'tab_event_conflict_exhausted',
  'voice_error',
  'voice_permission_denied',
]);
const TELEMETRY_BACKGROUND_ALLOWED_EVENTS = new Set<TelemetryEventName>([
  'ready',
  'error',
  'auth_required',
  'navigation_guardrail',
  'checkpoint_error',
  'tab_event_conflict_exhausted',
  'voice_error',
  'voice_permission_denied',
]);
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
let backendSiteConfig: RoverResolvedSiteConfig | null = null;
let lastEffectivePageCaptureConfigJson = '';
let suppressCheckpointSync = false;
let lastQuestionPromptFlushSignature = '';
let currentMode: RoverExecutionMode = 'controller';
let workerReady = false;
let sessionReady = false;
let isTransportController = true; // default to true for single-tab mode
let autoResumeAttempted = false;
let crossDomainResumeActive = false;
let resumeContextValidated = false;
let agentNavigationPending = false;
const crossOriginNavTimestamps: number[] = [];
const CROSS_ORIGIN_NAV_MAX = 3;
const CROSS_ORIGIN_NAV_WINDOW_MS = 10_000;
let currentTaskBoundaryId = '';
let runSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let autoResumeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let autoResumeSessionWaitAttempts = 0;
let serverCancelRepairTimer: ReturnType<typeof setTimeout> | null = null;
let serverCancelRepairInFlight = false;
let unloadHandlerInstalled = false;
let visibilitySyncInstalled = false;
let _booted = false;
const _registeredListeners: Array<{ target: EventTarget; event: string; handler: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }> = [];
let _origPushState: typeof History.prototype.pushState | null = null;
let _origReplaceState: typeof History.prototype.replaceState | null = null;
let deepLinkLastHandledKey = '';
let deepLinkLastIgnoredDisabledKey = '';
let deepLinkShortcutRetryTimer: ReturnType<typeof setTimeout> | null = null;
let deepLinkPendingShortcut:
  | {
      handleKey: string;
      request: RoverDeepLinkRequest & { kind: 'shortcut' };
      deadlineAt: number;
    }
  | null = null;
let launchLastHandledKey = '';
let launchLastIgnoredDisabledKey = '';
let launchAttachRetryTimer: ReturnType<typeof setTimeout> | null = null;
let launchAttachInFlightKey = '';
let pendingLaunchRequest:
  | {
      handleKey: string;
      request: RoverLaunchRequest;
      deadlineAt: number;
    }
  | null = null;
type ActiveLaunchBinding = {
  requestId: string;
  attachToken?: string;
  handleKey: string;
  status?: string;
  detail?: 'sanitized' | 'full' | 'debug';
  executionTarget?: 'browser_attach' | 'cloud_browser';
  runId?: string;
  ingestInFlight?: boolean;
  pendingEvents: RoverLaunchIngestEvent[];
  lastNeedsInputSignature?: string;
  finalObservationRunId?: string;
  attachCompletedAt?: number;
};
let activeLaunchBinding: ActiveLaunchBinding | null = null;
let launchEventFlushTimer: ReturnType<typeof setTimeout> | null = null;

function addTrackedListener(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  target.addEventListener(event, handler, options);
  _registeredListeners.push({ target, event, handler, options });
  // Periodically prune listeners on disconnected DOM nodes to prevent retention
  if (_registeredListeners.length > 100 && _registeredListeners.length % 50 === 0) {
    pruneDisconnectedListeners();
  }
}

function pruneDisconnectedListeners(): void {
  for (let i = _registeredListeners.length - 1; i >= 0; i--) {
    const entry = _registeredListeners[i];
    const target = entry.target;
    if (target && 'isConnected' in target && (target as Node).isConnected === false) {
      try { entry.target.removeEventListener(entry.event, entry.handler, entry.options); } catch {}
      _registeredListeners.splice(i, 1);
    }
  }
}

let lastObserverPauseApplied: boolean | null = null;
let transportIdleDeadline = 0;
type PendingTaskSuggestion =
  | { kind: 'task_reset'; text: string; reason: string; createdAt: number }
  | { kind: 'resume_run'; runId: string; text: string; createdAt: number };
let pendingTaskSuggestion: PendingTaskSuggestion | null = null;
type PreservedWidgetOpenGuard = {
  runId?: string;
  taskId?: string;
  expiresAt: number;
};
let preservedWidgetOpenGuard: PreservedWidgetOpenGuard | undefined;
let lastStatusSignature = '';
let lastUserInputText: string | undefined;
let originalDocumentTitle: string | undefined;
let titlePrefixActive = false;
let titleObserver: MutationObserver | null = null;
let lastCompletedTaskInput: string | undefined;
let lastCompletedTaskSummary: string | undefined;
let lastCompletedTaskAt = 0;
const MAX_ASSISTANT_BY_RUN_ENTRIES = 50;
const MAX_IGNORED_RUN_ENTRIES = 100;
const MAX_EXTERNAL_CONTEXT_CACHE_ENTRIES = 20;
const EXTERNAL_CONTEXT_CACHE_MAX_TTL = 300_000; // 5 minutes

function evictOldestMapEntry<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function evictOldestSetEntry(set: Set<string>, maxSize: number): void {
  const iter = set.values();
  while (set.size > maxSize) {
    const oldest = iter.next();
    if (oldest.done) break;
    set.delete(oldest.value);
  }
}

const latestAssistantByRunId = new Map<string, string>();
const ignoredRunIds = new Set<string>();
let roverServerRuntime: RoverServerRuntimeClient | null = null;
let runtimeSessionToken: string | undefined;
let runtimeSessionTokenExpiresAt = 0;
let runtimeServerEpoch = 1;
let serverAcceptedRunId: string | undefined;
let lastAppliedServerSnapshotKey = '';
let taskOrchestrator: TaskOrchestrator | null = null;
type ActivePublicTaskContext = {
  taskId: string;
  taskUrl: string;
  taskAccessToken?: string;
  workflowId?: string;
  workflowUrl?: string;
  workflowAccessToken?: string;
  taskBoundaryId?: string;
  runId?: string;
  updatedAt: number;
};
let activePublicTaskContext: ActivePublicTaskContext | null = null;
type RoverRuntimeAgentAttribution = {
  agentKey: string;
  agentName?: string;
  agentVendor?: string;
  agentModel?: string;
  agentTrust?: 'verified' | 'self_reported' | 'heuristic' | 'anonymous';
  agentSource?:
    | 'public_task_agent'
    | 'handoff_agent'
    | 'webmcp_agent'
    | 'signature_agent'
    | 'user_agent'
    | 'owner_resolver'
    | 'anonymous';
  agentMemoryKey?: string;
  launchSource?: 'public_task_api' | 'delegated_handoff' | 'webmcp' | 'embedded_widget';
};
const promptContextProviders = new Set<RoverPromptContextProvider>();
let browserReceiptLastHandledKey = '';
let browserReceiptClaimInFlightKey = '';
let browserReceiptRetryTimer: ReturnType<typeof setTimeout> | null = null;
let browserReceiptPending:
  | {
      handleKey: string;
      deadlineAt: number;
    }
  | null = null;
type HandoffToolArgs = {
  url?: string;
  instruction?: string;
  prompt?: string;
  shortcutId?: string;
  contextSummary?: string;
  expectedOutput?: string;
  execution?: 'auto' | 'browser' | 'cloud';
  task?: string;
  answer?: string;
};
let builtInToolsRegistered = false;
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
  openIntent?: 'preserve_if_running';
  ts: number;
};

type PendingServerRunCancelRepair = {
  runId: string;
  reason: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
};

const pendingServerRunCancelRepairs = new Map<string, PendingServerRunCancelRepair>();

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

function normalizePromptContextEntry(
  input: string | RoverPromptContextEntry,
): FollowupChatEntry | null {
  return normalizePromptContextEntryHelper(input);
}

async function resolvePromptContextEntries(
  input: RoverPromptContextInput,
): Promise<FollowupChatEntry[]> {
  if (promptContextProviders.size === 0) return [];
  const entries: FollowupChatEntry[] = [];
  for (const provider of promptContextProviders) {
    try {
      const raw = await provider(input);
      const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      for (const item of list) {
        const normalized = normalizePromptContextEntry(item);
        if (normalized) entries.push(normalized);
      }
    } catch {
      // Best-effort only; prompt context must not block task execution.
    }
  }
  return sanitizeChatLogEntries(entries);
}

function buildPublicRunStartedPayload(msg: any): Record<string, unknown> {
  return buildPublicRunStartedPayloadHelper({
    msg,
    taskId: String(runtimeState?.activeTask?.taskId || getActiveTaskRecord()?.taskId || '').trim() || undefined,
    currentTaskBoundaryId: runtimeState?.pendingRun?.taskBoundaryId || currentTaskBoundaryId,
    normalizeTaskBoundaryId: value => normalizeTaskBoundaryId(typeof value === 'string' ? value : undefined),
    pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    now: Date.now(),
  });
}

function buildPublicRunLifecyclePayload(
  msg: any,
  completionState: ReturnType<typeof normalizeRunCompletionState>,
): Record<string, unknown> {
  const runId =
    typeof msg?.runId === 'string' && msg.runId.trim()
      ? msg.runId.trim()
      : String(runtimeState?.pendingRun?.id || '').trim() || undefined;
  return buildPublicRunLifecyclePayloadHelper({
    msg: runId ? { ...msg, runId } : msg,
    taskId: String(runtimeState?.activeTask?.taskId || getActiveTaskRecord()?.taskId || '').trim() || undefined,
    currentTaskBoundaryId: runtimeState?.pendingRun?.taskBoundaryId || currentTaskBoundaryId,
    normalizeTaskBoundaryId: value => normalizeTaskBoundaryId(typeof value === 'string' ? value : undefined),
    completionState,
    latestSummary: runId ? latestAssistantByRunId.get(runId) : undefined,
    pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    now: Date.now(),
  });
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

function isNavigationResumeReason(reason: PersistedPendingRun['resumeReason'] | undefined): boolean {
  return reason === 'agent_navigation'
    || reason === 'cross_host_navigation'
    || reason === 'handoff'
    || reason === 'worker_interrupted'
    || reason === 'page_reload';
}

function canValidateResumeFromPersistedHandoff(pending: PersistedPendingRun): boolean {
  if (!runtimeState || !isNavigationResumeReason(pending.resumeReason)) return false;
  const handoff = sanitizeNavigationHandoff(runtimeState.lastNavigationHandoff);
  if (!handoff?.targetUrl) return false;
  const ageMs = Date.now() - Number(handoff.createdAt || 0);
  if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > 120_000) return false;
  return matchesResumeTargetUrl(handoff.targetUrl, window.location.href);
}

function shouldDelayResumeForPendingNavigation(pending: PersistedPendingRun): boolean {
  if (!agentNavigationPending || !isNavigationResumeReason(pending.resumeReason)) return false;
  const handoff = sanitizeNavigationHandoff(runtimeState?.lastNavigationHandoff);
  if (!handoff) return false;
  const ageMs = Date.now() - Number(handoff.createdAt || 0);
  return Number.isFinite(ageMs) && ageMs >= -5_000 && ageMs <= NAV_HANDOFF_BOOTSTRAP_TTL_MS;
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

function getRuntimeStateLegacyKey(siteId: string): string {
  return `${RUNTIME_STATE_PREFIX}${siteId}`;
}

function getRuntimeStateKey(siteId: string, sessionId?: string): string {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return getRuntimeStateLegacyKey(siteId);
  return `${RUNTIME_STATE_PREFIX}${siteId}:${stableHash(normalizedSessionId)}`;
}

function getRuntimeStateKeyHintStorageKey(siteId: string): string {
  return `${RUNTIME_STATE_PREFIX}${siteId}:latest_key`;
}

function readRuntimeStateKeyHint(siteId: string): string | undefined {
  try {
    const raw = String(sessionStorage.getItem(getRuntimeStateKeyHintStorageKey(siteId)) || '').trim();
    if (!raw || !raw.startsWith(RUNTIME_STATE_PREFIX)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

function writeRuntimeStateKeyHint(siteId: string, key?: string): void {
  if (!siteId) return;
  try {
    if (!key) {
      sessionStorage.removeItem(getRuntimeStateKeyHintStorageKey(siteId));
      return;
    }
    sessionStorage.setItem(getRuntimeStateKeyHintStorageKey(siteId), key);
  } catch {
    // ignore
  }
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
      openIntent: parsed.openIntent === 'preserve_if_running' ? 'preserve_if_running' : undefined,
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

function setPreservedWidgetOpenGuard(params?: { runId?: string; taskId?: string; ttlMs?: number }): void {
  const runId = typeof params?.runId === 'string' && params.runId.trim() ? params.runId.trim() : undefined;
  const taskId = typeof params?.taskId === 'string' && params.taskId.trim() ? params.taskId.trim() : undefined;
  if (!runId && !taskId) {
    preservedWidgetOpenGuard = undefined;
    return;
  }
  preservedWidgetOpenGuard = {
    runId,
    taskId,
    expiresAt: Date.now() + Math.max(1_000, Number(params?.ttlMs) || PRESERVED_WIDGET_OPEN_GUARD_TTL_MS),
  };
}

function clearPreservedWidgetOpenGuard(): void {
  preservedWidgetOpenGuard = undefined;
}

function shouldPreserveWidgetOpenForState(state: {
  pendingRun?: { id?: string } | undefined;
  activeTask?: { taskId?: string; status?: string } | undefined;
} | null | undefined): boolean {
  const guard = preservedWidgetOpenGuard;
  if (!guard) return false;
  if (guard.expiresAt <= Date.now()) {
    preservedWidgetOpenGuard = undefined;
    return false;
  }

  const taskStatus = String(state?.activeTask?.status || '').trim();
  if (taskStatus && taskStatus !== 'running') {
    preservedWidgetOpenGuard = undefined;
    return false;
  }

  const guardRunId = String(guard.runId || '').trim();
  const guardTaskId = String(guard.taskId || '').trim();
  const stateRunId = String(state?.pendingRun?.id || '').trim();
  const stateTaskId = String(state?.activeTask?.taskId || '').trim();

  if (guardRunId && stateRunId && guardRunId !== stateRunId) {
    if (!guardTaskId || !stateTaskId || guardTaskId !== stateTaskId) {
      return false;
    }
  }
  if (guardTaskId && stateTaskId && guardTaskId !== stateTaskId) {
    return false;
  }
  return true;
}

function applyPreservedWidgetOpenState(state: PersistedRuntimeState | null | undefined): void {
  if (!state) return;
  if (!shouldPreserveWidgetOpenForState(state)) return;
  state.uiHidden = false;
  state.uiOpen = true;
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
    transientStatus: undefined,
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
    // v2 multi-task fields
    tasks: {},
    activeTaskId: undefined,
    taskOrder: [],
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

function normalizeDomainScopeMode(
  mode?: 'host_only' | 'registrable_domain',
): 'host_only' | 'registrable_domain' {
  return mode === 'host_only' ? 'host_only' : 'registrable_domain';
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

function normalizeTransportActivation(_value?: 'on_demand'): 'on_demand' {
  return 'on_demand';
}

function normalizeTransportIdleCloseMs(value?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return ROVER_V2_TRANSPORT_DEFAULTS.idleCloseMs;
  return Math.max(5_000, Math.min(120_000, Math.floor(parsed)));
}

function normalizeStabilityByteLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(32_768, Math.min(2_097_152, Math.floor(parsed)));
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
  if (telemetryFastLaneTimer) {
    clearTimeout(telemetryFastLaneTimer);
    telemetryFastLaneTimer = null;
  }
  telemetryFlushPending = false;
}

function getTelemetryEndpoint(cfg: RoverInit): string {
  return `${resolveRoverBase(cfg.apiBase)}/telemetry/ingest`;
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
  // Reduced headroom from 10s to 2s — token has 10min TTL so 2s is sufficient
  if (runtimeSessionToken && runtimeSessionTokenExpiresAt > Date.now() + 2_000) {
    return runtimeSessionToken;
  }
  // Fallback: re-read from sessionStorage (may have been updated by onSession callback)
  try {
    const siteId = currentConfig?.siteId || cfg?.siteId || '';
    if (siteId) {
      const cached = sessionStorage.getItem(`rover:sess:${siteId}`);
      if (cached) {
        const { t, e } = JSON.parse(cached);
        if (t && typeof t === 'string' && t.startsWith('rvrsess_') && Number(e) > Date.now() + 2_000) {
          // Restore in-memory token from sessionStorage
          runtimeSessionToken = t;
          runtimeSessionTokenExpiresAt = Number(e);
          return t;
        }
      }
    }
  } catch { /* ignore */ }
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

function decodeBase64UrlUtf8(input: string): string {
  try {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    if (typeof atob === 'function') {
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {
    // fall through
  }
  return '';
}

function readRuntimeAgentAttribution(token?: string): RoverRuntimeAgentAttribution | null {
  const raw = String(token || '').trim();
  if (!raw.startsWith('rvrsess_')) return null;
  const packed = raw.slice('rvrsess_'.length);
  const dotIndex = packed.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const payloadRaw = decodeBase64UrlUtf8(packed.slice(0, dotIndex));
  if (!payloadRaw) return null;
  try {
    const claims = JSON.parse(payloadRaw) as Record<string, unknown>;
    const agentKey = String(claims.agentKey || '').trim();
    const agentName = String(claims.agentName || '').trim() || undefined;
    const agentVendor = String(claims.agentVendor || '').trim() || undefined;
    const agentModel = String(claims.agentModel || '').trim() || undefined;
    const agentTrust = String(claims.agentTrust || '').trim() as RoverRuntimeAgentAttribution['agentTrust'];
    const agentSource = String(claims.agentSource || '').trim() as RoverRuntimeAgentAttribution['agentSource'];
    const agentMemoryKey = String(claims.agentMemoryKey || '').trim() || undefined;
    const launchSource = String(claims.launchSource || '').trim() as RoverRuntimeAgentAttribution['launchSource'];
    if (!agentKey && !agentName && !agentVendor && !agentModel) return null;
    return {
      agentKey: agentKey || agentMemoryKey || agentVendor || agentName || 'anonymous',
      agentName,
      agentVendor,
      agentModel,
      agentTrust:
        agentTrust === 'verified'
        || agentTrust === 'self_reported'
        || agentTrust === 'heuristic'
        || agentTrust === 'anonymous'
          ? agentTrust
          : undefined,
      agentSource:
        agentSource === 'public_task_agent'
        || agentSource === 'handoff_agent'
        || agentSource === 'webmcp_agent'
        || agentSource === 'signature_agent'
        || agentSource === 'user_agent'
        || agentSource === 'owner_resolver'
        || agentSource === 'anonymous'
          ? agentSource
          : undefined,
      agentMemoryKey,
      launchSource:
        launchSource === 'public_task_api'
        || launchSource === 'delegated_handoff'
        || launchSource === 'webmcp'
        || launchSource === 'embedded_widget'
          ? launchSource
          : undefined,
    };
  } catch {
    return null;
  }
}

function applyServerPolicy(policy?: RoverServerPolicy): void {
  if (!policy || !currentConfig) return;
  currentConfig.externalNavigationPolicy = policy.externalNavigationPolicy || currentConfig.externalNavigationPolicy;
  if (policy.domainScopeMode) {
    currentConfig.domainScopeMode = normalizeDomainScopeMode(policy.domainScopeMode);
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
  const projectionRunStatus = String(projection.runStatus || '').trim().toLowerCase();
  if (shouldQueueCancelForIgnoredProjectionRun({
    serverRunId,
    runStatus: projectionRunStatus,
    ignoredRunIds,
  })) {
    enqueueServerRunCancelRepair(serverRunId, 'projection_ignored_active_run', { attemptImmediately: true });
  }
  setServerAcceptedRunId(serverRunId || undefined);
  const localPending = runtimeState.pendingRun;
  const localRunId = localPending?.id || '';

  if (!serverRunId && localRunId) {
    const isProjectionTerminal =
      projectionRunStatus === 'completed'
      || projectionRunStatus === 'cancelled'
      || projectionRunStatus === 'failed'
      || projectionRunStatus === 'ended';
    if (isProjectionTerminal || runtimeState.activeTask?.status !== 'running') {
      addIgnoredRunId(localRunId);
      setPendingRun(undefined);
      sessionCoordinator?.setActiveRun(undefined);
    }
  } else if (
    serverRunId
    && !hasRemoteExecutionOwner()
    && resolveEffectiveExecutionMode(currentMode) !== 'observer'
    && shouldAdoptProjectionRun({
    serverRunId,
    localPendingRunId: localRunId,
    ignoredRunIds,
  })
  ) {
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
  } else if (serverRunId && ignoredRunIds.has(serverRunId)) {
    if (localRunId === serverRunId) {
      sessionCoordinator?.releaseWorkflowLock(serverRunId);
      setPendingRun(undefined);
      sessionCoordinator?.setActiveRun(undefined);
    }
  }

  const projectionSnapshotDigest =
    String(projection.snapshotMeta?.digest || '').trim()
    || (
      Number.isFinite(Number(projection.snapshotMeta?.updatedAt))
        ? `u:${Math.max(0, Number(projection.snapshotMeta?.updatedAt || 0))}`
        : (
          Number.isFinite(Number(projection.snapshotUpdatedAt))
            ? `u:${Math.max(0, Number(projection.snapshotUpdatedAt || 0))}`
            : ''
        )
    );
  const projectionSnapshotKey = projectionSnapshotDigest ? `${projection.sessionId}:${projectionSnapshotDigest}` : '';
  if (projection.snapshot && typeof projection.snapshot === 'object') {
    if (!projectionSnapshotKey || projectionSnapshotKey !== lastAppliedServerSnapshotKey) {
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
        if (projectionSnapshotKey) {
          lastAppliedServerSnapshotKey = projectionSnapshotKey;
        }
      }
    }
  }

  const ignoredHydratedRunId = String(runtimeState?.pendingRun?.id || '').trim();
  if (ignoredHydratedRunId && ignoredRunIds.has(ignoredHydratedRunId)) {
    sessionCoordinator?.releaseWorkflowLock(ignoredHydratedRunId);
    setPendingRun(undefined);
    sessionCoordinator?.setActiveRun(undefined);
  }

  void flushServerCancelRepairs();
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
      shouldKeepTransportActive: () => !shouldDeferBackgroundSync(),
      onSession: session => {
        updateRuntimeSessionToken(session.sessionToken, session.sessionTokenExpiresAt);
        // Broadcast token to observer tabs
        if (isTransportController) {
          sessionCoordinator?.broadcastSessionToken(
            session.sessionToken || '',
            session.sessionTokenExpiresAt || 0,
          );
        }
        runtimeServerEpoch = Math.max(1, Number(session.epoch || runtimeServerEpoch));
        if (runtimeState && session.sessionId && runtimeState.sessionId !== session.sessionId) {
          runtimeState.sessionId = session.sessionId;
          lastAppliedServerSnapshotKey = '';
          persistRuntimeState();
        }
        applyServerPolicy(session.policy);
        if (session.siteConfig && typeof session.siteConfig === 'object' && currentConfig) {
          const resolvedSiteConfig: RoverResolvedSiteConfig = {
            shortcuts: sanitizeShortcutList(session.siteConfig.shortcuts),
            greeting: sanitizeGreetingConfig(session.siteConfig.greeting),
            voice: sanitizeVoiceConfig(session.siteConfig.voice),
            aiAccess: sanitizeAiAccessConfig(session.siteConfig.aiAccess),
            limits: sanitizeSiteConfigLimits(session.siteConfig.limits),
            pageConfig: sanitizeResolvedPageCaptureConfig(session.siteConfig.pageConfig),
            version: session.siteConfig.version != null ? String(session.siteConfig.version) : undefined,
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
              pageConfig: resolveEffectivePageCaptureConfig(currentConfig),
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
        void flushServerCancelRepairs();
      },
      onProjection: projection => {
        applyServerProjection(projection);
        // Broadcast projection to observer tabs
        if (isTransportController) {
          sessionCoordinator?.broadcastProjection(projection);
        }
        void flushServerCancelRepairs();
        if (worker) {
          worker.postMessage({
            type: 'update_config',
            config: {
              ...buildWorkerBoundaryConfig(),
              pageConfig: resolveEffectivePageCaptureConfig(currentConfig),
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
  if (!force && shouldDeferBackgroundSync()) return;
  if (!telemetryBuffer.length) return;

  const telemetry = normalizeTelemetryConfig(currentConfig);
  const token = getRuntimeSessionToken(currentConfig);
  if (!token) return;

  const batch = telemetryBuffer.splice(0, telemetry.maxBatchSize);
  if (!batch.length) return;

  telemetryInFlight = true;
  telemetryLastFlushAt = Date.now();
  try {
    const response = await fetch(getTelemetryEndpoint(currentConfig), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
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

function recordTelemetryEvent(event: TelemetryEventName, payload?: any): void {
  if (!canUseTelemetry(currentConfig) || telemetryPausedAuth) return;
  if (shouldDeferBackgroundSync() && !TELEMETRY_BACKGROUND_ALLOWED_EVENTS.has(event)) return;
  const telemetry = normalizeTelemetryConfig(currentConfig);
  if (telemetry.sampleRate < 1 && Math.random() > telemetry.sampleRate) return;
  const nowTs = Date.now();
  if (event === 'status') {
    const statusEventName = String(payload?.event || '').trim();
    const bypassStatusThrottle = statusEventName.startsWith('deep_link_');
    if (!bypassStatusThrottle) {
      if (nowTs - telemetryLastStatusAt < TELEMETRY_STATUS_MIN_INTERVAL_MS) return;
      telemetryLastStatusAt = nowTs;
    }
  } else if (event === 'checkpoint_state') {
    if (nowTs - telemetryLastCheckpointStateAt < TELEMETRY_CHECKPOINT_STATE_MIN_INTERVAL_MS) return;
    telemetryLastCheckpointStateAt = nowTs;
  }

  const next: TelemetryEventRecord = {
    name: event,
    ts: nowTs,
    seq: ++telemetrySeq,
    payload: buildTelemetryPayload(payload, telemetry.includePayloads),
  };
  telemetryBuffer.push(next);
  if (telemetryBuffer.length > TELEMETRY_MAX_BUFFER_SIZE) {
    telemetryBuffer = telemetryBuffer.slice(-TELEMETRY_MAX_BUFFER_SIZE);
  }
  const isFastLane = TELEMETRY_FAST_LANE_EVENTS.has(event);
  if (isFastLane) {
    const sinceLastFlush = Date.now() - telemetryLastFlushAt;
    if (sinceLastFlush >= TELEMETRY_FAST_LANE_MAX_DELAY_MS) {
      void flushTelemetry(false);
      return;
    }
    if (!telemetryFastLaneTimer) {
      telemetryFastLaneTimer = setTimeout(() => {
        telemetryFastLaneTimer = null;
        void flushTelemetry(false);
      }, TELEMETRY_FAST_LANE_MAX_DELAY_MS - sinceLastFlush);
    }
    return;
  }
  if (telemetryBuffer.length >= telemetry.maxBatchSize) {
    const sinceLastFlush = Date.now() - telemetryLastFlushAt;
    if (sinceLastFlush >= TELEMETRY_MIN_FLUSH_COOLDOWN_MS) {
      void flushTelemetry(false);
    } else if (!telemetryFlushPending) {
      telemetryFlushPending = true;
      setTimeout(() => {
        telemetryFlushPending = false;
        void flushTelemetry(false);
      }, TELEMETRY_MIN_FLUSH_COOLDOWN_MS - sinceLastFlush);
    }
  }
}

function recordVoiceTelemetryEvent(event: RoverVoiceTelemetryEventName, payload?: any): void {
  recordTelemetryEvent(event, payload);
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
  evictOldestSetEntry(ignoredRunIds, MAX_IGNORED_RUN_ENTRIES);
}

function removeIgnoredRunId(runId?: string): void {
  if (!runId) return;
  ignoredRunIds.delete(runId);
}

function computeServerCancelRepairDelay(attempts: number): number {
  const clampedAttempts = Math.max(0, Math.floor(attempts));
  const delay = SERVER_CANCEL_REPAIR_BASE_DELAY_MS * (2 ** clampedAttempts);
  return Math.max(120, Math.min(SERVER_CANCEL_REPAIR_MAX_DELAY_MS, delay));
}

function getNextServerCancelRepairDelayMs(): number | null {
  if (!pendingServerRunCancelRepairs.size) return null;
  let nextAt = Number.POSITIVE_INFINITY;
  for (const entry of pendingServerRunCancelRepairs.values()) {
    nextAt = Math.min(nextAt, Number(entry.nextAttemptAt) || Number.POSITIVE_INFINITY);
  }
  if (!Number.isFinite(nextAt)) return null;
  return Math.max(120, Math.floor(nextAt - Date.now()));
}

function scheduleServerCancelRepairFlush(delayMs = SERVER_CANCEL_REPAIR_BASE_DELAY_MS): void {
  if (serverCancelRepairTimer) {
    clearTimeout(serverCancelRepairTimer);
    serverCancelRepairTimer = null;
  }
  const delay = Math.max(80, Math.floor(delayMs));
  serverCancelRepairTimer = setTimeout(() => {
    serverCancelRepairTimer = null;
    void flushServerCancelRepairs();
  }, delay);
}

function enqueueServerRunCancelRepair(
  runId?: string,
  reason = 'local_run_abandoned',
  options?: { attemptImmediately?: boolean },
): void {
  const normalizedRunId = String(runId || '').trim();
  if (!normalizedRunId) return;

  const now = Date.now();
  const existing = pendingServerRunCancelRepairs.get(normalizedRunId);
  const nextAttemptAt =
    options?.attemptImmediately === true
      ? now
      : (existing?.nextAttemptAt && existing.nextAttemptAt > now
        ? existing.nextAttemptAt
        : now + computeServerCancelRepairDelay(existing?.attempts || 0));

  pendingServerRunCancelRepairs.set(normalizedRunId, {
    runId: normalizedRunId,
    reason: String(reason || existing?.reason || 'local_run_abandoned').trim() || 'local_run_abandoned',
    attempts: existing?.attempts || 0,
    nextAttemptAt,
    createdAt: existing?.createdAt || now,
    lastError: existing?.lastError,
  });

  while (pendingServerRunCancelRepairs.size > SERVER_CANCEL_REPAIR_MAX_QUEUE) {
    const oldest = Array.from(pendingServerRunCancelRepairs.values())
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))[0];
    if (!oldest?.runId) break;
    pendingServerRunCancelRepairs.delete(oldest.runId);
  }

  scheduleServerCancelRepairFlush(options?.attemptImmediately ? 50 : SERVER_CANCEL_REPAIR_BASE_DELAY_MS);
}

async function flushServerCancelRepairs(): Promise<void> {
  if (serverCancelRepairInFlight) return;
  if (!pendingServerRunCancelRepairs.size) return;

  const canAttemptNow =
    !!roverServerRuntime
    && !!sessionReady
    && !!getRuntimeSessionToken(currentConfig);
  if (!canAttemptNow) {
    scheduleServerCancelRepairFlush(SERVER_CANCEL_REPAIR_BASE_DELAY_MS);
    return;
  }

  serverCancelRepairInFlight = true;
  try {
    const now = Date.now();
    const due = Array.from(pendingServerRunCancelRepairs.values())
      .sort((a, b) => Number(a.nextAttemptAt) - Number(b.nextAttemptAt));

    for (const entry of due) {
      if (entry.nextAttemptAt > now) break;
      if (!pendingServerRunCancelRepairs.has(entry.runId)) continue;

      if (hasLiveRemoteControllerForRun(entry.runId)) {
        pendingServerRunCancelRepairs.set(entry.runId, {
          ...entry,
          nextAttemptAt: Date.now() + computeServerCancelRepairDelay(Math.max(1, entry.attempts)),
        });
        continue;
      }

      const runtime = roverServerRuntime;
      if (!runtime) {
        pendingServerRunCancelRepairs.set(entry.runId, {
          ...entry,
          nextAttemptAt: Date.now() + SERVER_CANCEL_REPAIR_BASE_DELAY_MS,
        });
        continue;
      }

      try {
        const response = await runtime.controlRun({
          action: 'cancel',
          runId: entry.runId,
          reason: entry.reason,
        });
        if (response) {
          pendingServerRunCancelRepairs.delete(entry.runId);
          continue;
        }
        throw new Error('cancel_control_no_response');
      } catch (error: any) {
        const attempts = Math.max(0, Number(entry.attempts || 0)) + 1;
        if (attempts >= SERVER_CANCEL_REPAIR_MAX_ATTEMPTS) {
          pendingServerRunCancelRepairs.delete(entry.runId);
          emit('error', {
            message: `Failed to cancel stale run ${entry.runId} after retries.`,
            scope: 'run_cancel_repair',
            code: 'RUN_CANCEL_REPAIR_FAILED',
            runId: entry.runId,
          });
          continue;
        }
        pendingServerRunCancelRepairs.set(entry.runId, {
          ...entry,
          attempts,
          lastError: String(error?.message || 'cancel_control_failed'),
          nextAttemptAt: Date.now() + computeServerCancelRepairDelay(attempts),
        });
      }
    }
  } finally {
    serverCancelRepairInFlight = false;
    const nextDelay = getNextServerCancelRepairDelayMs();
    if (nextDelay != null) {
      scheduleServerCancelRepairFlush(nextDelay);
    }
  }
}

function isTaskRunning(): boolean {
  return runtimeState?.activeTask?.status === 'running';
}

function syncCheckpointIdleMode(): void {
  if (!cloudCheckpointClient) return;
  if (isTaskRunning() || hasLocalPendingRun()) {
    cloudCheckpointClient.enterActiveMode();
  } else {
    cloudCheckpointClient.enterIdleMode();
  }
}

function isRuntimeTabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function hasLocalPendingRun(): boolean {
  return !!runtimeState?.pendingRun?.id;
}

function hasLocalActiveRunOwnership(): boolean {
  const activeRun = sessionCoordinator?.getState()?.activeRun;
  if (!activeRun) return false;
  if (activeRun.runtimeId) return activeRun.runtimeId === runtimeId;
  const pendingRunId = String(runtimeState?.pendingRun?.id || '').trim();
  return !!(pendingRunId && activeRun.runId === pendingRunId);
}

function hasLocalWorkflowLock(): boolean {
  const lockInfo = sessionCoordinator?.getWorkflowLockInfo();
  return !!(lockInfo?.locked && lockInfo.holderRuntimeId === runtimeId);
}

function hasLocalExecutionOwnership(): boolean {
  if (!sessionCoordinator) {
    return isTaskRunning() || hasLocalPendingRun();
  }
  if (hasLocalWorkflowLock() || hasLocalActiveRunOwnership()) {
    return true;
  }
  return hasLocalPendingRun() && !hasRemoteExecutionOwner();
}

function hasTransportDemandSignal(): boolean {
  const activation = normalizeTransportActivation(currentConfig?.transport?.activation);
  if (activation !== 'on_demand') return true;
  return !!(runtimeState?.uiOpen || hasLocalExecutionOwnership() || hasRemoteActiveRun() || hasLiveRemoteWorkflowLock());
}

function shouldDeferBackgroundSync(): boolean {
  // Observer tabs defer all backend transport — controller handles SSE/checkpoint
  if (!isTransportController) return true;
  const demandSignal = hasTransportDemandSignal();
  if (demandSignal) {
    transportIdleDeadline = 0;
  } else {
    const idleCloseMs = normalizeTransportIdleCloseMs(currentConfig?.transport?.idleCloseMs);
    if (transportIdleDeadline <= 0) {
      transportIdleDeadline = Date.now() + idleCloseMs;
    }
    if (Date.now() < transportIdleDeadline) {
      return false;
    }
    return true;
  }

  if (!isRuntimeTabHidden()) return false;
  return !hasLocalExecutionOwnership() && !runtimeState?.uiOpen;
}

function syncMainWorldObserverPause(force = false): void {
  if (typeof window === 'undefined') return;
  const shouldPause = shouldDeferBackgroundSync();
  if (!force && lastObserverPauseApplied === shouldPause) return;
  lastObserverPauseApplied = shouldPause;
  try {
    const setPaused = (window as any).rtrvrAISetObserverPaused;
    if (typeof setPaused === 'function') {
      setPaused(shouldPause);
    }
  } catch {
    // no-op
  }
}

function hasRemoteActiveRun(): boolean {
  const activeRun = sessionCoordinator?.getState()?.activeRun;
  return !!(activeRun && activeRun.runtimeId && activeRun.runtimeId !== runtimeId);
}

function hasLiveRemoteWorkflowLock(): boolean {
  const coordinator = sessionCoordinator;
  if (!coordinator?.isWorkflowLocked()) return false;
  const lockInfo = coordinator.getWorkflowLockInfo();
  if (!lockInfo.locked || !lockInfo.holderRuntimeId || lockInfo.holderRuntimeId === runtimeId) return false;
  const remoteTab = coordinator
    .listTabs({ scope: 'all' })
    .find(tab => tab.runtimeId === lockInfo.holderRuntimeId);
  if (!remoteTab) return false;
  return Number(remoteTab.updatedAt) > Date.now() - 5_000;
}

function hasRemoteExecutionOwner(): boolean {
  return hasLiveRemoteWorkflowLock();
}

function resolveEffectiveExecutionMode(mode: RoverExecutionMode): RoverExecutionMode {
  if (hasRemoteExecutionOwner()) return 'observer';
  return mode === 'observer' ? 'controller' : mode;
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

function takeControlOfActiveRun(): boolean {
  if (!sessionCoordinator) return false;

  const sharedState = sessionCoordinator.getState();
  const sharedActiveRun = sharedState?.activeRun;
  const sharedRunId = String(sharedActiveRun?.runId || '').trim();
  const sharedRunText = String(sharedActiveRun?.text || '').trim();

  const claimedLease = sessionCoordinator.requestControl();
  if (!claimedLease) return false;

  if (!sharedRunId) {
    return true;
  }

  const claimedWorkflowLock = sessionCoordinator.acquireWorkflowLock(sharedRunId, { force: true });
  if (!claimedWorkflowLock) return false;

  if (!runtimeState) return true;

  const sharedWorkerContext = dropMismatchedPendingAskUserForBoundary(
    sanitizeWorkerState(sharedState?.workerContext),
    resolveCurrentTaskBoundaryCandidate(),
  );
  if (sharedWorkerContext) {
    runtimeState.workerState = sharedWorkerContext;
    syncCurrentTaskBoundaryId();
    sessionCoordinator.setWorkerContext(toSharedWorkerContext(runtimeState.workerState));
    if (workerReady && worker) {
      postWorkerBoundaryConfig();
      worker.postMessage({ type: 'hydrate_state', state: runtimeState.workerState });
      emit('context_restored', { source: 'controller_handoff', ts: Date.now() });
    }
  }

  if (sharedState?.task) {
    runtimeState.activeTask = toPersistedTask(sharedState.task, runtimeState.activeTask || createDefaultTaskState('handoff'));
  }
  runtimeState.uiHidden = false;
  runtimeState.uiOpen = true;
  if (sharedRunText || sharedRunId) {
    setPendingRun(
      sanitizePendingRun({
        id: sharedRunId,
        text: sharedRunText || runtimeState.pendingRun?.text || lastUserInputText || 'Continue task',
        startedAt: sharedActiveRun?.startedAt || runtimeState.pendingRun?.startedAt || Date.now(),
        attempts: runtimeState.pendingRun?.id === sharedRunId ? runtimeState.pendingRun.attempts || 0 : 0,
        autoResume: true,
        taskBoundaryId:
          runtimeState.pendingRun?.taskBoundaryId
          || runtimeState.workerState?.taskBoundaryId
          || currentTaskBoundaryId,
        resumeRequired: true,
        resumeReason: 'handoff',
      }),
    );
    sessionCoordinator.setActiveRun({ runId: sharedRunId, text: sharedRunText || runtimeState.pendingRun?.text || 'Continue task' });
  }
  persistRuntimeState();
  maybeAutoResumePendingRun({ overridePolicyAction: 'auto_resume' });
  return true;
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

function resolveCanonicalTaskInputForRun(runId?: string): string | undefined {
  const activeTaskInput = String(taskOrchestrator?.getActiveTask()?.rootUserInput || '').trim();
  if (activeTaskInput) return activeTaskInput;

  const workerRootInput = String(runtimeState?.workerState?.rootUserInput || '').trim();
  if (workerRootInput) return workerRootInput;
  const pendingRun = runtimeState?.pendingRun;

  const matchingPendingRunText =
    pendingRun && pendingRun.id === runId
      ? String(pendingRun.text || '').trim()
      : '';
  if (matchingPendingRunText) return matchingPendingRunText;

  const activePendingRunText = String(pendingRun?.text || '').trim();
  if (activePendingRunText) return activePendingRunText;

  const previousTaskInput = String(lastUserInputText || '').trim();
  return previousTaskInput || undefined;
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
  const selected = input.length <= max
    ? input
    : [input[0], ...input.slice(-(max - 1))];
  const out: unknown[] = [];
  for (const entry of selected) {
    const cloned = cloneUnknown(entry);
    if (cloned !== undefined) out.push(cloned);
  }
  return out;
}

function enforceAccTreeRetention(steps: unknown[] | undefined): unknown[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const cloned = [...steps];
  const withAccTree: number[] = [];
  for (let i = 0; i < cloned.length; i += 1) {
    const accTreeId = (cloned[i] as any)?.accTreeId;
    if (typeof accTreeId === 'string' && accTreeId.trim()) {
      withAccTree.push(i);
    }
  }
  if (withAccTree.length <= 3) return cloned;
  const keep = new Set<number>([withAccTree[0], ...withAccTree.slice(-2)]);
  for (const index of withAccTree) {
    if (keep.has(index)) continue;
    if (cloned[index] && typeof cloned[index] === 'object') {
      delete (cloned[index] as any).accTreeId;
    }
  }
  return cloned;
}

async function loadPersistedStateFromAsyncStore(
  key: string,
  fallbackKeys?: string[],
): Promise<PersistedRuntimeState | null> {
  if (!runtimeStateStore) return null;
  try {
    const primary = await runtimeStateStore.readAsync(key);
    if (primary) return primary;
    for (const fallbackKey of fallbackKeys || []) {
      if (!fallbackKey || fallbackKey === key) continue;
      const candidate = await runtimeStateStore.readAsync(fallbackKey);
      if (candidate) return candidate;
    }
    return null;
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

function sanitizeChatLogEntries(input: unknown): PersistedChatLogEntry[] {
  if (!Array.isArray(input)) return [];
  const out: PersistedChatLogEntry[] = [];
  for (const raw of input.slice(-MAX_SEED_CHATLOG_ENTRIES)) {
    const role = raw?.role === 'user' ? 'user' : (raw?.role === 'model' ? 'model' : undefined);
    if (!role) continue;
    const message = truncateText(String(raw?.message || '').replace(/\s+/g, ' ').trim(), 1500);
    if (!message) continue;
    const previous = out[out.length - 1];
    if (previous && previous.role === role && previous.message === message) continue;
    out.push({ role, message });
  }
  return out;
}

function sanitizeTransientStatus(
  input: any,
  fallback?: { runId?: string; taskId?: string },
): PersistedTransientStatus | undefined {
  if (!input) return undefined;
  const textCandidate = typeof input === 'string' ? input : input?.text;
  const text = truncateText(String(textCandidate || '').trim(), 300);
  if (!text) return undefined;
  const runIdCandidate =
    typeof input?.runId === 'string' && input.runId.trim()
      ? input.runId.trim()
      : (typeof fallback?.runId === 'string' && fallback.runId.trim() ? fallback.runId.trim() : undefined);
  const taskIdCandidate =
    typeof input?.taskId === 'string' && input.taskId.trim()
      ? input.taskId.trim()
      : (typeof fallback?.taskId === 'string' && fallback.taskId.trim() ? fallback.taskId.trim() : undefined);
  const stage =
    typeof input?.stage === 'string' && input.stage.trim()
      ? truncateText(input.stage.trim(), 40)
      : undefined;

  return {
    text,
    ts: Number(input?.ts) || Date.now(),
    runId: runIdCandidate,
    taskId: taskIdCandidate,
    stage,
  };
}

function compareMessagePriority(
  incoming: PersistedUiMessage,
  existing: PersistedUiMessage,
): number {
  const incomingTs = Number(incoming.ts) || 0;
  const existingTs = Number(existing.ts) || 0;
  if (incomingTs !== existingTs) return incomingTs - existingTs;
  const incomingBlocks = Array.isArray(incoming.blocks) ? incoming.blocks.length : 0;
  const existingBlocks = Array.isArray(existing.blocks) ? existing.blocks.length : 0;
  if (incomingBlocks !== existingBlocks) return incomingBlocks - existingBlocks;
  return String(incoming.text || '').length - String(existing.text || '').length;
}

function mergeUiMessagesMonotonic(
  localMessages: PersistedUiMessage[],
  incomingMessages: PersistedUiMessage[],
): PersistedUiMessage[] {
  const merged = new Map<string, PersistedUiMessage>();
  for (const message of sanitizeUiMessages(localMessages)) {
    merged.set(message.id, message);
  }
  for (const message of sanitizeUiMessages(incomingMessages)) {
    const existing = merged.get(message.id);
    if (!existing || compareMessagePriority(message, existing) > 0) {
      merged.set(message.id, message);
    }
  }
  return sanitizeUiMessages(
    [...merged.values()].sort((a, b) => {
      const tsDiff = (Number(a.ts) || 0) - (Number(b.ts) || 0);
      if (tsDiff !== 0) return tsDiff;
      return a.id.localeCompare(b.id);
    }),
  );
}

function compareTimelinePriority(
  incoming: PersistedTimelineEvent,
  existing: PersistedTimelineEvent,
): number {
  const incomingTs = Number(incoming.ts) || 0;
  const existingTs = Number(existing.ts) || 0;
  if (incomingTs !== existingTs) return incomingTs - existingTs;
  const incomingBlocks = Array.isArray(incoming.detailBlocks) ? incoming.detailBlocks.length : 0;
  const existingBlocks = Array.isArray(existing.detailBlocks) ? existing.detailBlocks.length : 0;
  if (incomingBlocks !== existingBlocks) return incomingBlocks - existingBlocks;
  return String(incoming.detail || '').length - String(existing.detail || '').length;
}

function mergeTimelineEventsMonotonic(
  localTimeline: PersistedTimelineEvent[],
  incomingTimeline: PersistedTimelineEvent[],
): PersistedTimelineEvent[] {
  const merged = new Map<string, PersistedTimelineEvent>();
  for (const event of sanitizeTimelineEvents(localTimeline)) {
    merged.set(event.id, event);
  }
  for (const event of sanitizeTimelineEvents(incomingTimeline)) {
    const existing = merged.get(event.id);
    if (!existing || compareTimelinePriority(event, existing) > 0) {
      merged.set(event.id, event);
    }
  }
  return sanitizeTimelineEvents(
    [...merged.values()].sort((a, b) => {
      const tsDiff = (Number(a.ts) || 0) - (Number(b.ts) || 0);
      if (tsDiff !== 0) return tsDiff;
      return a.id.localeCompare(b.id);
    }),
  );
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
  const plannerHistory = cloneUnknownArrayTail(
    plannerRaw,
    MAX_WORKER_PLANNER_STEPS,
  );
  const agentPrevSteps = cloneUnknownArrayTail(
    enforceAccTreeRetention(agentPrevStepsRaw),
    MAX_WORKER_AGENT_PREV_STEPS,
  );
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
    seedChatLog: sanitizeChatLogEntries(input.seedChatLog),
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

  const normalized: PersistedRuntimeState = {
    version: RUNTIME_STATE_VERSION,
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : sessionId,
    runtimeId: typeof raw.runtimeId === 'string' && raw.runtimeId ? raw.runtimeId : rid,
    uiOpen: !!raw.uiOpen,
    uiHidden: !!raw.uiHidden,
    uiStatus: typeof raw.uiStatus === 'string' ? truncateText(raw.uiStatus, 300) : undefined,
    transientStatus: sanitizeTransientStatus((raw as any).transientStatus ?? raw.uiStatus, {
      runId: parsedPendingRun?.id,
      taskId: parsedTask?.taskId,
    }),
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
    // v2 multi-task fields — either restore or migrate
    tasks: raw.tasks && typeof raw.tasks === 'object' ? raw.tasks : {},
    activeTaskId: typeof raw.activeTaskId === 'string' ? raw.activeTaskId : undefined,
    taskOrder: Array.isArray(raw.taskOrder) ? raw.taskOrder : [],
  };

  // v1 → v2 migration: create TaskRecord from legacy singular fields
  const rawVersion = Number(raw.version) || 1;
  if (rawVersion < 2 && parsedTask && parsedTask.taskId) {
    const migrated = TaskOrchestrator.fromV1State(normalized);
    const { tasks, activeTaskId, taskOrder } = migrated.toPersistedState();
    normalized.tasks = tasks;
    normalized.activeTaskId = activeTaskId;
    normalized.taskOrder = taskOrder;
    migrated.shutdown();
  }

  return normalized;
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
    seedChatLog: sanitizeChatLogEntries(state.seedChatLog),
    history: Array.isArray(state.history)
      ? state.history
          .slice(-MAX_WORKER_HISTORY)
          .map(message => toWorkerHistoryEntry(message))
          .filter((message): message is { role: string; content: string } => !!message)
      : [],
    plannerHistory: cloneUnknownArrayTail(
      state.plannerHistory,
      MAX_WORKER_PLANNER_STEPS,
    ),
    agentPrevSteps: cloneUnknownArrayTail(
      enforceAccTreeRetention(state.agentPrevSteps),
      MAX_WORKER_AGENT_PREV_STEPS,
    ),
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

function resolveMaxPersistBytes(): number {
  return normalizeStabilityByteLimit(
    currentConfig?.stability?.maxPersistBytes,
    ROVER_V2_PERSIST_CAPS.localPersistBytes,
  );
}

function trimRuntimeStateForPersist(
  source: PersistedRuntimeState,
  maxPersistBytes: number,
): PersistedRuntimeState {
  const draft: PersistedRuntimeState = {
    ...source,
    uiMessages: sanitizeUiMessages(source.uiMessages).slice(-MAX_UI_MESSAGES),
    timeline: sanitizeTimelineEvents(source.timeline).slice(-MAX_TIMELINE_EVENTS),
    workerState: sanitizeWorkerState(source.workerState),
  };

  if (draft.workerState) {
    draft.workerState = {
      ...draft.workerState,
      history: Array.isArray(draft.workerState.history)
        ? draft.workerState.history.slice(-MAX_WORKER_HISTORY)
        : [],
      plannerHistory: cloneUnknownArrayTail(draft.workerState.plannerHistory, MAX_WORKER_PLANNER_STEPS),
      agentPrevSteps: cloneUnknownArrayTail(draft.workerState.agentPrevSteps, MAX_WORKER_AGENT_PREV_STEPS),
    };
  }

  let serialized = '';
  try {
    serialized = JSON.stringify(draft);
  } catch {
    return source;
  }
  if (serialized.length <= maxPersistBytes) return draft;

  const fallback: PersistedRuntimeState = {
    ...draft,
    uiMessages: [],
    timeline: [],
    workerState: undefined,
  };
  try {
    if (JSON.stringify(fallback).length <= maxPersistBytes) return fallback;
  } catch {
    return fallback;
  }

  return {
    ...fallback,
    pendingRun: undefined,
    activeTask: createDefaultTaskState('persist_trim'),
  };
}

function persistRuntimeStateImmediate(options?: { markCheckpointDirty?: boolean }): void {
  if (!runtimeState || !runtimeStorageKey) return;
  try {
    // Sync multi-task state from orchestrator
    if (taskOrchestrator) {
      syncActiveTaskRecordFromRuntimeState();
      taskOrchestrator.enforceMemoryCaps();
      const { tasks, activeTaskId, taskOrder } = taskOrchestrator.toPersistedState();
      runtimeState.tasks = tasks;
      runtimeState.activeTaskId = activeTaskId;
      runtimeState.taskOrder = taskOrder;
    }
    const maxPersistBytes = resolveMaxPersistBytes();
    runtimeState = trimRuntimeStateForPersist(runtimeState, maxPersistBytes);
    // Compute a lightweight signature to skip redundant writes
    const sig = JSON.stringify({
      s: runtimeState.sessionId,
      p: runtimeState.pendingRun?.id,
      pa: runtimeState.pendingRun?.autoResume,
      t: runtimeState.activeTask?.status,
      te: runtimeState.taskEpoch,
      m: runtimeState.uiMessages?.length,
      tl: runtimeState.timeline?.length,
      o: runtimeState.uiOpen,
      h: runtimeState.uiHidden,
      e: runtimeState.executionMode,
      at: runtimeState.activeTaskId,
    });
    if (sig === lastPersistSignature && !options?.markCheckpointDirty) return;
    lastPersistSignature = sig;
    runtimeState.updatedAt = Date.now();
    runtimeStateStore?.write(runtimeStorageKey, runtimeState);
    if (runtimeStorageLegacyKey && runtimeStorageLegacyKey !== runtimeStorageKey) {
      runtimeStateStore?.remove(runtimeStorageLegacyKey);
      runtimeStorageLegacyKey = null;
    }
    if (!suppressCheckpointSync && options?.markCheckpointDirty !== false) {
      cloudCheckpointClient?.markDirty();
    }
  } catch {
    // ignore storage failures
  }
}

let persistScheduled = false;
let persistDirtyCheckpoint = false;
let lastPersistSignature = '';
let lastPersistTime = 0;
let firstPersistRequestAt = 0;
const MIN_PERSIST_INTERVAL_MS = 2_000;
const MAX_PERSIST_COALESCE_DELAY_MS = 2_000;

function flushCheckpointCritical(reason: string): void {
  persistRuntimeStateImmediate({ markCheckpointDirty: true });
  cloudCheckpointClient?.syncNow({ push: true, pull: false });
  recordTelemetryEvent('checkpoint_state', {
    event: 'critical_flush',
    reason,
  });
}

function persistRuntimeState(options?: { markCheckpointDirty?: boolean }): void {
  if (options?.markCheckpointDirty !== false) persistDirtyCheckpoint = true;
  const now = Date.now();
  if (!persistScheduled) {
    firstPersistRequestAt = now;
  } else if (firstPersistRequestAt > 0 && now - firstPersistRequestAt >= MAX_PERSIST_COALESCE_DELAY_MS) {
    persistScheduled = false;
    firstPersistRequestAt = 0;
    const dirty = persistDirtyCheckpoint;
    persistDirtyCheckpoint = false;
    lastPersistTime = now;
    persistRuntimeStateImmediate({ markCheckpointDirty: dirty });
    return;
  }
  if (persistScheduled) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    firstPersistRequestAt = 0;
    const dirty = persistDirtyCheckpoint;
    persistDirtyCheckpoint = false;
    const nowMs = Date.now();
    if (nowMs - lastPersistTime < MIN_PERSIST_INTERVAL_MS) {
      // Re-schedule for later to throttle writes
      persistScheduled = true;
      setTimeout(() => {
        persistScheduled = false;
        firstPersistRequestAt = 0;
        lastPersistTime = Date.now();
        persistRuntimeStateImmediate({ markCheckpointDirty: persistDirtyCheckpoint || dirty });
        persistDirtyCheckpoint = false;
      }, MIN_PERSIST_INTERVAL_MS - (nowMs - lastPersistTime));
      return;
    }
    lastPersistTime = nowMs;
    persistRuntimeStateImmediate({ markCheckpointDirty: dirty });
  }, 0);
}

function ensureUnloadHandler(): void {
  if (unloadHandlerInstalled) return;
  unloadHandlerInstalled = true;
  if (!visibilitySyncInstalled) {
    visibilitySyncInstalled = true;
    addTrackedListener(document, 'visibilitychange', () => {
      syncMainWorldObserverPause();
    }, { passive: true });
  }

  const onPageHide = () => {
    // Persist session token for same-origin navigation resume
    if (runtimeSessionToken && currentConfig?.siteId) {
      try {
        sessionStorage.setItem(`rover:sess:${currentConfig.siteId}`, JSON.stringify({
          t: runtimeSessionToken,
          e: runtimeSessionTokenExpiresAt,
        }));
      } catch { /* ignore */ }
    }
    // If there's an auto-resumable pending run, persist handoff metadata so the
    // next runtime can resume with the same task boundary and widget-open intent.
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
        if (currentConfig?.siteId) {
          const handoffForBootstrap = sanitizeNavigationHandoff(runtimeState?.lastNavigationHandoff);
          writeNavigationHandoffBootstrap(currentConfig.siteId, {
            runId: markedPending.id,
            text: markedPending.text,
            taskBoundaryId: markedPending.taskBoundaryId || currentTaskBoundaryId,
            resumeReason: effectiveReason,
            handoffId: handoffForBootstrap?.handoffId,
            openIntent: runtimeState.uiOpen ? 'preserve_if_running' : undefined,
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
    persistRuntimeStateImmediate();
    void flushTelemetry(true);
    stopTelemetry();
    cloudCheckpointClient?.markDirty();
    cloudCheckpointClient?.syncNow({ push: true, pull: false });
    cloudCheckpointClient?.stop();
    sessionCoordinator?.stop();
  };

  addTrackedListener(window, 'pagehide', onPageHide, { capture: true });

  const onPageShow = (evt: Event) => {
    const event = evt as PageTransitionEvent;
    if (!event.persisted) return; // Only handle bfcache restores
    // Re-read shared state from localStorage after bfcache restore
    if (sessionCoordinator) {
      sessionCoordinator.reloadFromStorage();
      // Re-register current tab (may have been removed by broadcastClosing)
      sessionCoordinator.registerCurrentTab(window.location.href, document.title || undefined);
      sessionCoordinator.claimLease(false);
    }
    autoResumeAttempted = false; // Allow auto-resume after bfcache restore
    autoResumeSessionWaitAttempts = 0;
    if (currentConfig) {
      setupTelemetry(currentConfig);
    }
    syncMainWorldObserverPause(true);
  };
  addTrackedListener(window, 'pageshow', onPageShow);
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
  const previousStatus = runtimeState.activeTask?.status;
  const previousBoundaryId = normalizeTaskBoundaryId(currentTaskBoundaryId);
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
    const nextBoundaryId = normalizeTaskBoundaryId(currentTaskBoundaryId);
    const taskStatusChanged = previousStatus !== transition.task.status;
    const taskBoundaryChanged = !!nextBoundaryId && nextBoundaryId !== previousBoundaryId;
    if (taskStatusChanged) {
      flushCheckpointCritical('run_status_transition');
    } else if (taskBoundaryChanged) {
      flushCheckpointCritical('task_boundary_transition');
    } else {
      persistRuntimeState();
    }
  }
  syncMainWorldObserverPause();
  syncCheckpointIdleMode();

  // Lightweight consistency sync: orchestrator is now dispatched first (FSM-primary),
  // so we only need to persist orchestrator state to runtimeState here.
  if (taskOrchestrator) {
    const orchState = taskOrchestrator.toPersistedState();
    runtimeState.tasks = orchState.tasks;
    runtimeState.activeTaskId = orchState.activeTaskId;
    runtimeState.taskOrder = orchState.taskOrder;
  }

  return transition.task;
}

/** Sync the orchestrator's task list to the UI conversation drawer */
function syncOrchestratorConversationList(): void {
  if (!taskOrchestrator || !ui) return;
  syncActiveTaskRecordFromRuntimeState();
  const tasks = taskOrchestrator.listTasks();
  const activeId = taskOrchestrator.getActiveTask()?.taskId;
  ui.setConversations(tasks.map(t => ({
    id: t.taskId,
    summary: t.rootUserInput || t.taskId.slice(0, 8),
    status: t.state as ConversationListItem['status'],
    updatedAt: t.endedAt || t.lastAssistantAt || t.lastUserAt || t.startedAt,
    isActive: t.taskId === activeId,
  })));
  if (activeId) {
    ui.setActiveConversationId(activeId);
  }
}

function getActiveTaskRecord(): TaskRecord | undefined {
  if (!taskOrchestrator) return undefined;
  return taskOrchestrator.getActiveTask();
}

function resolveRuntimeContinuationIdentity(
  state: PersistedRuntimeState | null | undefined = runtimeState,
  preferredTaskId?: string,
): { taskId?: string; boundaryId?: string; runId?: string } {
  const taskId =
    String(preferredTaskId || state?.activeTaskId || state?.activeTask?.taskId || '').trim()
    || undefined;
  const boundaryId = normalizeTaskBoundaryId(resolveExistingTaskBoundaryIdFromState(state));
  const runId = String(sanitizePendingRun(state?.pendingRun)?.id || '').trim() || undefined;
  return { taskId, boundaryId, runId };
}

function getActiveTaskSeedChatLog(): PersistedChatLogEntry[] {
  const taskSeed = sanitizeChatLogEntries(getActiveTaskRecord()?.seedChatLog);
  if (taskSeed.length) return taskSeed;
  return sanitizeChatLogEntries(runtimeState?.workerState?.seedChatLog);
}

function toPersistedTaskFromRecord(task: TaskRecord, fallback?: PersistedTaskState): PersistedTaskState {
  const normalizedFallback = fallback || createDefaultTaskState('task_record_sync');
  return sanitizeTask(
    {
      taskId: task.taskId,
      status: statusFromState(task.state),
      startedAt: task.startedAt,
      lastUserAt: task.lastUserAt,
      lastAssistantAt: task.lastAssistantAt,
      boundaryReason: task.blockReason || normalizedFallback.boundaryReason,
      endedAt: task.endedAt,
    },
    normalizedFallback,
  );
}

function restoreRuntimeStateFromTaskRecord(
  task: TaskRecord,
  options?: { replayUi?: boolean },
): void {
  if (!runtimeState) return;

  const boundaryId =
    normalizeTaskBoundaryId(task.boundaryId)
    || normalizeTaskBoundaryId(task.pendingRun?.taskBoundaryId)
    || normalizeTaskBoundaryId(task.workerState?.taskBoundaryId)
    || resolveCurrentTaskBoundaryCandidate()
    || createTaskBoundaryId();
  const normalizedSeedChatLog = sanitizeChatLogEntries(task.seedChatLog ?? task.workerState?.seedChatLog);
  const normalizedWorkerState = dropMismatchedPendingAskUserForBoundary(
    sanitizeWorkerState(
      task.workerState || normalizedSeedChatLog.length || task.rootUserInput
        ? {
            ...(task.workerState || {}),
            ...(task.rootUserInput ? { rootUserInput: task.rootUserInput } : {}),
            ...(normalizedSeedChatLog.length ? { seedChatLog: normalizedSeedChatLog } : {}),
            taskBoundaryId: task.workerState?.taskBoundaryId || boundaryId,
          }
        : undefined,
    ),
    boundaryId,
  );
  const normalizedPendingRun = sanitizePendingRun(task.pendingRun);
  const normalizedTransientStatus = sanitizeTransientStatus(task.transientStatus, {
    runId: normalizedPendingRun?.id,
    taskId: task.taskId,
  });

  runtimeState.activeTaskId = task.taskId;
  runtimeState.activeTask = toPersistedTaskFromRecord(task, runtimeState.activeTask);
  runtimeState.uiMessages = sanitizeUiMessages(task.uiMessages);
  runtimeState.timeline = sanitizeTimelineEvents(task.timeline);
  runtimeState.workerState = normalizedWorkerState;
  runtimeState.pendingRun = normalizedPendingRun;
  runtimeState.taskTabScope = sanitizeTaskTabScope(task.tabScope, boundaryId);
  runtimeState.uiStatus = normalizedTransientStatus?.text;
  runtimeState.transientStatus = normalizedTransientStatus;
  currentTaskBoundaryId = boundaryId;

  if (task.rootUserInput?.trim()) {
    lastUserInputText = task.rootUserInput.trim();
  }

  if (options?.replayUi === false) return;

  clearTaskUiState();
  if (runtimeState.uiMessages.length) {
    replayUiMessages(runtimeState.uiMessages);
  }
  if (runtimeState.timeline.length) {
    replayTimeline(runtimeState.timeline);
  }
  replayTransientStatusFromRuntime(runtimeState);
  syncQuestionPromptFromWorkerState();
  ui?.setRunning(!!runtimeState.pendingRun && runtimeState.activeTask?.status === 'running');
  if (task.state === 'paused') {
    ui?.showPausedTaskBanner({ taskId: task.taskId, rootUserInput: task.rootUserInput || 'Task' });
  } else {
    ui?.hidePausedTaskBanner();
  }
}

function setActiveTaskSeedChatLog(entries: unknown): void {
  const normalized = sanitizeChatLogEntries(entries);
  const activeTask = getActiveTaskRecord();
  if (activeTask && taskOrchestrator) {
    taskOrchestrator.updateTask(activeTask.taskId, task => ({
      ...task,
      seedChatLog: normalized,
    }));
  }
  if (runtimeState?.workerState) {
    runtimeState.workerState = sanitizeWorkerState({
      ...runtimeState.workerState,
      seedChatLog: normalized,
      updatedAt: Date.now(),
    });
    sessionCoordinator?.setWorkerContext(toSharedWorkerContext(runtimeState.workerState));
  }
}

function syncActiveTaskRecordFromRuntimeState(): void {
  if (!runtimeState || !taskOrchestrator) return;
  const activeTask = taskOrchestrator.getActiveTask();
  if (!activeTask) return;
  const activeTaskState = stateFromLegacyStatus(
    runtimeState.activeTask?.status || 'running',
    runtimeState.activeTask?.boundaryReason,
  );
  const runtimeMessages = sanitizeUiMessages(runtimeState.uiMessages);
  const runtimeTimeline = sanitizeTimelineEvents(runtimeState.timeline);
  const latestAssistant = [...runtimeMessages].reverse().find(message => message.role === 'assistant');
  const normalizedWorkerState = sanitizeWorkerState(runtimeState.workerState);
  const normalizedPendingRun = sanitizePendingRun(runtimeState.pendingRun);
  const normalizedBoundaryId =
    normalizeTaskBoundaryId(normalizedPendingRun?.taskBoundaryId)
    || normalizeTaskBoundaryId(normalizedWorkerState?.taskBoundaryId)
    || normalizeTaskBoundaryId(activeTask.boundaryId)
    || resolveCurrentTaskBoundaryCandidate()
    || createTaskBoundaryId();
  const normalizedTabScope = sanitizeTaskTabScope(runtimeState.taskTabScope, normalizedBoundaryId);
  const normalizedTransientStatus = sanitizeTransientStatus(runtimeState.transientStatus, {
    runId: normalizedPendingRun?.id,
    taskId: activeTask.taskId,
  });
  const normalizedSeedChatLog = sanitizeChatLogEntries(
    activeTask.seedChatLog?.length ? activeTask.seedChatLog : normalizedWorkerState?.seedChatLog,
  );

  taskOrchestrator.updateTask(activeTask.taskId, task => ({
    ...task,
    state: activeTaskState,
    boundaryId: normalizedBoundaryId,
    startedAt: Number(runtimeState?.activeTask?.startedAt) || task.startedAt,
    endedAt: Number(runtimeState?.activeTask?.endedAt) || undefined,
    lastUserAt: Number(runtimeState?.activeTask?.lastUserAt) || task.lastUserAt,
    lastAssistantAt: Number(runtimeState?.activeTask?.lastAssistantAt) || task.lastAssistantAt,
    uiMessages: runtimeMessages,
    timeline: runtimeTimeline,
    workerState: normalizedWorkerState,
    pendingRun: normalizedPendingRun,
    tabScope: normalizedTabScope,
    rootUserInput:
      normalizedWorkerState?.rootUserInput
      || normalizedPendingRun?.text
      || task.rootUserInput
      || lastUserInputText,
    summary: latestAssistant?.text || task.summary,
    seedChatLog: normalizedSeedChatLog,
    transientStatus: normalizedTransientStatus,
  }));
}

function syncRuntimeContinuationToMatchedTaskRecord(
  options?: { preferredTaskId?: string; allowCreate?: boolean; makeActive?: boolean },
): TaskRecord | undefined {
  if (!runtimeState || !taskOrchestrator) return undefined;

  const identity = resolveRuntimeContinuationIdentity(runtimeState, options?.preferredTaskId);
  let targetTask = findMatchingTaskRecord(taskOrchestrator.listTasks(), identity);

  if (!targetTask && options?.allowCreate !== false) {
    const boundaryId = identity.boundaryId || createTaskBoundaryId();
    const taskState = stateFromLegacyStatus(
      runtimeState.activeTask?.status || 'running',
      runtimeState.activeTask?.boundaryReason,
    );
    const created = taskOrchestrator.createTask('adopted_continuation', {
      taskId: identity.taskId,
      state: taskState,
      boundaryId,
      startedAt: Number(runtimeState.activeTask?.startedAt) || Date.now(),
      endedAt: Number(runtimeState.activeTask?.endedAt) || undefined,
      lastUserAt: Number(runtimeState.activeTask?.lastUserAt) || undefined,
      lastAssistantAt: Number(runtimeState.activeTask?.lastAssistantAt) || undefined,
      rootUserInput:
        sanitizeWorkerState(runtimeState.workerState)?.rootUserInput
        || sanitizePendingRun(runtimeState.pendingRun)?.text
        || lastUserInputText,
      seedChatLog: sanitizeChatLogEntries(runtimeState.workerState?.seedChatLog),
      tabIds: sanitizeTaskTabScope(runtimeState.taskTabScope, boundaryId)?.touchedTabIds || [],
    });
    targetTask = created;
  }

  if (!targetTask) return undefined;

  if (options?.makeActive !== false && taskOrchestrator.getActiveTaskId() !== targetTask.taskId) {
    taskOrchestrator.switchActiveTask(targetTask.taskId);
  }

  runtimeState.activeTaskId = taskOrchestrator.getActiveTaskId() || targetTask.taskId;
  runtimeState.activeTask = sanitizeTask(
    {
      ...(runtimeState.activeTask || createDefaultTaskState('adopted_continuation')),
      taskId: runtimeState.activeTaskId,
    },
    createDefaultTaskState('adopted_continuation', Date.now(), runtimeState.activeTaskId),
  );
  syncActiveTaskRecordFromRuntimeState();

  const persisted = taskOrchestrator.toPersistedState();
  runtimeState.tasks = persisted.tasks;
  runtimeState.activeTaskId = persisted.activeTaskId;
  runtimeState.taskOrder = persisted.taskOrder;
  syncOrchestratorConversationList();

  return taskOrchestrator.getTask(runtimeState.activeTaskId || targetTask.taskId);
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

let titlePrefixLabel = '[Rover]';

function applyTitlePrefix(label?: string): void {
  const enableTitlePrefix = (currentConfig?.ui as any)?.tabIndicator?.titlePrefix !== false;
  if (!enableTitlePrefix) return;

  const newLabel = label || '[Rover: Running]';
  const wasActive = titlePrefixActive;

  if (!wasActive) {
    originalDocumentTitle = document.title;
  }
  titlePrefixActive = true;
  titlePrefixLabel = newLabel;

  // Strip any existing Rover prefix before applying the new one
  const baseTitle = wasActive
    ? (document.title.replace(/^\[Rover[^\]]*\]\s*/, '') || originalDocumentTitle || '')
    : document.title;
  document.title = `${newLabel} ${baseTitle}`;

  // Observe title changes to re-apply prefix
  if (!titleObserver) {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver = new MutationObserver(() => {
        if (titlePrefixActive && !document.title.startsWith(titlePrefixLabel)) {
          const clean = document.title.replace(/^\[Rover[^\]]*\]\s*/, '');
          document.title = `${titlePrefixLabel} ${clean}`;
        }
      });
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }
  // Favicon badge (opt-in)
  if ((currentConfig?.ui as any)?.tabIndicator?.faviconBadge === true) {
    applyFaviconBadge();
  }
}

function removeTitlePrefix(): void {
  if (!titlePrefixActive) return;
  titlePrefixActive = false;
  if (titleObserver) {
    titleObserver.disconnect();
    titleObserver = null;
  }
  if (originalDocumentTitle !== undefined) {
    document.title = originalDocumentTitle;
    originalDocumentTitle = undefined;
  } else if (document.title.startsWith('[Rover] ')) {
    document.title = document.title.slice(8);
  }
  removeFaviconBadge();
}

function markTaskRunning(reason = 'worker_task_active', timestamp = Date.now()): void {
  // FSM-first: dispatch to orchestrator before kernel
  if (taskOrchestrator) {
    const activeTask = taskOrchestrator.getActiveTask();
    if (activeTask) {
      taskOrchestrator.dispatch(activeTask.taskId, { type: 'START', reason });
    }
  }
  // Kernel fallback: keep legacy state in sync
  applyTaskKernelCommand({
    type: 'ensure_running',
    reason,
    at: timestamp,
  });
  applyTitlePrefix();
}

function markTaskCompleted(reason = 'worker_task_complete', timestamp = Date.now()): void {
  // FSM-first: dispatch to orchestrator before kernel
  if (taskOrchestrator) {
    const activeTask = taskOrchestrator.getActiveTask();
    if (activeTask) {
      taskOrchestrator.dispatch(activeTask.taskId, { type: 'COMPLETE' });
    }
  }
  // Kernel fallback
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'completed',
    reason,
    at: timestamp,
  });
  removeTitlePrefix();
}

function markTaskFailed(reason = 'worker_task_failed', timestamp = Date.now()): void {
  // FSM-first: dispatch to orchestrator before kernel
  if (taskOrchestrator) {
    const activeTask = taskOrchestrator.getActiveTask();
    if (activeTask) {
      taskOrchestrator.dispatch(activeTask.taskId, { type: 'FAIL', error: reason });
    }
  }
  // Kernel fallback
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'failed',
    reason,
    at: timestamp,
  });
  removeTitlePrefix();
}

function markTaskEnded(reason = 'worker_task_ended', timestamp = Date.now()): void {
  // FSM-first: dispatch to orchestrator before kernel
  if (taskOrchestrator) {
    const activeTask = taskOrchestrator.getActiveTask();
    if (activeTask) {
      taskOrchestrator.dispatch(activeTask.taskId, { type: 'CANCEL', reason: 'ended' });
    }
  }
  // Kernel fallback
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'ended',
    reason,
    at: timestamp,
  });
  removeTitlePrefix();
}

function markTaskCancelled(reason = 'worker_task_cancelled', timestamp = Date.now()): void {
  // FSM-first: dispatch to orchestrator before kernel
  if (taskOrchestrator) {
    const activeTask = taskOrchestrator.getActiveTask();
    if (activeTask) {
      taskOrchestrator.dispatch(activeTask.taskId, { type: 'CANCEL', reason });
    }
  }
  // Kernel fallback
  applyTaskKernelCommand({
    type: 'terminal',
    terminal: 'cancelled',
    reason,
    at: timestamp,
  });
  removeTitlePrefix();
}

function hideTaskSuggestion(): void {
  pendingTaskSuggestion = null;
  ui?.setTaskSuggestion({ visible: false });
}

function showResumeTaskSuggestion(pendingRun: PersistedPendingRun): boolean {
  const runId = String(pendingRun?.id || '').trim();
  if (!runId) return false;
  if (hasRemoteExecutionOwner()) return false;
  const runText = String(pendingRun?.text || '').trim() || 'Continue task';
  if (
    pendingTaskSuggestion?.kind === 'resume_run'
    && pendingTaskSuggestion.runId === runId
  ) {
    return false;
  }
  pendingTaskSuggestion = {
    kind: 'resume_run',
    runId,
    text: runText,
    createdAt: Date.now(),
  };
  ui?.setTaskSuggestion({
    visible: true,
    text: 'Resume your interrupted task or cancel it?',
    primaryLabel: 'Resume',
    secondaryLabel: 'Cancel',
  });
  return true;
}

function clearResumeArtifacts(): void {
  crossDomainResumeActive = false;
  resumeContextValidated = false;
  clearPreservedWidgetOpenGuard();
  if (currentConfig?.siteId) {
    clearCrossDomainResumeCookie(currentConfig.siteId);
    clearNavigationHandoffBootstrap(currentConfig.siteId);
  }
  cloudCheckpointClient?.markDirty();
  cloudCheckpointClient?.syncNow({ push: true, pull: false });
}

function clearTaskUiState(): void {
  ui?.clearMessages();
  ui?.clearTimeline();
  ui?.setQuestionPrompt(undefined);
  hideTaskSuggestion();
}

type LocalRunAbandonOptions = {
  reason: string;
  statusText: string;
  runId?: string;
  cancelReason?: string;
  timelineTitle?: string;
  timelineDetail?: string;
  timelineStatus?: 'pending' | 'success' | 'error' | 'info';
  emitError?: { message: string; code?: string; scope?: string };
};

function abandonPendingRunLocally(options: LocalRunAbandonOptions): void {
  if (!runtimeState) return;
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }
  autoResumeAttempted = false;
  autoResumeSessionWaitAttempts = 0;
  crossDomainResumeActive = false;
  resumeContextValidated = false;
  if (runSafetyTimer) {
    clearTimeout(runSafetyTimer);
    runSafetyTimer = null;
  }

  const pending = sanitizePendingRun(runtimeState.pendingRun);
  const runId = String(options.runId || pending?.id || '').trim();
  if (runId) {
    addIgnoredRunId(runId);
    sessionCoordinator?.releaseWorkflowLock(runId);
    if (!hasLiveRemoteControllerForRun(runId)) {
      enqueueServerRunCancelRepair(runId, options.cancelReason || options.reason, { attemptImmediately: true });
    }
  }

  setPendingRun(undefined);
  sessionCoordinator?.setActiveRun(undefined);
  ui?.setRunning(false);
  ui?.setQuestionPrompt(undefined);
  hideTaskSuggestion();
  if (runtimeState.activeTask?.status === 'running') {
    markTaskCancelled(options.reason);
  } else {
    clearResumeArtifacts();
  }
  setUiStatus(undefined);
  recordTelemetryEvent('status', {
    event: 'local_run_abandoned',
    reason: options.reason,
    runId: runId || undefined,
  });
  if (options.timelineTitle) {
    appendTimelineEvent({
      kind: options.timelineStatus === 'error' ? 'error' : 'info',
      title: options.timelineTitle,
      detail: options.timelineDetail,
      status: options.timelineStatus || 'info',
    });
  }
  if (options.emitError?.message) {
    emit('error', {
      message: options.emitError.message,
      scope: options.emitError.scope || 'resume',
      code: options.emitError.code,
      runId: runId || undefined,
    });
  }
}

function resolveWorkerPendingBoundaryId(state: PersistedWorkerState | undefined): string | undefined {
  if (!state) return undefined;
  return normalizeTaskBoundaryId(state.pendingAskUser?.boundaryId || state.taskBoundaryId);
}

function dropMismatchedPendingAskUserForBoundary(
  state: PersistedWorkerState | undefined,
  expectedBoundaryId?: string,
): PersistedWorkerState | undefined {
  if (!state) return undefined;
  const expectedBoundary = normalizeTaskBoundaryId(expectedBoundaryId);
  if (!expectedBoundary) return state;
  const workerBoundary = normalizeTaskBoundaryId(state.taskBoundaryId);
  if (workerBoundary && workerBoundary !== expectedBoundary) return undefined;
  const pendingBoundary = normalizeTaskBoundaryId(state.pendingAskUser?.boundaryId);
  if (pendingBoundary && pendingBoundary !== expectedBoundary) return undefined;
  return state;
}

function syncQuestionPromptFromWorkerState(): void {
  if (runtimeState?.activeTask?.status !== 'running') {
    lastQuestionPromptFlushSignature = '';
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
    lastQuestionPromptFlushSignature = '';
    ui?.setQuestionPrompt(undefined);
    return;
  }
  const questions = normalizeAskUserQuestions(runtimeState?.workerState?.pendingAskUser?.questions);
  if (!questions.length) {
    lastQuestionPromptFlushSignature = '';
    if (activeLaunchBinding) {
      activeLaunchBinding.lastNeedsInputSignature = undefined;
    }
    ui?.setQuestionPrompt(undefined);
    return;
  }
  const promptSignature = `${normalizeTaskBoundaryId(pendingBoundaryId || currentBoundaryId) || ''}:${questions.map(question => `${question.key}:${question.query}`).join('|')}`;
  if (promptSignature !== lastQuestionPromptFlushSignature) {
    lastQuestionPromptFlushSignature = promptSignature;
    flushCheckpointCritical('question_prompt_boundary');
  }
  ui?.setQuestionPrompt({ questions });
  maybeEmitLaunchNeedsInput(questions);
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
  enqueueServerRunCancelRepair(pending.id, 'stale_pending_cleanup', { attemptImmediately: true });
  setPendingRun(undefined);
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
    // Timeline is UI affordance; avoid forcing checkpoint writes on every status tick.
    persistRuntimeState({ markCheckpointDirty: false });
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

function getRenderableTransientStatusText(
  status: PersistedTransientStatus | undefined,
  params?: { activeRunId?: string; activeTaskId?: string; taskStatus?: string },
): string | undefined {
  if (!status?.text) return undefined;
  if (params?.taskStatus && params.taskStatus !== 'running') return undefined;
  const activeRunId = String(params?.activeRunId || '').trim();
  const statusRunId = String(status.runId || '').trim();
  const activeTaskId = String(params?.activeTaskId || '').trim();
  const statusTaskId = String(status.taskId || '').trim();
  if (statusRunId && !activeRunId) return undefined;
  if (statusRunId && activeRunId && statusRunId !== activeRunId) return undefined;
  if (statusTaskId && activeTaskId && statusTaskId !== activeTaskId) return undefined;
  return status.text;
}

function getDisplayedStatusRunId(
  state: PersistedRuntimeState | null | undefined = runtimeState,
): string | undefined {
  const sharedState = sessionCoordinator?.getState();
  return resolveRenderableStatusRunId({
    localPendingRunId: state?.pendingRun?.id,
    sharedActiveRunId: sharedState?.activeRun?.runId,
    sharedTaskId: sharedState?.task?.taskId || sharedState?.activeTaskId,
    activeTaskId: state?.activeTask?.taskId || state?.activeTaskId,
  });
}

function setUiStatus(
  text: string | undefined,
  options?: { publishShared?: boolean; runId?: string; taskId?: string; stage?: string },
): void {
  const nextStatus = sanitizeTransientStatus(
    text
      ? {
          text,
          runId: options?.runId || runtimeState?.pendingRun?.id,
          taskId: options?.taskId || runtimeState?.activeTask?.taskId || getActiveTaskRecord()?.taskId,
          stage: options?.stage,
          ts: Date.now(),
        }
      : undefined,
    {
      runId: options?.runId || runtimeState?.pendingRun?.id,
      taskId: options?.taskId || runtimeState?.activeTask?.taskId || getActiveTaskRecord()?.taskId,
    },
  );
  const renderable = getRenderableTransientStatusText(nextStatus, {
    activeRunId: getDisplayedStatusRunId(runtimeState),
    activeTaskId: runtimeState?.activeTask?.taskId,
    taskStatus: runtimeState?.activeTask?.status,
  });
  if (renderable) {
    ui?.setStatus(renderable);
  } else {
    (ui as any)?.setStatus?.(undefined);
  }
  if (runtimeState) {
    runtimeState.uiStatus = nextStatus?.text;
    runtimeState.transientStatus = nextStatus;
    syncActiveTaskRecordFromRuntimeState();
    // Status text can update frequently while a run is active.
    persistRuntimeState({ markCheckpointDirty: false });
  }
  if (sessionCoordinator && options?.publishShared !== false) {
    sessionCoordinator.setStatus(nextStatus as any);
  }
}

function replayTransientStatusFromRuntime(state: PersistedRuntimeState | null | undefined = runtimeState): void {
  const renderable = getRenderableTransientStatusText(state?.transientStatus, {
    activeRunId: getDisplayedStatusRunId(state),
    activeTaskId: state?.activeTask?.taskId,
    taskStatus: state?.activeTask?.status,
  });
  if (renderable) {
    ui?.setStatus(renderable);
  } else {
    (ui as any)?.setStatus?.(undefined);
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
  syncMainWorldObserverPause();
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
    runtimeState.uiStatus = undefined;
    runtimeState.transientStatus = undefined;
    setServerAcceptedRunId(undefined);
    if (!shouldPreserveWidgetOpenForState(runtimeState)) {
      clearPreservedWidgetOpenGuard();
    }
  }
  applyPreservedWidgetOpenState(runtimeState);
  syncMainWorldObserverPause();
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

function arraysEqualNumbers(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function reconcileTaskTabScopeWithSessionTabs(options?: { persist?: boolean }): PersistedTaskTabScope | undefined {
  if (!runtimeState) return undefined;
  const scope = ensureTaskTabScopeSeed({ persist: false, appendSeed: false });
  if (!scope || !sessionCoordinator) return scope;

  const nowMs = Date.now();
  const sessionTabs = Array.isArray(sessionCoordinator.getState()?.tabs)
    ? sessionCoordinator.getState()!.tabs
    : [];
  const eligibleIds = new Set<number>();
  for (const tab of sessionTabs) {
    const tabId = Number(tab?.logicalTabId);
    if (!Number.isFinite(tabId) || tabId <= 0) continue;
    const freshnessTs = Math.max(
      Number(tab?.updatedAt) || 0,
      Number(tab?.openedAt) || 0,
      Number(tab?.detachedAt) || 0,
    );
    const ageMs = nowMs - freshnessTs;
    if (tab.runtimeId) {
      eligibleIds.add(tabId);
      continue;
    }
    if (tab.external) {
      if (ageMs <= TASK_SCOPE_DETACHED_EXTERNAL_MAX_AGE_MS) {
        eligibleIds.add(tabId);
      }
      continue;
    }
    if (tab.detachedReason === 'navigation_handoff') {
      if (ageMs <= TASK_SCOPE_NAV_HANDOFF_MAX_AGE_MS) {
        eligibleIds.add(tabId);
      }
      continue;
    }
    if (tab.detachedReason === 'opened_pending_attach') {
      if (ageMs <= TASK_SCOPE_PENDING_ATTACH_MAX_AGE_MS) {
        eligibleIds.add(tabId);
      }
      continue;
    }
  }

  const localTabId = Number(sessionCoordinator.getLocalLogicalTabId());
  const activeTabId = Number(sessionCoordinator.getActiveLogicalTabId());
  const fallbackSeed = Number(scope.seedTabId) > 0
    ? Number(scope.seedTabId)
    : resolveLocalSeedTabId();
  if (Number.isFinite(localTabId) && localTabId > 0) eligibleIds.add(localTabId);
  if (Number.isFinite(activeTabId) && activeTabId > 0) eligibleIds.add(activeTabId);
  if (eligibleIds.size === 0 && Number.isFinite(fallbackSeed) && fallbackSeed > 0) {
    eligibleIds.add(fallbackSeed);
  }

  const previousTouched = dedupePositiveTabIds(scope.touchedTabIds);
  const filteredTouched = previousTouched.filter(tabId => eligibleIds.has(tabId));
  const nextSeedTabId = eligibleIds.has(scope.seedTabId)
    ? scope.seedTabId
    : (
      Number.isFinite(localTabId) && localTabId > 0
        ? localTabId
        : (
          Number.isFinite(activeTabId) && activeTabId > 0
            ? activeTabId
            : fallbackSeed
        )
    );
  if (!filteredTouched.includes(nextSeedTabId)) filteredTouched.unshift(nextSeedTabId);
  const nextTouched = dedupePositiveTabIds(filteredTouched).slice(0, 24);
  const scopeChanged =
    nextSeedTabId !== scope.seedTabId
    || !arraysEqualNumbers(nextTouched, previousTouched);
  if (!scopeChanged) return scope;

  const removedTabIds = previousTouched.filter(tabId => !nextTouched.includes(tabId));
  const nextScope: PersistedTaskTabScope = {
    ...scope,
    seedTabId: nextSeedTabId,
    touchedTabIds: nextTouched.length ? nextTouched : [nextSeedTabId],
    updatedAt: Date.now(),
  };
  runtimeState.taskTabScope = nextScope;
  if (options?.persist !== false) persistRuntimeState();
  recordTelemetryEvent('status', {
    event: 'scoped_tab_reconciled',
    removedTabIds,
    scopedTabIds: nextScope.touchedTabIds,
    seedTabId: nextScope.seedTabId,
  });
  return nextScope;
}

function getTaskScopedTabIds(): number[] {
  const scope = reconcileTaskTabScopeWithSessionTabs({ persist: false })
    || ensureTaskTabScopeSeed({ persist: false, appendSeed: false });
  if (!scope) return [resolveLocalSeedTabId()];
  const touched = dedupePositiveTabIds(scope.touchedTabIds);
  return touched.length ? touched : [scope.seedTabId];
}

function toWorkerTaskTabScopePayload(): { boundaryId: string; seedTabId: number; touchedTabIds: number[] } | undefined {
  const scope = reconcileTaskTabScopeWithSessionTabs({ persist: false })
    || ensureTaskTabScopeSeed({ persist: false, appendSeed: false });
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
  let prevInput = lastCompletedTaskInput;
  let prevOutput = lastCompletedTaskSummary;
  let prevCompletedAt = lastCompletedTaskAt;
  let prevMessages: Array<{ role: 'user' | 'assistant' | 'system'; text?: string; ts?: number }> | undefined;
  let effectiveStatus = previousTaskStatus;

  if (taskOrchestrator) {
    const tasks = taskOrchestrator.listTasks();
    const activeTaskId = taskOrchestrator.getActiveTask()?.taskId;
    const localLogicalTabId = sessionCoordinator?.getLocalLogicalTabId();
    const terminalTasks = tasks
      .filter(task =>
        task.taskId !== activeTaskId
        && (task.state === 'completed' || task.state === 'cancelled')
        && !!task.endedAt,
      )
      .sort((a, b) => (Number(b.endedAt) || 0) - (Number(a.endedAt) || 0));
    const lineageTasks = Number.isFinite(Number(localLogicalTabId)) && Number(localLogicalTabId) > 0
      ? terminalTasks.filter(task => Array.isArray(task.tabIds) && task.tabIds.includes(Number(localLogicalTabId)))
      : terminalTasks;
    const prevTask = lineageTasks[0];
    if (prevTask) {
      prevInput = prevTask.rootUserInput || prevInput;
      prevOutput = prevTask.summary || prevOutput;
      prevCompletedAt = prevTask.endedAt || prevCompletedAt;
      prevMessages = prevTask.uiMessages.map(message => ({
        role: message.role,
        text: message.text,
        ts: message.ts,
      }));
      effectiveStatus = prevTask.state as PersistedTaskState['status'];
    }
  }
  const followupCfg = currentConfig?.task?.followup;
  const decision = buildHeuristicFollowupChatLog({
    mode: followupCfg?.mode,
    previousTaskStatus: effectiveStatus,
    previousTaskMessages: prevMessages,
    previousTaskUserInput: prevInput,
    previousTaskAssistantOutput: prevOutput,
    previousTaskCompletedAt: prevCompletedAt,
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

// On-demand external context prefetch cache
const externalContextCache = new Map<string, { data: any; ts: number }>();
const EXTERNAL_CONTEXT_CACHE_TTL = EXTERNAL_CONTEXT_CACHE_MAX_TTL;

async function fetchAndCacheExternalContext(targetUrl: string): Promise<void> {
  if (externalContextCache.has(targetUrl)) {
    const cached = externalContextCache.get(targetUrl)!;
    if (Date.now() - cached.ts < EXTERNAL_CONTEXT_CACHE_TTL) return;
    externalContextCache.delete(targetUrl);
  }
  // Evict expired entries
  const now = Date.now();
  for (const [key, entry] of externalContextCache) {
    if (now - entry.ts >= EXTERNAL_CONTEXT_CACHE_TTL) externalContextCache.delete(key);
  }
  const runId = runtimeState?.pendingRun?.id;
  if (!runId || !roverServerRuntime) return;
  const result = await roverServerRuntime.fetchExternalContext({
    runId,
    url: targetUrl,
    source: 'direct_url',
  });
  if (result) {
    externalContextCache.set(targetUrl, { data: result, ts: Date.now() });
    evictOldestMapEntry(externalContextCache, MAX_EXTERNAL_CONTEXT_CACHE_ENTRIES);
  }
}

function getExternalContextFromCache(url: string): any | undefined {
  const cached = externalContextCache.get(url);
  if (!cached) return undefined;
  if (Date.now() - cached.ts >= EXTERNAL_CONTEXT_CACHE_TTL) {
    externalContextCache.delete(url);
    return undefined;
  }
  return cached.data;
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
    // Check on-demand prefetch cache first
    const cachedContext = getExternalContextFromCache(targetUrl);
    if (cachedContext) {
      return cachedContext;
    }

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

let lastBoundaryConfigJson = '';

function postWorkerBoundaryConfig(extra?: Record<string, unknown>): void {
  if (!worker) return;
  const config = buildWorkerBoundaryConfig(extra);
  const json = JSON.stringify(config);
  if (json === lastBoundaryConfigJson) return;
  lastBoundaryConfigJson = json;
  worker.postMessage({ type: 'update_config', config });
}

function postRun(
  text: string,
  options?: {
    runId?: string;
    resume?: boolean;
    preserveHistory?: boolean;
    seedChatLog?: FollowupChatEntry[];
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
  const canonicalTaskInput =
    options?.askUserAnswers
      ? resolveCanonicalTaskInputForRun(runId)
      : undefined;
  const persistedRunText = canonicalTaskInput || trimmed;
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
  const seedChatLog = sanitizeChatLogEntries(
    Array.isArray(options?.seedChatLog) ? options.seedChatLog : getActiveTaskSeedChatLog(),
  );

  agentNavigationPending = false;
  setPendingRun({
    id: runId,
    text: persistedRunText,
    startedAt: Date.now(),
    attempts: resume ? previousAttempts + 1 : 0,
    autoResume: options?.autoResume !== false,
    taskBoundaryId: boundaryForRun,
    resumeRequired: false,
    resumeReason: undefined,
  });
  markTaskRunning(resume ? 'worker_task_resumed' : 'worker_task_active');

  lastUserInputText = persistedRunText;
  if (runtimeState) {
    runtimeState.workerState = sanitizeWorkerState({
      ...(runtimeState.workerState || {}),
      taskBoundaryId: boundaryForRun,
      rootUserInput: runtimeState.workerState?.rootUserInput || persistedRunText,
      seedChatLog,
      history: runtimeState.workerState?.history || [],
      plannerHistory: runtimeState.workerState?.plannerHistory || [],
      agentPrevSteps: runtimeState.workerState?.agentPrevSteps || [],
      updatedAt: Date.now(),
    });
    sessionCoordinator?.setWorkerContext(toSharedWorkerContext(runtimeState.workerState));
  }
  setActiveTaskSeedChatLog(seedChatLog);
  sessionCoordinator?.acquireWorkflowLock(runId);
  sessionCoordinator?.setActiveRun({ runId, text: persistedRunText });
  worker.postMessage({
    type: 'run',
    text: trimmed,
    runId,
    trajectoryId: runtimeState?.workerState?.trajectoryId,
    resume,
    preserveHistory: !!options?.preserveHistory,
    seedChatLog,
    routing: options?.routing,
    askUserAnswers: options?.askUserAnswers,
    scopedTabIds,
    taskTabScope: toWorkerTaskTabScopePayload(),
  });

  if (runSafetyTimer) clearTimeout(runSafetyTimer);
  const safetyRunId = runId;
  runSafetyTimer = setTimeout(() => {
    if (runtimeState?.pendingRun?.id === safetyRunId) {
      abandonPendingRunLocally({
        reason: 'run_timeout_terminal',
        statusText: 'Task timed out.',
        runId: safetyRunId,
        cancelReason: 'run_timeout_terminal',
        timelineTitle: 'Run timed out',
        timelineDetail: 'Task timed out after 5 minutes with no response.',
        timelineStatus: 'error',
        emitError: {
          message: 'Run safety timeout',
          scope: 'run_timeout',
          code: 'RUN_TIMEOUT',
        },
      });
      appendUiMessage('system', 'Task timed out after 5 minutes with no response.', true);
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
  const providerSeedChatLog = shouldStartFreshTask
    ? await resolvePromptContextEntries({
      userText: trimmed,
      isFreshTask: true,
      pageUrl: window.location.href,
      taskId: String(runtimeState?.activeTask?.taskId || '').trim() || undefined,
      taskBoundaryId: normalizeTaskBoundaryId(currentTaskBoundaryId),
      visitorId: resolvedVisitorId,
      visitor: resolvedVisitor,
    })
    : [];
  const seedChatLog = sanitizeChatLogEntries([
    ...providerSeedChatLog,
    ...(followupChatDecision.chatLog || []),
  ]);
  recordTelemetryEvent('status', {
    event: 'task_boundary_decision',
    startFreshTask: shouldStartFreshTask,
    askUserContinuation: shouldContinueAskUserBoundary,
    pendingAskUserQuestionCount: pendingQuestionCount,
    activeTaskStatus: activeTaskStatus || 'none',
  });
  recordTelemetryEvent('status', {
    event: 'followup_chat_cue',
    attached: seedChatLog.length > 0,
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

    // Multi-task: if active task is running, archive it to orchestrator before creating new
    if (taskOrchestrator && activeTaskStatus === 'running') {
      const currentActiveTask = taskOrchestrator.getActiveTask();
      if (currentActiveTask) {
        // Save current task's UI state before switching
        currentActiveTask.uiMessages = runtimeState?.uiMessages || [];
        currentActiveTask.timeline = runtimeState?.timeline || [];
        currentActiveTask.rootUserInput = currentActiveTask.rootUserInput || lastUserInputText;
      }
    }

    newTask({ reason: autoReason, clearUi: true });

    // Set rootUserInput on the task already created by newTask() via orchestrator
    if (taskOrchestrator) {
      const activeTask = taskOrchestrator.getActiveTask();
      if (activeTask) {
        activeTask.rootUserInput = trimmed;
        activeTask.seedChatLog = seedChatLog;
      }
      syncOrchestratorConversationList();
    }

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
    seedChatLog,
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
  abandonPendingRunLocally({
    reason,
    statusText: statusText || reason,
    cancelReason: reason,
  });
}

function hasLiveRemoteControllerForRun(runId: string): boolean {
  const pendingRunId = String(runId || '').trim();
  if (!pendingRunId) return false;
  const lockInfo = sessionCoordinator?.getWorkflowLockInfo();
  if (!lockInfo?.locked || !lockInfo.holderRuntimeId || lockInfo.holderRuntimeId === runtimeId) return false;
  if (lockInfo.runId !== pendingRunId) return false;
  const remoteTab = sessionCoordinator
    ?.listTabs({ scope: 'all' })
    .find(tab => tab.runtimeId === lockInfo.holderRuntimeId);
  if (!remoteTab) return false;
  return Number(remoteTab.updatedAt) > Date.now() - 5_000;
}

function scheduleAutoResumeRetry(delayMs = 450, options?: { overridePolicyAction?: AutoResumePolicyActionOverride }): void {
  if (autoResumeRetryTimer) return;
  autoResumeRetryTimer = setTimeout(() => {
    autoResumeRetryTimer = null;
    maybeAutoResumePendingRun(options);
  }, Math.max(120, delayMs));
}

type AutoResumePolicyActionOverride = 'auto_resume' | 'prompt_resume' | 'cancel_resume';

function dispatchPendingRunResume(pendingRun: PersistedPendingRun, source: string): void {
  autoResumeAttempted = true;
  crossDomainResumeActive = false;
  resumeContextValidated = false;
  hideTaskSuggestion();
  setUiStatus('Resuming interrupted task...');
  const resumeText = pendingRun.text?.trim() || runtimeState?.workerState?.rootUserInput?.trim() || lastUserInputText?.trim() || 'Continue the current task on this page';
  recordTelemetryEvent('status', {
    event: 'resume_dispatch',
    source,
    runId: pendingRun.id,
  });
  postRun(resumeText, {
    runId: pendingRun.id,
    resume: true,
    appendUserMessage: false,
    autoResume: true,
  });
}

function maybeAutoResumePendingRun(options?: { overridePolicyAction?: AutoResumePolicyActionOverride }): void {
  if (!runtimeState?.pendingRun) {
    if (autoResumeRetryTimer) {
      clearTimeout(autoResumeRetryTimer);
      autoResumeRetryTimer = null;
    }
    autoResumeSessionWaitAttempts = 0;
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
  if (currentMode === 'observer') {
    return;
  }

  if (autoResumeAttempted) {
    return;
  }
  if (!workerReady || !worker) {
    scheduleAutoResumeRetry(250, options);
    return;
  }
  const activeTaskStatus = runtimeState.activeTask?.status;
  if (isTerminalTaskStatus(activeTaskStatus)) {
    clearPendingRunForResume('terminal_task', 'Previous task already ended.');
    return;
  }
  if (!canAutoResumePendingRun(activeTaskStatus)) {
    return;
  }
  if (!pending.autoResume) {
    return;
  }
  const resumeMode = normalizeTaskResumeMode(currentConfig?.task?.resume?.mode);
  if (resumeMode !== 'crash_only') {
    clearPendingRunForResume('unsupported_resume_mode', 'Previous task dismissed.');
    return;
  }
  if (pending.resumeRequired !== true) {
    // If the run is recent (within TTL) the worker was likely killed by
    // same-scope navigation (page reload). Promote to resumeRequired so the
    // normal resume flow picks it up immediately — no handoff cookie needed
    // because localStorage is available on same-origin, and the cross-domain
    // cookie handles subdomain reloads.
    const pendingAgeMs = Date.now() - Number(pending.startedAt || 0);
    const ttlMs = normalizeTaskResumeTtlMs(currentConfig?.task?.resume?.ttlMs);
    if (Number.isFinite(pendingAgeMs) && pendingAgeMs >= 0 && pendingAgeMs < ttlMs) {
      pending.resumeRequired = true;
      pending.resumeReason = pending.resumeReason || 'worker_interrupted';
      setPendingRun(pending);
    } else {
      if (autoResumeRetryTimer) {
        clearTimeout(autoResumeRetryTimer);
        autoResumeRetryTimer = null;
      }
      autoResumeSessionWaitAttempts = 0;
      hideTaskSuggestion();
      return;
    }
  }

  const autoResumePolicy = normalizeTaskAutoResumePolicy(currentConfig?.task?.autoResumePolicy);
  const hasLiveRemoteController = hasLiveRemoteControllerForRun(pending.id);
  let policyAction = resolveAutoResumePolicyAction({
    policy: autoResumePolicy,
    resumeRequired: pending.resumeRequired === true,
    hasLiveRemoteController,
  });
  // Navigation-triggered resumes: the user initiated navigation through the agent
  // (goto_url), so skip the confirm prompt and auto-resume.
  if (
    policyAction === 'prompt_resume'
    && (
      pending.resumeReason === 'agent_navigation'
      || pending.resumeReason === 'cross_host_navigation'
      || pending.resumeReason === 'worker_interrupted'
      || pending.resumeReason === 'page_reload'
    )
  ) {
    policyAction = 'auto_resume';
  }
  if (
    options?.overridePolicyAction
    && policyAction !== 'defer_remote_owner'
    && policyAction !== 'noop'
  ) {
    policyAction = options.overridePolicyAction;
  }
  if (policyAction === 'defer_remote_owner') {
    scheduleAutoResumeRetry(650, options);
    return;
  }
  if (policyAction === 'cancel_resume') {
    clearPendingRunForResume('resume_policy_never', 'Previous task cancelled by resume policy.');
    appendTimelineEvent({
      kind: 'info',
      title: 'Resume cancelled',
      detail: 'Auto-resume policy is set to never, so the interrupted run was cancelled.',
      status: 'info',
    });
    return;
  }

  if (!resumeContextValidated && canValidateResumeFromPersistedHandoff(pending)) {
    resumeContextValidated = true;
  }
  // Same-scope navigation resume: if the pending run was loaded from
  // localStorage (same origin) or promoted from worker_interrupted /
  // agent_navigation (same-host only), no cross-domain handoff context
  // is needed — validate immediately.
  if (!resumeContextValidated && (
    pending.resumeReason === 'worker_interrupted'
    || pending.resumeReason === 'agent_navigation'
    || pending.resumeReason === 'page_reload'
  )) {
    resumeContextValidated = true;
  }
  if (!resumeContextValidated && shouldDelayResumeForPendingNavigation(pending)) {
    scheduleAutoResumeRetry(320, options);
    return;
  }
  if (!resumeContextValidated) {
    // Force-resume: better to continue with stale/empty context than to stall.
    // The agent will re-analyze the current page with fresh getPageData().
    resumeContextValidated = true;
  }
  if (hasLiveRemoteController) {
    scheduleAutoResumeRetry(650, options);
    return;
  }
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }

  // Only block until the server session is established (!sessionReady).
  // Once sessionReady=true, onSession has fired and sent update_config with the
  // token to the worker. The worker-side callExtensionRouter has its own 2.4s
  // token wait — no need to stall the SDK-side resume for up to 60s.
  // For manual resume (Resume button click), skip the wait entirely.
  if (!sessionReady && !options?.overridePolicyAction) {
    autoResumeSessionWaitAttempts += 1;
    recordTelemetryEvent('status', {
      event: 'resume_blocked_no_session',
      reason: 'session_not_ready',
      attempt: autoResumeSessionWaitAttempts,
      runId: pending.id,
    });
    if (autoResumeSessionWaitAttempts < MAX_AUTO_RESUME_SESSION_WAIT_ATTEMPTS) {
      setUiStatus('Preparing secure resume...');
      const retryDelay = Math.min(2_000, 240 + (autoResumeSessionWaitAttempts * 160));
      scheduleAutoResumeRetry(retryDelay, options);
      return;
    }
    autoResumeSessionWaitAttempts = 0;
    crossDomainResumeActive = false;
    // Force-resume without server session. The worker will get a session error
    // on the first extensionRouter call and can retry then. Better than stalling.
    sessionReady = true;
    // Fall through to dispatch resume below
  }
  autoResumeSessionWaitAttempts = 0;

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

  if (policyAction === 'prompt_resume') {
    const shown = showResumeTaskSuggestion(pending);
    if (shown) {
      setUiStatus('Resume available. Choose Resume or Cancel.');
      recordTelemetryEvent('status', {
        event: 'resume_prompt_shown',
        runId: pending.id,
      });
    }
    return;
  }

  dispatchPendingRunResume(
    pending,
    options?.overridePolicyAction === 'auto_resume'
      ? 'manual_resume_confirm'
      : `policy_${autoResumePolicy}`,
  );
}

function shouldAdoptIncomingRuntimeState(params: {
  localState: PersistedRuntimeState;
  incomingState: PersistedRuntimeState;
  allowRicherIncomingOnResume?: boolean;
}): boolean {
  const adopt = shouldAdoptCheckpointState({
    localUpdatedAt: Number(params.localState.updatedAt) || 0,
    incomingUpdatedAt: Number(params.incomingState.updatedAt) || 0,
    localState: params.localState,
    incomingState: params.incomingState,
    crossDomainResumeActive: !!params.allowRicherIncomingOnResume && crossDomainResumeActive,
  });
  if (!adopt) return false;

  if (!params.allowRicherIncomingOnResume || !crossDomainResumeActive) {
    return true;
  }

  const summary = describeCheckpointContinuity({
    localState: params.localState,
    incomingState: params.incomingState,
  });
  if (summary.exactRunMatch || summary.exactBoundaryMatch) {
    return true;
  }

  const localHasIdentity = !!(summary.localRunId || summary.localBoundaryId);
  if (localHasIdentity) {
    return false;
  }

  return true;
}

function buildWorkerContinuityState(
  workerState: PersistedWorkerState | undefined,
  fallbackPendingRun?: PersistedPendingRun,
  taskStatus?: string,
  taskEpoch?: number,
  options?: { includePendingIdentity?: boolean },
): Parameters<typeof describeCheckpointContinuity>[0]['localState'] {
  const includePendingIdentity = options?.includePendingIdentity !== false;
  return {
    pendingRun: includePendingIdentity && fallbackPendingRun
      ? {
          id: fallbackPendingRun.id,
          resumeRequired: fallbackPendingRun.resumeRequired,
          taskBoundaryId: fallbackPendingRun.taskBoundaryId,
        }
      : undefined,
    activeTask: taskStatus ? { status: taskStatus } : undefined,
    workerState,
    taskEpoch,
  };
}

function shouldAdoptIncomingWorkerState(params: {
  localWorkerState: PersistedWorkerState | undefined;
  incomingWorkerState: PersistedWorkerState | undefined;
  fallbackPendingRun?: PersistedPendingRun;
  taskStatus?: string;
  taskEpoch?: number;
  localUpdatedAt?: number;
  incomingUpdatedAt?: number;
  allowRicherIncomingOnResume?: boolean;
}): boolean {
  if (!params.incomingWorkerState) return false;
  if (!params.localWorkerState) return true;
  return shouldAdoptCheckpointState({
    localUpdatedAt: Number(params.localUpdatedAt) || Number(params.localWorkerState.updatedAt) || 0,
    incomingUpdatedAt: Number(params.incomingUpdatedAt) || Number(params.incomingWorkerState.updatedAt) || 0,
    localState: buildWorkerContinuityState(
      params.localWorkerState,
      params.fallbackPendingRun,
      params.taskStatus,
      params.taskEpoch,
      { includePendingIdentity: true },
    ),
    incomingState: buildWorkerContinuityState(
      params.incomingWorkerState,
      undefined,
      params.taskStatus,
      params.taskEpoch,
      { includePendingIdentity: false },
    ),
    crossDomainResumeActive: !!params.allowRicherIncomingOnResume && crossDomainResumeActive,
  });
}

function isIncomingRuntimeStateCompatible(params: {
  localState: PersistedRuntimeState;
  incomingState: PersistedRuntimeState;
}): boolean {
  const localTask = sanitizeTask(params.localState.activeTask, createDefaultTaskState('compat_local'));
  if (localTask.status !== 'running') return true;

  const localEpoch = Math.max(1, Number(params.localState.taskEpoch) || 1);
  const incomingEpoch = Math.max(1, Number(params.incomingState.taskEpoch) || 1);
  if (incomingEpoch < localEpoch) return false;
  if (incomingEpoch > localEpoch) return true;

  const localBoundary = normalizeTaskBoundaryId(resolveExistingTaskBoundaryIdFromState(params.localState));
  const incomingBoundary = normalizeTaskBoundaryId(resolveExistingTaskBoundaryIdFromState(params.incomingState));
  if (localBoundary && incomingBoundary) return localBoundary === incomingBoundary;
  if (localBoundary && !incomingBoundary) return false;
  if (!localBoundary && incomingBoundary) return false;
  return true;
}

async function applyAsyncRuntimeStateHydration(key: string, fallbackKeys?: string[]): Promise<void> {
  if (!runtimeState) return;
  const loaded = await loadPersistedStateFromAsyncStore(key, fallbackKeys);
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
  if (!isIncomingRuntimeStateCompatible({ localState: runtimeState, incomingState: normalized })) {
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
  applyPreservedWidgetOpenState(runtimeState);
  syncCurrentTaskBoundaryId({ rotateIfMissing: !currentTaskBoundaryId });
  reconcileTaskTabScopeWithSessionTabs({ persist: false });
  syncRuntimeContinuationToMatchedTaskRecord({
    preferredTaskId: normalized.activeTaskId || normalized.activeTask?.taskId,
  });
  persistRuntimeState();

  if (ui) {
    ui.clearMessages();
    replayUiMessages(runtimeState.uiMessages);
    replayTimeline(runtimeState.timeline);
    replayTransientStatusFromRuntime(runtimeState);
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

let applyingCoordinatorState = false;

function applyCoordinatorState(state: SharedSessionState, source: 'local' | 'remote'): void {
  if (!runtimeState) return;
  if (applyingCoordinatorState) return;
  applyingCoordinatorState = true;
  try {

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
    const localMessagesSnapshot = runtimeState.uiMessages;
    const preservedLocalUserMessageCount = runtimeState.uiMessages.filter(message =>
      message.role === 'user'
      && message.sourceRuntimeId === runtimeId
      && !incomingMessageIds.has(message.id),
    ).length;
    if (preservedLocalUserMessageCount > 0) {
      recordTelemetryEvent('status', {
        event: 'local_message_preserved',
        count: preservedLocalUserMessageCount,
      });
    }
    const mergedMessages = mergeUiMessagesMonotonic(localMessagesSnapshot, incomingMessages);
    const uiMessagesChanged =
      mergedMessages.length !== localMessagesSnapshot.length
      || mergedMessages.some((message, index) => {
        const existing = localMessagesSnapshot[index];
        if (!existing) return true;
        return (
          existing.id !== message.id
          || existing.ts !== message.ts
          || existing.role !== message.role
          || existing.text !== message.text
        );
      });
    if (uiMessagesChanged) {
      runtimeState.uiMessages = mergedMessages;
      ui?.clearMessages();
      replayUiMessages(runtimeState.uiMessages);
    }

    const incomingTimeline = sanitizeTimelineEvents(state.timeline as SharedTimelineEvent[]);
    const localTimelineSnapshot = runtimeState.timeline;
    const mergedTimeline = mergeTimelineEventsMonotonic(localTimelineSnapshot, incomingTimeline);
    const timelineChanged =
      mergedTimeline.length !== localTimelineSnapshot.length
      || mergedTimeline.some((event, index) => {
        const existing = localTimelineSnapshot[index];
        if (!existing) return true;
        return (
          existing.id !== event.id
          || existing.ts !== event.ts
          || existing.kind !== event.kind
          || existing.title !== event.title
          || existing.detail !== event.detail
        );
      });
    if (timelineChanged) {
      runtimeState.timeline = mergedTimeline;
      replayTimeline(runtimeState.timeline);
    }

    setUiStatus(
      typeof (state as any).transientStatus?.text === 'string'
        ? String((state as any).transientStatus.text)
        : (typeof state.uiStatus === 'string' ? state.uiStatus : undefined),
      {
        publishShared: false,
        runId: (state as any).transientStatus?.runId || state.activeRun?.runId,
        taskId: (state as any).transientStatus?.taskId || state.task?.taskId,
        stage: (state as any).transientStatus?.stage,
      },
    );

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
      const remoteOwnsRun = String(state.activeRun.runtimeId || '').trim() !== '';
      const shouldStayObserverOnly =
        remoteOwnsRun
        || hasRemoteExecutionOwner()
        || resolveEffectiveExecutionMode(currentMode) === 'observer';
      if (shouldStayObserverOnly) {
        setPendingRun(undefined);
      } else {
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
      }
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
        && shouldAdoptIncomingWorkerState({
          localWorkerState: runtimeState.workerState,
          incomingWorkerState: incomingWorker,
          fallbackPendingRun: sanitizePendingRun(runtimeState.pendingRun),
          taskStatus: runtimeState.activeTask?.status,
          taskEpoch: runtimeState.taskEpoch,
          localUpdatedAt,
          incomingUpdatedAt,
          allowRicherIncomingOnResume: true,
        })
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
  applyPreservedWidgetOpenState(runtimeState);
  syncCurrentTaskBoundaryId();
  reconcileTaskTabScopeWithSessionTabs({ persist: false });
  if (workerReady && worker && currentMode === 'controller') {
    postWorkerBoundaryConfig();
  }
  syncMainWorldObserverPause();
  syncQuestionPromptFromWorkerState();
  runtimeState.activeTask = sanitizeTask(runtimeState.activeTask, createDefaultTaskState('implicit'));
  syncRuntimeContinuationToMatchedTaskRecord();

  // Sync task-tab mapping to session coordinator for task-aware tab pruning
  if (sessionCoordinator && taskOrchestrator) {
    const mapping = new Map<number, string>();
    for (const task of taskOrchestrator.listTasks()) {
      for (const tabId of task.tabIds) {
        mapping.set(tabId, task.taskId);
      }
    }
    sessionCoordinator.setTaskTabMapping(mapping);
  }

  // Sync tab bar with session coordinator tab state
  const widgetTabBarEnabled = (currentConfig?.ui as any)?.tabIndicator?.widgetTabBar !== false;
  if (ui && state.tabs && widgetTabBarEnabled) {
    const currentLogicalTabId = sessionCoordinator?.getLocalLogicalTabId();
    const activeLogicalTabId = sessionCoordinator?.getActiveLogicalTabId();
    const tabs = (state.tabs || [])
      .filter(t => t && typeof t.logicalTabId === 'number')
      .map(t => ({
        logicalTabId: t.logicalTabId,
        url: String(t.url || ''),
        title: typeof t.title === 'string' ? t.title : undefined,
        isActive: t.logicalTabId === activeLogicalTabId,
        isCurrent: t.logicalTabId === currentLogicalTabId,
        external: !!t.external,
        taskId: taskOrchestrator?.getTaskForTab(t.logicalTabId)?.taskId,
      }));
    // Only show tab bar when agent has opened extra tabs
    if (tabs.length > 1) {
      ui.setTabs(tabs);
    } else {
      ui.setTabs([]);
    }
  } else if (ui) {
    ui.setTabs([]);
  }

  if (source === 'local') return;
  persistRuntimeState();

  } finally {
    applyingCoordinatorState = false;
  }
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
    transientStatus: sanitizeTransientStatus(state.transientStatus ?? state.uiStatus, {
      runId: state.pendingRun?.id,
      taskId: state.activeTask?.taskId,
    }),
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
    tasks: state.tasks ? { ...state.tasks } : {},
    activeTaskId: state.activeTaskId,
    taskOrder: state.taskOrder ? [...state.taskOrder] : [],
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
  // Default is enabled when token + visitor prerequisites are available.
  if (cfg.checkpointing?.enabled === false) return false;
  if (!getRuntimeSessionToken(cfg)) return false;
  if (!resolvedVisitorId) return false;
  return true;
}

function buildCloudCheckpointPayload(): RoverCloudCheckpointPayload | null {
  if (!runtimeState || !currentConfig || !resolvedVisitorId) return null;
  const sharedState = sessionCoordinator?.getState();
  const runtimeSnapshot = cloneRuntimeStateForCheckpoint(runtimeState);
  const checkpointUpdatedAt = Math.max(
    Number(sharedState?.updatedAt || 0),
    Number(runtimeSnapshot.updatedAt || 0),
  );
  const updatedAt = checkpointUpdatedAt > 0 ? checkpointUpdatedAt : Date.now();

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
        if (!isIncomingRuntimeStateCompatible({ localState: runtimeState, incomingState })) {
          return;
        }
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
        applyPreservedWidgetOpenState(runtimeState);
        syncCurrentTaskBoundaryId();
        runtimeState.workerState = dropMismatchedPendingAskUserForBoundary(
          runtimeState.workerState,
          resolveCurrentTaskBoundaryCandidate(),
        );
        reconcileTaskTabScopeWithSessionTabs({ persist: false });
        syncRuntimeContinuationToMatchedTaskRecord({
          preferredTaskId: incomingState.activeTaskId || incomingState.activeTask?.taskId,
        });
        persistRuntimeState();

        replayTransientStatusFromRuntime(runtimeState);

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
    emit('checkpoint_token_missing', {
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
      shouldSync: () => currentMode === 'controller' && !crossDomainResumeActive && !shouldDeferBackgroundSync(),
      siteId: cfg.siteId,
      visitorId: resolvedVisitorId,
      ttlHours: cfg.checkpointing?.ttlHours ?? 1,
      flushIntervalMs: cfg.checkpointing?.flushIntervalMs,
      pullIntervalMs: cfg.checkpointing?.pullIntervalMs,
      minFlushIntervalMs: cfg.checkpointing?.minFlushIntervalMs,
      maxSnapshotBytes: normalizeStabilityByteLimit(
        cfg.stability?.maxSnapshotBytes,
        ROVER_V2_PERSIST_CAPS.snapshotBytes,
      ),
      shouldWrite: () => currentMode === 'controller' && !crossDomainResumeActive && !shouldDeferBackgroundSync(),
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
    syncCheckpointIdleMode();
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
      // Gate backend transport on controller role
      const wasController = isTransportController;
      isTransportController = effectiveRole === 'controller';
      if (wasController !== isTransportController) {
        if (isTransportController) {
          // Promoted to controller — activate transport
          syncMainWorldObserverPause(true);
          if (currentConfig) {
            void ensureRoverServerRuntime(currentConfig);
          }
        } else {
          // Demoted to observer — deactivate transport
          syncMainWorldObserverPause(true);
        }
      }
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
        reconcileTaskTabScopeWithSessionTabs({ persist: true });
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
    onTaskTabsExhausted: (taskId) => {
      if (taskOrchestrator) {
        taskOrchestrator.dispatch(taskId, { type: 'PAUSE', reason: 'all_tabs_closed' });
        syncOrchestratorConversationList();
        persistRuntimeState();
        ui?.showPausedTaskBanner({
          taskId,
          rootUserInput: taskOrchestrator.getTask(taskId)?.rootUserInput || 'Task',
        });
      }
    },
  });

  sessionCoordinator.onSessionTokenReceived = (token, expiresAt) => {
    if (!isTransportController) {
      updateRuntimeSessionToken(token, expiresAt);
    }
  };

  sessionCoordinator.onProjectionReceived = (projection) => {
    if (!isTransportController && projection) {
      applyServerProjection(projection);
    }
  };

  const startupHandoff = getUnconsumedNavigationHandoff();
  sessionCoordinator.start(toSharedNavigationHandoff(startupHandoff));
  ensureTaskTabScopeSeed({ persist: true, appendSeed: false });
  reconcileTaskTabScopeWithSessionTabs({ persist: true });
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
      evictOldestMapEntry(latestAssistantByRunId, MAX_ASSISTANT_BY_RUN_ENTRIES);
    }
    appendUiMessage('assistant', text, true, { blocks });
    appendTimelineEvent({
      kind: 'tool_result',
      title: 'Assistant update',
      detail: text,
      detailBlocks: blocks,
      status: 'success',
    });
    enqueueLaunchRuntimeEvent('assistant_output', {
      text,
      blocks,
    }, {
      immediate: true,
      runId: typeof msg.runId === 'string' ? msg.runId : undefined,
    });
    return;
  }

  if (msg.type === 'status') {
    const stage = normalizeStatusStage(msg.stage);
    const message = msg.message ? String(msg.message) : undefined;
    const compactThought = msg.compactThought ? String(msg.compactThought) : undefined;
    const signature = buildStatusSignature(message, stage, compactThought);

    if (message) {
      setUiStatus(message, {
        runId: typeof msg.runId === 'string' ? msg.runId : runtimeState?.pendingRun?.id,
        taskId: runtimeState?.activeTask?.taskId,
        stage,
      });
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
    enqueueLaunchRuntimeEvent('status_update', buildLaunchStatusEventData(msg), {
      runId: typeof msg.runId === 'string' ? msg.runId : undefined,
    });
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
    enqueueLaunchRuntimeEvent('tool_start', buildLaunchToolStartData(msg), {
      runId: typeof msg.runId === 'string' ? msg.runId : undefined,
    });
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
    enqueueLaunchRuntimeEvent('tool_result', buildLaunchToolResultData(msg), {
      runId: typeof msg.runId === 'string' ? msg.runId : undefined,
    });
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
    enqueueLaunchRuntimeEvent('error', {
      message: String(msg.message || 'unknown'),
    }, {
      immediate: true,
      runId: typeof msg.runId === 'string' ? msg.runId : undefined,
    });
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
      // Route worker state to correct TaskRecord via boundaryId
      if (taskOrchestrator && incomingWorkerState?.taskBoundaryId) {
        const targetTask = taskOrchestrator.getTaskByBoundaryId(incomingWorkerState.taskBoundaryId);
        if (targetTask) {
          targetTask.workerState = runtimeState.workerState;
          if (activeRunId) {
            targetTask.pendingRun = runtimeState.pendingRun;
          }
        }
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
    // Route run_started to correct TaskRecord via boundaryId
    if (taskOrchestrator && messageTaskBoundaryId) {
      const targetTask = taskOrchestrator.getTaskByBoundaryId(messageTaskBoundaryId);
      if (targetTask) {
        targetTask.pendingRun = runtimeState?.pendingRun;
        taskOrchestrator.dispatch(targetTask.taskId, { type: 'START' });
      }
    }
    enqueueLaunchRuntimeEvent('state_transition', {
      status: 'running',
      mode: runtimeState?.lastRoutingDecision?.mode,
      reason: msg.resume ? 'run_resumed' : 'run_started',
    }, {
      immediate: true,
      runId: typeof msg.runId === 'string' ? msg.runId : undefined,
    });
    emit('run_started', buildPublicRunStartedPayload(msg));
    return;
  }

  if (msg.type === 'run_completed' || msg.type === 'run_state_transition') {
    lastStatusSignature = '';
    autoResumeAttempted = false;
    autoResumeSessionWaitAttempts = 0;
    const completionState = normalizeRunCompletionState(msg);
    const publicRunPayload = buildPublicRunLifecyclePayload(msg, completionState);
    const terminalState = completionState.terminalState;
    const continuationReason = completionState.continuationReason;
    const launchTransitionStatus: 'running' | 'awaiting_user' | 'completed' | 'failed' =
      completionState.needsUserInput
        ? 'awaiting_user'
        : terminalState === 'completed'
          ? 'completed'
          : terminalState === 'failed' || msg?.ok === false
            ? 'failed'
            : 'running';
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
      hideTaskSuggestion();
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
        enqueueServerRunCancelRepair(completedRunId, 'worker_run_failed', { attemptImmediately: true });
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
          setUiStatus(undefined);
        } else {
          // Safety net: terminal failure should still mark task ended even if
          // contextResetRecommended was somehow false. This prevents false auto-resume.
          markTaskFailed('worker_run_failed_terminal');
          setUiStatus(undefined);
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
          enqueueServerRunCancelRepair(completedRunId, 'worker_terminal_failed', { attemptImmediately: true });
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
          setUiStatus(undefined);
        } else {
          // Safety net: terminal failure should still mark task ended even if
          // contextResetRecommended was somehow false. This prevents false auto-resume.
          markTaskFailed('worker_run_failed_terminal');
          setUiStatus(undefined);
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
        setUiStatus(undefined);
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
          // FSM-first: dispatch ASK_USER to orchestrator before kernel
          if (taskOrchestrator) {
            const activeTask = taskOrchestrator.getActiveTask();
            if (activeTask) {
              taskOrchestrator.dispatch(activeTask.taskId, { type: 'ASK_USER' });
            }
          }
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
          setUiStatus(undefined);
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
    // Route run_completed to correct TaskRecord via boundaryId
    if (taskOrchestrator && messageTaskBoundaryId) {
      const targetTask = taskOrchestrator.getTaskByBoundaryId(messageTaskBoundaryId);
      if (targetTask) {
        if (isTerminalRunCompletion) {
          const fsmEvent: TaskEvent = terminalState === 'completed'
            ? { type: 'COMPLETE' }
            : { type: 'FAIL', error: typeof msg.error === 'string' ? msg.error : undefined };
          taskOrchestrator.dispatch(targetTask.taskId, fsmEvent);
          taskOrchestrator.releaseWorker(targetTask.taskId);
        } else if (completionState.continuationReason === 'awaiting_user') {
          taskOrchestrator.dispatch(targetTask.taskId, { type: 'ASK_USER' });
        }
      }
    }
    enqueueLaunchRuntimeEvent('state_transition', {
      status: launchTransitionStatus,
      mode:
        msg?.route?.mode === 'act' || msg?.route?.mode === 'planner'
          ? msg.route.mode
          : runtimeState?.lastRoutingDecision?.mode,
      reason:
        typeof msg?.error === 'string'
          ? msg.error
          : continuationReason || terminalState,
      terminalState,
    }, {
      immediate: isTerminalRunCompletion || completionState.needsUserInput,
      runId: completedRunId,
    });
    if (completionState.needsUserInput) {
      const launchQuestions = completionState.questions || normalizeAskUserQuestions(msg.questions);
      if (launchQuestions.length) {
        maybeEmitLaunchNeedsInput(launchQuestions);
      }
    }
    if (isTerminalRunCompletion) {
      finalizeLaunchObservationForRun(completedRunId);
    }
    emit('run_state_transition', publicRunPayload);
    if (msg.type === 'run_completed' || isTerminalRunCompletion) {
      emit('run_completed', publicRunPayload);
    }
    syncOrchestratorConversationList();
    return;
  }

  if (msg.type === 'ready') {
    workerReady = true;
    setUiStatus(undefined);
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
      sharedWorkerState
      && shouldAdoptIncomingWorkerState({
        localWorkerState,
        incomingWorkerState: sharedWorkerState,
        fallbackPendingRun: sanitizePendingRun(runtimeState?.pendingRun),
        taskStatus: runtimeState?.activeTask?.status,
        taskEpoch: runtimeState?.taskEpoch,
        localUpdatedAt,
        incomingUpdatedAt: sharedUpdatedAt,
        allowRicherIncomingOnResume: true,
      })
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
      // Schedule a fallback resume check in case hydrated message is delayed
      // (the hydrated handler will also call it, but this covers race conditions)
      setTimeout(() => {
        if (!autoResumeAttempted) maybeAutoResumePendingRun();
      }, 500);
    } else if (crossDomainResumeActive && cloudCheckpointClient) {
      // Cross-domain resume: worker has no local state. Trigger cloud checkpoint pull
      // before any push so lean bootstrap state cannot overwrite richer checkpoint data.
      // applyCloudCheckpointPayload will hydrate the worker and call maybeAutoResumePendingRun() when ready.
      recordTelemetryEvent('status', { event: 'checkpoint_pull_first' });
      cloudCheckpointClient.syncPullFirst();
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

/* ── Site config: shortcuts + greeting + voice + page capture (cache, merge, fetch) ── */

type RoverGreetingConfig = {
  text?: string;
  delay?: number;
  duration?: number;
  disabled?: boolean;
};

type RoverResolvedSiteConfig = {
  shortcuts: RoverShortcut[];
  greeting?: RoverGreetingConfig;
  voice?: RoverVoiceConfig;
  aiAccess?: RoverAiAccessConfig;
  limits?: RoverShortcutLimits;
  pageConfig?: RoverPageCaptureConfig;
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

function sanitizeResolvedPageCaptureConfig(raw: unknown): RoverPageCaptureConfig | undefined {
  return sanitizeRoverPageCaptureConfig(raw);
}

function normalizeVoiceAutoStopMs(input: unknown): number | undefined {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(VOICE_AUTO_STOP_MIN_MS, Math.min(VOICE_AUTO_STOP_MAX_MS, Math.floor(parsed)));
}

function sanitizeVoiceConfig(raw: unknown): RoverVoiceConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const next: RoverVoiceConfig = {};
  if (typeof input.enabled === 'boolean') {
    next.enabled = input.enabled;
  }
  const language = String(input.language || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, VOICE_LANGUAGE_MAX_CHARS);
  if (language) {
    next.language = language;
  }
  const autoStopMs = normalizeVoiceAutoStopMs(input.autoStopMs);
  if (autoStopMs !== undefined) {
    next.autoStopMs = autoStopMs;
  }
  return Object.keys(next).length ? next : undefined;
}

function sanitizeAiAccessConfig(raw: unknown): RoverAiAccessConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as RoverServerAiAccessConfig;
  const next: RoverAiAccessConfig = {};
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  if (typeof input.allowPromptLaunch === 'boolean') next.allowPromptLaunch = input.allowPromptLaunch;
  if (typeof input.allowShortcutLaunch === 'boolean') next.allowShortcutLaunch = input.allowShortcutLaunch;
  if (typeof input.allowCloudBrowser === 'boolean') next.allowCloudBrowser = input.allowCloudBrowser;
  if (typeof input.allowDelegatedHandoffs === 'boolean') next.allowDelegatedHandoffs = input.allowDelegatedHandoffs;
  if (typeof input.debugStreaming === 'boolean') next.debugStreaming = input.debugStreaming;
  return Object.keys(next).length ? next : undefined;
}

function resolveEffectivePageCaptureConfig(cfg: RoverInit | null): RoverPageCaptureConfig | undefined {
  if (!cfg) return undefined;
  const fromBackend = sanitizeResolvedPageCaptureConfig(backendSiteConfig?.pageConfig);
  const fromInit = sanitizeResolvedPageCaptureConfig(cfg.pageConfig);
  const merged = sanitizeResolvedPageCaptureConfig({
    ...(fromBackend || {}),
    ...(fromInit || {}),
  });
  return merged;
}

function resolveEffectiveAiAccessConfig(cfg: RoverInit | null): RoverAiAccessConfig | undefined {
  if (!cfg) return undefined;
  return sanitizeAiAccessConfig(backendSiteConfig?.aiAccess);
}

function syncEffectivePageCaptureConfig(cfg: RoverInit | null): void {
  if (!worker || !cfg) return;
  const effective = resolveEffectivePageCaptureConfig(cfg);
  const json = JSON.stringify(effective || null);
  if (json === lastEffectivePageCaptureConfigJson) return;
  lastEffectivePageCaptureConfigJson = json;
  worker.postMessage({
    type: 'update_config',
    config: {
      ...buildWorkerBoundaryConfig(),
      pageConfig: effective,
    },
  });
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
        voice: sanitizeVoiceConfig(parsed.data.voice),
        aiAccess: sanitizeAiAccessConfig(parsed.data.aiAccess),
        limits: sanitizeSiteConfigLimits(parsed.data.limits),
        pageConfig: sanitizeResolvedPageCaptureConfig(parsed.data.pageConfig),
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
          voice: sanitizeVoiceConfig(data.voice),
          aiAccess: sanitizeAiAccessConfig(data.aiAccess),
          limits: sanitizeSiteConfigLimits(data.limits),
          pageConfig: sanitizeResolvedPageCaptureConfig(data.pageConfig),
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

function resolveEffectiveShortcuts(cfg: RoverInit | null): RoverShortcut[] {
  if (!cfg) return [];
  const configShortcuts = sanitizeShortcutList(cfg.ui?.shortcuts || []);
  const backendShortcuts = sanitizeShortcutList(backendSiteConfig?.shortcuts || []);
  return mergeShortcuts(configShortcuts, backendShortcuts);
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

function clearPendingLaunchAttach(): void {
  if (launchAttachRetryTimer) {
    clearTimeout(launchAttachRetryTimer);
    launchAttachRetryTimer = null;
  }
  pendingLaunchRequest = null;
}

function buildLaunchHandleKey(request: RoverLaunchRequest): string {
  return `${window.location.href}::${request.signature}`;
}

function consumeHandledLaunchRequest(request: RoverLaunchRequest): void {
  const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextRelativeUrl = stripLaunchParams(window.location.href);
  if (nextRelativeUrl === currentRelativeUrl) return;
  try {
    history.replaceState(history.state, document.title, nextRelativeUrl);
    recordTelemetryEvent('status', {
      event: 'launch_params_consumed',
      requestId: request.requestId,
    });
  } catch {
    // no-op
  }
}

function scheduleLaunchAttachRetry(handleKey: string, request: RoverLaunchRequest, deadlineAt: number): void {
  const existing = pendingLaunchRequest;
  if (existing?.handleKey === handleKey && existing.deadlineAt === deadlineAt && launchAttachRetryTimer) {
    return;
  }
  if (launchAttachRetryTimer) {
    clearTimeout(launchAttachRetryTimer);
  }
  pendingLaunchRequest = { handleKey, request, deadlineAt };
  launchAttachRetryTimer = setTimeout(() => {
    launchAttachRetryTimer = null;
    maybeHandleLaunchAttach('attach_retry');
  }, LAUNCH_ATTACH_RETRY_MS);
}

function clearLaunchEventFlushTimer(): void {
  if (launchEventFlushTimer) {
    clearTimeout(launchEventFlushTimer);
    launchEventFlushTimer = null;
  }
}

function resetActiveLaunchBinding(): void {
  clearLaunchEventFlushTimer();
  activeLaunchBinding = null;
}

function scheduleLaunchEventFlush(delayMs = 0): void {
  if (!activeLaunchBinding?.pendingEvents.length) return;
  if (launchEventFlushTimer) return;
  launchEventFlushTimer = setTimeout(() => {
    launchEventFlushTimer = null;
    void flushLaunchEvents();
  }, Math.max(0, delayMs));
}

async function flushLaunchEvents(force = false): Promise<void> {
  const binding = activeLaunchBinding;
  if (!binding || !binding.pendingEvents.length || binding.ingestInFlight) return;
  if (!roverServerRuntime) return;
  if (!force && shouldDeferBackgroundSync()) {
    scheduleLaunchEventFlush(LAUNCH_EVENT_RETRY_DELAY_MS);
    return;
  }
  const batch = binding.pendingEvents.splice(0, LAUNCH_EVENT_MAX_BATCH_SIZE);
  if (!batch.length) return;
  binding.ingestInFlight = true;
  try {
    const accepted = await roverServerRuntime.ingestLaunchEvents({
      requestId: binding.requestId,
      runId: binding.runId,
      events: batch,
    });
    if (!accepted) {
      binding.pendingEvents = [...batch, ...binding.pendingEvents].slice(-LAUNCH_EVENT_MAX_BATCH_SIZE * 4);
      scheduleLaunchEventFlush(LAUNCH_EVENT_RETRY_DELAY_MS);
    }
  } catch {
    binding.pendingEvents = [...batch, ...binding.pendingEvents].slice(-LAUNCH_EVENT_MAX_BATCH_SIZE * 4);
    scheduleLaunchEventFlush(LAUNCH_EVENT_RETRY_DELAY_MS);
  } finally {
    binding.ingestInFlight = false;
  }
  if (binding.pendingEvents.length) {
    scheduleLaunchEventFlush(0);
  }
}

function enqueueLaunchRuntimeEvent(
  type: RoverLaunchIngestEvent['type'],
  data?: Record<string, unknown>,
  options?: { immediate?: boolean; runId?: string },
): void {
  const binding = activeLaunchBinding;
  if (!binding) return;
  if (options?.runId) {
    binding.runId = options.runId;
  }
  binding.pendingEvents.push({
    type,
    ts: Date.now(),
    data,
  });
  if (options?.immediate) {
    clearLaunchEventFlushTimer();
    void flushLaunchEvents(true);
    return;
  }
  scheduleLaunchEventFlush(0);
}

function getLatestAssistantTextForLaunch(runId?: string): string | undefined {
  const byRunId = String(runId || '').trim();
  if (byRunId) {
    const text = String(latestAssistantByRunId.get(byRunId) || '').trim();
    if (text) return text;
  }
  const latestAssistant = [...(runtimeState?.uiMessages || [])].reverse().find(message => message.role === 'assistant');
  const fallback = String(latestAssistant?.text || '').trim();
  return fallback || undefined;
}

function getLatestSnapshotDigestForLaunch(): string | undefined {
  const key = String(lastAppliedServerSnapshotKey || '').trim();
  if (!key) return undefined;
  const idx = key.indexOf(':');
  if (idx < 0) return undefined;
  const digest = key.slice(idx + 1).trim();
  return digest || undefined;
}

function shouldIncludeLaunchFullData(): boolean {
  return activeLaunchBinding?.detail === 'full' || activeLaunchBinding?.detail === 'debug';
}

function shouldIncludeLaunchDebugData(): boolean {
  return activeLaunchBinding?.detail === 'debug';
}

function buildLaunchStatusEventData(msg: any): Record<string, unknown> {
  const data: Record<string, unknown> = {
    stage: normalizeStatusStage(msg?.stage),
    message: typeof msg?.message === 'string' ? msg.message : undefined,
    compactThought: typeof msg?.compactThought === 'string' ? msg.compactThought : undefined,
  };
  if (shouldIncludeLaunchDebugData()) {
    data.thought = typeof msg?.thought === 'string' ? msg.thought : undefined;
  }
  return data;
}

function buildLaunchToolStartData(msg: any): Record<string, unknown> {
  const data: Record<string, unknown> = {
    toolName: typeof msg?.call?.name === 'string' ? msg.call.name : 'tool',
  };
  if (shouldIncludeLaunchFullData()) {
    data.args = msg?.call?.args;
  }
  return data;
}

function buildLaunchToolResultData(msg: any): Record<string, unknown> {
  const data: Record<string, unknown> = {
    toolName: typeof msg?.call?.name === 'string' ? msg.call.name : 'tool',
    success: msg?.result?.success !== false,
  };
  if (shouldIncludeLaunchFullData()) {
    data.result = msg?.result;
  } else if (typeof msg?.result?.message === 'string') {
    data.message = msg.result.message;
  }
  return data;
}

function buildLaunchObservation(runId?: string): Record<string, unknown> {
  const url = window.location.href;
  const title = String(document.title || '').trim() || undefined;
  const host = String(window.location.hostname || '').trim() || undefined;
  const summary = getLatestAssistantTextForLaunch(runId);
  const snapshotDigest = getLatestSnapshotDigestForLaunch();
  return {
    url,
    title,
    host,
    summary,
    snapshotDigest,
  };
}

function maybeEmitLaunchNeedsInput(questions: RoverAskUserQuestion[]): void {
  const binding = activeLaunchBinding;
  if (!binding || !questions.length) return;
  const signature = questions.map(question => `${question.key}:${question.query}`).join('|');
  if (binding.lastNeedsInputSignature === signature) return;
  binding.lastNeedsInputSignature = signature;
  enqueueLaunchRuntimeEvent('needs_input', { questions }, { immediate: true });
}

function finalizeLaunchObservationForRun(runId?: string): void {
  const binding = activeLaunchBinding;
  if (!binding) return;
  const normalizedRunId = String(runId || binding.runId || '').trim() || undefined;
  if (normalizedRunId && binding.finalObservationRunId === normalizedRunId) return;
  if (normalizedRunId) {
    binding.finalObservationRunId = normalizedRunId;
  }
  enqueueLaunchRuntimeEvent('page_observation', buildLaunchObservation(normalizedRunId), { immediate: true, runId: normalizedRunId });
}

function handleLaunchAttachFailure(
  request: RoverLaunchRequest,
  handleKey: string,
  message: string,
  options?: { consume?: boolean; openWidget?: boolean },
): void {
  clearPendingLaunchAttach();
  launchAttachInFlightKey = '';
  if (options?.openWidget !== false) {
    open();
    appendUiMessage('system', `Rover couldn't start the AI launch: ${message}`, true);
  }
  recordTelemetryEvent('status', {
    event: 'launch_attach_failed',
    requestId: request.requestId,
    message,
  });
  launchLastHandledKey = handleKey;
  if (options?.consume !== false) {
    consumeHandledLaunchRequest(request);
  }
}

function dispatchLaunchInput(response: RoverLaunchAttachResponse | RoverTaskBrowserClaimResponse): void {
  const input = response.input;
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error('Launch attach response did not include a prompt.');
  }
  open();
  if (input.kind === 'shortcut') {
    dispatchUserPrompt(input.prompt, {
      reason: 'launch_shortcut',
      routing: input.routing,
    });
    return;
  }
  dispatchUserPrompt(input.prompt, { reason: 'launch_prompt' });
}

function maybeHandleLaunchAttach(
  source: 'boot' | 'update' | 'navigation' | 'site_config' | 'attach_retry',
): void {
  if (!currentConfig || typeof window === 'undefined') return;
  const request = parseLaunchRequest(window.location.href);
  if (!request) {
    clearPendingLaunchAttach();
    launchLastHandledKey = '';
    launchLastIgnoredDisabledKey = '';
    launchAttachInFlightKey = '';
    return;
  }

  const handleKey = buildLaunchHandleKey(request);
  if (handleKey === launchLastHandledKey || activeLaunchBinding?.handleKey === handleKey || launchAttachInFlightKey === handleKey) {
    return;
  }

  const aiAccess = resolveEffectiveAiAccessConfig(currentConfig);
  if (aiAccess && aiAccess.enabled === false) {
    clearPendingLaunchAttach();
    if (launchLastIgnoredDisabledKey !== handleKey) {
      recordTelemetryEvent('status', {
        event: 'launch_ignored_disabled',
        requestId: request.requestId,
        source,
      });
      launchLastIgnoredDisabledKey = handleKey;
    }
    handleLaunchAttachFailure(request, handleKey, 'AI launch is not enabled for this Rover embed.', {
      consume: true,
      openWidget: true,
    });
    return;
  }
  launchLastIgnoredDisabledKey = '';

  const deadlineAt = pendingLaunchRequest?.handleKey === handleKey
    ? pendingLaunchRequest.deadlineAt
    : Date.now() + LAUNCH_ATTACH_WAIT_MS;
  if (Date.now() >= deadlineAt) {
    handleLaunchAttachFailure(request, handleKey, 'Launch attach timed out before Rover finished booting.', {
      consume: true,
      openWidget: true,
    });
    return;
  }

  launchAttachInFlightKey = handleKey;
  void ensureRoverServerRuntime(currentConfig)
    .then(async () => {
      if (!roverServerRuntime) {
        scheduleLaunchAttachRetry(handleKey, request, deadlineAt);
        return;
      }
      const response = await roverServerRuntime.attachLaunch({
        requestId: request.requestId,
        attachToken: request.attachToken,
      });
      if (!response) {
        scheduleLaunchAttachRetry(handleKey, request, deadlineAt);
        return;
      }

      clearPendingLaunchAttach();
      activeLaunchBinding = {
        requestId: request.requestId,
        attachToken: request.attachToken,
        handleKey,
        status: response.status,
        detail: response.detail,
        executionTarget: response.executionTarget,
        runId: response.runId,
        pendingEvents: [],
        attachCompletedAt: Date.now(),
      };
      dispatchLaunchInput(response);
      enqueueLaunchRuntimeEvent('state_transition', {
        status: response.status === 'awaiting_user' ? 'awaiting_user' : 'running',
        executionTarget: response.executionTarget,
        detail: response.detail,
        source: 'launch_attach',
      }, {
        immediate: true,
        runId: response.runId,
      });
      recordTelemetryEvent('status', {
        event: 'launch_attached',
        requestId: request.requestId,
        source,
        executionTarget: response.executionTarget,
        detail: response.detail,
      });
      launchLastHandledKey = handleKey;
      consumeHandledLaunchRequest(request);
    })
    .catch(error => {
      if (Date.now() < deadlineAt) {
        scheduleLaunchAttachRetry(handleKey, request, deadlineAt);
        return;
      }
      handleLaunchAttachFailure(
        request,
        handleKey,
        (error as Error)?.message || 'Unknown launch attach failure.',
        { consume: true, openWidget: true },
      );
    })
    .finally(() => {
      if (launchAttachInFlightKey === handleKey) {
        launchAttachInFlightKey = '';
      }
    });
}

function clearPendingDeepLinkShortcut(): void {
  if (deepLinkShortcutRetryTimer) {
    clearTimeout(deepLinkShortcutRetryTimer);
    deepLinkShortcutRetryTimer = null;
  }
  deepLinkPendingShortcut = null;
}

function buildDeepLinkHandleKey(request: RoverDeepLinkRequest): string {
  return `${window.location.href}::${request.signature}`;
}

function canResolveDeepLinkShortcutFromRemote(cfg: RoverInit | null): boolean {
  if (!cfg) return false;
  return !!(getBootstrapRuntimeAuthToken(cfg) || getRuntimeSessionToken(cfg));
}

function consumeHandledDeepLink(config: ResolvedDeepLinkConfig, request: RoverDeepLinkRequest): void {
  if (!config.consume) return;
  const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextRelativeUrl = stripDeepLinkParams(window.location.href, config);
  if (nextRelativeUrl === currentRelativeUrl) return;
  try {
    history.replaceState(history.state, document.title, nextRelativeUrl);
    recordTelemetryEvent('status', {
      event: 'deep_link_consumed',
      kind: request.kind,
      paramName: request.paramName,
    });
  } catch {
    // no-op
  }
}

function scheduleDeepLinkShortcutRetry(
  handleKey: string,
  request: RoverDeepLinkRequest & { kind: 'shortcut' },
  deadlineAt: number,
): void {
  const existing = deepLinkPendingShortcut;
  if (existing?.handleKey === handleKey && existing.deadlineAt === deadlineAt && deepLinkShortcutRetryTimer) {
    return;
  }
  if (deepLinkShortcutRetryTimer) {
    clearTimeout(deepLinkShortcutRetryTimer);
  }
  deepLinkPendingShortcut = { handleKey, request, deadlineAt };
  deepLinkShortcutRetryTimer = setTimeout(() => {
    deepLinkShortcutRetryTimer = null;
    maybeHandleDeepLink('shortcut_retry');
  }, DEEP_LINK_SHORTCUT_RETRY_MS);
}

function handleDeepLinkShortcutNotFound(
  request: RoverDeepLinkRequest & { kind: 'shortcut' },
  handleKey: string,
  config: ResolvedDeepLinkConfig,
): void {
  clearPendingDeepLinkShortcut();
  open();
  appendUiMessage(
    'system',
    `Rover couldn't find shortcut "${request.value}" for this embed. Check the URL or expose that shortcut in the Rover boot config/site config.`,
    true,
  );
  recordTelemetryEvent('status', {
    event: 'deep_link_shortcut_not_found',
    shortcutId: request.value,
    paramName: request.paramName,
  });
  deepLinkLastHandledKey = handleKey;
  consumeHandledDeepLink(config, request);
}

function resolveAgentTaskBaseUrl(): string {
  const rawBase = String(currentConfig?.apiBase || 'https://agent.rtrvr.ai').trim().replace(/\/+$/, '');
  if (!rawBase) return 'https://agent.rtrvr.ai';
  if (rawBase.endsWith('/extensionRouter/v2/rover')) {
    return rawBase.slice(0, -('/extensionRouter/v2/rover'.length));
  }
  if (rawBase.endsWith('/v2/rover')) {
    return rawBase.slice(0, -('/v2/rover'.length));
  }
  return rawBase;
}

function extractTaskAccessToken(taskUrl?: string): string | undefined {
  const raw = String(taskUrl || '').trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    const access = String(parsed.searchParams.get('access') || '').trim();
    return access || undefined;
  } catch {
    return undefined;
  }
}

function buildAgentTaskUrl(taskId: string, accessToken?: string): string {
  const url = new URL(`${resolveAgentTaskBaseUrl()}/v1/tasks/${encodeURIComponent(taskId)}`);
  if (accessToken) {
    url.searchParams.set('access', accessToken);
  }
  return url.toString();
}

function buildAgentWorkflowUrl(workflowId: string, accessToken?: string): string {
  const url = new URL(`${resolveAgentTaskBaseUrl()}/v1/workflows/${encodeURIComponent(workflowId)}`);
  if (accessToken) {
    url.searchParams.set('access', accessToken);
  }
  return url.toString();
}

function bindPublicTaskContext(input: {
  taskId: string;
  taskUrl?: string;
  taskAccessToken?: string;
  workflowId?: string;
  workflowUrl?: string;
  workflowAccessToken?: string;
  runId?: string;
}): void {
  const taskId = String(input.taskId || '').trim();
  if (!taskId) return;
  const taskAccessToken = String(input.taskAccessToken || extractTaskAccessToken(input.taskUrl) || '').trim() || undefined;
  const workflowId = String(input.workflowId || '').trim() || undefined;
  const workflowAccessToken = String(input.workflowAccessToken || extractTaskAccessToken(input.workflowUrl) || '').trim() || undefined;
  activePublicTaskContext = {
    taskId,
    taskUrl: String(input.taskUrl || buildAgentTaskUrl(taskId, taskAccessToken)).trim(),
    taskAccessToken,
    workflowId,
    workflowUrl: workflowId
      ? String(input.workflowUrl || buildAgentWorkflowUrl(workflowId, workflowAccessToken)).trim()
      : undefined,
    workflowAccessToken,
    taskBoundaryId: normalizeTaskBoundaryId(currentTaskBoundaryId || runtimeState?.workerState?.taskBoundaryId),
    runId: String(input.runId || runtimeState?.pendingRun?.id || '').trim() || undefined,
    updatedAt: Date.now(),
  };
}

function getCurrentPublicTaskBoundaryId(): string {
  return normalizeTaskBoundaryId(currentTaskBoundaryId || runtimeState?.workerState?.taskBoundaryId) || '';
}

function normalizeHandoffExecution(value: unknown): 'auto' | 'browser' | 'cloud' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'browser' || normalized === 'cloud') return normalized;
  return 'auto';
}

function isTerminalPublicTaskStatus(status: unknown): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled' || normalized === 'expired';
}

function extractTaskIdFromTaskUrl(taskUrlOrId: string): string | undefined {
  const raw = String(taskUrlOrId || '').trim();
  if (!raw) return undefined;
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const taskIndex = parts.lastIndexOf('tasks');
    if (taskIndex >= 0 && parts[taskIndex + 1]) {
      return decodeURIComponent(parts[taskIndex + 1]);
    }
    const workflowIndex = parts.lastIndexOf('workflows');
    if (workflowIndex >= 0 && parts[workflowIndex + 1]) {
      return decodeURIComponent(parts[workflowIndex + 1]);
    }
  } catch {
    // no-op
  }
  return undefined;
}

function buildCurrentHandoffObservation(): Record<string, unknown> {
  const summary = String(lastCompletedTaskSummary || runtimeState?.uiStatus || runtimeState?.transientStatus?.text || '').trim();
  return {
    url: window.location.href,
    title: document.title,
    host: window.location.hostname,
    ...(summary ? { summary } : {}),
  };
}

function buildFallbackRootWorkflowPrompt(): string {
  const title = String(document.title || '').trim();
  if (title) {
    return `Continue the current Rover workflow on ${title}.`;
  }
  return `Continue the current Rover workflow on ${window.location.hostname}.`;
}

async function ensureRootPublicTaskContextForHandoff(): Promise<ActivePublicTaskContext> {
  const boundaryId = getCurrentPublicTaskBoundaryId();
  const existing = activePublicTaskContext;
  if (
    existing
    && existing.taskId
    && existing.taskAccessToken
    && (!boundaryId || existing.taskBoundaryId === boundaryId)
  ) {
    existing.runId = String(runtimeState?.pendingRun?.id || existing.runId || '').trim() || undefined;
    existing.updatedAt = Date.now();
    return existing;
  }
  if (!currentConfig) {
    throw new Error('Rover is not booted.');
  }
  await ensureRoverServerRuntime(currentConfig);
  if (!roverServerRuntime) {
    throw new Error('Rover server runtime is unavailable.');
  }
  const prompt = resolveCanonicalTaskInputForRun(runtimeState?.pendingRun?.id) || buildFallbackRootWorkflowPrompt();
  const created = await roverServerRuntime.createSessionRootTask({
    url: window.location.href,
    prompt,
    runId: String(runtimeState?.pendingRun?.id || '').trim() || undefined,
  });
  if (!created?.id || !created.task) {
    throw new Error('Failed to create the root public workflow task.');
  }
  bindPublicTaskContext({
    taskId: created.id,
    taskUrl: created.task,
    taskAccessToken: extractTaskAccessToken(created.task),
    workflowId: extractTaskIdFromTaskUrl(created.workflow || ''),
    workflowUrl: created.workflow,
    workflowAccessToken: extractTaskAccessToken(created.workflow),
    runId: String(runtimeState?.pendingRun?.id || '').trim() || undefined,
  });
  if (!activePublicTaskContext?.taskAccessToken) {
    throw new Error('Root public workflow task is missing an access token.');
  }
  recordTelemetryEvent('status', {
    event: 'handoff_root_task_created',
    taskId: activePublicTaskContext.taskId,
    workflowId: activePublicTaskContext.workflowId,
  });
  return activePublicTaskContext;
}

async function followPublicTaskUntilStable(
  taskUrlOrId: string,
  accessToken?: string,
  timeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
): Promise<RoverPublicTaskPayload | null> {
  if (!currentConfig) return null;
  await ensureRoverServerRuntime(currentConfig);
  if (!roverServerRuntime) {
    throw new Error('Rover server runtime is unavailable.');
  }
  const deadlineAt = Date.now() + Math.max(0, timeoutMs);
  let latest: RoverPublicTaskPayload | null = null;
  while (true) {
    const remainingMs = deadlineAt - Date.now();
    const waitSeconds = remainingMs > 0
      ? Math.max(1, Math.min(HANDOFF_TOOL_POLL_SLICE_SECONDS, Math.ceil(remainingMs / 1000)))
      : 0;
    latest = await roverServerRuntime.getPublicTask(taskUrlOrId, {
      accessToken,
      waitSeconds,
    });
    if (!latest) return latest;
    if (isTerminalPublicTaskStatus(latest.status) || latest.status === 'input_required') {
      return latest;
    }
    if (remainingMs <= 0) {
      return latest;
    }
  }
}

function tryOpenDelegatedBrowserTask(task: RoverPublicTaskPayload, execution: 'auto' | 'browser' | 'cloud'): {
  opened: boolean;
  targetUrl?: string;
  error?: string;
} {
  if (execution === 'cloud') {
    return { opened: false };
  }
  const targetUrl = String(task.open || task.browserLink || '').trim();
  if (!targetUrl) {
    return { opened: false };
  }
  try {
    const openedWindow = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (openedWindow) {
      return { opened: true, targetUrl };
    }
    return {
      opened: false,
      targetUrl,
      error: 'Browser blocked the delegated Rover handoff window.',
    };
  } catch (error) {
    return {
      opened: false,
      targetUrl,
      error: (error as Error)?.message || 'Unable to open the delegated Rover site.',
    };
  }
}

function buildHandoffToolResult(
  task: RoverPublicTaskPayload,
  options?: { browserOpen?: { opened: boolean; targetUrl?: string; error?: string } },
): Record<string, unknown> {
  const status = String(task.status || 'pending').trim().toLowerCase();
  const taskUrl = String(task.task || '').trim();
  const workflowUrl = String(task.workflow || '').trim();
  const summary = String(task.result?.summary || task.result?.text || task.input?.message || '').trim();
  const questions = normalizeAskUserQuestions(task.input?.questions);
  const browserOpen = options?.browserOpen;
  const base: Record<string, unknown> = {
    success: status === 'completed',
    status,
    task: taskUrl || undefined,
    workflow: workflowUrl || undefined,
    open: task.open,
    browserLink: task.browserLink,
    result: task.result,
    handoff: task.handoff,
    summary: task.result?.summary,
    text: task.result?.text || summary || undefined,
    observation: task.result?.observation,
    transcript: task.result?.transcript,
    artifacts: task.result?.artifacts,
    taskStatus: status,
    ...(browserOpen?.targetUrl ? { browserOpenUrl: browserOpen.targetUrl } : {}),
    ...(browserOpen?.opened ? { browserOpened: true } : {}),
    ...(browserOpen?.error ? { browserOpenError: browserOpen.error } : {}),
  };

  if (status === 'completed') {
    return {
      ...base,
      taskComplete: true,
      terminalState: 'completed',
      message: summary || 'Delegated Rover task completed.',
    };
  }

  if (status === 'input_required') {
    return {
      ...base,
      success: false,
      taskComplete: false,
      terminalState: 'waiting_input',
      continuationReason: 'awaiting_user',
      needsUserInput: true,
      waitingForUserInput: true,
      questions: questions.length ? questions : task.input?.questions,
      input: task.input,
      message: String(task.input?.message || summary || 'Delegated Rover task needs more input.').trim(),
    };
  }

  if (status === 'failed' || status === 'cancelled' || status === 'expired') {
    const errorMessage = String(task.result?.error || summary || `Delegated Rover task ${status}.`).trim();
    return {
      ...base,
      success: false,
      taskComplete: false,
      terminalState: 'failed',
      error: errorMessage,
      message: errorMessage,
    };
  }

  const runningMessage =
    status === 'waiting_browser'
      ? 'Delegated Rover task is waiting for a browser attachment. Re-open the returned URL or call again with execution="cloud" for a browserless run.'
      : 'Delegated Rover task is still running. Call handoff_to_rover_site again with the returned task URL to keep following it.';
  return {
    ...base,
    success: false,
    taskComplete: false,
    terminalState: 'in_progress',
    continuationReason: 'loop_continue',
    message: runningMessage,
  };
}

async function handleBuiltInRoverHandoff(rawArgs: HandoffToolArgs | undefined): Promise<Record<string, unknown>> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as HandoffToolArgs;
  if (!currentConfig) {
    throw new Error('Rover is not booted.');
  }
  await ensureRoverServerRuntime(currentConfig);
  if (!roverServerRuntime) {
    throw new Error('Rover server runtime is unavailable.');
  }

  const execution = normalizeHandoffExecution(args.execution);
  const answer = String(args.answer || '').trim();
  const existingTaskUrl = String(args.task || '').trim();

  if (existingTaskUrl) {
    const accessToken = extractTaskAccessToken(existingTaskUrl);
    let latest = answer
      ? await roverServerRuntime.continuePublicTask(existingTaskUrl, answer, { accessToken })
      : await roverServerRuntime.getPublicTask(existingTaskUrl, { accessToken });
    if (!latest) {
      throw new Error('Delegated Rover task could not be loaded.');
    }
    let browserOpen: { opened: boolean; targetUrl?: string; error?: string } | undefined;
    if (!isTerminalPublicTaskStatus(latest.status) && latest.status !== 'input_required') {
      browserOpen = tryOpenDelegatedBrowserTask(latest, execution);
      latest = (await followPublicTaskUntilStable(existingTaskUrl, accessToken, DEFAULT_ACTION_TIMEOUT_MS)) || latest;
    }
    return buildHandoffToolResult(latest, browserOpen ? { browserOpen } : undefined);
  }

  const targetUrl = String(args.url || '').trim();
  const shortcutId = String(args.shortcutId || '').trim();
  const instruction = String(args.instruction || '').trim();
  const prompt = String(args.prompt || '').trim();
  if (!targetUrl) {
    throw new Error('handoff_to_rover_site requires url or task.');
  }
  if (!shortcutId && !instruction && !prompt) {
    throw new Error('handoff_to_rover_site requires instruction, prompt, or shortcutId when creating a new handoff.');
  }

  const parentContext = await ensureRootPublicTaskContextForHandoff();
  const created = await roverServerRuntime.createTaskHandoff({
    parentTaskId: parentContext.taskId,
    taskAccessToken: String(parentContext.taskAccessToken || '').trim(),
    url: targetUrl,
    ...(shortcutId ? { shortcutId } : {}),
    ...(!shortcutId && instruction ? { instruction } : {}),
    ...(!shortcutId && !instruction && prompt ? { prompt } : {}),
    ...(String(args.contextSummary || lastCompletedTaskSummary || '').trim()
      ? { contextSummary: String(args.contextSummary || lastCompletedTaskSummary).trim() }
      : {}),
    ...(String(args.expectedOutput || '').trim()
      ? { expectedOutput: String(args.expectedOutput).trim() }
      : {}),
    ...(String(resolveCanonicalTaskInputForRun(runtimeState?.pendingRun?.id) || '').trim()
      ? { originalGoal: String(resolveCanonicalTaskInputForRun(runtimeState?.pendingRun?.id) || '').trim() }
      : {}),
    lastObservation: buildCurrentHandoffObservation(),
    execution,
  });
  if (!created) {
    throw new Error('Delegated Rover handoff could not be created.');
  }

  let browserOpen: { opened: boolean; targetUrl?: string; error?: string } | undefined;
  if (!isTerminalPublicTaskStatus(created.status) && created.status !== 'input_required') {
    browserOpen = tryOpenDelegatedBrowserTask(created, execution);
  }
  const accessToken = extractTaskAccessToken(created.task);
  const latest = (!isTerminalPublicTaskStatus(created.status) && created.status !== 'input_required')
    ? ((await followPublicTaskUntilStable(created.task, accessToken, DEFAULT_ACTION_TIMEOUT_MS)) || created)
    : created;
  recordTelemetryEvent('status', {
    event: 'handoff_task_created',
    parentTaskId: parentContext.taskId,
    childTaskId: latest.id,
    workflowId: extractTaskIdFromTaskUrl(latest.workflow || '') || parentContext.workflowId,
    targetHost: (() => {
      try { return new URL(targetUrl).hostname; } catch { return undefined; }
    })(),
  });
  return buildHandoffToolResult(latest, browserOpen ? { browserOpen } : undefined);
}

const BUILT_IN_HANDOFF_TOOL_DEF: ClientToolDefinition = {
  name: 'handoff_to_rover_site',
  description: 'Delegate part of the current Rover workflow to Rover on another Rover-enabled site and keep following that child task until it completes or asks for more input.',
  parameters: {
    url: {
      type: 'string',
      description: 'Absolute URL for the Rover-enabled site that should handle the delegated step.',
    },
    instruction: {
      type: 'string',
      description: 'Delegation instruction for the target site. Use this for natural-language delegation.',
    },
    prompt: {
      type: 'string',
      description: 'Prompt alias for instruction when creating a delegated task.',
    },
    shortcutId: {
      type: 'string',
      description: 'Exact shortcut ID to run on the delegated Rover site instead of a natural-language instruction.',
    },
    contextSummary: {
      type: 'string',
      description: 'Short structured summary of what the target Rover site should know before continuing.',
    },
    expectedOutput: {
      type: 'string',
      description: 'Describe the output the delegated site should return to the parent workflow.',
    },
    execution: {
      type: 'string',
      enum: ['auto', 'browser', 'cloud'],
      description: 'Use browser to try a new tab first, cloud for guaranteed browserless execution, or auto for browser-first hybrid behavior.',
    },
    task: {
      type: 'string',
      description: 'Existing delegated task URL or task ID to keep following or resume after user input.',
    },
    answer: {
      type: 'string',
      description: 'Answer to send when resuming a delegated task that is waiting for user input.',
    },
  },
  llmCallable: true,
};

function ensureBuiltInToolsRegistered(): void {
  if (builtInToolsRegistered || !bridge || !worker) return;
  applyToolRegistration({
    def: BUILT_IN_HANDOFF_TOOL_DEF,
    handler: handleBuiltInRoverHandoff,
  });
  builtInToolsRegistered = true;
}

function clearPendingBrowserReceipt(): void {
  if (browserReceiptRetryTimer) {
    clearTimeout(browserReceiptRetryTimer);
    browserReceiptRetryTimer = null;
  }
  browserReceiptPending = null;
}

function buildBrowserReceiptHandleKey(request: RoverBrowserReceiptRequest): string {
  return `${window.location.href}::${request.signature}`;
}

function consumeHandledBrowserReceipt(
  request: RoverBrowserReceiptRequest,
  options?: { consumeDeepLink?: boolean },
): void {
  const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  let nextRelativeUrl = stripBrowserReceiptParams(window.location.href);
  if (options?.consumeDeepLink && currentConfig) {
    const nextAbsoluteUrl = new URL(nextRelativeUrl, window.location.origin).toString();
    nextRelativeUrl = stripDeepLinkParams(nextAbsoluteUrl, resolveDeepLinkConfig(currentConfig.deepLink));
  }
  if (nextRelativeUrl === currentRelativeUrl) return;
  try {
    history.replaceState(history.state, document.title, nextRelativeUrl);
    recordTelemetryEvent('status', {
      event: 'browser_receipt_consumed',
      receipt: request.receipt,
      consumeDeepLink: options?.consumeDeepLink === true,
    });
  } catch {
    // no-op
  }
}

function scheduleBrowserReceiptRetry(handleKey: string, deadlineAt: number): void {
  const existing = browserReceiptPending;
  if (existing?.handleKey === handleKey && existing.deadlineAt === deadlineAt && browserReceiptRetryTimer) {
    return;
  }
  if (browserReceiptRetryTimer) {
    clearTimeout(browserReceiptRetryTimer);
  }
  browserReceiptPending = { handleKey, deadlineAt };
  browserReceiptRetryTimer = setTimeout(() => {
    browserReceiptRetryTimer = null;
    maybeHandleBrowserReceipt('receipt_retry');
  }, RECEIPT_CLAIM_RETRY_MS);
}

function dispatchClaimedBrowserTask(response: RoverTaskBrowserClaimResponse): void {
  const input = response.input;
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error('Browser receipt claim did not include a prompt.');
  }
  open();
  if (input.kind === 'shortcut') {
    dispatchUserPrompt(input.prompt, {
      reason: 'browser_receipt_shortcut',
      routing: input.routing,
    });
    return;
  }
  dispatchUserPrompt(input.prompt, { reason: 'browser_receipt_prompt' });
}

function handleBrowserReceiptClaimFailure(
  request: RoverBrowserReceiptRequest,
  handleKey: string,
  message: string,
  options?: { fallbackToDeepLink?: boolean; openWidget?: boolean },
): void {
  clearPendingBrowserReceipt();
  if (options?.openWidget) {
    open();
    appendUiMessage('system', `Rover couldn't claim the browser receipt: ${message}`, true);
  }
  recordTelemetryEvent('status', {
    event: 'browser_receipt_claim_failed',
    message,
  });
  browserReceiptLastHandledKey = handleKey;
  consumeHandledBrowserReceipt(request, { consumeDeepLink: false });
  if (options?.fallbackToDeepLink) {
    maybeHandleDeepLink('receipt_fallback');
  }
}

function maybeHandleBrowserReceipt(
  source: 'boot' | 'update' | 'navigation' | 'site_config' | 'receipt_retry',
): boolean {
  if (!currentConfig || typeof window === 'undefined') return false;
  const request = parseBrowserReceiptRequest(window.location.href);
  if (!request) {
    clearPendingBrowserReceipt();
    browserReceiptLastHandledKey = '';
    browserReceiptClaimInFlightKey = '';
    return false;
  }

  const handleKey = buildBrowserReceiptHandleKey(request);
  if (handleKey === browserReceiptLastHandledKey || browserReceiptClaimInFlightKey === handleKey) {
    return true;
  }

  const deadlineAt = browserReceiptPending?.handleKey === handleKey
    ? browserReceiptPending.deadlineAt
    : Date.now() + RECEIPT_CLAIM_WAIT_MS;
  if (Date.now() >= deadlineAt) {
    handleBrowserReceiptClaimFailure(
      request,
      handleKey,
      'Browser receipt claim timed out before Rover finished booting.',
      {
        fallbackToDeepLink: true,
        openWidget: true,
      },
    );
    return true;
  }

  browserReceiptClaimInFlightKey = handleKey;
  void ensureRoverServerRuntime(currentConfig)
    .then(async () => {
      if (!roverServerRuntime) {
        scheduleBrowserReceiptRetry(handleKey, deadlineAt);
        return;
      }
      const response = await roverServerRuntime.claimBrowserTaskReceipt({
        receipt: request.receipt,
      });
      if (!response) {
        scheduleBrowserReceiptRetry(handleKey, deadlineAt);
        return;
      }

      clearPendingBrowserReceipt();
      bindPublicTaskContext({
        taskId: response.taskId,
        taskAccessToken: response.taskAccessToken,
        workflowId: response.workflowId,
        workflowAccessToken: response.workflowAccessToken,
        runId: response.runId,
      });
      dispatchClaimedBrowserTask(response);
      recordTelemetryEvent('status', {
        event: 'browser_receipt_claimed',
        source,
        taskId: response.taskId,
      });
      browserReceiptLastHandledKey = handleKey;
      consumeHandledBrowserReceipt(request, { consumeDeepLink: true });
    })
    .catch(error => {
      if (Date.now() < deadlineAt) {
        scheduleBrowserReceiptRetry(handleKey, deadlineAt);
        return;
      }
      handleBrowserReceiptClaimFailure(
        request,
        handleKey,
        (error as Error)?.message || 'Unknown browser receipt failure.',
        {
          fallbackToDeepLink: true,
          openWidget: true,
        },
      );
    })
    .finally(() => {
      if (browserReceiptClaimInFlightKey === handleKey) {
        browserReceiptClaimInFlightKey = '';
      }
    });

  return true;
}

function maybeHandleDeepLink(source: 'boot' | 'update' | 'navigation' | 'site_config' | 'shortcut_retry' | 'receipt_fallback'): void {
  if (!currentConfig || typeof window === 'undefined') return;
  const config = resolveDeepLinkConfig(currentConfig.deepLink);
  if (source !== 'receipt_fallback' && parseBrowserReceiptRequest(window.location.href)) {
    return;
  }
  const request = parseDeepLinkRequest(window.location.href, config);
  if (!request) {
    clearPendingDeepLinkShortcut();
    deepLinkLastHandledKey = '';
    deepLinkLastIgnoredDisabledKey = '';
    return;
  }

  const handleKey = buildDeepLinkHandleKey(request);
  if (!config.enabled) {
    clearPendingDeepLinkShortcut();
    if (deepLinkLastIgnoredDisabledKey !== handleKey) {
      recordTelemetryEvent('status', {
        event: 'deep_link_ignored_disabled',
        kind: request.kind,
        paramName: request.paramName,
        source,
      });
      deepLinkLastIgnoredDisabledKey = handleKey;
    }
    return;
  }
  deepLinkLastIgnoredDisabledKey = '';

  if (handleKey === deepLinkLastHandledKey) {
    return;
  }

  const hadPendingShortcut = deepLinkPendingShortcut?.handleKey === handleKey;
  if (!hadPendingShortcut) {
    recordTelemetryEvent('status', {
      event: 'deep_link_detected',
      kind: request.kind,
      paramName: request.paramName,
      source,
    });
  }

  if (request.kind === 'prompt') {
    clearPendingDeepLinkShortcut();
    open();
    dispatchUserPrompt(request.value, { reason: 'deep_link_prompt' });
    recordTelemetryEvent('status', {
      event: 'deep_link_dispatched',
      kind: request.kind,
      paramName: request.paramName,
    });
    deepLinkLastHandledKey = handleKey;
    consumeHandledDeepLink(config, request);
    return;
  }

  const shortcut = resolveEffectiveShortcuts(currentConfig).find(
    candidate => candidate.enabled !== false && candidate.id === request.value,
  );
  if (shortcut) {
    clearPendingDeepLinkShortcut();
    open();
    dispatchUserPrompt(shortcut.prompt, {
      reason: 'deep_link_shortcut',
      routing: shortcut.routing,
    });
    recordTelemetryEvent('status', {
      event: 'deep_link_dispatched',
      kind: request.kind,
      paramName: request.paramName,
      shortcutId: shortcut.id,
      routing: shortcut.routing,
    });
    deepLinkLastHandledKey = handleKey;
    consumeHandledDeepLink(config, request);
    return;
  }

  const deadlineAt = deepLinkPendingShortcut?.handleKey === handleKey
    ? deepLinkPendingShortcut.deadlineAt
    : Date.now() + DEEP_LINK_SHORTCUT_WAIT_MS;
  if (Date.now() < deadlineAt && canResolveDeepLinkShortcutFromRemote(currentConfig)) {
    scheduleDeepLinkShortcutRetry(handleKey, request, deadlineAt);
    return;
  }

  handleDeepLinkShortcutNotFound(request, handleKey, config);
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

function resolveEffectiveVoiceConfig(cfg: RoverInit | null): RoverVoiceConfig | undefined {
  if (!cfg) return undefined;
  const fromBackend = sanitizeVoiceConfig(backendSiteConfig?.voice);
  const fromBoot = sanitizeVoiceConfig(cfg.ui?.voice);
  if (!fromBackend && !fromBoot) return undefined;
  const merged: RoverVoiceConfig = {
    ...(fromBackend || {}),
    ...(fromBoot || {}),
  };
  if (merged.enabled === true && merged.autoStopMs === undefined) {
    merged.autoStopMs = VOICE_AUTO_STOP_DEFAULT_MS;
  }
  return merged;
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
  const merged = resolveEffectiveShortcuts(cfg);
  ui?.setShortcuts(getRenderableShortcuts(merged));
  ui?.setVoiceConfig(resolveEffectiveVoiceConfig(cfg));
  syncEffectivePageCaptureConfig(cfg);
  maybeHandleBrowserReceipt('site_config');
  maybeHandleLaunchAttach('site_config');
  maybeHandleDeepLink('site_config');
}

async function fetchBackendSiteConfig(cfg: RoverInit): Promise<RoverResolvedSiteConfig | null> {
  let payload: RoverServerSiteConfig | null = null;
  const runtimeToken = getBootstrapRuntimeAuthToken(cfg) || getRuntimeSessionToken(cfg);
  if (!runtimeToken) return null;

  const startBody: Record<string, unknown> = {
    siteId: cfg.siteId,
    sessionId: runtimeState?.sessionId || cfg.sessionId,
    requestedSessionId: runtimeState?.sessionId || cfg.sessionId,
    host: window.location.hostname,
    url: window.location.href,
    pageUrl: window.location.href,
  };
  if (runtimeToken.startsWith('rvrsess_')) {
    startBody.sessionToken = runtimeToken;
  } else {
    startBody.bootstrapToken = runtimeToken;
  }

  const baseCandidates = resolveRoverBases(cfg.apiBase);
  for (const base of baseCandidates) {
    try {
      const response = await fetch(`${base}/session/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(startBody),
      });
      const json = await response.json().catch(() => undefined);
      if (!response.ok || !json?.success) continue;
      payload = json?.data?.siteConfig || null;
      if (payload) break;
    } catch {
      // try next candidate
    }
  }

  if (!payload) return null;

  return {
    shortcuts: sanitizeShortcutList(payload.shortcuts),
    greeting: sanitizeGreetingConfig(payload.greeting),
    voice: sanitizeVoiceConfig(payload.voice),
    aiAccess: sanitizeAiAccessConfig(payload.aiAccess),
    limits: sanitizeSiteConfigLimits(payload.limits),
    pageConfig: sanitizeResolvedPageCaptureConfig(payload.pageConfig),
    version: payload.version != null ? String(payload.version) : undefined,
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
    isTransportController = initialRole === 'controller';
    if (runtimeState) {
      runtimeState.executionMode = initialRole;
    }
  }
  setupCloudCheckpointing(cfg);
  setupTelemetry(cfg);
  syncMainWorldObserverPause(true);

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
    domainScopeMode: normalizeDomainScopeMode(cfg.domainScopeMode),
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

      // Adversarial pre-check: block suspicious URLs before sending tab events
      if (intent?.targetUrl && shouldBlockNavigation(intent.targetUrl, currentHost)) {
        const adversarialResult = computeAdversarialScore(intent.targetUrl, currentHost);
        recordTelemetryEvent('navigation_guardrail', {
          event: 'adversarial_blocked',
          targetUrl: intent.targetUrl,
          score: adversarialResult.score,
          reasons: adversarialResult.reasons,
        });
        return {
          decision: 'block',
          reason: `Navigation blocked: suspicious URL detected (adversarial score ${adversarialResult.score}).`,
          decisionReason: 'adversarial_block',
        };
      }

      // Rate-limit rapid cross-origin navigations (> 3 in 10s = adversarial)
      if (intent?.isCrossHost) {
        const now = Date.now();
        crossOriginNavTimestamps.push(now);
        // Prune old entries
        while (crossOriginNavTimestamps.length > 0 && crossOriginNavTimestamps[0]! < now - CROSS_ORIGIN_NAV_WINDOW_MS) {
          crossOriginNavTimestamps.shift();
        }
        if (crossOriginNavTimestamps.length > CROSS_ORIGIN_NAV_MAX) {
          recordTelemetryEvent('navigation_guardrail', {
            event: 'rapid_cross_origin_blocked',
            targetUrl: intent.targetUrl,
            count: crossOriginNavTimestamps.length,
          });
          return {
            decision: 'block',
            reason: `Navigation blocked: too many cross-origin navigations (${crossOriginNavTimestamps.length} in ${CROSS_ORIGIN_NAV_WINDOW_MS / 1000}s).`,
            decisionReason: 'rapid_cross_origin_block',
          };
        }
      }

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
      const crossHostNavigation = !!currentHost && !!targetHost && currentHost !== targetHost;
      const targetInScope = isHostInNavigationScope({
        host: targetHost,
        currentHost,
        allowedDomains: currentConfig?.allowedDomains,
        domainScopeMode: currentConfig?.domainScopeMode,
      });
      const fallbackDecision: 'allow_same_tab' | 'open_new_tab' | 'block' =
        targetInScope
          ? (
            crossHostNavigation && currentConfig?.navigation?.crossHostPolicy === 'open_new_tab'
              ? 'open_new_tab'
              : 'allow_same_tab'
          )
          : currentConfig?.externalNavigationPolicy === 'block'
            ? 'block'
            : currentConfig?.externalNavigationPolicy === 'allow'
              ? 'allow_same_tab'
              : 'open_new_tab';
      const preflightMessage = resolveNavigationPreflightMessageContext();

      // Early handoff setup: prepare handoff synchronously before yielding to any await,
      // so fire-and-forget callers have the handoff ready before navigation fires.
      const isSameTabCandidate = fallbackDecision === 'allow_same_tab';
      if (isSameTabCandidate && runtimeState) {
        agentNavigationPending = true;
        setLatestNavigationHandoff(toPersistedNavigationHandoff(intent));
        ensureNavigationPendingRun(
          intent.isCrossHost ? 'cross_host_navigation' : 'agent_navigation',
        );
        // Force session token cache refresh before navigation destroys runtime
        if (runtimeSessionToken && currentConfig?.siteId) {
          try {
            sessionStorage.setItem(`rover:sess:${currentConfig.siteId}`, JSON.stringify({
              t: runtimeSessionToken,
              e: runtimeSessionTokenExpiresAt,
            }));
          } catch { /* ignore */ }
        }
        // Dispatch NAVIGATION_STARTED to FSM so state stays consistent
        if (taskOrchestrator) {
          const activeTask = taskOrchestrator.getActiveTask();
          if (activeTask) {
            taskOrchestrator.dispatch(activeTask.taskId, {
              type: 'NAVIGATION_STARTED',
              targetUrl: intent.targetUrl,
              isCrossHost: intent.isCrossHost,
            });
          }
        }
        flushCheckpointCritical('same_tab_navigation_handoff_early');
      }

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
        // Rollback early handoff if we set it up optimistically
        if (isSameTabCandidate) {
          agentNavigationPending = false;
        }
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
        // Rollback early handoff if we set it up optimistically
        if (isSameTabCandidate) {
          agentNavigationPending = false;
        }
        // Fire-and-forget: prefetch external context if on-demand scraping enabled
        const scrapeMode = (currentConfig?.tools as any)?.web?.scrapeMode;
        if (scrapeMode === 'on_demand' && roverServerRuntime && intent?.targetUrl) {
          void fetchAndCacheExternalContext(intent.targetUrl).catch(() => {/* ignore prefetch errors */});
        }
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
      // If early handoff was not set up (fallback was not allow_same_tab but server overrode),
      // set it up now.
      if (!isSameTabCandidate && runtimeState) {
        agentNavigationPending = true;
        setLatestNavigationHandoff(toPersistedNavigationHandoff(intent));
        ensureNavigationPendingRun(
          intent.isCrossHost ? 'cross_host_navigation' : 'agent_navigation',
        );
        flushCheckpointCritical('same_tab_navigation_handoff');
      } else if (!isSameTabCandidate) {
        agentNavigationPending = true;
      }
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
        openIntent: runtimeState.uiOpen ? 'preserve_if_running' : undefined,
        targetUrl: String(intent?.targetUrl || '').trim() || undefined,
        sourceHost: String(window.location.hostname || '').trim().toLowerCase() || undefined,
        handoffId: handoffForCookie?.handoffId || intent?.handoffId,
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
      flushCheckpointCritical('cross_domain_handoff_pre_navigation');
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
        const scopedMissing = getTaskScopedTabIds().includes(tabId);
        return buildInaccessibleTabPageData(
          { logicalTabId: tabId, external: false },
          scopedMissing ? 'detached_runtime_placeholder' : 'target_tab_missing',
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
        // If backend already executed this tool server-side, use the pre-filled result
        const serverResult = params?.call?.serverResult;
        if (serverResult) {
          return serverResult.success
            ? { success: true, output: serverResult.data }
            : { success: false, error: serverResult.error || 'Server-side execution failed' };
        }
        // Fallback: execute client-side (old backend or missed interception)
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
        const scopedMissing = getTaskScopedTabIds().includes(routeTabId);
        return buildTabAccessToolError(
          runtimeCfg,
          { logicalTabId: routeTabId, external: false },
          scopedMissing ? 'detached_runtime_placeholder' : 'target_tab_missing',
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
    listSessionTabs: () => {
      if (!sessionCoordinator) return [];
      const visibleTabs = sessionCoordinator.listTabs({ scope: 'all' });
      const allStateTabs = Array.isArray(sessionCoordinator.getState()?.tabs)
        ? sessionCoordinator.getState()!.tabs
        : [];
      const scopedIds = new Set(getTaskScopedTabIds());
      const merged = new Map<number, any>();
      const append = (tab: any) => {
        const tabId = Number(tab?.logicalTabId || tab?.id);
        if (!Number.isFinite(tabId) || tabId <= 0) return;
        merged.set(tabId, {
          ...(merged.get(tabId) || {}),
          ...tab,
          logicalTabId: tabId,
          id: tabId,
        });
      };

      for (const tab of visibleTabs) append(tab);
      for (const tab of allStateTabs) {
        const tabId = Number(tab?.logicalTabId);
        if (!Number.isFinite(tabId) || tabId <= 0) continue;
        if (tab.runtimeId || tab.external || scopedIds.has(tabId)) {
          append(tab);
        }
      }
      return [...merged.values()].sort((a, b) => Number(a.logicalTabId) - Number(b.logicalTabId));
    },
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
        pageConfig: resolveEffectivePageCaptureConfig(currentConfig),
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
      enqueueServerRunCancelRepair(pendingRun.id, reason, { attemptImmediately: true });
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
      setUiStatus(undefined);
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
    sessionCoordinator?.endTask(reason);
    sessionCoordinator?.setActiveRun(undefined);
    sessionCoordinator?.setWorkerContext(undefined);
    setUiStatus(undefined);
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
    panel: {
      resizable: cfg.ui?.panel?.resizable !== false,
    },
    shortcuts: getRenderableShortcuts(sanitizeShortcutList(cfg.ui?.shortcuts || [])),
    greeting: resolveEffectiveGreetingConfig(cfg),
    voice: resolveEffectiveVoiceConfig(cfg),
    visitorName: resolvedVisitor?.name,
    onVoiceTelemetry: (event, payload) => {
      recordVoiceTelemetryEvent(event, payload);
    },
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
      const claimed = takeControlOfActiveRun();
      if (!claimed) {
        appendUiMessage('system', 'Unable to acquire control right now. Try again in a moment.', true);
      } else {
        appendTimelineEvent({
          kind: 'status',
          title: 'Control requested',
          detail: 'This tab is now the active Rover controller for the current task.',
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
        const currentPending = sanitizePendingRun(runtimeState?.pendingRun);
        hideTaskSuggestion();
        if (!currentPending || currentPending.id !== suggestion.runId) {
          setUiStatus('Previous task is no longer resumable.');
          return;
        }
        maybeAutoResumePendingRun({ overridePolicyAction: 'auto_resume' });
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
        const currentPendingId = String(runtimeState?.pendingRun?.id || '').trim();
        hideTaskSuggestion();
        if (!currentPendingId || currentPendingId !== suggestion.runId) {
          return;
        }
        abandonPendingRunLocally({
          reason: 'resume_declined_by_user',
          statusText: 'Resume cancelled. Start a new task when you are ready.',
          runId: suggestion.runId,
          cancelReason: 'resume_declined_by_user',
          timelineTitle: 'Resume cancelled',
          timelineDetail: 'Interrupted run was cancelled by user action.',
          timelineStatus: 'info',
        });
        return;
      }
      dispatchUserPrompt(suggestion.text, {
        bypassSuggestion: true,
      });
    },
    onSwitchConversation: (conversationId) => {
      if (!taskOrchestrator || !runtimeState) return;
      // Save current task scroll position
      const currentTask = taskOrchestrator.getActiveTask();
      if (currentTask && ui) {
        currentTask.scrollPosition = ui.getScrollPosition();
      }
      const sharedActiveRunId = String(sessionCoordinator?.getState()?.activeRun?.runId || '').trim();
      const localActiveRunId = String(runtimeState.pendingRun?.id || '').trim();
      const hasLiveRun = !!(localActiveRunId || sharedActiveRunId);
      if (currentTask && currentTask.taskId !== conversationId && hasLiveRun) {
        appendUiMessage('system', 'Finish the active run before switching conversations.', true);
        return;
      }
      // Switch to target task
      const target = taskOrchestrator.switchActiveTask(conversationId);
      if (!target) return;
      restoreRuntimeStateFromTaskRecord(target, { replayUi: true });
      runtimeState.activeTaskId = conversationId;
      if (ui) {
        requestAnimationFrame(() => {
          if (target.scrollPosition != null) {
            ui!.setScrollPosition(target.scrollPosition);
          }
        });
        ui.setActiveConversationId(conversationId);
      }
      syncOrchestratorConversationList();
      persistRuntimeState();
    },
    onDeleteConversation: (conversationId) => {
      if (!taskOrchestrator) return;
      taskOrchestrator.deleteTask(conversationId);
      syncOrchestratorConversationList();
      persistRuntimeState();
    },
    onResumeTask: (taskId) => {
      if (!taskOrchestrator) return;
      const result = taskOrchestrator.dispatch(taskId, { type: 'RESUME' });
      if (result.accepted) {
        ui?.hidePausedTaskBanner();
        taskOrchestrator.assignWorker(taskId, { /* worker config from current init */ } as any);
        syncOrchestratorConversationList();
        persistRuntimeState();
      }
    },
    onCancelPausedTask: (taskId) => {
      if (!taskOrchestrator) return;
      const result = taskOrchestrator.dispatch(taskId, { type: 'CANCEL', reason: 'user_cancelled_paused_task' });
      if (result.accepted) {
        ui?.hidePausedTaskBanner();
        taskOrchestrator.archiveTask(taskId);
        syncOrchestratorConversationList();
        persistRuntimeState();
      }
    },
    onTabClick: (logicalTabId) => {
      // Request tab switch via session coordinator
      sessionCoordinator?.switchToLogicalTab(logicalTabId);
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
  replayTransientStatusFromRuntime(runtimeState);
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

  // Navigation tracking: detect SPA navigations for shared-tab sync and deep-link handling.
  const navigationHandler = () => {
    sessionCoordinator?.registerCurrentTab(window.location.href, document.title);
    sessionCoordinator?.broadcastNavigation(window.location.href, document.title);
    maybeHandleBrowserReceipt('navigation');
    maybeHandleLaunchAttach('navigation');
    maybeHandleDeepLink('navigation');
  };

  if (!_origPushState) _origPushState = History.prototype.pushState;
  if (!_origReplaceState) _origReplaceState = History.prototype.replaceState;
  const boundPush = _origPushState.bind(history);
  const boundReplace = _origReplaceState.bind(history);
  history.pushState = function (...args: Parameters<typeof History.prototype.pushState>) {
    const result = boundPush(...args);
    setTimeout(navigationHandler, 0);
    return result;
  };
  history.replaceState = function (...args: Parameters<typeof History.prototype.replaceState>) {
    const result = boundReplace(...args);
    setTimeout(navigationHandler, 0);
    return result;
  };
  addTrackedListener(window, 'popstate', navigationHandler);

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
  if (_booted) {
    shutdown();
  }
  _booted = true;

  runtimeStateStore = createRuntimeStateStore<PersistedRuntimeState>();
  runtimeId = getOrCreateRuntimeId(cfg.siteId);
  resolvedVisitorId = resolveVisitorId(cfg);
  resolvedVisitor = cfg.visitor || loadPersistedVisitor(cfg.siteId);
  greetingDismissed = false;
  greetingShownInSession = false;
  clearGreetingTimers();
  clearPreservedWidgetOpenGuard();
  backendSiteConfig = null;
  resumeContextValidated = false;
  const explicitSessionId = cfg.sessionId?.trim();
  const hintedRuntimeStorageKey = readRuntimeStateKeyHint(cfg.siteId);
  const visitorSessionIdHint =
    !explicitSessionId && cfg.sessionScope !== 'tab' && resolvedVisitorId
      ? createVisitorSessionId(cfg.siteId, resolvedVisitorId)
      : undefined;
  const initialRuntimeStorageKey = getRuntimeStateKey(cfg.siteId, explicitSessionId || visitorSessionIdHint);
  const initialLegacyStorageKey = getRuntimeStateLegacyKey(cfg.siteId);
  const initialStorageCandidates = Array.from(new Set([
    explicitSessionId ? initialRuntimeStorageKey : hintedRuntimeStorageKey,
    initialRuntimeStorageKey,
    hintedRuntimeStorageKey,
    visitorSessionIdHint ? getRuntimeStateKey(cfg.siteId, visitorSessionIdHint) : undefined,
    initialLegacyStorageKey,
  ].filter((value): value is string => !!value)));
  let loaded: PersistedRuntimeState | null = null;
  let loadedStorageKey: string | null = null;
  for (const candidateKey of initialStorageCandidates) {
    const candidateState = loadPersistedState(candidateKey);
    if (!candidateState) continue;
    loaded = candidateState;
    loadedStorageKey = candidateKey;
    break;
  }
  runtimeStorageKey = loadedStorageKey || initialRuntimeStorageKey;
  runtimeStorageLegacyKey = initialLegacyStorageKey !== runtimeStorageKey
    ? initialLegacyStorageKey
    : null;
  const asyncHydrationFallbackKeys = initialStorageCandidates.filter(key => key !== runtimeStorageKey);
  writeRuntimeStateKeyHint(cfg.siteId, runtimeStorageKey);

  // Check for cross-domain resume cookie (e.g. navigating from rtrvr.ai → rover.rtrvr.ai).
  // Per-origin storage is empty on the new subdomain, but the cookie carries the session ID
  // and pending run so Rover can pick up where it left off.
  let crossDomainResume = !loaded
    ? readCrossDomainResumeCookie(cfg.siteId, {
      currentUrl: window.location.href,
      currentHost: window.location.hostname,
      requireTargetMatch: true,
    })
    : null;
  if (!loaded && !crossDomainResume) {
    const looseResume = readCrossDomainResumeCookie(cfg.siteId, {
      currentHost: window.location.hostname,
      requireTargetMatch: false,
    });
    if (looseResume) {
      recordTelemetryEvent('status', {
        event: 'resume_cookie_rejected',
        reason: 'target_or_host_mismatch',
      });
      clearCrossDomainResumeCookie(cfg.siteId);
    }
  }
  if (crossDomainResume) {
    clearCrossDomainResumeCookie(cfg.siteId);
    crossDomainResumeActive = true;
    resumeContextValidated = true;
    if (crossDomainResume.openIntent === 'preserve_if_running') {
      setPreservedWidgetOpenGuard({
        runId: crossDomainResume.pendingRun?.id,
        taskId: crossDomainResume.activeTask?.taskId,
      });
    }
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
    if (shouldPreserveWidgetOpenOnResume(crossDomainResume.openIntent)) {
      seeded.uiHidden = false;
      seeded.uiOpen = true;
    }
    effectiveLoaded = seeded;
  }

  runtimeState = normalizePersistedState(effectiveLoaded, fallbackSessionId, runtimeId);

  if (desiredSessionId && runtimeState.sessionId !== desiredSessionId) {
    runtimeState = createDefaultRuntimeState(desiredSessionId, runtimeId);
  }
  const handoffBootstrap = consumeNavigationHandoffBootstrap(cfg.siteId);

  currentTaskBoundaryId = resolveTaskBoundaryIdFromState(runtimeState);
  if (handoffBootstrap && runtimeState.activeTask?.status === 'running') {
    resumeContextValidated = true;
    if (shouldPreserveWidgetOpenOnResume(handoffBootstrap.openIntent)) {
      runtimeState.uiHidden = false;
      runtimeState.uiOpen = true;
      setPreservedWidgetOpenGuard({
        runId: handoffBootstrap.runId,
        taskId: runtimeState.activeTask?.taskId,
      });
    }
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
  applyPreservedWidgetOpenState(runtimeState);

  currentConfig = {
    ...cfg,
    deepLink: resolveDeepLinkConfig(cfg.deepLink),
    pageConfig: sanitizeResolvedPageCaptureConfig(cfg.pageConfig),
    visitorId: resolvedVisitorId || cfg.visitorId,
    sessionId: desiredSessionId || runtimeState.sessionId,
    domainScopeMode: normalizeDomainScopeMode(cfg.domainScopeMode),
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
      actionTimeoutMs: normalizeTimingNumber(cfg.timing?.actionTimeoutMs, DEFAULT_ACTION_TIMEOUT_MS, 120_000),
      domSettleDebounceMs: normalizeTimingNumber(cfg.timing?.domSettleDebounceMs, 8, 500),
      domSettleMaxWaitMs: normalizeTimingNumber(cfg.timing?.domSettleMaxWaitMs, 80, 5000),
      domSettleRetries: normalizeTimingNumber(cfg.timing?.domSettleRetries, 0, 6),
      sparseTreeRetryDelayMs: normalizeTimingNumber(cfg.timing?.sparseTreeRetryDelayMs, 20, 1000),
      sparseTreeRetryMaxAttempts: normalizeTimingNumber(cfg.timing?.sparseTreeRetryMaxAttempts, 0, 4),
    },
    transport: {
      activation: normalizeTransportActivation(cfg.transport?.activation),
      idleCloseMs: normalizeTransportIdleCloseMs(cfg.transport?.idleCloseMs),
    },
    stability: {
      maxPersistBytes: normalizeStabilityByteLimit(
        cfg.stability?.maxPersistBytes,
        ROVER_V2_PERSIST_CAPS.localPersistBytes,
      ),
      maxSnapshotBytes: normalizeStabilityByteLimit(
        cfg.stability?.maxSnapshotBytes,
        ROVER_V2_PERSIST_CAPS.snapshotBytes,
      ),
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
      rover_v2_kernel_runtime: normalizeKernelRuntimeFeature(cfg.features?.rover_v2_kernel_runtime),
    },
  };

  runtimeState.sessionId = currentConfig.sessionId!;
  runtimeState.runtimeId = runtimeId;
  runtimeStorageKey = getRuntimeStateKey(cfg.siteId, runtimeState.sessionId);
  runtimeStorageLegacyKey = runtimeStorageKey !== getRuntimeStateLegacyKey(cfg.siteId)
    ? getRuntimeStateLegacyKey(cfg.siteId)
    : null;
  writeRuntimeStateKeyHint(cfg.siteId, runtimeStorageKey);
  runtimeState.executionMode = runtimeState.executionMode || 'controller';
  runtimeState.timeline = sanitizeTimelineEvents(runtimeState.timeline);
  runtimeState.uiMessages = sanitizeUiMessages(runtimeState.uiMessages);
  runtimeState.activeTask = sanitizeTask(runtimeState.activeTask, createDefaultTaskState('boot'));
  if (isTerminalTaskStatus(runtimeState.activeTask?.status)) {
    runtimeState.pendingRun = undefined;
    runtimeState.workerState = undefined;
    crossDomainResumeActive = false;
    resumeContextValidated = false;
    clearPreservedWidgetOpenGuard();
    clearCrossDomainResumeCookie(cfg.siteId);
    clearNavigationHandoffBootstrap(cfg.siteId);
  }
  runtimeState.taskEpoch = Math.max(1, Number(runtimeState.taskEpoch) || 1);
  currentMode = runtimeState.executionMode;
  if (resolvedVisitor) syncVisitorToAllStores(cfg.siteId, resolvedVisitor);

  // Initialize task orchestrator from persisted multi-task state
  const orchestratorOptions: TaskOrchestratorOptions = {
    maxConcurrentWorkers: (cfg.task as any)?.maxConcurrentWorkers ?? 2,
    maxQueuedTasks: (cfg.task as any)?.maxQueuedTasks ?? 5,
    maxArchivedTasks: (cfg.task as any)?.maxArchivedTasks ?? 10,
  };
  if (runtimeState.tasks && Object.keys(runtimeState.tasks).length > 0) {
    taskOrchestrator = TaskOrchestrator.fromPersistedState(
      { tasks: runtimeState.tasks, activeTaskId: runtimeState.activeTaskId, taskOrder: runtimeState.taskOrder },
      orchestratorOptions,
    );
  } else {
    taskOrchestrator = TaskOrchestrator.fromV1State(runtimeState, orchestratorOptions);
    // Sync back to runtime state
    const { tasks, activeTaskId, taskOrder } = taskOrchestrator.toPersistedState();
    runtimeState.tasks = tasks;
    runtimeState.activeTaskId = activeTaskId;
    runtimeState.taskOrder = taskOrder;
  }
  const bootActiveTask = taskOrchestrator.getActiveTask();
  if (bootActiveTask) {
    restoreRuntimeStateFromTaskRecord(bootActiveTask, { replayUi: false });
  }

  persistRuntimeState();

  // Mark this tab as alive — sessionStorage survives refresh but is cleared on tab close
  try { sessionStorage.setItem(`rover:tab-alive:${cfg.siteId}`, '1'); } catch { /* ignore */ }

  workerReady = false;
  sessionReady = false;
  autoResumeAttempted = false;
  autoResumeSessionWaitAttempts = 0;
  lastObserverPauseApplied = null;

  // Restore session token from sessionStorage (survives same-origin navigation/refresh)
  try {
    const cached = sessionStorage.getItem(`rover:sess:${cfg.siteId}`);
    if (cached) {
      const { t, e } = JSON.parse(cached);
      if (t && typeof t === 'string' && t.startsWith('rvrsess_') && Number(e) > Date.now() + 2_000) {
        updateRuntimeSessionToken(t, Number(e));
      }
    }
  } catch { /* ignore */ }

  createRuntime(currentConfig);
  void ensureRoverServerRuntime(currentConfig);
  maybeHandleBrowserReceipt('boot');
  maybeHandleLaunchAttach('boot');
  maybeHandleDeepLink('boot');

  // If no server runtime needed (no auth config), or if we already have a valid
  // session token (from sessionStorage/cross-domain cookie), mark session ready
  // immediately. onSession callback will re-confirm when the server responds.
  const hasCachedToken = !!(runtimeSessionToken && runtimeSessionTokenExpiresAt > Date.now() + 2_000);
  if (!roverServerRuntime || hasCachedToken) {
    sessionReady = true;
  }
  if (runtimeStorageKey) {
    void applyAsyncRuntimeStateHydration(
      runtimeStorageKey,
      asyncHydrationFallbackKeys.length
        ? asyncHydrationFallbackKeys
        : (runtimeStorageLegacyKey ? [runtimeStorageLegacyKey] : undefined),
    );
  }
  ensureUnloadHandler();
  syncMainWorldObserverPause(true);

  // Safety timeout: if cross-domain cloud checkpoint never arrives, resume anyway
  if (crossDomainResumeActive) {
    setTimeout(() => {
      if (crossDomainResumeActive && !autoResumeAttempted) {
        crossDomainResumeActive = false;
        maybeAutoResumePendingRun();
      }
    }, CROSS_DOMAIN_PULL_FIRST_TIMEOUT_MS);
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
    requestSigned,
    registerPromptContextProvider,
    registerTool,
    identify,
    on,
  };

  ensureBuiltInToolsRegistered();
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
    deepLink: resolveDeepLinkConfig({
      ...currentConfig.deepLink,
      ...cfg.deepLink,
    }),
    pageConfig:
      cfg.pageConfig !== undefined
        ? sanitizeResolvedPageCaptureConfig(cfg.pageConfig)
        : currentConfig.pageConfig,
    domainScopeMode: normalizeDomainScopeMode(cfg.domainScopeMode ?? currentConfig.domainScopeMode),
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
        DEFAULT_ACTION_TIMEOUT_MS,
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
    transport: {
      ...currentConfig.transport,
      ...cfg.transport,
      activation: normalizeTransportActivation(
        cfg.transport?.activation ?? currentConfig.transport?.activation,
      ),
      idleCloseMs: normalizeTransportIdleCloseMs(
        cfg.transport?.idleCloseMs ?? currentConfig.transport?.idleCloseMs,
      ),
    },
    stability: {
      ...currentConfig.stability,
      ...cfg.stability,
      maxPersistBytes: normalizeStabilityByteLimit(
        cfg.stability?.maxPersistBytes ?? currentConfig.stability?.maxPersistBytes,
        ROVER_V2_PERSIST_CAPS.localPersistBytes,
      ),
      maxSnapshotBytes: normalizeStabilityByteLimit(
        cfg.stability?.maxSnapshotBytes ?? currentConfig.stability?.maxSnapshotBytes,
        ROVER_V2_PERSIST_CAPS.snapshotBytes,
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
      rover_v2_kernel_runtime: normalizeKernelRuntimeFeature(
        cfg.features?.rover_v2_kernel_runtime ?? currentConfig.features?.rover_v2_kernel_runtime,
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
      voice: {
        ...currentConfig.ui?.voice,
        ...cfg.ui?.voice,
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
    runtimeStorageKey = getRuntimeStateKey(currentConfig.siteId, runtimeState.sessionId);
    runtimeStorageLegacyKey = runtimeStorageKey !== getRuntimeStateLegacyKey(currentConfig.siteId)
      ? getRuntimeStateLegacyKey(currentConfig.siteId)
      : null;
    writeRuntimeStateKeyHint(currentConfig.siteId, runtimeStorageKey);
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
        domainScopeMode: normalizeDomainScopeMode(cfg.domainScopeMode ?? currentConfig.domainScopeMode),
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
      pageConfig: resolveEffectivePageCaptureConfig(currentConfig),
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
    if (cfg.openOnInit || shouldPreserveWidgetOpenForState(runtimeState)) open();
    else close();
  }
  maybeHandleBrowserReceipt('update');
  maybeHandleLaunchAttach('update');
  maybeHandleDeepLink('update');
  syncMainWorldObserverPause();
}

export function shutdown(): void {
  clearPreservedWidgetOpenGuard();
  hideTaskSuggestion();
  persistRuntimeStateImmediate();
  void flushLaunchEvents(true);
  void flushTelemetry(true);
  stopTelemetry();
  cloudCheckpointClient?.markDirty();
  cloudCheckpointClient?.syncNow({ push: true, pull: false });
  cloudCheckpointClient?.stop();
  cloudCheckpointClient = null;
  roverServerRuntime?.stop();
  roverServerRuntime = null;
  runtimeSessionToken = undefined;
  runtimeSessionTokenExpiresAt = 0;
  runtimeServerEpoch = 1;
  setServerAcceptedRunId(undefined);
  lastAppliedServerSnapshotKey = '';
  sessionCoordinator?.stop();
  sessionCoordinator = null;

  taskOrchestrator?.shutdown();
  taskOrchestrator = null;

  worker?.terminate();
  worker = null;
  ui?.destroy();
  ui = null;
  bridge = null;
  currentConfig = null;
  workerReady = false;
  autoResumeAttempted = false;
  autoResumeSessionWaitAttempts = 0;
  if (autoResumeRetryTimer) {
    clearTimeout(autoResumeRetryTimer);
    autoResumeRetryTimer = null;
  }
  if (serverCancelRepairTimer) {
    clearTimeout(serverCancelRepairTimer);
    serverCancelRepairTimer = null;
  }
  serverCancelRepairInFlight = false;
  pendingServerRunCancelRepairs.clear();
  latestAssistantByRunId.clear();
  ignoredRunIds.clear();
  externalContextCache.clear();
  clearPendingLaunchAttach();
  clearPendingDeepLinkShortcut();
  launchAttachInFlightKey = '';
  launchLastHandledKey = '';
  launchLastIgnoredDisabledKey = '';
  resetActiveLaunchBinding();
  deepLinkLastHandledKey = '';
  deepLinkLastIgnoredDisabledKey = '';
  clearPendingBrowserReceipt();
  browserReceiptLastHandledKey = '';
  browserReceiptClaimInFlightKey = '';
  activePublicTaskContext = null;
  promptContextProviders.clear();
  builtInToolsRegistered = false;
  agentNavigationPending = false;
  currentTaskBoundaryId = '';
  runtimeId = '';
  resolvedVisitorId = undefined;
  resolvedVisitor = undefined;
  greetingDismissed = false;
  greetingShownInSession = false;
  clearGreetingTimers();
  backendSiteConfig = null;
  lastEffectivePageCaptureConfigJson = '';
  suppressCheckpointSync = false;
  telemetryInFlight = false;
  telemetryPausedAuth = false;
  telemetryBuffer = [];
  telemetrySeq = 0;
  telemetryLastStatusAt = 0;
  telemetryLastCheckpointStateAt = 0;
  telemetryLastFlushAt = 0;
  telemetryFlushPending = false;
  if (telemetryFastLaneTimer) {
    clearTimeout(telemetryFastLaneTimer);
    telemetryFastLaneTimer = null;
  }
  lastPersistSignature = '';
  lastQuestionPromptFlushSignature = '';
  currentMode = 'controller';
  isTransportController = true;
  pendingTaskSuggestion = null;
  runtimeStateStore = null;
  lastObserverPauseApplied = null;
  transportIdleDeadline = 0;
  try {
    const clearPaused = (window as any).rtrvrAIClearObserverPause;
    if (typeof clearPaused === 'function') clearPaused();
  } catch {
    // no-op
  }
  instance = null;

  // Remove all tracked event listeners
  for (const entry of _registeredListeners) {
    try {
      entry.target.removeEventListener(entry.event, entry.handler, entry.options);
    } catch { /* ignore */ }
  }
  _registeredListeners.length = 0;

  // Unwrap history monkey-patches
  if (_origPushState) {
    try { History.prototype.pushState = _origPushState; } catch { /* ignore */ }
    _origPushState = null;
  }
  if (_origReplaceState) {
    try { History.prototype.replaceState = _origReplaceState; } catch { /* ignore */ }
    _origReplaceState = null;
  }

  // Reset boot guards so ensureUnloadHandler() can re-register on next boot
  unloadHandlerInstalled = false;
  visibilitySyncInstalled = false;
  _booted = false;
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
  clearPreservedWidgetOpenGuard();
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
  clearPreservedWidgetOpenGuard();
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

export async function requestSigned(input: string | URL, init: RequestInit = {}): Promise<Response> {
  if (!currentConfig) {
    throw new Error('Rover is not booted.');
  }
  await ensureRoverServerRuntime(currentConfig);
  await roverServerRuntime?.ensureSession(false);
  const sessionToken =
    roverServerRuntime?.getSessionToken()
    || runtimeSessionToken
    || getRuntimeSessionToken(currentConfig);
  if (!sessionToken) {
    throw new Error('Rover signed request is unavailable without an active Rover session.');
  }
  const headers = new Headers(init.headers || undefined);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  if (runtimeState?.sessionId && !headers.has('X-Rover-Session-Id')) {
    headers.set('X-Rover-Session-Id', runtimeState.sessionId);
  }
  if (currentConfig.siteId && !headers.has('X-Rover-Site-Id')) {
    headers.set('X-Rover-Site-Id', currentConfig.siteId);
  }
  if (typeof window !== 'undefined' && !headers.has('X-Rover-Host')) {
    headers.set('X-Rover-Host', window.location.hostname);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

export function registerPromptContextProvider(provider: RoverPromptContextProvider): () => void {
  if (typeof provider !== 'function') {
    return () => undefined;
  }
  promptContextProviders.add(provider);
  return () => {
    promptContextProviders.delete(provider);
  };
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
    enqueueServerRunCancelRepair(runtimeState.pendingRun.id, reason, { attemptImmediately: true });
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
  autoResumeSessionWaitAttempts = 0;
  clearResumeArtifacts();
  // Create the task in the orchestrator first (FSM-primary path)
  if (taskOrchestrator) {
    const newRecord = taskOrchestrator.createTask(reason);
    taskOrchestrator.switchActiveTask(newRecord.taskId);
    taskOrchestrator.dispatch(newRecord.taskId, { type: 'START', reason });
  }

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
    runtimeState.transientStatus = undefined;
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
  setActiveTaskSeedChatLog([]);
  setUiStatus(undefined);
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
  autoResumeAttempted = false;
  autoResumeSessionWaitAttempts = 0;
  resumeContextValidated = false;
  clearResumeArtifacts();
  // FSM-first: dispatch CANCEL to orchestrator before kernel
  if (taskOrchestrator) {
    const activeTask = taskOrchestrator.getActiveTask();
    if (activeTask) {
      taskOrchestrator.dispatch(activeTask.taskId, { type: 'CANCEL', reason });
    }
  }
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
    enqueueServerRunCancelRepair(pendingRunId, reason, { attemptImmediately: true });
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
  setUiStatus(undefined);
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
  const currentAgentAttribution = readRuntimeAgentAttribution(getRuntimeSessionToken());
  const runtimeSnapshot = runtimeState ? cloneRuntimeStateForCheckpoint(runtimeState) : null;
  if (runtimeSnapshot && currentAgentAttribution) {
    (runtimeSnapshot as any).currentAgentAttribution = currentAgentAttribution;
  }
  return {
    mode: currentMode,
    runtimeId,
    runtimeState: runtimeSnapshot,
    sharedState: sessionCoordinator?.getState() || null,
    pendingTaskSuggestion,
    currentAgentAttribution,
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
  if (c === 'requestSigned') return 'requestSigned';
  if (c === 'registerPromptContextProvider') return 'registerPromptContextProvider';
  if (c === 'registerTool') return 'registerTool';
  if (c === 'on') return 'on';
  return undefined;
}

export const __roverInternalsForTests = {
  sanitizeWorkerState,
  cloneRuntimeStateForCheckpoint,
  getPersistGovernorConfig: () => ({
    minPersistIntervalMs: MIN_PERSIST_INTERVAL_MS,
    maxCoalesceDelayMs: MAX_PERSIST_COALESCE_DELAY_MS,
  }),
  getTelemetryFastLaneEvents: () => Array.from(TELEMETRY_FAST_LANE_EVENTS.values()),
  normalizePromptContextEntry,
  buildPublicRunStartedPayload,
  buildPublicRunLifecyclePayload,
};

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
  apiFn.requestSigned = requestSigned;
  apiFn.registerPromptContextProvider = registerPromptContextProvider;
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

        const dataDomainScopeMode = scriptEl.getAttribute('data-domain-scope-mode');
        if (dataDomainScopeMode === 'host_only' || dataDomainScopeMode === 'registrable_domain') {
          dataConfig.domainScopeMode = dataDomainScopeMode;
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
