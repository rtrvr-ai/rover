// packages/system-tools/lib/get-page-data.ts
import {
  DEFAULT_PAGE_LOAD_DELAY,
  delay,
  fetchUrlToBase64,
  getGoogleSheetPageData,
  HTML_CONTENT_TYPE,
  isCurrentDocumentPdf,
  isSpecialBrowserPage,
  normalizePageConfig,
  parseGoogleSheetUrl,
} from '@rover/shared';
import type { PageConfig, PageData } from '@rover/shared';

/**
 * Configuration constants for page data extraction and content script injection
 */
const PAGE_POLLING_INTERVAL_MS = 500;
const MAX_CONTENT_INJECTION_RETRIES = 2;
const CONTENT_SCRIPT_MESSAGE_RETRIES = 1; // 1 original attempt + 1 retry
const CONTENT_SCRIPT_RETRY_DELAY_MS = 250;
const MAX_POLLING_TIME_MS = 8000; // your 8s cap

/**
 * Document readiness state returned by content script
 */
interface DocumentReadinessState {
  /** Whether the document is fully loaded and ready for interaction */
  ready: boolean;
  /** MIME type of the document content */
  contentType: string;
}

/**
 * Content script execution result for browser interactions
 */
interface ContentScriptExecutionResult {
  success?: boolean;
  error?: string;
  data?: string;
  mimeType?: string;
  /** Whether the action should be executed in main world context */
  actuateInMain?: boolean;
  /** Enhanced element data for main world execution */
  elementData?: {
    framework: string | null;
    listeners: string[];
    pattern: string;
  };
}

/**
 * Creates a standardized timestamp string for logging and debugging
 * @returns Formatted timestamp string in MM/DD/YYYY, HH:MM AM/PM format
 */
export const createTimestamp = (): string =>
  new Date().toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

/**
 * Enhanced message sending to content script with retry logic and error handling
 *
 * This function handles communication with content scripts running in browser tabs.
 * It includes retry logic to handle cases where content scripts may not be immediately
 * ready or may fail due to timing issues.
 *
 * @param tabId - Browser tab ID to send message to
 * @param message - Message payload to send to content script
 * @param retries - Number of retry attempts (default: CONTENT_SCRIPT_MESSAGE_RETRIES)
 * @param delayMs - Delay between retry attempts in milliseconds
 * @returns Promise resolving to content script response
 */
