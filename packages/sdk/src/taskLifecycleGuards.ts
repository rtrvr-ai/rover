import { normalizeTaskBoundaryId } from './taskBoundaryGuards.js';
import type { TaskState } from './runtimeTypes.js';
import { isTerminalState } from './taskStateMachine.js';

/** Legacy compat alias — maps to TaskState values used for guard logic. */
export type TaskStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'ended';

export function shouldStartFreshTask(taskStatus?: TaskStatus | TaskState): boolean {
  if (!taskStatus) return true;
  // Terminal states require a fresh task
  if (taskStatus === 'completed' || taskStatus === 'cancelled' || taskStatus === 'failed' || taskStatus === 'ended') {
    return true;
  }
  // New FSM terminal state check
  if (isTerminalState(taskStatus as TaskState)) return true;
  return false;
}

export function canAutoResumePendingRun(taskStatus?: TaskStatus | TaskState): boolean {
  return taskStatus === 'running';
}

export function resolveAutoResumePolicyAction(params: {
  policy: 'auto' | 'confirm' | 'never';
  resumeRequired: boolean;
  hasLiveRemoteController: boolean;
}): 'auto_resume' | 'prompt_resume' | 'cancel_resume' | 'defer_remote_owner' | 'noop' {
  if (!params.resumeRequired) return 'noop';
  if (params.hasLiveRemoteController) return 'defer_remote_owner';
  if (params.policy === 'never') return 'cancel_resume';
  if (params.policy === 'confirm') return 'prompt_resume';
  return 'auto_resume';
}

export function shouldAdoptProjectionRun(params: {
  serverRunId?: string;
  localPendingRunId?: string;
  ignoredRunIds?: Set<string>;
}): boolean {
  const serverRunId = String(params.serverRunId || '').trim();
  if (!serverRunId) return false;
  if (params.ignoredRunIds?.has(serverRunId)) return false;
  const localPendingRunId = String(params.localPendingRunId || '').trim();
  return !localPendingRunId || localPendingRunId !== serverRunId;
}

export function shouldQueueCancelForIgnoredProjectionRun(params: {
  serverRunId?: string;
  runStatus?: string;
  ignoredRunIds?: Set<string>;
}): boolean {
  const serverRunId = String(params.serverRunId || '').trim();
  if (!serverRunId) return false;
  if (!params.ignoredRunIds?.has(serverRunId)) return false;
  const status = String(params.runStatus || '').trim().toLowerCase();
  const terminal = status === 'completed' || status === 'cancelled' || status === 'failed' || status === 'ended';
  return !terminal;
}

export function shouldAdoptSnapshotActiveRun(params: {
  taskStatus?: TaskStatus | TaskState;
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
  localTaskStatus?: TaskStatus | TaskState;
  remoteTaskStatus?: TaskStatus | TaskState;
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
  taskStatus?: TaskStatus | TaskState;
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
  const isCompletionEvent = type === 'run_state_transition' || type === 'run_completed';
  const canRelaxBoundaryForPendingCompletion =
    isCompletionEvent
    && !!messageRunId
    && !!pendingRunId
    && messageRunId === pendingRunId
    && taskStatus === 'running';
  if ((type === 'run_started' || type === 'run_resumed' || isCompletionEvent) && currentBoundary) {
    if ((!messageBoundary || messageBoundary !== currentBoundary) && !canRelaxBoundaryForPendingCompletion) return true;
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
