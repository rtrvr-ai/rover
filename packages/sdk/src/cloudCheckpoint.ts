import type { SharedSessionState } from './sessionCoordinator.js';
import type { PersistedRuntimeState } from './runtimeTypes.js';

const DEFAULT_EXTENSION_ROUTER_BASE = 'https://agent.rtrvr.ai';
const SESSION_TOKEN_PREFIX = 'rvrsess_';

export type RoverCloudCheckpointPayload = {
  version: number;
  siteId: string;
  visitorId: string;
  sessionId: string;
  updatedAt: number;
  digest?: string;
  sharedState?: SharedSessionState;
  runtimeState?: PersistedRuntimeState;
};

type CheckpointSource = 'pull' | 'push_stale';
export type RoverCloudCheckpointState = 'active' | 'paused_auth';

type CheckpointAction = 'session_snapshot_upsert' | 'session_projection_get';

type CheckpointErrorContext = {
  action: CheckpointAction;
  state: RoverCloudCheckpointState;
  code?: string;
  message: string;
  status?: number;
  paused: boolean;
};

export type RoverCloudCheckpointClientOptions = {
  apiBase?: string;
  authToken?: string;
  getSessionToken?: () => string | undefined;
  shouldSync?: () => boolean;
  siteId: string;
  visitorId: string;
  ttlHours?: number;
  flushIntervalMs?: number;
  pullIntervalMs?: number;
  minFlushIntervalMs?: number;
  maxSnapshotBytes?: number;
  shouldWrite?: () => boolean;
  buildCheckpoint: () => RoverCloudCheckpointPayload | null;
  onCheckpoint: (checkpoint: RoverCloudCheckpointPayload, source: CheckpointSource) => void;
  onStateChange?: (state: RoverCloudCheckpointState, context: { reason?: string; action?: CheckpointAction; code?: string; message?: string }) => void;
  onError?: (error: unknown, context: CheckpointErrorContext) => void;
};

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function truncateText(value: unknown, max = 8_000): string {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function normalizeUrlIdentity(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

function stableSerialize(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableSerialize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'updatedAt' && key !== 'ts' && key !== 'timestamp')
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function hashSemanticDigest(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sd:${(hash >>> 0).toString(16)}`;
}

function buildRevisionKey(payload: RoverCloudCheckpointPayload): string {
  const sharedTabs = Array.isArray(payload.sharedState?.tabs) ? payload.sharedState.tabs : [];
  const worker = (payload.runtimeState?.workerState || {}) as Record<string, any>;
  const taskScope = (payload.runtimeState?.taskTabScope || {}) as Record<string, any>;
  const sharedActiveRun = (payload.sharedState?.activeRun || {}) as Record<string, any>;
  const runtimePendingRun = (payload.runtimeState?.pendingRun || {}) as Record<string, any>;
  const plannerHistory = Array.isArray(worker.plannerHistory) ? worker.plannerHistory : [];
  const agentPrevSteps = Array.isArray(worker.agentPrevSteps) ? worker.agentPrevSteps : [];
  const lastPlannerStep = plannerHistory.length ? plannerHistory[plannerHistory.length - 1] : undefined;
  const lastAgentStep = agentPrevSteps.length ? agentPrevSteps[agentPrevSteps.length - 1] : undefined;
  const plannerStepMarkers = plannerHistory.map((step: any) => String(
    step?.id
    || step?.toolCall?.name
    || step?.toolName
    || step?.name
    || '',
  ));
  const agentStepMarkers = agentPrevSteps.map((step: any) => String(
    step?.id
    || step?.toolCall?.name
    || step?.toolName
    || step?.name
    || '',
  ));
  const semantic = {
    sessionId: String(payload.sessionId || ''),
    shared: {
      taskEpoch: Number(payload.sharedState?.taskEpoch || 0),
      taskId: String(payload.sharedState?.task?.taskId || ''),
      taskStatus: String(payload.sharedState?.task?.status || ''),
      activeRunId: String(sharedActiveRun.runId || ''),
      activeRunStatus: String(sharedActiveRun.status || ''),
      tabs: sharedTabs.map((tab: any) => ({
        logicalTabId: Number(tab?.logicalTabId) || 0,
        scope: String(tab?.scope || ''),
        status: String(tab?.status || ''),
        url: normalizeUrlIdentity(tab?.url),
        external: !!tab?.external,
      })),
    },
    runtime: {
      taskEpoch: Number(payload.runtimeState?.taskEpoch || 0),
      activeTaskId: String(payload.runtimeState?.activeTask?.taskId || ''),
      activeTaskStatus: String(payload.runtimeState?.activeTask?.status || ''),
      pendingRunId: String(runtimePendingRun.id || ''),
      pendingRunStatus: String(runtimePendingRun.status || ''),
      pendingResumeRequired: runtimePendingRun.resumeRequired === true,
      worker: {
        taskBoundaryId: String(worker.taskBoundaryId || ''),
        trajectoryId: String(worker.trajectoryId || ''),
        pendingAskBoundaryId: String(worker.pendingAskUser?.boundaryId || ''),
        plannerHistoryCount: plannerHistory.length,
        agentPrevStepsCount: agentPrevSteps.length,
        lastPlannerStepId: String((lastPlannerStep as any)?.id || ''),
        lastAgentStepId: String((lastAgentStep as any)?.id || ''),
        plannerStepMarkers,
        agentStepMarkers,
      },
      continuity: {
        boundaryId: String(taskScope.boundaryId || ''),
        seedTabId: Number(taskScope.seedTabId || 0),
        touchedTabIds: Array.isArray(taskScope.touchedTabIds)
          ? taskScope.touchedTabIds.map((id: any) => Number(id) || 0).filter((id: number) => id > 0)
          : [],
      },
    },
  };
  return hashSemanticDigest(stableSerialize(semantic));
}

export function buildSemanticCheckpointDigest(payload: RoverCloudCheckpointPayload): string {
  return buildRevisionKey(payload);
}

function normalizeBaseOrigin(apiBase?: string): string {
  const fallback = DEFAULT_EXTENSION_ROUTER_BASE;
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter/v2/rover')) return base.slice(0, -('/extensionRouter/v2/rover'.length));
  if (base.endsWith('/v2/rover')) return base.slice(0, -('/v2/rover'.length));
  const versionedRouterMatch = base.match(/\/v\d+\/rover$/);
  if (versionedRouterMatch?.[0]) return base.slice(0, -versionedRouterMatch[0].length);
  if (base.endsWith('/extensionRouter')) return base.slice(0, -('/extensionRouter'.length));
  return base;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeRoverV2Bases(apiBase?: string): string[] {
  const base = normalizeBaseOrigin(apiBase);
  const rawApiBase = String(apiBase || '').trim().replace(/\/+$/, '');
  if (rawApiBase.endsWith('/v2/rover') || rawApiBase.endsWith('/extensionRouter/v2/rover')) {
    return unique([rawApiBase.replace('/extensionRouter/v2/rover', '/v2/rover'), `${base}/v2/rover`]);
  }
  if (!rawApiBase && base === 'https://agent.rtrvr.ai') {
    return unique([`${base}/v2/rover`, 'https://extensionrouter.rtrvr.ai/v2/rover']);
  }
  return unique([`${base}/v2/rover`]);
}

function toError(message: string, details?: any): Error {
  const error = new Error(message);
  (error as any).details = details;
  return error;
}

function createRequestNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class RoverCloudCheckpointClient {
  private endpoint: string;
  private endpointCandidates: string[];
  private endpointIndex = 0;
  private readonly getToken: () => string;
  private readonly siteId: string;
  private readonly visitorId: string;
  private readonly ttlHours: number;
  private readonly flushIntervalMs: number;
  private readonly pullIntervalMs: number;
  private readonly minFlushIntervalMs: number;
  private readonly maxSnapshotBytes: number;
  private readonly shouldSync: () => boolean;
  private readonly shouldWrite: () => boolean;
  private readonly buildCheckpoint: RoverCloudCheckpointClientOptions['buildCheckpoint'];
  private readonly onCheckpoint: RoverCloudCheckpointClientOptions['onCheckpoint'];
  private readonly onStateChange?: RoverCloudCheckpointClientOptions['onStateChange'];
  private readonly onError?: RoverCloudCheckpointClientOptions['onError'];

  private readonly idlePullIntervalMs: number;

  private started = false;
  private idleMode = false;
  private dirty = false;
  private flushTimer: number | null = null;
  private pullTimer: number | null = null;
  private lastFlushAt = 0;
  private lastPullAt = 0;
  private lastUploadedRevision = '';
  private lastAppliedRemoteUpdatedAt = 0;
  private lastAppliedRemoteDigest = '';
  private pushInFlight = false;
  private pullInFlight = false;
  private state: RoverCloudCheckpointState = 'active';
  private visibilityListener: (() => void) | null = null;

  constructor(options: RoverCloudCheckpointClientOptions) {
    const staticToken = String(options.authToken || '').trim();
    const provider = options.getSessionToken;
    const token = provider ? String(provider() || '').trim() : staticToken;
    if (!token || !token.startsWith(SESSION_TOKEN_PREFIX)) {
      throw toError('Rover cloud checkpoint requires a session token (rvrsess_...).');
    }

    this.endpointCandidates = normalizeRoverV2Bases(options.apiBase);
    this.endpoint = this.endpointCandidates[0] || `${DEFAULT_EXTENSION_ROUTER_BASE}/v2/rover`;
    this.getToken = () => {
      const next = provider ? String(provider() || '').trim() : staticToken;
      if (!next || !next.startsWith(SESSION_TOKEN_PREFIX)) {
        throw toError('Rover cloud checkpoint requires an active session token.');
      }
      return next;
    };
    this.siteId = options.siteId;
    this.visitorId = options.visitorId;
    this.ttlHours = Math.max(1, Math.min(24 * 7, Math.floor(toFiniteNumber(options.ttlHours, 1))));
    this.flushIntervalMs = Math.max(2_000, Math.floor(toFiniteNumber(options.flushIntervalMs, 30_000)));
    this.pullIntervalMs = Math.max(2_000, Math.floor(toFiniteNumber(options.pullIntervalMs, 30_000)));
    this.idlePullIntervalMs = 120_000; // Pull every 120s when idle (vs 30s active)
    this.minFlushIntervalMs = Math.max(1_000, Math.floor(toFiniteNumber(options.minFlushIntervalMs, 2_500)));
    this.maxSnapshotBytes = Math.max(64_000, Math.min(1_048_576, Math.floor(toFiniteNumber(options.maxSnapshotBytes, 262_144))));
    this.shouldSync = options.shouldSync || (() => true);
    this.shouldWrite = options.shouldWrite || (() => true);
    this.buildCheckpoint = options.buildCheckpoint;
    this.onCheckpoint = options.onCheckpoint;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.setState('active');

    if (typeof document !== 'undefined' && !this.visibilityListener) {
      this.visibilityListener = () => {
        if (!this.started) return;
        if (document.hidden) {
          // Tab hidden — pause flush, slow pull to reduce memory churn
          this.enterIdleMode();
          return;
        }
        // Tab visible again — resume normal intervals
        this.enterActiveMode();
        if (!this.shouldSync()) return;
        void this.pull(true);
        if (this.dirty) void this.flush(true);
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }

    this.flushTimer = window.setInterval(() => {
      if (!this.shouldSync()) return;
      void this.flush(false);
    }, this.flushIntervalMs);

    this.pullTimer = window.setInterval(() => {
      if (!this.shouldSync()) return;
      void this.pull(false);
    }, this.pullIntervalMs);

    void this.pull(true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.idleMode = false;

    if (this.flushTimer != null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pullTimer != null) {
      window.clearInterval(this.pullTimer);
      this.pullTimer = null;
    }
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }

    void this.flush(true);
  }

  markDirty(): void {
    this.dirty = true;
  }

  syncNow(options?: { push?: boolean; pull?: boolean }): void {
    const push = options?.push !== false;
    const pull = options?.pull !== false;
    if (push) void this.flush(true);
    if (pull) void this.pull(true);
  }

  syncPullFirst(): void {
    void (async () => {
      await this.pull(true);
      await this.flush(true);
    })();
  }

  pullNow(force = true): void {
    void this.pull(!!force);
  }

  enterIdleMode(): void {
    if (this.idleMode) return;
    this.idleMode = true;
    // Stop push cycle — no active task to push
    if (this.flushTimer != null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Restart pull cycle with slower interval
    if (this.pullTimer != null) {
      window.clearInterval(this.pullTimer);
      this.pullTimer = null;
    }
    if (this.started) {
      this.pullTimer = window.setInterval(() => {
        if (!this.shouldSync()) return;
        void this.pull(false);
      }, this.idlePullIntervalMs);
    }
  }

  enterActiveMode(): void {
    if (!this.idleMode) return;
    this.idleMode = false;
    // Restart normal push/pull cycles
    if (this.started) {
      if (this.flushTimer == null) {
        this.flushTimer = window.setInterval(() => {
          if (!this.shouldSync()) return;
          void this.flush(false);
        }, this.flushIntervalMs);
      }
      if (this.pullTimer == null) {
        this.pullTimer = window.setInterval(() => {
          if (!this.shouldSync()) return;
          void this.pull(false);
        }, this.pullIntervalMs);
      }
    }
  }

  private getActiveEndpoint(): string {
    if (!this.endpointCandidates.length) return this.endpoint;
    return this.endpointCandidates[this.endpointIndex] || this.endpoint;
  }

  private rotateEndpoint(): void {
    if (this.endpointCandidates.length <= 1) return;
    this.endpointIndex = (this.endpointIndex + 1) % this.endpointCandidates.length;
    this.endpoint = this.endpointCandidates[this.endpointIndex] || this.endpoint;
  }

  private async requestJson(path: string, init: RequestInit): Promise<{ response: Response; payload: any }> {
    const attempts = Math.max(1, this.endpointCandidates.length || 1);
    let lastError: unknown;
    for (let offset = 0; offset < attempts; offset += 1) {
      const index = (this.endpointIndex + offset) % attempts;
      const endpoint = this.endpointCandidates[index] || this.endpoint;
      try {
        const response = await fetch(`${endpoint}${path}`, init);
        const payload = await response.json().catch(() => undefined);
        if (response.status === 404 || response.status === 405) {
          lastError = toError(`Checkpoint endpoint unavailable at ${endpoint}${path}`, {
            status: response.status,
            payload,
          });
          continue;
        }
        this.endpointIndex = index;
        this.endpoint = endpoint;
        return { response, payload };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw toError(`Checkpoint request failed for ${path}`);
  }

  private async flush(force: boolean): Promise<void> {
    if (this.pushInFlight) return;
    if (this.idleMode) return;
    if (this.state === 'paused_auth') return;
    if (!force && !this.shouldSync()) return;
    if (!this.dirty && !force) return;
    if (!this.shouldWrite()) return;
    if (!force && Date.now() - this.lastFlushAt < this.minFlushIntervalMs) return;

    const payload = this.buildCheckpoint();
    if (!payload) return;

    const revision = buildRevisionKey(payload);
    payload.digest = revision;
    if (!force && revision === this.lastUploadedRevision) {
      this.dirty = false;
      return;
    }

    this.pushInFlight = true;
    try {
      const response = await this.callCheckpointApi('session_snapshot_upsert', {
        siteId: this.siteId,
        visitorId: this.visitorId,
        sessionId: payload.sessionId,
        ttlHours: this.ttlHours,
        updatedAt: payload.updatedAt,
        checkpoint: payload,
      });

      this.lastFlushAt = Date.now();
      if (response?.saved) {
        this.dirty = false;
        this.lastUploadedRevision = revision;
      }

      if (response?.stale && response?.checkpoint && typeof response.checkpoint === 'object') {
        this.applyRemoteCheckpoint(response.checkpoint as RoverCloudCheckpointPayload, 'push_stale');
        this.dirty = false;
      }
      this.setState('active');
    } catch (error) {
      this.handleCheckpointError(error, 'session_snapshot_upsert');
    } finally {
      this.pushInFlight = false;
    }
  }

  private async pull(force: boolean): Promise<void> {
    if (this.pullInFlight) return;
    if (this.state === 'paused_auth') return;
    if (!force && !this.shouldSync()) return;
    if (!force && Date.now() - this.lastPullAt < this.pullIntervalMs) return;

    this.pullInFlight = true;
    try {
      const response = await this.callCheckpointApi('session_projection_get', {
        siteId: this.siteId,
        visitorId: this.visitorId,
        sessionId: this.buildCheckpoint()?.sessionId,
      });

      this.lastPullAt = Date.now();
      if (!response?.found || !response?.checkpoint || typeof response.checkpoint !== 'object') return;
      this.applyRemoteCheckpoint(response.checkpoint as RoverCloudCheckpointPayload, 'pull');
      this.setState('active');
    } catch (error) {
      this.handleCheckpointError(error, 'session_projection_get');
    } finally {
      this.pullInFlight = false;
    }
  }

  private applyRemoteCheckpoint(checkpoint: RoverCloudCheckpointPayload, source: CheckpointSource): void {
    const updatedAt = Math.max(0, Math.floor(toFiniteNumber(checkpoint?.updatedAt, 0)));
    const digest = String(checkpoint?.digest || '').trim() || buildRevisionKey(checkpoint);
    if (updatedAt <= this.lastAppliedRemoteUpdatedAt && (!digest || digest === this.lastAppliedRemoteDigest)) return;
    this.lastAppliedRemoteUpdatedAt = updatedAt;
    if (digest) this.lastAppliedRemoteDigest = digest;
    this.onCheckpoint(checkpoint, source);
  }

  private async callCheckpointApi(checkpointAction: CheckpointAction, data: any): Promise<any> {
    return this.callRoverV2(checkpointAction, data);
  }

  private async callRoverV2(action: CheckpointAction, data: any): Promise<any> {
    const sessionToken = this.getToken();
    if (action === 'session_snapshot_upsert') {
      const body = JSON.stringify({
        requestNonce: createRequestNonce(),
        sessionToken,
        sessionId: data?.sessionId,
        visitorId: data?.visitorId,
        ttlHours: data?.ttlHours,
        updatedAt: data?.updatedAt,
        version: data?.checkpoint?.version || data?.version || 1,
        checkpoint: data?.checkpoint,
      });
      if (body.length > this.maxSnapshotBytes) {
        throw toError('Checkpoint snapshot exceeds maxSnapshotBytes limit.', {
          action,
          size: body.length,
          maxSnapshotBytes: this.maxSnapshotBytes,
          code: 'SNAPSHOT_TOO_LARGE',
        });
      }
      // keepalive ensures the request survives page navigation (e.g. same-tab nav).
      // The spec limits keepalive request bodies to 64KB; skip if payload is too large.
      const useKeepalive = body.length < 60_000;
      const { response, payload } = await this.requestJson('/snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        keepalive: useKeepalive,
        body,
      });
      if (!response.ok || !payload?.success) {
        throw toError(`Checkpoint HTTP ${response.status}`, {
          action,
          status: response.status,
          payload,
        });
      }
      return {
        saved: !!payload?.data?.saved,
        stale: payload?.data?.stale === true,
        checkpoint: payload?.data?.checkpoint,
        updatedAt: Number(payload?.data?.updatedAt) || undefined,
      };
    }

    const params = new URLSearchParams({
      sessionId: String(data?.sessionId || ''),
      sessionToken,
      includeSnapshot: 'true',
    });
    const { response, payload } = await this.requestJson(`/state?${params.toString()}`, {
      method: 'GET',
    });
    if (!response.ok || !payload?.success) {
      throw toError(`Checkpoint HTTP ${response.status}`, {
        action,
        status: response.status,
        payload,
      });
    }
    const checkpoint =
      payload?.data?.projection?.snapshot
      ?? payload?.data?.snapshot;
    return {
      found: !!checkpoint,
      checkpoint,
    };
  }

  private setState(
    next: RoverCloudCheckpointState,
    context?: { reason?: string; action?: CheckpointAction; code?: string; message?: string },
  ): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next, context || {});
  }

  private handleCheckpointError(error: unknown, action: CheckpointAction): void {
    const details = this.normalizeCheckpointError(error);
    const isAuthFailure = this.isAuthFailure(details);
    if (isAuthFailure) {
      this.setState('paused_auth', {
        reason: 'auth_failed',
        action,
        code: details.code,
        message: details.message,
      });
    }
    this.onError?.(error, {
      action,
      state: this.state,
      code: details.code,
      message: details.message,
      status: details.status,
      paused: isAuthFailure,
    });
  }

  private normalizeCheckpointError(error: unknown): {
    code?: string;
    message: string;
    status?: number;
  } {
    const anyError = error as any;
    const details = anyError?.details;
    const payload = details?.payload || details?.response || details;
    const candidateCode =
      payload?.errorCode
      || payload?.errorDetails?.code
      || payload?.error?.code
      || payload?.code;
    const candidateMessage =
      payload?.error
      || payload?.errorDetails?.message
      || payload?.error?.message
      || anyError?.message
      || 'Checkpoint request failed';
    const status = Number(details?.status);
    return {
      code: typeof candidateCode === 'string' ? candidateCode : undefined,
      message: truncateText(candidateMessage, 1_000),
      status: Number.isFinite(status) ? status : undefined,
    };
  }

  private isAuthFailure(details: { code?: string; status?: number }): boolean {
    const code = String(details.code || '').toUpperCase();
    if (
      code === 'INVALID_API_KEY'
      || code === 'MISSING_API_KEY'
      || code === 'UNAUTHENTICATED'
      || code === 'PERMISSION_DENIED'
    ) {
      return true;
    }
    return details.status === 401 || details.status === 403;
  }
}
