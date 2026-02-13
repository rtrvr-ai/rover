import type { RoverExecutionMode, RoverTimelineEvent } from '@rover/ui';

export type UiRole = 'user' | 'assistant' | 'system';

export type PersistedUiMessage = {
  id: string;
  role: UiRole;
  text: string;
  ts: number;
  sourceRuntimeId?: string;
};

export type PersistedTimelineEvent = {
  id: string;
  kind: RoverTimelineEvent['kind'];
  title: string;
  detail?: string;
  status?: RoverTimelineEvent['status'];
  ts: number;
  sourceRuntimeId?: string;
};

export type PersistedWorkerHistoryMessage = {
  role: string;
  content: string;
};

export type PersistedWorkerState = {
  trajectoryId?: string;
  history?: PersistedWorkerHistoryMessage[];
  plannerHistory?: unknown[];
  agentPrevSteps?: unknown[];
  lastToolPreviousSteps?: unknown[];
  updatedAt?: number;
};

export type PersistedTaskState = {
  taskId: string;
  status: 'running' | 'completed' | 'ended';
  startedAt: number;
  lastUserAt?: number;
  lastAssistantAt?: number;
  boundaryReason?: string;
  endedAt?: number;
};

export type PersistedPendingRun = {
  id: string;
  text: string;
  startedAt: number;
  attempts: number;
  autoResume: boolean;
};

export type PersistedRuntimeState = {
  version: number;
  sessionId: string;
  runtimeId: string;
  uiOpen: boolean;
  uiHidden: boolean;
  uiStatus?: string;
  uiMessages: PersistedUiMessage[];
  timeline: PersistedTimelineEvent[];
  executionMode?: RoverExecutionMode;
  workerState?: PersistedWorkerState;
  pendingRun?: PersistedPendingRun;
  taskEpoch?: number;
  activeTask?: PersistedTaskState;
  lastRoutingDecision?: {
    mode: 'act' | 'planner';
    score?: number;
    reason?: string;
    ts: number;
  };
  updatedAt: number;
};
