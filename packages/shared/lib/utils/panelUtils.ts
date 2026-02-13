import type { Task } from '../types/index.js';

export async function sendToSidePanelWithRetries(message: any, retries = 10, delayMs = 300): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(message);

      // Check if we got a valid response
      if (response !== undefined) {
        return response;
      }
    } catch (error) {
      console.log(`[sendToSidePanelWithRetries] Attempt ${attempt} failed:`, error);
    }

    // Wait before retrying (except on last attempt)
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Failed to send message to sidepanel after ${retries} attempts`);
}

export async function showConfirmationDialog(currentWindowId: number, currentActiveTabId: number, task: Task) {
  try {
    chrome.sidePanel.getOptions({ tabId: currentActiveTabId }, async options => {
      await chrome.sidePanel.setOptions({ enabled: true, tabId: currentActiveTabId });
      chrome.sidePanel.open({ windowId: currentWindowId });
      sendToSidePanelWithRetries({ type: 'sidePanelReady' })
        .then(response => {
          if (response && (response as { ready: boolean }).ready) {
            // Send task details to the side panel for confirmation
            chrome.runtime.sendMessage({
              type: 'MCP_TASK_CONFIRMATION',
              task: {
                id: task.id,
                action: task.action,
                params: task.params,
                createdAt: task.createdAt,
              },
            });
          }
        })
        .catch(error => {
          console.error('Side panel not ready or error:', error);
        });
    });
  } catch (error) {
    console.error('Error opening side panel:', error);
  }
}
