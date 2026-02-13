import { TabGroupManager, TabHandlingResult, TabManagementFunctions } from '../types/agent-types.js';
import { addTabToAgenticGroup } from './tab-group-manager.js';

/**
 * Helper function to open Google documents in new tabs (or focus existing ones)
 * Uses handleTabForUrl with reuseExisting=true to avoid duplicates and properly manage tab groups
 */
export async function openDocumentInNewTab(
  url: string,
  tabManagement: TabManagementFunctions,
  documentType: 'sheet' | 'doc' | 'slides' | 'webpage' | 'pdf' = 'sheet',
  tabGroupManager?: TabGroupManager,
  opts?: { purpose?: 'artifact' | 'execution' }, // ✅ NEW
): Promise<chrome.tabs.Tab | null> {
  if (!url) return null;

  try {
    const purpose = opts?.purpose ?? 'artifact';
    const makeActive = !tabManagement.openTabsInBackground; // ✅ shortcut: active, scheduled: background

    const { tab, isNewTab } = await handleTabForUrl(url, {
      makeActive,
      reuseExisting: true,
      agenticTabGroupIds: tabGroupManager?.agenticTabGroupIds,
    });

    if (!tab) return null;

    tabManagement.addTab(tab);

    // Track created tab IDs (for cleanup)
    if (isNewTab && tab.id) {
      tabManagement.trackNewTabId?.(tab.id);

      // ✅ If this is a user-facing artifact and caller wants them kept open, preserve it
      if (purpose === 'artifact' && tabManagement.keepArtifactsOpen) {
        tabManagement.trackArtifactTabId?.(tab.id);
      }
    }

    return tab;
  } catch (error) {
    console.error(`[ToolExecutor] Failed to open ${documentType}:`, error);
  }

  return null;
}

/**
 * Extract document ID from Google Sheets/Docs URLs
 */
function extractGoogleDocId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Match patterns for Google Sheets and Docs
    // Format: /spreadsheets/d/{ID}/ or /document/d/{ID}/
    const patterns = [
      /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
      /\/document\/d\/([a-zA-Z0-9-_]+)/,
      /\/presentation\/d\/([a-zA-Z0-9-_]+)/,
      /\/forms\/d\/([a-zA-Z0-9-_]+)/,
    ];

    for (const pattern of patterns) {
      const match = urlObj.pathname.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (error) {
    // Invalid URL
  }

  return null;
}

/**
 * Check if URL is a Google Workspace URL (Sheets, Docs, etc)
 */
function isGoogleWorkspaceUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'docs.google.com' || urlObj.hostname === 'drive.google.com';
  } catch {
    return false;
  }
}

interface HandleTabOptions {
  makeActive?: boolean;
  reuseExisting?: boolean;
  agenticTabGroupIds?: Map<number, number>;
}

/**
 * Find an existing tab with the given URL
 * Returns the tab if found, undefined otherwise
 */
