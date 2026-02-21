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
  const pendingQuestionCount = Math.max(0, Number(params.pendingAskUserQuestionCount) || 0);
  if (pendingQuestionCount <= 0) return false;

  const pendingBoundaryId = normalizeTaskBoundaryId(params.pendingAskUserBoundaryId);
  const currentBoundaryId = normalizeTaskBoundaryId(params.currentTaskBoundaryId);
  if (pendingBoundaryId && currentBoundaryId && pendingBoundaryId !== currentBoundaryId) {
    return false;
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
