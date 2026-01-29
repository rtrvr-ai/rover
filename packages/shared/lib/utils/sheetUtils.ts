// packages/shared/lib/utils/sheetUtils.ts
import type { SpreadsheetSheet } from './types.js';
import type { PageData, SheetInfo } from '../types/index.js';
import { delay } from './helpers.js';
import { GOOGLE_SHEET_MIME_TYPE } from './constants.js';

export type FormulaCell = {
  v: any; // displayed/formatted value
  f: string; // formula string, e.g. "=A1*2"
  t?: string; // optional inferred type of v
};

export type SheetCell = any | null | FormulaCell;

export async function getGoogleSheetPageData({
  url,
  title,
  sheetId,
  sheetTabId,
  getAuthToken,
}: {
  url: string;
  title: string;
  sheetId: string;
  sheetTabId?: number;
  getAuthToken: () => Promise<string>;
}): Promise<PageData> {
  const DEFAULT_SHEETS_WEBPAGE: PageData = {
    url: url,
    title: title,
    contentType: GOOGLE_SHEET_MIME_TYPE,
  } as PageData;

  try {
    // Fetch Sheet Tab Details
    let sheetTabs: { id: number; title: string }[] = [];
    let sheetTitle: string = '';
    try {
      ({ sheetTitle, sheetTabs } = await retryWithBackoff(
        fetchSheetTitleAndTabs, // Function to retry
        [sheetId, getAuthToken], // Arguments for fetchSheetTitleAndTabs
        isPermissionError, // Condition checker
        5, // Max attempts
        750, // Initial delay (slightly longer might help)
        2, // Backoff factor
      ));
    } catch (fetchError) {
      // Proceed without the tab name, but log the error
      return DEFAULT_SHEETS_WEBPAGE;
    }

    // Find the current tab based on the tab ID from URL
    let currentTabTitle = '';
    let currentTabId = sheetTabId || 0;

    if (sheetTabs && sheetTabs.length > 0) {
      if (sheetTabId !== undefined) {
        const matchingTab = sheetTabs.find(tab => tab.id === sheetTabId);
        if (matchingTab) {
          currentTabTitle = matchingTab.title;
          currentTabId = matchingTab.id;
        } else {
          // Fallback to first tab if tab ID not found
          currentTabTitle = sheetTabs[0].title;
          currentTabId = sheetTabs[0].id;
        }
      } else {
        // No tab ID in URL, use first tab
        currentTabTitle = sheetTabs[0].title;
        currentTabId = sheetTabs[0].id;
      }
    }

    // 6. Construct final SheetInfo and TabData object
    const finalSheetInfo: SheetInfo = {
      sheetId,
      sheetTitle: sheetTitle ?? title,
      sheetTabId: currentTabId, // Keep the GID from the URL
      sheetTab: currentTabTitle, // Add the resolved name
      sheetTabs: sheetTabs ?? [],
    };
    return { ...DEFAULT_SHEETS_WEBPAGE, ...{ sheetInfo: finalSheetInfo } };
  } catch (error) {
    // Catch errors during the access check / picker / fetch process
    return DEFAULT_SHEETS_WEBPAGE;
  }
}

/**
 * Gets the current grid dimensions for a specific sheet tab.
 */
