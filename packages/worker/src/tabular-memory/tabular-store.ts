import type { SheetInfo } from '@rover/shared/lib/types/index.js';
import { RTRVR_IN_MEM_SHEET_ID_PREFIX } from '@rover/shared/lib/utils/constants.js';

export type MemoryTab = {
  index: number;
  title: string;
  headerRow: string[];
  data: any[][];
  schema?: any;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, any>;
};

export type MemorySheet = {
  id: string;
  title: string;
  tabs: Map<number, MemoryTab>;
  tabTitleToIndex: Map<string, number>;
  nextTabIndex: number;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, any>;
};

export type PublishOptions = {
  sheetTitle?: string;
  tabTitle?: string;
  schema?: any;
  mergeWithExistingHeader?: boolean;
  alignToHeader?: boolean;
  createTabIfMissing?: boolean;
};

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

function normalizeTitle(title?: string): string {
  return (title || '').trim() || 'Data';
}

function padRowLength(row: any[], len: number): any[] {
  if (row.length >= len) return row;
  return [...row, ...new Array(len - row.length).fill('')];
}

function normalizeRowLength(row: any[], len: number): any[] {
  if (row.length === len) return row;
  if (row.length > len) return row.slice(0, len);
  const padded = row.slice();
  while (padded.length < len) padded.push('');
  return padded;
}

function headersFromSchema(schema?: any): string[] {
  if (!schema?.properties) return [];
  return Object.keys(schema.properties);
}

function estimateJsonSizeBytes(value: any): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function looksLikeSchema(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  return 'properties' in value || 'anyOf' in value || 'type' in value;
}

export class TabularStore {
  private memSheets = new Map<string, MemorySheet>();

  constructor(private readonly label?: string) {}

  createSheet(title?: string, meta?: Record<string, any>): MemorySheet {
    const id = `${RTRVR_IN_MEM_SHEET_ID_PREFIX}${makeId()}`;
    return this.createSheetWithId(id, title, meta);
  }

  private createSheetWithId(id: string, title?: string, meta?: Record<string, any>): MemorySheet {
    const now = Date.now();
    const sheet: MemorySheet = {
      id,
      title: normalizeTitle(title),
      tabs: new Map(),
      tabTitleToIndex: new Map(),
      nextTabIndex: 0,
      createdAt: now,
      updatedAt: now,
      meta,
    };

    this.memSheets.set(id, sheet);
    this.addTab(id, { title: sheet.title || 'Data', headerRow: [], data: [] });
    return sheet;
  }

  getOrCreateSheet(sheetId?: string, title?: string, meta?: Record<string, any>): MemorySheet {
    if (sheetId && this.memSheets.has(sheetId)) return this.memSheets.get(sheetId)!;

    if (sheetId && sheetId.startsWith(RTRVR_IN_MEM_SHEET_ID_PREFIX)) {
      console.warn(`[TabularStore] getOrCreateSheet: memory sheet ${sheetId} not found. Recreating empty sheet.`);
      return this.createSheetWithId(sheetId, title, meta);
    }

    return this.createSheet(title || sheetId, meta);
  }

  hasSheet(sheetId: string): boolean {
    return this.memSheets.has(sheetId);
  }

  getSheet(sheetId: string): MemorySheet {
    const sheet = this.memSheets.get(sheetId);
    if (!sheet) throw new Error(`Memory sheet not found: ${sheetId}`);
    return sheet;
  }

  deleteSheet(sheetId: string): boolean {
    return this.memSheets.delete(sheetId);
  }

  listSheets(): MemorySheet[] {
    return [...this.memSheets.values()];
  }

  clearAll(): void {
    this.memSheets.clear();
  }

