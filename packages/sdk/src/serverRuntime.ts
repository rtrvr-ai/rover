export type RoverServerPolicy = {
  domainScopeMode?: 'host_only' | 'registrable_domain';
  externalNavigationPolicy?: 'open_new_tab_notice' | 'block' | 'allow';
  crossHostPolicy?: 'open_new_tab' | 'same_tab';
  enableExternalWebContext?: boolean;
  externalScrapeMode?: 'off' | 'on_demand';
  externalAllowDomains?: string[];
  externalDenyDomains?: string[];
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
  snapshotUpdatedAt?: number;
};

type SessionStartResponse = {
  sessionId: string;
  sessionToken: string;
  sessionTokenExpiresAt?: number;
  epoch?: number;
  policy?: RoverServerPolicy;
  capabilities?: Record<string, boolean>;
  siteConfig?: Record<string, unknown>;
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
};

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBaseUrl(apiBase?: string): string {
  const fallback = 'https://extensionrouter.rtrvr.ai';
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter/v1/rover')) {
    return base.slice(0, -('/extensionRouter/v1/rover'.length));
  }
  if (base.endsWith('/extensionRouter')) return base.slice(0, -('/extensionRouter'.length));
  if (base.endsWith('/v1/rover')) return base.slice(0, -('/v1/rover'.length));
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

export function resolveRoverV1Bases(apiBase?: string): string[] {
  const base = toBaseUrl(apiBase);
  const primary = `${base}/v1/rover`;
  const rawApiBase = normalizeUrl(String(apiBase || '').trim());
  if (rawApiBase.endsWith('/v1/rover') || rawApiBase.endsWith('/extensionRouter/v1/rover')) {
    return unique([rawApiBase.replace('/extensionRouter/v1/rover', '/v1/rover'), primary]);
  }
  return unique([primary]);
}

