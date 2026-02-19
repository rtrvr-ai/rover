import { SUB_AGENTS } from '@rover/shared/lib/types/agent-types.js';
import type { PlannerPreviousStep, PreviousSteps, StatusStage } from './types.js';
import { processActionResponse, waitWhilePaused, buildWorkerStopSignal } from './utils.js';
import type { AgentContext } from './context.js';
import { resolveRuntimeTabs } from './runtimeTabs.js';

export type ExtractOptions = {
  tabOrder: number[];
  userInput: string;
  schema?: any;
  outputDestination?: any;
  trajectoryId: string;
  recordingContext?: string;
  plannerPrevSteps?: PlannerPreviousStep[];
  files?: any[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  schemaHeaderSheetInfo?: any;
  returnDataOnly?: boolean;
  previousSteps?: PreviousSteps[];
  bridgeRpc: (method: string, params?: any) => Promise<any>;
  ctx: AgentContext;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
};

export type ExtractResult = {
  data?: any[];
  schemaHeaderSheetInfo?: any;
  prevSteps?: PreviousSteps[];
  error?: string;
  warnings?: string[];
  creditsUsed?: number;
};

const MAX_RETRIES = 3;

export async function executeExtract(options: ExtractOptions): Promise<ExtractResult> {
  const {
    tabOrder,
    userInput,
    schema,
    outputDestination,
    trajectoryId,
    recordingContext,
    plannerPrevSteps = [],
    files = [],
    onStatusUpdate,
    schemaHeaderSheetInfo,
    returnDataOnly,
    previousSteps = [],
    bridgeRpc,
    ctx,
    onPrevStepsUpdate,
  } = options;

  if (!tabOrder?.length) {
    return { error: 'No tabs available for extraction', warnings: ['No active tab found'] };
  }

  let totalCreditsUsed = 0;
  const warnings: string[] = [];
  const fallbackTabs = tabOrder.map(id => ({ id }));
  const prevSteps: PreviousSteps[] = Array.isArray(previousSteps) ? previousSteps : [];
  let pageDataOptions: { disableAutoScroll?: boolean } | undefined;

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    await waitWhilePaused(undefined);
    if (ctx.isCancelled?.()) {
      return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
    }
    const { activeTabId } = await resolveRuntimeTabs(bridgeRpc, fallbackTabs);
    if (ctx.isCancelled?.()) {
      return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
    }
    const tabId = activeTabId;

    let pageData: any;
    try {
      pageData = await ctx.getPageData(tabId, pageDataOptions);
    } catch {
      warnings.push(`Could not load page data for tab ${tabId}; retrying.`);
      continue;
    }

    const request = {
      siteId: ctx.siteId,
      userInput,
      schema,
      outputDestination,
      schemaHeaderSheetInfo,
      webPageMap: { [activeTabId]: pageData },
      tabOrder: [activeTabId],
      plannerPrevSteps,
      llmIntegration: ctx.llmIntegration,
      apiMode: ctx.apiMode,
      apiToolsConfig: ctx.apiToolsConfig,
      authToken: undefined,
      timestamp: ctx.userTimestamp,
      trajectoryId,
      userProfile: ctx.userProfile,
      recordingContext,
      files,
      returnDataOnly,
      stop: buildWorkerStopSignal({
        isCancelled: !!ctx.isCancelled?.(),
      }),
    };

    onStatusUpdate?.('Extracting data...', 'Calling extract sub-agent', 'execute');

    const response = await ctx.callExtensionRouter(SUB_AGENTS.extract, request);
    if (ctx.isCancelled?.()) {
      return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
    }
    if (!response?.success) {
      return { error: response?.error || 'Extract request failed', creditsUsed: totalCreditsUsed };
    }

    const data = response.data;
    totalCreditsUsed += data?.creditsUsed || 0;
    if (data?.warnings?.length) warnings.push(...data.warnings);

    if (data?.data && Array.isArray(data.data)) {
      return {
        data: data.data,
        schemaHeaderSheetInfo: data.schemaHeaderSheetInfo,
        prevSteps,
        creditsUsed: totalCreditsUsed,
        warnings,
      };
    }

    // Handle action-required responses
    const tabResponse = data?.tabResponses?.[activeTabId];
    if (tabResponse) {
      if (tabResponse?.stopState && tabResponse.stopState !== 'continue') {
        const stopReason =
          String(tabResponse.stopReason || tabResponse.error || '').trim()
          || `Execution stopped (${tabResponse.stopState})`;
        return { error: stopReason, prevSteps, creditsUsed: totalCreditsUsed, warnings };
      }
      const processResult = await processActionResponse({
        request,
        response: tabResponse,
        tabId: activeTabId,
        prevSteps,
        thought: tabResponse.thought,
        bridgeRpc,
        isCancelled: ctx.isCancelled,
        onPrevStepsUpdate,
      });
      if (ctx.isCancelled?.()) {
        return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
      }

      if (processResult.needsRetry) {
        pageDataOptions = processResult.disableAutoScroll ? { disableAutoScroll: true } : undefined;
        continue;
      }
      pageDataOptions = processResult.disableAutoScroll ? { disableAutoScroll: true } : undefined;
      if (processResult.data) {
        return {
          data: processResult.data,
          schemaHeaderSheetInfo: data.schemaHeaderSheetInfo,
          prevSteps,
          creditsUsed: totalCreditsUsed,
          warnings,
        };
      }

      if (processResult.functionCalls?.length) {
        for (const fc of processResult.functionCalls) {
          if (ctx.isCancelled?.()) {
            return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
          }
          try {
            await bridgeRpc('executeClientTool', { name: fc.name, args: fc.args });
            if (ctx.isCancelled?.()) {
              return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
            }
          } catch {
            if (ctx.isCancelled?.()) {
              return { error: 'Run cancelled', prevSteps, creditsUsed: totalCreditsUsed, warnings };
            }
            // ignore and continue; planner will replan if needed
          }
        }
      }
    }
  }

  return { error: 'Extract failed after retries', prevSteps, creditsUsed: totalCreditsUsed, warnings };
}