  addTab(sheetId: string, tabInput: Omit<MemoryTab, 'index' | 'createdAt' | 'updatedAt'>): MemoryTab {
    const sheet = this.getSheet(sheetId);
    const index = sheet.nextTabIndex++;
    const now = Date.now();

    const title = this.makeUniqueTabTitle(sheet, tabInput.title);

    const tab: MemoryTab = {
      index,
      title,
      headerRow: tabInput.headerRow || [],
      data: tabInput.data || [],
      schema: tabInput.schema,
      createdAt: now,
      updatedAt: now,
      meta: tabInput.meta,
    };

    sheet.tabs.set(index, tab);
    sheet.tabTitleToIndex.set(title.toLowerCase(), index);
    sheet.updatedAt = now;
    return tab;
  }

  getTab(sheetId: string, tabIndex = 0): MemoryTab {
    const sheet = this.getSheet(sheetId);
    const tab = sheet.tabs.get(tabIndex);
    if (!tab) throw new Error(`Memory tab not found: ${sheetId}/tab/${tabIndex}`);
    return tab;
  }

  getTabByTitle(sheetId: string, title: string): MemoryTab | null {
    const sheet = this.memSheets.get(sheetId);
    if (!sheet) return null;
    const idx = sheet.tabTitleToIndex.get(title.toLowerCase());
    if (idx === undefined) return null;
    return sheet.tabs.get(idx) ?? null;
  }

  hasTab(sheetId: string, tabIndex: number): boolean {
    const sheet = this.memSheets.get(sheetId);
    return !!sheet && sheet.tabs.has(tabIndex);
  }

  getTabByIndex(sheetId: string, tabIndex = 0): MemoryTab | null {
    const sheet = this.memSheets.get(sheetId);
    if (!sheet) return null;
    return sheet.tabs.get(tabIndex) ?? null;
  }

  ensureTab(sheetId: string, title?: string, opts: { createIfMissing?: boolean } = {}): MemoryTab {
    const sheet = this.getSheet(sheetId);
    const t = normalizeTitle(title);
    const existing = this.getTabByTitle(sheetId, t);
    if (existing) return existing;
    if (opts.createIfMissing ?? true) {
      return this.addTab(sheetId, { title: t, headerRow: [], data: [] });
    }
    const first = this.getTabByIndex(sheetId, 0);
    if (!first) return this.addTab(sheetId, { title: t, headerRow: [], data: [] });
    return first;
  }

  private makeUniqueTabTitle(sheet: MemorySheet, desiredTitle?: string, excludeTabIndex?: number): string {
    const base = normalizeTitle(desiredTitle);
    const baseKey = base.toLowerCase();

    const existingIdx = sheet.tabTitleToIndex.get(baseKey);
    if (existingIdx === undefined || existingIdx === excludeTabIndex) return base;

    let n = 2;
    while (sheet.tabTitleToIndex.has(`${base} (${n})`.toLowerCase())) n++;
    return `${base} (${n})`;
  }

  renameTab(sheetId: string, tabIndex: number, newTitle: string): void {
    const sheet = this.getSheet(sheetId);
    const tab = this.getTab(sheetId, tabIndex);

    const oldKey = tab.title.toLowerCase();
    const desired = normalizeTitle(newTitle);
    const desiredKey = desired.toLowerCase();

    if (desiredKey === oldKey) {
      tab.title = desired;
      tab.updatedAt = Date.now();
      sheet.updatedAt = tab.updatedAt;
      sheet.tabTitleToIndex.set(oldKey, tabIndex);
      return;
    }

    sheet.tabTitleToIndex.delete(oldKey);
    const finalTitle = this.makeUniqueTabTitle(sheet, desired, tabIndex);
    tab.title = finalTitle;
    tab.updatedAt = Date.now();
    sheet.tabTitleToIndex.set(finalTitle.toLowerCase(), tabIndex);
    sheet.updatedAt = tab.updatedAt;
  }

  deleteTab(sheetId: string, tabIndex: number): boolean {
    const sheet = this.getSheet(sheetId);
    const tab = sheet.tabs.get(tabIndex);
    if (!tab) return false;
    sheet.tabTitleToIndex.delete(tab.title.toLowerCase());
    sheet.tabs.delete(tabIndex);
    sheet.updatedAt = Date.now();
    return true;
  }

  listTabs(sheetId: string): MemoryTab[] {
    const sheet = this.getSheet(sheetId);
    return [...sheet.tabs.values()].sort((a, b) => a.index - b.index);
  }

