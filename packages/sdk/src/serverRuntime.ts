import type { RoverPageCaptureConfig } from '@rover/shared/lib/types/index.js';

export type RoverServerExperienceConfig = {
  presence?: {
    assistantName?: string;
    ctaText?: string;
    iconMode?: 'logo' | 'mascot' | 'rover';
    draggable?: boolean;
    defaultAnchor?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';
    persistPosition?: boolean;
    idleAnimation?: 'breathe' | 'orbit' | 'none';
    firstRunIntro?: 'ambient' | 'headline' | 'none';
  };
  shell?: {
    openMode?: 'center_stage';
    mobileMode?: 'fullscreen_sheet';
    desktopSize?: 'compact' | 'stage' | 'cinema';
    desktopHeight?: 'tall' | 'full';
    dimBackground?: boolean;
    blurBackground?: boolean;
    safeAreaInsetPx?: number;
  };
  stream?: {
    layout?: 'single_column';
    maxVisibleLiveCards?: number;
    collapseCompletedSteps?: boolean;
    artifactAutoMinimize?: boolean;
    artifactOpenMode?: 'inline' | 'overlay';
  };
  inputs?: {
    text?: boolean;
    voice?: boolean;
    files?: boolean;
    acceptedMimeGroups?: Array<'images' | 'pdfs' | 'office' | 'text'>;
    allowMultipleFiles?: boolean;
    mobileCameraCapture?: boolean;
    attachmentLimit?: number;
    maxFileSizeMb?: number;
  };
  audio?: {
    narration?: {
      enabled?: boolean;
      defaultMode?: 'guided' | 'always' | 'off';
      rate?: number;
      language?: string;
      voicePreference?: 'auto' | 'system' | 'natural';
    };
  };
  motion?: {
    intensity?: 'calm' | 'balanced' | 'expressive';
    reducedMotionFallback?: 'reduce' | 'remove';
    performanceBudget?: 'standard' | 'high';
    actionSpotlight?: boolean;
    actionSpotlightColor?: string;
  };
  theme?: {
    mode?: 'auto' | 'light' | 'dark';
    accentColor?: string;
    surfaceStyle?: 'glass' | 'solid';
    radius?: 'soft' | 'rounded' | 'pill';
    fontFamily?: string;
  };
};

export type RoverServerFileDescriptor = {
  id: string;
  displayName: string;
  mimeType: string;
  storageUrl?: string;
  gcsUri?: string;
  sizeBytes?: number;
  downloadUrl?: string;
  expiresAt?: string;
  kind?: string;
  sourceStepId?: string;
  originalIndex?: number;
  data?: string;
};

export type RoverServerPolicy = {
  domainScopeMode?: 'host_only' | 'registrable_domain';
  cloudSandboxEnabled?: boolean;
  enableExternalWebContext?: boolean;
  externalScrapeMode?: 'off' | 'on_demand';
  externalAllowDomains?: string[];
  externalDenyDomains?: string[];
  uiMascotSoundEnabled?: boolean;
  uiMuted?: boolean;
};

export type RoverSnapshotMeta = {
  updatedAt?: number;
  digest?: string;
};

export type RoverServerVoiceConfig = {
  enabled?: boolean;
  language?: string;
  autoStopMs?: number;
};

export type RoverServerAiAccessConfig = {
  enabled?: boolean;
  allowCloudBrowser?: boolean;
  allowDelegatedHandoffs?: boolean;
  debugStreaming?: boolean;
};

export type RoverServerAgentDiscoveryConfig = {
  enabled?: boolean;
  preferExecution?: 'auto' | 'browser' | 'cloud';
  agentCardUrl?: string;
  roverSiteUrl?: string;
  llmsUrl?: string;
  hostSurfaceSelector?: string;
  discoverySurface?: {
    mode?: 'silent' | 'beacon' | 'integrated' | 'debug';
    branding?: 'site' | 'co' | 'rover';
    hostSurface?: 'auto' | 'existing-assistant' | 'floating-corner' | 'inline-primary';
    actionReveal?: 'click' | 'focus' | 'keyboard' | 'agent-handshake';
    beaconLabel?: string;
    agentModeEntryHints?: string[];
  };
};

export type RoverBusinessType =
  | 'ecommerce'
  | 'travel'
  | 'saas'
  | 'finance'
  | 'healthcare'
  | 'real_estate'
  | 'restaurant'
  | 'education'
  | 'support'
  | 'legal'
  | 'automotive'
  | 'general';

export type RoverServerSiteConfig = {
  shortcuts?: Array<Record<string, unknown>>;
  experience?: RoverServerExperienceConfig | null;
  greeting?: {
    text?: string;
    delay?: number;
    duration?: number;
    disabled?: boolean;
  };
  limits?: {
    shortcutMaxStored?: number;
    shortcutMaxRendered?: number;
  };
  voice?: RoverServerVoiceConfig;
  aiAccess?: RoverServerAiAccessConfig;
  pageConfig?: RoverPageCaptureConfig | null;
  agentDiscovery?: RoverServerAgentDiscoveryConfig | null;
  businessType?: RoverBusinessType;
  version?: string | number;
};

export type RoverLaunchExecutionTarget = 'browser_attach' | 'cloud_browser';
export type RoverLaunchDetailLevel = 'sanitized' | 'full' | 'debug';

export type RoverLaunchInputSpec =
  | {
      kind: 'prompt';
      prompt: string;
    }
  | {
      kind: 'shortcut';
      prompt: string;
      shortcutId: string;
      routing?: 'act' | 'planner' | 'auto';
      runKind?: 'guide' | 'task';
    };

export type RoverLaunchAttachResponse = {
  requestId: string;
  status?: string;
  executionTarget?: RoverLaunchExecutionTarget;
  detail?: RoverLaunchDetailLevel;
  targetUrl?: string;
  input?: RoverLaunchInputSpec;
  sessionId?: string;
  runId?: string;
  promptDispatchState?: 'pending' | 'started' | 'failed';
};

export type RoverRunBrowserClaimResponse = {
  runId: string;
  requestId: string;
  status?: string;
  executionTarget?: RoverLaunchExecutionTarget;
  detail?: RoverLaunchDetailLevel;
  targetUrl?: string;
  input?: RoverLaunchInputSpec;
  sessionId?: string;
  executionId?: string;
  runAccessToken?: string;
  workflowId?: string;
  workflowAccessToken?: string;
};

