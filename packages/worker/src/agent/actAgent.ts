import { SUB_AGENTS } from '@rover/shared/lib/types/agent-types.js';
import type { PlannerPreviousStep, PlannerQuestion } from './types.js';
import { processActionResponse, formatFunctionResultsIntoPrevSteps, managePrevStepsSize, waitWhilePaused } from './utils.js';
import type { FunctionCall, PreviousSteps, FunctionDeclaration, StatusStage } from './types.js';
import type { AgentContext } from './context.js';
import { resolveRuntimeTabs } from './runtimeTabs.js';

export type AgenticSeekOptions = {
  tabOrder: number[];
  userInput: string;
  schema?: any;
  previousSteps?: PreviousSteps[];
  plannerPrevSteps?: PlannerPreviousStep[];
  files?: any[];
  chatLog?: any[];
  recordingContext?: string;
  trajectoryId: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  functionDeclarations?: FunctionDeclaration[];
  bridgeRpc: (method: string, params?: any) => Promise<any>;
  ctx: AgentContext;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
};

export type AgenticSeekResult = {
  data?: Record<string, unknown>[];
  functionCalls?: FunctionCall[];
  prevSteps?: PreviousSteps[];
  error?: string;
  warnings?: string[];
  creditsUsed?: number;
  needsUserInput?: boolean;
  questions?: PlannerQuestion[];
};

const MAX_RETRIES = 3;
const MAX_ITERATIONS = 25;

