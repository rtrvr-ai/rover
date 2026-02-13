export type SharedRole = 'controller' | 'observer';

export type SharedUiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
  sourceRuntimeId?: string;
};

export type SharedTimelineEvent = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  status?: 'pending' | 'success' | 'error' | 'info';
  ts: number;
  sourceRuntimeId?: string;
};

export type SharedActiveRun = {
  runId: string;
  text: string;
  runtimeId: string;
  startedAt: number;
  updatedAt: number;
};

export type SharedTabEntry = {
  logicalTabId: number;
  runtimeId?: string;
  url: string;
  title?: string;
  openedAt: number;
  updatedAt: number;
  external?: boolean;
  openerRuntimeId?: string;
};

export type SharedLease = {
  holderRuntimeId: string;
  expiresAt: number;
  updatedAt: number;
};

export type SharedTaskState = {
  taskId: string;
  status: 'running' | 'completed' | 'ended';
  startedAt: number;
  lastUserAt?: number;
  lastAssistantAt?: number;
  boundaryReason?: string;
  endedAt?: number;
};

export type SharedWorkerContext = {
  trajectoryId?: string;
  history?: Array<{ role: string; content: string }>;
  plannerHistory?: unknown[];
  agentPrevSteps?: unknown[];
  updatedAt: number;
};

export type SharedSessionState = {
  version: number;
  siteId: string;
  sessionId: string;
  seq: number;
  updatedAt: number;
  lease?: SharedLease;
  tabs: SharedTabEntry[];
  nextLogicalTabId: number;
  activeLogicalTabId?: number;
  uiMessages: SharedUiMessage[];
  timeline: SharedTimelineEvent[];
  uiStatus?: string;
  activeRun?: SharedActiveRun;
  taskEpoch: number;
  task?: SharedTaskState;
  workerContext?: SharedWorkerContext;
};

export type SessionCoordinatorOptions = {
  siteId: string;
  sessionId: string;
  runtimeId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  maxMessages?: number;
  maxTimeline?: number;
  onRoleChange?: (role: SharedRole, info: { localLogicalTabId?: number; activeLogicalTabId?: number; holderRuntimeId?: string }) => void;
  onStateChange?: (state: SharedSessionState, source: 'local' | 'remote') => void;
  onSwitchRequested?: (logicalTabId: number) => void;
};

const SHARED_VERSION = 2;
const SHARED_KEY_PREFIX = 'rover:shared:';
const SHARED_CHANNEL_PREFIX = 'rover:channel:';

function now(): number {
  return Date.now();
}

function randomId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}

function normalizeUrl(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    return new URL(text, window.location.href).toString();
  } catch {
    return text;
  }
}

function sanitizeSharedTask(raw: any): SharedTaskState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : '';
  if (!taskId) return undefined;

  const status =
    raw.status === 'completed' || raw.status === 'ended' || raw.status === 'running'
      ? raw.status
      : 'running';

  return {
    taskId,
    status,
    startedAt: Number(raw.startedAt) || now(),
    lastUserAt: Number(raw.lastUserAt) || undefined,
    lastAssistantAt: Number(raw.lastAssistantAt) || undefined,
    boundaryReason: typeof raw.boundaryReason === 'string' ? raw.boundaryReason : undefined,
    endedAt: Number(raw.endedAt) || undefined,
  };
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

function cloneUnknownArrayTail(input: unknown, max: number): unknown[] {
  if (!Array.isArray(input)) return [];
  const out: unknown[] = [];
  for (const entry of input.slice(-max)) {
    const cloned = cloneUnknown(entry);
    if (cloned !== undefined) out.push(cloned);
  }
  return out;
}

