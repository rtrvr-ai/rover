import {
  INTERACTIVE_LABEL_ATTR,
  getIndexedAnnotatedElement,
  iframeDoc,
  extractPrimaryInteractiveIdFromLabel,
} from '@rover/a11y-tree';
import { PageConfig } from '../types/index.js';
import { DEFAULT_PAGE_CONFIG } from '../utils/constants.js';

// ---- Realm-safe node type checks (avoid instanceof across iframes) ----
const NODE_ELEMENT = 1;
const NODE_DOCUMENT = 9;
const NODE_DOCUMENT_FRAGMENT = 11;

export type IframePath = number[];

/** MIME type identifier for Google Docs documents */
export const GOOGLE_DOC_MIME_TYPE = 'application/gdoc';

/** MIME type identifier for standard HTML documents */
export const HTML_MIME_TYPE = 'text/html';

/** MIME type identifier for plain text documents */
export const PLAIN_TEXT_MIME_TYPE = 'text/plain';

type ResolveOpts = {
  requireOwnerDocument?: Document; // if set, only accept elements in that doc
  traverseShadow?: boolean; // default true
  traverseIframes?: boolean; // default true
};

type DeepFindOpts = {
  traverseShadow?: boolean; // default true
  traverseIframes?: boolean; // default true
  requireOwnerDocument?: Document; // if set, only return elements whose ownerDocument === this
};

export type DocumentContext = {
  doc: Document;
  win: Window; // doc.defaultView when available
  iframePath: IframePath; // requested
  resolvedPath: IframePath; // resolved same-origin steps
  unresolvedPath: IframePath; // remaining steps (cross-origin or not found)
};

function isDocumentLike(v: any): v is Document {
  return !!v && typeof v === 'object' && (v as any).nodeType === NODE_DOCUMENT;
}

function isElementLike(v: any): v is Element {
  return !!v && typeof v === 'object' && (v as any).nodeType === NODE_ELEMENT;
}

function isShadowRootLike(v: any): v is ShadowRoot {
  // ShadowRoot is a DocumentFragment with a host+mode
  return (
    !!v &&
    typeof v === 'object' &&
    (v as any).nodeType === NODE_DOCUMENT_FRAGMENT &&
    typeof (v as any).host === 'object' &&
    typeof (v as any).mode === 'string'
  );
}

function isIframeElementLike(v: any): v is HTMLIFrameElement {
  return isElementLike(v) && String((v as any).tagName).toUpperCase() === 'IFRAME';
}

// ---- Robust numeric ID normalization ----
function normalizePositiveInt(raw: any): number | null {
  let n: number;

  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'bigint') n = Number(raw);
  else if (typeof raw === 'string') n = Number(raw.trim());
  else return null;

  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  return i;
}

export function getAnyShadowRoot(el: Element): ShadowRoot | null {
  try {
    const open = (el as any).shadowRoot as ShadowRoot | null;
    if (open) return open;
    const domApi = (globalThis as any)?.chrome?.dom;
    const closed = domApi?.openOrClosedShadowRoot?.(el) as ShadowRoot | null | undefined;
    return closed || null;
  } catch {
    return null;
  }
}

