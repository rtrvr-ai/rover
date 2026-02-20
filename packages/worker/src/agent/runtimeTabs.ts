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
  scopedTabIds?: number[];
  seedTabId?: number;
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

function preferScopedOrder(
  scopedOrder: number[],
  activeTabId: number,
  maxContextTabs: number,
): number[] {
  const deduped = dedupePositiveTabIds(scopedOrder);
  if (!deduped.length) return [];
  const activeInScope = deduped.includes(activeTabId);
  const resolvedActive = activeInScope ? activeTabId : deduped[0];
  const ordered = [
    resolvedActive,
    ...deduped.filter(tabId => tabId !== resolvedActive),
  ];
  return ordered.slice(0, maxContextTabs);
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
  const scopedTabIds = dedupePositiveTabIds(options?.scopedTabIds || []);

  const fallbackSnapshots = normalizeFallbackTabs(fallbackTabs);
  const fallbackTabIds = dedupePositiveTabIds(
    (scopedTabIds.length > 0
      ? fallbackSnapshots.filter(tab => scopedTabIds.includes(tab.id))
      : fallbackSnapshots)
      .map(tab => tab.id),
  );
  let tabIds = [...fallbackTabIds];
  let listedTabs: RuntimeTabSnapshot[] = [];

  if (bridgeRpc) {
    try {
      listedTabs = normalizeListedTabs(await bridgeRpc('listSessionTabs'));
      if (scopedTabIds.length > 0) {
        listedTabs = listedTabs.filter(tab => scopedTabIds.includes(tab.id));
      }
      const listedIds = dedupePositiveTabIds(listedTabs.map(tab => tab.id));
      if (listedIds.length > 0) {
        tabIds = scopedTabIds.length > 0
          ? scopedTabIds.filter(tabId => listedIds.includes(tabId))
          : listedIds;
      }
    } catch {
      // keep fallback tab ids
    }
  }

  let activeTabId =
    Number(options?.seedTabId) > 0
      ? Number(options?.seedTabId)
      : (tabIds[0] || fallbackTabIds[0] || 1);
  if (bridgeRpc) {
    try {
      const context = await bridgeRpc('getTabContext');
      const candidate = Number(context?.activeLogicalTabId || context?.logicalTabId || context?.id);
      if (
        Number.isFinite(candidate)
        && candidate > 0
        && (scopedTabIds.length === 0 || scopedTabIds.includes(candidate))
      ) {
        activeTabId = candidate;
      }
    } catch {
      // keep current active tab id
    }
  }

  if (scopedTabIds.length > 0 && !scopedTabIds.includes(activeTabId)) {
    activeTabId = scopedTabIds[0];
  }

  const nowMs = Date.now();
  const listedById = new Map<number, RuntimeTabSnapshot>();
  for (const tab of listedTabs) listedById.set(tab.id, tab);
  const freshRuntimeListedIds = listedTabs
    .filter(tab => !!tab.runtimeId && nowMs - (tab.updatedAt || 0) <= staleRuntimeTabMaxAgeMs)
    .map(tab => tab.id);
  if (freshRuntimeListedIds.length > 0 && !freshRuntimeListedIds.includes(activeTabId)) {
    const freshestRuntimeTabId = [...freshRuntimeListedIds].sort(
      (a, b) => Number(listedById.get(b)?.updatedAt || 0) - Number(listedById.get(a)?.updatedAt || 0),
    )[0];
    if (Number.isFinite(freshestRuntimeTabId) && freshestRuntimeTabId > 0) {
      activeTabId = freshestRuntimeTabId;
    }
  }
  if (!tabIds.length) {
    tabIds = scopedTabIds.length > 0 ? [...scopedTabIds] : [activeTabId];
  } else if (!tabIds.includes(activeTabId)) {
    if (scopedTabIds.length > 0) {
      tabIds = [...scopedTabIds];
    } else if (listedTabs.length > 0) {
      activeTabId = tabIds[0];
    } else {
      tabIds = [activeTabId, ...tabIds];
    }
  }

  const baseOrder = scopedTabIds.length > 0
    ? [...scopedTabIds]
    : (listedTabs.length > 0
      ? dedupePositiveTabIds(listedTabs.map(tab => tab.id))
      : [...tabIds]);

  const prioritized = baseOrder.filter(tabId => {
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

  let tabOrder = scopedTabIds.length > 0
    ? preferScopedOrder(scopedTabIds, activeTabId, maxContextTabs)
    : [...new Set(prioritized.length ? prioritized : (baseOrder.length ? baseOrder : tabIds))];
  if (scopedTabIds.length === 0) {
    if (tabOrder.includes(activeTabId)) {
      tabOrder = [activeTabId, ...tabOrder.filter(tabId => tabId !== activeTabId)];
    } else {
      tabOrder = [activeTabId, ...tabOrder];
    }
    tabOrder = tabOrder.slice(0, maxContextTabs);
  }
  if (!tabOrder.length) {
    tabOrder = scopedTabIds.length > 0
      ? preferScopedOrder(scopedTabIds, activeTabId || scopedTabIds[0], maxContextTabs)
      : [activeTabId || 1];
  }

  const tabMetaById: Record<number, RuntimeTabSnapshot> = {};
  for (const tab of fallbackSnapshots) tabMetaById[tab.id] = tab;
  for (const tab of listedTabs) tabMetaById[tab.id] = { ...(tabMetaById[tab.id] || {}), ...tab };
  for (const tabId of scopedTabIds) {
    if (!tabMetaById[tabId]) tabMetaById[tabId] = { id: tabId };
  }
  for (const tabId of tabOrder) {
    if (!tabMetaById[tabId]) tabMetaById[tabId] = { id: tabId };
  }

  return { tabOrder, activeTabId, tabMetaById };
}