export type RoverPublicRunStatus =
  | 'pending'
  | 'waiting_browser'
  | 'running'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type RoverPublicRunPayload = {
  id: string;
  protocol?: 'a2w' | string;
  runId?: string;
  run: string;
  workflow?: string;
  status: RoverPublicRunStatus;
  open?: string;
  browserLink?: string;
  result?: {
    text?: string;
    blocks?: unknown[];
    summary?: string;
    observation?: {
      url?: string;
      title?: string;
      host?: string;
      summary?: string;
      snapshotDigest?: string;
      debugRef?: Record<string, unknown>;
    };
    transcript?: {
      messages?: Array<{
        role?: string;
        text?: string;
        blocks?: unknown[];
        ts?: number;
      }>;
      ref?: Record<string, unknown>;
    };
    artifacts?: Record<string, unknown>[];
    error?: string;
  };
  handoff?: {
    workflowId?: string;
    parentRunId?: string;
    sourceHost?: string;
    sourceUrl?: string;
    originalGoal?: string;
    instruction?: string;
    contextSummary?: string;
    expectedOutput?: string;
    lastObservation?: Record<string, unknown>;
  };
  input?: {
    questions?: unknown[];
    askUser?: Record<string, unknown>;
    message?: string;
  };
};

export type RoverLaunchIngestEvent = {
  type:
    | 'state_transition'
    | 'status_update'
    | 'tool_start'
    | 'tool_result'
    | 'assistant_output'
    | 'needs_input'
    | 'page_observation'
    | 'error';
  ts?: number;
  data?: Record<string, unknown>;
};

export type RoverServerProjection = {
  sessionId: string;
  epoch: number;
  activeRunId?: string;
  runStatus?: string;
  runMode?: 'act' | 'planner';
  events?: Array<{ seq: number; type: string; ts?: any; data?: Record<string, unknown> }>;
  tabs?: Array<{ logicalTabId: string; status: string; scope: string; url?: string; reason?: string; updatedAt?: number }>;
  snapshot?: Record<string, unknown>;
  snapshotMeta?: RoverSnapshotMeta;
  snapshotUpdatedAt?: number;
  resyncReason?: 'initial' | 'digest_changed' | 'forced';
};

type SessionStartResponse = {
  sessionId: string;
  sessionToken: string;
  sessionTokenExpiresAt?: number;
  epoch?: number;
  policy?: RoverServerPolicy;
  capabilities?: Record<string, boolean>;
  siteConfig?: RoverServerSiteConfig;
  projection?: RoverServerProjection | null;
  sseUrl?: string;
};

export type RunInputResponse = {
  runId?: string;
  acceptedMode?: 'act' | 'planner';
  requestedMode?: 'act' | 'planner' | 'auto';
  state?: string;
  continuePrompt?: boolean;
  message?: string;
  epoch?: number;
  seq?: number;
  currentEpoch?: number;
  currentSeq?: number;
  decisionReason?: string;
  decisionHint?: string;
  conflict?: {
    type: 'stale_seq' | 'stale_epoch' | 'active_run_exists';
    currentSeq?: number;
    currentEpoch?: number;
    retryable: boolean;
  };
  projection?: RoverServerProjection | null;
  routing?: { score?: number; reason?: string };
};

export type RunControlResponse = {
  action?: string;
  runId?: string;
  currentSeq?: number;
  projection?: RoverServerProjection | null;
};

export type ExternalContextResponse = {
  intent?: 'open_only' | 'read_context' | 'act';
  mode?: 'open_only';
  reason?: string;
  pageData?: Record<string, unknown>;
  url?: string;
  runId?: string;
  runStatus?: string;
  conflict?: {
    type: 'stale_seq' | 'stale_epoch' | 'active_run_exists';
    currentSeq?: number;
    currentEpoch?: number;
    retryable: boolean;
  };
};

export type TabEventDecisionResponse = {
  decision?: 'allow_same_tab' | 'open_new_tab' | 'block' | 'stale_run';
  reason?: string;
  decisionReason?: 'stale_seq_retryable' | 'stale_epoch_retryable' | 'stale_run' | 'policy_blocked' | 'allow_same_tab' | 'open_new_tab' | string;
  notice?: string;
  decisionHint?: string;
  retryAttempted?: boolean;
  retryExhausted?: boolean;
  staleRun?: boolean;
  staleRunReason?: string;
  currentRunId?: string;
  currentActiveRunId?: string;
  sessionId?: string;
  sessionEpoch?: number;
  currentSeq?: number;
  runId?: string;
  clientEventId?: string;
  conflict?: {
    type: 'stale_seq' | 'stale_epoch' | 'active_run_exists';
    currentSeq?: number;
    currentEpoch?: number;
    retryable: boolean;
  };
  adversarial?: {
    score?: number;
    reasons?: string[];
  };
};

type RoverPostConflict = {
  type: 'stale_seq' | 'stale_epoch' | 'active_run_exists';
  currentSeq?: number;
  currentEpoch?: number;
  retryable: boolean;
  decisionHint?: string;
  decisionReason?: string;
  runId?: string;
  sessionId?: string;
  clientEventId?: string;
};

type RoverPostJsonResult<T> = {
  ok: boolean;
  data: T | null;
  conflict?: RoverPostConflict;
  raw?: any;
};

export type RoverServerRuntimeCallbacks = {
  onSession?: (session: SessionStartResponse) => void;
  onProjection?: (projection: RoverServerProjection) => void;
  onError?: (error: unknown) => void;
};

export type RoverServerRuntimeOptions = RoverServerRuntimeCallbacks & {
  apiBase?: string;
  siteId: string;
  getSessionId: () => string | undefined;
  getBootstrapToken: () => string | undefined;
  getHost: () => string | undefined;
  getPageUrl: () => string | undefined;
  getTaskBoundaryId?: () => string | undefined;
  shouldKeepTransportActive?: () => boolean;
};

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toBaseUrl(apiBase?: string): string {
  const fallback = 'https://agent.rtrvr.ai';
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter/v2/rover')) {
    return base.slice(0, -('/extensionRouter/v2/rover'.length));
  }
  const versionedRouterMatch = base.match(/\/v\d+\/rover$/);
  if (versionedRouterMatch?.[0]) {
    return base.slice(0, -versionedRouterMatch[0].length);
  }
  if (base.endsWith('/extensionRouter')) return base.slice(0, -('/extensionRouter'.length));
  if (base.endsWith('/v2/rover')) return base.slice(0, -('/v2/rover'.length));
  return base;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function resolveRoverBaseCandidates(apiBase: string | undefined): string[] {
  const base = toBaseUrl(apiBase);
  const primary = `${base}/v2/rover`;
  const rawApiBase = normalizeUrl(String(apiBase || '').trim());
  const directV2 = rawApiBase.replace('/extensionRouter/v2/rover', '/v2/rover');
  const expectedSuffix = '/v2/rover';
  if (rawApiBase.endsWith(expectedSuffix) || rawApiBase.endsWith('/extensionRouter/v2/rover')) {
    return unique([directV2, primary]);
  }
  if (!rawApiBase && base === 'https://agent.rtrvr.ai') {
    return unique([primary, 'https://extensionrouter.rtrvr.ai/v2/rover']);
  }
  return unique([primary]);
}

