import type { PageConfig, PageData } from '@rover/shared';
import {
  ADDITIONAL_PDF_PAGE_LOAD_DELAY,
  DEFAULT_PAGE_CONFIG,
  GOOGLE_SHEET_MIME_TYPE,
  PDF_MIME_TYPE,
  getEmbeddedPdfEl,
  isCurrentDocumentPdf,
  normalizePdfSelectionTimeoutMs,
  GOOGLE_DOC_MIME_TYPE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
  delayBgSafe,
  sleepBgSafe,
  timeLeftMs,
  withBgSafeTimeout,
} from '@rover/shared';
import type { SemanticNode } from '@rover/a11y-tree';
import {
  PreservedAttribute,
  RTRVR_MAIN_WORLD_BUSY_ATTRIBUTE,
  globalDocumentSafe,
  globalWindowSafe,
} from '@rover/a11y-tree';
import { buildSnapshot } from './snapshot.js';
import type { InstrumentationController } from '@rover/instrumentation';
import { directScrollBy, ScrollDirectionEnum } from './scroll/scroll-helpers.js';

const ID_REGEX = /\[id=(\d+)\]/;

enum DocumentType {
  HTML = 'html',
  PDF = 'pdf',
  GOOGLE_DOC = 'google_doc',
  GOOGLE_SHEET = 'google_sheet',
  PLAIN_TEXT = 'plain_text',
}

interface PdfTextExtractionResult {
  success: boolean;
  data: string;
  reason?: 'timeout' | 'no_viewer' | 'no_response' | 'ok';
}

const pdfTextCache = new Map<string, string>();
const DEFAULT_ADAPTIVE_SETTLE_DEBOUNCE_MS = 24;
const DEFAULT_ADAPTIVE_SETTLE_MAX_WAIT_MS = 220;
const DEFAULT_ADAPTIVE_SETTLE_RETRIES = 0;
const DEFAULT_SPARSE_TREE_RETRY_DELAY_MS = 35;
const DEFAULT_SPARSE_TREE_RETRY_MAX_ATTEMPTS = 1;

type AdaptiveDomSettleConfig = {
  debounceMs: number;
  maxWaitMs: number;
  retries: number;
  sparseTreeRetryDelayMs: number;
  sparseTreeRetryMaxAttempts: number;
};

function buildElementLinkRecord(nodes: Record<number, SemanticNode>): Record<number, string> {
  const record: Record<number, string> = {};
  for (const key of Object.keys(nodes)) {
    const node = nodes[Number(key)];
    const label = node?.preservedAttributes?.[PreservedAttribute['rtrvr-label']];
    const link = node?.resourceLocator;
    if (typeof label === 'string' && typeof link === 'string') {
      const match = label.match(ID_REGEX);
      if (match?.[1]) {
        const id = Number(match[1]);
        if (Number.isFinite(id)) record[id] = link;
      }
    }
  }
  return record;
}

export async function buildPageData(
  root: Element,
  instrumentation: InstrumentationController,
  opts: { includeFrames?: boolean; disableDomAnnotations?: boolean; pageConfig?: PageConfig } = {},
): Promise<PageData> {
  const doc = root.ownerDocument || document;
  const pageConfig = opts.pageConfig || DEFAULT_PAGE_CONFIG;
  const rawContentType = String(doc.contentType || '').trim().toLowerCase();

  const analysis = analyzeDocumentStructure(rawContentType, doc);
  const contentType = resolveContentType(analysis.documentType, rawContentType);
  const pageMetadata: PageData = {
    url: doc.URL,
    title: doc.title,
    contentType,
  };

  const globalDeadline = getGlobalDeadline(pageConfig);
  const adaptiveSettle = resolveAdaptiveDomSettleConfig(pageConfig);

  if (analysis.documentType !== DocumentType.HTML) {
    const rawMsgTimeout = Number(pageConfig?.pageDataTimeoutMs);
    const msgTimeoutMs = Number.isFinite(rawMsgTimeout) ? Math.max(200, Math.floor(rawMsgTimeout)) : 9000;
    const nonHtmlBudgetMs = Math.max(200, Math.min(msgTimeoutMs, timeLeftMs(globalDeadline)));

    const extractionPromise = extractNonHtmlContent(doc, analysis.documentType, pageConfig, globalDeadline);
    const result = await withBgSafeTimeout(extractionPromise, nonHtmlBudgetMs, doc);
    if (!result.ok) {
      return {
        ...pageMetadata,
        content: '',
        error: `non_html_timeout:${contentType}`,
        metadata: { extractionMethod: 'timeout' },
      };
    }

    const extracted = result.value || {};
    const sheetInfo = analysis.documentType === DocumentType.GOOGLE_SHEET ? buildSheetInfo(doc) : undefined;

    return {
      ...pageMetadata,
      ...extracted,
      contentType: extracted.contentType || pageMetadata.contentType,
      sheetInfo: extracted.sheetInfo || sheetInfo,
    };
  }

  if (pageConfig?.onlyTextContent) {
    return {
      ...pageMetadata,
      contentType: HTML_MIME_TYPE,
      content: getDocumentTextFallback(doc),
    };
  }

  const prepBudgetMs = Math.max(0, Math.min(3000, timeLeftMs(globalDeadline)));
  const prepStart = performance.now();
  let didScroll = false;

  if (!pageConfig?.disableAutoScroll && prepBudgetMs > 80) {
    const scrollCap = doc.hidden ? 900 : 1500;
    const scrollBudgetMs = Math.min(scrollCap, prepBudgetMs);
    if (scrollBudgetMs > 80) {
      didScroll = await scrollForDataCollection(doc, {
        profile: 'light',
        timeBudgetMs: scrollBudgetMs,
        delayMs: doc.hidden ? 0 : 160,
        finalWaitMs: doc.hidden ? 0 : 200,
      });
    }
  }

  const prepRemainingBeforeSettle = Math.max(0, prepBudgetMs - (performance.now() - prepStart));
  if (prepRemainingBeforeSettle > 60) {
    await waitForAdaptiveDomSettle(doc, {
      ...adaptiveSettle,
      deadlineEpochMs: globalDeadline,
      totalBudgetMs: prepRemainingBeforeSettle,
    });
  }

  const prepRemaining = Math.max(0, prepBudgetMs - (performance.now() - prepStart));
  if (prepRemaining > 80) {
    await flushListenerScan(doc, {
      mode: 'full',
      totalBudgetMs: Math.min(doc.hidden ? 1400 : 1200, prepRemaining),
      budgetMs: Math.min(doc.hidden ? 650 : 850, prepRemaining),
      maxPasses: doc.hidden ? 1 : 2,
    });
  }

  let snapshot = buildSnapshot(root, instrumentation, {
    includeFrames: opts.includeFrames ?? true,
    disableDomAnnotations: opts.disableDomAnnotations ?? true,
  });

  const retryAttempts = Math.max(0, adaptiveSettle.sparseTreeRetryMaxAttempts);
  let retryCount = 0;
  while (retryCount < retryAttempts && isTreeSparse(snapshot.rootNodes, snapshot.semanticNodes)) {
    const waitMs = Math.max(10, Math.min(600, adaptiveSettle.sparseTreeRetryDelayMs));
    await sleepBgSafe(waitMs, doc);
    const retryBudget = Math.max(20, Math.min(180, timeLeftMs(globalDeadline)));
    if (retryBudget > 20) {
      await waitForAdaptiveDomSettle(doc, {
        ...adaptiveSettle,
        deadlineEpochMs: globalDeadline,
        totalBudgetMs: retryBudget,
      });
    }
    snapshot = buildSnapshot(root, instrumentation, {
      includeFrames: opts.includeFrames ?? true,
      disableDomAnnotations: opts.disableDomAnnotations ?? true,
    });
    retryCount += 1;
  }

  if (isTreeEmpty(snapshot.rootNodes, snapshot.semanticNodes)) {
    return {
      ...pageMetadata,
      contentType: HTML_MIME_TYPE,
      content: getDocumentTextFallback(doc),
      metadata: { scrollingPerformed: didScroll, extractionMethod: retryCount > 0 ? 'sparse_tree_fallback' : undefined },
    };
  }

  return {
    ...pageMetadata,
    contentType: HTML_MIME_TYPE,
    roots: snapshot.rootNodes,
    nodes: snapshot.semanticNodes,
    elementLinkRecord: buildElementLinkRecord(snapshot.semanticNodes),
    metadata: { scrollingPerformed: didScroll, extractionMethod: retryCount > 0 ? 'sparse_tree_retry' : undefined },
  };
}

