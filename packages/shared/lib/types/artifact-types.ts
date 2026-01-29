export type ReuseMode = 'off' | 'auto' | 'force';

export enum ExistingDocMode {
  APPEND = 'APPEND',
  OVERWRITE = 'OVERWRITE',
}

export enum ExistingSheetMode {
  SAMETAB = 'SAME_TAB',
  NEWTAB = 'NEW_TAB',
}

export interface ReuseSheetsTarget {
  sheetId: string;
  tabTitle?: string;
  tabId?: number;
  tabMode?: ExistingSheetMode; // if new_tab, runtime will create/use a new tab per run when supported
}

export interface ReuseDocTarget {
  docId: string;
  mode?: ExistingDocMode;
}

export interface ReuseSlidesTarget {
  presentationId: string;
  mode?: ExistingDocMode;
}

export interface ReusePdfsTarget {
  templateFileId?: string;
}

export interface ReuseArtifacts {
  mode?: ReuseMode;
  targets?: {
    sheets?: ReuseSheetsTarget;
    docs?: ReuseDocTarget;
    slides?: ReuseSlidesTarget;
    pdfs?: ReusePdfsTarget;
  };
}

export type ArtifactKind = 'sheets' | 'docs' | 'slides' | 'pdfs' | 'webpage';

export interface DocInfo {
  docId: string;
  url: string;
  /** Title MUST be persisted for planner usability */
  title?: string;
  /** Optional: useful for ordering/debug */
  createdAtMs?: number;
}

export interface SlidesInfo {
  presentationId: string;
  url: string;
  /** Title MUST be persisted for planner usability */
  title?: string;
  /** Optional: useful for ordering/debug */
  createdAtMs?: number;
}