  setHeaderRow(sheetId: string, tabIndex: number, headerRow: string[]): void {
    const tab = this.getTab(sheetId, tabIndex);
    tab.headerRow = headerRow.map(String);
    tab.data = tab.data.map((row) => normalizeRowLength(row, tab.headerRow.length));
    tab.updatedAt = Date.now();
    this.touchSheet(sheetId);
  }

  mergeHeaderRow(sheetId: string, tabIndex: number, newHeaders: string[]): string[] {
    const tab = this.getTab(sheetId, tabIndex);
    const beforeLen = tab.headerRow.length;

    const set = new Set(tab.headerRow.map((h) => h.toLowerCase()));
    for (const h of newHeaders) {
      const key = String(h).toLowerCase();
      if (!set.has(key)) {
        tab.headerRow.push(String(h));
        set.add(key);
      }
    }

    const afterLen = tab.headerRow.length;
    if (afterLen > beforeLen) {
      tab.data = tab.data.map((r) => padRowLength(r, afterLen));
    }

    tab.updatedAt = Date.now();
    this.touchSheet(sheetId);
    return tab.headerRow;
  }

  setSchema(sheetId: string, tabIndex: number, schema?: any, opts: { preserveHeader?: boolean } = {}): void {
    const tab = this.getTab(sheetId, tabIndex);
    tab.schema = schema;

    if (!opts.preserveHeader && schema?.properties) {
      const schemaHeaders = headersFromSchema(schema);
      if (schemaHeaders.length) {
        const existing = tab.headerRow;
        if (!existing.length) {
          tab.headerRow = schemaHeaders.slice();
        } else {
          const lowerSchema = new Set(schemaHeaders.map((h) => h.toLowerCase()));
          const merged: string[] = [];

          for (const h of schemaHeaders) merged.push(h);
          for (const h of existing) {
            if (!lowerSchema.has(h.toLowerCase())) merged.push(h);
          }
          tab.headerRow = merged;
        }
        const len = tab.headerRow.length;
        tab.data = tab.data.map((r) => normalizeRowLength(r, len));
      }
    }

    tab.updatedAt = Date.now();
    this.touchSheet(sheetId);
  }

  appendRows(sheetId: string, tabIndex: number, rows: any[][], opts: { alignToHeader?: boolean } = {}): void {
    const tab = this.getTab(sheetId, tabIndex);
    const align = opts.alignToHeader !== false;
    const headerLen = tab.headerRow.length;

    for (const rawRow of rows) {
      const row = align && headerLen > 0 ? normalizeRowLength(rawRow, headerLen) : rawRow.slice();
      tab.data.push(row);
    }

    tab.updatedAt = Date.now();
    this.touchSheet(sheetId);
  }

  upsertColumnsByHeader(
    sheetId: string,
    tabIndex: number,
    rowIndex0: number,
    patch: Record<string, any>,
    opts: { createMissingHeaders?: boolean } = {},
  ): void {
    const tab = this.getTab(sheetId, tabIndex);
    const createMissing = opts.createMissingHeaders ?? true;

    const headerIndex = new Map<string, number>();
    tab.headerRow.forEach((h, i) => headerIndex.set(h, i));

    for (const key of Object.keys(patch)) {
      if (!headerIndex.has(key)) {
        if (!createMissing) continue;
        const newIndex = tab.headerRow.length;
        tab.headerRow.push(key);
        headerIndex.set(key, newIndex);
        tab.data = tab.data.map((r) => padRowLength(r, tab.headerRow.length));
      }
    }

    const headerLen = tab.headerRow.length;
    while (tab.data.length <= rowIndex0) {
      tab.data.push(new Array(headerLen).fill(''));
    }

    const row = tab.data[rowIndex0];
    for (const [key, value] of Object.entries(patch)) {
      const colIndex = headerIndex.get(key);
      if (colIndex === undefined) continue;
      row[colIndex] = value;
    }

    tab.updatedAt = Date.now();
    this.touchSheet(sheetId);
  }

