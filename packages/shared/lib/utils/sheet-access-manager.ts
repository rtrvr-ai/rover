// packages/shared/lib/utils/sheet-access-manager.ts
import { parseGoogleSheetUrl } from './workflowUtils.js';
import { RTRVR_WEBSITE } from '../firebase/config.js';
import type { ExecutionState, ExportToSheetStatus } from '../types/workflow-types.js';
import { AuthManager } from '../firebase/auth-manager.js';

export interface DriveAccessResult {
  success: boolean;
  userCancelled?: boolean;
  missedSheetIds?: Set<string>;
}

export interface SheetAccessOptions {
  tabs: chrome.tabs.Tab[];
  setExportToSheetStatus?: (status: ExportToSheetStatus) => void;
  executionRef?: React.MutableRefObject<{ state: ExecutionState; userInputs: string[] }>;
}

const DRIVE_PICKER_MAX_RETRIES = 3;
const DRIVE_PICKER_MESSAGE_INTERVAL = 100;
const DRIVE_PICKER_INIT_TIMEOUT = 30000;

// Default status for consistency
const DEFAULT_EXPORT_TO_SHEET_STATUS: ExportToSheetStatus = {
  status: 'executing',
  message: '',
  callingFunction: 'Sheet Access',
};

export function openPermissionsInfoPopup(): void {
  chrome.tabs.create({
    url: chrome.runtime.getURL('info-popup/index.html?type=permissions'),
    active: true,
  });
}

/**
 * Check if we have API access to a specific Google Sheet
 */
async function checkSheetAccess(sheetId: string, authToken: string): Promise<boolean> {
  if (!sheetId || !authToken) return false;

  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    return response.ok;
  } catch (error) {
    console.error(`Error checking sheet access for ${sheetId}:`, error);
    return false;
  }
}

/**
 * Extract sheet IDs and build a map of sheet ID to tab info
 */
export function extractSheetInfoFromTabs(tabs: chrome.tabs.Tab[]): {
  sheetIds: Set<string>;
  sheetIdToTab: Map<string, chrome.tabs.Tab>;
} {
  const sheetIds = new Set<string>();
  const sheetIdToTab = new Map<string, chrome.tabs.Tab>();

  tabs.forEach(tab => {
    if (!tab.url) return;

    const sheetInfo = parseGoogleSheetUrl(tab.url);
    if (sheetInfo?.sheetId) {
      sheetIds.add(sheetInfo.sheetId);
      sheetIdToTab.set(sheetInfo.sheetId, tab);
    }
  });

  return { sheetIds, sheetIdToTab };
}

/**
 * Get a user-friendly title for a sheet
 */
function getSheetTitle(sheetId: string, sheetIdToTab: Map<string, chrome.tabs.Tab>): string {
  const tab = sheetIdToTab.get(sheetId);
  if (tab?.title) {
    return tab.title;
  }
  return `Sheet ID starting with ${sheetId.substring(0, 8)}`;
}

/**
 * Open drive picker and wait for user selection
 */
