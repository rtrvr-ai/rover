import type { RoverExecutionMode, RoverMessageBlock, RoverTimelineEvent } from '@rover/ui';

export type UiRole = 'user' | 'assistant' | 'system';

export type PersistedUiMessage = {
  id: string;
  role: UiRole;
  text: string;
  blocks?: RoverMessageBlock[];
  ts: number;
  sourceRuntimeId?: string;
};

export type PersistedTimelineEvent = {
  id: string;
  kind: RoverTimelineEvent['kind'];
  title: string;
  detail?: string;
  detailBlocks?: RoverMessageBlock[];
  status?: RoverTimelineEvent['status'];
  ts: number;
  sourceRuntimeId?: string;
};

export type PersistedWorkerHistoryMessage = {
  role: string;
  content: string;
};

export type PersistedPlannerQuestion = {
  key: string;
  query: string;
  id?: string;
  question?: string;
  choices?: string[];
};

export type PersistedPendingAskUser = {
  questions: PersistedPlannerQuestion[];
  source: 'act' | 'planner';
  askedAt: number;
  boundaryId?: string;
  stepRef?: {
    stepIndex: number;
    functionIndex: number;
    accTreeId?: string;
  };
};

export type PersistedWorkerState = {
  trajectoryId?: string;
  taskBoundaryId?: string;
  rootUserInput?: string;
  history?: PersistedWorkerHistoryMessage[];
  plannerHistory?: unknown[];
  agentPrevSteps?: unknown[];
  lastToolPreviousSteps?: unknown[];
  pendingAskUser?: PersistedPendingAskUser;
  updatedAt?: number;
};

// ── Legacy types (v1 compat) ─────────────────────────────────────────

export type PersistedTaskState = {
  taskId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'ended';
  startedAt: number;
  lastUserAt?: number;
  lastAssistantAt?: number;
  boundaryReason?: string;
  endedAt?: number;
};

// ── New v2 types ─────────────────────────────────────────────────────

/** Authoritative FSM state. Replaces the old `status` field. */
export type TaskState = 'idle' | 'running' | 'awaiting_user' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled';

/**
 * Per-task isolated record. Each task owns its own messages, timeline,
 * worker state, and tab scope — no cross-contamination.
 */
export type TaskRecord = {
  taskId: string;
  state: TaskState;
  boundaryId: string;

  // Lifecycle timestamps
  startedAt: number;
  endedAt?: number;
  lastUserAt?: number;
  lastAssistantAt?: number;
  pausedAt?: number;
  blockedAt?: number;
  blockReason?: string;
  prePauseState?: 'running' | 'awaiting_user';

  // Per-task isolated data (previously global singletons)
  uiMessages: PersistedUiMessage[];
  timeline: PersistedTimelineEvent[];
  workerState?: PersistedWorkerState;
  pendingRun?: PersistedPendingRun;
  tabScope?: PersistedTaskTabScope;

  // Worker assignment
  workerId?: string;

  // Display
  rootUserInput?: string;
  summary?: string;
  tabIds: number[];
  scrollPosition?: number;
};

export type PersistedTaskTabScope = {
  boundaryId: string;
  seedTabId: number;
  touchedTabIds: number[];
  updatedAt: number;
};

export type PersistedPendingRun = {
  id: string;
  text: string;
  startedAt: number;
  attempts: number;
  autoResume: boolean;
  taskBoundaryId?: string;
  resumeRequired?: boolean;
  resumeReason?: 'cross_host_navigation' | 'page_reload' | 'handoff' | 'agent_navigation';
};

export type RoverRuntimeEventType =
  | 'run_started'
  | 'run_state_transition'
  | 'run_completed'
  | 'same_tab_navigation_handoff'
  | 'resume_started'
  | 'resume_completed'
  | 'terminal_marked';

export type RoverRuntimeEventEnvelope<TPayload = Record<string, unknown>> = {
  sessionId: string;
  taskBoundaryId: string;
  runId: string;
  seq: number;
  epoch: number;
  ts: number;
  type: RoverRuntimeEventType;
  payload: TPayload;
};

export type SameTabNavigationHandoffPayload = {
  runId: string;
  logicalTabId?: number;
  url?: string;
  reason?: string;
  navigationOutcome?: 'same_tab_scheduled';
};

export type ResumeLifecyclePayload = {
  runId: string;
  resumeRequired: boolean;
  resumeReason?: PersistedPendingRun['resumeReason'];
};

export type PersistedNavigationHandoff = {
  handoffId: string;
  sourceLogicalTabId?: number;
  runId?: string;
  targetUrl: string;
  createdAt: number;
  consumed?: boolean;
};

// ── v2 PersistedRuntimeState ─────────────────────────────────────────

export type PersistedRuntimeState = {
  version: number; // 1 = legacy, 2 = multi-task
  sessionId: string;
  runtimeId: string;
  uiOpen: boolean;
  uiHidden: boolean;
  executionMode?: RoverExecutionMode;

  // Multi-task (v2) — replaces singular activeTask, pendingRun, workerState, etc.
  tasks: Record<string, TaskRecord>;
  activeTaskId?: string;
  taskOrder: string[];
  taskEpoch?: number;

  // Legacy v1 fields — kept for backward compat during migration
  uiStatus?: string;
  uiMessages: PersistedUiMessage[];
  timeline: PersistedTimelineEvent[];
  workerState?: PersistedWorkerState;
  pendingRun?: PersistedPendingRun;
  activeTask?: PersistedTaskState;
  taskTabScope?: PersistedTaskTabScope;

  // Global state (not per-task)
  lastNavigationHandoff?: PersistedNavigationHandoff;
  lastRoutingDecision?: {
    mode: 'act' | 'planner';
    score?: number;
    reason?: string;
    ts: number;
  };
  visitor?: { name?: string; email?: string };
  updatedAt: number;
};
