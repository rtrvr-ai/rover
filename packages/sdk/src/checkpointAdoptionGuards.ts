export type CheckpointContinuityState = {
  pendingRun?: {
    id?: string;
    resumeRequired?: boolean;
    taskBoundaryId?: string;
  };
  activeTask?: {
    status?: string;
  };
  workerState?: {
    rootUserInput?: string;
    history?: unknown[];
    plannerHistory?: unknown[];
    agentPrevSteps?: unknown[];
    pendingAskUser?: {
      questions?: unknown[];
    };
    taskBoundaryId?: string;
  };
  taskTabScope?: {
    touchedTabIds?: unknown[];
  };
  taskEpoch?: number;
};

export type CheckpointContinuitySummary = {
  localRunId?: string;
  incomingRunId?: string;
  exactRunMatch: boolean;
  localBoundaryId?: string;
  incomingBoundaryId?: string;
  exactBoundaryMatch: boolean;
  localScore: number;
  incomingScore: number;
};

function toArrayLength(input: unknown): number {
  return Array.isArray(input) ? input.length : 0;
}

function normalizeBoundaryId(input?: string): string | undefined {
  const normalized = String(input || '').trim();
  return normalized || undefined;
}

function normalizeRunId(input?: string): string | undefined {
  const normalized = String(input || '').trim();
  return normalized || undefined;
}

export function computeCheckpointContinuityScore(state: CheckpointContinuityState | null | undefined): number {
  if (!state) return 0;
  let score = 0;

  const pendingId = String(state.pendingRun?.id || '').trim();
  if (pendingId) {
    score += 4;
    if (state.pendingRun?.resumeRequired) score += 1;
    if (normalizeBoundaryId(state.pendingRun?.taskBoundaryId)) score += 1;
  }

  if (state.activeTask?.status === 'running') {
    score += 2;
  }

  const workerState = state.workerState;
  if (workerState) {
    score += 1;
    if (String(workerState.rootUserInput || '').trim()) score += 1;
    score += Math.min(3, toArrayLength(workerState.history));
    score += Math.min(3, toArrayLength(workerState.plannerHistory));
    score += Math.min(4, toArrayLength(workerState.agentPrevSteps));
    if (toArrayLength(workerState.pendingAskUser?.questions) > 0) score += 3;
  }

  if (toArrayLength(state.taskTabScope?.touchedTabIds) > 0) {
    score += 1;
  }

  return score;
}

export function describeCheckpointContinuity(params: {
  localState: CheckpointContinuityState;
  incomingState: CheckpointContinuityState;
}): CheckpointContinuitySummary {
  const localRunId = normalizeRunId(params.localState.pendingRun?.id);
  const incomingRunId = normalizeRunId(params.incomingState.pendingRun?.id);
  const localBoundaryId = normalizeBoundaryId(
    params.localState.pendingRun?.taskBoundaryId || params.localState.workerState?.taskBoundaryId,
  );
  const incomingBoundaryId = normalizeBoundaryId(
    params.incomingState.pendingRun?.taskBoundaryId || params.incomingState.workerState?.taskBoundaryId,
  );

  return {
    localRunId,
    incomingRunId,
    exactRunMatch: !!(localRunId && incomingRunId && localRunId === incomingRunId),
    localBoundaryId,
    incomingBoundaryId,
    exactBoundaryMatch: !!(localBoundaryId && incomingBoundaryId && localBoundaryId === incomingBoundaryId),
    localScore: computeCheckpointContinuityScore(params.localState),
    incomingScore: computeCheckpointContinuityScore(params.incomingState),
  };
}

export function shouldAdoptCheckpointState(params: {
  localUpdatedAt: number;
  incomingUpdatedAt: number;
  localState: CheckpointContinuityState;
  incomingState: CheckpointContinuityState;
  crossDomainResumeActive: boolean;
  clockSkewMs?: number;
}): boolean {
  const skew = Math.max(0, Number(params.clockSkewMs) || 200);
  if (params.incomingUpdatedAt > params.localUpdatedAt + skew) {
    return true;
  }

  if (!params.crossDomainResumeActive) {
    return false;
  }

  const summary = describeCheckpointContinuity({
    localState: params.localState,
    incomingState: params.incomingState,
  });

  if (summary.incomingScore <= summary.localScore) {
    return false;
  }

  if (
    summary.localBoundaryId
    && summary.incomingBoundaryId
    && summary.localBoundaryId !== summary.incomingBoundaryId
  ) {
    const localEpoch = Math.max(1, Number(params.localState.taskEpoch) || 1);
    const incomingEpoch = Math.max(1, Number(params.incomingState.taskEpoch) || 1);
    if (incomingEpoch < localEpoch) {
      return false;
    }
  }

  if (summary.exactRunMatch || summary.exactBoundaryMatch) {
    return true;
  }

  const localHasIdentity = !!(summary.localRunId || summary.localBoundaryId);
  if (!localHasIdentity) {
    return true;
  }

  return false;
}