function sanitizeSharedWorkerContext(raw: any): SharedWorkerContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const normalizeEntries = (items: any[]): Array<{ role: string; content: string }> =>
    items
      .slice(-80)
      .map(item => ({
        role: typeof item?.role === 'string' ? item.role : 'assistant',
        content: typeof item?.content === 'string' ? item.content : '',
      }))
      .filter(item => !!item.content);

  const history = Array.isArray(raw.history) ? normalizeEntries(raw.history) : [];
  const plannerHistory = cloneUnknownArrayTail(raw.plannerHistory, 40);
  const agentPrevSteps = cloneUnknownArrayTail(raw.agentPrevSteps, 80);

  return {
    trajectoryId: typeof raw.trajectoryId === 'string' ? raw.trajectoryId : undefined,
    history,
    plannerHistory,
    agentPrevSteps,
    updatedAt: Number(raw.updatedAt) || now(),
  };
}

function createDefaultSharedState(siteId: string, sessionId: string): SharedSessionState {
  return {
    version: SHARED_VERSION,
    siteId,
    sessionId,
    seq: 1,
    updatedAt: now(),
    lease: undefined,
    tabs: [],
    nextLogicalTabId: 1,
    activeLogicalTabId: undefined,
    uiMessages: [],
    timeline: [],
    uiStatus: undefined,
    activeRun: undefined,
    taskEpoch: 1,
    task: undefined,
    workerContext: undefined,
  };
}

function sanitizeSharedState(raw: any, siteId: string, sessionId: string): SharedSessionState {
  const fallback = createDefaultSharedState(siteId, sessionId);
  if (!raw || typeof raw !== 'object') return fallback;

  const state: SharedSessionState = {
    ...fallback,
    version: SHARED_VERSION,
    siteId,
    sessionId,
    seq: Math.max(1, Number(raw.seq) || 1),
    updatedAt: Number(raw.updatedAt) || now(),
    tabs: Array.isArray(raw.tabs)
      ? raw.tabs
          .map((entry: any) => ({
            logicalTabId: Math.max(1, Number(entry?.logicalTabId) || 0),
            runtimeId: typeof entry?.runtimeId === 'string' ? entry.runtimeId : undefined,
            url: String(entry?.url || ''),
            title: typeof entry?.title === 'string' ? entry.title : undefined,
            openedAt: Number(entry?.openedAt) || now(),
            updatedAt: Number(entry?.updatedAt) || now(),
            external: !!entry?.external,
            openerRuntimeId: typeof entry?.openerRuntimeId === 'string' ? entry.openerRuntimeId : undefined,
          }))
          .filter((entry: SharedTabEntry) => !!entry.logicalTabId)
      : [],
    nextLogicalTabId: Math.max(1, Number(raw.nextLogicalTabId) || 1),
    activeLogicalTabId: Number(raw.activeLogicalTabId) || undefined,
    uiMessages: Array.isArray(raw.uiMessages)
      ? raw.uiMessages
          .map((message: any) => ({
            id: String(message?.id || randomId('msg')),
            role:
              message?.role === 'user' || message?.role === 'assistant' || message?.role === 'system'
                ? message.role
                : 'system',
            text: String(message?.text || ''),
            ts: Number(message?.ts) || now(),
            sourceRuntimeId: typeof message?.sourceRuntimeId === 'string' ? message.sourceRuntimeId : undefined,
          }))
          .filter((message: SharedUiMessage) => !!message.text)
      : [],
    timeline: Array.isArray(raw.timeline)
      ? raw.timeline
          .map((event: any) => ({
            id: String(event?.id || randomId('timeline')),
            kind: String(event?.kind || 'status'),
            title: String(event?.title || 'Step'),
            detail: typeof event?.detail === 'string' ? event.detail : undefined,
            status: event?.status === 'pending' || event?.status === 'success' || event?.status === 'error' || event?.status === 'info' ? event.status : undefined,
            ts: Number(event?.ts) || now(),
            sourceRuntimeId: typeof event?.sourceRuntimeId === 'string' ? event.sourceRuntimeId : undefined,
          }))
          .filter((event: SharedTimelineEvent) => !!event.title)
      : [],
    taskEpoch: Math.max(1, Number(raw.taskEpoch) || 1),
    task: sanitizeSharedTask(raw.task),
    workerContext: sanitizeSharedWorkerContext(raw.workerContext),
    uiStatus: typeof raw.uiStatus === 'string' ? raw.uiStatus : undefined,
    activeRun:
      raw.activeRun && typeof raw.activeRun === 'object'
        ? {
            runId: String(raw.activeRun.runId || ''),
            text: String(raw.activeRun.text || ''),
            runtimeId: String(raw.activeRun.runtimeId || ''),
            startedAt: Number(raw.activeRun.startedAt) || now(),
            updatedAt: Number(raw.activeRun.updatedAt) || now(),
          }
        : undefined,
    lease:
      raw.lease && typeof raw.lease === 'object' && raw.lease.holderRuntimeId
        ? {
            holderRuntimeId: String(raw.lease.holderRuntimeId),
            expiresAt: Number(raw.lease.expiresAt) || 0,
          updatedAt: Number(raw.lease.updatedAt) || now(),
        }
        : undefined,
  };

  if (state.nextLogicalTabId <= state.tabs.length) {
    state.nextLogicalTabId = state.tabs.reduce((max, tab) => Math.max(max, tab.logicalTabId), 0) + 1;
  }

  return state;
}

