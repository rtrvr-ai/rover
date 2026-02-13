// packages/system-tools/lib/execute-system-tools.ts
import {
  addTabToAgenticGroup,
  delay,
  fetchFileForUploadSmart,
  globalIdToFrameId,
  GOOGLE_URL,
  handleTabForUrl,
  normalizeAndValidate,
  normalizeDescribeImageIds,
  putUploadBytes,
  removeTabFromAgenticGroup,
  sendMessage,
  SYSTEM_TOOLS_ELEMENT_ID_KEYS,
  SystemToolNames,
  systemToolNamesSet,
} from '@rover/shared';
import type {
  CloseTabArgs,
  DescribeImagesArgs,
  GoogleSearchArgs,
  GotoUrlArgs,
  OpenNewTabArgs,
  SwitchTabArgs,
  SystemToolArgs,
  UploadFileArgs,
} from './types.js';
import type { FunctionCall } from '@google/genai';
import {
  ExtensionLLMFunction,
  LLMFunction,
  TabGroupManager,
  TabManagementFunctions,
  UploadFilePayload,
} from '@rover/shared';
import { fetchToBase64FromBackground, mapWithConcurrency } from './image-utils.js';

/**
 * Delay between consecutive system tool actions to prevent overwhelming the browser
 * and allow for proper DOM updates and event propagation
 */
const CONSECUTIVE_ACTION_DELAY_MS = 1000;

// keep small to minimize latency + avoid token/store entirely
const INLINE_MAX_BYTES = 1024 * 1024; // 1MB raw (~1.33MB base64)

/**
 * Tools that conceptually change *which page* we're on in this tab.
 * After one of these succeeds, we:
 *  - Mark the batch as "navigationOccurred"
 *  - Skip any subsequent DOM tools in the same batch with a clear error
 *  Note: we aren't considering open_new_tab as navigation occured since it's new tab
 */
const NAVIGATION_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.goto_url,
  SystemToolNames.google_search,
  SystemToolNames.go_back,
  SystemToolNames.go_forward,
  SystemToolNames.refresh_page,
  SystemToolNames.switch_tab,
  SystemToolNames.close_tab,
]);

// --- NEW ---
export type OpenedTabSummary = {
  tabId: number;
  tabUrl?: string;
  tabTitle?: string;
  openerTabId?: number; // who opened it (useful for ordering)
};

export interface SystemToolBatchResult {
  results: LLMFunction[];
  disableAutoScroll: boolean;
  navigationOccurred: boolean;
  navigationTool?: SystemToolNames;
  newTabId?: number; // NEW: Tab ID to switch to (virtual switch, no focus change)
  openedTabs?: OpenedTabSummary[]; // NEW
  closedTabIds?: number[]; // NEW
}

function collectNumericIdsFromArgs(args: any): number[] {
  if (!args || typeof args !== 'object') return [];
  const out: number[] = [];

  for (const k of SYSTEM_TOOLS_ELEMENT_ID_KEYS) {
    const v = (args as any)[k];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'string' && /^\d+$/.test(v.trim())) out.push(parseInt(v.trim(), 10));
    else if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
        else if (typeof x === 'string' && /^\d+$/.test(x.trim())) out.push(parseInt(x.trim(), 10));
      }
    }
  }

  // normalize
  return Array.from(new Set(out.map(n => Math.trunc(Number(n))).filter(n => Number.isFinite(n) && n > 0)));
}

function inferFrameIdForCall(call: FunctionCall): number | undefined {
  const ids = collectNumericIdsFromArgs(call.args || {});
  if (ids.length === 0) return undefined;

  const frames = Array.from(new Set(ids.map(id => globalIdToFrameId(id))));
  if (frames.length === 1) return frames[0];

  // Multi-frame tool calls aren’t supported here. describe_images is handled separately.
  return undefined;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) {
    bin += String.fromCharCode(...u8.subarray(i, i + step));
  }
  return btoa(bin);
}