export function sendMessageToContentScript(
  tabId: number,
  message: unknown,
  retries = CONTENT_SCRIPT_MESSAGE_RETRIES,
  delayMs = CONTENT_SCRIPT_RETRY_DELAY_MS,
  timeoutMs = 8000,
  deadlineEpochMs?: number,
) {
  return new Promise((resolve, reject) => {
    const attemptMessageSend = () => {
      let settled = false;
      const timeLeft = () =>
        !deadlineEpochMs || !Number.isFinite(deadlineEpochMs)
          ? Number.POSITIVE_INFINITY
          : Math.max(0, deadlineEpochMs - Date.now());

      // Bound per-attempt timeout by the global deadline (prevents drift/hangs).
      const effectiveTimeoutMs = Math.max(0, Math.min(Math.floor(timeoutMs), Math.floor(timeLeft())));
      if (effectiveTimeoutMs <= 0) {
        reject(new Error(`deadline_exhausted`));
        return;
      }

      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`content_script_timeout:${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      chrome.tabs
        .sendMessage(tabId, message, { frameId: 0 })
        .then(response => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(response);
        })
        .catch(error => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          if (retries <= 0) {
            reject(error);
          } else {
            retries--;
            const d = Math.max(0, Math.min(delayMs, timeLeft()));
            if (d <= 0) reject(new Error(`deadline_exhausted`));
            else setTimeout(attemptMessageSend, d);
          }
        });
    };
    attemptMessageSend();
  });
}

/**
 * Injects both content script and main world scripts into the specified tab
 *
 * The content script handles DOM analysis and basic interactions, while the main world
 * script handles framework-specific interactions that require access to page JavaScript.
 *
 * @param tabId - Browser tab ID where scripts should be injected
 * @throws Error if script injection fails
 */
async function injectContentAndMainWorldScripts(tabId: number): Promise<void> {
  try {
    // Inject content script for DOM interaction and analysis
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      injectImmediately: true,
      files: ['content/all.iife.js'],
    });

    // Inject main world script for framework-aware interactions and stealth mode
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      injectImmediately: true,
      files: ['content-main/all.iife.js'],
      world: 'MAIN',
    });
  } catch (error) {
    console.error('Failed to inject content scripts into tab:', error);
  }
}

/**
 * Retrieves page data from content script without injecting new scripts
 *
 * @param tabId - Browser tab ID to get page data from
 * @param pageConfig - Optional configuration for page extraction
 * @returns Promise resolving to WebPage object with extracted data
 */
export async function getPageDataFromContentScript({
  tabId,
  pageConfig,
}: {
  tabId: number;
  pageConfig?: PageConfig;
}): Promise<PageData> {
  try {
    return (await sendMessageToContentScript(
      tabId,
      { type: 'getPageData', pageConfig },
      undefined,
      undefined,
      pageConfig?.pageDataTimeoutMs ?? 8000,
      pageConfig?.deadlineEpochMs, // ✅ NEW
    )) as PageData;
  } catch (e) {
    // ✅ Don’t throw; return minimal data so agent can continue.
    const msg = e instanceof Error ? e.message : String(e);
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {}
    return { url: tab?.url || tab?.pendingUrl || '', title: tab?.title || '', content: '', error: msg } as any;
  }
}

/**
 * Extracts content from PDF documents using specialized PDF content script
 *
 * @param tabId - Browser tab ID containing the PDF document
 * @returns Promise resolving to WebPage object with PDF text content
 */
export async function getPdfContentFromDocument(tabId: number): Promise<PageData> {
  return (await sendMessageToContentScript(tabId, { type: 'getPdfContent' })) as PageData;
}

async function pollForDocumentReadiness(
  tabId: number,
  pageLoadDelayMs: number,
  deadlineEpochMs?: number,
): Promise<{ ready: boolean; contentType: string }> {
  // Initial wait once, to let the page start loading
  if (pageLoadDelayMs > 0) {
    // Bound initial delay by deadline too
    const left =
      !deadlineEpochMs || !Number.isFinite(deadlineEpochMs)
        ? pageLoadDelayMs
        : Math.max(0, deadlineEpochMs - Date.now());
    if (left > 0) await delay(Math.min(pageLoadDelayMs, left));
  }

  let documentContentType = HTML_CONTENT_TYPE;
  let injectionAttempts = 0;

  const deadline = Date.now() + MAX_POLLING_TIME_MS;
  const hardDeadline =
    deadlineEpochMs && Number.isFinite(deadlineEpochMs) ? Math.min(deadlineEpochMs, deadline) : deadline;

  while (Date.now() < hardDeadline) {
    try {
      const timeRemaining = hardDeadline - Date.now();
      if (timeRemaining <= 0) break;
      const documentState = (await sendMessageToContentScript(
        tabId,
        {
          type: 'documentReady',
        },
        undefined,
        undefined,
        Math.min(1200, timeRemaining),
        hardDeadline,
      )) as DocumentReadinessState;

      documentContentType = documentState.contentType;

      if (documentState?.ready) {
        return { ready: true, contentType: documentContentType };
      }

      // Not ready yet, wait a bit before polling again
      const tr = hardDeadline - Date.now();
      if (tr <= 0) break;
      await delay(Math.min(PAGE_POLLING_INTERVAL_MS, tr));
    } catch (error) {
      // Content script not yet injected or failed
      injectionAttempts++;
      if (injectionAttempts > MAX_CONTENT_INJECTION_RETRIES) {
        console.error('Max content script injection attempts exceeded:', error);
        return { ready: false, contentType: documentContentType };
      }

      // If we’re out of time, don’t inject again.
      const tr = hardDeadline - Date.now();
      if (tr <= 150) return { ready: false, contentType: documentContentType };

      await injectContentAndMainWorldScripts(tabId);

      const tr2 = hardDeadline - Date.now();
      if (tr2 <= 0) break;
      await delay(Math.min(PAGE_POLLING_INTERVAL_MS, tr2));
    }
  }

  return { ready: false, contentType: HTML_CONTENT_TYPE };
}

export class TabDeletedError extends Error {
  constructor(tabId: number) {
    super(`Tab ${tabId} has been deleted`);
    this.name = 'TabDeletedError';
  }
}

/**
 * Main entry point for page data extraction with content script injection and readiness checking
 *
 * This function orchestrates the complete process of:
 * 1. Waiting for page load
 * 2. Checking for restricted pages
 * 3. Injecting content scripts if needed
 * 4. Waiting for document readiness
 * 5. Extracting page data
 * 6. Detecting and enriching Google Sheets data
 *
 * @param tabId - Browser tab ID to extract data from
 * @param pageConfig - Optional configuration for page extraction
 * @returns Promise resolving to WebPage object with extracted content
 */
export async function injectContentScriptAndExtractPageData(
  tabId: number,
  getAuthToken: () => Promise<string>,
  pageConfig?: PageConfig,
): Promise<PageData> {
  let tabInfo: chrome.tabs.Tab | undefined;
  const normalizedPageConfig = normalizePageConfig(pageConfig);
  const pageLoadDelayMs = normalizedPageConfig?.pageLoadDelay ?? DEFAULT_PAGE_LOAD_DELAY;

  try {
    tabInfo = await chrome.tabs.get(tabId);
  } catch (error) {
    // Tab no longer exists - throw specific error
    console.error(`Tab ${tabId} no longer exists:`, error);
    throw new TabDeletedError(tabId);
  }

  const url = tabInfo?.url || tabInfo?.pendingUrl;
  const title = tabInfo?.title ?? '';

  if (!url || isSpecialBrowserPage(url)) {
    return {
      url: url || '',
      title: title || 'Restricted Browser Page',
      content: '',
    } as PageData;
  }

  // Google Sheets detection, etc...
  const sheetUrlData = parseGoogleSheetUrl(url);
  if (sheetUrlData) {
    const sheetPageData = await getGoogleSheetPageData({
      url,
      title,
      sheetId: sheetUrlData.sheetId,
      sheetTabId: sheetUrlData.sheetTabId,
      getAuthToken,
    });

    if (sheetPageData.sheetInfo) {
      return sheetPageData;
    }
  }

  // Single end-to-end budget for the entire function (prevents “8s + 9s = 17s”)
  const totalBudgetMs = Math.max(1500, normalizedPageConfig?.totalBudgetMs ?? 9000);

  const callerDeadline = Number(normalizedPageConfig?.deadlineEpochMs);
  const computedDeadline = Date.now() + totalBudgetMs;

  // Use caller deadline if valid and in the future; otherwise compute one.
  const deadlineEpochMs =
    Number.isFinite(callerDeadline) && callerDeadline > Date.now()
      ? Math.min(callerDeadline, computedDeadline) // keep it bounded
      : computedDeadline;

  // ===== Poll for readiness bounded by the same end-to-end deadline =====
  const { ready, contentType } = await pollForDocumentReadiness(tabId, pageLoadDelayMs, deadlineEpochMs);

  let documentContentType = contentType;

  if (isCurrentDocumentPdf(documentContentType)) {
    setupPdfTextExtractionProtocols();
    try {
      await ensurePdfRuntimeInjected(tabId);
    } catch {}
  }

  if (!ready) {
    // You can choose: either bail out with minimal data, or still try to extract
    // something via getPageDataFromContentScript and accept it might be partial.
    console.warn(`Document not fully ready for tab ${tabId} within polling window`);
  }

  const updatedPageConfig: PageConfig = {
    ...normalizedPageConfig,
    includeCrossOriginIframes: normalizedPageConfig?.includeCrossOriginIframes ?? true,
    deadlineEpochMs,
    pageDataTimeoutMs: Math.min(normalizedPageConfig?.pageDataTimeoutMs ?? totalBudgetMs, totalBudgetMs),
  };

  const extractedPageData = await getPageDataFromContentScript({
    tabId,
    pageConfig: updatedPageConfig,
  });

  return extractedPageData;
}

async function ensurePdfRuntimeInjected(tabId: number, frameIds?: number[]): Promise<void> {
  const target: chrome.scripting.InjectionTarget = frameIds?.length ? { tabId, frameIds } : { tabId, allFrames: true };

  // Verify presence first (cheap)
  try {
    const probe = await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      injectImmediately: true,
      func: () => typeof (window as any).rtrvrAIGetPdfText === 'function',
    });

    if ((probe || []).some(r => r?.result === true)) return;
  } catch {
    // If probe fails (some frames), still attempt injection below.
  }

  await chrome.scripting.executeScript({
    target,
    injectImmediately: true,
    files: ['content-runtime/all.iife.js'],
    world: 'MAIN',
  });
}

/**
 * Sets up communication protocols for PDF text extraction
 *
 * This function establishes message listeners for PDF-specific functionality,
 * including text selection and blob retrieval from embedded PDF viewers.
 *
 * @param tabId - Browser tab ID containing the PDF
 */
let pdfProtocolsInitialized = false;

const setupPdfTextExtractionProtocols = (): void => {
  if (pdfProtocolsInitialized) return;
  pdfProtocolsInitialized = true;

  chrome.runtime.onMessage.addListener(async (message, sender) => {
    const tabId = sender.tab?.id;
    if (!tabId) return;

    // TEXT SELECTION
    if (message?.type === 'getTextFromPdfViewer') {
      const requestId = message.requestId;
      const budgetMsRaw = Number(message.budgetMs);
      const budgetMs = Number.isFinite(budgetMsRaw) ? Math.floor(budgetMsRaw) : undefined;
      const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;

      try {
        // First attempt: call without injecting (fast path)
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          injectImmediately: true,
          world: 'MAIN',
          func: (rid?: string, ms?: number) => {
            const fn = (window as any).rtrvrAIGetPdfText;
            if (typeof fn === 'function') {
              fn(rid, ms);
              return true;
            }
            return false;
          },
          args: [requestId, budgetMs],
        });

        const invoked = (results || []).some(r => r?.result === true);

        if (!invoked) {
          // Slow path: inject once, then call again
          await ensurePdfRuntimeInjected(tabId, [frameId]);

          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            injectImmediately: true,
            world: 'MAIN',
            func: (rid?: string, ms?: number) => (window as any).rtrvrAIGetPdfText?.(rid, ms),
            args: [requestId, budgetMs],
          });
        }

        // If still nothing, last resort: allFrames (handles cases where embed is in a different frame than sender)
        if (!invoked) {
          await ensurePdfRuntimeInjected(tabId);
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            injectImmediately: true,
            world: 'MAIN',
            func: (rid?: string, ms?: number) => (window as any).rtrvrAIGetPdfText?.(rid, ms),
            args: [requestId, budgetMs],
          });
        }
      } catch (error) {
        console.error('PDF text extraction error:', error);
      }
    }

    // BLOB RETRIEVAL
    if (message?.type === 'getLocalPdfBlob') {
      if (!tabId) {
        console.warn('getLocalPdfBlob: missing sender tab id');
        return;
      }
      try {
        // Hard timeout for blob fetch
        const controller = new AbortController();
        const budgetMsRaw = Number(message.budgetMs);
        const budgetMs = Number.isFinite(budgetMsRaw) ? Math.floor(budgetMsRaw) : 6000;
        // Keep a floor so we don't abort immediately for tiny budgets.
        const abortMs = Math.max(300, Math.min(6000, budgetMs - 150));
        const to = setTimeout(() => controller.abort(), abortMs);

        const { data } = await fetchUrlToBase64(message.url, { signal: controller.signal } as any);
        clearTimeout(to);

        void sendMessageToContentScript(tabId, {
          type: 'getLocalPdfBlobReply',
          requestId: message.requestId,
          data,
        }).catch(() => {});
      } catch (error) {
        console.error('PDF blob fetch error:', error);
        void sendMessageToContentScript(tabId, {
          type: 'getLocalPdfBlobReply',
          requestId: message.requestId,
          data: '',
        }).catch(() => {});
      }
    }
  });
};

/**
 * Default WebPage structure for cases where page data cannot be extracted
 */
export const DEFAULT_WEBPAGE_FALLBACK = {
  url: '',
  title: '',
  contentType: HTML_CONTENT_TYPE,
};