function resolveAdaptiveDomSettleConfig(pageConfig?: PageConfig): AdaptiveDomSettleConfig {
  const debounceMs = Number(pageConfig?.adaptiveSettleDebounceMs);
  const maxWaitMs = Number(pageConfig?.adaptiveSettleMaxWaitMs);
  const retries = Number(pageConfig?.adaptiveSettleRetries);
  const sparseTreeRetryDelayMs = Number(pageConfig?.sparseTreeRetryDelayMs);
  const sparseTreeRetryMaxAttempts = Number(pageConfig?.sparseTreeRetryMaxAttempts);
  return {
    debounceMs: Number.isFinite(debounceMs)
      ? Math.max(8, Math.min(500, Math.floor(debounceMs)))
      : DEFAULT_ADAPTIVE_SETTLE_DEBOUNCE_MS,
    maxWaitMs: Number.isFinite(maxWaitMs)
      ? Math.max(80, Math.min(5000, Math.floor(maxWaitMs)))
      : DEFAULT_ADAPTIVE_SETTLE_MAX_WAIT_MS,
    retries: Number.isFinite(retries)
      ? Math.max(0, Math.min(6, Math.floor(retries)))
      : DEFAULT_ADAPTIVE_SETTLE_RETRIES,
    sparseTreeRetryDelayMs: Number.isFinite(sparseTreeRetryDelayMs)
      ? Math.max(20, Math.min(1_000, Math.floor(sparseTreeRetryDelayMs)))
      : DEFAULT_SPARSE_TREE_RETRY_DELAY_MS,
    sparseTreeRetryMaxAttempts: Number.isFinite(sparseTreeRetryMaxAttempts)
      ? Math.max(0, Math.min(4, Math.floor(sparseTreeRetryMaxAttempts)))
      : DEFAULT_SPARSE_TREE_RETRY_MAX_ATTEMPTS,
  };
}

async function waitForAdaptiveDomSettle(
  doc: Document,
  options: AdaptiveDomSettleConfig & { deadlineEpochMs: number; totalBudgetMs: number },
): Promise<void> {
  const remainingGlobal = timeLeftMs(options.deadlineEpochMs);
  if (remainingGlobal <= 20) return;
  const totalBudgetMs = Math.max(20, Math.min(Math.floor(options.totalBudgetMs), remainingGlobal));
  const settleDeadline = Date.now() + totalBudgetMs;
  let attempts = 0;

  while (attempts <= options.retries && timeLeftMs(settleDeadline) > 20) {
    const windowBudgetMs = Math.max(40, Math.min(options.maxWaitMs, timeLeftMs(settleDeadline)));
    const settled = await waitForDomQuietWindow(doc, {
      debounceMs: options.debounceMs,
      windowBudgetMs,
      deadlineEpochMs: settleDeadline,
    });
    if (settled) return;
    attempts += 1;
  }
}

async function waitForDomQuietWindow(
  doc: Document,
  options: { debounceMs: number; windowBudgetMs: number; deadlineEpochMs: number },
): Promise<boolean> {
  const root = doc.documentElement;
  if (!root || typeof MutationObserver === 'undefined') return true;

  let lastMutationAt = Date.now();
  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
  });
  try {
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  } catch {
    return true;
  }

  const windowDeadline = Date.now() + Math.max(40, Math.floor(options.windowBudgetMs));
  try {
    while (timeLeftMs(options.deadlineEpochMs) > 20 && timeLeftMs(windowDeadline) > 20) {
      const idleMs = Date.now() - lastMutationAt;
      if (idleMs >= options.debounceMs) return true;
      const waitMs = Math.max(
        10,
        Math.min(
          60,
          options.debounceMs - idleMs,
          timeLeftMs(options.deadlineEpochMs),
          timeLeftMs(windowDeadline),
        ),
      );
      await sleepBgSafe(waitMs, doc);
    }
  } finally {
    observer.disconnect();
  }

  return false;
}

