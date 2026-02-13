import { SUB_AGENTS } from '@rover/shared';
import type { PlannerOptions, PlannerResponse, PlannerPreviousStep, FunctionDeclaration, PreviousSteps } from './types.js';
import type { AgentContext } from './context.js';
import { executeToolFromPlan } from './toolExecutor.js';

export async function executePlanner(options: PlannerOptions & { ctx: AgentContext; functionDeclarations?: FunctionDeclaration[] }) {
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
    functionDeclarations,
  } = options;

  const tabOrder = tabs.map(t => t.id);
  const webPageMap: Record<number, any> = {};
  for (const tab of tabs) {
    try {
      webPageMap[tab.id] = await ctx.getPageData(tab.id, { onlyTextContent: false });
    } catch {
      webPageMap[tab.id] = { url: tab.url || '', title: tab.title || '', content: '', contentType: 'text/html' };
    }
  }

  const chatLog =
    agentLog?.chatLog?.length
      ? agentLog.chatLog
      : previousMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role === 'user' ? 'user' : 'model', message: m.content }));

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
): Promise<PlannerResponse> {
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
