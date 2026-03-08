import type { TaskRecord } from './runtimeTypes.js';

function normalizeId(value?: string): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

export function shouldPreserveWidgetOpenOnResume(
  openIntent?: 'preserve_if_running',
): boolean {
  return openIntent === 'preserve_if_running';
}

export function findMatchingTaskRecord(
  records: Iterable<TaskRecord>,
  identity: { taskId?: string; boundaryId?: string; runId?: string },
): TaskRecord | undefined {
  const boundaryId = normalizeId(identity.boundaryId);
  const runId = normalizeId(identity.runId);
  const taskId = normalizeId(identity.taskId);
  const list = Array.from(records);

  if (boundaryId) {
    const exactBoundary = list.find(task => normalizeId(task.boundaryId) === boundaryId);
    if (exactBoundary) return exactBoundary;
  }

  if (runId) {
    const exactRun = list.find(task => normalizeId(task.pendingRun?.id) === runId);
    if (exactRun) return exactRun;
  }

  if (taskId) {
    const exactTask = list.find(task => normalizeId(task.taskId) === taskId);
    if (exactTask) return exactTask;
  }

  return undefined;
}

export function resolveRenderableStatusRunId(params: {
  localPendingRunId?: string;
  sharedActiveRunId?: string;
  sharedTaskId?: string;
  activeTaskId?: string;
}): string | undefined {
  const localPendingRunId = normalizeId(params.localPendingRunId);
  if (localPendingRunId) return localPendingRunId;

  const sharedActiveRunId = normalizeId(params.sharedActiveRunId);
  if (!sharedActiveRunId) return undefined;

  const sharedTaskId = normalizeId(params.sharedTaskId);
  const activeTaskId = normalizeId(params.activeTaskId);
  if (sharedTaskId && activeTaskId && sharedTaskId !== activeTaskId) {
    return undefined;
  }

  return sharedActiveRunId;
}