/**
 * Executes a sequence of system tool function calls on a specified browser tab.
 *
 * Important behavioral guarantees:
 *  - Navigation tools are treated as batch boundaries:
 *      * After a successful navigation, remaining tools are NOT executed.
 *      * Instead, they are returned as failures with an explanation so the agent
 *        can re-plan with fresh page data.
 *  - Tools that explicitly scroll (scroll_page, scroll_to_element) set
 *    disableAutoScroll = true for the *next* page snapshot, unless a navigation
 *    also happened in this batch (in which case we reset it).
 */
export async function executeSystemToolCallsSequentially({
  tabId,
  tabIndex,
  calls,
  tabManagement,
  tabGroupManager,
}: {
  tabId: number;
  tabIndex: number;
  calls: FunctionCall[];
  tabManagement?: TabManagementFunctions;
  tabGroupManager?: TabGroupManager;
}): Promise<SystemToolBatchResult> {
  const executionResults: LLMFunction[] = [];

  let disableAutoScroll = false;
  let navigationOccurred = false;
  let navigationTool: SystemToolNames | undefined;
  let newTabId: number | undefined; // NEW: Track virtual tab switch
  const openedTabs: OpenedTabSummary[] = [];
  const closedTabIds: number[] = [];

  for (const currentCall of calls) {
    let callOutcome: LLMFunction['response'] = { status: 'Success' };
    let executionSuccessful = true;
    const callArguments = currentCall.args || {};

    // If a scroll tool runs in this batch (without navigation), we should *not*
    // auto-scroll on the following snapshot.
    if (currentCall.name === SystemToolNames.scroll_page || currentCall.name === SystemToolNames.scroll_to_element) {
      disableAutoScroll = true;
    }

    // If a navigation tool has already run in this batch, everything else must
    // be skipped so the agent can re-plan against the new page.
    if (navigationOccurred) {
      callOutcome = {
        status: 'Failure',
        error: `Tool '${currentCall.name}' was skipped because navigation tool '${navigationTool}' already ran in this batch. Re-plan this action using the new page state.`,
        allowFallback: true,
      };

      // Still normalize tab_id back to logical index for consistency
      convertChromeTabIdToLogicalIndex(currentCall, tabIndex);

      executionResults.push({
        name: currentCall.name!,
        args: currentCall.args!,
        response: callOutcome,
      });

      continue;
    }

    try {
      switch (currentCall.name as SystemToolNames) {
        // ============================================
        // NEW: VIRTUAL SWITCH_TAB HANDLING
        // ============================================
        case SystemToolNames.switch_tab: {
          const targetTabId = Number((callArguments as any as SwitchTabArgs)?.tab_id);

          if (!Number.isFinite(targetTabId)) {
            executionSuccessful = false;
            callOutcome = {
              status: 'Failure',
              error: 'switch_tab: missing/invalid tab_id',
              allowFallback: true,
            };
            break;
          }

          // Validate the target tab exists without switching focus
          try {
            const targetTab = await chrome.tabs.get(targetTabId);

            if (!targetTab) {
              executionSuccessful = false;
              callOutcome = {
                status: 'Failure',
                error: `switch_tab: Tab ${targetTabId} does not exist`,
                allowFallback: true,
              };
              break;
            }

            // SUCCESS: Virtual switch - update internal reference only
            newTabId = targetTabId;
            // Mark as navigation since we're now operating on a different page
            navigationOccurred = true;
            navigationTool = SystemToolNames.switch_tab;

            // New tab context means we want fresh auto-scroll behavior
            disableAutoScroll = false;
          } catch (tabError: any) {
            executionSuccessful = false;
            callOutcome = {
              status: 'Failure',
              error: `switch_tab: Failed to access tab ${targetTabId} - ${tabError?.message || 'Tab not found'}`,
              allowFallback: true,
            };
          }
          break;
        }

        // ============================================
        // NAVIGATION TOOLS
        // ============================================
        case SystemToolNames.goto_url: {
          const urlNavigationResult = await handleUrlNavigation(tabId, callArguments as unknown as GotoUrlArgs);
          if (!urlNavigationResult.success) {
            executionSuccessful = false;
            callOutcome = { status: 'Failure', error: urlNavigationResult.error };
          }
          break;
        }

        case SystemToolNames.google_search: {
          const searchResult = await handleGoogleSearch(tabId, callArguments as unknown as GoogleSearchArgs);
          if (!searchResult.success) {
            executionSuccessful = false;
            callOutcome = { status: 'Failure', error: searchResult.error };
          }
          break;
        }

        case SystemToolNames.open_new_tab: {
          const tabOpenResult = await handleOpenNewTab(
            callArguments as unknown as OpenNewTabArgs,
            tabManagement,
            tabGroupManager,
          );
          if (!tabOpenResult.success) {
            executionSuccessful = false;
            callOutcome = { status: 'Failure', error: tabOpenResult.error };
          }

          const createdId = Number(tabOpenResult.output?.tabId);
          if (Number.isFinite(createdId)) {
            openedTabs.push({
              tabId: createdId,
              tabUrl: tabOpenResult.output?.tabUrl,
              tabTitle: tabOpenResult.output?.tabTitle,
              openerTabId: tabId,
            });

            // best-effort: add to management + group
            try {
              const createdTab = await chrome.tabs.get(createdId);
              tabManagement?.addTab?.(createdTab);
              tabManagement?.trackNewTabId?.(createdId);
              if (tabGroupManager?.agenticTabGroupIds) {
                await addTabToAgenticGroup(createdTab, tabGroupManager.agenticTabGroupIds);
              }
            } catch {}
          }

          break;
        }

        case SystemToolNames.close_tab: {
          const target = Number((callArguments as any as CloseTabArgs)?.tab_id);
          if (!Number.isFinite(target)) {
            executionSuccessful = false;
            callOutcome = { status: 'Failure', error: 'close_tab: missing/invalid tab_id', allowFallback: true };
            break;
          }
          const r = await handleTabClose(target, tabGroupManager);
          if (!r.success) {
            executionSuccessful = false;
            callOutcome = { status: 'Failure', error: r.error, allowFallback: true };
          } else {
            closedTabIds.push(target);
          }
          break;
        }

        case SystemToolNames.describe_images: {
          const args = callArguments as unknown as DescribeImagesArgs;

          const elementIds = normalizeDescribeImageIds(args);
          if (elementIds.length === 0) {
            executionSuccessful = false;
            callOutcome = { status: 'Failure', error: 'describe_images: element_ids is empty', allowFallback: false };
            break;
          }

          // Group by frameId
          const groups = new Map<number, number[]>();
          for (const id of elementIds) {
            const frameId = globalIdToFrameId(id);
            const arr = groups.get(frameId) ?? [];
            arr.push(id);
            groups.set(frameId, arr);
          }

          const allCandidates: any[] = [];
          const allErrors: string[] = [];

          // Execute per-frame: content script returns {srcUrl, contextUrl} candidates
          for (const [frameId, ids] of groups.entries()) {
            const subCall: FunctionCall = {
              name: SystemToolNames.describe_images,
              args: { ...args, element_ids: ids },
            };

            const { response } = await handleBrowserInteraction(
              tabId,
              tabIndex,
              subCall,
              subCall.args as unknown as SystemToolArgs,
              { frameId },
            );

            if (response.status !== 'Success') {
              allErrors.push(`frame=${frameId}: ${response.error || 'describe_images failed'}`);
              continue;
            }

            const imgs = response.output?.images;
            const errs = response.output?.errors;
            if (Array.isArray(imgs)) allCandidates.push(...imgs);
            if (Array.isArray(errs)) allErrors.push(...errs);
          }

          // Now: background fetch + hydrate into base64 images
          const hydratedImages: any[] = [];
          const fetchErrors: string[] = [];

          // Dedup fetches by (referrer + url) so repeated ids don't refetch.
          const fetchCache = new Map<string, Promise<{ data: string; mimeType: string }>>();

          // Normalize candidates
          const candidates = allCandidates.filter(Boolean);

          const results = await mapWithConcurrency(candidates, async cand => {
            const element_id = Number(cand.element_id);
            const displayName = cand.displayName || `[img] [id=${element_id}]`;

            // If content script already inlined (data/blob), keep it.
            if (cand.data && cand.mimeType) {
              return {
                ok: true,
                image: {
                  element_id,
                  data: cand.data,
                  mimeType: cand.mimeType,
                  displayName,
                  method: cand.method || 'inline',
                  srcUrl: cand.srcUrl ?? null,
                },
              };
            }

            const srcUrl = String(cand.srcUrl || '').trim();
            if (!srcUrl) {
              return { ok: false, err: `id=${element_id}: missing srcUrl` };
            }

            // blob: cannot be fetched from background (usually). Fail clearly.
            if (srcUrl.startsWith('blob:')) {
              return {
                ok: false,
                err: `id=${element_id}: blob: URL cannot be fetched from background (needs inline in content script)`,
              };
            }

            // data: could be passed inline already, but handle anyway
            if (srcUrl.startsWith('data:')) {
              // best effort parse; otherwise let it error
              const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(srcUrl);
              if (!m) return { ok: false, err: `id=${element_id}: invalid data URL` };
              const mimeType = (m[1] || 'application/octet-stream').trim();
              const isB64 = !!m[2];
              const payload = m[3] || '';
              const data = isB64 ? payload : btoa(unescape(encodeURIComponent(decodeURIComponent(payload))));
              return { ok: true, image: { element_id, data, mimeType, displayName, method: 'data_url', srcUrl } };
            }

            const referrer = cand.contextUrl ? String(cand.contextUrl) : null;
            const key = `${referrer || ''}::${srcUrl}`;

            if (!fetchCache.has(key)) {
              // Small retry helps with transient failures
              fetchCache.set(
                key,
                (async () => {
                  let lastErr: any;
                  for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                      return await fetchToBase64FromBackground(srcUrl, referrer);
                    } catch (e) {
                      lastErr = e;
                    }
                  }
                  throw lastErr;
                })(),
              );
            }

            try {
              const { data, mimeType } = await fetchCache.get(key)!;
              return {
                ok: true,
                image: {
                  element_id,
                  data,
                  mimeType,
                  displayName,
                  method: 'bg_fetch',
                  srcUrl,
                },
              };
            } catch (e: any) {
              return { ok: false, err: `id=${element_id}: bg fetch failed: ${e?.message || String(e)}` };
            }
          });

          for (const r of results) {
            if (r.ok) hydratedImages.push(r.image);
            else if (r.err) fetchErrors.push(r.err);
          }

          const finalErrors = [...allErrors, ...fetchErrors];

          if (hydratedImages.length === 0) {
            executionSuccessful = false;
            callOutcome = {
              status: 'Failure',
              error: finalErrors[0] || 'describe_images: no images fetched',
              output: { images: [], errors: finalErrors.length ? finalErrors : undefined },
            };
          } else {
            callOutcome = {
              status: 'Success',
              output: { images: hydratedImages, errors: finalErrors.length ? finalErrors : undefined },
            };
          }

          break;
        }

        // inside executeSystemToolCallsSequentially switch
        case SystemToolNames.upload_file: {
          const { file_index, file_url, file_name } = callArguments as any as UploadFileArgs;

          if (!file_url?.trim()) {
            callOutcome = { status: 'Failure', error: `Invalid file_index ${file_index}: no such cloud file` };
            executionSuccessful = false;
            break;
          }

          let payload: UploadFilePayload | undefined;

          try {
            const tab = await chrome.tabs.get(tabId);
            const referrer = tab?.url ?? tab?.pendingUrl ?? null;

            const dl = await fetchFileForUploadSmart(tabId, file_url, referrer);

            if (dl.bytes.byteLength <= INLINE_MAX_BYTES) {
              payload = {
                kind: 'upload_file',
                inlineB64: arrayBufferToBase64(dl.bytes),
                byteLength: dl.bytes.byteLength,
                mimeType: dl.mimeType,
                fileName: file_name || dl.fileName,
              };
            } else {
              const { token, byteLength, durable } = await putUploadBytes(dl.bytes, dl.mimeType);
              payload = {
                kind: 'upload_file',
                token,
                byteLength,
                mimeType: dl.mimeType,
                fileName: file_name || dl.fileName,
                durable,
              };
            }
          } catch {
            payload = undefined; // content script will try URL fetch
          }

          const { response } = await handleBrowserInteraction(
            tabId,
            tabIndex,
            currentCall,
            callArguments as unknown as SystemToolArgs,
            { payload },
          );

          callOutcome = response;
          executionSuccessful = response.status === 'Success';
          break;
        }

        // ============================================
        // BROWSER INTERACTION TOOLS (via content script)
        // ============================================
        case SystemToolNames.go_back:
        case SystemToolNames.go_forward:
        case SystemToolNames.click_element:
        case SystemToolNames.type_into_element:
        case SystemToolNames.select_dropdown_value:
        case SystemToolNames.type_and_enter:
        case SystemToolNames.scroll_page:
        case SystemToolNames.wait_action:
        case SystemToolNames.hover_element:
        case SystemToolNames.right_click_element:
        case SystemToolNames.double_click_element:
        case SystemToolNames.focus_element:
        case SystemToolNames.clear_element:
        case SystemToolNames.scroll_to_element:
        case SystemToolNames.long_press_element:
        case SystemToolNames.copy_text:
        case SystemToolNames.paste_text:
        case SystemToolNames.press_key:
        case SystemToolNames.wait_for_element:
        case SystemToolNames.refresh_page:
        case SystemToolNames.adjust_slider:
        case SystemToolNames.check_field_validity:
        case SystemToolNames.select_text:
        case SystemToolNames.mouse_wheel:
        case SystemToolNames.drag_element:
        case SystemToolNames.drag_and_drop:
        case SystemToolNames.swipe_element:
        case SystemToolNames.pinch_zoom: {
          const { response } = await handleBrowserInteraction(
            tabId,
            tabIndex,
            currentCall,
            callArguments as unknown as SystemToolArgs,
          );

          callOutcome = response;
          executionSuccessful = response.status === 'Success';
          break;
        }

        default:
          executionSuccessful = false;
          callOutcome = {
            status: 'Failure',
            error: `Unknown system tool encountered: ${currentCall.name}`,
          };
          break;
      }
    } catch (error: any) {
      executionSuccessful = false;
      callOutcome = {
        status: 'Failure',
        error: error?.message || 'Unknown execution error occurred',
      };
    }

    // If a navigation tool ran successfully, mark the batch as navigated.
    if (
      currentCall.name !== SystemToolNames.switch_tab &&
      NAVIGATION_TOOLS.has(currentCall.name as SystemToolNames) &&
      executionSuccessful
    ) {
      navigationOccurred = true;
      navigationTool = currentCall.name as SystemToolNames;

      // New page means we *do* want auto-scroll again unless caller overrides.
      disableAutoScroll = false;
    }

    // Convert actual Chrome tab ID back to logical index for LLM consistency
    convertChromeTabIdToLogicalIndex(currentCall, tabIndex);

    executionResults.push({
      name: currentCall.name!,
      args: currentCall.args!,
      response: callOutcome,
    });

    // Add delay between multiple system tool calls to prevent browser overwhelm
    if (calls.length > 1) {
      await delay(CONSECUTIVE_ACTION_DELAY_MS);
    }
  }

  return {
    results: executionResults,
    disableAutoScroll,
    navigationOccurred,
    navigationTool,
    newTabId, // NEW: Return the switched tab ID
    openedTabs: openedTabs.length ? openedTabs : undefined,
    closedTabIds: closedTabIds.length ? closedTabIds : undefined,
  };
}