export async function executeAgenticSeek(options: AgenticSeekOptions): Promise<AgenticSeekResult> {
  const {
    tabOrder,
    userInput,
    schema,
    previousSteps = [],
    plannerPrevSteps = [],
    files = [],
    chatLog = [],
    recordingContext,
    trajectoryId,
    onStatusUpdate,
    functionDeclarations,
    bridgeRpc,
    ctx,
    onPrevStepsUpdate,
  } = options;

  if (!tabOrder?.length) {
    return { error: 'No tabs available for processing', warnings: ['No active tab found'] };
  }

  let totalCreditsUsed = 0;
  const allWarnings: string[] = [];
  const accumulatedPrevSteps: PreviousSteps[] = Array.isArray(previousSteps) ? previousSteps : [];
  const fallbackTabs = tabOrder.map(id => ({ id }));
  let retry = 0;
  let iterations = 0;
  let pageDataOptions: { disableAutoScroll?: boolean } | undefined;

  while (retry < MAX_RETRIES) {
    if (iterations++ >= MAX_ITERATIONS) {
      return { error: 'Max action iterations reached', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
    }

    if (ctx.isCancelled?.()) {
      return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
    }

    try {
      await waitWhilePaused(undefined);

      onStatusUpdate?.('Analyzing page content...', 'Calling seek workflow', 'analyze');

      const { tabOrder: runtimeTabOrder, activeTabId } = await resolveRuntimeTabs(bridgeRpc, fallbackTabs);
      const scopedTabOrder = runtimeTabOrder.length ? runtimeTabOrder : tabOrder;
      const webPageMap: Record<number, any> = {};

      try {
        webPageMap[activeTabId] = await ctx.getPageData(activeTabId, {
          ...(pageDataOptions || {}),
          __roverAllowExternalFetch: true,
        });
      } catch {
        retry++;
        continue;
      }

      const backgroundTabIds = scopedTabOrder.filter(currentTabId => currentTabId !== activeTabId);
      const backgroundResults = await Promise.all(
        backgroundTabIds.map(async currentTabId => {
          try {
            const pageData = await ctx.getPageData(currentTabId);
            return { tabId: currentTabId, pageData };
          } catch {
            return { tabId: currentTabId, pageData: undefined };
          }
        }),
      );

      for (const result of backgroundResults) {
        if (result.pageData) {
          webPageMap[result.tabId] = result.pageData;
        } else {
          allWarnings.push(`Could not load page data for tab ${result.tabId}; continuing with remaining tabs.`);
        }
      }

      if (!webPageMap[activeTabId]) {
        retry++;
        continue;
      }

      const request = {
        siteId: ctx.siteId,
        customTabWorkflow: 'Seek',
        webPageMap,
        tabOrder: scopedTabOrder,
        activeTabId,
        userInput,
        dataJsonSchema: schema,
        files,
        recordingContext,
        agentLog: { prevSteps: accumulatedPrevSteps, chatLog },
        plannerPrevSteps,
        llmIntegration: ctx.llmIntegration,
        apiMode: ctx.apiMode,
        apiToolsConfig: ctx.apiToolsConfig,
        functionDeclarations,
        authToken: undefined,
        timestamp: ctx.userTimestamp,
        trajectoryId,
        userProfile: ctx.userProfile,
      };

      const response = await ctx.callExtensionRouter(SUB_AGENTS.processTabWorkflows, request);
      if (!response?.success) {
        return { error: response?.error || 'Failed to process tab workflows', creditsUsed: totalCreditsUsed };
      }

      const data = response.data;
      totalCreditsUsed += data?.creditsUsed || 0;

      const tabResponse = data?.tabResponses?.[activeTabId];
      if (!tabResponse) {
        retry++;
        continue;
      }

      if (tabResponse?.warnings?.length) allWarnings.push(...tabResponse.warnings);
      if (tabResponse?.error) {
        retry++;
        continue;
      }

      const processResult = await processActionResponse({
        request,
        response: tabResponse,
        tabId: activeTabId,
        prevSteps: accumulatedPrevSteps,
        thought: tabResponse.thought,
        bridgeRpc,
        userFunctionDeclarations: functionDeclarations,
        onStatusUpdate,
        onPrevStepsUpdate,
      });

      if (processResult.needsRetry) {
        pageDataOptions = processResult.disableAutoScroll ? { disableAutoScroll: true } : undefined;
        retry++;
        continue;
      }

      if (processResult.data) {
        managePrevStepsSize(accumulatedPrevSteps);
        onPrevStepsUpdate?.(accumulatedPrevSteps);
        return {
          data: processResult.data,
          prevSteps: accumulatedPrevSteps,
          creditsUsed: totalCreditsUsed,
          warnings: allWarnings,
        };
      }

      if (processResult.needsUserInput && Array.isArray(processResult.questions) && processResult.questions.length > 0) {
        managePrevStepsSize(accumulatedPrevSteps);
        onPrevStepsUpdate?.(accumulatedPrevSteps);
        return {
          prevSteps: accumulatedPrevSteps,
          creditsUsed: totalCreditsUsed,
          warnings: allWarnings,
          needsUserInput: true,
          questions: processResult.questions,
        };
      }

      if (processResult.functionCalls?.length) {
        const functionCallsWithIds = processResult.functionCalls.map((fc, index) => ({
          ...fc,
          callId: `${fc.name || 'fn'}:${index}`,
        }));

        const functionResults: Record<string, any> = {};
        for (const fc of functionCallsWithIds) {
          try {
            const result = await bridgeRpc('executeClientTool', { name: fc.name, args: fc.args });
            functionResults[fc.callId!] = { success: true, result };
          } catch (error: any) {
            functionResults[fc.callId!] = { success: false, error: { message: error?.message || String(error) } };
          }
        }

        accumulatedPrevSteps.push(...formatFunctionResultsIntoPrevSteps(functionResults, functionCallsWithIds));
        managePrevStepsSize(accumulatedPrevSteps);
        onPrevStepsUpdate?.(accumulatedPrevSteps);
      }

      pageDataOptions = processResult.disableAutoScroll ? { disableAutoScroll: true } : undefined;

      // Continue loop to allow next action cycle
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }
      retry++;
      if (retry >= MAX_RETRIES) {
        return { error: error?.message || 'Agentic seek failed', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }
      await new Promise(resolve => setTimeout(resolve, 500 * retry));
    }
  }

  return { error: 'Max retries reached', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed, warnings: allWarnings };
}
