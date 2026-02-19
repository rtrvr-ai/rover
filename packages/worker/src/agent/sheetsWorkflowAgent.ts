import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';
import { SheetOutputFormat, type SheetsWorkflow, type SheetsWorkflowStep } from '@rover/shared/lib/types/workflow-types.js';
import { callGoogleSheetsApi, fetchWorkflowSheetTabDataSmart, fetchSheetTitleAndTabs } from '@rover/shared/lib/utils/sheetUtils.js';
import type { AgentContext } from './context.js';
import type { ToolExecutionResult, PreviousSteps, StatusStage } from './types.js';
import { executeToolFromPlan } from './toolExecutor.js';
import { attachSheetData, resolveHistorySheetInfo } from './memorySheets.js';
import { isMemorySheetId } from '../tabular-memory/tabular-store.js';

export type SheetsWorkflowOptions = {
  workflow: SheetsWorkflow;
  userInput: string;
  trajectoryId: string;
  plannerPrevSteps?: any[];
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  files?: any[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  ctx: AgentContext;
  bridgeRpc: (method: string, params?: any) => Promise<any>;
  driveAuthToken?: string;
};

export async function executeSheetsWorkflow(options: SheetsWorkflowOptions): Promise<ToolExecutionResult> {
  const { workflow, userInput, trajectoryId, plannerPrevSteps, agentLog, files, onStatusUpdate, ctx, bridgeRpc, driveAuthToken } =
    options;
  const throwIfCancelled = () => {
    if (!ctx.isCancelled?.()) return;
    throw new DOMException('Run cancelled', 'AbortError');
  };

  try {
    throwIfCancelled();
    const sourceSheetInfo = workflow.sourceSheetFromHistory
      ? resolveHistorySheetInfo(workflow.sourceSheetFromHistory, plannerPrevSteps)
      : undefined;

    let sheetId = sourceSheetInfo?.sheetId || workflow.sheetId;
    let sheetTabTitle = sourceSheetInfo?.sheetTab || workflow.sheetTabTitle;
    let sheetTabId = sourceSheetInfo?.sheetTabId || workflow.sheetTabId;

    if (!sheetId) {
      return { error: 'sheets_workflow requires sheetId in workflow.' };
    }

    const useMemory = ctx.apiMode || !driveAuthToken || isMemorySheetId(sheetId);
    const getAuthToken = async () => driveAuthToken || '';

    let grid: any[][] = [];
    let sheetTabs: { id: number; title: string }[] = [];

    if (useMemory) {
      const store = ctx.tabularStore;
      const tab =
        sheetTabId !== undefined
          ? store.getTabByIndex(sheetId, sheetTabId)
          : sheetTabTitle
            ? store.getTabByTitle(sheetId, sheetTabTitle)
            : store.getTab(sheetId, 0);

      if (!tab) {
        return { error: 'Memory sheet tab not found for workflow.' };
      }

      sheetTabTitle = tab.title;
      sheetTabId = tab.index;
      grid = store.toAny2D(sheetId, tab.index, true);
      sheetTabs = store.listTabs(sheetId).map((t) => ({ id: t.index, title: t.title }));
    } else {
      const meta = await fetchSheetTitleAndTabs(sheetId, getAuthToken);
      sheetTabs = meta.sheetTabs;
      if (!sheetTabTitle && typeof sheetTabId === 'number') {
        sheetTabTitle = sheetTabs.find((t) => t.id === sheetTabId)?.title;
      }
      if (!sheetTabTitle) {
        sheetTabTitle = sheetTabs[0]?.title;
      }
      if (!sheetTabTitle) {
        return { error: 'Could not resolve sheet tab title for workflow.' };
      }

      throwIfCancelled();
      onStatusUpdate?.('Loading sheet rows...', sheetTabTitle, 'analyze');
      grid = (await fetchWorkflowSheetTabDataSmart(sheetId, sheetTabTitle, getAuthToken)) || [];
    }

    if (!grid.length) {
      return { error: 'Sheet is empty or inaccessible.' };
    }

    const normalizedGrid = grid.map(row => (row || []).map(cell => normalizeCell(cell)));
    const headerRow = workflow.isFirstRowHeader ? normalizedGrid[0] : null;
    const dataRows = workflow.isFirstRowHeader ? normalizedGrid.slice(1) : normalizedGrid.slice();

    const header = headerRow && headerRow.length ? headerRow : buildDefaultHeader(normalizedGrid);

    const inputIndex = resolveInputColumnIndex(workflow, header);
    const contextIndices = resolveContextColumnIndices(workflow, header);

    const startRow = Math.max(0, (workflow.startRowIndex ?? 1) - 1 - (workflow.isFirstRowHeader ? 1 : 0));
    const endRow = workflow.endRowIndex
      ? Math.min(dataRows.length, workflow.endRowIndex - (workflow.isFirstRowHeader ? 1 : 0))
      : dataRows.length;

    const outputColumnHeaders: string[] = [];
    const outputRows: string[][] = [];
    const newTabOutputs: Record<string, any[][]> = {};

    for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
      throwIfCancelled();
      const row = dataRows[rowIdx] || [];
      const rowData = buildRowData(header, row);
      const context = buildContextData(header, row, contextIndices);
      const rowContext = {
        input_value: row[inputIndex] ?? '',
        row_number: rowIdx + 1 + (workflow.isFirstRowHeader ? 1 : 0),
        row_data: rowData,
        context,
      };

      const stepOutputs: Record<string, any> = {};
      const rowOutputValues: string[] = [];

      for (const step of workflow.workflowSteps) {
        throwIfCancelled();
        const stepName = step.stepName || step.tool;
        const resolvedUserInput = resolveTemplate(step.userInputTemplate || userInput, rowContext, stepOutputs);

        if (step.tabManagement?.urlTemplate) {
          const targetUrl = resolveTemplate(step.tabManagement.urlTemplate, rowContext, stepOutputs);
          if (targetUrl) {
            throwIfCancelled();
            await bridgeRpc('executeTool', { call: { name: 'goto_url', args: { tab_id: 0, url: targetUrl } } });
          }
        }

        const resolvedToolArgs = step.toolArgs ? resolveArgs(step.toolArgs, rowContext, stepOutputs) : undefined;

        const stepResult = await executeWorkflowStep({
          step,
          userInput: resolvedUserInput,
          trajectoryId,
          plannerPrevSteps,
          agentLog,
          files,
          onStatusUpdate,
          ctx,
          bridgeRpc,
          driveAuthToken,
          toolArgs: resolvedToolArgs,
        });

        stepOutputs[stepName] = stepResult;
        throwIfCancelled();

        if (step.outputMapping === SheetOutputFormat.CONTEXT) {
          continue;
        }

        if (step.outputMapping === SheetOutputFormat.NEWTAB) {
          if (!newTabOutputs[stepName]) newTabOutputs[stepName] = [];
          newTabOutputs[stepName].push(normalizeOutputRow(stepResult));
          continue;
        }

        const columnLabel = stepName || step.tool;
        if (!outputColumnHeaders.includes(columnLabel)) {
          outputColumnHeaders.push(columnLabel);
        }

        rowOutputValues.push(serializeOutput(stepResult));
      }

      outputRows.push(rowOutputValues);
    }

    if (useMemory) {
      throwIfCancelled();
      const store = ctx.tabularStore;
      const baseTab = sheetTabId !== undefined ? store.getTab(sheetId, sheetTabId) : store.getTabByTitle(sheetId, sheetTabTitle!) || store.getTab(sheetId, 0);

      if (outputColumnHeaders.length) {
        store.mergeHeaderRow(sheetId, baseTab.index, outputColumnHeaders);
        for (let i = 0; i < outputRows.length; i++) {
          const rowIndex0 = startRow + i;
          const patch: Record<string, any> = {};
          outputColumnHeaders.forEach((h, idx) => {
            patch[h] = outputRows[i]?.[idx] ?? '';
          });
          store.upsertColumnsByHeader(sheetId, baseTab.index, rowIndex0, patch);
        }
      }

      for (const [stepName, rows] of Object.entries(newTabOutputs)) {
        const title = truncateTabTitle(stepName);
        const headerRowValues = buildNewTabHeader(rows);
        store.publishNewTab(sheetId, title, headerRowValues, rows, {});
      }

      const updatedSheetInfo = attachSheetData(store, store.toSheetInfo(sheetId, baseTab.index));
      const headerRowFinal = store.getTab(sheetId, baseTab.index).headerRow;

      return {
        output: {
          sheetId,
          sheetTabTitle,
          rowsProcessed: Math.max(0, endRow - startRow),
          outputColumns: outputColumnHeaders,
          newTabs: Object.keys(newTabOutputs),
        },
        schemaHeaderSheetInfo: [
          {
            headingInfo: { schema: {}, headings: headerRowFinal, title: sheetTabTitle },
            sheetInfo: updatedSheetInfo,
            headerRow: headerRowFinal,
          },
        ],
      };
    }

    if (outputColumnHeaders.length) {
      throwIfCancelled();
      await appendColumnsToSheet({
        sheetId,
        sheetTabTitle: sheetTabTitle!,
        header,
        outputHeaders: outputColumnHeaders,
        outputRows,
        startRowIndex: workflow.isFirstRowHeader ? 2 : 1,
        getAuthToken,
      });
    }

    for (const [stepName, rows] of Object.entries(newTabOutputs)) {
      throwIfCancelled();
      const title = truncateTabTitle(stepName);
      const newTitle = await createSheetTab(sheetId, title, getAuthToken);
      const headerRowValues = buildNewTabHeader(rows);
      await writeSheetValues({
        sheetId,
        sheetTabTitle: newTitle,
        values: [headerRowValues, ...rows],
        getAuthToken,
      });
    }

    return {
      output: {
        sheetId,
        sheetTabTitle,
        rowsProcessed: Math.max(0, endRow - startRow),
        outputColumns: outputColumnHeaders,
        newTabs: Object.keys(newTabOutputs),
      },
      schemaHeaderSheetInfo: [
        {
          headingInfo: { schema: {}, headings: [...header, ...outputColumnHeaders], title: sheetTabTitle },
          sheetInfo: { sheetId, sheetTab: sheetTabTitle!, sheetTabId, sheetTabs },
          headerRow: [...header, ...outputColumnHeaders],
        },
      ],
    };
  } catch (error: any) {
    return { error: error?.message || String(error) };
  }
}

