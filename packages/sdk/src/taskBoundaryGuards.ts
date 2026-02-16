import type { TaskStatus } from './taskLifecycleGuards.js';

export type WorkerBoundarySource =
  | 'worker_snapshot'
  | 'shared_worker_context'
  | 'controller_handoff'
  | 'indexeddb_checkpoint'
  | 'cloud_checkpoint'
  | 'ready_hydrate';

export type WorkerBoundaryDecision = {
  accept: boolean;
  adoptedBoundaryId?: string;
  reason: 'match' | 'bootstrap_adopt' | 'epoch_adopt' | 'missing_incoming' | 'mismatch';
};

export function normalizeTaskBoundaryId(input?: string): string | undefined {
  const normalized = String(input || '').trim();
  return normalized || undefined;
}

export function isMatchingBoundary(incomingBoundaryId?: string, currentBoundaryId?: string): boolean {
  const incoming = normalizeTaskBoundaryId(incomingBoundaryId);
  const current = normalizeTaskBoundaryId(currentBoundaryId);
  if (!incoming || !current) return false;
  return incoming === current;
}

export function shouldAdoptIncomingBoundary(params: {
  source: WorkerBoundarySource;
  incomingBoundaryId?: string;
  currentBoundaryId?: string;
  taskEpochAdvanced?: boolean;
  hasPendingRun?: boolean;
  taskStatus?: TaskStatus;
  allowBootstrapAdoption?: boolean;
}): boolean {
  const incoming = normalizeTaskBoundaryId(params.incomingBoundaryId);
  const current = normalizeTaskBoundaryId(params.currentBoundaryId);
  if (!incoming) return false;
  if (incoming === current) return false;
  if (!current) return params.allowBootstrapAdoption !== false;
  if (params.taskEpochAdvanced === true && params.hasPendingRun !== true) {
    return true;
  }
  return false;
}

export function shouldAcceptWorkerSnapshot(params: {
  source: WorkerBoundarySource;
  incomingBoundaryId?: string;
  currentBoundaryId?: string;
  taskEpochAdvanced?: boolean;
  hasPendingRun?: boolean;
  taskStatus?: TaskStatus;
  allowBootstrapAdoption?: boolean;
}): WorkerBoundaryDecision {
  const incoming = normalizeTaskBoundaryId(params.incomingBoundaryId);
  const current = normalizeTaskBoundaryId(params.currentBoundaryId);

  if (incoming && current && incoming === current) {
    return { accept: true, reason: 'match' };
  }

  if (!incoming) {
    if (!current && params.allowBootstrapAdoption !== false) {
      return { accept: true, reason: 'bootstrap_adopt' };
    }
    return { accept: false, reason: 'missing_incoming' };
  }

  if (shouldAdoptIncomingBoundary(params)) {
    return {
      accept: true,
      adoptedBoundaryId: incoming,
      reason: current ? 'epoch_adopt' : 'bootstrap_adopt',
    };
  }

  return { accept: false, reason: 'mismatch' };
}