export function resolveRoverV1Base(apiBase?: string): string {
  return resolveRoverV1Bases(apiBase)[0] || `${toBaseUrl(apiBase)}/v1/rover`;
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
  private started = false;
  private lastSeq = 0;
  private lastRunId = '';
  private activeRunId: string | undefined;

  constructor(options: RoverServerRuntimeOptions) {
    this.options = options;
    this.baseCandidates = resolveRoverV1Bases(options.apiBase);
    this.base = this.baseCandidates[0] || resolveRoverV1Base(options.apiBase);
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
    this.baseCandidates = resolveRoverV1Bases(apiBase);
    this.baseIndex = 0;
    this.base = this.baseCandidates[0] || resolveRoverV1Base(apiBase);
  }

  stop(): void {
    this.started = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.lastSeq = 0;
    this.lastRunId = '';
    this.activeRunId = undefined;
  }

  async start(): Promise<void> {
    this.started = true;
    await this.ensureSession(false);
    this.startProjectionStream();
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
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
      this.baseCandidates = resolveRoverV1Bases(this.base);
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
      host: this.options.getHost(),
      url: this.options.getPageUrl(),
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

    const requestSessionStart = async (payload: Record<string, unknown>) =>
      this.requestJson('/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    let { response, json } = await requestSessionStart(body);
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
      ({ response, json } = await requestSessionStart({
        ...baseBody,
        bootstrapToken,
      }));
    }

    if (!response.ok || !json?.success || !json?.data) {
      const authCode = getAuthErrorCode(json);
      const message = json?.data?.message || json?.error || `session/start failed (${response.status})`;
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
      headers: { 'Content-Type': 'application/json' },
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
      throw new Error(String(message));
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
    clientEventId?: string;
    continueRun?: boolean;
    forceNewRun?: boolean;
    runId?: string;
    requestedMode?: 'act' | 'planner' | 'auto';
  }): Promise<RunInputResponse | null> {
    const clientEventId =
      String(params.clientEventId || '').trim()
      || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : undefined);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.postJson<RunInputResponse>('/run/input', {
        message: params.message,
        runId: params.runId,
        continueRun: !!params.continueRun,
        forceNewRun: !!params.forceNewRun,
        requestedMode: params.requestedMode,
        expectedEpoch: this.epoch,
        expectedSeq: this.lastSeq,
        clientEventId,
        taskBoundaryId: this.options.getTaskBoundaryId?.(),
      });
      if (!result.ok) {
        const data = (result.data || null) as RunInputResponse | null;
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
      const data = result.data as RunInputResponse;
      if (typeof data?.runId === 'string' && data.runId.trim()) {
        const nextRunId = data.runId.trim();
        this.activeRunId = nextRunId;
        this.lastRunId = nextRunId;
        if (Number(data?.seq || 0) === 0 && this.lastSeq > 0) {
          // Run changed but server hasn't published seq yet; reset optimistic cursor.
          this.lastSeq = 0;
        }
      }
      if (Number.isFinite(Number(data?.epoch))) {
        this.epoch = Math.max(1, Number(data.epoch));
      }
      if (Number.isFinite(Number(data?.seq))) {
        this.lastSeq = Math.max(0, Number(data?.seq || 0));
      }
      return data;
    }
    return null;
  }

  async controlRun(params: {
    action: 'cancel' | 'end_task' | 'new_task' | 'continue';
    runId?: string;
    reason?: string;
    clientEventId?: string;
  }): Promise<RunControlResponse | null> {
    const clientEventId =
      String(params.clientEventId || '').trim()
      || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : undefined);

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.postJson<RunControlResponse>('/run/control', {
        action: params.action,
        runId: params.runId,
        reason: params.reason,
        expectedEpoch: this.epoch,
        expectedSeq: this.lastSeq,
        clientEventId,
      });
      if (!result.ok) {
        // 409: cursor was stale. postJson already synced cursor via syncCursorFromPayload.
        // Retry once with the updated cursor.
        if (attempt === 0 && result.conflict?.retryable !== false) {
          continue;
        }
        return result.data || null;
      }
      const data = result.data as RunControlResponse;
      if (Number.isFinite(Number(data?.currentSeq))) {
        this.lastSeq = Math.max(0, Number(data.currentSeq || 0));
      }
      if (isProjection(data?.projection)) {
        this.applyProjection(data.projection);
      }
      return data;
    }
    return null;
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

    const firstAttempt = await this.postJson<TabEventDecisionResponse>('/tab/event', {
      ...basePayload,
      expectedEpoch: this.epoch,
      expectedSeq: this.lastSeq,
    });
    if (firstAttempt.ok) {
      const data = (firstAttempt.data || null) as TabEventDecisionResponse | null;
      if (data) {
        if (Number.isFinite(Number(data?.sessionEpoch))) {
          this.epoch = Math.max(1, Number(data?.sessionEpoch || this.epoch));
        }
        if (Number.isFinite(Number(data?.currentSeq))) {
          this.lastSeq = Math.max(0, Number(data?.currentSeq || 0));
        }
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
      const retryAttempt = await this.postJson<TabEventDecisionResponse>('/tab/event', {
        ...basePayload,
        expectedEpoch: this.epoch,
        expectedSeq: this.lastSeq,
      });
      if (retryAttempt.ok) {
        const retryData = (retryAttempt.data || null) as TabEventDecisionResponse | null;
        if (retryData) {
          if (Number.isFinite(Number(retryData?.sessionEpoch))) {
            this.epoch = Math.max(1, Number(retryData?.sessionEpoch || this.epoch));
          }
          if (Number.isFinite(Number(retryData?.currentSeq))) {
            this.lastSeq = Math.max(0, Number(retryData?.currentSeq || 0));
          }
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
      const retryData = (retryAttempt.data || firstAttempt.data || null) as TabEventDecisionResponse | null;
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

    const data = (firstAttempt.data || null) as TabEventDecisionResponse | null;
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
  }

  async fetchProjection(): Promise<RoverServerProjection | null> {
    await this.ensureSession(false);
    if (!this.sessionToken || !this.sessionId) return null;
    const query = new URLSearchParams({
      sessionId: this.sessionId,
      seqAfter: String(this.lastSeq),
      sessionToken: this.sessionToken,
    });
    const { response, json } = await this.requestJson(`/session/projection?${query.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok || !json?.success || !isProjection(json?.data)) {
      return null;
    }
    const projection = json.data as RoverServerProjection;
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
    const result = await this.postJson<{ saved?: boolean }>('/session/snapshot', {
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
  }

  private startProjectionPolling(): void {
    if (this.pollTimer != null) return;
    this.pollTimer = window.setInterval(() => {
      void this.fetchProjection().catch(error => this.reportError(error));
    }, 4_000);
  }

  private scheduleSseReconnect(): void {
    if (!this.started) return;
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.startProjectionStream();
    }, 8_000);
  }

  private startProjectionStream(): void {
    if (!this.started) return;
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
      seqAfter: String(this.lastSeq),
      sessionToken: this.sessionToken,
    });
    const url = `${this.getActiveBase()}/events?${query.toString()}`;
    const source = new EventSource(url, { withCredentials: false });
    this.eventSource = source;

    source.addEventListener('projection', event => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data || '{}');
        if (isProjection(parsed)) {
          this.applyProjection(parsed);
        }
      } catch (error) {
        this.reportError(error);
      }
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
          this.startProjectionPolling();
          this.scheduleSseReconnect();
        });
    };

    source.onopen = () => {
      if (this.pollTimer != null) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }
}
