export type NavigationDecision = 'allow_same_tab' | 'open_new_tab' | 'block' | 'stale_run';

export function resolveNavigationDecision(params: {
  crossRegistrableDomain: boolean;
  fallbackDecision: 'allow_same_tab' | 'open_new_tab' | 'block';
  serverDecision?: NavigationDecision;
  serverAvailable: boolean;
}): {
  decision: 'allow_same_tab' | 'open_new_tab' | 'block';
  decisionReason: string;
  failSafeBlocked: boolean;
} {
  if (params.crossRegistrableDomain && !params.serverAvailable) {
    return {
      decision: params.fallbackDecision,
      decisionReason: 'preflight_unavailable_fallback',
      failSafeBlocked: false,
    };
  }

  const resolved =
    params.serverDecision === 'stale_run'
      ? params.fallbackDecision
      : (params.serverDecision || params.fallbackDecision);

  return {
    decision: resolved,
    decisionReason: resolved,
    failSafeBlocked: false,
  };
}