/**
 * Handles URL navigation with validation
 */
async function handleUrlNavigation(tabId: number, args: GotoUrlArgs): Promise<ExtensionLLMFunction['response']> {
  const { url, error } = normalizeAndValidate(args.url);
  if (url) {
    await chrome.tabs.update(tabId, { url });
    return { success: true };
  } else {
    return { success: false, error: `Invalid URL provided. ${error}` };
  }
}

/**
 * Handles Google search with query validation
 */
async function handleGoogleSearch(tabId: number, args: GoogleSearchArgs): Promise<ExtensionLLMFunction['response']> {
  const query = args.query;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return { success: false, error: 'Invalid or empty search query provided.' };
  }

  const googleSearchUrl = `${GOOGLE_URL}/search?q=${encodeURIComponent(query)}`;
  const { url, error } = normalizeAndValidate(googleSearchUrl);

  if (url) {
    await chrome.tabs.update(tabId, { url });
    return { success: true };
  } else {
    return { success: false, error: `Failed to generate valid Google search URL. ${error}` };
  }
}

/**
 * Handles open new tab closure
 */
async function handleOpenNewTab(
  args: OpenNewTabArgs,
  tabManagement?: TabManagementFunctions,
  tabGroupManager?: TabGroupManager,
): Promise<ExtensionLLMFunction['response']> {
  const { url, error } = normalizeAndValidate(args.url);
  if (url) {
    const { tab } = await handleTabForUrl(url, {
      makeActive: !(tabManagement?.openTabsInBackground ?? false),
      reuseExisting: false,
      agenticTabGroupIds: tabGroupManager?.agenticTabGroupIds,
    });

    // best-effort: ensure tab is tracked + grouped
    if (tab?.id) {
      tabManagement?.addTab?.(tab);
      tabManagement?.trackNewTabId?.(tab.id);
      if (tabGroupManager?.agenticTabGroupIds) {
        await addTabToAgenticGroup(tab, tabGroupManager.agenticTabGroupIds);
      }
    }

    return { success: true, output: { tabId: tab.id, tabUrl: tab.url ?? tab.pendingUrl, tabTitle: tab.title } };
  } else {
    return { success: false, error: `Invalid URL provided. ${error}` };
  }
}

