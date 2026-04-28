import type { RoverActionCue, RoverMessageBlock } from '@rover/ui';
import { ROVER_V2_PERSIST_CAPS } from '@rover/shared';

export type SharedRole = 'controller' | 'observer';

export type SharedUiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  blocks?: RoverMessageBlock[];
  ts: number;
  sourceRuntimeId?: string;
};

export type SharedChatLogEntry = {
  role: 'user' | 'model';
  message: string;
};

export type SharedTransientStatus = {
  text: string;
  ts: number;
  runId?: string;
  taskId?: string;
  stage?: string;
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
  elementId?: number;
  toolName?: string;
  narration?: string;
  narrationActive?: boolean;
  actionCue?: RoverActionCue;
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
  detachedAt?: number;
  detachedReason?: 'navigation_handoff' | 'tab_close' | 'opened_pending_attach' | 'unknown';
  handoffId?: string;
  handoffRunId?: string;
  handoffTargetUrl?: string;
  handoffCreatedAt?: number;
};

export type SharedNavigationHandoff = {
  handoffId: string;
  targetUrl: string;
  sourceRuntimeId?: string;
  sourceLogicalTabId?: number;
  runId?: string;
  isCrossHost?: boolean;
  ts?: number;
};

export type SharedLease = {
  holderRuntimeId: string;
  expiresAt: number;
  updatedAt: number;
};

export type SharedTaskState = {
  taskId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'ended';
  startedAt: number;
  lastUserAt?: number;
  lastAssistantAt?: number;
  boundaryReason?: string;
  endedAt?: number;
};

/** Multi-task record for SharedSessionState v3. */
export type SharedTaskRecord = {
  taskId: string;
  state: import('./runtimeTypes.js').TaskState;
  startedAt: number;
  endedAt?: number;
  activeRun?: SharedActiveRun;
  workerContext?: SharedWorkerContext;
  uiMessages: SharedUiMessage[];
  timeline: SharedTimelineEvent[];
  rootUserInput?: string;
  summary?: string;
  seedChatLog?: SharedChatLogEntry[];
  transientStatus?: SharedTransientStatus;
};

export type SharedWorkerContext = {
  trajectoryId?: string;
  taskBoundaryId?: string;
  rootUserInput?: string;
  seedChatLog?: SharedChatLogEntry[];
  history?: Array<{ role: string; content: string }>;
  plannerHistory?: unknown[];
  agentPrevSteps?: unknown[];
  pendingAskUser?: {
    questions: Array<{ key: string; query: string; id?: string; question?: string; choices?: string[] }>;
    source: 'act' | 'planner';
    askedAt: number;
    boundaryId?: string;
    stepRef?: {
      stepIndex: number;
      functionIndex: number;
      accTreeId?: string;
    };
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
  version: number; // 2 = legacy, 3 = multi-task
  siteId: string;
  sessionId: string;
  seq: number;
  updatedAt: number;
  lease?: SharedLease;
  tabs: SharedTabEntry[];
  nextLogicalTabId: number;
  activeLogicalTabId?: number;
  taskEpoch: number;
  workflowLock?: SharedWorkflowLock;

  // Multi-task fields (v3)
  tasks?: Record<string, SharedTaskRecord>;
  activeTaskId?: string;

  // Legacy single-task fields (v2 compat — kept during migration)
  uiMessages: SharedUiMessage[];
  timeline: SharedTimelineEvent[];
  uiStatus?: string;
  transientStatus?: SharedTransientStatus;
  activeRun?: SharedActiveRun;
  task?: SharedTaskState;
  workerContext?: SharedWorkerContext;
};

export type SessionCoordinatorOptions = {
  siteId: string;
  sessionId: string;
  runtimeId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  workflowLockMs?: number;
  maxMessages?: number;
  maxTimeline?: number;
  onRoleChange?: (role: SharedRole, info: { localLogicalTabId?: number; activeLogicalTabId?: number; holderRuntimeId?: string }) => void;
  onStateChange?: (state: SharedSessionState, source: 'local' | 'remote') => void;
  onSwitchRequested?: (logicalTabId: number) => void;
  onTaskTabsExhausted?: (taskId: string) => void;
};

const SHARED_VERSION = 3;
const SHARED_KEY_PREFIX = 'rover:shared:';
const SHARED_CHANNEL_PREFIX = 'rover:channel:';
const STALE_DETACHED_EXTERNAL_TAB_MS = 2 * 60_000;
const STALE_DETACHED_TAB_MS = 90_000;
const STALE_NAVIGATION_HANDOFF_TAB_MS = 45_000;
const STALE_PENDING_ATTACH_TAB_MS = 20_000;
const STALE_RUNTIME_TAB_MS = 45_000;

type TabListScope = 'context' | 'all';

type TabPruneOptions = {
  dropRuntimeDetached?: boolean;
  dropAllDetachedExternal?: boolean;
  keepOnlyActiveLiveTab?: boolean;
  keepRecentExternalPlaceholders?: boolean;
};

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
    raw.status === 'completed'
    || raw.status === 'cancelled'
    || raw.status === 'failed'
    || raw.status === 'ended'
    || raw.status === 'running'
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

function sharedRecordStateFromTaskStatus(status?: SharedTaskState['status']): import('./runtimeTypes.js').TaskState {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled' || status === 'ended') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'running';
}

function sanitizeSharedChatLog(input: unknown): SharedChatLogEntry[] {
  if (!Array.isArray(input)) return [];
  const out: SharedChatLogEntry[] = [];
  for (const raw of input.slice(-4)) {
    const role = raw?.role === 'user' ? 'user' : (raw?.role === 'model' ? 'model' : undefined);
    if (!role) continue;
    const message = String(raw?.message || '').replace(/\s+/g, ' ').trim();
    if (!message) continue;
    const previous = out[out.length - 1];
    if (previous && previous.role === role && previous.message === message) continue;
    out.push({ role, message });
  }
  return out;
}

function sanitizeSharedTransientStatus(
  input: any,
  fallback?: { runId?: string; taskId?: string },
): SharedTransientStatus | undefined {
  if (!input) return undefined;
  const textCandidate = typeof input === 'string' ? input : input?.text;
  const text = String(textCandidate || '').trim();
  if (!text) return undefined;
  const runId =
    typeof input?.runId === 'string' && input.runId.trim()
      ? input.runId.trim()
      : (typeof fallback?.runId === 'string' && fallback.runId.trim() ? fallback.runId.trim() : undefined);
  const taskId =
    typeof input?.taskId === 'string' && input.taskId.trim()
      ? input.taskId.trim()
      : (typeof fallback?.taskId === 'string' && fallback.taskId.trim() ? fallback.taskId.trim() : undefined);
  return {
    text,
    ts: Number(input?.ts) || now(),
    runId,
    taskId,
    stage: typeof input?.stage === 'string' && input.stage.trim() ? input.stage.trim() : undefined,
  };
}

function sanitizeSharedUiMessages(input: unknown): SharedUiMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-ROVER_V2_PERSIST_CAPS.uiMessages)
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
    .filter((message: SharedUiMessage) => !!message.text || !!message.blocks?.length);
}

const VALID_ACTION_CUE_KINDS = new Set([
  'click',
  'type',
  'select',
  'clear',
  'focus',
  'hover',
  'press',
  'scroll',
  'drag',
  'navigate',
  'read',
  'wait',
  'unknown',
]);