function deepFindByRtrvrId(doc: Document, id: number, opts: DeepFindOpts = {}): HTMLElement | null {
  const traverseShadow = opts.traverseShadow !== false;
  const traverseIframes = opts.traverseIframes !== false;
  const requireOwnerDocument = opts.requireOwnerDocument;

  const stack: Array<Document | Element | ShadowRoot> = [doc];
  const seen = new WeakSet<object>();

  while (stack.length) {
    const cur = stack.pop() as any;
    if (cur && typeof cur === 'object') {
      if (seen.has(cur)) continue;
      seen.add(cur);
    }

    // 1) Document → push its root element
    if (isDocumentLike(cur)) {
      const root = cur.documentElement || cur.body;
      if (root) stack.push(root);
      continue;
    }

    // 2) ShadowRoot → traverse shadow children ONLY
    if (isShadowRootLike(cur)) {
      const kids = (cur as any).children as HTMLCollectionOf<Element> | undefined;
      if (kids && kids.length) {
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
      continue;
    }

    // 3) Element
    if (!isElementLike(cur)) continue;
    const el = cur as Element;

    // Optional: enforce doc locality (useful for iframe-path resolution)
    if (requireOwnerDocument && (el as any).ownerDocument !== requireOwnerDocument) {
      // Still traverse its subtree only if it’s in the same doc; otherwise skip.
      // This keeps path semantics strict.
      continue;
    }

    const lbl = el.getAttribute?.(INTERACTIVE_LABEL_ATTR);
    if (lbl) {
      const primaryId = extractPrimaryInteractiveIdFromLabel(lbl);
      if (primaryId === id) return el as HTMLElement;
    }

    // open shadow
    if (traverseShadow) {
      try {
        const sr = getAnyShadowRoot(el);
        if (sr) stack.push(sr);
      } catch {
        /* ignore */
      }
    }

    // same-origin iframe doc
    if (traverseIframes && isIframeElementLike(el)) {
      try {
        const d = iframeDoc(el as any);
        if (d) stack.push(d);
      } catch {
        /* ignore */
      }
    }

    // light DOM children
    for (let c = (el as any).lastElementChild as Element | null; c; c = (c as any).previousElementSibling) {
      stack.push(c);
    }
  }

  return null;
}

export function resolveInteractiveElementById(
  rootDoc: Document,
  rawId: any,
  opts: ResolveOpts = {},
): HTMLElement | null {
  const id = normalizePositiveInt(rawId);
  if (!id) return null;

  // 1) Fast path: index
  const indexed = getIndexedAnnotatedElement(id);
  if (indexed) {
    const okDoc = !opts.requireOwnerDocument || (indexed as any).ownerDocument === opts.requireOwnerDocument;
    if (okDoc) return indexed as HTMLElement;
  }

  // 2) Fallback: realm-safe deep traversal
  return deepFindByRtrvrId(rootDoc, id, {
    requireOwnerDocument: opts.requireOwnerDocument,
    traverseShadow: opts.traverseShadow,
    traverseIframes: opts.traverseIframes,
  });
}

export function getEmbeddedPdfEl(doc: Document = document): HTMLEmbedElement | null {
  return doc.querySelector('embed[type="application/pdf"], ' + 'embed[type="application/x-google-chrome-pdf"]');
}

export function parseIframeIdPath(raw: any): IframePath {
  if (raw === null || raw === undefined) return [];

  // Already an array: allow [12,34] or ["12","34"]
  if (Array.isArray(raw)) {
    const out: number[] = [];
    for (const v of raw) {
      const n = normalizePositiveInt(v);
      if (n) out.push(n);
    }
    return out;
  }

  // Single numeric
  if (typeof raw === 'number' || typeof raw === 'bigint') {
    const n = normalizePositiveInt(raw);
    return n ? [n] : [];
  }

  // String path: "12>34>56" or "12, 34, 56" etc.
  if (typeof raw === 'string') {
    const matches = raw.match(/\d+/g);
    if (!matches) return [];
    const out = matches.map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0);
    return out;
  }

  // Optional future object forms (still “no prompt format change” because same field)
  if (typeof raw === 'object') {
    const maybePath = (raw as any).path ?? (raw as any).ids ?? (raw as any).iframe_path;
    if (maybePath !== undefined) return parseIframeIdPath(maybePath);
  }

  return [];
}

/**
 * Resolve iframe_id as either:
 *  - a single iframe element id (legacy), or
 *  - a path like "12>34>56" or [12,34,56] (nested frames)
 *
 * Same-origin: walks into content documents.
 * Cross-origin: stops and returns the last accessible doc + unresolvedPath.
 */