export class SessionCoordinator {
  private readonly siteId: string;
  private readonly sessionId: string;
  private readonly runtimeId: string;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly maxMessages: number;
  private readonly maxTimeline: number;
  private readonly onRoleChange?: SessionCoordinatorOptions['onRoleChange'];
  private readonly onStateChange?: SessionCoordinatorOptions['onStateChange'];
  private readonly onSwitchRequested?: SessionCoordinatorOptions['onSwitchRequested'];

  private readonly key: string;
  private readonly channelName: string;

  private state: SharedSessionState;
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: number | null = null;
  private storageHandler: ((event: StorageEvent) => void) | null = null;
  private localLogicalTabId: number | undefined;
  private started = false;

  constructor(options: SessionCoordinatorOptions) {
    this.siteId = options.siteId;
    this.sessionId = options.sessionId;
    this.runtimeId = options.runtimeId;
    this.leaseMs = Math.max(4000, Number(options.leaseMs) || 12000);
    this.heartbeatMs = Math.max(800, Number(options.heartbeatMs) || 2000);
    this.maxMessages = Math.max(40, Number(options.maxMessages) || 220);
    this.maxTimeline = Math.max(40, Number(options.maxTimeline) || 280);
    this.onRoleChange = options.onRoleChange;
    this.onStateChange = options.onStateChange;
    this.onSwitchRequested = options.onSwitchRequested;

    this.key = `${SHARED_KEY_PREFIX}${this.siteId}:${this.sessionId}`;
    this.channelName = `${SHARED_CHANNEL_PREFIX}${this.siteId}:${this.sessionId}`;

    this.state = this.loadState();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.registerCurrentTab(window.location.href, document.title || undefined);
    this.claimLease(false);
    if (!this.state.task) {
      this.mutate('local', draft => {
        draft.task = {
          taskId: randomId('task'),
          status: 'running',
          startedAt: now(),
          boundaryReason: 'session_start',
        };
      });
    }

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = event => {
        const payload = event.data;
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'state' && payload.state) {
          const incoming = sanitizeSharedState(payload.state, this.siteId, this.sessionId);
          this.applyIncomingState(incoming);
        }
        if (payload.type === 'switch_request' && payload.targetRuntimeId === this.runtimeId) {
          this.onSwitchRequested?.(Number(payload.logicalTabId) || 0);
        }
      };
    }

    this.storageHandler = (event: StorageEvent) => {
      if (event.key !== this.key || !event.newValue) return;
      try {
        const incoming = sanitizeSharedState(JSON.parse(event.newValue), this.siteId, this.sessionId);
        this.applyIncomingState(incoming);
      } catch {
        // no-op
      }
    };
    window.addEventListener('storage', this.storageHandler);

    this.heartbeatTimer = window.setInterval(() => {
      this.heartbeat();
    }, this.heartbeatMs);

    this.notifyRoleChange();
    this.onStateChange?.(this.state, 'local');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.storageHandler) {
      window.removeEventListener('storage', this.storageHandler);
      this.storageHandler = null;
    }

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    this.mutate('local', draft => {
      draft.tabs = draft.tabs.filter(tab => tab.runtimeId !== this.runtimeId);
      if (draft.lease?.holderRuntimeId === this.runtimeId) {
        draft.lease = undefined;
      }
      if (draft.activeLogicalTabId && !draft.tabs.some(tab => tab.logicalTabId === draft.activeLogicalTabId)) {
        draft.activeLogicalTabId = undefined;
      }
    });
  }

  isController(): boolean {
    const lease = this.state.lease;
    if (!lease) return false;
    if (lease.expiresAt <= now()) return false;
    return lease.holderRuntimeId === this.runtimeId;
  }

  getRole(): SharedRole {
    return this.isController() ? 'controller' : 'observer';
  }

  getLocalLogicalTabId(): number | undefined {
    return this.localLogicalTabId;
  }

  getActiveLogicalTabId(): number | undefined {
    return this.state.activeLogicalTabId;
  }

  getCurrentHolderRuntimeId(): string | undefined {
    return this.state.lease?.holderRuntimeId;
  }

  getState(): SharedSessionState {
    return this.state;
  }

  getTaskEpoch(): number {
    return this.state.taskEpoch;
  }

  getTask(): SharedTaskState | undefined {
    return this.state.task;
  }

  getWorkerContext(): SharedWorkerContext | undefined {
    return this.state.workerContext;
  }

  syncTask(task: SharedTaskState | undefined, taskEpoch?: number): void {
    this.mutate('local', draft => {
      if (taskEpoch && Number.isFinite(taskEpoch) && taskEpoch > draft.taskEpoch) {
        draft.taskEpoch = Math.max(1, Math.trunc(taskEpoch));
      }
      if (!task) return;
      draft.task = sanitizeSharedTask(task) || draft.task;
    });
  }

  hydrateExternalState(raw: any): boolean {
    const incoming = sanitizeSharedState(raw, this.siteId, this.sessionId);
    const beforeSeq = this.state.seq;
    const beforeUpdatedAt = this.state.updatedAt;

    this.applyIncomingState(incoming);

    const changed = this.state.seq !== beforeSeq || this.state.updatedAt !== beforeUpdatedAt;
    if (!changed) return false;

    this.persistState();

    // Ensure this runtime is still represented after an out-of-origin sync restore.
    if (!this.localLogicalTabId) {
      this.registerCurrentTab(window.location.href, document.title || undefined);
    }

    return true;
  }

  listTabs(): SharedTabEntry[] {
    return [...this.state.tabs];
  }

  startNewTask(task: Omit<SharedTaskState, 'status'> & { status?: SharedTaskState['status'] }): SharedTaskState {
    const startedAt = Number(task.startedAt) || now();
    const nextTask: SharedTaskState = {
      taskId: String(task.taskId || randomId('task')),
      status: task.status === 'completed' || task.status === 'ended' ? task.status : 'running',
      startedAt,
      lastUserAt: Number(task.lastUserAt) || startedAt,
      lastAssistantAt: Number(task.lastAssistantAt) || undefined,
      boundaryReason: task.boundaryReason,
      endedAt: undefined,
    };

    this.mutate('local', draft => {
      draft.taskEpoch = Math.max(1, Number(draft.taskEpoch) || 1) + 1;
      draft.task = nextTask;
      draft.uiMessages = [];
      draft.timeline = [];
      draft.uiStatus = undefined;
      draft.activeRun = undefined;
      draft.workerContext = undefined;
    });

    return nextTask;
  }

  endTask(reason?: string): SharedTaskState | undefined {
    let endedTask: SharedTaskState | undefined;
    this.mutate('local', draft => {
      if (!draft.task) return;
      draft.task = {
        ...draft.task,
        status: 'ended',
        boundaryReason: reason || draft.task.boundaryReason,
        endedAt: now(),
      };
      draft.activeRun = undefined;
      endedTask = draft.task;
    });
    return endedTask;
  }

  markTaskActivity(role: 'user' | 'assistant' | 'system', timestamp = now()): void {
    if (role === 'system') return;
    this.mutate('local', draft => {
      if (!draft.task) {
        draft.task = {
          taskId: randomId('task'),
          status: 'running',
          startedAt: timestamp,
          boundaryReason: 'implicit',
          lastUserAt: role === 'user' ? timestamp : undefined,
          lastAssistantAt: role === 'assistant' ? timestamp : undefined,
        };
        return;
      }
      if (role === 'user') draft.task.lastUserAt = timestamp;
      if (role === 'assistant') draft.task.lastAssistantAt = timestamp;
      if (draft.task.status === 'ended') {
        draft.task.status = 'running';
        draft.task.endedAt = undefined;
      }
    });
  }

  setWorkerContext(context: SharedWorkerContext | undefined): void {
    this.mutate('local', draft => {
      if (!context) {
        draft.workerContext = undefined;
        return;
      }
      draft.workerContext = sanitizeSharedWorkerContext(context);
    });
  }

  setStatus(status: string | undefined): void {
    this.mutate('local', draft => {
      draft.uiStatus = status || undefined;
    });
  }

  appendMessage(message: Omit<SharedUiMessage, 'id' | 'ts' | 'sourceRuntimeId'> & { id?: string; ts?: number }): SharedUiMessage {
    const next: SharedUiMessage = {
      id: message.id || randomId('msg'),
      role: message.role,
      text: String(message.text || ''),
      ts: Number(message.ts) || now(),
      sourceRuntimeId: this.runtimeId,
    };

    this.mutate('local', draft => {
      draft.uiMessages.push(next);
      if (draft.uiMessages.length > this.maxMessages) {
        draft.uiMessages = draft.uiMessages.slice(-this.maxMessages);
      }
      if (!draft.task) {
        draft.task = {
          taskId: randomId('task'),
          status: 'running',
          startedAt: next.ts,
          boundaryReason: 'implicit',
        };
      }
      if (next.role === 'user') {
        draft.task.lastUserAt = next.ts;
      } else if (next.role === 'assistant') {
        draft.task.lastAssistantAt = next.ts;
      }
    });

    return next;
  }

  appendTimeline(
    event: Omit<SharedTimelineEvent, 'id' | 'ts' | 'sourceRuntimeId'> & { id?: string; ts?: number },
  ): SharedTimelineEvent {
    const next: SharedTimelineEvent = {
      id: event.id || randomId('timeline'),
      kind: String(event.kind || 'status'),
      title: String(event.title || 'Step'),
      detail: event.detail ? String(event.detail) : undefined,
      status: event.status,
      ts: Number(event.ts) || now(),
      sourceRuntimeId: this.runtimeId,
    };

    this.mutate('local', draft => {
      draft.timeline.push(next);
      if (draft.timeline.length > this.maxTimeline) {
        draft.timeline = draft.timeline.slice(-this.maxTimeline);
      }
    });

    return next;
  }

  clearTimeline(): void {
    this.mutate('local', draft => {
      draft.timeline = [];
    });
  }

  setActiveRun(activeRun: { runId: string; text: string } | undefined): void {
    this.mutate('local', draft => {
      if (!activeRun) {
        draft.activeRun = undefined;
        if (draft.task && draft.task.status === 'running') {
          draft.task.status = 'completed';
        }
        return;
      }
      draft.activeRun = {
        runId: activeRun.runId,
        text: activeRun.text,
        runtimeId: this.runtimeId,
        startedAt: draft.activeRun?.runId === activeRun.runId ? draft.activeRun.startedAt : now(),
        updatedAt: now(),
      };
      if (!draft.task) {
        draft.task = {
          taskId: randomId('task'),
          status: 'running',
          startedAt: now(),
        };
      } else if (draft.task.status !== 'ended') {
        draft.task.status = 'running';
      }
    });
  }

  requestControl(): boolean {
    return this.claimLease(true);
  }

  registerCurrentTab(url: string, title?: string): number {
    const normalizedUrl = normalizeUrl(url);

    let nextLocalTabId: number | undefined;
    this.mutate('local', draft => {
      const existing = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
      if (existing) {
        existing.url = normalizedUrl || existing.url;
        existing.title = title || existing.title;
        existing.updatedAt = now();
        nextLocalTabId = existing.logicalTabId;
      } else {
        const adopted = draft.tabs.find(tab => !tab.runtimeId && tab.url === normalizedUrl && now() - tab.openedAt < 180000);
        if (adopted) {
          adopted.runtimeId = this.runtimeId;
          adopted.title = title || adopted.title;
          adopted.updatedAt = now();
          nextLocalTabId = adopted.logicalTabId;
        } else {
          const logicalTabId = draft.nextLogicalTabId++;
          draft.tabs.push({
            logicalTabId,
            runtimeId: this.runtimeId,
            url: normalizedUrl,
            title,
            openedAt: now(),
            updatedAt: now(),
            external: false,
          });
          nextLocalTabId = logicalTabId;
        }
      }

      if (!draft.activeLogicalTabId) {
        draft.activeLogicalTabId = nextLocalTabId;
      }
    });

    this.localLogicalTabId = nextLocalTabId;
    this.notifyRoleChange();
    return nextLocalTabId || 1;
  }

  registerOpenedTab(payload: {
    url: string;
    title?: string;
    external?: boolean;
    openerRuntimeId?: string;
  }): { logicalTabId: number } {
    const normalizedUrl = normalizeUrl(payload.url);
    let logicalTabId = 0;

    this.mutate('local', draft => {
      logicalTabId = draft.nextLogicalTabId++;
      draft.tabs.push({
        logicalTabId,
        runtimeId: undefined,
        url: normalizedUrl,
        title: payload.title,
        openedAt: now(),
        updatedAt: now(),
        external: !!payload.external,
        openerRuntimeId: payload.openerRuntimeId,
      });
    });

    return { logicalTabId };
  }

  switchToLogicalTab(logicalTabId: number): { ok: boolean; delegated?: boolean; reason?: string } {
    let result: { ok: boolean; delegated?: boolean; reason?: string } = { ok: false, reason: 'Unknown tab' };

    this.mutate('local', draft => {
      const tab = draft.tabs.find(entry => entry.logicalTabId === logicalTabId);
      if (!tab) {
        result = { ok: false, reason: `Tab ${logicalTabId} not found` };
        return;
      }

      draft.activeLogicalTabId = logicalTabId;

      if (tab.runtimeId && tab.runtimeId !== this.runtimeId) {
        draft.lease = {
          holderRuntimeId: tab.runtimeId,
          expiresAt: now() + this.leaseMs,
          updatedAt: now(),
        };

        if (this.channel) {
          this.channel.postMessage({
            type: 'switch_request',
            logicalTabId,
            targetRuntimeId: tab.runtimeId,
            sourceRuntimeId: this.runtimeId,
          });
        }

        result = { ok: true, delegated: true };
        return;
      }

      if (!tab.runtimeId) {
        result = { ok: false, reason: `Tab ${logicalTabId} is not attached to an active Rover runtime yet` };
        return;
      }

      draft.lease = {
        holderRuntimeId: this.runtimeId,
        expiresAt: now() + this.leaseMs,
        updatedAt: now(),
      };

      result = { ok: true, delegated: false };
    });

    this.notifyRoleChange();
    return result;
  }

  private heartbeat(): void {
    const currentUrl = normalizeUrl(window.location.href);
    const currentTitle = document.title || undefined;

    this.mutate('local', draft => {
      const currentTab = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
      if (currentTab) {
        currentTab.url = currentUrl || currentTab.url;
        currentTab.title = currentTitle || currentTab.title;
        currentTab.updatedAt = now();
        this.localLogicalTabId = currentTab.logicalTabId;
      } else {
        const logicalTabId = draft.nextLogicalTabId++;
        draft.tabs.push({
          logicalTabId,
          runtimeId: this.runtimeId,
          url: currentUrl,
          title: currentTitle,
          openedAt: now(),
          updatedAt: now(),
          external: false,
        });
        this.localLogicalTabId = logicalTabId;
      }

      const lease = draft.lease;
      const leaseExpired = !lease || lease.expiresAt <= now();
      if (leaseExpired || lease?.holderRuntimeId === this.runtimeId) {
        draft.lease = {
          holderRuntimeId: this.runtimeId,
          expiresAt: now() + this.leaseMs,
          updatedAt: now(),
        };
        if (!draft.activeLogicalTabId && this.localLogicalTabId) {
          draft.activeLogicalTabId = this.localLogicalTabId;
        }
      }
    });

    this.notifyRoleChange();
  }

  private claimLease(force: boolean): boolean {
    let claimed = false;

    this.mutate('local', draft => {
      const currentLease = draft.lease;
      const expired = !currentLease || currentLease.expiresAt <= now();

      if (force || expired || currentLease?.holderRuntimeId === this.runtimeId) {
        draft.lease = {
          holderRuntimeId: this.runtimeId,
          expiresAt: now() + this.leaseMs,
          updatedAt: now(),
        };
        if (!draft.activeLogicalTabId && this.localLogicalTabId) {
          draft.activeLogicalTabId = this.localLogicalTabId;
        }
        claimed = true;
      }
    });

    this.notifyRoleChange();
    return claimed;
  }

  private notifyRoleChange(): void {
    this.onRoleChange?.(this.getRole(), {
      localLogicalTabId: this.localLogicalTabId,
      activeLogicalTabId: this.state.activeLogicalTabId,
      holderRuntimeId: this.state.lease?.holderRuntimeId,
    });
  }

  private mutate(source: 'local' | 'remote', updater: (draft: SharedSessionState) => void): void {
    const draft = sanitizeSharedState(this.state, this.siteId, this.sessionId);
    updater(draft);
    draft.seq = Math.max(1, Number(draft.seq) || 1) + (source === 'local' ? 1 : 0);
    draft.updatedAt = now();

    this.state = draft;

    if (source === 'local') {
      this.persistState();
      if (this.channel) {
        this.channel.postMessage({ type: 'state', sourceRuntimeId: this.runtimeId, state: this.state });
      }
    }

    this.onStateChange?.(this.state, source);
  }

  private applyIncomingState(incoming: SharedSessionState): void {
    if (!incoming) return;
    if (incoming.seq < this.state.seq) return;
    if (incoming.seq === this.state.seq && incoming.updatedAt <= this.state.updatedAt) return;
    this.state = incoming;

    const localTab = this.state.tabs.find(tab => tab.runtimeId === this.runtimeId);
    this.localLogicalTabId = localTab?.logicalTabId;

    this.onStateChange?.(this.state, 'remote');
    this.notifyRoleChange();
  }

  private loadState(): SharedSessionState {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return createDefaultSharedState(this.siteId, this.sessionId);
      const parsed = JSON.parse(raw);
      return sanitizeSharedState(parsed, this.siteId, this.sessionId);
    } catch {
      return createDefaultSharedState(this.siteId, this.sessionId);
    }
  }

  private persistState(): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // no-op
    }
  }
}