export function resolveRoverV2Bases(apiBase?: string): string[] {
  return resolveRoverBaseCandidates(apiBase);
}

export function resolveRoverV2Base(apiBase?: string): string {
  return resolveRoverV2Bases(apiBase)[0] || `${toBaseUrl(apiBase)}/v2/rover`;
}

export function resolveRoverBases(apiBase: string | undefined): string[] {
  return resolveRoverV2Bases(apiBase);
}

export function resolveRoverBase(apiBase: string | undefined): string {
  return resolveRoverV2Base(apiBase);
}

function normalizeUrl(url: string): string {
  return String(url || '').replace(/\/+$/, '');
}

function createRequestNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isProjection(data: any): data is RoverServerProjection {
  return !!data && typeof data === 'object' && typeof data.sessionId === 'string' && Number.isFinite(Number(data.epoch));
}

function asOptionalNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toConflictFromPayload(payload: any): RoverPostConflict | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const errorCode = String(payload?.error || '').trim().toLowerCase();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const conflictData = data?.conflict && typeof data.conflict === 'object' ? data.conflict : {};
  const typeCandidate = String(conflictData?.type || errorCode || '').trim().toLowerCase();
  const normalizedType =
    typeCandidate === 'stale_seq' || typeCandidate === 'stale_epoch' || typeCandidate === 'active_run_exists'
      ? typeCandidate
      : undefined;
  if (!normalizedType) return undefined;
  const currentSeq = asOptionalNumber(data?.currentSeq ?? conflictData?.currentSeq);
  const currentEpoch = asOptionalNumber(data?.currentEpoch ?? data?.sessionEpoch ?? conflictData?.currentEpoch);
  const retryable =
    typeof conflictData?.retryable === 'boolean'
      ? conflictData.retryable
      : normalizedType === 'stale_seq' || normalizedType === 'stale_epoch';
  return {
    type: normalizedType,
    currentSeq,
    currentEpoch,
    retryable,
    decisionHint: typeof data?.decisionHint === 'string' ? data.decisionHint : undefined,
    decisionReason: typeof data?.decisionReason === 'string' ? data.decisionReason : undefined,
    runId: typeof data?.runId === 'string' ? data.runId : undefined,
    sessionId: typeof data?.sessionId === 'string' ? data.sessionId : undefined,
    clientEventId: typeof data?.clientEventId === 'string' ? data.clientEventId : undefined,
  };
}

function getAuthErrorCode(payload: any): string {
  const raw = String(
    payload?.error
    || payload?.data?.code
    || payload?.code
    || '',
  ).trim();
  return raw.toUpperCase();
}

async function parseJsonSafe(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    const text = await response.text().catch(() => '');
    return text ? { error: text } : undefined;
  }
}

function normalizeRunUrl(baseUrl: string, runUrlOrId: string, accessToken?: string): string {
  const raw = String(runUrlOrId || '').trim();
  const url =
    raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(`${toBaseUrl(baseUrl)}/v1/a2w/runs/${encodeURIComponent(raw)}`);
  if (accessToken && !url.searchParams.get('access')) {
    url.searchParams.set('access', accessToken);
  }
  return url.toString();
}

export class RoverServerRuntimeClient {
  private readonly options: RoverServerRuntimeOptions;
  private base: string;
  private baseCandidates: string[];
  private baseIndex = 0;
  private sessionToken: string | undefined;
  private sessionTokenExpiresAt = 0;
  private sessionId: string | undefined;
  private epoch = 1;
  private eventSource: EventSource | null = null;
  private pollTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private sseReconnectAttempts = 0;
  private static readonly SSE_BASE_DELAY_MS = 2_000;
  private static readonly SSE_MAX_DELAY_MS = 60_000;
  private static readonly SSE_MAX_JITTER_MS = 3_000;
  private static readonly SSE_MAX_RECONNECT_ATTEMPTS = 10;
  private started = false;
  private lastSeq = 0;
  private lastRunId = '';
  private lastSnapshotDigest = '';
  private activeRunId: string | undefined;
  private visibilityListener: (() => void) | null = null;
  private pollIntervalMs = 2_000;
  private commandInFlight = false;
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(options: RoverServerRuntimeOptions) {
    this.options = options;
    this.baseCandidates = resolveRoverBases(options.apiBase);
    this.base = this.baseCandidates[0] || resolveRoverBase(options.apiBase);
    this.sessionId = options.getSessionId();
  }

  getSessionToken(): string | undefined {
    return this.sessionToken;
  }

  getSessionTokenExpiresAt(): number {
    return this.sessionTokenExpiresAt;
  }

  getEpoch(): number {
    return Math.max(1, this.epoch);
  }

  getLastSeq(): number {
    return Math.max(0, this.lastSeq);
  }

  getActiveRunId(): string | undefined {
    return this.activeRunId;
  }

  setApiBase(apiBase?: string): void {
    this.baseCandidates = resolveRoverBases(apiBase);
    this.baseIndex = 0;
    this.base = this.baseCandidates[0] || resolveRoverBase(apiBase);
  }

  stop(): void {
    this.started = false;
    this.pauseBackgroundTransport();
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    this.sseReconnectAttempts = 0;
    this.lastSeq = 0;
    this.lastRunId = '';
    this.lastSnapshotDigest = '';
    this.activeRunId = undefined;
  }