export async function getSheetGridDimensions(
  sheetId: string,
  sheetTabId: number,
  getAuthToken: () => Promise<string>,
): Promise<{ columnCount: number; rowCount: number } | null> {
  try {
    const authToken = await getAuthToken();
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title,gridProperties))`;

    const response = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!response.ok) {
      console.error(`Failed to fetch sheet metadata: ${response.status}`);
      return null;
    }

    const metadata = await response.json();
    const targetSheet = metadata.sheets?.find((s: any) => s.properties.sheetId === sheetTabId);

    if (!targetSheet?.properties?.gridProperties) {
      return null;
    }

    return {
      columnCount: targetSheet.properties.gridProperties.columnCount || 26,
      rowCount: targetSheet.properties.gridProperties.rowCount || 1000,
    };
  } catch (error) {
    console.error('Error getting sheet grid dimensions:', error);
    return null;
  }
}

/**
 * Expands the sheet grid if the target range exceeds current dimensions.
 *
 * @param sheetId The spreadsheet ID
 * @param sheetTabId The numeric ID of the specific tab (not the name)
 * @param requiredColumns The number of columns needed (1-indexed, i.e., column count)
 * @param requiredRows The number of rows needed (1-indexed, i.e., row count)
 * @param getAuthToken Function to get auth token
 * @returns True if expansion succeeded or wasn't needed, false on failure
 */
export async function expandSheetGridIfNeeded(
  sheetId: string,
  sheetTabId: number,
  requiredColumns: number,
  requiredRows: number,
  getAuthToken: () => Promise<string>,
): Promise<boolean> {
  try {
    const dimensions = await getSheetGridDimensions(sheetId, sheetTabId, getAuthToken);

    if (!dimensions) {
      console.warn(`Could not get grid dimensions for tab ${sheetTabId}, proceeding without expansion`);
      return true; // Proceed anyway, let the write fail if needed
    }

    const { columnCount: currentCols, rowCount: currentRows } = dimensions;
    const needsMoreCols = requiredColumns > currentCols;
    const needsMoreRows = requiredRows > currentRows;

    if (!needsMoreCols && !needsMoreRows) {
      return true; // No expansion needed
    }

    // Add buffer to avoid repeated expansions
    const newColCount = needsMoreCols ? requiredColumns + 10 : currentCols;
    const newRowCount = needsMoreRows ? requiredRows + 100 : currentRows;

    console.log(
      `[expandSheetGrid] Expanding sheet tab ${sheetTabId} from ${currentCols}x${currentRows} to ${newColCount}x${newRowCount}`,
    );

    const authToken = await getAuthToken();
    const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;

    const updateResponse = await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheetTabId,
                gridProperties: {
                  columnCount: newColCount,
                  rowCount: newRowCount,
                },
              },
              fields: 'gridProperties.columnCount,gridProperties.rowCount',
            },
          },
        ],
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`Failed to expand sheet grid: ${errorText}`);
      return false;
    }

    console.log(`[expandSheetGrid] Successfully expanded sheet grid`);
    return true;
  } catch (error) {
    console.error('Exception during sheet grid expansion:', error);
    return false;
  }
}

/**
 * Gets the tab ID for a given tab name.
 */
export async function getSheetTabIdByName(
  sheetId: string,
  tabName: string,
  getAuthToken: () => Promise<string>,
): Promise<number | null> {
  try {
    const authToken = await getAuthToken();
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`;

    const response = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!response.ok) {
      return null;
    }

    const metadata = await response.json();
    const tab = metadata.sheets?.find((s: any) => s.properties.title === tabName);

    return tab?.properties?.sheetId ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensures the sheet grid can accommodate the specified range before writing.
 * Convenience wrapper that handles tab ID resolution.
 */
export async function ensureGridCanAccommodate(
  sheetId: string,
  tabNameOrId: string | number,
  requiredColumns: number,
  requiredRows: number,
  getAuthToken: () => Promise<string>,
): Promise<boolean> {
  try {
    let tabId: number;

    if (typeof tabNameOrId === 'number') {
      tabId = tabNameOrId;
    } else {
      const resolvedId = await getSheetTabIdByName(sheetId, tabNameOrId, getAuthToken);
      if (resolvedId === null) {
        console.warn(`Could not resolve tab ID for "${tabNameOrId}"`);
        return true; // Proceed anyway
      }
      tabId = resolvedId;
    }

    return await expandSheetGridIfNeeded(sheetId, tabId, requiredColumns, requiredRows, getAuthToken);
  } catch (error) {
    console.error('Error ensuring grid can accommodate:', error);
    return true; // Proceed anyway, let the write fail if needed
  }
}

/**
 * Fetches basic spreadsheet metadata from the Google Sheets API.
 * Throws an Error with a 'status' property if the HTTP response is not ok.
 * Throws a generic Error for other issues like missing auth or network errors.
 */
