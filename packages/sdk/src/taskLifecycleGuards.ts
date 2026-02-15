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
  pendingRunId?: string;
  sharedActiveRunId?: string;
  taskStatus?: TaskStatus;
  ignoredRunIds?: Set<string>;
}): boolean {
  const { type, messageRunId, pendingRunId, sharedActiveRunId, taskStatus, ignoredRunIds } = params;
  if (!messageRunId && type !== 'run_started') return false;
  if (messageRunId && ignoredRunIds?.has(messageRunId)) return true;

  if (type === 'run_started') {
    if (!messageRunId) return false;
    if (!pendingRunId) return true;
    return pendingRunId !== messageRunId;
  }

  if (!messageRunId) return false;

  if (type === 'run_completed') {
    if (taskStatus !== 'running') return true;
    if (!pendingRunId) {
      if (sharedActiveRunId && sharedActiveRunId === messageRunId) return false;
      return true;
    }
    return pendingRunId !== messageRunId;
  }

  if (!pendingRunId) return true;
  return pendingRunId !== messageRunId;
}

