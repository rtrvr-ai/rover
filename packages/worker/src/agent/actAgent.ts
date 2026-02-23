import { SUB_AGENTS } from '@rover/shared/lib/types/agent-types.js';
import type { PlannerPreviousStep, PlannerQuestion } from './types.js';
import {
  processActionResponse,
  formatFunctionResultsIntoPrevSteps,
  managePrevStepsSize,
  waitWhilePaused,
  buildWorkerStopSignal,
} from './utils.js';
import type { SystemNavigationOutcome } from './systemTools.js';
import type { FunctionCall, PreviousSteps, FunctionDeclaration, StatusStage } from './types.js';
import type { AgentContext } from './context.js';
import { resolveRuntimeTabs } from './runtimeTabs.js';

export type AgenticSeekOptions = {
  tabOrder: number[];
  scopedTabIds?: number[];
  seedTabId?: number;
  onScopedTabIdsTouched?: (tabIds: number[]) => void;
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
  errorDetails?: any;
  warnings?: string[];
  creditsUsed?: number;
  needsUserInput?: boolean;
  questions?: PlannerQuestion[];
  navigationPending?: boolean;
  navigationTool?: string;
  navigationOutcome?: SystemNavigationOutcome;
  logicalTabId?: number;
};

const MAX_RETRIES = 3;

function dedupePositiveTabIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of input) {
    const tabId = Number(value);
    if (!Number.isFinite(tabId) || tabId <= 0 || seen.has(tabId)) continue;
    seen.add(tabId);
    out.push(tabId);
  }
  return out;
}

export async function executeAgenticSeek(options: AgenticSeekOptions): Promise<AgenticSeekResult> {
  const {
    tabOrder,
    scopedTabIds,
    seedTabId,
    onScopedTabIdsTouched,
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
  let runtimeScopedTabIds = dedupePositiveTabIds(scopedTabIds || []);
  if (Number(seedTabId) > 0 && !runtimeScopedTabIds.includes(Number(seedTabId))) {
    runtimeScopedTabIds.unshift(Number(seedTabId));
  }
  const touchScopedTabIds = (tabIds: Array<number | undefined>): void => {
    const touched = dedupePositiveTabIds(tabIds);
    if (!touched.length) return;
    const nextScoped = dedupePositiveTabIds([...runtimeScopedTabIds, ...touched]);
    if (nextScoped.length === runtimeScopedTabIds.length && nextScoped.every((id, index) => id === runtimeScopedTabIds[index])) {
      return;
    }
    runtimeScopedTabIds = nextScoped;
    onScopedTabIdsTouched?.(nextScoped);
  };
  let retry = 0;
  let pageDataOptions: { disableAutoScroll?: boolean } | undefined;

  while (retry < MAX_RETRIES) {
    if (ctx.isCancelled?.()) {
      return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
    }

    try {
      await waitWhilePaused(undefined);
      if (ctx.isCancelled?.()) {
        return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }

      onStatusUpdate?.('Analyzing page content...', 'Calling seek workflow', 'analyze');

      const { tabOrder: runtimeTabOrder, activeTabId } = await resolveRuntimeTabs(bridgeRpc, fallbackTabs, {
        scopedTabIds: runtimeScopedTabIds,
        seedTabId,
      });
      if (ctx.isCancelled?.()) {
        return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }
      const scopedTabOrder = runtimeTabOrder.length ? runtimeTabOrder : tabOrder;
      const webPageMap: Record<number, any> = {};

      try {
        webPageMap[activeTabId] = await ctx.getPageData(activeTabId, {
          ...(pageDataOptions || {}),
          __roverAllowExternalFetch: true,
          __roverExternalIntent: 'auto',
          __roverExternalMessage: userInput,
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
      if (ctx.isCancelled?.()) {
        return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }

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
        stop: buildWorkerStopSignal({
          isCancelled: !!ctx.isCancelled?.(),
        }),
      };

      const response = await ctx.callExtensionRouter(SUB_AGENTS.processTabWorkflows, request);
      if (ctx.isCancelled?.()) {
        return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }
      if (!response?.success) {
        return {
          error: response?.error || 'Failed to process tab workflows',
          errorDetails: response?.errorDetails || undefined,
          creditsUsed: totalCreditsUsed,
        };
      }

      const data = response.data;
      totalCreditsUsed += data?.creditsUsed || 0;

      const tabResponse = data?.tabResponses?.[activeTabId];
      if (!tabResponse) {
        retry++;
        continue;
      }

      if (tabResponse?.warnings?.length) allWarnings.push(...tabResponse.warnings);
      if (tabResponse?.stopState && tabResponse.stopState !== 'continue') {
        const stopReason =
          String(tabResponse.stopReason || tabResponse.error || '').trim()
          || `Execution stopped (${tabResponse.stopState})`;
        return { error: stopReason, prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed, warnings: allWarnings };
      }
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
        isCancelled: ctx.isCancelled,
        userFunctionDeclarations: functionDeclarations,
        onStatusUpdate,
        onPrevStepsUpdate,
      });
      if (ctx.isCancelled?.()) {
        return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
      }

      if (processResult.needsRetry) {
        pageDataOptions = processResult.disableAutoScroll ? { disableAutoScroll: true } : undefined;
        retry++;
        continue;
      }

      if (processResult.navigationOccurred) {
        const navigationOutcome = processResult.navigationOutcome;
        const logicalTabId = Number(processResult.logicalTabId);
        if (Number.isFinite(logicalTabId) && logicalTabId > 0) {
          touchScopedTabIds([logicalTabId]);
        }
        if (
          navigationOutcome === 'new_tab_opened'
          || navigationOutcome === 'switch_tab'
        ) {
          if (Number.isFinite(logicalTabId) && logicalTabId > 0) {
            try {
              await bridgeRpc('executeTool', {
                call: {
                  name: 'switch_tab',
                  args: {
                    logical_tab_id: logicalTabId,
                    tab_id: logicalTabId,
                  },
                },
                payload: {
                  reason: 'act_loop_navigation_continue',
                },
              });
            } catch {
              // Best-effort. Runtime tab resolver will re-evaluate active tab on next loop.
            }
          }
        }
        pageDataOptions = processResult.disableAutoScroll ? { disableAutoScroll: true } : undefined;
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
          if (ctx.isCancelled?.()) {
            return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
          }
          try {
            const result = await bridgeRpc('executeClientTool', { name: fc.name, args: fc.args });
            if (ctx.isCancelled?.()) {
              return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
            }
            functionResults[fc.callId!] = { success: true, result };
          } catch (error: any) {
            if (ctx.isCancelled?.()) {
              return { error: 'Run cancelled', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed };
            }
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
        return {
          error: error?.message || 'Agentic seek failed',
          errorDetails: error?.roverError || undefined,
          prevSteps: accumulatedPrevSteps,
          creditsUsed: totalCreditsUsed,
        };
      }
      await new Promise(resolve => setTimeout(resolve, 500 * retry));
    }
  }

  return { error: 'Max retries reached', prevSteps: accumulatedPrevSteps, creditsUsed: totalCreditsUsed, warnings: allWarnings };
}
