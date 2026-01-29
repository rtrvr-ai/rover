import type { PersistedTaskState } from './runtimeTypes.js';
import { normalizeTaskBoundaryId } from './taskBoundaryGuards.js';

export function shouldContinueTaskForPrompt(params: {
  startNewTask?: boolean;
  taskStatus?: PersistedTaskState['status'];
  pendingAskUserQuestionCount?: number;
  hasAskUserAnswers?: boolean;
  pendingAskUserBoundaryId?: string;
  currentTaskBoundaryId?: string;
}): boolean {
  if (params.startNewTask) return false;
  if (!params.hasAskUserAnswers) return false;
  if (params.taskStatus !== 'running') return false;

  const pendingBoundaryId = normalizeTaskBoundaryId(params.pendingAskUserBoundaryId);
  const currentBoundaryId = normalizeTaskBoundaryId(params.currentTaskBoundaryId);
  if (pendingBoundaryId && currentBoundaryId && pendingBoundaryId !== currentBoundaryId) {
    return false;
  }

  const pendingQuestionCount = Math.max(0, Number(params.pendingAskUserQuestionCount) || 0);
  if (pendingQuestionCount <= 0) {
    // Structured ask_user answers can arrive after a restore/handoff before the
    // question prompt worker snapshot catches up. Keep them on the same task
    // unless we have an explicit boundary mismatch.
    return true;
  }

  return true;
}

export function shouldStartFreshTaskForPrompt(params: {
  startNewTask?: boolean;
  taskStatus?: PersistedTaskState['status'];
  pendingAskUserQuestionCount?: number;
  hasAskUserAnswers?: boolean;
  pendingAskUserBoundaryId?: string;
  currentTaskBoundaryId?: string;
}): boolean {
  return !shouldContinueTaskForPrompt(params);
}