  async start(): Promise<void> {
    this.started = true;
    if (typeof document !== 'undefined' && !this.visibilityListener) {
      this.visibilityListener = () => {
        this.handleVisibilityChange();
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
    await this.ensureSession(false);
    if (!this.shouldKeepTransportActive()) {
      this.pauseBackgroundTransport();
      return;
    }
    this.startProjectionStream();
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
  }

  private withCommandLock<T>(work: () => Promise<T>): Promise<T> {
    const run = async () => {
      this.commandInFlight = true;
      try {
        return await work();
      } finally {
        this.commandInFlight = false;
      }
    };
    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private hasOwnershipTransportAllowance(): boolean {
    if (typeof this.options.shouldKeepTransportActive === 'function') {
      try {
        return !!this.options.shouldKeepTransportActive();
      } catch {
        return false;
      }
    }
    return !!this.activeRunId;
  }

  private shouldKeepTransportActive(): boolean {
    return !this.isDocumentHidden() || this.hasOwnershipTransportAllowance();
  }

  private pauseBackgroundTransport(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer != null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollIntervalMs = 2_000;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleVisibilityChange(): void {
    if (!this.started) return;
    if (!this.shouldKeepTransportActive()) {
      this.pauseBackgroundTransport();
      return;
    }
    void this.ensureSession(false)
      .catch(error => this.reportError(error))
      .finally(() => {
        this.startProjectionStream();
        if (!this.eventSource) {
          this.startProjectionPolling();
        }
        void this.fetchProjection().catch(error => this.reportError(error));
      });
  }

  private getActiveBase(): string {
    if (!this.baseCandidates.length) return normalizeUrl(this.base);
    return normalizeUrl(this.baseCandidates[this.baseIndex] || this.base);
  }

  private rotateBaseCandidate(): void {
    if (this.baseCandidates.length <= 1) return;
    this.baseIndex = (this.baseIndex + 1) % this.baseCandidates.length;
    this.base = this.baseCandidates[this.baseIndex] || this.base;
  }

  private async requestJson(
    path: string,
    init: RequestInit,
  ): Promise<{ response: Response; json: any }> {
    if (!this.baseCandidates.length) {
      this.baseCandidates = resolveRoverBases(this.base);
      this.base = this.baseCandidates[0] || this.base;
      this.baseIndex = 0;
    }

    let lastError: unknown;
    const attempts = Math.max(1, this.baseCandidates.length);
    for (let offset = 0; offset < attempts; offset += 1) {
      const index = (this.baseIndex + offset) % attempts;
      const base = normalizeUrl(this.baseCandidates[index] || this.base);
      try {
        const response = await fetch(`${base}${path}`, init);
        const json = await parseJsonSafe(response);
        if (response.status === 404 || response.status === 405) {
          lastError = new Error(`Rover endpoint not found at ${base}${path}`);
          continue;
        }
        this.baseIndex = index;
        this.base = base;
        return { response, json };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(`Rover request failed for ${path}`);
  }

  private applySessionData(data: SessionStartResponse): void {
    if (data.sessionId) {
      this.sessionId = data.sessionId;
    }
    if (data.sessionToken) {
      this.sessionToken = data.sessionToken;
      this.sessionTokenExpiresAt = asNumber(data.sessionTokenExpiresAt, Date.now() + 8 * 60_000);
    }
    if (Number.isFinite(Number(data.epoch))) {
      this.epoch = Math.max(1, Number(data.epoch));
    }
    if (data.projection && isProjection(data.projection)) {
      this.applyProjection(data.projection);
    }
    this.options.onSession?.(data);
  }

  private applyProjection(projection: RoverServerProjection): void {
    const prevEpoch = this.epoch;
    const prevRunId = this.lastRunId;
    const prevSeq = this.lastSeq;
    const prevSnapshotDigest = this.lastSnapshotDigest;
    this.sessionId = projection.sessionId || this.sessionId;
    this.epoch = Math.max(1, Number(projection.epoch || this.epoch));
    const projectionRunId = String(projection.activeRunId || '');
    this.activeRunId = projectionRunId || undefined;
    if (projectionRunId !== this.lastRunId) {
      this.lastRunId = projectionRunId;
      this.lastSeq = 0;
    }
    const events = Array.isArray(projection.events) ? projection.events : [];
    if (events.length) {
      const seq = Number(events[events.length - 1]?.seq || 0);
      if (Number.isFinite(seq) && seq > this.lastSeq) this.lastSeq = seq;
    }
    const snapshotDigest =
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
    if (snapshotDigest) {
      this.lastSnapshotDigest = snapshotDigest;
    }
    if (this.isDocumentHidden() && !this.shouldKeepTransportActive()) {
      this.pauseBackgroundTransport();
    }
    const hasMaterialChange =
      this.epoch !== prevEpoch
      || projectionRunId !== prevRunId
      || this.lastSeq !== prevSeq
      || !!projection.snapshot
      || (snapshotDigest && snapshotDigest !== prevSnapshotDigest);
    if (!hasMaterialChange) return;
    this.options.onProjection?.(projection);
  }

  private shouldRefreshSessionToken(): boolean {
    if (!this.sessionToken) return true;
    const refreshSkewMs = 60_000;
    return Date.now() + refreshSkewMs >= this.sessionTokenExpiresAt;
  }

  async ensureSession(forceBootstrap = false): Promise<SessionStartResponse | null> {
    this.sessionId = this.options.getSessionId() || this.sessionId;
    if (!forceBootstrap && !this.shouldRefreshSessionToken()) {
      return null;
    }

    const bootstrapToken = this.options.getBootstrapToken();
    const baseBody: Record<string, unknown> = {
      siteId: this.options.siteId,
      sessionId: this.sessionId,
      requestedSessionId: this.sessionId,
      host: this.options.getHost(),
      url: this.options.getPageUrl(),
      pageUrl: this.options.getPageUrl(),
    };
    const includeSessionToken = !forceBootstrap && !!this.sessionToken;
    const body: Record<string, unknown> = {
      ...baseBody,
      ...(includeSessionToken ? { sessionToken: this.sessionToken } : {}),
      ...(bootstrapToken ? { bootstrapToken } : {}),
    };

    if (!body.sessionToken && !body.bootstrapToken) {
      return null;
    }

    const requestSessionOpen = async (payload: Record<string, unknown>) =>
      this.requestJson('/session/open', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
      });

    let { response, json } = await requestSessionOpen(body);
    if (
      response.status === 401
      && includeSessionToken
      && bootstrapToken
      && (
        getAuthErrorCode(json) === 'SESSION_TOKEN_EXPIRED'
        || getAuthErrorCode(json) === 'SESSION_TOKEN_INVALID'
        || getAuthErrorCode(json) === 'BOOTSTRAP_REQUIRED'
      )
    ) {
      this.sessionToken = undefined;
      this.sessionTokenExpiresAt = 0;
      ({ response, json } = await requestSessionOpen({
        ...baseBody,
        bootstrapToken,
      }));
    }

    if (!response.ok || !json?.success || !json?.data) {
      const authCode = getAuthErrorCode(json);
      const message = json?.data?.message || json?.error || `session/open failed (${response.status})`;
      const error = new Error(String(message));
      (error as any).code = authCode || undefined;
      throw error;
    }
    const data = json.data as SessionStartResponse;
    this.applySessionData(data);
    return data;
  }

  private syncCursorFromPayload(payload: any): void {
    if (!payload || typeof payload !== 'object') return;
    const currentEpoch = asOptionalNumber(payload?.currentEpoch ?? payload?.sessionEpoch);
    if (currentEpoch !== undefined) {
      this.epoch = Math.max(1, currentEpoch);
    }
    const currentSeq = asOptionalNumber(payload?.currentSeq);
    if (currentSeq !== undefined && currentSeq >= 0) {
      this.lastSeq = Math.max(this.lastSeq, currentSeq);
    }
  }

  private async postJson<T = any>(
    path: string,
    body: Record<string, unknown>,
    options?: { authRetryCount?: number },
  ): Promise<RoverPostJsonResult<T>> {
    await this.ensureSession(false);
    const payload = {
      ...body,
      requestNonce: createRequestNonce(),
      sessionToken: this.sessionToken,
      sessionId: body.sessionId || this.sessionId,
    };
    const { response, json } = await this.requestJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    const authRetryCount = Math.max(0, Number(options?.authRetryCount || 0));
    if (response.status === 401 && authRetryCount < 1) {
      const authCode = getAuthErrorCode(json);
      if (
        authCode === 'SESSION_TOKEN_EXPIRED'
        || authCode === 'SESSION_TOKEN_INVALID'
        || authCode === 'BOOTSTRAP_REQUIRED'
      ) {
        this.sessionToken = undefined;
        this.sessionTokenExpiresAt = 0;
        await this.ensureSession(true);
        return this.postJson<T>(path, body, { authRetryCount: authRetryCount + 1 });
      }
    }
    if (response.status === 409) {
      this.syncCursorFromPayload(json?.data);
      return {
        ok: false,
        data: (json?.data || null) as T | null,
        conflict: toConflictFromPayload(json),
        raw: json,
      };
    }
    if (!response.ok || !json?.success) {
      const message = json?.error || `request failed (${response.status})`;
      const error = new Error(String(message));
      (error as any).status = response.status;
      (error as any).code = String(json?.error || json?.data?.code || '').trim() || undefined;
      (error as any).details = json?.data || json;
      throw error;
    }
    this.syncCursorFromPayload(json?.data);
    return {
      ok: true,
      data: (json?.data || null) as T | null,
      raw: json,
    };
  }

  async submitRunInput(params: {
    message: string;
    files?: RoverServerFileDescriptor[];
    clientEventId?: string;
    continueRun?: boolean;
    forceNewRun?: boolean;
    runId?: string;
    requestedMode?: 'act' | 'planner' | 'auto';
  }): Promise<RunInputResponse | null> {
    return this.withCommandLock(async () => {
      const clientEventId =
        String(params.clientEventId || '').trim()
        || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : undefined);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await this.postJson<any>('/command', {
          type: 'RUN_INPUT',
          commandId: clientEventId,
          expectedEpoch: this.epoch,
          expectedSeq: this.lastSeq,
          payload: {
            runId: params.runId,
            message: params.message,
            files: Array.isArray(params.files) ? params.files : undefined,
            continueRun: !!params.continueRun,
            forceNewRun: !!params.forceNewRun,
            requestedMode: params.requestedMode,
            taskBoundaryId: this.options.getTaskBoundaryId?.(),
          },
        });
        if (!result.ok) {
          const envelope = result.data || null;
          const data = (envelope?.data || null) as RunInputResponse | null;
          if (isProjection(data?.projection)) {
            this.applyProjection(data.projection);
          }
          const conflictType = String(result.conflict?.type || '').trim();
          const retryableStale =
            result.conflict?.retryable !== false
            && (conflictType === 'stale_seq' || conflictType === 'stale_epoch');
          if (attempt === 0 && retryableStale) {
            continue;
          }
          return data;
        }
        const envelope = result.data || {};
        const data = (envelope?.data || null) as RunInputResponse | null;
        const nextRunId = String(envelope?.runId || data?.runId || '').trim();
        if (nextRunId) {
          this.activeRunId = nextRunId;
          this.lastRunId = nextRunId;
          if (Number(envelope?.seq || data?.seq || 0) === 0 && this.lastSeq > 0) {
            this.lastSeq = 0;
          }
        }
        if (Number.isFinite(Number(envelope?.epoch))) {
          this.epoch = Math.max(1, Number(envelope?.epoch));
        }
        if (Number.isFinite(Number(envelope?.seq))) {
          this.lastSeq = Math.max(0, Number(envelope?.seq || 0));
        }
        return data;
      }
      return null;
    });
  }

  async uploadAttachment(params: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
    sizeBytes?: number;
  }): Promise<RoverServerFileDescriptor | null> {
    const result = await this.postJson<{ file?: RoverServerFileDescriptor }>(
      '/attachments/upload',
      {
        fileName: params.fileName,
        mimeType: params.mimeType,
        dataBase64: params.dataBase64,
        sizeBytes: params.sizeBytes,
      },
    );
    if (!result.ok) {
      const message = (result.data as any)?.message || (result.raw as any)?.error || 'upload failed';
      throw new Error(String(message));
    }
    return (result.data as any)?.file || null;
  }

  async controlRun(params: {
    action: 'cancel' | 'end_task' | 'new_task' | 'continue';
    runId?: string;
    reason?: string;
    clientEventId?: string;
  }): Promise<RunControlResponse | null> {
    return this.withCommandLock(async () => {
      const clientEventId =
        String(params.clientEventId || '').trim()
        || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : undefined);

      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.postJson<any>('/command', {
          type: 'RUN_CONTROL',
          commandId: clientEventId,
          expectedEpoch: this.epoch,
          expectedSeq: this.lastSeq,
          payload: {
            action: params.action,
            runId: params.runId,
            reason: params.reason,
          },
        });
        if (!result.ok) {
          if (attempt === 0 && result.conflict?.retryable !== false) {
            continue;
          }
          return (result.data?.data || null) as RunControlResponse | null;
        }
        const envelope = result.data || {};
        const data = (envelope?.data || null) as RunControlResponse | null;
        if (Number.isFinite(Number(envelope?.seq))) {
          this.lastSeq = Math.max(0, Number(envelope.seq || 0));
        }
        if (isProjection(data?.projection)) {
          this.applyProjection(data.projection);
        }
        return data;
      }
      return null;
    });
  }

