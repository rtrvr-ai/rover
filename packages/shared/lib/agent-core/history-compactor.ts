import type { PlannerPrevStep, PrevStep, PrevStepFunction } from './types.js';

export type CompactMode = 'agent_tool' | 'planner';

export const DEFAULT_PLANNER_LIMITS = {
  keepFullTail: 5,
  maxTextOutputChars: 1200,
};

export const DEFAULT_AGENT_TOOL_LIMITS = {
  keepFirst: true,
  fullSteps: 8,
  liteSteps: 18,
  maxFunctionsPerStep: 12,
  maxArgChars: 500,
  maxTextChars: 1200,
  maxDataChars: 6000,
  maxErrorChars: 1500,
  keepLastResponseSteps: 2,
};

function truncate(input: unknown, maxChars: number): unknown {
  if (typeof input !== 'string') return input;
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}… [truncated ${input.length - maxChars} chars]`;
}

function sanitizeArgs(value: unknown, maxChars: number): unknown {
  if (value == null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(entry => sanitizeArgs(entry, maxChars));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) {
      out[key] = entry;
      continue;
    }
    if (typeof entry === 'string') {
      out[key] = truncate(entry, maxChars);
      continue;
    }
    if (typeof entry === 'object') {
      out[key] = sanitizeArgs(entry, maxChars);
      continue;
    }
    out[key] = entry;
  }
  return out;
}

function pruneToolResponse(
  response: PrevStepFunction['response'],
  keepFull: boolean,
  limits: typeof DEFAULT_AGENT_TOOL_LIMITS,
): PrevStepFunction['response'] {
  if (!response || typeof response !== 'object') return response;

  if (!keepFull) {
    const error = typeof response.error === 'string'
      ? truncate(response.error, limits.maxErrorChars)
      : response.error;
    return {
      ...response,
      error,
    };
  }

  return response;
}

function compactFunction(
  fn: PrevStepFunction,
  limits: typeof DEFAULT_AGENT_TOOL_LIMITS,
  keepFullResponse: boolean,
): PrevStepFunction {
  return {
    name: fn.name,
    args: sanitizeArgs(fn.args || {}, limits.maxArgChars) as Record<string, unknown>,
    response: pruneToolResponse(fn.response, keepFullResponse, limits) as Record<string, unknown> | undefined,
  };
}

export function buildLLMPrevStepsForAgentTool(
  prevSteps: PrevStep[],
  overrides?: Partial<typeof DEFAULT_AGENT_TOOL_LIMITS>,
): PrevStep[] {
  const limits = { ...DEFAULT_AGENT_TOOL_LIMITS, ...(overrides || {}) };
  if (!Array.isArray(prevSteps) || prevSteps.length === 0) return [];

  const length = prevSteps.length;
  const fullFrom = Math.max(0, length - limits.fullSteps);
  const liteFrom = Math.max(0, length - (limits.fullSteps + limits.liteSteps));

  const selectedTailStart = limits.keepFirst ? 1 : 0;
  const selected: PrevStep[] = [
    ...(limits.keepFirst && prevSteps[0] ? [prevSteps[0]] : []),
    ...prevSteps.slice(Math.max(selectedTailStart, liteFrom)),
  ];

  const keepFullResponseFrom = Math.max(0, selected.length - limits.keepLastResponseSteps);

  return selected.map((step, selectedIdx) => {
    const sourceIdx = prevSteps.indexOf(step);
    const isFirst = sourceIdx === 0 && limits.keepFirst;
    const isFull = isFirst || sourceIdx >= fullFrom;
    const isLite = !isFull && sourceIdx >= liteFrom;

    const base: PrevStep = {
      accTreeId: step.accTreeId,
      fail: step.fail,
      userFeedback: isFull ? step.userFeedback : undefined,
    };

    if (isFull) {
      const keepFullResponse = selectedIdx >= keepFullResponseFrom;
      return {
        ...step,
        thought: truncate(step.thought, limits.maxTextChars) as string | undefined,
        data: truncate(step.data, limits.maxDataChars) as string | undefined,
        modelParts: undefined,
        functions: Array.isArray(step.functions)
          ? step.functions
            .slice(-limits.maxFunctionsPerStep)
            .map(fn => compactFunction(fn, limits, keepFullResponse))
          : step.functions,
      };
    }

    if (isLite) {
      return {
        ...base,
        thought: step.thought ? (truncate(step.thought, 200) as string) : undefined,
        modelParts: undefined,
        data: typeof step.data === 'string' ? (truncate(step.data, 300) as string) : undefined,
        functions: Array.isArray(step.functions)
          ? step.functions
            .slice(-Math.min(6, limits.maxFunctionsPerStep))
            .map(fn => compactFunction(fn, limits, false))
          : undefined,
      };
    }

    return {
      ...base,
      thought: undefined,
      modelParts: undefined,
      data: undefined,
      functions: Array.isArray(step.functions)
        ? [{ name: 'tool_trace_summary', args: {}, response: { status: 'Success' } }]
        : undefined,
    };
  });
}

export function buildLLMSheetDataLogForAgentTool<T extends { prevSteps?: PrevStep[]; answer?: unknown; functionCalls?: unknown }>(
  sheetDataLog: Record<number, T>,
  tabOrder: number[],
): Record<number, T> {
  const output: Record<number, T> = {};
  for (const tabId of tabOrder) {
    const entry = sheetDataLog[tabId] || ({} as T);
    output[tabId] = {
      ...(entry as object),
      prevSteps: buildLLMPrevStepsForAgentTool((entry as any).prevSteps || []),
      answer: (entry as any).answer,
      functionCalls: (entry as any).functionCalls,
    } as T;
  }
  return output;
}

export function flattenExtractPrevStepsForUI<T extends { prevSteps?: PrevStep[] }>(
  tabOrder: number[],
  sheetDataLog: Record<number, T>,
): PrevStep[] {
  const output: PrevStep[] = [];
  for (const tabId of tabOrder) {
    const steps = (sheetDataLog[tabId] as any)?.prevSteps || [];
    for (const step of steps) {
      output.push({
        ...step,
        thought: step.thought ? `[tab ${tabId}] ${step.thought}` : step.thought,
      });
    }
  }
  return output;
}

export function compactPlannerPrevStepsForLLM(
  steps: PlannerPrevStep[],
  overrides?: Partial<typeof DEFAULT_PLANNER_LIMITS>,
): PlannerPrevStep[] {
  const limits = { ...DEFAULT_PLANNER_LIMITS, ...(overrides || {}) };
  if (!Array.isArray(steps) || steps.length === 0) return [];

  const length = steps.length;
  const fullFrom = Math.max(0, length - limits.keepFullTail);

  return steps.map((step, idx) => {
    const isFull = idx >= fullFrom;
    const compactTextOutput = Array.isArray(step.textOutput)
      ? step.textOutput.map(value => (typeof value === 'string' ? truncate(value, limits.maxTextOutputChars) : value))
      : step.textOutput;

    return {
      ...step,
      textOutput: compactTextOutput,
      modelParts: isFull ? step.modelParts : undefined,
      thought: isFull ? step.thought : step.thought ? (truncate(step.thought, 160) as string) : undefined,
    };
  });
}