async function executeWorkflowStep({
  step,
  userInput,
  trajectoryId,
  plannerPrevSteps,
  agentLog,
  files,
  onStatusUpdate,
  ctx,
  bridgeRpc,
  driveAuthToken,
  toolArgs,
}: {
  step: SheetsWorkflowStep;
  userInput: string;
  trajectoryId: string;
  plannerPrevSteps?: any[];
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  files?: any[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  ctx: AgentContext;
  bridgeRpc: (method: string, params?: any) => Promise<any>;
  driveAuthToken?: string;
  toolArgs?: Record<string, any>;
}): Promise<any> {
  if (ctx.isCancelled?.()) {
    throw new DOMException('Run cancelled', 'AbortError');
  }
  const toolName = step.tool;

  if (toolName === PLANNER_FUNCTION_CALLS.PROCESS_TEXT) {
    const result = await executeToolFromPlan({
      toolName,
      toolArgs: {
        textInputs: step.textInputs || [],
        taskInstruction: step.taskInstruction || userInput,
        schema: step.schema,
      },
      userInput,
      tabs: [{ id: 1 }],
      trajectoryId,
      plannerPrevSteps,
      agentLog,
      files,
      onStatusUpdate,
      ctx,
      bridgeRpc,
      driveAuthToken,
    });
    if (agentLog && Array.isArray(result.prevSteps) && result.prevSteps.length > 0) {
      agentLog.prevSteps = result.prevSteps;
    }
    return result.output ?? result;
  }

  if (
    toolName === PLANNER_FUNCTION_CALLS.ACT ||
    toolName === PLANNER_FUNCTION_CALLS.EXTRACT ||
    toolName === PLANNER_FUNCTION_CALLS.CRAWL
  ) {
    const result = await executeToolFromPlan({
      toolName,
      toolArgs: {
        user_input: userInput,
        schema: step.schema,
        followLinks: step.followLinks,
        maxPages: step.maxPages,
      },
      userInput,
      tabs: [{ id: 1 }],
      trajectoryId,
      plannerPrevSteps,
      agentLog,
      files,
      onStatusUpdate,
      ctx,
      bridgeRpc,
      driveAuthToken,
    });
    if (agentLog && Array.isArray(result.prevSteps) && result.prevSteps.length > 0) {
      agentLog.prevSteps = result.prevSteps;
    }
    return result.output ?? result;
  }

  // User-defined tool
  if (toolArgs || step.toolArgs || typeof toolName === 'string') {
    if (ctx.isCancelled?.()) {
      throw new DOMException('Run cancelled', 'AbortError');
    }
    const result = await bridgeRpc('executeClientTool', { name: toolName, args: toolArgs || step.toolArgs || {} });
    if (ctx.isCancelled?.()) {
      throw new DOMException('Run cancelled', 'AbortError');
    }
    return result;
  }

  return { error: `Unsupported step tool: ${toolName}` };
}

function normalizeCell(cell: any): any {
  if (cell && typeof cell === 'object' && 'v' in cell) return (cell as any).v;
  return cell ?? '';
}

function buildDefaultHeader(rows: any[][]): string[] {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const header: string[] = [];
  for (let i = 0; i < maxCols; i++) header.push(`Column ${i + 1}`);
  return header;
}

function buildRowData(header: string[], row: any[]): Record<string, any> {
  const data: Record<string, any> = {};
  header.forEach((key, idx) => {
    data[key] = row[idx];
  });
  return data;
}

function buildContextData(header: string[], row: any[], indices: number[]): Record<string, any> {
  const data: Record<string, any> = {};
  for (const idx of indices) {
    const key = header[idx] || `Column ${idx + 1}`;
    data[key] = row[idx];
  }
  return data;
}

function resolveInputColumnIndex(workflow: SheetsWorkflow, header: string[]): number {
  if (workflow.inputColumnHeader) {
    const idx = header.findIndex(h => h === workflow.inputColumnHeader);
    if (idx >= 0) return idx;
  }
  if (typeof workflow.inputColumnOrdinalPosition === 'number') {
    return Math.max(0, workflow.inputColumnOrdinalPosition - 1);
  }
  return 0;
}

function resolveContextColumnIndices(workflow: SheetsWorkflow, header: string[]): number[] {
  const indices: number[] = [];
  if (workflow.contextColumnHeaders?.length) {
    for (const h of workflow.contextColumnHeaders) {
      const idx = header.findIndex(key => key === h);
      if (idx >= 0) indices.push(idx);
    }
  }
  if (workflow.contextColumnOrdinals?.length) {
    for (const ord of workflow.contextColumnOrdinals) {
      const idx = Math.max(0, ord - 1);
      if (!indices.includes(idx)) indices.push(idx);
    }
  }
  return indices;
}

function serializeOutput(output: any): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function normalizeOutputRow(output: any): any[] {
  if (Array.isArray(output)) {
    if (output.length && typeof output[0] === 'object' && !Array.isArray(output[0])) {
      return output.map(item => serializeOutput(item));
    }
    return output.map(item => serializeOutput(item));
  }
  if (output && typeof output === 'object') {
    return [serializeOutput(output)];
  }
  return [serializeOutput(output)];
}

async function appendColumnsToSheet({
  sheetId,
  sheetTabTitle,
  header,
  outputHeaders,
  outputRows,
  startRowIndex,
  getAuthToken,
}: {
  sheetId: string;
  sheetTabTitle: string;
  header: string[];
  outputHeaders: string[];
  outputRows: string[][];
  startRowIndex: number;
  getAuthToken: () => Promise<string>;
}) {
  const startCol = header.length + 1;
  const endCol = startCol + outputHeaders.length - 1;
  const headerRange = `${sheetTabTitle}!${colToLetter(startCol)}1:${colToLetter(endCol)}1`;

  await callGoogleSheetsApi(
    sheetId,
    getAuthToken,
    'values.update',
    {
      range: headerRange,
      valueInputOption: 'RAW',
      resource: { values: [outputHeaders] },
    },
    'PUT',
  );

  if (!outputRows.length) return;
  const endRow = startRowIndex + outputRows.length - 1;
  const dataRange = `${sheetTabTitle}!${colToLetter(startCol)}${startRowIndex}:${colToLetter(endCol)}${endRow}`;

  await callGoogleSheetsApi(
    sheetId,
    getAuthToken,
    'values.update',
    {
      range: dataRange,
      valueInputOption: 'RAW',
      resource: { values: outputRows },
    },
    'PUT',
  );
}

async function createSheetTab(sheetId: string, title: string, getAuthToken: () => Promise<string>): Promise<string> {
  await callGoogleSheetsApi(
    sheetId,
    getAuthToken,
    'addSheet',
    {
      properties: { title },
    },
    'POST',
  );
  return title;
}

async function writeSheetValues({
  sheetId,
  sheetTabTitle,
  values,
  getAuthToken,
}: {
  sheetId: string;
  sheetTabTitle: string;
  values: any[][];
  getAuthToken: () => Promise<string>;
}) {
  const endCol = Math.max(1, values.reduce((max, row) => Math.max(max, row.length), 0));
  const endRow = values.length;
  const range = `${sheetTabTitle}!A1:${colToLetter(endCol)}${endRow}`;
  await callGoogleSheetsApi(
    sheetId,
    getAuthToken,
    'values.update',
    {
      range,
      valueInputOption: 'RAW',
      resource: { values },
    },
    'PUT',
  );
}

function colToLetter(col: number): string {
  let temp = col;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

function truncateTabTitle(title: string): string {
  const trimmed = title.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  const base = trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
  return base || `Rover-${Math.random().toString(36).slice(2, 6)}`;
}

function buildNewTabHeader(rows: any[][]): string[] {
  if (!rows.length) return ['result'];
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxCols <= 1) return ['result'];
  const headers: string[] = [];
  for (let i = 0; i < maxCols; i++) headers.push(`value_${i + 1}`);
  return headers;
}

function resolveTemplate(template: string, rowContext: any, stepOutputs: Record<string, any>): string {
  if (!template) return '';
  const regex = /\{\{\s*([^}]+)\s*\}\}/g;
  return template.replace(regex, (_match, expr) => {
    const path = String(expr).trim();
    const [root, ...rest] = tokenizePath(path);
    let base: any;
    switch (root) {
      case 'input_value':
        base = rowContext.input_value;
        break;
      case 'row_number':
        base = rowContext.row_number;
        break;
      case 'row_data':
        base = rowContext.row_data;
        break;
      case 'context':
        base = rowContext.context;
        break;
      case 'step':
        base = stepOutputs;
        break;
      default:
        base = rowContext;
    }
    const value = resolvePath(base, rest.join('.'));
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

function resolveArgs(value: any, rowContext: any, stepOutputs: Record<string, any>): any {
  if (value == null) return value;
  if (typeof value === 'string') return resolveTemplate(value, rowContext, stepOutputs);
  if (Array.isArray(value)) return value.map(item => resolveArgs(item, rowContext, stepOutputs));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveArgs(v, rowContext, stepOutputs);
    }
    return out;
  }
  return value;
}

function tokenizePath(path: string): string[] {
  const cleaned = path.replace(/\["([^"]+)"\]/g, '.$1').replace(/\['([^']+)'\]/g, '.$1');
  return cleaned.split('.').filter(Boolean);
}

function resolvePath(obj: any, path: string): any {
  if (!path) return obj;
  const parts = path.split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
