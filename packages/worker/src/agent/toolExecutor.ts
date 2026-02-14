import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';
import { systemToolNamesSet } from '@rover/shared/lib/system-tools/tools.js';
import { SUB_AGENTS } from '@rover/shared/lib/types/agent-types.js';
import type { ToolExecutionContext, ToolExecutionResult, PreviousSteps, StatusStage } from './types.js';
import { executeAgenticSeek } from './actAgent.js';
import { executeExtract } from './extractAgent.js';
import { executeCrawl } from './crawlAgent.js';
import { executeSheetsWorkflow } from './sheetsWorkflowAgent.js';
import type { AgentContext } from './context.js';
import { attachSheetData, buildHeaders, publishObjectsToMemory, publishRowsToMemory, resolveHistorySheetInfo, resolveMemoryTarget } from './memorySheets.js';
import { isMemorySheetId } from '../tabular-memory/tabular-store.js';
import { toRoverErrorEnvelope } from './errors.js';

function unsupportedToolResult(toolName: string, message: string): ToolExecutionResult {
  return {
    error: message,
    warnings: [message],
    output: [{ tool: toolName, status: 'unsupported_in_embed', message }],
  };
}

function buildStructuredErrorOutput(envelope: {
  code?: string;
  message?: string;
  missing?: string[];
  next_action?: string;
  retryable?: boolean;
  requires_api_key?: boolean;
}) {
  const code = envelope.code || 'UNKNOWN_ERROR';
  const message = envelope.message || 'Operation failed';
  const missing = Array.isArray(envelope.missing) ? envelope.missing : [];
  const retryable = !!envelope.retryable;

  return {
    success: false,
    error: {
      code,
      message,
      missing,
      next_action: envelope.next_action,
      retryable,
      requires_api_key: !!envelope.requires_api_key,
    },
    missing,
    next_action: envelope.next_action,
    retryable,
  };
}

function normalizeAgentLog(agentLog: ToolExecutionContext['agentLog']) {
  // Preserve the same mutable reference so step updates survive page transitions.
  const prevSteps = Array.isArray(agentLog?.prevSteps) ? agentLog.prevSteps : [];
  const chatLog: Array<{ role: 'user' | 'model'; message: string }> = Array.isArray(agentLog?.chatLog)
    ? agentLog.chatLog
        .map(entry => ({
          role: entry?.role === 'user' ? ('user' as const) : ('model' as const),
          message: typeof entry?.message === 'string' ? entry.message : '',
        }))
        .filter(entry => !!entry.message)
    : [];

  return { prevSteps, chatLog };
}

