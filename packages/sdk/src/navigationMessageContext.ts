export function resolveNavigationMessageContext(params: {
  pendingRunText?: string;
  activeRunText?: string;
  rootWorkerInput?: string;
  lastUserInputText?: string;
  fallback?: string;
}): string {
  const pendingText = String(params.pendingRunText || '').trim();
  if (pendingText) return pendingText;

  const activeRunText = String(params.activeRunText || '').trim();
  if (activeRunText) return activeRunText;

  const rootWorkerInput = String(params.rootWorkerInput || '').trim();
  if (rootWorkerInput) return rootWorkerInput;

  const lastInput = String(params.lastUserInputText || '').trim();
  if (lastInput) return lastInput;

  return String(params.fallback || 'navigation request').trim() || 'navigation request';
}
