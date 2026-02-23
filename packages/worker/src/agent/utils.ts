import {
  HTML_CONTENT_TYPE,
  MAX_PREV_STEPS,
} from '@rover/shared/lib/utils/constants.js';
import { systemToolNamesSet } from '@rover/shared/lib/system-tools/tools.js';
import type {
  FunctionCall,
  FunctionDeclaration,
  PlannerQuestion,
  PreviousSteps,
  RoverStopSignal,
  StatusStage,
} from './types.js';
import type { LLMFunction, SystemNavigationOutcome } from './systemTools.js';
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

export function buildWorkerStopSignal(params: {
  isCancelled?: boolean;
  reason?: string;
}): RoverStopSignal {
  if (params.isCancelled) {
    return {
      state: 'cancel_requested',
      reason: params.reason || 'worker_cancelled',
    };
  }
  return { state: 'continue' };
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
  isCancelled,
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
  isCancelled?: () => boolean;
  userFunctionDeclarations?: FunctionDeclaration[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
}): Promise<{
  needsRetry: boolean;
  data?: Record<string, unknown>[];
  functionCalls?: FunctionCall[];
  disableAutoScroll?: boolean;
  navigationOccurred?: boolean;
  navigationTool?: string;
  navigationOutcome?: SystemNavigationOutcome;
  logicalTabId?: number;
  needsUserInput?: boolean;
  questions?: PlannerQuestion[];
}> {
  const throwIfCancelled = () => {
    if (!isCancelled?.()) return;
    throw new DOMException('Run cancelled', 'AbortError');
  };

  throwIfCancelled();
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
    const askUserCall = functionCalls.find(call => String(call?.name || '').trim().toLowerCase() === 'ask_user');
    if (askUserCall) {
      const deferredSiblingCalls = functionCalls
        .filter(call => call && call !== askUserCall && typeof call.name === 'string' && call.name.trim())
        .map(call => ({
          name: String(call.name || 'unknown'),
          args: call.args || {},
          response: {
            status: 'Failure' as const,
            error: "Skipped because ask_user was called. Wait for user answers before executing other tools.",
            allowFallback: true,
            output: {
              status: 'deferred_after_ask_user',
            },
          },
        }));
      const questions = normalizeAskUserQuestions((askUserCall as any)?.args?.questions_to_ask);
      if (!questions.length) {
        prevSteps.push({
          accTreeId,
          thought,
          modelParts,
          fail: "ask_user called with invalid or empty 'questions_to_ask'",
          functions: [
            {
              name: 'ask_user',
              args: (askUserCall as any)?.args || {},
              response: {
                status: 'Failure',
                error: "Missing/invalid 'questions_to_ask'",
                allowFallback: false,
              },
            },
            ...deferredSiblingCalls,
          ],
        });
        limitPrevSteps(prevSteps);
        onPrevStepsUpdate?.(prevSteps);
        return { needsRetry: true };
      }

      prevSteps.push({
        accTreeId,
        thought,
        modelParts,
        functions: [
          {
            name: 'ask_user',
            args: {
              questions_to_ask: questions.map(question => ({
                key: question.key,
                query: question.query,
                ...(question.required === false ? { required: false } : {}),
              })),
            },
            response: {
              status: 'Success',
              output: {
                status: 'waiting_input',
                needsUserInput: true,
                questions,
              },
            },
          },
          ...deferredSiblingCalls,
        ],
      });
      limitPrevSteps(prevSteps);
      onPrevStepsUpdate?.(prevSteps);
      onStatusUpdate?.('Need user clarification to continue', thought, 'verify');
      return {
        needsRetry: false,
        needsUserInput: true,
        questions,
      };
    }

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
      throwIfCancelled();
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
      throwIfCancelled();
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
      const {
        results,
        disableAutoScroll: isScroll,
        navigationOccurred,
        navigationTool,
        navigationOutcome,
        logicalTabId,
      } = await executeSystemToolCallsSequentially({
        calls: systemCalls,
        bridgeRpc,
        isCancelled,
      });
      disableAutoScroll = isScroll;
      throwIfCancelled();

      if (stepIndex >= 0 && stepIndex < prevSteps.length) {
        prevSteps[stepIndex].functions = results as unknown as LLMFunction[];
        const failedCount = results.filter(r => r.response.status === 'Failure').length;
        if (failedCount > 0) {
          prevSteps[stepIndex].fail = `${failedCount} tool(s) failed.`;
        }
      }

      // Inject system observation for blocked navigations so the LLM acknowledges and continues
      if (navigationOutcome === 'blocked') {
        const blockedUrl = results.find(r => r.response?.output && typeof r.response.output === 'object'
          && (r.response.output as Record<string, unknown>).navigationOutcome === 'blocked')
          ?.response?.output;
        const blockedDomain = blockedUrl && typeof blockedUrl === 'object'
          ? String((blockedUrl as Record<string, unknown>).blockedDomain || '')
          : '';
        const instruction = blockedUrl && typeof blockedUrl === 'object'
          ? String((blockedUrl as Record<string, unknown>).agentInstruction || '')
          : '';
        prevSteps.push({
          thought: `[System] Navigation was blocked${blockedDomain ? ` to ${blockedDomain}` : ''}. ${instruction || 'Acknowledge to user and proceed with next step.'}`,
          functions: [{
            name: '_system_observation',
            args: { type: 'navigation_blocked', blockedDomain },
            response: {
              status: 'Success',
              output: { observation: 'navigation_blocked', blockedDomain, instruction } as any,
            },
          }],
        });
      }

      limitPrevSteps(prevSteps);
      onPrevStepsUpdate?.(prevSteps);
      return {
        needsRetry: false,
        disableAutoScroll,
        navigationOccurred,
        navigationTool,
        navigationOutcome,
        logicalTabId,
      };
    }
  }

  prevSteps.push({ accTreeId, thought, modelParts, fail: 'Empty or unusable response' });
  limitPrevSteps(prevSteps);
  onPrevStepsUpdate?.(prevSteps);
  return { needsRetry: true };
}

function normalizeAskUserQuestions(rawQuestions: unknown): PlannerQuestion[] {
  if (!Array.isArray(rawQuestions)) return [];
  const out: PlannerQuestion[] = [];
  const seenKeys = new Set<string>();

  for (const item of rawQuestions) {
    if (!item || typeof item !== 'object') continue;
    const rawKey = String((item as any).key || '').trim();
    const query = resolveQuestionText(item);
    if (!rawKey || !query) continue;
    if (seenKeys.has(rawKey)) continue;
    seenKeys.add(rawKey);
    const hasRequired = typeof (item as any).required === 'boolean';
    const hasOptional = typeof (item as any).optional === 'boolean';
    const required = hasRequired ? !!(item as any).required : (hasOptional ? !(item as any).optional : true);
    out.push({
      key: rawKey,
      query,
      ...(typeof (item as any).question === 'string' && (item as any).question.trim()
        ? { question: String((item as any).question).trim() }
        : {}),
      ...(typeof (item as any).id === 'string' && (item as any).id.trim()
        ? { id: String((item as any).id).trim() }
        : {}),
      ...(Array.isArray((item as any).choices) ? { choices: (item as any).choices } : {}),
      required,
    });
  }

  return out.slice(0, 6);
}

function resolveQuestionText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const question = String((raw as any).query || (raw as any).question || '').trim();
  if (!question) return '';
  return question;
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