function getGlobalDeadline(pageConfig?: PageConfig): number {
  const explicit = Number(pageConfig?.deadlineEpochMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const totalBudget = Number(pageConfig?.totalBudgetMs);
  const base = Number.isFinite(totalBudget) ? Math.max(1500, Math.floor(totalBudget)) : 9000;
  return Date.now() + base;
}

function resolveContentType(documentType: DocumentType, rawContentType: string): string {
  switch (documentType) {
    case DocumentType.PDF:
      return PDF_MIME_TYPE;
    case DocumentType.GOOGLE_DOC:
      return GOOGLE_DOC_MIME_TYPE;
    case DocumentType.GOOGLE_SHEET:
      return GOOGLE_SHEET_MIME_TYPE;
    case DocumentType.PLAIN_TEXT:
      return PLAIN_TEXT_MIME_TYPE;
    case DocumentType.HTML:
    default:
      return rawContentType || HTML_MIME_TYPE;
  }
}

function analyzeDocumentStructure(contentType: string | undefined, doc: Document): { documentType: DocumentType } {
  const raw = contentType || String(doc.contentType || '').toLowerCase();
  if (isCurrentDocumentPdf(raw)) return { documentType: DocumentType.PDF };

  if (hasEmbeddedPdf(doc) && (isMostlyEmbeddedPdfDocument(doc) || looksLikePdfUrl(doc.URL))) {
    return { documentType: DocumentType.PDF };
  }

  if (isGoogleDocsDocument(doc)) return { documentType: DocumentType.GOOGLE_DOC };
  if (isGoogleSheet(doc)) return { documentType: DocumentType.GOOGLE_SHEET };

  if (raw.includes(PLAIN_TEXT_MIME_TYPE)) return { documentType: DocumentType.PLAIN_TEXT };

  return { documentType: DocumentType.HTML };
}

function hasEmbeddedPdf(doc: Document): boolean {
  try {
    const root = getPdfDocumentRoot(doc);
    if (getEmbeddedPdfEl(root as any)) return true;
    const obj = (root as any).querySelector?.(
      'object[type="application/pdf"],object[type="application/x-google-chrome-pdf"]',
    );
    return !!obj;
  } catch {
    return false;
  }
}

function looksLikePdfUrl(u: string): boolean {
  try {
    if (!u) return false;
    if (u.toLowerCase().includes('.pdf')) return true;
    const url = new URL(u);
    const file = url.searchParams.get('file') || '';
    return file.toLowerCase().includes('.pdf');
  } catch {
    return String(u || '').toLowerCase().includes('.pdf');
  }
}

function isMostlyEmbeddedPdfDocument(doc: Document): boolean {
  try {
    const b = doc.body;
    if (!b) return false;
    const embeds = b.querySelectorAll(
      'embed[type="application/pdf"],embed[type="application/x-google-chrome-pdf"],' +
        'object[type="application/pdf"],object[type="application/x-google-chrome-pdf"]',
    );
    if (embeds.length === 0) return false;
    const txt = (b.innerText || '').trim();
    if (txt.length > 40) return false;
    const kids = Array.from(b.children).filter(el => !['SCRIPT', 'STYLE'].includes(String(el.tagName).toUpperCase()));
    return kids.length <= 3;
  } catch {
    return false;
  }
}

async function extractNonHtmlContent(
  doc: Document,
  documentType: DocumentType,
  pageConfig: PageConfig,
  deadlineEpochMs: number,
): Promise<Partial<PageData>> {
  switch (documentType) {
    case DocumentType.PDF:
      return extractPdfContent(doc, pageConfig, deadlineEpochMs);
    case DocumentType.GOOGLE_DOC:
      return extractGoogleDocsContent(doc);
    case DocumentType.GOOGLE_SHEET:
      return getGoogleSheetContent(doc, pageConfig);
    case DocumentType.PLAIN_TEXT:
      return {
        content: getDocumentTextFallback(doc),
        contentType: PLAIN_TEXT_MIME_TYPE,
      };
    case DocumentType.HTML:
    default:
      return {
        content: getDocumentTextFallback(doc),
        contentType: HTML_MIME_TYPE,
      };
  }
}

async function extractPdfContent(
  doc: Document,
  pageConfig: PageConfig,
  deadlineEpochMs: number,
): Promise<Partial<PageData>> {
  const allowDelay = timeLeftMs(deadlineEpochMs) > ADDITIONAL_PDF_PAGE_LOAD_DELAY + 50;
  if (allowDelay) {
    await delayBgSafe(ADDITIONAL_PDF_PAGE_LOAD_DELAY, doc, deadlineEpochMs);
  }

  const requestedSelMs = (() => {
    const v = Number(pageConfig?.pdfTextSelectionTimeoutMs);
    const fallback = DEFAULT_PAGE_CONFIG.pdfTextSelectionTimeoutMs!;
    return Number.isFinite(v) ? Math.max(150, Math.floor(v)) : fallback;
  })();

  const left = timeLeftMs(deadlineEpochMs);
  const safety = 150;
  const selectionTimeoutMs = Number.isFinite(left)
    ? Math.max(150, Math.min(requestedSelMs, Math.max(0, left - safety)))
    : requestedSelMs;

  const extractionResult = await getPdfTextContent(doc, selectionTimeoutMs);
  const ok = !!extractionResult.success && !!(extractionResult.data || '').trim();

  return {
    content: ok ? extractionResult.data || '' : '',
    contentType: PDF_MIME_TYPE,
    error: ok ? undefined : `pdf_extraction_failed:${extractionResult.reason || 'unknown'}`,
  };
}

async function extractGoogleDocsContent(doc: Document): Promise<Partial<PageData>> {
  const documentText = extractGoogleDocumentText();
  return {
    content: documentText,
    contentType: GOOGLE_DOC_MIME_TYPE,
  };
}

function isTreeEmpty(roots: number[], nodes: Record<number, any>): boolean {
  if (!Array.isArray(roots) || roots.length === 0) return true;
  if (!nodes || Object.keys(nodes).length === 0) return true;
  return false;
}

function isTreeSparse(roots: number[], nodes: Record<number, any>): boolean {
  if (!Array.isArray(roots) || roots.length === 0) return true;
  const semanticCount = nodes && typeof nodes === 'object' ? Object.keys(nodes).length : 0;
  if (semanticCount === 0) return true;
  if (roots.length === 1 && semanticCount <= 4) return true;
  const semanticDensity = semanticCount / Math.max(1, roots.length);
  if (roots.length <= 2 && semanticDensity <= 2) return true;
  return false;
}

function getDocumentTextFallback(doc: Document): string {
  return (
    doc.body?.innerText ||
    doc.body?.textContent ||
    doc.documentElement?.innerText ||
    doc.documentElement?.textContent ||
    ''
  );
}

function getPdfDocumentRoot(doc: Document): DocumentFragment | Document {
  try {
    const win = doc.defaultView || window;
    const internalKey = (win as any).__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
    const internal = (win as any)[internalKey];
    const getter = internal?.shadow?.getRoot;
    if (typeof getter === 'function') {
      const root = getter(doc.body || doc.documentElement);
      if (root) return root;
    }
  } catch {
    // ignore
  }
  return doc;
}

function getPdfCacheKey(doc: Document): string {
  const raw = doc.URL || '';
  try {
    const url = new URL(raw);
    const file = url.searchParams.get('file') || url.searchParams.get('src') || '';
    if (file) return file;
    return raw;
  } catch {
    return raw;
  }
}

async function getPdfTextContent(doc: Document, pdfTextSelectionTimeoutMs?: number): Promise<PdfTextExtractionResult> {
  const selectionTimeoutMs =
    Number.isFinite(pdfTextSelectionTimeoutMs) && (pdfTextSelectionTimeoutMs as number) > 0
      ? Math.floor(pdfTextSelectionTimeoutMs as number)
      : DEFAULT_PAGE_CONFIG.pdfTextSelectionTimeoutMs!;

  const cacheKey = getPdfCacheKey(doc);
  const cached = pdfTextCache.get(cacheKey) ?? '';
  if (cached.trim().length > 0) {
    return { success: true, data: cached, reason: 'ok' };
  }

  const extraction = await extractPdfTextFromViewer(doc, selectionTimeoutMs);
  if (extraction.success && extraction.data.trim()) {
    pdfTextCache.set(cacheKey, extraction.data);
  }

  return extraction;
}

async function extractPdfTextFromViewer(doc: Document, timeoutMs: number): Promise<PdfTextExtractionResult> {
  const win = doc.defaultView || window;
  const target = findPdfMessageTarget(doc);
  if (!target || typeof target.postMessage !== 'function') {
    return { success: false, data: '', reason: 'no_viewer' };
  }

  const requestId =
    (globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  let done = false;
  let lastText = '';

  const onMessage = (ev: MessageEvent) => {
    if (done) return;
    if (!isPdfViewerOriginAllowed(String(ev.origin || ''), doc)) return;
    const data = ev.data as any;
    if (!isPdfViewerReplyMessage(data, requestId)) return;
    if (typeof data.selectedText === 'string') {
      const text = data.selectedText.trim();
      if (text.length > 0) {
        lastText = data.selectedText;
        done = true;
      }
    }
  };

  win.addEventListener('message', onMessage);

  try {
    target.postMessage({ type: 'selectAll', requestId }, '*');
  } catch {
    // ignore
  }

  const start = Date.now();
  while (!done && Date.now() - start < timeoutMs) {
    try {
      target.postMessage({ type: 'getSelectedText', requestId }, '*');
    } catch {
      // ignore
    }
    await sleepBgSafe(200, doc);
    if (lastText.trim()) {
      done = true;
      break;
    }
  }

  win.removeEventListener('message', onMessage);

  if (lastText.trim()) {
    return { success: true, data: lastText, reason: 'ok' };
  }

  const reason = Date.now() - start >= timeoutMs ? 'timeout' : 'no_response';
  return { success: false, data: '', reason };
}

function findPdfMessageTarget(doc: Document): any {
  const embed =
    getEmbeddedPdfEl(doc) ||
    (doc.querySelector?.(
      'object[type="application/pdf"],object[type="application/x-google-chrome-pdf"]',
    ) as HTMLObjectElement | null);

  if (embed && typeof (embed as any).postMessage === 'function') return embed as any;

  const iframe = doc.querySelector?.('iframe[type="application/pdf"]') as HTMLIFrameElement | null;
  if (iframe?.contentWindow) return iframe.contentWindow;

  return null;
}

function isPdfViewerOriginAllowed(origin: string, doc: Document): boolean {
  const o = (origin || '').toLowerCase();
  if (!o || o === 'null') return true;
  if (o.startsWith('chrome-extension://')) return true;
  if (o.startsWith('chrome://')) return true;
  if (o.startsWith('chrome-untrusted://')) return true;

  try {
    const pageOrigin = new URL(doc.URL || '').origin.toLowerCase();
    if (pageOrigin && o === pageOrigin) return true;
  } catch {
    // ignore
  }

  return false;
}

function isPdfViewerReplyMessage(data: any, requestId: string): boolean {
  if (!data || typeof data !== 'object') return false;
  if (data.type !== 'getSelectedTextReply') return false;
  if (typeof data.selectedText !== 'string') return false;
  if (data.requestId && data.requestId !== requestId) return false;
  return true;
}

function isGoogleDocsDocument(doc: Document): boolean {
  try {
    const win = doc.defaultView || globalWindowSafe();
    if (win?.location.hostname === 'docs.google.com' && win?.location.pathname.startsWith('/document/d/')) {
      return true;
    }
  } catch {
    // ignore
  }

  try {
    const embedIframe = doc.querySelector('iframe[src^="https://docs.google.com/document/d/"]');
    if (embedIframe) return true;
  } catch {
    // ignore
  }

  return getGoogleDocsEditingIframe(doc) !== null;
}

function isGoogleSheet(doc: Document): boolean {
  const win = doc.defaultView || globalWindowSafe();
  const url = win?.location.href ?? '';
  return /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/[a-zA-Z0-9_-]+/.test(url);
}

function getTopAccessibleDocument(doc: Document): Document {
  try {
    return doc.defaultView?.top?.document ?? doc;
  } catch {
    return doc;
  }
}

function getCandidateDocumentsForSearch(doc: Document): Document[] {
  const docs: Document[] = [doc];
  const topDoc = getTopAccessibleDocument(doc);
  if (topDoc !== doc) docs.push(topDoc);
  return docs;
}

const GOOGLE_DOCS_IFRAME_SELECTOR = '.docs-texteventtarget-iframe';
const GOOGLE_DOCS_CURSOR_SELECTOR = '.kix-cursor';
const GOOGLE_DOCS_COMMENT_SELECTOR = '.docos-replyview-body';
const GOOGLE_DOCS_REPLY_VIEW_SELECTOR = '.docos-replyview';
const GOOGLE_DOCS_COMMENT_AUTHOR_SELECTOR = '.docos-author';
const GOOGLE_DOCS_ZERO_WIDTH_SPACE = '\u200B';
const GOOGLE_DOCS_NON_BREAKING_SPACE = '\xa0';

function getGoogleDocsEditingIframe(doc: Document): HTMLIFrameElement | null {
  for (const d of getCandidateDocumentsForSearch(doc)) {
    const el = d.querySelector<HTMLIFrameElement>(GOOGLE_DOCS_IFRAME_SELECTOR);
    if (el) return el;
  }
  return null;
}

function getGoogleDocsCursorElement(doc: Document): HTMLElement | null {
  for (const d of getCandidateDocumentsForSearch(doc)) {
    const el = d.querySelector<HTMLElement>(GOOGLE_DOCS_CURSOR_SELECTOR);
    if (el) return el;
  }
  return null;
}

function hasGoogleDocsTextSelection(doc: Document): boolean {
  const cursorElement = getGoogleDocsCursorElement(doc);
  if (!cursorElement) return false;

  const view = cursorElement.ownerDocument?.defaultView;
  const display = view?.getComputedStyle(cursorElement).display ?? cursorElement.style.display;
  return display === 'none';
}

function simulateArrowKeyNavigation(doc: Document, moveUpward: boolean): void {
  const iframeElement = getGoogleDocsEditingIframe(doc);
  if (!iframeElement) return;

  const keyName = moveUpward ? 'ArrowUp' : 'ArrowDown';
  const keyCode = moveUpward ? 38 : 40;

  const keyboardEventOptions = {
    key: keyName,
    keyCode: keyCode,
    altKey: true,
    shiftKey: true,
    code: keyName,
    bubbles: true,
    cancelable: true,
  };

  const targetDoc = iframeElement.contentDocument;
  const targetWin = iframeElement.contentWindow;
  if (!targetDoc) return;

  const KeyboardEventCtor = ((targetWin as any)?.KeyboardEvent || KeyboardEvent) as typeof KeyboardEvent;
  targetDoc.dispatchEvent(new KeyboardEventCtor('keydown', keyboardEventOptions as any));
}

function simulateLeftArrowKeyPress(doc: Document): void {
  const iframeElement = getGoogleDocsEditingIframe(doc);
  if (!iframeElement) return;

  const leftArrowEventOptions = {
    key: 'ArrowLeft',
    keyCode: 37,
    code: 'ArrowLeft',
    bubbles: true,
    cancelable: true,
  };

  const targetDoc = iframeElement.contentDocument;
  const targetWin = iframeElement.contentWindow;
  if (!targetDoc) return;

  const KeyboardEventCtor = ((targetWin as any)?.KeyboardEvent || KeyboardEvent) as typeof KeyboardEvent;
  targetDoc.dispatchEvent(new KeyboardEventCtor('keydown', leftArrowEventOptions as any));
}

function simulateSelectAllKeyboardShortcut(doc: Document): void {
  const iframeElement = getGoogleDocsEditingIframe(doc);
  if (!iframeElement) return;

  const platform = typeof navigator !== 'undefined' ? String(navigator.platform || '') : '';
  const isMacOperatingSystem = platform.toUpperCase().indexOf('MAC') >= 0;

  const selectAllEventOptions = {
    key: 'a',
    code: 'KeyA',
    ctrlKey: !isMacOperatingSystem,
    metaKey: isMacOperatingSystem,
    bubbles: true,
    cancelable: true,
  };

  const targetDoc = iframeElement.contentDocument;
  const targetWin = iframeElement.contentWindow;
  if (!targetDoc) return;

  const KeyboardEventCtor = ((targetWin as any)?.KeyboardEvent || KeyboardEvent) as typeof KeyboardEvent;
  targetDoc.dispatchEvent(new KeyboardEventCtor('keydown', selectAllEventOptions as any));
}

function extractSelectedGoogleDocsText(doc: Document): string {
  const iframeElement = getGoogleDocsEditingIframe(doc);
  if (!iframeElement) return '';

  const targetDoc = iframeElement.contentDocument;
  const targetWin = iframeElement.contentWindow;
  const body = targetDoc?.body;

  if (!targetDoc || !body) return '';

  try {
    const ClipboardEventCtor = ((targetWin as any)?.ClipboardEvent || ClipboardEvent) as typeof ClipboardEvent;
    const copyEvent = new ClipboardEventCtor('copy', { bubbles: true, cancelable: true } as any);
    (body.firstChild as any)?.dispatchEvent?.(copyEvent);
    if (!(body.firstChild as any)?.dispatchEvent) {
      body.dispatchEvent(copyEvent);
    }
  } catch {
    // ignore
  }

  const bodyText = body.innerText || body.textContent || '';
  const extractedText = String(bodyText).replace(new RegExp(GOOGLE_DOCS_ZERO_WIDTH_SPACE, 'g'), '');

  return extractedText ?? '';
}

function extractGoogleDocsComments(doc: Document): string {
  let commentsText = '\n\nComments: ';

  const seen = new Set<Element>();
  const allCommentElements: Element[] = [];

  for (const d of getCandidateDocumentsForSearch(doc)) {
    try {
      const els = Array.from(d.querySelectorAll(GOOGLE_DOCS_COMMENT_SELECTOR));
      for (const el of els) {
        if (!seen.has(el)) {
          seen.add(el);
          allCommentElements.push(el);
        }
      }
    } catch {
      // ignore
    }
  }

  const commentElements = allCommentElements.filter(commentElement => commentElement.textContent);

  if (commentElements.length === 0) return '';

  for (const commentElement of commentElements) {
    const replyViewContainer = commentElement.closest(GOOGLE_DOCS_REPLY_VIEW_SELECTOR);
    if (!replyViewContainer) continue;

    const authorElement = replyViewContainer.querySelector(GOOGLE_DOCS_COMMENT_AUTHOR_SELECTOR);
    if (authorElement && authorElement.textContent) {
      commentsText += `\nAuthor: ${authorElement.textContent} `;
    }

    if (commentElement.textContent) {
      commentsText += `Comment: ${commentElement.textContent}\n`;
    }
  }

  return commentsText.trim();
}

function extractGoogleDocumentText(): string {
  const doc = globalDocumentSafe() || document;
  const iframe = getGoogleDocsEditingIframe(doc);
  const iframeDoc = iframe?.contentDocument;
  const iframeWin = iframe?.contentWindow;

  const safeFallback = (): string => {
    const iframeBody = iframeDoc?.body;
    const globalDoc = globalDocumentSafe();
    const fallbackText =
      iframeBody?.innerText ||
      iframeBody?.textContent ||
      '' ||
      globalDoc?.body?.innerText ||
      globalDoc?.body?.textContent ||
      '';

    return (
      String(fallbackText).replace(new RegExp(GOOGLE_DOCS_ZERO_WIDTH_SPACE, 'g'), '') +
      extractGoogleDocsComments(doc)
    );
  };

  try {
    try {
      iframeWin?.focus();
      (iframeDoc?.body as any)?.focus?.();
    } catch {
      // ignore
    }

    simulateSelectAllKeyboardShortcut(doc);

    if (hasGoogleDocsTextSelection(doc)) {
      const selectedText = extractSelectedGoogleDocsText(doc);

      if (selectedText.trim() !== '') {
        const commentsContent = extractGoogleDocsComments(doc).trim();
        return selectedText + commentsContent;
      } else {
        simulateLeftArrowKeyPress(doc);
      }
    }

    let extractedDocumentText = '';

    simulateArrowKeyNavigation(doc, true);

    if (hasGoogleDocsTextSelection(doc)) {
      const upwardSelectedText = extractSelectedGoogleDocsText(doc);
      if (!upwardSelectedText.endsWith('\n\n')) {
        extractedDocumentText += upwardSelectedText.trimEnd();
      }
    }

    simulateArrowKeyNavigation(doc, false);

    if (!hasGoogleDocsTextSelection(doc)) {
      simulateArrowKeyNavigation(doc, false);
    } else {
      const downwardSelectedText = extractSelectedGoogleDocsText(doc);
      if (downwardSelectedText.endsWith(GOOGLE_DOCS_NON_BREAKING_SPACE + '\n')) {
        simulateArrowKeyNavigation(doc, false);
      }
    }

    if (hasGoogleDocsTextSelection(doc)) {
      const finalSelectedText = extractSelectedGoogleDocsText(doc);
      if (finalSelectedText.trim() !== '' && !finalSelectedText.startsWith('\n')) {
        extractedDocumentText += finalSelectedText;
      }
    }

    simulateLeftArrowKeyPress(doc);

    const commentsContent = extractGoogleDocsComments(doc).trim();
    const out = extractedDocumentText.trim() + commentsContent;

    return out.trim() ? out : safeFallback();
  } catch {
    return safeFallback();
  }
}

async function getGoogleSheetContent(doc: Document, pageConfig?: PageConfig): Promise<Partial<PageData>> {
  let clipboardContent = '';
  let error: string | undefined;

  safeFocusForExtraction(doc, doc.defaultView || window);

  const left = timeLeftMs(pageConfig?.deadlineEpochMs);

  try {
    const copyBudget = Math.max(250, Math.min(1500, Math.floor(left * 0.45)));
    const copyR = await withBgSafeTimeout(selectAllAndCopySheetContent(doc), copyBudget, doc);
    const copySuccess = copyR.ok && copyR.value;

    if (!copySuccess) {
      throw new Error('google_sheet_copy_failed');
    }

    const clipLeft = timeLeftMs(pageConfig?.deadlineEpochMs);
    const clipBudget = Math.max(250, Math.min(2500, Math.floor(clipLeft * 0.55)));
    clipboardContent = await readClipboardText(clipBudget, doc);
    if (!clipboardContent.trim()) throw new Error('google_sheet_empty_clipboard');
  } catch (errorObj) {
    error = errorObj instanceof Error ? errorObj.message : String(errorObj);
  }

  return {
    content: clipboardContent,
    contentType: GOOGLE_SHEET_MIME_TYPE,
    error,
  };
}

function safeFocusForExtraction(targetDoc?: Document, targetWin?: Window | null): void {
  try {
    targetWin?.focus?.();
  } catch {
    // ignore
  }
  try {
    (targetDoc?.body as any)?.focus?.();
  } catch {
    // ignore
  }
}

function dispatchKeydownInDoc(targetDoc: Document, init: KeyboardEventInit): void {
  const view = targetDoc.defaultView;
  const KeyboardEventCtor = (view?.KeyboardEvent || KeyboardEvent) as typeof KeyboardEvent;
  const evt = new KeyboardEventCtor('keydown', { bubbles: true, cancelable: true, ...init } as any);

  const active = targetDoc.activeElement as HTMLElement | null;
  const t: EventTarget = active && active.ownerDocument === targetDoc ? active : targetDoc;
  t.dispatchEvent(evt);
}

async function selectAllAndCopySheetContent(doc: Document): Promise<boolean> {
  try {
    safeFocusForExtraction(doc, doc.defaultView || window);

    if (doc.hidden || !doc.hasFocus()) {
      return false;
    }

    dispatchKeydownInDoc(doc, { key: 'Escape', code: 'Escape' });
    await sleepBgSafe(150, doc);

    const gridContainer = (doc.querySelector('.grid-container') || querySelectorDeep(doc, '.grid-container')) as
      | HTMLElement
      | null;

    const dataGrid = (doc.querySelector('.grid4-inner-container:last-child') ||
      querySelectorDeep(doc, '.grid4-inner-container:last-child')) as HTMLElement | null;

    if (dataGrid) {
      try {
        dataGrid.focus();
      } catch {
        // ignore
      }
      await sleepBgSafe(100, doc);
    } else if (gridContainer) {
      try {
        gridContainer.focus?.();
      } catch {
        // ignore
      }
      await sleepBgSafe(80, doc);
    }

    const platform = typeof navigator !== 'undefined' ? String(navigator.platform || '') : '';
    const isMac = platform.toUpperCase().indexOf('MAC') >= 0;

    dispatchKeydownInDoc(doc, {
      key: 'a',
      code: 'KeyA',
      ctrlKey: !isMac,
      metaKey: isMac,
    });
    await sleepBgSafe(200, doc);

    dispatchKeydownInDoc(doc, {
      key: 'c',
      code: 'KeyC',
      ctrlKey: !isMac,
      metaKey: isMac,
    });
    await sleepBgSafe(200, doc);

    try {
      doc.execCommand('copy');
    } catch {
      // ignore
    }

    return true;
  } catch {
    return false;
  }
}

async function readClipboardText(timeoutMs: number, doc: Document): Promise<string> {
  const clamped = Math.max(250, Math.min(5000, Math.floor(timeoutMs)));

  if (navigator?.clipboard?.readText) {
    const res = await withBgSafeTimeout(navigator.clipboard.readText(), clamped, doc);
    if (res.ok) return res.value || '';
  }

  const textarea = doc.createElement('textarea');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  doc.body?.appendChild(textarea);
  textarea.focus();

  try {
    doc.execCommand('paste');
  } catch {
    // ignore
  }

  const value = textarea.value || '';
  textarea.remove();
  return value;
}

function querySelectorDeep(doc: Document, selector: string): Element | null {
  const docs = getCandidateDocumentsForSearch(doc);
  for (const d of docs) {
    try {
      const direct = d.querySelector(selector);
      if (direct) return direct;
    } catch {
      // ignore
    }
  }

  const maxNodes = 25000;
  let visited = 0;

  const pushChildren = (nodes: Element[], root: ParentNode | null | undefined) => {
    if (!root) return;
    const kids = (root as any).children as HTMLCollectionOf<Element> | undefined;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) nodes.push(kids[i]);
  };

  const stack: Element[] = [];
  for (const d of docs) {
    try {
      pushChildren(stack, d.documentElement ?? d.body ?? null);
    } catch {
      // ignore
    }
  }

  while (stack.length && visited < maxNodes) {
    const el = stack.pop()!;
    visited++;

    try {
      if (el.matches(selector)) return el;
    } catch {
      // ignore
    }

    pushChildren(stack, el);

    const sr = (el as any).shadowRoot as ShadowRoot | null | undefined;
    if (sr) pushChildren(stack, sr);

    if (String(el.tagName).toUpperCase() === 'IFRAME') {
      try {
        const f = el as HTMLIFrameElement;
        const fd = f.contentDocument;
        if (fd) pushChildren(stack, fd.documentElement ?? fd.body ?? null);
      } catch {
        // ignore
      }
    }
  }

  return null;
}

async function scrollForDataCollection(
  doc: Document,
  options?: {
    profile?: 'light' | 'aggressive';
    maxSteps?: number;
    amount?: number;
    maxDistancePx?: number;
    delayMs?: number;
    finalWaitMs?: number;
    timeBudgetMs?: number;
  },
): Promise<boolean> {
  const profile = options?.profile ?? 'light';
  const isTabActive = !doc.hidden;

  const timeBudgetMs = Math.max(0, Math.min(options?.timeBudgetMs ?? (profile === 'light' ? 1600 : 2800), 3000));
  if (timeBudgetMs <= 0) return false;

  const start = Date.now();
  const timeLeft = () => timeBudgetMs - (Date.now() - start);

  const perStepDelayBase = options?.delayMs ?? (profile === 'light' ? 220 : 280);
  const finalWaitBase = options?.finalWaitMs ?? (profile === 'light' ? 350 : 900);
  const perStepDelay = isTabActive ? perStepDelayBase : 0;
  const finalWaitMs = isTabActive ? finalWaitBase : 0;
  const explicitStep = options?.amount;
  let maxSteps = options?.maxSteps ?? (profile === 'light' ? 8 : 18);
  let maxDistancePx = options?.maxDistancePx ?? (profile === 'light' ? 12000 : 30000);

  let targetElement: HTMLElement | null = null;
  try {
    const detection = await executeScrollCommand(doc, { action: 'detectPrimary' });
    if (detection?.selector) {
      const el = safeQuerySelector(doc, detection.selector);
      if (el) targetElement = el;
    }

    const metrics = detection?.metrics;
    if (metrics && typeof metrics.scrollHeight === 'number' && typeof metrics.clientHeight === 'number') {
      const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
      maxDistancePx = Math.min(maxDistancePx, maxScroll || maxDistancePx);
      if (maxScroll < 1500) maxSteps = Math.min(maxSteps, 2);
      else if (maxScroll < 4000) maxSteps = Math.min(maxSteps, 4);
      else if (maxScroll < 10000) maxSteps = Math.min(maxSteps, 6);
    }
  } catch {
    // ignore
  }

  if (!targetElement) {
    targetElement = (doc.scrollingElement as HTMLElement | null) || doc.documentElement || (doc.body as HTMLElement);
  }
  if (!targetElement) return false;

  let totalDistance = 0;
  let lastScrollTop: number | null = null;
  let samePosCount = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (timeLeft() <= 0) break;

    let result: any = null;
    try {
      result = await executeScrollCommand(doc, {
        action: 'scrollBy',
        direction: ScrollDirectionEnum.DOWN,
        options: { amount: explicitStep, behavior: 'auto', isTabActive },
      });
    } catch {
      // ignore
    }

    if (!result || !result.success) {
      const win = doc.defaultView || window;
      result = directScrollBy(targetElement, doc, win, ScrollDirectionEnum.DOWN, explicitStep);
      samePosCount = 2;
    }

    if (!result?.success) break;

    const currentTop: number = result.scrollTop ?? lastScrollTop ?? 0;
    if (lastScrollTop !== null) {
      const delta = Math.max(0, currentTop - lastScrollTop);
      totalDistance += delta;
      samePosCount = delta === 0 ? samePosCount + 1 : 0;
    }

    lastScrollTop = currentTop;

    if (result.isAtBottom) break;
    if (samePosCount >= 2) break;
    if (totalDistance >= maxDistancePx) break;

    if (perStepDelay > 0 && step < maxSteps - 1) {
      const d = Math.min(perStepDelay, Math.max(0, timeLeft()));
      if (d <= 0) break;
      await sleepBgSafe(d, doc);
    }
  }

  if (finalWaitMs > 0) {
    const d = Math.min(finalWaitMs, Math.max(0, timeLeft()));
    if (d > 0) await sleepBgSafe(d, doc);
  }

  if (timeLeft() > 80) {
    try {
      const scrollingElement =
        (doc.scrollingElement as HTMLElement | null) ||
        (doc.documentElement as HTMLElement) ||
        (doc.body as HTMLElement);
      const win = doc.defaultView || window;
      const target =
        targetElement === doc.documentElement || targetElement === doc.body || targetElement === scrollingElement
          ? scrollingElement
          : targetElement;
      if (target) {
        const clientHeight =
          target === scrollingElement ? win.innerHeight : (target as HTMLElement).clientHeight || win.innerHeight;
        const maxScroll = Math.max(0, target.scrollHeight - clientHeight);
        target.scrollTop = maxScroll;
      }
    } catch {
      // ignore
    }
  }

  return true;
}