export function getDocumentContext(ROOT: Document, iframeIdRaw?: any): DocumentContext {
  const iframePath = parseIframeIdPath(iframeIdRaw);
  const rootWin = ROOT.defaultView || window;

  if (!iframePath.length) {
    return { doc: ROOT, win: rootWin, iframePath, resolvedPath: [], unresolvedPath: [] };
  }

  let doc: Document = ROOT;
  const resolvedPath: number[] = [];

  for (let i = 0; i < iframePath.length; i++) {
    const stepId = iframePath[i];

    // Legacy behavior for single id: allow finding that iframe anywhere under ROOT (includes nested iframes).
    const isSingleStep = iframePath.length === 1;

    const iframeEl = resolveInteractiveElementById(doc, stepId, {
      // For multi-step paths, each step must be in the *current* document (path semantics).
      requireOwnerDocument: isSingleStep ? undefined : doc,
      traverseShadow: true,
      traverseIframes: isSingleStep, // single-step: backwards-compatible "find anywhere"
    });

    if (!iframeEl || !isIframeElementLike(iframeEl)) {
      return {
        doc,
        win: doc.defaultView || rootWin,
        iframePath,
        resolvedPath,
        unresolvedPath: iframePath.slice(i),
      };
    }

    let childDoc: Document | null = null;
    try {
      childDoc = iframeDoc(iframeEl as any) || null;
    } catch {
      childDoc = null;
    }

    if (!childDoc) {
      // Cross-origin (or not ready). Stop here; caller may relay later using unresolvedPath.
      return {
        doc,
        win: doc.defaultView || rootWin,
        iframePath,
        resolvedPath,
        unresolvedPath: iframePath.slice(i),
      };
    }

    resolvedPath.push(stepId);
    doc = childDoc;
  }

  return { doc, win: doc.defaultView || rootWin, iframePath, resolvedPath, unresolvedPath: [] };
}

/** Backward compatible wrapper */
export function getDocumentElement(ROOT: Document, iframeIdRaw?: any): Document {
  return getDocumentContext(ROOT, iframeIdRaw).doc;
}

/**
 * Checks if current document is a PDF
 * Uses content type detection for reliable identification
 */
export function isCurrentDocumentPdf(contentType: string): boolean {
  return (
    contentType === 'application/pdf' ||
    contentType === 'application/x-pdf' ||
    contentType === 'application/x-google-chrome-pdf'
  );
}

export function normalizePdfSelectionTimeoutMs(pageConfig: PageConfig): number | undefined {
  const a = Number(pageConfig?.pdfTextSelectionTimeoutMs);
  const v = Number.isFinite(a) ? a : undefined;
  return v !== undefined ? Math.max(150, Math.floor(v)) : undefined;
}

export function normalizePageConfig(cfg?: PageConfig): PageConfig {
  const merged: PageConfig = { ...DEFAULT_PAGE_CONFIG, ...(cfg ?? {}) };

  // Support both names
  const a = Number((cfg as any)?.pdfTextSelectionTimeoutMs);
  if (Number.isFinite(a)) merged.pdfTextSelectionTimeoutMs = Math.floor(a);

  // Ensure numbers are sane
  if (merged.totalBudgetMs !== undefined) merged.totalBudgetMs = Math.max(1500, Math.floor(merged.totalBudgetMs));
  if (merged.pageDataTimeoutMs !== undefined)
    merged.pageDataTimeoutMs = Math.max(500, Math.floor(merged.pageDataTimeoutMs));
  if (merged.pdfTextSelectionTimeoutMs !== undefined)
    merged.pdfTextSelectionTimeoutMs = Math.max(150, Math.floor(merged.pdfTextSelectionTimeoutMs));
  if (merged.adaptiveSettleDebounceMs !== undefined) {
    merged.adaptiveSettleDebounceMs = Math.max(20, Math.min(500, Math.floor(merged.adaptiveSettleDebounceMs)));
  }
  if (merged.adaptiveSettleMaxWaitMs !== undefined) {
    merged.adaptiveSettleMaxWaitMs = Math.max(120, Math.min(5000, Math.floor(merged.adaptiveSettleMaxWaitMs)));
  }
  if (merged.adaptiveSettleRetries !== undefined) {
    merged.adaptiveSettleRetries = Math.max(0, Math.min(6, Math.floor(merged.adaptiveSettleRetries)));
  }
  if (merged.sparseTreeRetryDelayMs !== undefined) {
    merged.sparseTreeRetryDelayMs = Math.max(40, Math.min(1000, Math.floor(merged.sparseTreeRetryDelayMs)));
  }
  if (merged.sparseTreeRetryMaxAttempts !== undefined) {
    merged.sparseTreeRetryMaxAttempts = Math.max(0, Math.min(4, Math.floor(merged.sparseTreeRetryMaxAttempts)));
  }

  return merged;
}
