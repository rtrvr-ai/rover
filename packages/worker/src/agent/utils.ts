import {
  HTML_CONTENT_TYPE,
  MAX_PREV_STEPS,
} from '@rover/shared/lib/utils/constants.js';
import { systemToolNamesSet } from '@rover/shared/lib/system-tools/tools.js';
import type { FunctionCall, FunctionDeclaration, PreviousSteps, StatusStage } from './types.js';
import type { LLMFunction } from './systemTools.js';
import { executeSystemToolCallsSequentially } from './systemTools.js';

const SYSTEM_TOOL_ALIASES: Record<string, string> = {
  open_url_new_tab: 'open_new_tab',
};

export const DEFAULT_WEBPAGEMAP = {
  url: '',
  title: '',
  contentType: HTML_CONTENT_TYPE,
};

export async function waitWhilePaused(executionRef?: { current: { state: string } }) {
  if (!executionRef) return;
  while (executionRef.current.state === 'paused') {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function fetchTabDataOptimized({
  tabOrder,
  getPageData,
  webPageInput,
}: {
  tabOrder: number[];
  getPageData: (tabId: number, options?: any) => Promise<any>;
  webPageInput?: Record<number, any>;
}): Promise<{
  webPageMap: Record<number, any>;
  deletedTabIds: number[];
}> {
  const webPageMap: Record<number, any> = {};
  const deletedTabIds: number[] = [];

  for (const tabId of tabOrder) {
    try {
      if (webPageInput?.[tabId]) {
        webPageMap[tabId] = { ...webPageInput[tabId] };
        continue;
      }
      webPageMap[tabId] = await getPageData(tabId);
    } catch (err) {
      deletedTabIds.push(tabId);
    }
  }

  return { webPageMap, deletedTabIds };
}

export async function processActionResponse({
  request,
  response,
  tabId,
  prevSteps,
  thought,
  bridgeRpc,
  userFunctionDeclarations,
  onStatusUpdate,
  onPrevStepsUpdate,
}: {
  request: any;
  response: any;
  tabId: number;
  prevSteps: PreviousSteps[];
  thought?: string;
  bridgeRpc: (method: string, params?: any) => Promise<any>;
  userFunctionDeclarations?: FunctionDeclaration[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
}): Promise<{
  needsRetry: boolean;
  data?: Record<string, unknown>[];
  functionCalls?: FunctionCall[];
  disableAutoScroll?: boolean;
}> {
  const { functionCalls, modelParts, data, accTreeId } = response || {};
  let disableAutoScroll = false;

  if (data && Array.isArray(data) && data.length > 0) {
    prevSteps.push({ accTreeId, thought, modelParts, data: JSON.stringify(data) });
    limitPrevSteps(prevSteps);
    onPrevStepsUpdate?.(prevSteps);
    onStatusUpdate?.('Data extracted successfully', thought, 'verify');
    return { needsRetry: false, data };
  }

  if (Array.isArray(functionCalls) && functionCalls.length > 0) {
    const systemCalls: FunctionCall[] = [];
    const externalCalls: FunctionCall[] = [];

    for (const call of functionCalls) {
      const rawName = String(call?.name || '');
      const alias = SYSTEM_TOOL_ALIASES[rawName];
      if (alias) {
        systemCalls.push({
          ...call,
          name: alias,
        });
        continue;
      }

      if (call?.name && systemToolNamesSet.has(call.name)) {
        systemCalls.push(call);
      } else {
        externalCalls.push(call);
      }
    }

    if (externalCalls.length > 0) {
      // Validate external calls if declarations provided
      if (userFunctionDeclarations?.length) {
        for (const funcCall of externalCalls) {
          const found = userFunctionDeclarations.find(decl => decl.name === funcCall.name);
          if (!found) {
            prevSteps.push({
              accTreeId,
              thought,
              modelParts,
              fail: `Invalid tool name "${funcCall.name}"`,
              functions: externalCalls.map(fc => ({
                name: fc.name || 'unknown',
                args: fc.args || {},
                response: { status: 'Failure', error: 'Invalid tool' },
              })),
            });
            limitPrevSteps(prevSteps);
            onPrevStepsUpdate?.(prevSteps);
            return { needsRetry: true };
          }
        }
      }

      onStatusUpdate?.(`Requesting external functions: ${externalCalls.map(c => c.name).join(', ')}`, thought, 'execute');
      limitPrevSteps(prevSteps);
      onPrevStepsUpdate?.(prevSteps);
      return { needsRetry: false, functionCalls: externalCalls };
    }

    if (systemCalls.length > 0) {
      onStatusUpdate?.(`Executing browser actions: ${systemCalls.map(c => c.name).join(', ')}`, thought, 'execute');
      prevSteps.push({
        accTreeId,
        thought,
        modelParts,
        functions: systemCalls.map(fc => ({
          name: fc.name || 'unknown',
          args: fc.args || {},
          response: { status: 'Pending execution' },
        })),
      });
      limitPrevSteps(prevSteps);
      onPrevStepsUpdate?.(prevSteps);

      const stepIndex = prevSteps.length - 1;
      const { results, disableAutoScroll: isScroll } = await executeSystemToolCallsSequentially({
        calls: systemCalls,
        bridgeRpc,
      });
      disableAutoScroll = isScroll;

      if (stepIndex >= 0 && stepIndex < prevSteps.length) {
        prevSteps[stepIndex].functions = results as unknown as LLMFunction[];
        const failedCount = results.filter(r => r.response.status === 'Failure').length;
        if (failedCount > 0) {
          prevSteps[stepIndex].fail = `${failedCount} tool(s) failed.`;
        }
      }

      limitPrevSteps(prevSteps);
      onPrevStepsUpdate?.(prevSteps);
      return { needsRetry: false, disableAutoScroll };
    }
  }

  prevSteps.push({ accTreeId, thought, modelParts, fail: 'Empty or unusable response' });
  limitPrevSteps(prevSteps);
  onPrevStepsUpdate?.(prevSteps);
  return { needsRetry: true };
}

export function limitPrevSteps(prevSteps: PreviousSteps[]): void {
  if (prevSteps.length <= MAX_PREV_STEPS) return;
  const recentStepsToKeep = MAX_PREV_STEPS - 1;
  const firstStep = prevSteps[0];
  const recentSteps = prevSteps.slice(-recentStepsToKeep);
  prevSteps.length = 0;
  prevSteps.push(firstStep, ...recentSteps);
}

export function managePrevStepsSize(prevSteps: PreviousSteps[], maxSteps = 3) {
  if (maxSteps < 1 || prevSteps.length === 0) return;
  let firstTreeIndex = -1;
  for (let i = 0; i < prevSteps.length; i++) {
    if (prevSteps[i].accTreeId !== undefined) {
      firstTreeIndex = i;
      break;
    }
  }
  if (firstTreeIndex === -1) return;

  const targetRecentTrees = Math.max(0, maxSteps - 1);
  let recentTreesKept = 0;

  for (let i = prevSteps.length - 1; i >= 0; i--) {
    if (prevSteps[i].accTreeId !== undefined) {
      if (i === firstTreeIndex) continue;
      if (recentTreesKept < targetRecentTrees) {
        recentTreesKept++;
      } else {
        delete prevSteps[i].accTreeId;
      }
    }
  }
}

export function formatFunctionResultsIntoPrevSteps(
  results: Record<string, any>,
  functionCalls: Array<FunctionCall & { callId?: string }>,
): PreviousSteps[] {
  const steps: PreviousSteps[] = [];

  for (const funcCall of functionCalls) {
    const name = funcCall.name || 'unknown';
    const key = funcCall.callId ?? name;
    const result = results[key] ?? results[name];

    steps.push({
      functions: [
        {
          name,
          args: funcCall.args || {},
          response: {
            status: result?.success ? 'Success' : 'Failure',
            error: result?.error?.message || result?.error,
            output: result?.result,
          },
        },
      ],
    });
  }

  return steps;
}