function safeQuerySelector(doc: Document, selector: string): HTMLElement | null {
  try {
    return doc.querySelector(selector) as HTMLElement | null;
  } catch {
    return null;
  }
}

async function executeScrollCommand(doc: Document, command: any): Promise<any> {
  const win = doc.defaultView || window;
  const internalKey = (win as any).__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
  const internal = (win as any)[internalKey];
  const api = internal?.scroll || (win as any).__RTRVR_SCROLL_API__;
  const exec = api?.execute;
  if (typeof exec !== 'function') return null;
  return exec(command);
}

async function flushListenerScan(
  doc: Document,
  options: {
    mode?: 'priority' | 'full';
    totalBudgetMs: number;
    budgetMs: number;
    maxPasses: number;
  },
): Promise<void> {
  const win = doc.defaultView || window;
  const internalKey = (win as any).__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
  const internal = (win as any)[internalKey];
  const flushScan = internal?.flushScan;

  if (typeof flushScan !== 'function') {
    try {
      (win as any).rtrvrAIMarkInteractiveElements?.();
    } catch {
      // ignore
    }
    return;
  }

  const deadlineEpochMs = Date.now() + Math.max(100, Math.floor(options.totalBudgetMs));
  let passes = 0;

  while (passes < options.maxPasses && timeLeftMs(deadlineEpochMs) > 0) {
    const budgetMs = Math.max(50, Math.min(options.budgetMs, timeLeftMs(deadlineEpochMs)));
    try {
      await flushScan({
        mode: options.mode ?? 'full',
        includeShadow: true,
        includeSameOriginIframes: true,
        budgetMs,
        deadlineEpochMs,
      });
    } catch {
      break;
    }

    if (getBusyCount(doc) === 0) break;
    passes++;
  }

  if (getBusyCount(doc) > 0 && timeLeftMs(deadlineEpochMs) > 50) {
    const microBudget = Math.min(120, timeLeftMs(deadlineEpochMs));
    try {
      await flushScan({
        mode: 'priority',
        includeShadow: true,
        includeSameOriginIframes: true,
        budgetMs: microBudget,
        deadlineEpochMs,
      });
    } catch {
      // ignore
    }
  }
}

