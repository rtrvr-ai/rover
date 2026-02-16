import type { RoverTab } from './types.js';

export type RuntimeTabSnapshot = {
  id: number;
  runtimeId?: string;
  url?: string;
  title?: string;
  external?: boolean;
  accessMode?: 'live_dom' | 'external_placeholder' | 'external_scraped';
  inaccessibleReason?: string;
  updatedAt?: number;
};

type ResolveRuntimeTabsOptions = {
  maxContextTabs?: number;
  detachedExternalTabMaxAgeMs?: number;
  staleRuntimeTabMaxAgeMs?: number;
};

const DEFAULT_MAX_CONTEXT_TABS = 8;
const DEFAULT_DETACHED_EXTERNAL_TAB_MAX_AGE_MS = 90_000;
const DEFAULT_STALE_RUNTIME_TAB_MAX_AGE_MS = 45_000;

function dedupePositiveTabIds(input: unknown[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of input) {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0 || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function normalizeAccessMode(value: unknown, external: boolean): RuntimeTabSnapshot['accessMode'] {
  if (value === 'external_scraped' || value === 'external_placeholder' || value === 'live_dom') return value;
  return external ? 'external_placeholder' : 'live_dom';
}

function normalizeFallbackTabs(input: RoverTab[]): RuntimeTabSnapshot[] {
  return input
    .map(tab => ({
      id: Number(tab?.id),
      url: typeof tab?.url === 'string' ? tab.url : undefined,
      title: typeof tab?.title === 'string' ? tab.title : undefined,
      external: !!tab?.external,
      accessMode: normalizeAccessMode(tab?.accessMode, !!tab?.external),
      inaccessibleReason: typeof tab?.inaccessibleReason === 'string' ? tab.inaccessibleReason : undefined,
    }))
    .filter(tab => Number.isFinite(tab.id) && tab.id > 0);
}

function normalizeListedTabs(input: unknown[]): RuntimeTabSnapshot[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((tab: any) => {
      const id = Number(tab?.logicalTabId || tab?.id);
      if (!Number.isFinite(id) || id <= 0) return undefined;
      const external = !!tab?.external;
      return {
        id,
        runtimeId: typeof tab?.runtimeId === 'string' ? tab.runtimeId : undefined,
        url: typeof tab?.url === 'string' ? tab.url : undefined,
        title: typeof tab?.title === 'string' ? tab.title : undefined,
        external,
        accessMode: normalizeAccessMode(tab?.accessMode, external),
        inaccessibleReason: typeof tab?.inaccessibleReason === 'string' ? tab.inaccessibleReason : undefined,
        updatedAt: Number(tab?.updatedAt) || 0,
      } as RuntimeTabSnapshot;
    })
    .filter((tab): tab is RuntimeTabSnapshot => !!tab);
}

export async function resolveRuntimeTabs(
  bridgeRpc: ((method: string, params?: any) => Promise<any>) | undefined,
  fallbackTabs: RoverTab[],
  options?: ResolveRuntimeTabsOptions,
): Promise<{
  tabOrder: number[];
  activeTabId: number;
  tabMetaById: Record<number, RuntimeTabSnapshot>;
}> {
  const maxContextTabs = Math.max(1, Number(options?.maxContextTabs) || DEFAULT_MAX_CONTEXT_TABS);
  const detachedExternalTabMaxAgeMs =
    Math.max(5_000, Number(options?.detachedExternalTabMaxAgeMs) || DEFAULT_DETACHED_EXTERNAL_TAB_MAX_AGE_MS);
  const staleRuntimeTabMaxAgeMs =
    Math.max(10_000, Number(options?.staleRuntimeTabMaxAgeMs) || DEFAULT_STALE_RUNTIME_TAB_MAX_AGE_MS);

  const fallbackSnapshots = normalizeFallbackTabs(fallbackTabs);
  const fallbackTabIds = dedupePositiveTabIds(fallbackSnapshots.map(tab => tab.id));
  let tabIds = [...fallbackTabIds];
  let listedTabs: RuntimeTabSnapshot[] = [];

  if (bridgeRpc) {
    try {
      listedTabs = normalizeListedTabs(await bridgeRpc('listSessionTabs'));
      const listedIds = dedupePositiveTabIds(listedTabs.map(tab => tab.id));
      if (listedIds.length > 0) {
        tabIds = listedIds;
      }
    } catch {
      // keep fallback tab ids
    }
  }

  let activeTabId = tabIds[0] || fallbackTabIds[0] || 1;
  if (bridgeRpc) {
    try {
      const context = await bridgeRpc('getTabContext');
      const candidate = Number(context?.activeLogicalTabId || context?.logicalTabId || context?.id);
      if (Number.isFinite(candidate) && candidate > 0) {
        activeTabId = candidate;
      }
    } catch {
      // keep current active tab id
    }
  }

  if (!tabIds.length) {
    tabIds = [activeTabId];
  } else if (!tabIds.includes(activeTabId)) {
    tabIds = [activeTabId, ...tabIds];
  }

  const nowMs = Date.now();
  const listedById = new Map<number, RuntimeTabSnapshot>();
  for (const tab of listedTabs) listedById.set(tab.id, tab);

  const prioritized = tabIds.filter(tabId => {
    if (tabId === activeTabId) return true;
    const listed = listedById.get(tabId);
    if (!listed) return false;
    if (listed.runtimeId) {
      return nowMs - (listed.updatedAt || 0) <= staleRuntimeTabMaxAgeMs;
    }
    if (listed.external) {
      return nowMs - (listed.updatedAt || 0) <= detachedExternalTabMaxAgeMs;
    }
    return nowMs - (listed.updatedAt || 0) <= staleRuntimeTabMaxAgeMs;
  });

  const scoreTab = (tabId: number): number => {
    const listed = listedById.get(tabId);
    if (!listed) return tabId === activeTabId ? 1 : 0;
    if (listed.runtimeId && tabId === activeTabId) return 6;
    if (listed.runtimeId) return 5;
    if (tabId === activeTabId) return 4;
    if (listed.external) return 2;
    return 1;
  };

  const prioritizedSorted = [...new Set(prioritized)].sort((a, b) => {
    const scoreDelta = scoreTab(b) - scoreTab(a);
    if (scoreDelta !== 0) return scoreDelta;
    const aUpdated = Number(listedById.get(a)?.updatedAt || 0);
    const bUpdated = Number(listedById.get(b)?.updatedAt || 0);
    return bUpdated - aUpdated;
  });

  let tabOrder = (prioritizedSorted.length ? prioritizedSorted : tabIds).slice(0, maxContextTabs);
  if (!tabOrder.includes(activeTabId)) {
    tabOrder = [activeTabId, ...tabOrder].slice(0, maxContextTabs);
  }
  if (!tabOrder.length) {
    tabOrder = [activeTabId || 1];
  }

  const tabMetaById: Record<number, RuntimeTabSnapshot> = {};
  for (const tab of fallbackSnapshots) tabMetaById[tab.id] = tab;
  for (const tab of listedTabs) tabMetaById[tab.id] = { ...(tabMetaById[tab.id] || {}), ...tab };
  for (const tabId of tabOrder) {
    if (!tabMetaById[tabId]) tabMetaById[tabId] = { id: tabId };
  }

  return { tabOrder, activeTabId, tabMetaById };
}
