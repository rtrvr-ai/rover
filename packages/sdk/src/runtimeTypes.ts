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
};

export type PersistedWorkerState = {
  trajectoryId?: string;
  history?: PersistedWorkerHistoryMessage[];
  plannerHistory?: unknown[];
  agentPrevSteps?: unknown[];
  lastToolPreviousSteps?: unknown[];
  pendingAskUser?: PersistedPendingAskUser;
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
  resumeRequired?: boolean;
  resumeReason?: 'cross_host_navigation' | 'page_reload' | 'handoff' | 'agent_navigation';
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
  visitor?: { name?: string; email?: string };
  updatedAt: number;
};