function getBusyCount(doc: Document): number {
  const html = doc.documentElement;
  if (!html) return 0;
  const raw = html.getAttribute(RTRVR_MAIN_WORLD_BUSY_ATTRIBUTE);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildSheetInfo(doc: Document): PageData['sheetInfo'] | undefined {
  const parsed = parseGoogleSheetUrl(doc.URL || '');
  if (!parsed?.sheetId) return undefined;

  const activeTab = findActiveSheetTab(doc);
  const sheetTab = activeTab?.title || 'Sheet1';

  return {
    sheetId: parsed.sheetId,
    sheetTitle: doc.title || activeTab?.title || undefined,
    sheetTab,
    sheetTabId: parsed.sheetTabId ?? activeTab?.id,
    sheetTabs: undefined,
  };
}

function parseGoogleSheetUrl(urlString: string): { sheetId: string; sheetTabId?: number } | null {
  if (!urlString) return null;

  try {
    const url = new URL(urlString);
    if (url.hostname !== 'docs.google.com') return null;

    const pathParts = url.pathname.split('/');
    const spreadsheetIndex = pathParts.indexOf('spreadsheets');
    const dIndex = pathParts.indexOf('d');

    if (spreadsheetIndex === -1 || dIndex === -1 || dIndex !== spreadsheetIndex + 1 || pathParts.length <= dIndex + 1) {
      return null;
    }

    const sheetId = pathParts[dIndex + 1];
    if (!sheetId || !/^[a-zA-Z0-9_-]+$/.test(sheetId)) {
      return null;
    }

    let sheetTabIdStr: string | undefined = undefined;
    if (url.hash && url.hash.includes('gid=')) {
      const hashParams = new URLSearchParams(url.hash.substring(1));
      sheetTabIdStr = hashParams.get('gid') ?? undefined;
    }
    if (!sheetTabIdStr && url.searchParams.has('gid')) {
      sheetTabIdStr = url.searchParams.get('gid') ?? undefined;
    }

    if (sheetTabIdStr && !/^\\d+$/.test(sheetTabIdStr)) {
      sheetTabIdStr = undefined;
    }

    return {
      sheetId,
      sheetTabId: sheetTabIdStr ? parseInt(sheetTabIdStr, 10) : 0,
    };
  } catch {
    return null;
  }
}

function findActiveSheetTab(doc: Document): { title?: string; id?: number } | null {
  try {
    const tabEl =
      doc.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ||
      doc.querySelector<HTMLElement>('.docs-sheet-tab-active') ||
      doc.querySelector<HTMLElement>('.docs-sheet-tab[aria-selected="true"]');

    if (!tabEl) return null;

    const title = tabEl.getAttribute('aria-label') || tabEl.textContent?.trim() || undefined;
    const idAttr = tabEl.getAttribute('data-sheet-id') || tabEl.getAttribute('data-tab-id') || undefined;
    const id = idAttr && /^\d+$/.test(idAttr) ? Number(idAttr) : undefined;

    return { title, id };
  } catch {
    return null;
  }
}