  toAny2D(sheetId: string, tabIndex = 0, includeHeader = true): any[][] {
    const tab = this.getTab(sheetId, tabIndex);
    const rows = tab.data.map((r) => r.slice());
    return includeHeader ? [tab.headerRow.slice(), ...rows] : rows;
  }

  toObjects(sheetId: string, tabIndex = 0, opts: { maxRows?: number } = {}): Record<string, any>[] {
    const tab = this.getTab(sheetId, tabIndex);
    const header = tab.headerRow;
    const maxRows = opts.maxRows ?? tab.data.length;

    const out: Record<string, any>[] = [];
    for (let i = 0; i < tab.data.length && i < maxRows; i++) {
      const row = tab.data[i];
      const obj: Record<string, any> = {};
      for (let col = 0; col < header.length; col++) {
        obj[header[col]] = row[col];
      }
      out.push(obj);
    }
    return out;
  }

  toSheetInfo(sheetId: string, tabIndex = 0): SheetInfo {
    const sheet = this.getSheet(sheetId);
    const tab = this.getTab(sheetId, tabIndex);

    return {
      sheetId,
      sheetTitle: sheet.title,
      sheetTab: tab.title,
      sheetTabId: tab.index,
      sheetTabs: this.listTabs(sheetId).map((t) => ({ id: t.index, title: t.title })),
      kind: 'memory',
    } as SheetInfo;
  }

  publishFromObjects(
    sheetInfo: { sheetInfo: SheetInfo; headingInfo: { schema?: any; headings?: string[]; title?: string }; headerRow?: string[] },
    objects: Record<string, any>[],
    opts: PublishOptions = {},
  ) {
    const headers =
      sheetInfo.headerRow ||
      sheetInfo.headingInfo.headings ||
      Object.keys(sheetInfo.headingInfo.schema?.properties ?? {});

    const rows2d = objects.map((o) => headers.map((h) => o[h] ?? ''));
    const data2d = headers.length ? [headers, ...rows2d] : rows2d;

    return this.publishFromSheetWorkflow(sheetInfo, data2d, opts);
  }

  publishFromSheetWorkflow(
    schemaHeaderSheetInfo: { sheetInfo: SheetInfo; headingInfo: { schema?: any; headings?: string[]; title?: string }; headerRow?: string[] },
    sheetData: any[][],
    opts: PublishOptions = {},
  ) {
    const inputSheetInfo = schemaHeaderSheetInfo.sheetInfo;
    const title = opts.sheetTitle || schemaHeaderSheetInfo.headingInfo.title || inputSheetInfo?.sheetTitle || 'Data';

    const desiredTabTitle = opts.tabTitle || inputSheetInfo?.newTabTitle || inputSheetInfo?.sheetTab || 'Data';

    const schema = opts.schema || schemaHeaderSheetInfo.headingInfo.schema;
    const schemaHeaders = headersFromSchema(schema);

    const sheet = this.getOrCreateSheet(
      inputSheetInfo?.sheetId && inputSheetInfo.sheetId.startsWith(RTRVR_IN_MEM_SHEET_ID_PREFIX)
        ? inputSheetInfo.sheetId
        : undefined,
      title,
    );

    const tab = this.ensureTab(sheet.id, desiredTabTitle, { createIfMissing: true });

    const mergeWithExisting = opts.mergeWithExistingHeader ?? true;
    const tabAlreadyHadHeaders = tab.headerRow.length > 0;

    if (schemaHeaders.length) {
      if (tabAlreadyHadHeaders && mergeWithExisting) this.mergeHeaderRow(sheet.id, tab.index, schemaHeaders);
      else this.setHeaderRow(sheet.id, tab.index, schemaHeaders);
    } else if (schemaHeaderSheetInfo.headerRow?.length) {
      if (tabAlreadyHadHeaders && mergeWithExisting) {
        this.mergeHeaderRow(sheet.id, tab.index, schemaHeaderSheetInfo.headerRow);
      } else {
        this.setHeaderRow(sheet.id, tab.index, schemaHeaderSheetInfo.headerRow);
      }
    }

    this.setSchema(sheet.id, tab.index, schema, { preserveHeader: true });

    const finalHeader = this.getTab(sheet.id, tab.index).headerRow;
    const rowsOnly =
      sheetData.length &&
      finalHeader.length &&
      sheetData[0].length === finalHeader.length &&
      sheetData[0].every((v, i) => String(v).trim().toLowerCase() === finalHeader[i].trim().toLowerCase())
        ? sheetData.slice(1)
        : sheetData;

    this.appendRows(sheet.id, tab.index, rowsOnly, { alignToHeader: opts.alignToHeader ?? true });

    schemaHeaderSheetInfo.sheetInfo = {
      sheetId: sheet.id,
      sheetTitle: sheet.title,
      sheetTab: tab.title,
      sheetTabId: tab.index,
      sheetTabs: this.listTabs(sheet.id).map((t) => ({ title: t.title, id: t.index })),
      kind: 'memory',
    } as SheetInfo;

    schemaHeaderSheetInfo.headerRow = finalHeader;
    schemaHeaderSheetInfo.headingInfo.headings = finalHeader;

    return schemaHeaderSheetInfo;
  }