/**
 * Handles tab closure
 */
async function handleTabClose(
  tabId: number,
  tabGroupManager?: TabGroupManager,
): Promise<ExtensionLLMFunction['response']> {
  // Ungroup first and then remove
  await removeTabFromAgenticGroup(tabId, tabGroupManager?.agenticTabGroupIds);
  await chrome.tabs.remove(tabId);
  return { success: true };
}

/**
 * Handles browser interaction tools that require content script communication
 * These tools may escalate to main world execution if content script reports the need
 */
async function handleBrowserInteraction(
  tabId: number,
  tabIndex: number,
  call: FunctionCall,
  args: SystemToolArgs,
  opts?: { frameId?: number; payload?: UploadFilePayload }, // ✅ payload added
): Promise<{ response: LLMFunction['response'] }> {
  const contentScriptMessage = {
    type: 'action',
    call,
    payload: opts?.payload, // ✅
  } as { type: 'action'; call: FunctionCall; forceContent?: boolean };

  const inferred = opts?.frameId ?? inferFrameIdForCall(call);
  const raw = (await sendMessage(tabId, contentScriptMessage, inferred)) as ExtensionLLMFunction['response'];

  // Normalize content-script result into LLMFunction['response'] shape
  let response: LLMFunction['response'];

  if (!raw) {
    response = { status: 'Failure', error: 'Empty tool response from content script', allowFallback: true };
    return { response };
  }

  // If raw has status, treat it as already-normalized
  if (typeof raw === 'object' && raw !== null && 'success' in raw) {
    response = {
      status: raw.success ? 'Success' : 'Failure',
      error: raw.error,
      allowFallback: raw.allowFallback,
      output: raw.output, // ✅ CRITICAL
    } as any;

    return { response };
  }

  response = { status: 'Failure', error: 'Unexpected tool response shape from content script', allowFallback: true };
  return { response };
}

/**
 * Converts Chrome's actual tab ID back to logical index for LLM consistency
 *
 * System tools use logical tab indices (0, 1, 2...) but Chrome uses actual tab IDs.
 * This function converts back to logical indices after execution for consistent
 * logging and LLM understanding.
 *
 * @param call - Function call object to modify in place
 * @param logicalTabIndex - The logical index to set (0, 1, 2...)
 */
export function convertChromeTabIdToLogicalIndex(call: FunctionCall, logicalTabIndex: number): void {
  // Only convert for known system tools that use tab_id parameter
  if (systemToolNamesSet.has(call.name!)) {
    if (call.args && typeof (call.args as any).tab_id === 'number') {
      // Replace actual Chrome tab ID with logical index for LLM consistency
      (call.args as any).tab_id = logicalTabIndex;
    }
  }
}
