export type NavigationContinuationInput = {
  navigationPending?: unknown;
  navigationOutcome?: unknown;
  navigationMode?: unknown;
};

export type NavigationContinuationClassification = {
  isNavigationProgress: boolean;
  isSameTabHandoff: boolean;
  continuationReason: 'loop_continue' | 'same_tab_navigation_handoff' | null;
  normalizedOutcome: string;
  normalizedMode: string;
};

const NAVIGATION_PROGRESS_OUTCOMES = new Set([
  'same_tab_scheduled',
  'same_host_navigated',
  'subdomain_navigated',
  'new_tab_opened',
  'switch_tab',
]);

export function classifyNavigationContinuation(
  input: NavigationContinuationInput,
): NavigationContinuationClassification {
  const normalizedOutcome = String(input.navigationOutcome || '').trim().toLowerCase();
  const normalizedMode = String(input.navigationMode || '').trim().toLowerCase();
  const pending = input.navigationPending === true;

  const isSameTabHandoff =
    normalizedOutcome === 'same_tab_scheduled'
    || (
      pending
      && !normalizedOutcome
      && normalizedMode === 'same_tab'
    );

  const isNavigationProgress =
    pending
    || NAVIGATION_PROGRESS_OUTCOMES.has(normalizedOutcome);

  const continuationReason = isNavigationProgress
    ? (isSameTabHandoff ? 'same_tab_navigation_handoff' : 'loop_continue')
    : null;

  return {
    isNavigationProgress,
    isSameTabHandoff,
    continuationReason,
    normalizedOutcome,
    normalizedMode,
  };
}
