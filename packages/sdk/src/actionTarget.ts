import { resolveInteractiveElementById } from '@rover/shared/lib/page/index.js';

function positiveElementId(value: unknown): number | undefined {
  const id = Math.trunc(Number(value));
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

export function resolveRoverActionElement(elementId: number, rootDoc: Document = document): Element | null {
  const id = positiveElementId(elementId);
  if (!id) return null;

  try {
    const resolved = resolveInteractiveElementById(rootDoc, id);
    if (resolved) return resolved;
  } catch {
    // Fall through to the historical data-rveid lookup.
  }

  try {
    return rootDoc.querySelector(`[data-rveid="${id}"]`);
  } catch {
    return null;
  }
}