async function requestDriveAccessPicker(
  targetSheetIds: Set<string>,
  attempt: number,
  setExportToSheetStatus?: (status: ExportToSheetStatus) => void,
  executionRef?: React.MutableRefObject<{ state: ExecutionState; userInputs: string[] }>,
  authToken?: string,
  sheetIdToTab?: Map<string, chrome.tabs.Tab>,
): Promise<DriveAccessResult> {
  return new Promise((resolve, reject) => {
    let drivePickerWindow: Window | null = null;
    let messageListener: ((event: MessageEvent) => void) | null = null;
    let windowCloseCheckInterval: number | null = null;
    let cancellationCheckInterval: number | null = null;

    try {
      // Build the picker URL
      const pickerUrl = new URL(`${RTRVR_WEBSITE}/drive-picker`);
      pickerUrl.searchParams.set('multiselect', 'true');
      pickerUrl.searchParams.set('sheetIds', Array.from(targetSheetIds).join(','));
      pickerUrl.searchParams.set('t', Date.now().toString());

      // Add OAuth token if available
      if (authToken) {
        pickerUrl.searchParams.set('token', authToken);
      }

      // Open the picker window
      drivePickerWindow = window.open(
        pickerUrl.toString(),
        'GoogleDrivePicker',
        'width=800,height=600,left=200,top=100',
      );

      if (!drivePickerWindow) {
        return reject(new Error('Failed to open Drive Picker window. Pop-ups might be blocked.'));
      }

      // Message handler
      messageListener = (event: MessageEvent) => {
        if (event.origin !== RTRVR_WEBSITE) return;

        // Handle different message types from the picker
        if (event.data?.type === 'SHEETS_SELECTED' && event.data.sheets) {
          const selectedIds = new Set(event.data.sheets.map((s: any) => s.id));
          const missedIds = new Set<string>();

          for (const targetId of targetSheetIds) {
            if (!selectedIds.has(targetId)) {
              missedIds.add(targetId);
            }
          }

          cleanup();

          if (missedIds.size === 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, missedSheetIds: missedIds });
          }
        } else if (event.data?.type === 'SHEETS_SELECTION_CANCELLED' || event.data?.action === 'cancel') {
          cleanup();
          resolve({ success: false, userCancelled: true });
        } else if (event.data?.type === 'PICKER_ERROR' || event.data?.action === 'error') {
          cleanup();
          reject(new Error(event.data.message || 'Unknown picker error'));
        }
        // Handle legacy format from picker
        else if (event.data?.action === 'picked' && Array.isArray(event.data.docs)) {
          const selectedDocs = event.data.docs;

          if (selectedDocs.length === 0) {
            cleanup();
            resolve({ success: false, userCancelled: true });
            return;
          }

          const selectedIds = new Set(selectedDocs.map((doc: any) => doc.id));
          const missedIds = new Set<string>();

          for (const targetId of targetSheetIds) {
            if (!selectedIds.has(targetId)) {
              missedIds.add(targetId);
            }
          }

          cleanup();

          if (missedIds.size === 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, missedSheetIds: missedIds });
          }
        }
      };

      window.addEventListener('message', messageListener);

      // Check for cancellation
      if (executionRef) {
        cancellationCheckInterval = window.setInterval(() => {
          if (executionRef.current.state === 'cancelled') {
            cleanup();
            if (drivePickerWindow && !drivePickerWindow.closed) {
              drivePickerWindow.close();
            }

            if (setExportToSheetStatus) {
              setExportToSheetStatus({
                ...DEFAULT_EXPORT_TO_SHEET_STATUS,
                status: 'cancelled',
                message: 'Sheet access request cancelled.',
                callingFunction: 'Sheet Access',
              });
            }
            resolve({ success: false, userCancelled: true });
          }
        }, 100);
      }

      // Check if window is closed
      windowCloseCheckInterval = window.setInterval(() => {
        if (drivePickerWindow && drivePickerWindow.closed) {
          cleanup();
          resolve({ success: false, userCancelled: true });
        }
      }, 500);

      // Timeout
      const timeout = setTimeout(() => {
        cleanup();
        if (drivePickerWindow && !drivePickerWindow.closed) {
          drivePickerWindow.close();
        }
        reject(new Error('Timed out waiting for Drive Picker to initialize'));
      }, DRIVE_PICKER_INIT_TIMEOUT);

      function cleanup() {
        if (messageListener) {
          window.removeEventListener('message', messageListener);
          messageListener = null;
        }
        if (cancellationCheckInterval !== null) {
          clearInterval(cancellationCheckInterval);
          cancellationCheckInterval = null;
        }
        if (windowCloseCheckInterval !== null) {
          clearInterval(windowCloseCheckInterval);
          windowCloseCheckInterval = null;
        }
        clearTimeout(timeout);
        drivePickerWindow = null;
      }
    } catch (error) {
      if (messageListener) {
        window.removeEventListener('message', messageListener);
      }
      if (cancellationCheckInterval !== null) {
        clearInterval(cancellationCheckInterval);
      }
      if (windowCloseCheckInterval !== null) {
        clearInterval(windowCloseCheckInterval);
      }
      reject(error);
    }
  });
}

/**
 * Main function to ensure Google Sheet access for all sheets in tabs
 */