function sanitizePositiveIds(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of input) {
    const id = Math.trunc(Number(value));
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length ? ids : undefined;
}

function sanitizeActionCue(input: unknown): RoverActionCue | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const kind = String(raw.kind || '').trim();
  if (!VALID_ACTION_CUE_KINDS.has(kind)) return undefined;
  const primaryElementId = Math.trunc(Number(raw.primaryElementId));
  const logicalTabId = Math.trunc(Number(raw.logicalTabId));
  const elementIds = sanitizePositiveIds(raw.elementIds);
  const toolCallId = typeof raw.toolCallId === 'string' && raw.toolCallId.trim()
    ? raw.toolCallId.trim().slice(0, 128)
    : undefined;
  const targetLabel = typeof raw.targetLabel === 'string' && raw.targetLabel.trim()
    ? raw.targetLabel.trim().slice(0, 64)
    : undefined;
  return {
    kind: kind as RoverActionCue['kind'],
    toolCallId,
    primaryElementId: Number.isFinite(primaryElementId) && primaryElementId > 0 ? primaryElementId : undefined,
    elementIds,
    logicalTabId: Number.isFinite(logicalTabId) && logicalTabId > 0 ? logicalTabId : undefined,
    valueRedacted: typeof raw.valueRedacted === 'boolean' ? raw.valueRedacted : undefined,
    targetLabel,
  };
}

function sanitizeSharedTimeline(input: unknown): SharedTimelineEvent[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-ROVER_V2_PERSIST_CAPS.timelineEvents)
    .map((event: any) => ({
      id: String(event?.id || randomId('timeline')),
      kind: String(event?.kind || 'status'),
      title: String(event?.title || 'Step'),
      detail: typeof event?.detail === 'string' ? event.detail : undefined,
      detailBlocks: sanitizeMessageBlocks(event?.detailBlocks),
      status: event?.status === 'pending' || event?.status === 'success' || event?.status === 'error' || event?.status === 'info' ? event.status : undefined,
      ts: Number(event?.ts) || now(),
      sourceRuntimeId: typeof event?.sourceRuntimeId === 'string' ? event.sourceRuntimeId : undefined,
      elementId: Number.isFinite(Number(event?.elementId)) ? Math.trunc(Number(event.elementId)) : undefined,
      toolName: typeof event?.toolName === 'string' ? event.toolName.slice(0, 120) : undefined,
      narration: typeof event?.narration === 'string' ? event.narration.replace(/\s+/g, ' ').trim().slice(0, 220) || undefined : undefined,
      narrationActive: typeof event?.narrationActive === 'boolean' ? event.narrationActive : undefined,
      actionCue: sanitizeActionCue(event?.actionCue),
    }))
    .filter((event: SharedTimelineEvent) => !!event.title);
}

const VALID_TASK_STATES = new Set(['idle', 'running', 'awaiting_user', 'paused', 'blocked', 'completed', 'failed', 'cancelled']);

function sanitizeSharedTaskRecord(raw: any): SharedTaskRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : '';
  if (!taskId) return undefined;
  const state = VALID_TASK_STATES.has(raw.state) ? raw.state : 'running';
  return {
    taskId,
    state,
    startedAt: Number(raw.startedAt) || now(),
    endedAt: Number(raw.endedAt) || undefined,
    activeRun:
      raw.activeRun && typeof raw.activeRun === 'object' && raw.activeRun.runId
        ? {
            runId: String(raw.activeRun.runId),
            text: String(raw.activeRun.text || ''),
            runtimeId: String(raw.activeRun.runtimeId || ''),
            startedAt: Number(raw.activeRun.startedAt) || now(),
            updatedAt: Number(raw.activeRun.updatedAt) || now(),
          }
        : undefined,
    workerContext: sanitizeSharedWorkerContext(raw.workerContext),
    uiMessages: Array.isArray(raw.uiMessages)
      ? raw.uiMessages.slice(-ROVER_V2_PERSIST_CAPS.uiMessages).map((m: any) => ({
          id: String(m?.id || randomId('msg')),
          role: m?.role === 'user' || m?.role === 'assistant' || m?.role === 'system' ? m.role : 'system',
          text: String(m?.text || ''),
          blocks: sanitizeMessageBlocks(m?.blocks),
          ts: Number(m?.ts) || now(),
          sourceRuntimeId: typeof m?.sourceRuntimeId === 'string' ? m.sourceRuntimeId : undefined,
        })).filter((m: SharedUiMessage) => !!m.text || !!m.blocks?.length)
      : [],
    timeline: Array.isArray(raw.timeline)
      ? raw.timeline.slice(-ROVER_V2_PERSIST_CAPS.timelineEvents).map((e: any) => ({
          id: String(e?.id || randomId('timeline')),
          kind: String(e?.kind || 'status'),
          title: String(e?.title || 'Step'),
          detail: typeof e?.detail === 'string' ? e.detail : undefined,
          detailBlocks: sanitizeMessageBlocks(e?.detailBlocks),
          status: e?.status === 'pending' || e?.status === 'success' || e?.status === 'error' || e?.status === 'info' ? e.status : undefined,
          ts: Number(e?.ts) || now(),
          sourceRuntimeId: typeof e?.sourceRuntimeId === 'string' ? e.sourceRuntimeId : undefined,
          elementId: Number.isFinite(Number(e?.elementId)) ? Math.trunc(Number(e.elementId)) : undefined,
          toolName: typeof e?.toolName === 'string' ? e.toolName.slice(0, 120) : undefined,
          actionCue: sanitizeActionCue(e?.actionCue),
        })).filter((e: SharedTimelineEvent) => !!e.title)
      : [],
    rootUserInput: typeof raw.rootUserInput === 'string' ? raw.rootUserInput : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    seedChatLog: sanitizeSharedChatLog(raw.seedChatLog),
    transientStatus: sanitizeSharedTransientStatus(raw.transientStatus, {
      runId: raw.activeRun?.runId,
      taskId,
    }),
  };
}