const fetchSheetMetadata = async (
  sheetId: string,
  getAuthToken: () => Promise<string>,
): Promise<Record<string, any>> => {
  const authToken = await getAuthToken();

  if (!sheetId || !authToken) {
    // Throw immediately if required info is missing before fetch attempt
    throw new Error(`Missing sheetId or authToken. Cannot fetch metadata.`);
  }

  const spreadsheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!spreadsheetResponse.ok) {
    // If response is not ok (e.g., 403, 404, 5xx), create an error
    // and attach the status code so isPermissionError can check it.
    const error = new Error(`HTTP error ${spreadsheetResponse.status}: ${spreadsheetResponse.statusText}`);
    // Attach the status directly to the error object
    (error as any).status = spreadsheetResponse.status;
    throw error; // Throw the error with status
  }

  // If response is ok, parse and return data
  const spreadsheetData = await spreadsheetResponse.json();
  return spreadsheetData;
};

export const fetchTabs = async (
  sheetId: string,
  getAuthToken: () => Promise<string>,
): Promise<{ id: number; title: string }[]> => {
  try {
    const spreadsheetData = await fetchSheetMetadata(sheetId, getAuthToken);
    if (!spreadsheetData || !spreadsheetData.sheets) {
      return [];
    }
    return spreadsheetData.sheets.map((sheet: SpreadsheetSheet) => ({
      id: sheet.properties.sheetId,
      title: sheet.properties.title,
    }));
  } catch (error) {
    console.error('Error fetching tabs:', error);
    return []; // Return empty array on error
  }
};

/**
 * Fetches sheet title and tabs using fetchSheetMetadata.
 * Relies on fetchSheetMetadata to throw errors on API issues.
 * Does NOT catch errors from fetchSheetMetadata, allowing retryWithBackoff to handle them.
 */
export const fetchSheetTitleAndTabs = async (
  sheetId: string,
  getAuthToken: () => Promise<string>,
): Promise<{ sheetTitle: string; sheetTabs: { id: number; title: string }[] }> => {
  // fetchSheetMetadata will throw if there's an issue (network, auth, HTTP error)
  // These errors will be caught by retryWithBackoff if this function is wrapped by it.
  const spreadsheetData = await fetchSheetMetadata(sheetId, getAuthToken);

  if (!spreadsheetData || !spreadsheetData.sheets) {
    // Throw a specific error if the expected data structure is missing
    // This error would NOT be retried by isPermissionError unless you add a check for its message/type
    throw new Error('Sheet Data missing or malformed after successful fetch');
  }

  const sheetTabs = spreadsheetData.sheets.map((sheet: SpreadsheetSheet) => ({
    id: sheet.properties.sheetId,
    title: sheet.properties.title,
  }));

  return {
    sheetTitle: spreadsheetData.properties?.title,
    sheetTabs,
  };
};

export async function fetchWorkflowSheetTabDataSmart(
  sheetId: string,
  sheetTabTitle: string,
  getAuthToken: () => Promise<string>,
): Promise<any[][] | undefined> {
  return fetchWorkflowSheetTabData(sheetId, sheetTabTitle, getAuthToken);
}

export const fetchWorkflowSheetTabData = async (
  sheetId: string,
  selectedTabTitle: string,
  getAuthToken: () => Promise<string>,
): Promise<SheetCell[][] | undefined> => {
  const authToken = await getAuthToken();
  if (!sheetId || !selectedTabTitle || !authToken) return undefined;

  try {
    const sheetTabName = encodeURIComponent(`'${selectedTabTitle}'`);

    // One request for displayed/formatted values (current behavior)
    const valuesUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetTabName}` +
      `?valueRenderOption=FORMATTED_VALUE`;

    // One request for formulas
    const formulasUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetTabName}` + `?valueRenderOption=FORMULA`;

    const headers = { Authorization: `Bearer ${authToken}` };

    const [valuesRes, formulasRes] = await Promise.all([
      fetch(valuesUrl, { headers }),
      fetch(formulasUrl, { headers }),
    ]);

    if (!valuesRes.ok) {
      throw new Error('Values fetch failed: ' + valuesRes.statusText);
    }
    if (!formulasRes.ok) {
      throw new Error('Formulas fetch failed: ' + formulasRes.statusText);
    }

    const valuesJson = await valuesRes.json();
    const formulasJson = await formulasRes.json();

    const valuesGrid: any[][] = valuesJson?.values ?? [];
    const formulasGrid: any[][] = formulasJson?.values ?? [];
    return mergeValuesAndFormulas(valuesGrid, formulasGrid);
  } catch (error) {
    console.error('Error fetching sheet tab data:', error);
    return undefined;
  }
};