export async function executeToolFromPlan(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const {
    toolName,
    toolArgs,
    userInput,
    tabs,
    trajectoryId,
    plannerPrevSteps,
    files,
    onStatusUpdate,
    recordingContext,
    toolFunctions,
    bridgeRpc,
    ctx,
    functionDeclarations,
    driveAuthToken,
    agentLog,
    onPrevStepsUpdate,
  } = context;

  const effectiveCtx = ctx as AgentContext | undefined;
  if (!effectiveCtx) {
    return { error: 'Agent context unavailable' };
  }

  const tabOrder = tabs?.length ? tabs.map(t => t.id) : [1];
  const effectiveAgentLog = normalizeAgentLog(agentLog);

  try {
    switch (toolName as PLANNER_FUNCTION_CALLS) {
    case PLANNER_FUNCTION_CALLS.ACT: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      const actResult = await executeAgenticSeek({
        tabOrder,
        userInput: prompt,
        schema: toolArgs?.schema,
        previousSteps: effectiveAgentLog.prevSteps,
        plannerPrevSteps,
        files,
        chatLog: effectiveAgentLog.chatLog,
        recordingContext,
        trajectoryId,
        onStatusUpdate,
        functionDeclarations,
        bridgeRpc: bridgeRpc!,
        ctx: effectiveCtx,
        onPrevStepsUpdate,
      });
      return { ...actResult, output: actResult.data };
    }

    case PLANNER_FUNCTION_CALLS.EXTRACT: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      const outputDestination = toolArgs?.output_destination || toolArgs?.outputDestination;
      const memoryTarget = outputDestination ? resolveMemoryTarget(outputDestination, plannerPrevSteps) : undefined;
      const shouldMemory = effectiveCtx.apiMode || !driveAuthToken || (memoryTarget?.sheetId && isMemorySheetId(memoryTarget.sheetId));
      const returnDataOnly = toolArgs?.return_data_only ?? toolArgs?.returnDataOnly ?? shouldMemory;
      const extractResult = await executeExtract({
        tabOrder,
        userInput: prompt,
        schema: toolArgs?.schema,
        outputDestination,
        schemaHeaderSheetInfo: toolArgs?.schema_header_sheet_info || toolArgs?.schemaHeaderSheetInfo,
        plannerPrevSteps,
        files,
        recordingContext,
        previousSteps: effectiveAgentLog.prevSteps,
        trajectoryId,
        returnDataOnly,
        onStatusUpdate,
        bridgeRpc: bridgeRpc!,
        ctx: effectiveCtx,
        onPrevStepsUpdate,
      });

      if (extractResult.data && Array.isArray(extractResult.data) && outputDestination && shouldMemory) {
        const headers = buildHeaders(toolArgs?.schema, extractResult.data as any[]);
        const target = memoryTarget || resolveMemoryTarget(outputDestination, plannerPrevSteps);
        const store = effectiveCtx.tabularStore;
        const { sheetInfo, headerRow } = publishObjectsToMemory({
          store,
          target,
          headers,
          objects: extractResult.data as Record<string, any>[],
          schema: toolArgs?.schema,
        });
        const sheetInfoWithData = attachSheetData(store, sheetInfo);
        return {
          ...extractResult,
          output: extractResult.data,
          schemaHeaderSheetInfo: [
            {
              headingInfo: { schema: toolArgs?.schema || {}, headings: headerRow, title: sheetInfo.sheetTitle || sheetInfo.sheetTab },
              sheetInfo: sheetInfoWithData,
              headerRow,
            },
          ],
        };
      }

      return { ...extractResult, output: extractResult.data };
    }

    case PLANNER_FUNCTION_CALLS.CRAWL: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      const outputDestination = toolArgs?.output_destination || toolArgs?.outputDestination;
      const memoryTarget = outputDestination ? resolveMemoryTarget(outputDestination, plannerPrevSteps) : undefined;
      const shouldMemory = effectiveCtx.apiMode || !driveAuthToken || (memoryTarget?.sheetId && isMemorySheetId(memoryTarget.sheetId));
      const returnDataOnly = toolArgs?.return_data_only ?? toolArgs?.returnDataOnly ?? shouldMemory;
      const crawlResult = await executeCrawl({
        tabOrder,
        userInput: prompt,
        schema: toolArgs?.schema,
        plannerPrevSteps,
        files,
        recordingContext,
        previousSteps: effectiveAgentLog.prevSteps,
        trajectoryId,
        onStatusUpdate,
        returnDataOnly,
        bridgeRpc: bridgeRpc!,
        ctx: effectiveCtx,
        onPrevStepsUpdate,
      });

      if (crawlResult.data && Array.isArray(crawlResult.data) && outputDestination && shouldMemory) {
        const headers = buildHeaders(toolArgs?.schema, crawlResult.data as any[]);
        const target = memoryTarget || resolveMemoryTarget(outputDestination, plannerPrevSteps);
        const store = effectiveCtx.tabularStore;
        const { sheetInfo, headerRow } = publishObjectsToMemory({
          store,
          target,
          headers,
          objects: crawlResult.data as Record<string, any>[],
          schema: toolArgs?.schema,
        });
        const sheetInfoWithData = attachSheetData(store, sheetInfo);
        return {
          ...crawlResult,
          output: crawlResult.data,
          schemaHeaderSheetInfo: [
            {
              headingInfo: { schema: toolArgs?.schema || {}, headings: headerRow, title: sheetInfo.sheetTitle || sheetInfo.sheetTab },
              sheetInfo: sheetInfoWithData,
              headerRow,
            },
          ],
        };
      }

      return { ...crawlResult, output: crawlResult.data };
    }

    case PLANNER_FUNCTION_CALLS.PROCESS_TEXT: {
      const textInputs = toolArgs?.text_inputs || toolArgs?.textInputs || [];
      const taskInstruction = toolArgs?.task_instruction || toolArgs?.taskInstruction || userInput;
      return executeProcessText({
        textInputs,
        taskInstruction,
        schema: toolArgs?.schema,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        driveAuthToken: toolArgs?.authToken || toolArgs?.driveAuthToken || driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.CREATE_SHEET_FROM_DATA: {
      const dataInputs = toolArgs?.data_inputs || toolArgs?.dataInputs || [];
      const taskInstruction = toolArgs?.task_instruction || toolArgs?.taskInstruction || userInput;
      return executeCreateSheetFromData({
        dataInputs,
        taskInstruction,
        schema: toolArgs?.schema,
        outputSheetParameters: toolArgs?.output_sheet_parameters || toolArgs?.outputSheetParameters,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        driveAuthToken: toolArgs?.authToken || toolArgs?.driveAuthToken || driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.INFER_SHEET_DATA: {
      return executeInferSheetData({
        toolArgs,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        driveAuthToken: toolArgs?.authToken || toolArgs?.driveAuthToken || driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.QUERY_RTRVR_AI_DOCUMENTATION: {
      const userQuestion = toolArgs?.user_question || toolArgs?.userQuestion || userInput;
      return executeQueryDocs({ userQuestion, trajectoryId, plannerPrevSteps, onStatusUpdate, agentLog: effectiveAgentLog, ctx: effectiveCtx });
    }

    case PLANNER_FUNCTION_CALLS.GOOGLE_DOC_GENERATOR: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      return executeDocGenerator({
        userInput: prompt,
        toolArgs,
        tabOrder,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        driveAuthToken: toolArgs?.authToken || toolArgs?.driveAuthToken || driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.GOOGLE_SLIDES_GENERATOR: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      return executeSlidesGenerator({
        userInput: prompt,
        toolArgs,
        tabOrder,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        driveAuthToken: toolArgs?.authToken || toolArgs?.driveAuthToken || driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.WEBPAGE_GENERATOR: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      return executeWebpageGenerator({
        userInput: prompt,
        toolArgs,
        tabOrder,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
      });
    }

    case PLANNER_FUNCTION_CALLS.PDF_FILLER: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      return executePdfFiller({
        userInput: prompt,
        toolArgs,
        tabOrder,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        driveAuthToken: toolArgs?.authToken || toolArgs?.driveAuthToken || driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.CUSTOM_TOOL_GENERATOR: {
      const prompt = toolArgs?.user_input || toolArgs?.prompt || toolArgs?.task_instruction || userInput;
      return executeCustomToolGenerator({
        userInput: prompt,
        plannerPrevSteps,
        files,
        trajectoryId,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
      });
    }

    case PLANNER_FUNCTION_CALLS.SHEETS_WORKFLOW: {
      const workflow = toolArgs as any;
      return executeSheetsWorkflow({
        workflow,
        userInput,
        trajectoryId,
        plannerPrevSteps,
        files,
        onStatusUpdate,
        agentLog: effectiveAgentLog,
        ctx: effectiveCtx,
        bridgeRpc: bridgeRpc!,
        driveAuthToken,
      });
    }

    case PLANNER_FUNCTION_CALLS.GRAPHBOT: {
      return unsupportedToolResult(
        PLANNER_FUNCTION_CALLS.GRAPHBOT,
        'graph_bot is not available in rover embed mode. Use webpage_generator or process_text.',
      );
    }

    case PLANNER_FUNCTION_CALLS.EXECUTE_MULTIPLE_TOOLS: {
      const toolCalls = toolArgs?.tool_calls || toolArgs?.toolCalls || [];
      const results: any[] = [];
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          const name = call.tool_name || call.name;
          const args = call.tool_args || call.args || {};
          try {
            let res: any;
            if (name && systemToolNamesSet.has(name)) {
              res = await bridgeRpc?.('executeTool', { call: { name, args } });
            } else {
              res = await bridgeRpc?.('executeClientTool', { name, args });
            }
            results.push({ name, result: res, success: true });
          } catch (error: any) {
            results.push({ name, error: error?.message || String(error), success: false });
          }
        }
      }
      return { output: results };
    }

    case PLANNER_FUNCTION_CALLS.CONFIGURE_API_KEY: {
      return unsupportedToolResult(
        PLANNER_FUNCTION_CALLS.CONFIGURE_API_KEY,
        'configure_api_key is not supported in rover embed mode. Provide apiKey via rover.boot(...) or rover.update(...).',
      );
    }

      default: {
        if (toolFunctions && toolFunctions[toolName]) {
          try {
            const result = await bridgeRpc?.('executeClientTool', { name: toolName, args: toolArgs });
            return { output: result };
          } catch (error: any) {
            return { error: error?.message || String(error) };
          }
        }

        return { error: `Unsupported tool: ${toolName}` };
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    const envelope = toRoverErrorEnvelope(err, `Failed to execute tool: ${toolName}`);
    return {
      output: buildStructuredErrorOutput(envelope),
      error: envelope.message,
      errorDetails: envelope,
      warnings: envelope.message ? [envelope.message] : undefined,
    };
  }
}

async function executeProcessText({
  textInputs,
  taskInstruction,
  schema,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
  driveAuthToken,
}: {
  textInputs: string[];
  taskInstruction: string;
  schema?: any;
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
  driveAuthToken?: string;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Processing text...', 'Calling process_text', 'execute');
  const request = {
    siteId: ctx.siteId,
    textInputs,
    taskInstruction,
    schema,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    plannerPrevSteps,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.processText, request);
  if (!response?.success) return { error: response?.error || 'process_text failed' };

  return {
    output: response.data?.text ? [response.data.text] : response.data?.data,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

async function executeCreateSheetFromData({
  dataInputs,
  taskInstruction,
  schema,
  outputSheetParameters,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
  driveAuthToken,
}: {
  dataInputs: string[];
  taskInstruction: string;
  schema: any;
  outputSheetParameters: any;
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
  driveAuthToken?: string;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Creating sheet...', 'Calling create_sheet_from_data', 'execute');
  const memoryTarget = resolveMemoryTarget(outputSheetParameters, plannerPrevSteps);
  const useMemory = ctx.apiMode || !driveAuthToken || (memoryTarget.sheetId && isMemorySheetId(memoryTarget.sheetId));
  const request = {
    siteId: ctx.siteId,
    dataInputs,
    taskInstruction,
    schema,
    outputSheetParameters,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    plannerPrevSteps,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
    returnDataOnly: useMemory,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.createSheetFromData, request);
  if (!response?.success) return { error: response?.error || 'create_sheet_from_data failed' };

  if (useMemory) {
    const jsonData = response.data?.jsonData || response.data?.data || [];
    const objects = Array.isArray(jsonData) ? jsonData : [jsonData];
    const headers = buildHeaders(schema, objects);
    const target = memoryTarget || resolveMemoryTarget(outputSheetParameters, plannerPrevSteps);
    const store = ctx.tabularStore;
    const { sheetInfo, headerRow } = publishObjectsToMemory({
      store,
      target,
      headers,
      objects,
      schema,
    });
    const sheetInfoWithData = attachSheetData(store, sheetInfo);

    return {
      output: objects,
      error: response.data?.error,
      errorDetails: response.data?.errorDetails,
      creditsUsed: response.data?.creditsUsed,
      warnings: response.data?.warnings,
      schemaHeaderSheetInfo: [
        {
          headingInfo: { schema: schema || {}, headings: headerRow, title: sheetInfo.sheetTitle || sheetInfo.sheetTab },
          sheetInfo: sheetInfoWithData,
          headerRow,
        },
      ],
    };
  }

  return {
    output: response.data?.statusText ? [response.data.statusText] : response.data?.sheetInfo,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
    schemaHeaderSheetInfo: response.data?.schemaHeaderSheetInfo,
  };
}

async function executeInferSheetData({
  toolArgs,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
  driveAuthToken,
}: {
  toolArgs: any;
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
  driveAuthToken?: string;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Inferring sheet data...', 'Calling infer_sheet_data', 'execute');
  const sourceSheetRef = toolArgs?.source_sheet_from_history || toolArgs?.sourceSheetFromHistory;
  const resolvedSheetInfo = sourceSheetRef ? resolveHistorySheetInfo(sourceSheetRef, plannerPrevSteps) : undefined;
  const sheetId = resolvedSheetInfo?.sheetId || toolArgs?.sheet_id || toolArgs?.sheetId;
  const sheetTabTitle = resolvedSheetInfo?.sheetTab || toolArgs?.sheet_tab_title || toolArgs?.sheetTabTitle;
  const sheetTabId = resolvedSheetInfo?.sheetTabId || toolArgs?.sheet_tab_id || toolArgs?.sheetTabId;
  const outputDestination =
    toolArgs?.output_destination || toolArgs?.outputDestination || toolArgs?.output_sheet_parameters || toolArgs?.outputSheetParameters;

  const useMemory = ctx.apiMode || !driveAuthToken || (sheetId && isMemorySheetId(sheetId));
  let sheetData: any[][] | undefined;

  if (useMemory && sheetId && sheetTabTitle) {
    const store = ctx.tabularStore;
    const tab = sheetTabId !== undefined ? store.getTabByIndex(sheetId, sheetTabId) : store.getTabByTitle(sheetId, sheetTabTitle);
    if (tab) {
      sheetData = store.toAny2D(sheetId, tab.index, true);
    }
  }

  const request = {
    siteId: ctx.siteId,
    ...toolArgs,
    sheetId,
    sheetTabTitle,
    sheetTabId,
    sheetData,
    returnDataOnly: useMemory,
    plannerPrevSteps,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.infer, request);
  if (!response?.success) return { error: response?.error || 'infer_sheet_data failed' };

  const inferredItems = Array.isArray(response.data?.data) ? response.data.data : [];
  if (useMemory && sheetId && sheetTabTitle) {
    const store = ctx.tabularStore;
    if (!store.hasSheet(sheetId)) {
      return { error: `Memory sheet not found: ${sheetId}` };
    }
    const headers = buildHeaders(toolArgs?.schema, inferredItems);
    const newTabTitle =
      outputDestination?.new_tab_title || outputDestination?.newTabTitle || outputDestination?.new_tab_title_template;

    if (newTabTitle) {
      const rows = inferredItems.map((item: any) => headers.map((h) => item?.[h] ?? ''));
      const { sheetInfo, headerRow } = publishRowsToMemory({
        store,
        target: { sheetId, sheetTitle: resolvedSheetInfo?.sheetTitle, tabTitle: newTabTitle },
        headers,
        rows,
        schema: toolArgs?.schema,
      });
      const sheetInfoWithData = attachSheetData(store, sheetInfo);
      return {
        output: inferredItems,
        schemaHeaderSheetInfo: [
          {
            headingInfo: { schema: toolArgs?.schema || {}, headings: headerRow, title: sheetInfo.sheetTitle || sheetInfo.sheetTab },
            sheetInfo: sheetInfoWithData,
            headerRow,
          },
        ],
        error: response.data?.error,
        errorDetails: response.data?.errorDetails,
        creditsUsed: response.data?.creditsUsed,
        warnings: response.data?.warnings,
      };
    }

    const baseTab = sheetTabId !== undefined ? store.getTab(sheetId, sheetTabId) : store.getTabByTitle(sheetId, sheetTabTitle) || store.getTab(sheetId, 0);
    store.mergeHeaderRow(sheetId, baseTab.index, headers);
    if (toolArgs?.schema) store.setSchema(sheetId, baseTab.index, toolArgs.schema, { preserveHeader: true });

    const isFirstRowHeader = !!toolArgs?.is_first_row_header || !!toolArgs?.isFirstRowHeader;
    for (const item of inferredItems) {
      const rowNumber = item?.__row_number;
      const rowIndex0 = typeof rowNumber === 'number' ? rowNumber - 1 - (isFirstRowHeader ? 1 : 0) : undefined;
      if (rowIndex0 === undefined || rowIndex0 < 0) continue;
      const patch: Record<string, any> = {};
      headers.forEach((h) => {
        patch[h] = item?.[h] ?? '';
      });
      store.upsertColumnsByHeader(sheetId, baseTab.index, rowIndex0, patch);
    }

    const sheetInfo = store.toSheetInfo(sheetId, baseTab.index);
    const sheetInfoWithData = attachSheetData(store, sheetInfo);
    const headerRow = store.getTab(sheetId, baseTab.index).headerRow;

    return {
      output: inferredItems,
      schemaHeaderSheetInfo: [
        {
          headingInfo: { schema: toolArgs?.schema || {}, headings: headerRow, title: sheetInfo.sheetTitle || sheetInfo.sheetTab },
          sheetInfo: sheetInfoWithData,
          headerRow,
        },
      ],
      error: response.data?.error,
      errorDetails: response.data?.errorDetails,
      creditsUsed: response.data?.creditsUsed,
      warnings: response.data?.warnings,
    };
  }

  return {
    output: inferredItems,
    schemaHeaderSheetInfo: response.data?.schemaHeaderSheetInfo,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

async function executeQueryDocs({
  userQuestion,
  trajectoryId,
  plannerPrevSteps,
  onStatusUpdate,
  agentLog,
  ctx,
}: {
  userQuestion: string;
  trajectoryId: string;
  plannerPrevSteps?: any[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Querying docs...', 'Calling query_rtrvr_docs', 'execute');
  const request = {
    siteId: ctx.siteId,
    userQuestion,
    plannerPrevSteps,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.queryRtrvrDocs, request);
  if (!response?.success) return { error: response?.error || 'query_rtrvr_docs failed' };

  return {
    output: response.data?.text || response.data?.data,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

function shouldFallbackToMemoryArtifact(err: any): boolean {
  const envelope = toRoverErrorEnvelope(err);
  const msg = String(envelope.message || '').toLowerCase();
  return (
    envelope.code === 'MISSING_API_KEY' ||
    envelope.code === 'INVALID_API_KEY' ||
    envelope.code === 'UNAUTHENTICATED' ||
    msg.includes('oauth') ||
    msg.includes('auth token') ||
    msg.includes('access token') ||
    msg.includes('google')
  );
}

function buildMissingAuthToolResult(toolName: string, missing: string[] = ['authToken']): ToolExecutionResult {
  const errorEnvelope = {
    code: 'MISSING_AUTH_TOKEN',
    message: `${toolName} requires authentication token.`,
    missing,
    requires_api_key: missing.includes('apiKey'),
    retryable: false,
    next_action: 'Provide required auth token in tool args or rover.boot(...).',
  };

  return {
    output: buildStructuredErrorOutput(errorEnvelope),
    error: errorEnvelope.message,
    errorDetails: errorEnvelope,
    warnings: [`${toolName} skipped: missing ${missing.join(', ')}`],
  };
}

function buildMemoryArtifactFallback(
  type: 'doc' | 'slides',
  prompt: string,
  reason?: string,
): ToolExecutionResult {
  const title = type === 'doc' ? 'In-Memory Doc Draft' : 'In-Memory Slides Draft';
  const content =
    type === 'doc'
      ? `# ${title}\n\nPrompt:\n${prompt}`
      : `# ${title}\n\nSlide 1: ${prompt}\n\nSlide 2: Key points\n\nSlide 3: Summary`;
  const warning = reason || `${type === 'doc' ? 'Google Doc' : 'Google Slides'} generation fell back to in-memory draft.`;
  return {
    output: [content],
    generatedContentRef: {
      type: `${type}_draft`,
      title,
      content,
      degraded: true,
      fallback_mode: 'memory',
    },
    warnings: [warning],
  };
}

async function executeDocGenerator({
  userInput,
  toolArgs,
  tabOrder,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
  driveAuthToken,
}: {
  userInput: string;
  toolArgs: any;
  tabOrder: number[];
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
  driveAuthToken?: string;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Generating doc...', 'Calling google_doc_generator', 'execute');
  if (!driveAuthToken) {
    return buildMissingAuthToolResult('google_doc_generator', ['authToken']);
  }

  const pageData = await ctx.getPageData(tabOrder[0]);
  const request = {
    siteId: ctx.siteId,
    userInput,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    webPageMap: { [tabOrder[0]]: pageData },
    tabOrder,
    outputDestination: toolArgs?.output_destination || toolArgs?.outputDestination,
    plannerPrevSteps,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
  };

  let response: any;
  try {
    response = await ctx.callExtensionRouter(SUB_AGENTS.googleDocGenerator, request);
  } catch (err: any) {
    if (shouldFallbackToMemoryArtifact(err)) {
      const envelope = toRoverErrorEnvelope(err);
      return buildMemoryArtifactFallback('doc', userInput, envelope.message);
    }
    const envelope = toRoverErrorEnvelope(err, 'google_doc_generator failed');
    return {
      output: buildStructuredErrorOutput(envelope),
      error: envelope.message,
      errorDetails: envelope,
      warnings: envelope.message ? [envelope.message] : undefined,
    };
  }

  return {
    output: response.data?.llmOutput || response.data?.generatedContentRef,
    generatedContentRef: response.data?.generatedContentRef,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

async function executeSlidesGenerator({
  userInput,
  toolArgs,
  tabOrder,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
  driveAuthToken,
}: {
  userInput: string;
  toolArgs: any;
  tabOrder: number[];
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
  driveAuthToken?: string;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Generating slides...', 'Calling google_slides_generator', 'execute');
  if (!driveAuthToken) {
    return buildMissingAuthToolResult('google_slides_generator', ['authToken']);
  }

  const pageData = await ctx.getPageData(tabOrder[0]);
  const request = {
    siteId: ctx.siteId,
    userInput,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    webPageMap: { [tabOrder[0]]: pageData },
    tabOrder,
    outputDestination: toolArgs?.output_destination || toolArgs?.outputDestination,
    plannerPrevSteps,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
  };

  let response: any;
  try {
    response = await ctx.callExtensionRouter(SUB_AGENTS.googleSlidesGenerator, request);
  } catch (err: any) {
    if (shouldFallbackToMemoryArtifact(err)) {
      const envelope = toRoverErrorEnvelope(err);
      return buildMemoryArtifactFallback('slides', userInput, envelope.message);
    }
    const envelope = toRoverErrorEnvelope(err, 'google_slides_generator failed');
    return {
      output: buildStructuredErrorOutput(envelope),
      error: envelope.message,
      errorDetails: envelope,
      warnings: envelope.message ? [envelope.message] : undefined,
    };
  }

  return {
    output: response.data?.llmOutput || response.data?.generatedContentRef,
    generatedContentRef: response.data?.generatedContentRef,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

async function executeWebpageGenerator({
  userInput,
  toolArgs,
  tabOrder,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
}: {
  userInput: string;
  toolArgs: any;
  tabOrder: number[];
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Generating webpage...', 'Calling webpage_generator', 'execute');
  const pageData = await ctx.getPageData(tabOrder[0]);
  const request = {
    siteId: ctx.siteId,
    userInput,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    webPageMap: { [tabOrder[0]]: pageData },
    tabOrder,
    plannerPrevSteps,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
    outputDestination: toolArgs?.output_destination || toolArgs?.outputDestination,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.webpageGenerator, request);
  if (!response?.success) return { error: response?.error || 'webpage_generator failed' };

  return {
    output: response.data?.llmOutput || response.data?.generatedContentRef,
    generatedContentRef: response.data?.generatedContentRef,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

async function executePdfFiller({
  userInput,
  toolArgs,
  tabOrder,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
  driveAuthToken,
}: {
  userInput: string;
  toolArgs: any;
  tabOrder: number[];
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
  driveAuthToken?: string;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Filling PDF...', 'Calling pdf_filler', 'execute');
  if (!driveAuthToken) {
    return buildMissingAuthToolResult('pdf_filler', ['authToken']);
  }
  const pageData = await ctx.getPageData(tabOrder[0]);
  const request = {
    siteId: ctx.siteId,
    userInput,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    webPageMap: { [tabOrder[0]]: pageData },
    tabOrder,
    plannerPrevSteps,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
    outputDestination: toolArgs?.output_destination || toolArgs?.outputDestination,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.pdfFiller, request);
  if (!response?.success) return { error: response?.error || 'pdf_filler failed' };

  return {
    output: response.data?.llmOutput || response.data?.generatedContentRef,
    generatedContentRef: response.data?.generatedContentRef,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}

async function executeCustomToolGenerator({
  userInput,
  plannerPrevSteps,
  files,
  trajectoryId,
  onStatusUpdate,
  agentLog,
  ctx,
}: {
  userInput: string;
  plannerPrevSteps?: any[];
  files?: any[];
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  agentLog?: { prevSteps?: PreviousSteps[]; chatLog?: Array<{ role: 'user' | 'model'; message?: string }> };
  ctx: AgentContext;
}): Promise<ToolExecutionResult> {
  onStatusUpdate?.('Generating custom tool...', 'Calling custom_tool_generator', 'execute');
  const request = {
    siteId: ctx.siteId,
    userInput,
    plannerPrevSteps,
    agentLog: {
      prevSteps: agentLog?.prevSteps || [],
      chatLog: agentLog?.chatLog || [],
    },
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    authToken: '',
    timestamp: ctx.userTimestamp,
    trajectoryId,
    userProfile: ctx.userProfile,
    files,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.customToolGenerator, request);
  if (!response?.success) return { error: response?.error || 'custom_tool_generator failed' };

  return {
    output: response.data?.generatedTools || response.data?.output || response.data,
    generatedTools: response.data?.generatedTools,
    error: response.data?.error,
    errorDetails: response.data?.errorDetails,
    creditsUsed: response.data?.creditsUsed,
    warnings: response.data?.warnings,
  };
}