  publishNewTab(
    sheetId: string,
    tabTitle: string,
    headers: string[],
    rows: any[][],
    schema?: any,
  ): MemoryTab;
  publishNewTab(
    sheetId: string,
    tabTitle: string,
    headers: string[],
    rows: any[][],
    opts?: PublishOptions,
  ): MemoryTab;
  publishNewTab(
    sheetId: string,
    tabTitle: string,
    headers: string[],
    rows: any[][],
    schemaOrOpts?: any,
  ): MemoryTab {
    let opts: PublishOptions;
    if (!schemaOrOpts) {
      opts = {};
    } else if (looksLikeSchema(schemaOrOpts) && !('sheetTitle' in schemaOrOpts)) {
      opts = { schema: schemaOrOpts };
    } else {
      opts = schemaOrOpts as PublishOptions;
    }

    const sheet = this.getOrCreateSheet(sheetId);
    let tab: MemoryTab;
    const mergeHeader = opts.mergeWithExistingHeader ?? true;

    if (opts.createTabIfMissing === false) {
      const existing = this.getTabByTitle(sheet.id, tabTitle);
      if (existing) {
        tab = existing;
        if (!tab.headerRow.length) this.setHeaderRow(sheet.id, tab.index, headers);
        else if (mergeHeader) this.mergeHeaderRow(sheet.id, tab.index, headers);
      } else {
        tab = this.addTab(sheet.id, { title: tabTitle, headerRow: headers, data: [], schema: opts.schema, meta: undefined });
      }
    } else {
      tab = this.addTab(sheet.id, { title: tabTitle, headerRow: headers, data: [], schema: opts.schema, meta: undefined });
    }

    this.appendRows(sheet.id, tab.index, rows, { alignToHeader: opts.alignToHeader ?? true });
    return tab;
  }

  estimateTabSizeBytes(sheetId: string, tabIndex = 0): number {
    const tab = this.getTab(sheetId, tabIndex);
    const headerSize = estimateJsonSizeBytes(tab.headerRow);

    const rows = tab.data;
    const sampleLimit = 500;
    let rowsSize = 0;
    const sampleCount = Math.min(rows.length, sampleLimit);

    for (let i = 0; i < sampleCount; i++) {
      rowsSize += estimateJsonSizeBytes(rows[i]);
    }

    if (rows.length > sampleCount && sampleCount > 0) {
      rowsSize = Math.round(rowsSize * (rows.length / sampleCount));
    }

    return headerSize + rowsSize;
  }

  private touchSheet(sheetId: string): void {
    const sheet = this.memSheets.get(sheetId);
    if (sheet) sheet.updatedAt = Date.now();
  }
}

export const isMemorySheetId = (sheetId?: string | null): boolean => {
  return !!sheetId && sheetId.startsWith(RTRVR_IN_MEM_SHEET_ID_PREFIX);
};
