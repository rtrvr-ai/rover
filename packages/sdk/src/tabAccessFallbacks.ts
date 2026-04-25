export type RoverAvailability = 'available' | 'not_available' | 'unknown';

export function buildInaccessibleTabPageData(
  tab?: { logicalTabId?: number; url?: string; title?: string; external?: boolean; roverAvailability?: RoverAvailability },
  reason = 'tab_not_accessible',
): Record<string, any> {
  const logicalTabId = Number(tab?.logicalTabId) || undefined;
  const url = tab?.url || '';
  const title = tab?.title || (tab?.external ? 'External Tab (Inaccessible)' : 'Detached Runtime Tab (Unavailable)');
  const normalizedReason = String(reason || '').trim();
  const reasonLine = normalizedReason ? ` Reason: ${normalizedReason}.` : '';
  const content = tab?.external
    ? `This external tab is tracked in virtual mode only. Live DOM control and accessibility-tree access are unavailable here.${reasonLine}`
    : `This tab is a detached runtime placeholder and is not attached to an active Rover runtime. Switch to an attached tab or reopen the page.${reasonLine}`;

  return {
    url,
    title,
    contentType: 'text/html',
    content,
    metadata: {
      inaccessible: true,
      external: !!tab?.external,
      accessMode: tab?.external ? 'external_placeholder' : 'detached_runtime_placeholder',
      roverAvailability: tab?.roverAvailability || 'unknown',
      reason,
      logicalTabId,
    },
  };
}

export function buildTabAccessToolError(
  _cfg: Record<string, unknown>,
  tab?: { logicalTabId?: number; url?: string; external?: boolean },
  reason = 'tab_not_accessible',
): Record<string, any> {
  const logicalTabId = Number(tab?.logicalTabId) || 0;
  const blockedUrl = tab?.url || '';
  const message = tab?.external
    ? `Tab ${logicalTabId} is external to the active runtime and cannot be controlled directly.`
    : `Tab ${logicalTabId} is not attached to an active Rover runtime.`;
  const code = tab?.external ? 'DOMAIN_SCOPE_BLOCKED' : 'TAB_NOT_ACCESSIBLE';

  return {
    success: false,
    error: message,
    allowFallback: true,
    output: {
      success: false,
      error: {
        code,
        message,
        missing: [],
        next_action: tab?.external
          ? 'External pages open in a new tab with notice. Switch to that tab or continue on an allowed Rover tab.'
          : 'Switch to an active tab and retry.',
        retryable: false,
      },
      blocked_url: blockedUrl || undefined,
      logical_tab_id: logicalTabId || undefined,
      external: !!tab?.external,
      policy_action: tab?.external ? 'open_new_tab_notice' : undefined,
      reason,
    },
    errorDetails: {
      code,
      message,
      retryable: false,
      details: {
        logicalTabId,
        blockedUrl,
        external: !!tab?.external,
        reason,
      },
    },
  };
}
