import { SUB_AGENTS } from '@rover/shared';
import type { PlannerOptions, PlannerResponse, PlannerPreviousStep, FunctionDeclaration, PreviousSteps } from './types.js';
import type { AgentContext } from './context.js';
import { executeToolFromPlan } from './toolExecutor.js';
import { resolveRuntimeTabs } from './runtimeTabs.js';

const MAX_PLANNER_DEPTH = 15;
const MAX_CHATLOG_ENTRIES = 24;
const MAX_CHATLOG_MESSAGE_CHARS = 1000;

function normalizeChatLog(
  entries: Array<{ role?: 'user' | 'model'; message?: string }> | undefined,
): Array<{ role: 'user' | 'model'; message: string }> {
  if (!Array.isArray(entries) || !entries.length) return [];

  return entries
    .map(entry => ({
      role: entry?.role === 'user' ? ('user' as const) : ('model' as const),
      message: String(entry?.message || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(entry => !!entry.message)
    .map(entry => ({
      role: entry.role,
      message:
        entry.message.length > MAX_CHATLOG_MESSAGE_CHARS
          ? `${entry.message.slice(0, MAX_CHATLOG_MESSAGE_CHARS - 1)}…`
          : entry.message,
    }))
    .slice(-MAX_CHATLOG_ENTRIES);
}

export async function executePlanner(options: PlannerOptions & {
  ctx: AgentContext;
  bridgeRpc?: (method: string, params?: any) => Promise<any>;
  functionDeclarations?: FunctionDeclaration[];
}) {
  const {
    userInput,
    tabs,
    previousMessages = [],
    trajectoryId,
    previousSteps = [],
    files,
    continuePlanning = false,
    recordingContext,
    driveAuthToken,
    agentLog,
    lastToolPreviousSteps,
    ctx,
    bridgeRpc,
    functionDeclarations,
  } = options;

  const fallbackTabs = Array.isArray(tabs) && tabs.length ? tabs : [{ id: 1 }];
  const resolvedTabs = await resolveRuntimeTabs(bridgeRpc, fallbackTabs);
  const tabOrder = resolvedTabs.tabOrder.length ? resolvedTabs.tabOrder : fallbackTabs.map(tab => tab.id);
  const activeTabId = resolvedTabs.activeTabId;
  const tabMetaById = resolvedTabs.tabMetaById;
  const webPageMap: Record<number, any> = {};

  const loadPageData = async (tabId: number, options?: { allowExternalFetch?: boolean }) => {
    try {
      return await ctx.getPageData(tabId, {
        onlyTextContent: false,
        ...(options?.allowExternalFetch ? { __roverAllowExternalFetch: true } : {}),
      });
    } catch {
      const tab = tabMetaById[tabId];
      return {
        url: tab?.url || '',
        title: tab?.title || (tab?.external ? 'External Tab (Inaccessible)' : ''),
        content: '',
        contentType: 'text/html',
      };
    }
  };

  webPageMap[activeTabId] = await loadPageData(activeTabId, { allowExternalFetch: true });
  const backgroundTabIds = tabOrder.filter(tabId => tabId !== activeTabId);
  const backgroundResults = await Promise.all(
    backgroundTabIds.map(async tabId => ({ tabId, pageData: await loadPageData(tabId) })),
  );
  for (const { tabId, pageData } of backgroundResults) {
    webPageMap[tabId] = pageData;
  }

  const chatLog =
    agentLog?.chatLog?.length
      ? normalizeChatLog(agentLog.chatLog)
      : normalizeChatLog(
          previousMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role === 'user' ? 'user' : 'model', message: m.content })),
        );

  const request = {
    siteId: ctx.siteId,
    userInput,
    webPageMap: Object.keys(webPageMap).length ? webPageMap : undefined,
    tabOrder,
    recordingContext,
    previousSteps,
    lastToolPreviousSteps,
    chatLog: chatLog.length ? chatLog : undefined,
    llmIntegration: ctx.llmIntegration,
    apiMode: ctx.apiMode,
    apiToolsConfig: ctx.apiToolsConfig,
    files,
    userFunctionDeclarations: functionDeclarations,
    authToken: driveAuthToken || '',
    timestamp: ctx.userTimestamp,
    continuePlanning,
    trajectoryId,
    userProfile: ctx.userProfile,
  };

  const response = await ctx.callExtensionRouter(SUB_AGENTS.plan, request);
  if (!response?.success) {
    return { taskComplete: false, error: response?.error || 'Planner failed' };
  }

  const planData = response.data;
  return {
    plan: planData.plan,
    questions: planData.questions,
    taskComplete: planData.taskComplete || false,
    modelParts: planData.modelParts,
    overallThought: planData.overallThought,
    accTreeIds: planData.accTreeIds,
    error: planData.error,
    errorDetails: planData.errorDetails,
    warnings: planData.warnings,
    userUsageData: planData.userUsageData || { creditsUsed: planData.creditsUsed || 0 },
  };
}

export async function executePlannerWithTools(
  options: PlannerOptions & { ctx: AgentContext; bridgeRpc: (method: string, params?: any) => Promise<any>; functionDeclarations?: FunctionDeclaration[] },
  accumulatedToolResults: any[] = [],
  depth = 0,
): Promise<PlannerResponse> {
  if (depth >= MAX_PLANNER_DEPTH) {
    return {
      response: { taskComplete: false, error: `Max planner recursion depth reached (${MAX_PLANNER_DEPTH})` },
      toolResults: accumulatedToolResults,
      completedWorkflow: undefined,
      previousSteps: options.previousSteps || [],
    };
  }

  if (options.ctx.isCancelled?.()) {
    return {
      response: { taskComplete: false, error: 'Run cancelled' },
      toolResults: accumulatedToolResults,
      completedWorkflow: undefined,
      previousSteps: options.previousSteps || [],
    };
  }

  let currentPreviousSteps: PlannerPreviousStep[] = options.previousSteps || [];
  let lastToolPreviousSteps: PreviousSteps[] | undefined = options.lastToolPreviousSteps || options.agentLog?.prevSteps;

  const plannerResponse = await executePlanner({
    ...options,
    previousSteps: currentPreviousSteps,
    ctx: options.ctx,
    functionDeclarations: options.functionDeclarations,
  });

  if (plannerResponse.questions && plannerResponse.questions.length > 0) {
    options.onStatusUpdate?.('Planner needs more input', plannerResponse.overallThought, 'verify');
    const questionStep: PlannerPreviousStep = {
      modelParts: plannerResponse.modelParts,
      thought: plannerResponse.overallThought,
      questionsAsked: plannerResponse.questions,
    };
    currentPreviousSteps = [...currentPreviousSteps, questionStep];
    options.onPlannerHistoryUpdate?.(currentPreviousSteps);

    return {
      response: plannerResponse,
      toolResults: accumulatedToolResults,
      completedWorkflow: undefined,
      previousSteps: currentPreviousSteps,
    };
  }

  if (plannerResponse.plan && !plannerResponse.error) {
    const plan = plannerResponse.plan;
    options.onStatusUpdate?.(
      `Planner selected ${plan.toolName}`,
      plan.thought ?? plannerResponse.overallThought,
      'execute',
    );
    const toolResult = await executeToolFromPlan({
      ...options,
      toolName: plan.toolName,
      toolArgs: plan.parameters,
      plannerPrevSteps: currentPreviousSteps,
      agentLog: {
        prevSteps: lastToolPreviousSteps || options.agentLog?.prevSteps,
        chatLog: options.agentLog?.chatLog,
      },
      ctx: options.ctx,
      bridgeRpc: options.bridgeRpc,
      functionDeclarations: options.functionDeclarations,
      onPrevStepsUpdate: options.onPrevStepsUpdate,
    });

    accumulatedToolResults.push(toolResult);
    if (toolResult.prevSteps?.length) {
      lastToolPreviousSteps = toolResult.prevSteps;
      options.onPrevStepsUpdate?.(lastToolPreviousSteps);
    }

    const completedStep: PlannerPreviousStep = {
      modelParts: plannerResponse.modelParts,
      thought: plan.thought ?? plannerResponse.overallThought,
      toolCall: { name: plan.toolName, args: plan.parameters },
      textOutput: toolResult.output,
      error: toolResult.error,
      schemaHeaderSheetInfo: toolResult.schemaHeaderSheetInfo,
      generatedContentRef: toolResult.generatedContentRef,
      lastToolPreviousSteps: toolResult.prevSteps,
    };

    currentPreviousSteps = [...currentPreviousSteps, completedStep];
    options.onPlannerHistoryUpdate?.(currentPreviousSteps);

    if (toolResult.error && !plannerResponse.taskComplete) {
      return executePlannerWithTools(
        {
          ...options,
          previousSteps: currentPreviousSteps,
          lastToolPreviousSteps: lastToolPreviousSteps || options.lastToolPreviousSteps,
          continuePlanning: true,
        },
        accumulatedToolResults,
        depth + 1,
      );
    }

    if (!plannerResponse.taskComplete && !toolResult.error) {
      return executePlannerWithTools(
        {
          ...options,
          previousSteps: currentPreviousSteps,
          lastToolPreviousSteps: lastToolPreviousSteps || options.lastToolPreviousSteps,
          continuePlanning: true,
        },
        accumulatedToolResults,
        depth + 1,
      );
    }

    return {
      response: plannerResponse,
      toolResults: accumulatedToolResults,
      completedWorkflow: undefined,
      previousSteps: currentPreviousSteps,
    };
  }

  if (plannerResponse.taskComplete) {
    options.onStatusUpdate?.('Planner marked task complete', plannerResponse.overallThought, 'complete');
    const completionStep: PlannerPreviousStep = {
      modelParts: plannerResponse.modelParts,
      thought: plannerResponse.overallThought || 'Task completed',
    };
    currentPreviousSteps = [...currentPreviousSteps, completionStep];
    options.onPlannerHistoryUpdate?.(currentPreviousSteps);
    return { response: plannerResponse, toolResults: accumulatedToolResults, completedWorkflow: undefined, previousSteps: currentPreviousSteps };
  }

  return { response: plannerResponse, toolResults: accumulatedToolResults, completedWorkflow: undefined, previousSteps: currentPreviousSteps };
}
