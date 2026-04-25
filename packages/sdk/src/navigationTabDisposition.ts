import { isHostInNavigationScope } from './navigationScope.js';

export type NavigationTabDispositionDecision = 'allow_same_tab' | 'open_new_tab' | 'block';

export type NavigationTabDispositionInput = {
  targetUrl?: string;
  currentUrl?: string;
  currentHost?: string;
  allowedDomains?: string[];
  domainScopeMode?: 'host_only' | 'registrable_domain';
  preferredDisposition?: 'auto' | 'same_tab' | 'new_tab';
  knownTabs?: Array<{ logicalTabId: number; url?: string; external?: boolean }>;
  taskScopedTabIds?: number[];
  sourceLogicalTabId?: number;
};

function normalizeHost(input?: string): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function normalizeComparableUrl(input?: string): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function hasReusableKnownTargetTab(input: NavigationTabDispositionInput): boolean {
  const targetUrl = normalizeComparableUrl(input.targetUrl);
  const targetHost = normalizeHost(input.targetUrl);
  if (!targetHost) return false;
  const sourceLogicalTabId = Number(input.sourceLogicalTabId);

  return (input.knownTabs || []).some((tab) => {
    if (!Number.isFinite(Number(tab.logicalTabId)) || Number(tab.logicalTabId) <= 0) return false;
    if (Number.isFinite(sourceLogicalTabId) && Number(tab.logicalTabId) === sourceLogicalTabId) return false;
    const tabUrl = normalizeComparableUrl(tab.url);
    if (targetUrl && tabUrl && tabUrl === targetUrl) return true;
    return normalizeHost(tab.url) === targetHost;
  });
}

function shouldPreserveSourceTab(input: NavigationTabDispositionInput): boolean {
  const scopedIds = Array.from(
    new Set((input.taskScopedTabIds || []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)),
  );
  const sourceLogicalTabId = Number(input.sourceLogicalTabId);
  if (scopedIds.length >= 2) return true;
  if (!Number.isFinite(sourceLogicalTabId) || sourceLogicalTabId <= 0) return false;
  return scopedIds.some((logicalTabId) => logicalTabId !== sourceLogicalTabId);
}

export function resolveNavigationTabDisposition(
  input: NavigationTabDispositionInput,
): NavigationTabDispositionDecision {
  const targetHost = normalizeHost(input.targetUrl);
  const currentHost = normalizeHost(input.currentHost || input.currentUrl);

  if (!targetHost) return 'allow_same_tab';

  const targetInScope = isHostInNavigationScope({
    host: targetHost,
    currentHost,
    allowedDomains: input.allowedDomains,
    domainScopeMode: input.domainScopeMode,
  });

  if (!targetInScope) {
    return 'open_new_tab';
  }

  if (currentHost && targetHost === currentHost) {
    return input.preferredDisposition === 'new_tab' ? 'open_new_tab' : 'allow_same_tab';
  }

  if (input.preferredDisposition === 'new_tab') return 'open_new_tab';
  if (hasReusableKnownTargetTab(input)) return 'open_new_tab';
  if (shouldPreserveSourceTab(input)) return 'open_new_tab';
  return 'allow_same_tab';
}
