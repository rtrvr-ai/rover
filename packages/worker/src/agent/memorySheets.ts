import type { PlannerPreviousStep } from './types.js';
import type { SheetInfo } from '@rover/shared/lib/types/index.js';
import { TabularStore, isMemorySheetId } from '../tabular-memory/tabular-store.js';

export type MemorySheetTarget = {
  sheetId?: string;
  sheetTitle?: string;
  tabTitle?: string;
  mergeHeaders?: boolean;
};

const HISTORY_SHEET_REGEX = /history\.step\[\s*(\d+)\s*\]\.sheet\[\s*(\d+)\s*\](?:\.tab\[(.*?)\])?/i;

export function resolveHistorySheetInfo(ref: string, plannerPrevSteps?: PlannerPreviousStep[]): SheetInfo | undefined {
  if (!ref || !plannerPrevSteps?.length) return undefined;
  const match = ref.match(HISTORY_SHEET_REGEX);
  if (!match) return undefined;

  const stepNumber = parseInt(match[1], 10);
  const sheetIndex = parseInt(match[2], 10);
  const rawTab = match[3];

  if (!stepNumber || stepNumber < 1 || stepNumber > plannerPrevSteps.length) return undefined;
  const step = plannerPrevSteps[stepNumber - 1];
  const baseSheetInfo: SheetInfo | undefined =
    step?.schemaHeaderSheetInfo?.[sheetIndex]?.sheetInfo ||
    step?.schemaHeaderSheetInfo?.[0]?.sheetInfo;

  if (!baseSheetInfo) return undefined;
  const specific: SheetInfo = { ...baseSheetInfo };

  if (rawTab) {
    const cleaned = rawTab.trim();
    if (/^['"].*['"]$/.test(cleaned)) {
      const tabTitle = cleaned.slice(1, -1);
      const found = baseSheetInfo.sheetTabs?.find((t) => String(t.title).toLowerCase() === tabTitle.toLowerCase());
      if (found) {
        specific.sheetTab = found.title;
        specific.sheetTabId = found.id;
      }
    } else {
      const idx = parseInt(cleaned, 10);
      if (!Number.isNaN(idx)) {
        const picked = baseSheetInfo.sheetTabs?.[idx] || baseSheetInfo.sheetTabs?.[idx - 1];
        if (picked) {
          specific.sheetTab = picked.title;
          specific.sheetTabId = picked.id;
        }
      }
    }
  }

  return specific;
}

export function resolveMemoryTarget(outputDestination: any, plannerPrevSteps?: PlannerPreviousStep[]): MemorySheetTarget {
  const dest = outputDestination || {};
  const existingRef =
    dest.existing_sheet_from_history ||
    dest.existingSheetFromHistory ||
    dest.existing_sheet_id ||
    dest.existingSheetId;

  let sheetInfo: SheetInfo | undefined;
  if (typeof existingRef === 'string') {
    sheetInfo = resolveHistorySheetInfo(existingRef, plannerPrevSteps);
    if (!sheetInfo && existingRef.trim()) {
      sheetInfo = {
        sheetId: existingRef.trim(),
        sheetTab: dest.existingTabTitle || dest.existing_tab_title || 'Data',
      } as SheetInfo;
    }
  } else if (existingRef && typeof existingRef === 'object') {
    sheetInfo = existingRef as SheetInfo;
  }

  const newSheetTitle = dest.new_sheet_title || dest.newSheetTitle;
  const newTabTitle = dest.new_tab_title || dest.newTabTitle;
  const existingTabTitle = dest.existing_tab_title || dest.existingTabTitle;

  if (sheetInfo?.sheetId && isMemorySheetId(sheetInfo.sheetId)) {
    return {
      sheetId: sheetInfo.sheetId,
      sheetTitle: sheetInfo.sheetTitle || newSheetTitle,
      tabTitle: existingTabTitle || sheetInfo.sheetTab || newTabTitle || 'Data',
      mergeHeaders: true,
    };
  }

  return {
    sheetId: undefined,
    sheetTitle: newSheetTitle,
    tabTitle: newTabTitle || existingTabTitle,
    mergeHeaders: false,
  };
}

export function buildHeaders(schema?: any, data?: any[]): string[] {
  if (schema?.properties && typeof schema.properties === 'object') {
    return Object.keys(schema.properties);
  }
  const headers = new Set<string>();
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        Object.keys(row).forEach((key) => headers.add(key));
      }
    }
  }
  return headers.size ? [...headers] : [];
}

export function objectsToRows(headers: string[], objects: Record<string, any>[]): any[][] {
  return objects.map((obj) => headers.map((h) => obj?.[h] ?? ''));
}

export function publishObjectsToMemory(params: {
  store: TabularStore;
  target: MemorySheetTarget;
  headers: string[];
  objects: Record<string, any>[];
  schema?: any;
}): { sheetInfo: SheetInfo; headerRow: string[] } {
  const { store, target, headers, objects, schema } = params;
  const sheet = store.getOrCreateSheet(target.sheetId, target.sheetTitle);
  const tabTitle = target.tabTitle || 'Data';
  const tab = store.ensureTab(sheet.id, tabTitle, { createIfMissing: true });

  if (!tab.headerRow.length) {
    store.setHeaderRow(sheet.id, tab.index, headers);
  } else if (target.mergeHeaders) {
    store.mergeHeaderRow(sheet.id, tab.index, headers);
  } else {
    store.setHeaderRow(sheet.id, tab.index, headers);
  }

  if (schema) {
    store.setSchema(sheet.id, tab.index, schema, { preserveHeader: true });
  }

  const finalHeaders = store.getTab(sheet.id, tab.index).headerRow;
  const rows = objectsToRows(finalHeaders, objects);
  store.appendRows(sheet.id, tab.index, rows, { alignToHeader: true });

  const sheetInfo = store.toSheetInfo(sheet.id, tab.index);
  return { sheetInfo, headerRow: finalHeaders };
}

export function publishRowsToMemory(params: {
  store: TabularStore;
  target: MemorySheetTarget;
  headers: string[];
  rows: any[][];
  schema?: any;
}): { sheetInfo: SheetInfo; headerRow: string[] } {
  const { store, target, headers, rows, schema } = params;
  const sheet = store.getOrCreateSheet(target.sheetId, target.sheetTitle);
  const tabTitle = target.tabTitle || 'Data';
  const tab = store.ensureTab(sheet.id, tabTitle, { createIfMissing: true });

  if (!tab.headerRow.length) {
    store.setHeaderRow(sheet.id, tab.index, headers);
  } else if (target.mergeHeaders) {
    store.mergeHeaderRow(sheet.id, tab.index, headers);
  } else {
    store.setHeaderRow(sheet.id, tab.index, headers);
  }

  if (schema) {
    store.setSchema(sheet.id, tab.index, schema, { preserveHeader: true });
  }

  store.appendRows(sheet.id, tab.index, rows, { alignToHeader: true });

  const sheetInfo = store.toSheetInfo(sheet.id, tab.index);
  return { sheetInfo, headerRow: store.getTab(sheet.id, tab.index).headerRow };
}

export function attachSheetData(store: TabularStore, sheetInfo: SheetInfo): SheetInfo {
  const tabIndex = sheetInfo.sheetTabId ?? 0;
  const data = store.toAny2D(sheetInfo.sheetId, tabIndex, true);
  return { ...sheetInfo, sheetData: data, kind: 'memory' } as SheetInfo;
}
