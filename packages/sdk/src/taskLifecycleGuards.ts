import { normalizeTaskBoundaryId } from './taskBoundaryGuards.js';

export type TaskStatus = 'running' | 'completed' | 'ended';

export function shouldStartFreshTask(taskStatus?: TaskStatus): boolean {
  return taskStatus === 'completed' || taskStatus === 'ended';
}

export function canAutoResumePendingRun(taskStatus?: TaskStatus): boolean {
  return taskStatus === 'running';
}

export function shouldAdoptSnapshotActiveRun(params: {
  taskStatus?: TaskStatus;
  hasPendingRun: boolean;
  activeRunId?: string;
  activeRunText?: string;
  ignoredRunIds?: Set<string>;
}): boolean {
  if (params.taskStatus !== 'running') return false;
  if (!params.activeRunId || !params.activeRunText) return false;
  if (params.hasPendingRun) return false;
  if (params.ignoredRunIds?.has(params.activeRunId)) return false;
  return true;
}

export function shouldClearPendingFromSharedState(params: {
  localTaskStatus?: TaskStatus;
  remoteTaskStatus?: TaskStatus;
  mode: 'controller' | 'observer';
  hasRemoteActiveRun: boolean;
}): boolean {
  if (params.localTaskStatus !== 'running') return true;
  if (params.remoteTaskStatus && params.remoteTaskStatus !== 'running') return true;
  if (params.mode === 'observer' && !params.hasRemoteActiveRun) return true;
  return false;
}

export function shouldIgnoreRunScopedMessage(params: {
  type: string;
  messageRunId?: string;
  messageTaskBoundaryId?: string;
  currentTaskBoundaryId?: string;
  pendingRunId?: string;
  sharedActiveRunId?: string;
  authoritativeActiveRunId?: string;
  taskStatus?: TaskStatus;
  ignoredRunIds?: Set<string>;
}): boolean {
  const {
    type,
    messageRunId,
    messageTaskBoundaryId,
    currentTaskBoundaryId,
    pendingRunId,
    sharedActiveRunId,
    authoritativeActiveRunId,
    taskStatus,
    ignoredRunIds,
  } = params;
  const currentBoundary = normalizeTaskBoundaryId(currentTaskBoundaryId);
  const messageBoundary = normalizeTaskBoundaryId(messageTaskBoundaryId);
  if ((type === 'run_started' || type === 'run_resumed' || type === 'run_state_transition' || type === 'run_completed') && currentBoundary) {
    if (!messageBoundary || messageBoundary !== currentBoundary) return true;
  }
  if (!messageRunId && type !== 'run_started' && type !== 'run_resumed') return false;
  if (messageRunId && ignoredRunIds?.has(messageRunId)) return true;

  const authoritativeRunId = authoritativeActiveRunId || sharedActiveRunId;

  if (type === 'run_started' || type === 'run_resumed') {
    if (!messageRunId) return false;
    if (authoritativeRunId && authoritativeRunId === messageRunId) return false;
    if (!pendingRunId) return true;
    return pendingRunId !== messageRunId && (!authoritativeRunId || authoritativeRunId !== messageRunId);
  }

  if (!messageRunId) return false;

  if (type === 'run_completed' || type === 'run_state_transition') {
    if (taskStatus !== 'running') return true;
    if (!pendingRunId) {
      if (authoritativeRunId && authoritativeRunId === messageRunId) return false;
      return true;
    }
    return pendingRunId !== messageRunId && (!authoritativeRunId || authoritativeRunId !== messageRunId);
  }

  if (!pendingRunId) return true;
  return pendingRunId !== messageRunId;
}
