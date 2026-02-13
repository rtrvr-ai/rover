// packages/agent-utilities/lib/tabGroupManager.ts

import { AGENTIC_TAB_GROUP_COLOR, AGENTIC_TAB_GROUP_TITLE } from '../utils/constants.js';
import { TabData } from '../types/index.js';

/**
 * Group agentic tabs by window (port from old extension)
 */
export async function groupAgenticTabs(
  combinedTabInfo: Record<number, TabData>,
  maybeAgenticTabGroupIds?: Map<number, number>,
): Promise<Map<number, number>> {
  const agenticTabGroupIds: Map<number, number> = maybeAgenticTabGroupIds || new Map();
  const isOuterMostCall = maybeAgenticTabGroupIds === undefined;
  const tabOrder = Object.keys(combinedTabInfo).map(Number);

  if (isOuterMostCall) {
    const groupCreationPromises: Promise<void>[] = [];
    if (combinedTabInfo && Object.keys(combinedTabInfo).length > 0) {
      const tabsByWindow: Map<number, number[]> = new Map();

      for (const [tabIdStr, tabData] of Object.entries(combinedTabInfo)) {
        const tabId = parseInt(tabIdStr, 10);
        if (tabData.windowId !== undefined) {
          if (!tabsByWindow.has(tabData.windowId)) {
            tabsByWindow.set(tabData.windowId, []);
          }
          tabsByWindow.get(tabData.windowId)!.push(tabId);
        } else {
          console.warn(
            `Agentic Tabs: Tab ID ${tabId} is missing windowId. It will not be included in a window-specific group.`,
          );
        }
      }

      for (const [windowId, tabIdsInWindow] of tabsByWindow.entries()) {
        if (tabIdsInWindow.length > 0) {
          groupCreationPromises.push(
            (async () => {
              try {
                const groupOptions: chrome.tabs.GroupOptions = {
                  createProperties: { windowId },
                  tabIds: tabIdsInWindow,
                };
                const groupId = await chrome.tabs.group(groupOptions);
                const resp = await chrome.tabGroups.update(groupId, {
                  title: AGENTIC_TAB_GROUP_TITLE,
                  color: AGENTIC_TAB_GROUP_COLOR,
                });
                agenticTabGroupIds.set(windowId, groupId);
              } catch (error) {
                console.warn(`Agentic Tabs: Failed to create/update tab group for window ${windowId}:`, error);
              }
            })(),
          );
        }
      }
    }
    await Promise.all(groupCreationPromises);
  } else if (!isOuterMostCall && agenticTabGroupIds.size > 0 && tabOrder.length > 0) {
    // Inner call - add tabs to existing groups
    const addingPromises = tabOrder.map(async tabId => {
      const tabData = combinedTabInfo[tabId];
      if (tabData?.windowId !== undefined && agenticTabGroupIds.has(tabData.windowId)) {
        const groupId = agenticTabGroupIds.get(tabData.windowId)!;
        try {
          await chrome.tabs.group({ groupId, tabIds: [tabId] });
        } catch (error) {
          console.warn(`Agentic Tabs: Failed to add tab ${tabId} to group ${groupId}:`, error);
        }
      } else if (tabData?.windowId !== undefined && !agenticTabGroupIds.has(tabData.windowId)) {
        // Create new tab group for new window
        try {
          const windowId = tabData.windowId;
          const groupOptions: chrome.tabs.GroupOptions = {
            createProperties: { windowId },
            tabIds: [tabId],
          };
          const groupId = await chrome.tabs.group(groupOptions);
          await chrome.tabGroups.update(groupId, {
            title: AGENTIC_TAB_GROUP_TITLE,
            color: AGENTIC_TAB_GROUP_COLOR,
          });
          agenticTabGroupIds.set(windowId, groupId);
        } catch (error) {
          console.warn(`Agentic Tabs: Failed to add tab ${tabId} to new window ${tabData.windowId}:`, error);
        }
      }
    });
    await Promise.all(addingPromises);
  }
  return agenticTabGroupIds;
}

/**
 * Delete all agentic tab groups
 */
export async function deleteAgenticTabGroups(agenticTabGroupIds: Map<number, number>): Promise<void> {
  const ungroupingPromises = Array.from(agenticTabGroupIds.values()).map(async groupId => {
    try {
      const tabsInGroup = await chrome.tabs.query({ groupId });
      const tabIdsToUngroup = tabsInGroup.map(t => t.id).filter((id): id is number => id !== undefined);
      if (tabIdsToUngroup.length > 0) {
        await chrome.tabs.ungroup(tabIdsToUngroup);
      }
    } catch (error) {
      console.warn(`Agentic Tabs: Failed to remove tab group ${groupId}:`, error);
    }
  });
  await Promise.all(ungroupingPromises).catch(error =>
    console.warn('Agentic Tabs: Error during final ungrouping:', error),
  );
}