export async function ensureGoogleSheetAccess(options: SheetAccessOptions): Promise<boolean> {
  const { tabs, setExportToSheetStatus, executionRef } = options;

  // Extract sheet IDs and mapping from tabs
  const { sheetIds: requiredSheetIds, sheetIdToTab } = extractSheetInfoFromTabs(tabs);

  if (requiredSheetIds.size === 0) {
    return true; // No sheets to check
  }

  // Update status - Step 1: Verify existing access
  let userGuidanceMessage = `Verifying access to ${requiredSheetIds.size} Google Sheet(s)...`;
  if (setExportToSheetStatus) {
    setExportToSheetStatus({
      ...DEFAULT_EXPORT_TO_SHEET_STATUS,
      message: userGuidanceMessage,
    });
  }

  try {
    // Get auth token
    const authManager = new AuthManager();
    const authToken = await authManager.getOAuthToken();

    // Check which sheets need access
    const sheetsNeedingAccess = new Set<string>();

    if (authToken) {
      // Only attempt API checks if token exists
      const checkPromises = Array.from(requiredSheetIds).map(sheetId =>
        checkSheetAccess(sheetId, authToken).catch(() => false),
      );
      const checkResults = await Promise.all(checkPromises);

      Array.from(requiredSheetIds).forEach((sheetId, index) => {
        if (!checkResults[index]) {
          sheetsNeedingAccess.add(sheetId);
        }
      });
    } else {
      // No auth token, assume all sheets need picker access
      requiredSheetIds.forEach(id => sheetsNeedingAccess.add(id));
    }

    // If all sheets have access, we're done
    if (sheetsNeedingAccess.size === 0) {
      userGuidanceMessage = 'All required Google Sheets already have API access.';
      if (setExportToSheetStatus) {
        setExportToSheetStatus({
          ...DEFAULT_EXPORT_TO_SHEET_STATUS,
          message: userGuidanceMessage,
        });
      }
      return true;
    }

    // Request access for sheets that need it
    let missingSheetIds = new Set(sheetsNeedingAccess);
    let success = false;

    for (let attempt = 1; attempt <= DRIVE_PICKER_MAX_RETRIES; attempt++) {
      const numMissing = missingSheetIds.size;

      // Build user-friendly message with sheet titles
      const missingTitles = Array.from(missingSheetIds)
        .map(id => getSheetTitle(id, sheetIdToTab))
        .slice(0, 3); // Show max 3 examples

      const singular = numMissing === 1;
      const sheetReference = singular ? `the Google Sheet "${missingTitles[0]}"` : `${numMissing} Google Sheet(s)`;

      const exampleTitle = !singular && missingTitles.length > 0 ? ` (e.g., "${missingTitles[0]}")` : '';

      // Construct guidance message based on attempt
      if (attempt === 1) {
        userGuidanceMessage = `Action Required: Please select ${sheetReference}${exampleTitle} in the window that just opened to grant access. Close extension and retry if drive picker isn't loading.`;
      } else {
        userGuidanceMessage = `Retry Needed: Please select the remaining ${sheetReference}${exampleTitle} you missed in the picker window.`;
      }

      userGuidanceMessage += ` (Attempt ${attempt}/${DRIVE_PICKER_MAX_RETRIES})`;

      if (setExportToSheetStatus) {
        setExportToSheetStatus({
          ...DEFAULT_EXPORT_TO_SHEET_STATUS,
          status: 'executing', // Keep as 'executing' instead of 'waiting_input'
          message: userGuidanceMessage,
          thought: 'Waiting for sheet selection in Drive picker...', // Add a thought for clarity
          callingFunction: 'Sheet Access',
        });
      }

      try {
        // Pass the auth token and sheet mapping to requestDriveAccessPicker
        const result = await requestDriveAccessPicker(
          missingSheetIds,
          attempt,
          setExportToSheetStatus,
          executionRef,
          authToken,
          sheetIdToTab,
        );

        if (result.success) {
          missingSheetIds.clear();
          success = true;
          break;
        } else if (result.userCancelled) {
          userGuidanceMessage = `User cancelled Google Sheet access request (Attempt ${attempt}).`;
          if (setExportToSheetStatus) {
            setExportToSheetStatus({
              ...DEFAULT_EXPORT_TO_SHEET_STATUS,
              status: 'cancelled',
              message: userGuidanceMessage,
            });
          }
          return false;
        } else if (result.missedSheetIds && result.missedSheetIds.size > 0) {
          missingSheetIds = result.missedSheetIds;

          if (attempt === DRIVE_PICKER_MAX_RETRIES) {
            const finalMissingTitles = Array.from(missingSheetIds)
              .map(id => getSheetTitle(id, sheetIdToTab))
              .join('", "');

            userGuidanceMessage = `Failed to grant access for "${finalMissingTitles}" via picker after ${DRIVE_PICKER_MAX_RETRIES} attempts.`;
            if (setExportToSheetStatus) {
              setExportToSheetStatus({
                ...DEFAULT_EXPORT_TO_SHEET_STATUS,
                status: 'error',
                message: userGuidanceMessage,
              });
            }
            return false;
          }
        }
      } catch (error: any) {
        userGuidanceMessage = `Error requesting Google Sheet access via picker: ${error.message || 'Unknown error.'}`;
        if (setExportToSheetStatus) {
          setExportToSheetStatus({
            ...DEFAULT_EXPORT_TO_SHEET_STATUS,
            status: 'error',
            message: userGuidanceMessage,
          });
        }
        return false;
      }
    }

    // Final success status
    if (success) {
      userGuidanceMessage = 'Successfully ensured access to all required Google Sheets.';
      if (setExportToSheetStatus) {
        setExportToSheetStatus({
          ...DEFAULT_EXPORT_TO_SHEET_STATUS,
          status: 'executing',
          message: userGuidanceMessage,
        });
      }
    }

    return success;
  } catch (error: any) {
    userGuidanceMessage = `Failed to verify sheet access: ${error.message}`;
    if (setExportToSheetStatus) {
      setExportToSheetStatus({
        ...DEFAULT_EXPORT_TO_SHEET_STATUS,
        status: 'error',
        message: userGuidanceMessage,
      });
    }
    return false;
  }
}