function sanitizeSharedTasks(raw: any): Record<string, SharedTaskRecord> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const result: Record<string, SharedTaskRecord> = {};
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count >= 20) break; // Safety cap on stored tasks
    const record = sanitizeSharedTaskRecord(raw[key]);
    if (record) {
      result[record.taskId] = record;
      count++;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
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
  const pendingStepRefRaw = raw.pendingAskUser?.stepRef;
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

  const normalizeEntries = (items: any[]): Array<{ role: string; content: string }> =>
    items
      .slice(-ROVER_V2_PERSIST_CAPS.uiMessages)
      .map(item => ({
        role: typeof item?.role === 'string' ? item.role : 'assistant',
        content: typeof item?.content === 'string' ? item.content : '',
      }))
      .filter(item => !!item.content);

  const history = Array.isArray(raw.history) ? normalizeEntries(raw.history) : [];
  const plannerHistory = cloneUnknownArrayTail(raw.plannerHistory, ROVER_V2_PERSIST_CAPS.plannerHistory);
  const agentPrevSteps = cloneUnknownArrayTail(raw.agentPrevSteps, ROVER_V2_PERSIST_CAPS.prevSteps);
  const rootUserInput = typeof raw.rootUserInput === 'string' ? raw.rootUserInput.trim() : '';

  return {
    trajectoryId: typeof raw.trajectoryId === 'string' ? raw.trajectoryId : undefined,
    taskBoundaryId: typeof raw.taskBoundaryId === 'string' && raw.taskBoundaryId.trim()
      ? raw.taskBoundaryId.trim()
      : undefined,
    rootUserInput: rootUserInput || undefined,
    seedChatLog: sanitizeSharedChatLog(raw.seedChatLog),
    history,
    plannerHistory,
    agentPrevSteps,
    pendingAskUser: pendingQuestions.length
      ? {
          questions: pendingQuestions,
          source: raw.pendingAskUser?.source === 'planner' ? 'planner' : 'act',
          askedAt: Number(raw.pendingAskUser?.askedAt) || now(),
          boundaryId:
            typeof raw.pendingAskUser?.boundaryId === 'string' && raw.pendingAskUser.boundaryId.trim()
              ? raw.pendingAskUser.boundaryId.trim()
              : undefined,
          ...(pendingStepRef ? { stepRef: pendingStepRef } : {}),
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
    transientStatus: undefined,
    activeRun: undefined,
    taskEpoch: 1,
    task: undefined,
    workerContext: undefined,
    workflowLock: undefined,
    // Multi-task v3
    tasks: undefined,
    activeTaskId: undefined,
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
            detachedAt: Number(entry?.detachedAt) || undefined,
            detachedReason:
              entry?.detachedReason === 'navigation_handoff'
              || entry?.detachedReason === 'tab_close'
              || entry?.detachedReason === 'opened_pending_attach'
              || entry?.detachedReason === 'unknown'
                ? entry.detachedReason
                : undefined,
            handoffId: typeof entry?.handoffId === 'string' ? entry.handoffId : undefined,
            handoffRunId: typeof entry?.handoffRunId === 'string' ? entry.handoffRunId : undefined,
            handoffTargetUrl: typeof entry?.handoffTargetUrl === 'string' ? entry.handoffTargetUrl : undefined,
            handoffCreatedAt: Number(entry?.handoffCreatedAt) || undefined,
          }))
          .filter((entry: SharedTabEntry) => !!entry.logicalTabId)
      : [],
    nextLogicalTabId: Math.max(1, Number(raw.nextLogicalTabId) || 1),
    activeLogicalTabId: Number(raw.activeLogicalTabId) || undefined,
    uiMessages: sanitizeSharedUiMessages(raw.uiMessages),
    timeline: sanitizeSharedTimeline(raw.timeline),
    taskEpoch: Math.max(1, Number(raw.taskEpoch) || 1),
    task: sanitizeSharedTask(raw.task),
    workerContext: sanitizeSharedWorkerContext(raw.workerContext),
    uiStatus: typeof raw.uiStatus === 'string' ? raw.uiStatus : undefined,
    transientStatus: sanitizeSharedTransientStatus(raw.transientStatus ?? raw.uiStatus, {
      runId: raw.activeRun?.runId,
      taskId: raw.task?.taskId,
    }),
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
    // Multi-task v3
    tasks: raw.tasks && typeof raw.tasks === 'object' ? sanitizeSharedTasks(raw.tasks) : undefined,
    activeTaskId: typeof raw.activeTaskId === 'string' ? raw.activeTaskId : undefined,
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

  syncDraftTaskRecordFromLegacy(state);

  return state;
}

function ensureDraftTaskRecord(draft: SharedSessionState): SharedTaskRecord | undefined {
  const taskId = String(draft.task?.taskId || draft.activeTaskId || '').trim();
  if (!taskId) return undefined;
  const startedAt = Number(draft.task?.startedAt) || now();
  if (!draft.tasks) draft.tasks = {};
  const existing = draft.tasks[taskId];
  if (existing) {
    draft.activeTaskId = taskId;
    return existing;
  }
  const created: SharedTaskRecord = {
    taskId,
    state: sharedRecordStateFromTaskStatus(draft.task?.status),
    startedAt,
    endedAt: draft.task?.endedAt,
    activeRun: draft.activeRun,
    workerContext: draft.workerContext,
    uiMessages: [...draft.uiMessages],
    timeline: [...draft.timeline],
    rootUserInput: draft.workerContext?.rootUserInput,
    summary: undefined,
    seedChatLog: sanitizeSharedChatLog(draft.workerContext?.seedChatLog),
    transientStatus: sanitizeSharedTransientStatus(draft.transientStatus ?? draft.uiStatus, {
      runId: draft.activeRun?.runId,
      taskId,
    }),
  };
  draft.tasks[taskId] = created;
  draft.activeTaskId = taskId;
  return created;
}

function syncDraftTaskRecordFromLegacy(draft: SharedSessionState): void {
  const record = ensureDraftTaskRecord(draft);
  if (!record) return;
  record.state = sharedRecordStateFromTaskStatus(draft.task?.status);
  record.startedAt = Number(draft.task?.startedAt) || record.startedAt || now();
  record.endedAt = Number(draft.task?.endedAt) || undefined;
  record.activeRun = draft.activeRun;
  record.workerContext = sanitizeSharedWorkerContext(draft.workerContext);
  record.uiMessages = sanitizeSharedUiMessages(draft.uiMessages);
  record.timeline = sanitizeSharedTimeline(draft.timeline);
  record.rootUserInput = draft.workerContext?.rootUserInput || record.rootUserInput;
  const latestAssistant = [...record.uiMessages].reverse().find(message => message.role === 'assistant');
  record.summary = latestAssistant?.text || record.summary;
  record.seedChatLog = sanitizeSharedChatLog(draft.workerContext?.seedChatLog);
  record.transientStatus = sanitizeSharedTransientStatus(draft.transientStatus ?? draft.uiStatus, {
    runId: draft.activeRun?.runId,
    taskId: record.taskId,
  });
}

export class SessionCoordinator {
  private readonly siteId: string;
  private readonly sessionId: string;
  private readonly runtimeId: string;
  private readonly leaseMs: number;
  private readonly workflowLockMs: number;
  private readonly heartbeatMs: number;
  private readonly maxMessages: number;
  private readonly maxTimeline: number;
  private readonly onRoleChange?: SessionCoordinatorOptions['onRoleChange'];
  private readonly onStateChange?: SessionCoordinatorOptions['onStateChange'];
  private readonly onSwitchRequested?: SessionCoordinatorOptions['onSwitchRequested'];
  private readonly onTaskTabsExhausted?: SessionCoordinatorOptions['onTaskTabsExhausted'];

  private readonly key: string;
  private readonly channelName: string;