async function findExistingTabForUrl(url: string): Promise<chrome.tabs.Tab | undefined> {
  try {
    // Normalize URL by adding protocol if missing
    let normalizedUrl = url.trim();

    // Check if URL has no protocol
    if (!normalizedUrl.match(/^[a-zA-Z]+:\/\//)) {
      // Check for protocol-relative URLs
      if (normalizedUrl.startsWith('//')) {
        normalizedUrl = 'https:' + normalizedUrl;
      } else {
        // Add https:// as default protocol
        normalizedUrl = 'https://' + normalizedUrl;
      }
    }

    // Validate the URL after normalization
    try {
      new URL(normalizedUrl);
    } catch (urlError) {
      console.error(`[findExistingTabForUrl] Invalid URL after normalization: ${normalizedUrl}`, urlError);
      // Try with original URL as fallback
      normalizedUrl = url;
    }

    const targetUrl = normalizedUrl;

    // Special handling for Google Workspace URLs
    if (isGoogleWorkspaceUrl(targetUrl)) {
      const docId = extractGoogleDocId(targetUrl);

      if (docId) {
        // Search for any tab containing this document ID
        const allTabs = await chrome.tabs.query({});

        for (const tab of allTabs) {
          if (tab.url && extractGoogleDocId(tab.url) === docId) {
            // console.log(`[handleTabForUrl] Found existing Google doc tab with ID ${docId}`);

            // Check if tab is discarded
            if (tab.discarded && tab.id) {
              try {
                await chrome.tabs.reload(tab.id);
                await new Promise(resolve => setTimeout(resolve, 500));
                const refreshedTab = await chrome.tabs.get(tab.id);

                // Navigate to the specific URL if different (to preserve query params)
                if (refreshedTab.url !== targetUrl && refreshedTab.id) {
                  await chrome.tabs.update(refreshedTab.id, { url: targetUrl });
                  // Wait for navigation
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }

                return refreshedTab;
              } catch (error) {
                console.error(`[findExistingTabForUrl] Failed to reload discarded tab ${tab.id}:`, error);
                // Return undefined to create new tab
                return undefined;
              }
            } else if (tab.id) {
              // Tab exists and is not discarded
              // Navigate to the specific URL if different (to preserve query params)
              if (tab.url !== targetUrl) {
                await chrome.tabs.update(tab.id, { url: targetUrl });
                // Wait for navigation
                await new Promise(resolve => setTimeout(resolve, 1000));
                // Get updated tab info
                const updatedTab = await chrome.tabs.get(tab.id);
                return updatedTab;
              }

              // Same URL, just return the existing tab
              return tab;
            }
          }
        }
      }
    }

    // Helper function to compare URLs flexibly
    const urlsMatch = (url1: string, url2: string): boolean => {
      try {
        // Normalize both URLs for comparison
        const normalize = (urlStr: string): string => {
          // Add protocol if missing
          let normalized = urlStr.trim();
          if (!normalized.match(/^[a-zA-Z]+:\/\//)) {
            normalized = normalized.startsWith('//') ? 'https:' + normalized : 'https://' + normalized;
          }

          try {
            const parsed = new URL(normalized);
            // Remove trailing slashes from path for comparison
            let normalizedPath = parsed.pathname.replace(/\/+$/, '');
            if (normalizedPath === '') normalizedPath = '/';
            // Remove default ports
            const host =
              parsed.port &&
              ((parsed.protocol === 'http:' && parsed.port === '80') ||
                (parsed.protocol === 'https:' && parsed.port === '443'))
                ? parsed.hostname
                : parsed.host;
            return `${parsed.protocol}//${host}${normalizedPath}${parsed.search}${parsed.hash}`;
          } catch {
            return urlStr.toLowerCase();
          }
        };

        return normalize(url1) === normalize(url2);
      } catch {
        return false;
      }
    };

    // First try to find existing tab with this URL
    let existingTab: chrome.tabs.Tab | undefined;

    try {
      // Try multiple query strategies
      const queryStrategies = [
        targetUrl, // Try normalized URL first
        url, // Try original URL
      ];

      // Also create pattern variations for query
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        try {
          const urlObj = new URL(targetUrl);
          // Add wildcard pattern for subdomain matching
          queryStrategies.push(`*://${urlObj.hostname}${urlObj.pathname}${urlObj.search}`);
          queryStrategies.push(`*://*.${urlObj.hostname}${urlObj.pathname}${urlObj.search}`);
        } catch {
          // Ignore pattern creation errors
        }
      }

      // Try each query strategy
      for (const queryUrl of queryStrategies) {
        try {
          const existingTabs = await chrome.tabs.query({ url: queryUrl });
          if (existingTabs.length > 0 && existingTabs[0]) {
            existingTab = existingTabs[0];
            break;
          }
        } catch (queryError) {
          // This specific query pattern failed, try next
          console.debug(`[findExistingTabForUrl] Query pattern failed for ${queryUrl}:`, queryError);
        }
      }

      // If no match found with patterns, do manual search
      if (!existingTab) {
        console.debug(`[findExistingTabForUrl] Pattern queries failed for ${targetUrl}, using manual search`);

        // Fallback: Query all tabs and find matching URL manually
        const allTabs = await chrome.tabs.query({});

        for (const tab of allTabs) {
          if (tab.url && urlsMatch(tab.url, targetUrl)) {
            existingTab = tab;
            break;
          }
        }
      }
    } catch (error) {
      // If all query attempts fail, return undefined
      console.warn(`[findExistingTabForUrl] All query attempts failed for ${targetUrl}:`, error);
      return undefined;
    }

    // If we found an existing tab, handle it
    if (existingTab) {
      // Check if tab is discarded and needs reload
      if (existingTab.discarded && existingTab.id) {
        try {
          await chrome.tabs.reload(existingTab.id);
          // Wait a bit for reload to start
          await new Promise(resolve => setTimeout(resolve, 500));

          // Get the refreshed tab state
          const refreshedTab = await chrome.tabs.get(existingTab.id);
          return refreshedTab;
        } catch (error) {
          console.error(`[findExistingTabForUrl] Failed to reload discarded tab ${existingTab.id}:`, error);
          return undefined;
        }
      }

      return existingTab;
    }

    return undefined;
  } catch (error) {
    console.error(`[findExistingTabForUrl] Error finding tab for ${url}:`, error);
    return undefined;
  }
}

/**
 * Helper function to handle tab opening efficiently
 * By default creates a new tab. Set reuseExisting to true to check for existing tabs first.
 * Automatically adds tabs to agentic groups if agenticTabGroupIds is provided
 */
export async function handleTabForUrl(
  url: string,
  { makeActive, agenticTabGroupIds, reuseExisting }: HandleTabOptions,
): Promise<TabHandlingResult> {
  try {
    // Normalize URL by adding protocol if missing
    let normalizedUrl = url.trim();

    // Check if URL has no protocol
    if (!normalizedUrl.match(/^[a-zA-Z]+:\/\//)) {
      // Check for protocol-relative URLs
      if (normalizedUrl.startsWith('//')) {
        normalizedUrl = 'https:' + normalizedUrl;
      } else {
        // Add https:// as default protocol
        normalizedUrl = 'https://' + normalizedUrl;
      }
    }

    // Validate the URL after normalization
    try {
      new URL(normalizedUrl);
    } catch (urlError) {
      console.error(`[handleTabForUrl] Invalid URL after normalization: ${normalizedUrl}`, urlError);
      // Try with original URL as fallback
      normalizedUrl = url;
    }

    // Use normalized URL for all operations
    const targetUrl = normalizedUrl;

    // Only check for existing tabs if reuseExisting is true
    if (reuseExisting) {
      const existingTab = await findExistingTabForUrl(targetUrl);

      if (existingTab && existingTab.id) {
        // Add to agentic group if needed
        if (agenticTabGroupIds && existingTab.windowId !== undefined) {
          await addTabToAgenticGroup(existingTab, agenticTabGroupIds);
        }

        return {
          tab: existingTab,
          isNewTab: false,
          inputUrl: url,
        };
      }
    }

    // No existing tab found or reuseExisting is false - create a new one
    const newTab = await chrome.tabs.create({
      url: targetUrl,
      active: makeActive,
    });

    // Wait for tab to be fully created and have a window ID
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get the tab with full info including windowId
    const tabWithInfo = newTab.id ? await chrome.tabs.get(newTab.id) : newTab;

    // Add new tab to agentic group if agenticTabGroupIds is provided
    if (agenticTabGroupIds && tabWithInfo.windowId !== undefined) {
      await addTabToAgenticGroup(tabWithInfo, agenticTabGroupIds);
    }

    return {
      tab: tabWithInfo,
      isNewTab: true,
      inputUrl: url,
    };
  } catch (error) {
    console.error(`[handleTabForUrl] Error handling tab for ${url}:`, error);
    throw error;
  }
}