const getMaxCols = (grid: any[][]): number => grid.reduce((m, row) => Math.max(m, row?.length ?? 0), 0);

const inferType = (v: any): string => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // "string" | "number" | "boolean" | "object" | ...
};

const mergeValuesAndFormulas = (values: any[][], formulas: any[][]): SheetCell[][] => {
  const rows = Math.max(values.length, formulas.length);
  const cols = Math.max(getMaxCols(values), getMaxCols(formulas));

  const out: SheetCell[][] = new Array(rows);

  for (let r = 0; r < rows; r++) {
    const row: SheetCell[] = new Array(cols);

    for (let c = 0; c < cols; c++) {
      const v = values[r]?.[c] ?? null;
      const fCandidate = formulas[r]?.[c];

      const hasFormula = typeof fCandidate === 'string' && fCandidate.startsWith('=');

      row[c] = hasFormula ? { v, f: fCandidate, t: inferType(v) } : v;
    }
    out[r] = row;
  }

  return out;
};

export const fetchColumns = async (
  sheetId: string,
  selectedTabTitle: string,
  getAuthToken: () => Promise<string>,
): Promise<any[]> => {
  try {
    const fullTabDataValues = await fetchWorkflowSheetTabData(sheetId, selectedTabTitle, getAuthToken);
    if (fullTabDataValues && fullTabDataValues.length > 0) {
      return fullTabDataValues[0]; //headings of columns
    } else {
      return []; // Return empty array if no values found
    }
  } catch (error) {
    console.error('Error fetching columns:', error);
    return []; // Return empty array on error
  }
};

/**
 * Checks if the extension has access to a specific Google Sheet using Sheets API v4.
 * Assumes drive.readonly, drive.file, spreadsheets.readonly, or spreadsheets scope
 * has been granted.
 * @param spreadsheetId The ID of the Google Spreadsheet.
 * @returns Promise<boolean> True if access is confirmed, false otherwise.
 */
export async function checkSheetAccess(spreadsheetId: string, getAuthToken: () => Promise<string>): Promise<boolean> {
  if (!spreadsheetId) {
    return false;
  }
  const authToken = await getAuthToken();

  try {
    // Use the spreadsheets.get endpoint, requesting only the spreadsheetId field
    // This is a lightweight way to check if we can access the sheet's metadata.
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    if (response.ok) {
      // A 2xx status code means we have access
      return true;
    } else if (response.status === 403) {
      // 403 Forbidden specifically means access denied
      return false;
    } else if (response.status === 404) {
      // 404 Not Found means the sheet doesn't exist *or* the user doesn't have permission to even know it exists.
      return false;
    } else {
      // Handle other potential errors (rate limits, server errors, etc.)
      const errorBody = await response.text();
      console.error(
        `Sheets API check failed for spreadsheetId ${spreadsheetId}: ${response.status} ${response.statusText}`,
        `Error details:`,
        errorBody,
      );
      return false;
    }
  } catch (error) {
    console.error(`Error checking Sheets API access for ${spreadsheetId}:`, error);
    // This could be a network error or failure getting the auth token
    return false;
  }
}