  async fetchExternalContext(params: {
    runId?: string;
    tabId?: string | number;
    url: string;
    intent?: 'open_only' | 'read_context' | 'act';
    message?: string;
    source?: 'google_search' | 'direct_url';
    adversarialScore?: number;
  }): Promise<ExternalContextResponse | null> {
    return this.withCommandLock(async () => {
      const runId = String(params.runId || this.activeRunId || this.lastRunId || '').trim() || undefined;
      const logicalTabId =
        typeof params.tabId === 'string' && params.tabId.trim()
          ? params.tabId.trim()
          : Number.isFinite(Number(params.tabId)) && Number(params.tabId) > 0
            ? String(Math.trunc(Number(params.tabId)))
            : undefined;
      const intent =
        params.intent === 'act' || params.intent === 'open_only' || params.intent === 'read_context'
          ? params.intent
          : 'read_context';
      const source = params.source === 'google_search' ? 'google_search' : 'direct_url';

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await this.postJson<ExternalContextResponse>('/context/external', {
          runId,
          logicalTabId,
          url: params.url,
          intent,
          source,
          message: params.message,
          adversarialScore: Number.isFinite(Number(params.adversarialScore))
            ? Number(params.adversarialScore)
            : undefined,
          expectedEpoch: this.epoch,
          expectedSeq: this.lastSeq,
        });

        if (!result.ok) {
          const conflictType = String(result.conflict?.type || '').trim();
          const staleRetryable =
            result.conflict?.retryable !== false
            && (conflictType === 'stale_seq' || conflictType === 'stale_epoch');
          if (attempt === 0 && staleRetryable) {
            continue;
          }
          return (result.data || null) as ExternalContextResponse | null;
        }

        return (result.data || null) as ExternalContextResponse | null;
      }

      return null;
    });
  }

  async sendTabEvent(params: {
    runId?: string;
    currentUrl?: string;
    targetUrl: string;
    logicalTabId?: string;
    message?: string;
    adversarialScore?: number;
    currentHost?: string;
    targetHost?: string;
    isCrossHost?: boolean;
    navigationClass?: 'same_host_in_scope' | 'cross_host_in_scope' | 'cross_registrable_external';
  }): Promise<TabEventDecisionResponse | null> {
    return this.withCommandLock(async () => {
      const clientEventId = createRequestNonce();
      const basePayload = {
        runId: params.runId,
        currentUrl: params.currentUrl,
        targetUrl: params.targetUrl,
        logicalTabId: params.logicalTabId,
        message: params.message,
        adversarialScore: params.adversarialScore,
        currentHost: params.currentHost,
        targetHost: params.targetHost,
        isCrossHost: params.isCrossHost,
        navigationClass: params.navigationClass,
        clientEventId,
      };

      const firstAttempt = await this.postJson<any>('/command', {
        type: 'TAB_EVENT',
        commandId: clientEventId,
        expectedEpoch: this.epoch,
        expectedSeq: this.lastSeq,
        payload: basePayload,
      });
      if (firstAttempt.ok) {
        const envelope = firstAttempt.data || {};
        const data = (envelope?.data || null) as TabEventDecisionResponse | null;
        if (Number.isFinite(Number(envelope?.epoch))) {
          this.epoch = Math.max(1, Number(envelope?.epoch || this.epoch));
        }
        if (Number.isFinite(Number(envelope?.seq))) {
          this.lastSeq = Math.max(0, Number(envelope?.seq || 0));
        }
        return data
          ? {
              ...data,
              clientEventId,
              retryAttempted: false,
              retryExhausted: false,
            }
          : null;
      }

      const conflict = firstAttempt.conflict;
      const isRetryableStaleConflict = conflict?.retryable && (conflict.type === 'stale_seq' || conflict.type === 'stale_epoch');
      if (isRetryableStaleConflict) {
        const retryAttempt = await this.postJson<any>('/command', {
          type: 'TAB_EVENT',
          commandId: clientEventId,
          expectedEpoch: this.epoch,
          expectedSeq: this.lastSeq,
          payload: basePayload,
        });
        if (retryAttempt.ok) {
          const envelope = retryAttempt.data || {};
          const retryData = (envelope?.data || null) as TabEventDecisionResponse | null;
          if (Number.isFinite(Number(envelope?.epoch))) {
            this.epoch = Math.max(1, Number(envelope?.epoch || this.epoch));
          }
          if (Number.isFinite(Number(envelope?.seq))) {
            this.lastSeq = Math.max(0, Number(envelope?.seq || 0));
          }
          return retryData
            ? {
                ...retryData,
                clientEventId,
                retryAttempted: true,
                retryExhausted: false,
              }
            : {
                clientEventId,
                retryAttempted: true,
                retryExhausted: false,
              };
        }

        const retryConflict = retryAttempt.conflict || conflict;
        const retryData = ((retryAttempt.data || firstAttempt.data || null)?.data || null) as TabEventDecisionResponse | null;
        void this.fetchProjection().catch(() => undefined);
        return {
          ...(retryData || {}),
          clientEventId,
          retryAttempted: true,
          retryExhausted: true,
          decisionReason:
            retryData?.decisionReason
            || retryConflict?.decisionReason
            || (retryConflict?.type === 'stale_epoch' ? 'stale_epoch_retryable' : 'stale_seq_retryable'),
          conflict: retryConflict
            ? {
                type: retryConflict.type,
                currentSeq: retryConflict.currentSeq,
                currentEpoch: retryConflict.currentEpoch,
                retryable: !!retryConflict.retryable,
              }
            : undefined,
        };
      }

      const data = ((firstAttempt.data || null)?.data || null) as TabEventDecisionResponse | null;
      if (conflict?.type) {
        void this.fetchProjection().catch(() => undefined);
      }
      return {
        ...(data || {}),
        clientEventId,
        retryAttempted: false,
        retryExhausted: !!conflict,
        conflict: conflict
          ? {
              type: conflict.type,
              currentSeq: conflict.currentSeq,
              currentEpoch: conflict.currentEpoch,
              retryable: !!conflict.retryable,
            }
          : data?.conflict,
      };
    });
  }

  async fetchProjection(): Promise<RoverServerProjection | null> {
    await this.ensureSession(false);
    if (!this.sessionToken || !this.sessionId) return null;
    const query = new URLSearchParams({
      sessionId: this.sessionId,
      seqAfter: String(this.lastSeq),
      sessionToken: this.sessionToken,
    });
    const { response, json } = await this.requestJson(`/state?${query.toString()}`, {
      method: 'GET',
    });
    const projectionCandidate =
      json?.data && typeof json.data === 'object' && isProjection(json.data?.projection)
        ? json.data.projection
        : json?.data;
    if (!response.ok || !json?.success || !isProjection(projectionCandidate)) {
      return null;
    }
    const projection = projectionCandidate as RoverServerProjection;
    this.applyProjection(projection);
    return projection;
  }

  async saveSnapshot(params: {
    checkpoint: Record<string, unknown>;
    updatedAt: number;
    version: number;
    seq?: number;
    chatSummary?: string;
    compactedPrevSteps?: unknown[];
    ttlHours?: number;
    visitorId?: string;
  }): Promise<boolean> {
    return this.withCommandLock(async () => {
      const result = await this.postJson<{ saved?: boolean }>('/snapshot', {
        checkpoint: params.checkpoint,
        updatedAt: params.updatedAt,
        version: params.version,
        seq: params.seq,
        chatSummary: params.chatSummary,
        compactedPrevSteps: params.compactedPrevSteps,
        ttlHours: params.ttlHours,
        visitorId: params.visitorId,
      });
      return !!result?.ok;
    });
  }

  /**
   * Send multiple requests as a single batched POST to /batch.
   * Reduces round-trips for telemetry + snapshot.
   */
  async sendBatch(requests: Array<{ path: string; body: Record<string, unknown> }>): Promise<any[]> {
    if (!requests.length) return [];
    const maxBatchSize = 5;
    const batch = requests.slice(0, maxBatchSize);
    const result = await this.postJson<{ results?: any[] }>('/batch', {
      requests: batch.map(r => ({ path: r.path, body: r.body })),
    });
    return result?.data?.results || [];
  }

  async attachLaunch(params: {
    requestId: string;
    attachToken: string;
  }): Promise<RoverLaunchAttachResponse | null> {
    const requestId = String(params.requestId || '').trim();
    const attachToken = String(params.attachToken || '').trim();
    if (!requestId || !attachToken) return null;
    const result = await this.postJson<RoverLaunchAttachResponse>(`/launches/${encodeURIComponent(requestId)}/attach`, {
      attachToken,
      roverAttach: attachToken,
      host: this.options.getHost?.(),
    });
    return result.ok ? (result.data || null) : null;
  }

  async claimBrowserRunReceipt(params: {
    receipt: string;
  }): Promise<RoverRunBrowserClaimResponse | null> {
    const receipt = String(params.receipt || '').trim();
    if (!receipt) return null;
    await this.ensureSession(false);
    const payload = {
      receipt,
      requestNonce: createRequestNonce(),
      sessionToken: this.sessionToken,
      sessionId: this.sessionId,
      host: this.options.getHost?.(),
    };
    if (!this.baseCandidates.length) {
      this.baseCandidates = resolveRoverBases(this.base);
      this.base = this.baseCandidates[0] || this.base;
      this.baseIndex = 0;
    }
    const agentBases = unique(this.baseCandidates.map(candidate => toBaseUrl(candidate)));
    let lastError: unknown;
    for (const base of agentBases) {
      try {
        const response = await fetch(`${base}/v1/a2w/runs/claim-browser`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
        });
        const json = await parseJsonSafe(response);
        if (!response.ok || !json?.success) {
          lastError = new Error(String(json?.error || `request failed (${response.status})`));
          (lastError as any).status = response.status;
          (lastError as any).details = json?.data || json;
          continue;
        }
        return (json.data || null) as RoverRunBrowserClaimResponse | null;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error('Browser receipt claim failed.');
  }

  async createSessionRootRun(params: {
    url: string;
    prompt: string;
    executionId?: string;
  }): Promise<RoverPublicRunPayload | null> {
    const url = String(params.url || '').trim();
    const prompt = String(params.prompt || '').trim();
    if (!url || !prompt) return null;
    await this.ensureSession(false);
    const payload = {
      url,
      prompt,
      executionId: String(params.executionId || '').trim() || undefined,
      requestNonce: createRequestNonce(),
      sessionToken: this.sessionToken,
      sessionId: this.sessionId,
      host: this.options.getHost?.(),
    };
    if (!this.baseCandidates.length) {
      this.baseCandidates = resolveRoverBases(this.base);
      this.base = this.baseCandidates[0] || this.base;
      this.baseIndex = 0;
    }
    const agentBases = unique(this.baseCandidates.map(candidate => toBaseUrl(candidate)));
    let lastError: unknown;
    for (const base of agentBases) {
      try {
        const response = await fetch(`${base}/v1/a2w/runs/session-root`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await parseJsonSafe(response);
        if (!response.ok || !json?.success) {
          lastError = new Error(String(json?.error || `request failed (${response.status})`));
          (lastError as any).status = response.status;
          (lastError as any).details = json?.data || json;
          continue;
        }
        return (json.data || null) as RoverPublicRunPayload | null;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error('Session root A2W run creation failed.');
  }

  async createRunHandoff(params: {
    parentRunId: string;
    runAccessToken: string;
    url: string;
    prompt?: string;
    instruction?: string;
    shortcutId?: string;
    contextSummary?: string;
    expectedOutput?: string;
    originalGoal?: string;
    lastObservation?: Record<string, unknown>;
    execution?: 'auto' | 'browser' | 'cloud';
  }): Promise<RoverPublicRunPayload | null> {
    const parentRunId = String(params.parentRunId || '').trim();
    const runAccessToken = String(params.runAccessToken || '').trim();
    const url = String(params.url || '').trim();
    if (!parentRunId || !runAccessToken || !url) return null;
    await this.ensureSession(false);
    const handoffUrl = normalizeRunUrl(toBaseUrl(this.base), parentRunId, runAccessToken)
      .replace(/\/+$/, '')
      .concat('/handoffs');
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    const prefer: string[] = [];
    if (params.execution) {
      prefer.push(`execution=${params.execution}`);
    }
    if (prefer.length) {
      headers.set('Prefer', prefer.join(', '));
    }
    const payload = {
      url,
      ...(String(params.prompt || '').trim() ? { prompt: String(params.prompt).trim() } : {}),
      ...(String(params.instruction || '').trim() ? { instruction: String(params.instruction).trim() } : {}),
      ...(String(params.shortcutId || '').trim() ? { shortcutId: String(params.shortcutId).trim() } : {}),
      ...(String(params.contextSummary || '').trim() ? { contextSummary: String(params.contextSummary).trim() } : {}),
      ...(String(params.expectedOutput || '').trim() ? { expectedOutput: String(params.expectedOutput).trim() } : {}),
      ...(String(params.originalGoal || '').trim() ? { originalGoal: String(params.originalGoal).trim() } : {}),
      ...(params.lastObservation && typeof params.lastObservation === 'object' ? { lastObservation: params.lastObservation } : {}),
      sessionToken: this.sessionToken,
      sessionId: this.sessionId,
      host: this.options.getHost?.(),
    };
    const response = await fetch(handoffUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await parseJsonSafe(response);
    if (!response.ok || !json?.success) {
      const message = String(json?.error || `request failed (${response.status})`);
      const error = new Error(message);
      (error as any).status = response.status;
      (error as any).details = json?.data || json;
      throw error;
    }
    return (json.data || null) as RoverPublicRunPayload | null;
  }

  async getPublicRun(runUrlOrId: string, options: { accessToken?: string; waitSeconds?: number } = {}): Promise<RoverPublicRunPayload | null> {
    const headers = new Headers({ Accept: 'application/json' });
    if (typeof options.waitSeconds === 'number' && options.waitSeconds > 0) {
      headers.set('Prefer', `wait=${Math.trunc(options.waitSeconds)}`);
    }
    const url = normalizeRunUrl(toBaseUrl(this.base), runUrlOrId, options.accessToken);
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });
    const json = await parseJsonSafe(response);
    if (!response.ok || !json?.success) {
      const message = String(json?.error || `request failed (${response.status})`);
      const error = new Error(message);
      (error as any).status = response.status;
      (error as any).details = json?.data || json;
      throw error;
    }
    return (json.data || null) as RoverPublicRunPayload | null;
  }

  async continuePublicRun(runUrlOrId: string, input: string, options: { accessToken?: string } = {}): Promise<RoverPublicRunPayload | null> {
    const message = String(input || '').trim();
    if (!message) return null;
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    const url = normalizeRunUrl(toBaseUrl(this.base), runUrlOrId, options.accessToken);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: message }),
    });
    const json = await parseJsonSafe(response);
    if (!response.ok || !json?.success) {
      const messageText = String(json?.error || `request failed (${response.status})`);
      const error = new Error(messageText);
      (error as any).status = response.status;
      (error as any).details = json?.data || json;
      throw error;
    }
    return (json.data || null) as RoverPublicRunPayload | null;
  }
  async ingestLaunchEvents(params: {
    requestId: string;
    runId?: string;
    events: RoverLaunchIngestEvent[];
  }): Promise<boolean> {
    const requestId = String(params.requestId || '').trim();
    const events = Array.isArray(params.events) ? params.events.filter(Boolean) : [];
    if (!requestId || !events.length) return false;
    const result = await this.postJson<{ accepted?: boolean }>('/events/ingest', {
      launchRequestId: requestId,
      runId: String(params.runId || '').trim() || undefined,
      events: events.map(event => ({
        type: event.type,
        ts: event.ts,
        data: event.data,
      })),
    });
    return result.ok && result.data?.accepted !== false;
  }

  private scheduleProjectionPoll(delayMs: number): void {
    if (this.pollTimer != null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = window.setTimeout(async () => {
      this.pollTimer = null;
      if (!this.started || !this.shouldKeepTransportActive()) return;
      const prevEpoch = this.epoch;
      const prevSeq = this.lastSeq;
      const prevSnapshotDigest = this.lastSnapshotDigest;
      try {
        await this.fetchProjection();
      } catch (error) {
        this.reportError(error);
      }
      const changed =
        this.epoch !== prevEpoch
        || this.lastSeq !== prevSeq
        || this.lastSnapshotDigest !== prevSnapshotDigest;
      if (changed) {
        this.pollIntervalMs = 2_000;
      } else {
        this.pollIntervalMs = Math.min(15_000, Math.round(this.pollIntervalMs * 1.4));
      }
      if (this.started && this.shouldKeepTransportActive() && !this.eventSource) {
        this.scheduleProjectionPoll(this.pollIntervalMs);
      }
    }, delayMs);
  }

  private startProjectionPolling(): void {
    if (this.pollTimer != null) return;
    this.pollIntervalMs = 2_000;
    this.scheduleProjectionPoll(this.pollIntervalMs);
  }

  private scheduleSseReconnect(): void {
    if (!this.started) return;
    if (!this.shouldKeepTransportActive()) return;
    if (this.reconnectTimer != null) return;
    if (this.sseReconnectAttempts >= RoverServerRuntimeClient.SSE_MAX_RECONNECT_ATTEMPTS) {
      // Stop retrying — let polling handle it
      this.sseReconnectAttempts = 0;
      return;
    }
    const base = RoverServerRuntimeClient.SSE_BASE_DELAY_MS;
    const exp = Math.min(
      base * Math.pow(2, this.sseReconnectAttempts),
      RoverServerRuntimeClient.SSE_MAX_DELAY_MS,
    );
    const jitter = Math.random() * RoverServerRuntimeClient.SSE_MAX_JITTER_MS;
    const delay = Math.round(exp + jitter);
    this.sseReconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.startProjectionStream();
    }, delay);
  }

  private startProjectionStream(): void {
    if (!this.started) return;
    if (!this.shouldKeepTransportActive()) {
      this.pauseBackgroundTransport();
      return;
    }
    if (!this.sessionToken || !this.sessionId) {
      this.startProjectionPolling();
      return;
    }
    if (this.eventSource) return;
    if (typeof EventSource === 'undefined') {
      this.startProjectionPolling();
      return;
    }

    const query = new URLSearchParams({
      sessionId: this.sessionId,
      cursor: String(this.lastSeq),
      sessionToken: this.sessionToken,
    });
    const url = `${this.getActiveBase()}/stream?${query.toString()}`;
    const source = new EventSource(url, { withCredentials: false });
    this.eventSource = source;

    const handleProjectionEvent = (raw: string) => {
      try {
        const parsed = JSON.parse(raw || '{}');
        const projectionCandidate =
          parsed && typeof parsed === 'object' && isProjection(parsed.projection)
            ? parsed.projection
            : parsed;
        if (isProjection(projectionCandidate)) {
          this.applyProjection(projectionCandidate);
        }
      } catch (error) {
        this.reportError(error);
      }
    };

    source.addEventListener('projection', event => {
      handleProjectionEvent((event as MessageEvent<string>).data || '{}');
    });

    source.addEventListener('projection_delta', event => {
      handleProjectionEvent((event as MessageEvent<string>).data || '{}');
    });

    source.onerror = () => {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      void this.ensureSession(true)
        .catch(error => this.reportError(error))
        .finally(() => {
          this.rotateBaseCandidate();
          if (!this.shouldKeepTransportActive()) {
            this.pauseBackgroundTransport();
            return;
          }
          // Use polling as fallback — only start if not already polling
          if (this.pollTimer == null) {
            this.startProjectionPolling();
          }
          // Schedule SSE reconnect — polling will stop once SSE connects (onopen)
          this.scheduleSseReconnect();
        });
    };

    source.onopen = () => {
      if (!this.shouldKeepTransportActive()) {
        this.pauseBackgroundTransport();
        return;
      }
      this.sseReconnectAttempts = 0;
      if (this.pollTimer != null) {
        window.clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.pollIntervalMs = 2_000;
      }
    };
  }
}
