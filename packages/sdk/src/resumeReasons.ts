import type { PersistedPendingRun } from './runtimeTypes.js';

export function normalizePendingRunResumeReason(
  reason: unknown,
): PersistedPendingRun['resumeReason'] | undefined {
  return reason === 'cross_host_navigation'
    || reason === 'agent_navigation'
    || reason === 'handoff'
    || reason === 'page_reload'
    || reason === 'worker_interrupted'
      ? reason
      : undefined;
}

export function isNavigationResumeReason(
  reason: PersistedPendingRun['resumeReason'] | undefined,
): boolean {
  return normalizePendingRunResumeReason(reason) !== undefined;
}