// Generic utility to call Google Sheets API v4
export const callGoogleSheetsApi = async (
  sheetId: string,
  getAuthToken: () => Promise<string>,
  endpoint: 'batchUpdate' | 'values.update' | 'values.append' | 'values.get' | 'addSheet' | 'get' | string,
  payload: Record<string, any> = {},
  method: 'POST' | 'GET' | 'PUT' = 'POST',
) => {
  const authToken = await getAuthToken();
  if (!authToken) {
    throw new Error('Google authentication token is not available.');
  }

  let url: string;
  let body: string | undefined;

  if (endpoint === 'batchUpdate') {
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
    body = JSON.stringify(payload);
    method = 'POST';
  } else if (endpoint === 'values.update') {
    const { range, valueInputOption, resource } = payload;
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      range,
    )}?valueInputOption=${encodeURIComponent(valueInputOption)}`;
    body = JSON.stringify(resource);
    method = 'PUT';
  } else if (endpoint === 'values.append') {
    const { range, valueInputOption, insertDataOption, resource } = payload;
    const vopt = encodeURIComponent(valueInputOption ?? 'USER_ENTERED');
    const iopt = encodeURIComponent(insertDataOption ?? 'INSERT_ROWS');
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      range,
    )}:append?valueInputOption=${vopt}&insertDataOption=${iopt}`;
    body = JSON.stringify(resource);
    method = 'POST';
  } else if (endpoint === 'values.get') {
    // payload: { range, ...optionalQueryParams }
    const { range, ...query } = payload;
    const queryParams = new URLSearchParams(query as any).toString();
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}${
      queryParams ? `?${queryParams}` : ''
    }`;
    body = undefined;
    method = 'GET';
  } else if (endpoint === 'addSheet') {
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
    body = JSON.stringify({ requests: [{ addSheet: payload }] });
    method = 'POST';
  } else if (endpoint === 'get') {
    const queryParams = new URLSearchParams(payload as any).toString();
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?${queryParams}`;
    body = undefined;
    method = 'GET';
  } else {
    // fallback: treat as spreadsheets.get-like
    const queryParams = new URLSearchParams(payload as any).toString();
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?${queryParams}`;
    body = undefined;
    method = 'GET';
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    ...(body && { body }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: 'Unknown API error' } }));
    console.error('Google Sheets API Error:', errorData);
    throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
  }

  const responseData = await response.json();

  if (endpoint === 'addSheet') {
    return responseData.replies[0].addSheet;
  }
  return responseData;
};

/**
 * Retries an async function if it throws an error matching specific criteria (e.g., HTTP status codes).
 * Uses exponential backoff.
 *
 * @param fn The async function to retry.
 * @param args Arguments to pass to the function.
 * @param shouldRetry A function that takes the error and returns true if the operation should be retried.
 * @param maxAttempts Maximum number of attempts.
 * @param initialDelayMs Delay before the first retry.
 * @param backoffFactor Multiplier for the delay (e.g., 2 for doubling).
 * @returns The result of the function if successful.
 * @throws The last error encountered if all retries fail or an error not matching shouldRetry occurs.
 */
async function retryWithBackoff<T>(
  fn: (...args: any[]) => Promise<T>,
  args: any[],
  shouldRetry: (error: any) => boolean,
  maxAttempts: number = 5,
  initialDelayMs: number = 500,
  backoffFactor: number = 2,
): Promise<T> {
  let attempts = 0;
  let currentDelay = initialDelayMs;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      return await fn(...args); // Attempt the function call
    } catch (error: any) {
      if (attempts >= maxAttempts || !shouldRetry(error)) {
        console.error(`Retry failed after ${attempts} attempts or error condition not met. Throwing last error.`);
        throw error; // Max attempts reached or error shouldn't be retried
      }

      await delay(currentDelay); // Wait for the calculated delay
      currentDelay *= backoffFactor; // Increase delay for next time
    }
  }
  // Should theoretically not be reached due to throw in loop, but satisfies TS
  throw new Error('Retry logic failed unexpectedly.');
}

/**
 * Checks if an error is likely due to a transient permission issue (403/404 from Google Sheets API).
 * This specifically looks for errors thrown by the modified fetchSheetMetadata
 * which attach a 'status' property.
 */
export function isPermissionError(error: any): boolean {
  // Check if the error object has a status property set to 403 or 404
  if (error?.status === 403 || error?.status === 404) {
    return true;
  }

  // You might add checks for specific Google API error codes or messages here
  // if 403/404 isn't specific enough, but status is the most reliable way
  // from the HTTP response.

  // If it's not a recognized permission/retryable error, return false.
  return false;
}
