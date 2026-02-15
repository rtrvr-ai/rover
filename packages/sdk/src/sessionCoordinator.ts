import type { RoverMessageBlock } from '@rover/ui';

export type SharedRole = 'controller' | 'observer';

export type SharedUiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  blocks?: RoverMessageBlock[];
  ts: number;
  sourceRuntimeId?: string;
};

export type SharedTimelineEvent = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  detailBlocks?: RoverMessageBlock[];
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
  pendingAskUser?: {
    questions: Array<{ key: string; query: string; id?: string; question?: string; choices?: string[] }>;
    source: 'act' | 'planner';
    askedAt: number;
  };
  updatedAt: number;
};

export type SharedWorkflowLock = {
  runtimeId: string;
  runId: string;
  lockedAt: number;
  expiresAt: number;
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
  workflowLock?: SharedWorkflowLock;
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
const STALE_DETACHED_EXTERNAL_TAB_MS = 2 * 60_000;
const STALE_DETACHED_TAB_MS = 10 * 60_000;
const STALE_RUNTIME_TAB_MS = 45_000;

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

function sanitizeMessageBlocks(input: unknown): RoverMessageBlock[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: RoverMessageBlock[] = [];

  for (const block of input) {
    if (!block || typeof block !== 'object') continue;
    const type = (block as any).type;

    if (type === 'text') {
      const text = String((block as any).text || '');
      if (!text) continue;
      out.push({ type: 'text', text });
      continue;
    }

    if (type === 'tool_output' || type === 'json') {
      const clonedData = cloneUnknown((block as any).data);
      out.push({
        type,
        data: clonedData,
        label: typeof (block as any).label === 'string' ? (block as any).label : undefined,
        toolName: typeof (block as any).toolName === 'string' ? (block as any).toolName : undefined,
      });
    }
  }

  return out.length ? out : undefined;
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

  const pendingQuestions = Array.isArray(raw.pendingAskUser?.questions)
    ? raw.pendingAskUser.questions
        .map((question: any, index: number) => {
          const key = String(question?.key || question?.id || '').trim() || `clarification_${index + 1}`;
          const query = String(question?.query || question?.question || '').trim();
          if (!query) return undefined;
          return {
            key,
            query,
            id: typeof question?.id === 'string' ? question.id : undefined,
            question: typeof question?.question === 'string' ? question.question : undefined,
            choices: Array.isArray(question?.choices) ? question.choices : undefined,
          };
        })
        .filter((question: any) => !!question)
        .slice(0, 6)
    : [];

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
    pendingAskUser: pendingQuestions.length
      ? {
          questions: pendingQuestions,
          source: raw.pendingAskUser?.source === 'planner' ? 'planner' : 'act',
          askedAt: Number(raw.pendingAskUser?.askedAt) || now(),
        }
      : undefined,
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
    workflowLock: undefined,
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
            blocks: sanitizeMessageBlocks(message?.blocks),
            ts: Number(message?.ts) || now(),
            sourceRuntimeId: typeof message?.sourceRuntimeId === 'string' ? message.sourceRuntimeId : undefined,
          }))
          .filter((message: SharedUiMessage) => !!message.text || !!message.blocks?.length)
      : [],
    timeline: Array.isArray(raw.timeline)
      ? raw.timeline
          .map((event: any) => ({
            id: String(event?.id || randomId('timeline')),
            kind: String(event?.kind || 'status'),
            title: String(event?.title || 'Step'),
            detail: typeof event?.detail === 'string' ? event.detail : undefined,
            detailBlocks: sanitizeMessageBlocks(event?.detailBlocks),
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
    workflowLock:
      raw.workflowLock && typeof raw.workflowLock === 'object' && raw.workflowLock.runtimeId && raw.workflowLock.runId
        ? {
            runtimeId: String(raw.workflowLock.runtimeId),
            runId: String(raw.workflowLock.runId),
            lockedAt: Number(raw.workflowLock.lockedAt) || now(),
            expiresAt: Number(raw.workflowLock.expiresAt) || 0,
          }
        : undefined,
  };

  // Deduplicate tabs by logicalTabId (keep first occurrence)
  const inputTabCount = state.tabs.length;
  const seenTabIds = new Set<number>();
  state.tabs = state.tabs.filter(tab => {
    if (seenTabIds.has(tab.logicalTabId)) return false;
    seenTabIds.add(tab.logicalTabId);
    return true;
  });

  if (state.nextLogicalTabId <= (state.tabs.at(-1)?.logicalTabId ?? 0)) {
    state.nextLogicalTabId = state.tabs.reduce((max, tab) => Math.max(max, tab.logicalTabId), 0) + 1;
  }

  // Warn if tabs were dropped during sanitization
  if (inputTabCount > 0 && state.tabs.length < inputTabCount) {
    console.warn(`[rover] sanitizeSharedState: dropped ${inputTabCount - state.tabs.length} invalid/duplicate tab entries`);
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
  private closing = false;
  private started = false;
  private pendingRpcRequests = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: number;
  }>();
  private rpcRequestHandler?: (request: { method: string; params: any }) => Promise<any>;
  private lastNotifiedRole: SharedRole | undefined;
  private roleChangeTimer: number | null = null;
  private static readonly ROLE_CHANGE_DEBOUNCE_MS = 200;

  private pruneDetachedTabs(
    draft: SharedSessionState,
    options?: { dropRuntimeDetached?: boolean; dropAllDetachedExternal?: boolean },
  ): void {
    const dropRuntimeDetached = !!options?.dropRuntimeDetached;
    const dropAllDetachedExternal = !!options?.dropAllDetachedExternal;
    const nowMs = now();
    const before = draft.tabs.length;

    draft.tabs = draft.tabs.filter(tab => {
      if (tab.runtimeId) {
        if (tab.runtimeId === this.runtimeId) return true;
        return nowMs - Math.max(tab.updatedAt || 0, tab.openedAt || 0) <= STALE_RUNTIME_TAB_MS;
      }

      if (dropRuntimeDetached && tab.openerRuntimeId === this.runtimeId) {
        return false;
      }

      if (tab.external) {
        if (dropAllDetachedExternal) return false;
        return nowMs - Math.max(tab.updatedAt || 0, tab.openedAt || 0) <= STALE_DETACHED_EXTERNAL_TAB_MS;
      }

      return nowMs - Math.max(tab.updatedAt || 0, tab.openedAt || 0) <= STALE_DETACHED_TAB_MS;
    });

    if (before !== draft.tabs.length) {
      if (draft.activeLogicalTabId && !draft.tabs.some(tab => tab.logicalTabId === draft.activeLogicalTabId)) {
        draft.activeLogicalTabId = this.localLogicalTabId || draft.tabs[0]?.logicalTabId;
      }
      if (draft.nextLogicalTabId <= (draft.tabs.at(-1)?.logicalTabId ?? 0)) {
        draft.nextLogicalTabId = draft.tabs.reduce((max, tab) => Math.max(max, tab.logicalTabId), 0) + 1;
      }
    }
  }

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

    this.mutate('local', draft => {
      // Page refreshes can leave detached virtual tabs from previous runs.
      this.pruneDetachedTabs(draft, { dropRuntimeDetached: true, dropAllDetachedExternal: true });
    });

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
        if (payload.type === 'rpc_request' && payload.targetRuntimeId === this.runtimeId) {
          this.handleInboundRpcRequest(payload);
        }
        if (payload.type === 'rpc_response' && payload.targetRuntimeId === this.runtimeId) {
          this.handleInboundRpcResponse(payload);
        }
        if (payload.type === 'tab_navigated' && payload.runtimeId && payload.runtimeId !== this.runtimeId) {
          this.handleRemoteNavigation(payload);
        }
        if (payload.type === 'tab_closing' && payload.runtimeId && payload.runtimeId !== this.runtimeId) {
          this.handleRemoteTabClosing(payload);
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

    if (this.roleChangeTimer != null) {
      window.clearTimeout(this.roleChangeTimer);
      this.roleChangeTimer = null;
    }

    if (this.storageHandler) {
      window.removeEventListener('storage', this.storageHandler);
      this.storageHandler = null;
    }

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    for (const [, pending] of this.pendingRpcRequests) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('SessionCoordinator stopped'));
    }
    this.pendingRpcRequests.clear();

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
    this.pruneDetachedTabs(incoming, { dropRuntimeDetached: true, dropAllDetachedExternal: true });
    const beforeSeq = this.state.seq;
    const beforeUpdatedAt = this.state.updatedAt;

    this.applyIncomingState(incoming);

    let changed = this.state.seq !== beforeSeq || this.state.updatedAt !== beforeUpdatedAt;
    if (!changed) {
      const hasDetachedCandidates = this.state.tabs.some(tab => {
        if (tab.runtimeId) return false;
        if (tab.external) return true;
        return tab.openerRuntimeId === this.runtimeId;
      });
      if (hasDetachedCandidates) {
        const beforeTabCount = this.state.tabs.length;
        this.mutate('local', draft => {
          this.pruneDetachedTabs(draft, { dropRuntimeDetached: true, dropAllDetachedExternal: true });
        });
        changed = this.state.tabs.length !== beforeTabCount;
      }
    }
    if (!changed) return false;

    this.persistState();

    // Ensure this runtime is still represented after an out-of-origin sync restore.
    if (!this.localLogicalTabId) {
      this.registerCurrentTab(window.location.href, document.title || undefined);
    }

    return true;
  }

  listTabs(): SharedTabEntry[] {
    const nowMs = now();
    return this.state.tabs.filter(tab => {
      if (tab.runtimeId) {
        if (tab.runtimeId === this.runtimeId) return true;
        return nowMs - Math.max(tab.updatedAt || 0, tab.openedAt || 0) <= STALE_RUNTIME_TAB_MS;
      }
      if (tab.external) {
        return nowMs - Math.max(tab.updatedAt || 0, tab.openedAt || 0) <= STALE_DETACHED_EXTERNAL_TAB_MS;
      }
      return nowMs - Math.max(tab.updatedAt || 0, tab.openedAt || 0) <= STALE_DETACHED_TAB_MS;
    });
  }

  pruneTabs(options?: { dropRuntimeDetached?: boolean; dropAllDetachedExternal?: boolean }): void {
    this.mutate('local', draft => {
      this.pruneDetachedTabs(draft, options);
    });
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
      this.pruneDetachedTabs(draft, { dropAllDetachedExternal: true });
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
      if (draft.task.status !== 'running') return;
      if (role === 'user') draft.task.lastUserAt = timestamp;
      if (role === 'assistant') draft.task.lastAssistantAt = timestamp;
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

  appendMessage(
    message: Omit<SharedUiMessage, 'id' | 'ts' | 'sourceRuntimeId'> & { id?: string; ts?: number },
  ): SharedUiMessage {
    const next: SharedUiMessage = {
      id: message.id || randomId('msg'),
      role: message.role,
      text: String(message.text || ''),
      blocks: sanitizeMessageBlocks(message.blocks),
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
      detailBlocks: sanitizeMessageBlocks(event.detailBlocks),
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
        return;
      }
      if (draft.task && draft.task.status !== 'running') {
        draft.activeRun = undefined;
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

    // localLogicalTabId is now synced automatically via syncLocalLogicalTabId() in mutate()
    this.notifyRoleChange();
    return this.localLogicalTabId || nextLocalTabId || 1;
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
      const existing = draft.tabs.find(tab =>
        !tab.runtimeId
        && !!tab.external
        && tab.url === normalizedUrl,
      );
      if (existing) {
        existing.title = payload.title || existing.title;
        existing.updatedAt = now();
        existing.openerRuntimeId = payload.openerRuntimeId || existing.openerRuntimeId;
        logicalTabId = existing.logicalTabId;
        return;
      }

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

  // ---- Cross-Tab RPC ----

  sendCrossTabRpc(targetRuntimeId: string, method: string, params: any, timeoutMs = 15000): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      if (!this.channel) {
        reject(new Error('BroadcastChannel not available'));
        return;
      }

      const requestId = randomId('rpc');
      const timer = window.setTimeout(() => {
        this.pendingRpcRequests.delete(requestId);
        reject(new Error(`Cross-tab RPC timed out after ${timeoutMs}ms (method=${method}, target=${targetRuntimeId})`));
      }, timeoutMs);

      this.pendingRpcRequests.set(requestId, { resolve, reject, timer });

      this.channel.postMessage({
        type: 'rpc_request',
        requestId,
        sourceRuntimeId: this.runtimeId,
        targetRuntimeId,
        method,
        params,
        timeoutMs,
        createdAt: now(),
      });
    });
  }

  setRpcRequestHandler(handler: (request: { method: string; params: any }) => Promise<any>): void {
    this.rpcRequestHandler = handler;
  }

  broadcastNavigation(url: string, title?: string): void {
    if (!this.channel) return;
    this.channel.postMessage({
      type: 'tab_navigated',
      runtimeId: this.runtimeId,
      logicalTabId: this.localLogicalTabId,
      url,
      title,
    });
  }

  broadcastClosing(): void {
    this.closing = true;
    if (!this.channel) return;
    // Remove local tab entry from shared state before broadcasting
    this.mutate('local', draft => {
      draft.tabs = draft.tabs.filter(t => t.runtimeId !== this.runtimeId);
      if (draft.activeLogicalTabId && !draft.tabs.some(t => t.logicalTabId === draft.activeLogicalTabId)) {
        draft.activeLogicalTabId = undefined;
      }
    });
    this.channel.postMessage({
      type: 'tab_closing',
      runtimeId: this.runtimeId,
      logicalTabId: this.localLogicalTabId,
    });
  }

  isTabAlive(logicalTabId: number): boolean {
    const tab = this.state.tabs.find(t => t.logicalTabId === logicalTabId);
    if (!tab) return false;
    return tab.updatedAt > now() - 2 * this.heartbeatMs;
  }

  // ---- Workflow Lock ----

  acquireWorkflowLock(runId: string): boolean {
    let acquired = false;
    this.mutate('local', draft => {
      const existing = draft.workflowLock;
      if (existing && existing.runtimeId !== this.runtimeId && existing.expiresAt > now()) {
        // Check if the holder tab is still alive before respecting the lock
        const holderTab = draft.tabs.find(t => t.runtimeId === existing.runtimeId);
        const holderAlive = holderTab && holderTab.updatedAt > now() - 2 * this.heartbeatMs;
        if (holderAlive) {
          acquired = false;
          return;
        }
        // Holder is dead — steal the lock
      }
      draft.workflowLock = {
        runtimeId: this.runtimeId,
        runId,
        lockedAt: now(),
        expiresAt: now() + this.leaseMs * 5,
      };
      acquired = true;
    });
    return acquired;
  }

  clearActiveRunRuntimeId(runId: string): void {
    this.mutate('local', draft => {
      if (draft.activeRun && draft.activeRun.runId === runId) {
        draft.activeRun.runtimeId = '';
      }
    });
  }

  releaseWorkflowLock(runId: string): void {
    this.mutate('local', draft => {
      if (draft.workflowLock && draft.workflowLock.runId === runId) {
        draft.workflowLock = undefined;
      }
    });
  }

  isWorkflowLocked(): boolean {
    const lock = this.state.workflowLock;
    if (!lock) return false;
    if (lock.runtimeId === this.runtimeId) return false;
    return lock.expiresAt > now();
  }

  getWorkflowLockInfo(): { locked: boolean; holderRuntimeId?: string; runId?: string } {
    const lock = this.state.workflowLock;
    if (!lock || lock.expiresAt <= now()) {
      return { locked: false };
    }
    return {
      locked: true,
      holderRuntimeId: lock.runtimeId,
      runId: lock.runId,
    };
  }

  // ---- Private RPC handlers ----

  private async handleInboundRpcRequest(payload: any): Promise<void> {
    const { requestId, sourceRuntimeId, method, params } = payload;
    if (!this.rpcRequestHandler) {
      this.channel?.postMessage({
        type: 'rpc_response',
        requestId,
        sourceRuntimeId: this.runtimeId,
        targetRuntimeId: sourceRuntimeId,
        ok: false,
        error: { message: 'No RPC handler registered', code: 'NO_HANDLER' },
      });
      return;
    }

    try {
      const result = await this.rpcRequestHandler({ method, params });
      this.channel?.postMessage({
        type: 'rpc_response',
        requestId,
        sourceRuntimeId: this.runtimeId,
        targetRuntimeId: sourceRuntimeId,
        ok: true,
        result,
      });
    } catch (err: any) {
      this.channel?.postMessage({
        type: 'rpc_response',
        requestId,
        sourceRuntimeId: this.runtimeId,
        targetRuntimeId: sourceRuntimeId,
        ok: false,
        error: { message: err?.message || String(err) },
      });
    }
  }

  private handleInboundRpcResponse(payload: any): void {
    const { requestId, ok, result, error } = payload;
    const pending = this.pendingRpcRequests.get(requestId);
    if (!pending) return;

    this.pendingRpcRequests.delete(requestId);
    window.clearTimeout(pending.timer);

    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error?.message || 'Cross-tab RPC failed'));
    }
  }

  private handleRemoteNavigation(payload: any): void {
    const { runtimeId: remoteRuntimeId, url, title } = payload;
    this.mutate('local', draft => {
      const tab = draft.tabs.find(t => t.runtimeId === remoteRuntimeId);
      if (tab) {
        tab.url = url || tab.url;
        tab.title = title || tab.title;
        tab.updatedAt = now();
      }
    });
  }

  private handleRemoteTabClosing(payload: any): void {
    const { runtimeId: closingRuntimeId } = payload;
    this.mutate('local', draft => {
      draft.tabs = draft.tabs.filter(t => t.runtimeId !== closingRuntimeId);
      if (draft.lease?.holderRuntimeId === closingRuntimeId) {
        draft.lease = undefined;
      }
      if (draft.workflowLock?.runtimeId === closingRuntimeId) {
        draft.workflowLock = undefined;
      }
      if (draft.activeRun?.runtimeId === closingRuntimeId) {
        draft.activeRun = undefined;
      }
      if (draft.activeLogicalTabId && !draft.tabs.some(t => t.logicalTabId === draft.activeLogicalTabId)) {
        draft.activeLogicalTabId = undefined;
      }
    });
    this.notifyRoleChange();
  }

  private heartbeat(): void {
    if (this.closing) return;

    const currentUrl = normalizeUrl(window.location.href);
    const currentTitle = document.title || undefined;

    this.mutate('local', draft => {
      const currentTab = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
      if (currentTab) {
        currentTab.url = currentUrl || currentTab.url;
        currentTab.title = currentTitle || currentTab.title;
        currentTab.updatedAt = now();
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

      // Refresh workflow lock expiration if this runtime holds it
      if (draft.workflowLock?.runtimeId === this.runtimeId) {
        draft.workflowLock.expiresAt = now() + this.leaseMs * 5;
      }

      this.pruneDetachedTabs(draft);
    });

    this.notifyRoleChange();
  }

  reloadFromStorage(): SharedSessionState {
    const fresh = this.loadState();
    if (fresh.seq > this.state.seq ||
        (fresh.seq === this.state.seq && fresh.updatedAt > this.state.updatedAt)) {
      this.state = fresh;
      this.syncLocalLogicalTabId();
      this.onStateChange?.(this.state, 'remote');
    }
    this.closing = false; // Reset closing flag on bfcache restore
    return this.state;
  }

  claimLease(force: boolean): boolean {
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
    const currentRole = this.getRole();
    // Skip if role hasn't changed
    if (currentRole === this.lastNotifiedRole) return;

    if (this.roleChangeTimer != null) {
      window.clearTimeout(this.roleChangeTimer);
    }

    this.roleChangeTimer = window.setTimeout(() => {
      this.roleChangeTimer = null;
      const role = this.getRole();
      if (role === this.lastNotifiedRole) return;
      this.lastNotifiedRole = role;
      this.onRoleChange?.(role, {
        localLogicalTabId: this.localLogicalTabId,
        activeLogicalTabId: this.state.activeLogicalTabId,
        holderRuntimeId: this.state.lease?.holderRuntimeId,
      });
    }, SessionCoordinator.ROLE_CHANGE_DEBOUNCE_MS);
  }

  private syncLocalLogicalTabId(): void {
    const tab = this.state.tabs.find(t => t.runtimeId === this.runtimeId);
    this.localLogicalTabId = tab?.logicalTabId;
  }

  private mutate(source: 'local' | 'remote', updater: (draft: SharedSessionState) => void): void {
    // Re-read from localStorage before local mutations (optimistic locking)
    if (source === 'local') {
      try {
        const raw = window.localStorage.getItem(this.key);
        if (raw) {
          const persisted = sanitizeSharedState(JSON.parse(raw), this.siteId, this.sessionId);
          if (persisted.seq > this.state.seq ||
              (persisted.seq === this.state.seq && persisted.updatedAt > this.state.updatedAt)) {
            this.state = persisted;
          }
        }
      } catch { /* ignore */ }
    }

    const draft = sanitizeSharedState(this.state, this.siteId, this.sessionId);
    updater(draft);
    draft.seq = Math.max(1, Number(draft.seq) || 1) + (source === 'local' ? 1 : 0);
    draft.updatedAt = now();

    this.state = draft;
    this.syncLocalLogicalTabId();

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
    this.pruneDetachedTabs(incoming);
    this.state = incoming;

    this.syncLocalLogicalTabId();

    this.onStateChange?.(this.state, 'remote');
    this.notifyRoleChange();
  }

  private loadState(): SharedSessionState {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return createDefaultSharedState(this.siteId, this.sessionId);
      const parsed = JSON.parse(raw);
      return sanitizeSharedState(parsed, this.siteId, this.sessionId);
    } catch (err) {
      console.warn('[rover] Failed to load shared state from localStorage:', err);
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