  private state: SharedSessionState;
  private taskTabMapping: Map<number, string> = new Map(); // logicalTabId → taskId
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: number | null = null;
  private storageHandler: ((event: StorageEvent) => void) | null = null;
  private localLogicalTabId: number | undefined;
  private closing = false;
  private started = false;
  private heartbeatCount = 0;
  private lastNotifiedStateHash = '';
  private static readonly LS_HEARTBEAT_DIVISOR = 5; // localStorage write every 5th heartbeat
  private pendingRpcRequests = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: number;
  }>();
  private rpcRequestHandler?: (request: { method: string; params: any }) => Promise<any>;
  private lastNotifiedRole: SharedRole | undefined;
  private roleChangeTimer: number | null = null;
  private probeTimers: ReturnType<typeof setTimeout>[] = [];
  private static readonly ROLE_CHANGE_DEBOUNCE_MS = 200;

  /** Called when a remote tab broadcasts a session token via BroadcastChannel. */
  public onSessionTokenReceived?: (token: string, expiresAt: number) => void;
  /** Called when a remote tab broadcasts a projection via BroadcastChannel. */
  public onProjectionReceived?: (projection: any) => void;

  private tabFreshnessTs(tab: SharedTabEntry): number {
    return Math.max(
      Number(tab.updatedAt) || 0,
      Number(tab.openedAt) || 0,
      Number(tab.detachedAt) || 0,
    );
  }

  private isBetterTabCandidate(next: SharedTabEntry, current: SharedTabEntry | undefined): boolean {
    if (!current) return true;
    const nextFreshness = this.tabFreshnessTs(next);
    const currentFreshness = this.tabFreshnessTs(current);
    if (nextFreshness !== currentFreshness) return nextFreshness > currentFreshness;
    if (!!next.runtimeId !== !!current.runtimeId) return !!next.runtimeId;
    return next.logicalTabId < current.logicalTabId;
  }

  private isRuntimeTabFresh(tab: SharedTabEntry, nowMs: number): boolean {
    if (!tab.runtimeId) return false;
    if (tab.runtimeId === this.runtimeId) return true;
    return nowMs - this.tabFreshnessTs(tab) <= STALE_RUNTIME_TAB_MS;
  }

  private isTabVisibleInScope(tab: SharedTabEntry, nowMs: number, scope: TabListScope): boolean {
    if (tab.runtimeId) {
      return this.isRuntimeTabFresh(tab, nowMs);
    }

    if (tab.external) {
      return nowMs - this.tabFreshnessTs(tab) <= STALE_DETACHED_EXTERNAL_TAB_MS;
    }

    if (tab.detachedReason === 'opened_pending_attach') {
      return nowMs - this.tabFreshnessTs(tab) <= STALE_PENDING_ATTACH_TAB_MS;
    }

    if (scope === 'context') {
      return false;
    }

    if (tab.detachedReason === 'navigation_handoff') {
      return nowMs - this.tabFreshnessTs(tab) <= STALE_NAVIGATION_HANDOFF_TAB_MS;
    }

    return nowMs - this.tabFreshnessTs(tab) <= STALE_DETACHED_TAB_MS;
  }

  private normalizeDraftTabs(draft: SharedSessionState): void {
    const byLogicalTabId = new Map<number, SharedTabEntry>();
    for (const tab of draft.tabs) {
      if (!Number.isFinite(Number(tab.logicalTabId)) || Number(tab.logicalTabId) <= 0) continue;
      const existing = byLogicalTabId.get(tab.logicalTabId);
      if (this.isBetterTabCandidate(tab, existing)) {
        byLogicalTabId.set(tab.logicalTabId, tab);
      }
    }

    const dedupedByLogical: SharedTabEntry[] = [];
    const emittedLogical = new Set<number>();
    for (const tab of draft.tabs) {
      if (emittedLogical.has(tab.logicalTabId)) continue;
      const chosen = byLogicalTabId.get(tab.logicalTabId);
      if (!chosen) continue;
      if (chosen === tab) {
        dedupedByLogical.push(chosen);
        emittedLogical.add(chosen.logicalTabId);
      }
    }
    for (const [logicalTabId, tab] of byLogicalTabId.entries()) {
      if (emittedLogical.has(logicalTabId)) continue;
      dedupedByLogical.push(tab);
      emittedLogical.add(logicalTabId);
    }

    const byRuntimeId = new Map<string, SharedTabEntry>();
    for (const tab of dedupedByLogical) {
      if (!tab.runtimeId) continue;
      const existing = byRuntimeId.get(tab.runtimeId);
      if (this.isBetterTabCandidate(tab, existing)) {
        byRuntimeId.set(tab.runtimeId, tab);
      }
    }

    draft.tabs = dedupedByLogical
      .filter(tab => !tab.runtimeId || byRuntimeId.get(tab.runtimeId) === tab)
      .sort((a, b) => a.logicalTabId - b.logicalTabId);

    if (!draft.tabs.length) {
      draft.activeLogicalTabId = undefined;
      draft.nextLogicalTabId = 1;
      return;
    }

    const nowMs = now();
    const currentActive = draft.activeLogicalTabId
      ? draft.tabs.find(tab => tab.logicalTabId === draft.activeLogicalTabId)
      : undefined;
    const localAttached = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
    const liveTabs = draft.tabs.filter(tab => this.isRuntimeTabFresh(tab, nowMs));
    const freshestLiveTab = [...liveTabs].sort((a, b) => this.tabFreshnessTs(b) - this.tabFreshnessTs(a))[0];

    let nextActiveLogicalTabId = currentActive?.logicalTabId;
    if (!currentActive) {
      nextActiveLogicalTabId = localAttached?.logicalTabId || freshestLiveTab?.logicalTabId || draft.tabs[0]?.logicalTabId;
    } else if (!currentActive.runtimeId || !this.isRuntimeTabFresh(currentActive, nowMs)) {
      nextActiveLogicalTabId = localAttached?.logicalTabId || freshestLiveTab?.logicalTabId || currentActive.logicalTabId;
    }

    draft.activeLogicalTabId = nextActiveLogicalTabId;
    const maxLogicalTabId = draft.tabs.reduce((max, tab) => Math.max(max, tab.logicalTabId), 0);
    draft.nextLogicalTabId = Math.max(Number(draft.nextLogicalTabId) || 1, maxLogicalTabId + 1);
  }

  /** Update the tab-to-task mapping for task-aware tab pruning. */
  setTaskTabMapping(mapping: Map<number, string>): void {
    this.taskTabMapping = mapping;
  }

  private pruneDetachedTabs(
    draft: SharedSessionState,
    options?: TabPruneOptions,
  ): void {
    const dropRuntimeDetached = !!options?.dropRuntimeDetached;
    const dropAllDetachedExternal = !!options?.dropAllDetachedExternal;
    const keepOnlyActiveLiveTab = !!options?.keepOnlyActiveLiveTab;
    const keepRecentExternalPlaceholders = !!options?.keepRecentExternalPlaceholders;
    const nowMs = now();

    // Snapshot pre-prune tab IDs per task for exhaustion detection
    const prePruneTaskTabs = new Map<string, Set<number>>();
    if (this.onTaskTabsExhausted && this.taskTabMapping.size > 0) {
      for (const tab of draft.tabs) {
        const taskId = this.taskTabMapping.get(tab.logicalTabId);
        if (taskId) {
          let set = prePruneTaskTabs.get(taskId);
          if (!set) { set = new Set(); prePruneTaskTabs.set(taskId, set); }
          set.add(tab.logicalTabId);
        }
      }
    }

    draft.tabs = draft.tabs.filter(tab => {
      if (tab.runtimeId) {
        return this.isRuntimeTabFresh(tab, nowMs);
      }

      if (dropRuntimeDetached && !tab.external && tab.openerRuntimeId === this.runtimeId) {
        return false;
      }

      if (tab.external) {
        if (dropAllDetachedExternal) return false;
        return nowMs - this.tabFreshnessTs(tab) <= STALE_DETACHED_EXTERNAL_TAB_MS;
      }

      const ageMs = nowMs - this.tabFreshnessTs(tab);
      if (tab.detachedReason === 'navigation_handoff') {
        return ageMs <= STALE_NAVIGATION_HANDOFF_TAB_MS;
      }
      if (tab.detachedReason === 'opened_pending_attach') {
        return ageMs <= STALE_PENDING_ATTACH_TAB_MS;
      }

      return ageMs <= STALE_DETACHED_TAB_MS;
    });

    if (keepOnlyActiveLiveTab) {
      this.normalizeDraftTabs(draft);
      const liveTabs = draft.tabs.filter(tab => this.isRuntimeTabFresh(tab, nowMs));
      const activeLiveTab = liveTabs.find(tab => tab.logicalTabId === draft.activeLogicalTabId);
      const localLiveTab = liveTabs.find(tab => tab.runtimeId === this.runtimeId);
      const fallbackLiveTab = [...liveTabs].sort((a, b) => this.tabFreshnessTs(b) - this.tabFreshnessTs(a))[0];
      const keepLiveTabId = activeLiveTab?.logicalTabId || localLiveTab?.logicalTabId || fallbackLiveTab?.logicalTabId;

      draft.tabs = draft.tabs.filter(tab => {
        if (tab.runtimeId) {
          return !!keepLiveTabId && tab.logicalTabId === keepLiveTabId;
        }
        if (tab.external) {
          return keepRecentExternalPlaceholders && nowMs - this.tabFreshnessTs(tab) <= STALE_DETACHED_EXTERNAL_TAB_MS;
        }
        return false;
      });

      draft.activeLogicalTabId =
        keepLiveTabId
        || draft.tabs.find(tab => tab.runtimeId)?.logicalTabId
        || draft.tabs[0]?.logicalTabId;
    }

    this.normalizeDraftTabs(draft);

    // Detect tasks that lost ALL their tabs after pruning
    if (this.onTaskTabsExhausted && prePruneTaskTabs.size > 0) {
      const postPruneTabIds = new Set(draft.tabs.map(t => t.logicalTabId));
      for (const [taskId, preTabs] of prePruneTaskTabs) {
        let hasRemaining = false;
        for (const tabId of preTabs) {
          if (postPruneTabIds.has(tabId)) { hasRemaining = true; break; }
        }
        if (!hasRemaining) {
          this.onTaskTabsExhausted(taskId);
        }
      }
    }
  }

  private resetDraftToSingleCurrentTab(
    draft: SharedSessionState,
    url: string,
    title?: string,
  ): void {
    const nowTs = now();
    const normalizedUrl = normalizeUrl(url);
    const existingLocal = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
    const openedAt = Number(existingLocal?.openedAt) || nowTs;

    draft.tabs = [
      {
        logicalTabId: 1,
        runtimeId: this.runtimeId,
        url: normalizedUrl || existingLocal?.url || '',
        title: title || existingLocal?.title,
        openedAt,
        updatedAt: nowTs,
        external: false,
        detachedAt: undefined,
        detachedReason: undefined,
      },
    ];
    draft.activeLogicalTabId = 1;
    draft.nextLogicalTabId = 2;
    draft.lease = {
      holderRuntimeId: this.runtimeId,
      expiresAt: nowTs + this.leaseMs,
      updatedAt: nowTs,
    };
  }

  constructor(options: SessionCoordinatorOptions) {
    this.siteId = options.siteId;
    this.sessionId = options.sessionId;
    this.runtimeId = options.runtimeId;
    this.leaseMs = Math.max(4000, Number(options.leaseMs) || 12000);
    this.workflowLockMs = Math.max(30_000, Number(options.workflowLockMs) || 180_000);
    this.heartbeatMs = Math.max(800, Number(options.heartbeatMs) || 2000);
    this.maxMessages = Math.max(20, Number(options.maxMessages) || ROVER_V2_PERSIST_CAPS.uiMessages);
    this.maxTimeline = Math.max(20, Number(options.maxTimeline) || ROVER_V2_PERSIST_CAPS.timelineEvents);
    this.onRoleChange = options.onRoleChange;
    this.onStateChange = options.onStateChange;
    this.onSwitchRequested = options.onSwitchRequested;
    this.onTaskTabsExhausted = options.onTaskTabsExhausted;

    this.key = `${SHARED_KEY_PREFIX}${this.siteId}:${this.sessionId}`;
    this.channelName = `${SHARED_CHANNEL_PREFIX}${this.siteId}:${this.sessionId}`;

    this.state = this.loadState();
    this.normalizeDraftTabs(this.state);
  }

  start(initialHandoff?: SharedNavigationHandoff): void {
    if (this.started) return;
    this.started = true;

    this.mutate('local', draft => {
      // Page refreshes can leave detached virtual tabs from previous runs.
      this.pruneDetachedTabs(draft, { dropRuntimeDetached: true });
    });

    this.registerCurrentTab(window.location.href, document.title || undefined, initialHandoff);
    this.claimLease(false);

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
        if (payload.type === 'session_token' && payload.runtimeId !== this.runtimeId) {
          this.onSessionTokenReceived?.(payload.token, payload.expiresAt);
        }
        if (payload.type === 'projection' && payload.runtimeId !== this.runtimeId) {
          this.onProjectionReceived?.(payload.projection);
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
    if (typeof (this.heartbeatTimer as any)?.unref === 'function') {
      (this.heartbeatTimer as any).unref();
    }

    this.notifyRoleChange();
    this.onStateChange?.(this.state, 'local');
  }

  stop(): void {
    this.heartbeatCount = 0;

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

    // Clean up probe timers
    for (const timer of this.probeTimers) {
      clearTimeout(timer);
    }
    this.probeTimers = [];

    if (!this.started) return;
    this.started = false;

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
      syncDraftTaskRecordFromLegacy(draft);
    });
  }

  hydrateExternalState(raw: any): boolean {
    const incoming = sanitizeSharedState(raw, this.siteId, this.sessionId);
    this.pruneDetachedTabs(incoming, { dropRuntimeDetached: true });
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
          this.pruneDetachedTabs(draft, { dropRuntimeDetached: true });
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

  listTabs(options?: { scope?: TabListScope }): SharedTabEntry[] {
    const scope: TabListScope = options?.scope === 'all' ? 'all' : 'context';
    const nowMs = now();
    return this.state.tabs.filter(tab => this.isTabVisibleInScope(tab, nowMs, scope));
  }

  pruneTabs(options?: TabPruneOptions): void {
    this.mutate('local', draft => {
      this.pruneDetachedTabs(draft, options);
    });
  }

  resetTabsToCurrent(url: string, title?: string): number {
    this.mutate('local', draft => {
      this.resetDraftToSingleCurrentTab(draft, url, title);
    });
    this.notifyRoleChange();
    return this.localLogicalTabId || 1;
  }

  startNewTask(task: Omit<SharedTaskState, 'status'> & { status?: SharedTaskState['status'] }): SharedTaskState {
    const startedAt = Number(task.startedAt) || now();
    const nextTask: SharedTaskState = {
      taskId: String(task.taskId || randomId('task')),
      status:
        task.status === 'completed'
        || task.status === 'cancelled'
        || task.status === 'failed'
        || task.status === 'ended'
          ? task.status
          : 'running',
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
      draft.transientStatus = undefined;
      draft.activeRun = undefined;
      draft.workerContext = undefined;
      this.resetDraftToSingleCurrentTab(draft, window.location.href, document.title || undefined);
      syncDraftTaskRecordFromLegacy(draft);
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
      draft.transientStatus = undefined;
      draft.uiStatus = undefined;
      syncDraftTaskRecordFromLegacy(draft);
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
      syncDraftTaskRecordFromLegacy(draft);
    });
  }

  setWorkerContext(context: SharedWorkerContext | undefined): void {
    this.mutate('local', draft => {
      if (!context) {
        draft.workerContext = undefined;
        syncDraftTaskRecordFromLegacy(draft);
        return;
      }
      draft.workerContext = sanitizeSharedWorkerContext(context);
      syncDraftTaskRecordFromLegacy(draft);
    });
  }

  setStatus(status: string | SharedTransientStatus | undefined): void {
    this.mutate('local', draft => {
      const normalized = sanitizeSharedTransientStatus(status, {
        runId: draft.activeRun?.runId,
        taskId: draft.task?.taskId,
      });
      draft.uiStatus = normalized?.text;
      draft.transientStatus = normalized;
      syncDraftTaskRecordFromLegacy(draft);
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
      syncDraftTaskRecordFromLegacy(draft);
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
      elementId: Number.isFinite(Number(event.elementId)) ? Math.trunc(Number(event.elementId)) : undefined,
      toolName: typeof event.toolName === 'string' ? event.toolName.slice(0, 120) : undefined,
      narration: typeof event.narration === 'string' ? event.narration.replace(/\s+/g, ' ').trim().slice(0, 220) || undefined : undefined,
      narrationActive: typeof event.narrationActive === 'boolean' ? event.narrationActive : undefined,
      actionCue: sanitizeActionCue(event.actionCue),
    };

    this.mutate('local', draft => {
      draft.timeline.push(next);
      if (draft.timeline.length > this.maxTimeline) {
        draft.timeline = draft.timeline.slice(-this.maxTimeline);
      }
      syncDraftTaskRecordFromLegacy(draft);
    });

    return next;
  }

  clearTimeline(): void {
    this.mutate('local', draft => {
      draft.timeline = [];
      syncDraftTaskRecordFromLegacy(draft);
    });
  }

  setActiveRun(activeRun: { runId: string; text: string } | undefined): void {
    this.mutate('local', draft => {
      if (!activeRun) {
        draft.activeRun = undefined;
        draft.transientStatus = undefined;
        draft.uiStatus = undefined;
        syncDraftTaskRecordFromLegacy(draft);
        return;
      }
      if (draft.task && draft.task.status !== 'running') {
        draft.activeRun = undefined;
        syncDraftTaskRecordFromLegacy(draft);
        return;
      }
      draft.activeRun = {
        runId: activeRun.runId,
        text: activeRun.text,
        runtimeId: this.runtimeId,
        startedAt: draft.activeRun?.runId === activeRun.runId ? draft.activeRun.startedAt : now(),
        updatedAt: now(),
      };
      syncDraftTaskRecordFromLegacy(draft);
    });
  }

  requestControl(): boolean {
    return this.claimLease(true);
  }

  registerCurrentTab(url: string, title?: string, handoff?: SharedNavigationHandoff): number {
    const normalizedUrl = normalizeUrl(url);
    const handoffId = typeof handoff?.handoffId === 'string' ? handoff.handoffId.trim() : '';
    const handoffTabId = Number(handoff?.sourceLogicalTabId);

    let nextLocalTabId: number | undefined;
    this.mutate('local', draft => {
      const nowTs = now();
      const leaseValid = !!(draft.lease && draft.lease.expiresAt > nowTs);
      const controllerRuntimeId = leaseValid ? draft.lease?.holderRuntimeId : undefined;
      const remoteWorkflowLock =
        draft.workflowLock
        && draft.workflowLock.runtimeId
        && draft.workflowLock.runtimeId !== this.runtimeId
        && draft.workflowLock.expiresAt > nowTs
          ? draft.workflowLock
          : undefined;
      const remoteWorkflowOwnerTab = remoteWorkflowLock
        ? draft.tabs.find(tab =>
          tab.runtimeId === remoteWorkflowLock.runtimeId
          && tab.updatedAt > nowTs - 2 * this.heartbeatMs,
        )
        : undefined;
      const shouldPreferLocalAsActive =
        !remoteWorkflowOwnerTab && (!controllerRuntimeId || controllerRuntimeId === this.runtimeId);

      const existing = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
      if (existing) {
        existing.url = normalizedUrl || existing.url;
        existing.title = title || existing.title;
        existing.updatedAt = nowTs;
        existing.detachedAt = undefined;
        existing.detachedReason = undefined;
        existing.handoffId = undefined;
        existing.handoffRunId = undefined;
        existing.handoffTargetUrl = undefined;
        existing.handoffCreatedAt = undefined;
        nextLocalTabId = existing.logicalTabId;
      } else {
        let adopted: SharedTabEntry | undefined;
        if (handoffId) {
          adopted = draft.tabs.find(tab => {
            if (tab.runtimeId) return false;
            if (String(tab.handoffId || '').trim() !== handoffId) return false;
            if (Number.isFinite(handoffTabId) && handoffTabId > 0 && tab.logicalTabId !== handoffTabId) return false;
            const ageMs = nowTs - Number(tab.handoffCreatedAt || tab.updatedAt || tab.openedAt || 0);
            return ageMs >= 0 && ageMs <= 30_000;
          });
        }
        if (!adopted) {
          adopted = draft.tabs.find(
            tab => !tab.runtimeId && !tab.external && tab.url === normalizedUrl && nowTs - tab.openedAt < 180000,
          );
        }
        if (adopted) {
          adopted.runtimeId = this.runtimeId;
          adopted.url = normalizedUrl || adopted.url;
          adopted.title = title || adopted.title;
          adopted.updatedAt = nowTs;
          adopted.detachedAt = undefined;
          adopted.detachedReason = undefined;
          adopted.handoffId = undefined;
          adopted.handoffRunId = undefined;
          adopted.handoffTargetUrl = undefined;
          adopted.handoffCreatedAt = undefined;
          nextLocalTabId = adopted.logicalTabId;
        } else {
          const logicalTabId = draft.nextLogicalTabId++;
          draft.tabs.push({
            logicalTabId,
            runtimeId: this.runtimeId,
            url: normalizedUrl,
            title,
            openedAt: nowTs,
            updatedAt: nowTs,
            external: false,
            detachedAt: undefined,
            detachedReason: undefined,
          });
          nextLocalTabId = logicalTabId;
        }
      }

      if (nextLocalTabId) {
        draft.tabs = draft.tabs.filter(tab => {
          if (tab.logicalTabId === nextLocalTabId) return true;
          if (tab.runtimeId || tab.external) return true;
          if (handoffId && String(tab.handoffId || '').trim() === handoffId) {
            return false;
          }
          const freshnessAge = nowTs - this.tabFreshnessTs(tab);
          if (!String(tab.url || '').trim() && freshnessAge > STALE_PENDING_ATTACH_TAB_MS) {
            return false;
          }
          if (normalizedUrl && tab.url === normalizedUrl && freshnessAge <= STALE_NAVIGATION_HANDOFF_TAB_MS) {
            return false;
          }
          return true;
        });
      }

      const activeEntry = draft.activeLogicalTabId
        ? draft.tabs.find(tab => tab.logicalTabId === draft.activeLogicalTabId)
        : undefined;
      if (remoteWorkflowOwnerTab) {
        draft.activeLogicalTabId = remoteWorkflowOwnerTab.logicalTabId;
      } else if (
        !activeEntry
        || !activeEntry.runtimeId
        || activeEntry.logicalTabId === nextLocalTabId
        || shouldPreferLocalAsActive
      ) {
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
      const nowTs = now();
      const existing = draft.tabs.find(tab =>
        !tab.runtimeId
        && !!tab.external === !!payload.external
        && tab.url === normalizedUrl,
      );
      if (existing) {
        existing.title = payload.title || existing.title;
        existing.updatedAt = nowTs;
        existing.openerRuntimeId = payload.openerRuntimeId || existing.openerRuntimeId;
        existing.detachedAt = existing.detachedAt || nowTs;
        existing.detachedReason = 'opened_pending_attach';
        logicalTabId = existing.logicalTabId;
        return;
      }

      logicalTabId = draft.nextLogicalTabId++;
      draft.tabs.push({
        logicalTabId,
        runtimeId: undefined,
        url: normalizedUrl,
        title: payload.title,
        openedAt: nowTs,
        updatedAt: nowTs,
        external: !!payload.external,
        openerRuntimeId: payload.openerRuntimeId,
        detachedAt: nowTs,
        detachedReason: 'opened_pending_attach',
      });
    });

    // Start Rover availability probe: monitor for runtime connecting within 5s
    if (payload.external) {
      this.probeRoverAvailability(logicalTabId);
    }

    return { logicalTabId };
  }

  /** Probe whether Rover is available on a newly opened tab. */
  private probeRoverAvailability(logicalTabId: number): void {
    const PROBE_TIMEOUT_MS = 5_000;
    const timer = setTimeout(() => {
      // Check if the tab has a runtime attached now
      const tab = this.state.tabs.find(t => t.logicalTabId === logicalTabId);
      if (tab && !tab.runtimeId) {
        // Mark as not available
        this.mutate('local', draft => {
          const draftTab = draft.tabs.find(t => t.logicalTabId === logicalTabId);
          if (draftTab) {
            (draftTab as any).roverAvailability = 'not_available';
          }
        });
      }
    }, PROBE_TIMEOUT_MS);
    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    // Allow cleanup if coordinator is stopped
    this.probeTimers.push(timer);
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
      if (typeof (timer as any)?.unref === 'function') {
        (timer as any).unref();
      }

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

  broadcastClosing(handoff?: SharedNavigationHandoff): void {
    this.closing = true;
    // Mark local tab as detached instead of removing.
    // For navigation: new runtime adopts the detached tab, preserving logicalTabId.
    // For genuine tab close: pruneDetachedTabs removes it after STALE_DETACHED_TAB_MS.
    this.mutate('local', draft => {
      const nowTs = now();
      const localTab = draft.tabs.find(t => t.runtimeId === this.runtimeId);
      if (localTab) {
        localTab.runtimeId = undefined;
        localTab.updatedAt = nowTs;
        localTab.detachedAt = nowTs;
        localTab.detachedReason = handoff ? 'navigation_handoff' : 'tab_close';
        localTab.handoffId = typeof handoff?.handoffId === 'string' ? handoff.handoffId : undefined;
        localTab.handoffRunId = typeof handoff?.runId === 'string' ? handoff.runId : undefined;
        localTab.handoffTargetUrl = typeof handoff?.targetUrl === 'string' ? handoff.targetUrl : undefined;
        localTab.handoffCreatedAt = Number(handoff?.ts) || nowTs;
      }
      if (draft.lease?.holderRuntimeId === this.runtimeId) {
        draft.lease = undefined;
      }
    });
    if (!this.channel) return;
    this.channel.postMessage({
      type: 'tab_closing',
      runtimeId: this.runtimeId,
      logicalTabId: this.localLogicalTabId,
      handoff,
    });
  }

  isTabAlive(logicalTabId: number): boolean {
    const tab = this.state.tabs.find(t => t.logicalTabId === logicalTabId);
    if (!tab) return false;
    return tab.updatedAt > now() - 2 * this.heartbeatMs;
  }

  // ---- Transport Relay (controller → observer) ----

  broadcastSessionToken(token: string, expiresAt: number): void {
    if (this.channel) {
      this.channel.postMessage({
        type: 'session_token',
        runtimeId: this.runtimeId,
        token,
        expiresAt,
      });
    }
  }

  broadcastProjection(projection: any): void {
    if (this.channel) {
      this.channel.postMessage({
        type: 'projection',
        runtimeId: this.runtimeId,
        projection,
      });
    }
  }

  // ---- Workflow Lock ----

  acquireWorkflowLock(runId: string, options?: { force?: boolean }): boolean {
    let acquired = false;
    this.mutate('local', draft => {
      const existing = draft.workflowLock;
      if (!options?.force && existing && existing.runtimeId !== this.runtimeId && existing.expiresAt > now()) {
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
        expiresAt: now() + this.workflowLockMs,
      };
      acquired = true;
    });
    return acquired;
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
    const handoff = payload?.handoff;
    const handoffId = typeof handoff?.handoffId === 'string' && handoff.handoffId.trim()
      ? handoff.handoffId.trim()
      : undefined;
    const handoffRunId = typeof handoff?.runId === 'string' && handoff.runId.trim()
      ? handoff.runId.trim()
      : undefined;
    const handoffTargetUrl = typeof handoff?.targetUrl === 'string' && handoff.targetUrl.trim()
      ? handoff.targetUrl.trim()
      : undefined;
    const handoffCreatedAt = Number(handoff?.ts) || now();

    this.mutate('local', draft => {
      const nowTs = now();
      const tab = draft.tabs.find(t => t.runtimeId === closingRuntimeId);
      if (tab) {
        tab.runtimeId = undefined;
        tab.updatedAt = nowTs;
        tab.detachedAt = nowTs;
        tab.detachedReason = handoffId ? 'navigation_handoff' : 'tab_close';
        tab.handoffId = handoffId;
        tab.handoffRunId = handoffRunId;
        tab.handoffTargetUrl = handoffTargetUrl;
        tab.handoffCreatedAt = handoffCreatedAt;
      }
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
        draft.activeLogicalTabId = this.localLogicalTabId || draft.tabs[0]?.logicalTabId;
      }
    });
    this.notifyRoleChange();
  }

  private lastFullHeartbeatAt = 0;

  private heartbeat(): void {
    if (this.closing) return;
    this.heartbeatCount++;

    const currentUrl = normalizeUrl(window.location.href);
    const currentTitle = document.title || undefined;
    const nowMs = now();

    // Fast path: if lease is still valid for this runtime and was recently fully checked,
    // only update the local tab's updatedAt + URL/title in-place without full sanitize cycle.
    const lease = this.state.lease;
    const leaseValid = lease && lease.holderRuntimeId === this.runtimeId && lease.expiresAt > nowMs;
    const recentFullHeartbeat = nowMs - this.lastFullHeartbeatAt < 5_000;
    const localTab = this.state.tabs.find(tab => tab.runtimeId === this.runtimeId);

    if (leaseValid && recentFullHeartbeat && localTab) {
      // Lightweight update: skip mutate/sanitize AND skip persist/broadcast.
      // The updatedAt timestamp only needs to be in memory for local liveness checks.
      // It gets persisted on the next full heartbeat (every 5s), which is well within
      // the lease window (12s). This avoids triggering storage events + JSON.parse
      // in all other tabs on every 2s heartbeat.
      localTab.url = currentUrl || localTab.url;
      localTab.title = currentTitle || localTab.title;
      localTab.updatedAt = nowMs;
      localTab.detachedAt = undefined;
      localTab.detachedReason = undefined;
      this.state.updatedAt = nowMs;
      return;
    }

    this.lastFullHeartbeatAt = nowMs;

    // Only persist to localStorage every Nth full heartbeat; BroadcastChannel still fires every time
    const skipLsPersist = this.heartbeatCount % SessionCoordinator.LS_HEARTBEAT_DIVISOR !== 0;

    this.mutate('local', draft => {
      const currentTab = draft.tabs.find(tab => tab.runtimeId === this.runtimeId);
      if (currentTab) {
        currentTab.url = currentUrl || currentTab.url;
        currentTab.title = currentTitle || currentTab.title;
        currentTab.updatedAt = now();
        currentTab.detachedAt = undefined;
        currentTab.detachedReason = undefined;
      } else {
        const nowTs = now();
        const logicalTabId = draft.nextLogicalTabId++;
        draft.tabs.push({
          logicalTabId,
          runtimeId: this.runtimeId,
          url: currentUrl,
          title: currentTitle,
          openedAt: nowTs,
          updatedAt: nowTs,
          external: false,
          detachedAt: undefined,
          detachedReason: undefined,
        });
      }

      const lease = draft.lease;
      const leaseExpired = !lease || lease.expiresAt <= now();
      const remoteHolderRuntimeId =
        lease && lease.holderRuntimeId !== this.runtimeId && lease.expiresAt > now()
          ? lease.holderRuntimeId
          : undefined;
      const remoteHolderTab = remoteHolderRuntimeId
        ? draft.tabs.find(tab => tab.runtimeId === remoteHolderRuntimeId)
        : undefined;
      const remoteHolderAlive = !!(remoteHolderTab && remoteHolderTab.updatedAt > now() - 2 * this.heartbeatMs);
      const lockHolderRuntimeId = draft.workflowLock?.runtimeId;
      const lockHolderTab = lockHolderRuntimeId
        ? draft.tabs.find(tab => tab.runtimeId === lockHolderRuntimeId)
        : undefined;
      const lockHolderAlive = !!(
        lockHolderTab
        && lockHolderTab.runtimeId
        && lockHolderTab.runtimeId !== this.runtimeId
        && lockHolderTab.updatedAt > now() - 2 * this.heartbeatMs
      );
      if (
        draft.workflowLock
        && draft.workflowLock.runtimeId !== this.runtimeId
        && (draft.workflowLock.expiresAt <= now() || !lockHolderAlive)
      ) {
        draft.workflowLock = undefined;
      }
      if (draft.workflowLock && draft.workflowLock.runtimeId !== this.runtimeId && lockHolderAlive && lockHolderTab) {
        draft.activeLogicalTabId = lockHolderTab.logicalTabId;
      }
      if (draft.activeRun?.runtimeId && draft.activeRun.runtimeId !== this.runtimeId) {
        const runHolderTab = draft.tabs.find(tab => tab.runtimeId === draft.activeRun?.runtimeId);
        const runHolderAlive = !!(runHolderTab && runHolderTab.updatedAt > now() - 2 * this.heartbeatMs);
        if (!runHolderAlive) {
          draft.activeRun = undefined;
        }
      }
      const hasRemoteActiveRun = !!(draft.activeRun?.runtimeId && draft.activeRun.runtimeId !== this.runtimeId);
      const hasRemoteWorkflowLock = !!(
        draft.workflowLock
        && draft.workflowLock.runtimeId !== this.runtimeId
        && draft.workflowLock.expiresAt > now()
      );
      const shouldReclaimFromObserver = !!(
        remoteHolderRuntimeId
        && !remoteHolderAlive
        && !hasRemoteActiveRun
        && !hasRemoteWorkflowLock
      );

      if (leaseExpired || lease?.holderRuntimeId === this.runtimeId || shouldReclaimFromObserver) {
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
        draft.workflowLock.expiresAt = now() + this.workflowLockMs;
      }

      this.pruneDetachedTabs(draft);
    }, { skipPersist: skipLsPersist });

    this.notifyRoleChange();
  }

  reloadFromStorage(): SharedSessionState {
    const fresh = this.loadState();
    this.normalizeDraftTabs(fresh);
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
    if (typeof (this.roleChangeTimer as any)?.unref === 'function') {
      (this.roleChangeTimer as any).unref();
    }
  }

  private syncLocalLogicalTabId(): void {
    const tab = this.state.tabs.find(t => t.runtimeId === this.runtimeId);
    this.localLogicalTabId = tab?.logicalTabId;
  }

  private mutate(source: 'local' | 'remote', updater: (draft: SharedSessionState) => void, options?: { skipPersist?: boolean }): void {
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
    this.normalizeDraftTabs(draft);
    draft.seq = Math.max(1, Number(draft.seq) || 1) + (source === 'local' ? 1 : 0);
    draft.updatedAt = now();

    this.state = draft;
    this.syncLocalLogicalTabId();

    if (source === 'local') {
      if (!options?.skipPersist) {
        this.persistState();
      }
      if (this.channel) {
        this.channel.postMessage({ type: 'state', sourceRuntimeId: this.runtimeId, state: this.state });
      }
    }

    const hash = this.computeStateHash(this.state);
    if (hash !== this.lastNotifiedStateHash) {
      this.lastNotifiedStateHash = hash;
      this.onStateChange?.(this.state, source);
    }
  }

  private computeStateHash(state: SharedSessionState): string {
    const tabs = state.tabs;
    return `${tabs.length}:${tabs.map(t =>
      `${t.logicalTabId}|${t.runtimeId || ''}|${t.url}|${t.title || ''}|${!!t.detachedAt}`
    ).join(';')}:${state.activeLogicalTabId ?? ''}:${state.lease?.holderRuntimeId ?? ''}:${state.activeRun?.runId ?? ''}:${state.activeRun?.runtimeId ?? ''}:${state.workflowLock?.runtimeId ?? ''}:${state.taskEpoch ?? ''}:${(state.uiMessages as any[])?.length ?? 0}:${(state.timeline as any[])?.length ?? 0}:${state.transientStatus?.text ?? state.uiStatus ?? ''}`;
  }

  private applyIncomingState(incoming: SharedSessionState): void {
    if (!incoming) return;
    if (incoming.seq < this.state.seq) return;
    if (incoming.seq === this.state.seq && incoming.updatedAt <= this.state.updatedAt) return;
    this.pruneDetachedTabs(incoming);
    this.normalizeDraftTabs(incoming);
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
