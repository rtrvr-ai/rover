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
  onDiagnostics?: (payload: {
    hasExplicitScope: boolean;
    scopedTabIdsInput: number[];
    listedTabIds: number[];
    keptScopedTabIds: number[];
    resolvedTabOrder: number[];
  }) => void;
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

function filterTabIdsToScope(tabIds: number[], scopedTabIds: number[]): number[] {
  if (!scopedTabIds.length) return dedupePositiveTabIds(tabIds);
  const scoped = new Set(scopedTabIds);
  return dedupePositiveTabIds(tabIds).filter(tabId => scoped.has(tabId));
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
  const hasExplicitScope = scopedTabIds.length > 0;
  const scopedOrder = [...scopedTabIds];
  const scopedTabSet = new Set(scopedOrder);

  const fallbackSnapshots = normalizeFallbackTabs(fallbackTabs);
  const fallbackTabIds = dedupePositiveTabIds(
    (scopedTabIds.length > 0
      ? fallbackSnapshots.filter(tab => scopedTabIds.includes(tab.id))
      : fallbackSnapshots)
      .map(tab => tab.id),
  );
  let tabIds = [...fallbackTabIds];
  let listedTabs: RuntimeTabSnapshot[] = [];
  let listedTabIds: number[] = [];

  const isTabInScope = (tabId: number): boolean => {
    if (!hasExplicitScope) return true;
    return scopedTabSet.has(tabId);
  };

  if (bridgeRpc) {
    try {
      const listed = await bridgeRpc('listSessionTabs');
      listedTabs = normalizeListedTabs(Array.isArray(listed) ? listed : []);
      listedTabIds = dedupePositiveTabIds(listedTabs.map(tab => tab.id));
      if (listedTabIds.length > 0) {
        tabIds = hasExplicitScope ? filterTabIdsToScope(listedTabIds, scopedOrder) : listedTabIds;
      } else if (hasExplicitScope) {
        tabIds = [...scopedOrder];
      }
    } catch {
      // keep fallback tab ids
    }
  }
  if (hasExplicitScope) {
    tabIds = dedupePositiveTabIds(tabIds).filter(tabId => isTabInScope(tabId));
    if (!tabIds.length && scopedOrder.length) {
      tabIds = [...scopedOrder];
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
        && isTabInScope(candidate)
      ) {
        activeTabId = candidate;
      }
    } catch {
      // keep current active tab id
    }
  }

  if (hasExplicitScope && !isTabInScope(activeTabId) && scopedOrder.length > 0) {
    activeTabId = scopedOrder[0];
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
    if (
      Number.isFinite(freshestRuntimeTabId)
      && freshestRuntimeTabId > 0
      && isTabInScope(freshestRuntimeTabId)
    ) {
      activeTabId = freshestRuntimeTabId;
    }
  }
  if (!tabIds.length) {
    tabIds = hasExplicitScope
      ? (scopedOrder.length > 0 ? [...scopedOrder] : [activeTabId])
      : [activeTabId];
  } else if (!tabIds.includes(activeTabId)) {
    if (hasExplicitScope) {
      tabIds = scopedOrder.length > 0 ? [...scopedOrder] : tabIds;
    } else if (listedTabs.length > 0) {
      activeTabId = tabIds[0];
    } else {
      tabIds = [activeTabId, ...tabIds];
    }
  }

  const baseOrder = hasExplicitScope
    ? [...scopedOrder]
    : (listedTabs.length > 0
      ? dedupePositiveTabIds(listedTabs.map(tab => tab.id))
      : [...tabIds]);

  const prioritized = baseOrder.filter(tabId => {
    if (tabId === activeTabId) return true;
    const listed = listedById.get(tabId);
    if (!listed) {
      return hasExplicitScope;
    }
    if (listed.runtimeId) {
      return nowMs - (listed.updatedAt || 0) <= staleRuntimeTabMaxAgeMs;
    }
    if (listed.external) {
      return nowMs - (listed.updatedAt || 0) <= detachedExternalTabMaxAgeMs;
    }
    return nowMs - (listed.updatedAt || 0) <= staleRuntimeTabMaxAgeMs;
  });

  let tabOrder = hasExplicitScope
    ? preferScopedOrder(scopedOrder, activeTabId, maxContextTabs)
    : [...new Set(prioritized.length ? prioritized : (baseOrder.length ? baseOrder : tabIds))];
  if (!hasExplicitScope) {
    if (tabOrder.includes(activeTabId)) {
      tabOrder = [activeTabId, ...tabOrder.filter(tabId => tabId !== activeTabId)];
    } else {
      tabOrder = [activeTabId, ...tabOrder];
    }
    tabOrder = tabOrder.slice(0, maxContextTabs);
  }
  if (!tabOrder.length) {
    tabOrder = hasExplicitScope
      ? (scopedOrder.length > 0
        ? preferScopedOrder(scopedOrder, activeTabId || scopedOrder[0], maxContextTabs)
        : [activeTabId || 1])
      : [activeTabId || 1];
  }

  const tabMetaById: Record<number, RuntimeTabSnapshot> = {};
  for (const tab of fallbackSnapshots) tabMetaById[tab.id] = tab;
  for (const tab of listedTabs) tabMetaById[tab.id] = { ...(tabMetaById[tab.id] || {}), ...tab };
  for (const tabId of scopedOrder) {
    if (!tabMetaById[tabId]) tabMetaById[tabId] = { id: tabId };
  }
  for (const tabId of tabOrder) {
    if (!tabMetaById[tabId]) tabMetaById[tabId] = { id: tabId };
  }

  const diagnostics = {
    hasExplicitScope,
    scopedTabIdsInput: scopedTabIds,
    listedTabIds,
    keptScopedTabIds: scopedOrder,
    resolvedTabOrder: tabOrder,
  };

  if (hasExplicitScope) {
    if (scopedOrder.length && !scopedTabSet.has(activeTabId)) {
      activeTabId = scopedOrder[0];
    }
    tabOrder = preferScopedOrder(scopedOrder, activeTabId, maxContextTabs);
    const scopedMeta: Record<number, RuntimeTabSnapshot> = {};
    for (const tabId of scopedOrder) {
      scopedMeta[tabId] = tabMetaById[tabId] || { id: tabId };
    }
    options?.onDiagnostics?.({
      ...diagnostics,
      resolvedTabOrder: tabOrder,
    });
    return { tabOrder, activeTabId, tabMetaById: scopedMeta };
  }

  options?.onDiagnostics?.(diagnostics);
  return { tabOrder, activeTabId, tabMetaById };
}