/**
 * Add a single tab to the appropriate agentic group
 */
export async function addTabToAgenticGroup(
  tab: chrome.tabs.Tab,
  agenticTabGroupIds: Map<number, number>,
): Promise<void> {
  if (!tab.id || tab.windowId === undefined) return;

  try {
    let groupId = agenticTabGroupIds.get(tab.windowId);

    if (!groupId) {
      // Create a new group for this window
      const groupOptions: chrome.tabs.GroupOptions = {
        createProperties: { windowId: tab.windowId },
        tabIds: [tab.id],
      };
      groupId = await chrome.tabs.group(groupOptions);
      await chrome.tabGroups.update(groupId, {
        title: AGENTIC_TAB_GROUP_TITLE,
        color: AGENTIC_TAB_GROUP_COLOR,
      });
      agenticTabGroupIds.set(tab.windowId, groupId);
    } else {
      // Add to existing group
      await chrome.tabs.group({ groupId, tabIds: [tab.id] });
    }
  } catch (error) {
    console.warn(`[TabGroupManager] Failed to add tab ${tab.id} to group:`, error);
  }
}

/**
 * Remove a specific tab from its agentic tab group
 * If the group becomes empty after removal, it will be automatically deleted by Chrome
 */
export async function removeTabFromAgenticGroup(
  tabId: number,
  agenticTabGroupIds?: Map<number, number>,
): Promise<void> {
  try {
    // Get the tab to check if it's in a group
    const tab = await chrome.tabs.get(tabId);

    if (tab.groupId === undefined || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // Tab is not in any group
      return;
    }

    // Check if this is an agentic group (optional validation)
    if (agenticTabGroupIds) {
      const isAgenticGroup = Array.from(agenticTabGroupIds.values()).includes(tab.groupId);
      if (!isAgenticGroup) {
        // Tab is not in an agentic group, skip
        return;
      }
    } else {
      // If no map provided, verify by checking group title
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group.title !== AGENTIC_TAB_GROUP_TITLE) {
          return;
        }
      } catch {
        // Group doesn't exist
        return;
      }
    }

    // Ungroup the specific tab
    await chrome.tabs.ungroup(tabId);

    // Clean up the map if provided and group is now empty
    if (agenticTabGroupIds && tab.windowId !== undefined) {
      const groupId = agenticTabGroupIds.get(tab.windowId);
      if (groupId) {
        try {
          const remainingTabs = await chrome.tabs.query({ groupId });
          if (remainingTabs.length === 0) {
            agenticTabGroupIds.delete(tab.windowId);
          }
        } catch {
          // Group was auto-deleted, clean up map
          agenticTabGroupIds.delete(tab.windowId);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('No tab with id')) {
      console.warn(`[TabGroupManager] Tab ${tabId} no longer exists`);
    } else {
      console.warn(`[TabGroupManager] Failed to remove tab ${tabId} from group:`, error);
    }
  }
}

// Function to remove all agentic tab groups
export async function removeAgenticTabGroups() {
  try {
    const agenticGroups = await chrome.tabGroups.query({ title: AGENTIC_TAB_GROUP_TITLE });
    if (agenticGroups.length === 0) {
      return;
    }

    for (const group of agenticGroups) {
      try {
        const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
        const tabIdsToUngroup = tabsInGroup.map(t => t.id).filter((id): id is number => id !== undefined);

        if (tabIdsToUngroup.length > 0) {
          await chrome.tabs.ungroup(tabIdsToUngroup);
        }
      } catch (ungroupError) {
        if (
          ungroupError instanceof Error &&
          (ungroupError.message.includes('No tab group with id') ||
            ungroupError.message.includes('Invalid tab id') ||
            ungroupError.message.includes('No window with id'))
        ) {
          console.warn(`Agentic Tab Group ID ${group.id} or its tabs likely already removed:`, ungroupError.message);
        } else {
          console.warn(`Error ungrouping tabs for group ID ${group.id}:`, ungroupError);
        }
      }
    }
  } catch (error) {
    console.error('Error querying or removing Agentic Tab Groups:', error);
  }
}

export const constructAgenticTabGroups = async (tabs: chrome.tabs.Tab[]): Promise<Map<number, number>> => {
  // Initialize tab group manager at the top level
  const tabsForGrouping: Record<number, TabData> = {};
  tabs.forEach(tab => {
    if (tab.id) {
      tabsForGrouping[tab.id] = {
        url: tab.url || '',
        title: tab.title || '',
        windowId: tab.windowId,
      } as TabData;
    }
  });
  return await groupAgenticTabs(tabsForGrouping);
};
