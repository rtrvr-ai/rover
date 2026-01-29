export function insertAfter(tabOrder: number[], afterId: number, newId: number): number[] {
  if (tabOrder.includes(newId)) return tabOrder;
  const idx = tabOrder.indexOf(afterId);
  if (idx < 0) return [...tabOrder, newId];
  return [...tabOrder.slice(0, idx + 1), newId, ...tabOrder.slice(idx + 1)];
}

export function removeFromOrder(tabOrder: number[], ids: number[]): number[] {
  const dead = new Set(ids);
  return tabOrder.filter(tabId => !dead.has(tabId));
}

export function alignWebPageMapToTabOrder<T extends Record<number, any>>(tabOrder: number[], webPageMap: T): T {
  const aligned: Record<number, unknown> = {};
  for (const tabId of tabOrder) {
    if (webPageMap[tabId]) {
      aligned[tabId] = webPageMap[tabId];
    }
  }

  for (const [key, value] of Object.entries(webPageMap)) {
    const tabId = Number(key);
    if (!Number.isFinite(tabId)) continue;
    if (!(tabId in aligned)) {
      aligned[tabId] = value;
    }
  }

  return aligned as T;
}
