import { executePlannerWithTools } from './plannerAgent.js';
import { executeToolFromPlan } from './toolExecutor.js';
import { parseMessage, validateFunctionCall, convertParametersToTypes } from './toolParser.js';
import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';
import type { MessageOrchestratorOptions, PlannerOptions, FunctionDeclaration, TaskRoutingMode, ToolExecutionResult } from './types.js';
import type { AgentContext } from './context.js';

export interface OrchestratorResult {
  processedMessage: string;
  executedFunctions: ExecutedFunction[];
  shouldRunPlanner: boolean;
  error?: string;
}

export interface ExecutedFunction {
  name: string;
  parameters: Record<string, any>;
  result?: any;
  error?: string;
  isRequired: boolean;
  prevSteps?: any[];
}

type RoutingDecision = {
  mode: Exclude<TaskRoutingMode, 'auto'>;
  score?: number;
  reason: string;
};

export type HandleSendMessageResult = {
  success: boolean;
  processedMessage: string;
  error?: string;
  executedFunctions?: ExecutedFunction[];
  plannerResponse?: any;
  directToolResult?: ToolExecutionResult;
  route?: RoutingDecision;
};

const COMPLEX_TASK_HINTS = [
  'extract',
  'compare',
  'list',
  'across',
  'multiple',
  'many',
  'report',
  'document',
  'spreadsheet',
  'sheet',
  'table',
  'csv',
  'json',
  'pdf',
  'slides',
];

const MULTI_LABEL_TLDS = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'com.br',
  'com.mx',
  'com.sg',
  'co.in',
]);

function extractHostFromUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function registrableDomain(host: string): string {
  const clean = String(host || '').trim().toLowerCase().replace(/^\.+/, '');
  if (!clean) return '';
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return clean;
  const parts = clean.split('.').filter(Boolean);
  if (parts.length < 2) return clean;
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (parts.length >= 3 && MULTI_LABEL_TLDS.has(tail2)) {
    return `${parts[parts.length - 3]}.${tail2}`;
  }
  return tail2;
}

function hasCrossDomainPlanDependency(
  userInput: string,
  tabs: Array<{ url?: string }> | undefined,
): boolean {
  const currentUrl = String(
    tabs?.find(tab => typeof tab?.url === 'string' && String(tab.url || '').trim())?.url || '',
  );
  const currentDomain = registrableDomain(extractHostFromUrl(currentUrl));
  if (!currentDomain) return false;
  const urls = String(userInput || '').match(/https?:\/\/[^\s)]+/g) || [];
  if (!urls.length) return false;
  return urls.some(url => {
    const targetDomain = registrableDomain(extractHostFromUrl(url));
    return !!targetDomain && targetDomain !== currentDomain;
  });
}

function computeComplexityScore(text: string): number {
  const input = String(text || '').toLowerCase().trim();
  if (!input) return 0;

  let score = 0;
  const actionVerbs = new Set(
    (input.match(/\b(click|open|go|navigate|fill|type|submit|extract|find|search|compare|summarize|collect|download|upload|create|generate|report)\b/g) || [])
      .map(v => v.toLowerCase()),
  );

  if (input.length > 120) score += 1;
  if (actionVerbs.size >= 2) score += 1;
  if ((input.match(/\b(and then|then|after|next|finally|first|second|third)\b/g) || []).length >= 1) score += 2;
  if ((input.match(/\b(extract|compare|list|all|each|every|across|multiple|many)\b/g) || []).length >= 2) score += 2;
  if (/https?:\/\/|www\./.test(input)) score += 2;
  if ((input.match(/\b(report|document|doc|spreadsheet|sheet|table|csv|json|pdf|slides|summary)\b/g) || []).length >= 1) score += 2;

  for (const hint of COMPLEX_TASK_HINTS) {
    if (input.includes(hint)) {
      score += 0.25;
    }
  }

  // Keep direct single-step UI commands on the fast ACT path.
  const words = input.split(/\s+/).filter(Boolean);
  if (/^(click|type|fill|open|go to|scroll|press|select)\b/.test(input) && words.length <= 10) {
    score = Math.max(0, score - 2);
  }

  return Math.max(0, Math.min(10, Math.round(score)));
}

function decideRouting(
  message: string,
  options: Pick<MessageOrchestratorOptions, 'taskRouting' | 'previousSteps'>,
): RoutingDecision {
  const mode = options.taskRouting?.mode || 'act';
  if (mode === 'planner') {
    return { mode: 'planner', reason: 'Configured planner mode' };
  }
  if (mode === 'act') {
    return { mode: 'act', reason: 'Configured act mode' };
  }

  const hasAwaitingUserChain = Array.isArray(options.previousSteps)
    && options.previousSteps.some(step =>
      Array.isArray((step as any)?.questionsAsked)
      && (step as any).questionsAsked.length > 0
      && !((step as any)?.userAnswers && Object.keys((step as any).userAnswers).length > 0),
    );
  if (hasAwaitingUserChain) {
    const score = computeComplexityScore(message);
    return {
      mode: 'planner',
      score,
      reason: 'Forced planner due to awaiting_user continuation chain.',
    };
  }

  const score = computeComplexityScore(message);
  if (score >= 7) {
    return {
      mode: 'planner',
      score,
      reason: `Complexity score ${score} >= 7`,
    };
  }
  return {
    mode: 'act',
    score,
    reason: `Complexity score ${score} < 7`,
  };
}

function hasUsableActOutcome(actResult: any): boolean {
  if (!actResult || typeof actResult !== 'object') return false;
  if (actResult.error) return false;
  const hasNonEmptyValue = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== undefined && value !== null;
  };

  if (hasNonEmptyValue(actResult.data)) return true;
  if (actResult.navigationPending === true) return true;
  if (actResult.needsUserInput === true) return true;

  const output = (actResult as any).output;
  if (!output) return false;
  if (typeof output === 'string') return output.trim().length > 0;
  if (typeof output !== 'object') return hasNonEmptyValue(output);
  if ((output as any).success === false || (output as any).error) return false;

  const navigationOutcome = String((output as any).navigationOutcome || '').trim().toLowerCase();
  if (navigationOutcome === 'same_tab_scheduled' || navigationOutcome === 'new_tab_opened') return true;
  if ((output as any).navigationPending === true) return true;
  if ((output as any).needsUserInput === true || (output as any).waitingForUserInput === true) return true;
  if (Array.isArray((output as any).questions) && (output as any).questions.length > 0) return true;
  if (String((output as any).taskStatus || '').trim().toLowerCase() === 'in_progress') return true;
  if ((output as any).taskComplete === true) return true;
  if (hasNonEmptyValue((output as any).data)) return true;
  if (typeof (output as any).response === 'string' && String((output as any).response || '').trim()) return true;
  if (hasNonEmptyValue(output)) return true;
  return false;
}

export async function processMessageWithFunctions(
  options: MessageOrchestratorOptions & { ctx: AgentContext; bridgeRpc: (method: string, params?: any) => Promise<any>; functionDeclarations?: FunctionDeclaration[] },
): Promise<OrchestratorResult> {
  const { message, toolFunctions } = options;
  const parsed = parseMessage(message);
  const executedFunctions: ExecutedFunction[] = [];

  if (parsed.functionCalls.length === 0) {
    return { processedMessage: message, executedFunctions: [], shouldRunPlanner: true };
  }

  const validationResults = parsed.functionCalls.map(call => ({
    call,
    validation: validateFunctionCall(call.functionName, toolFunctions || {}),
  }));

  const invalid = validationResults.filter(r => !r.validation.isValid);
  if (invalid.length > 0) {
    return {
      processedMessage: parsed.cleanedMessage,
      executedFunctions: [],
      shouldRunPlanner: false,
      error: invalid.map(r => r.validation.error).join('; '),
    };
  }

  const allRequired = validationResults.every(r => r.validation.isRequired);
  const allUserDefined = validationResults.every(r => r.validation.isUserDefined || r.validation.isMcp);
  const hasOnlyFunctionCalls = parsed.hasOnlyFunctionCalls;

  if (hasOnlyFunctionCalls && (allRequired || allUserDefined)) {
    for (const { call, validation } of validationResults) {
      if (validation.isRequired && validation.mappedFunction) {
        const toolArgs = {
          user_input: call.parameters.prompt || call.parameters.user_input || call.parameters.task_instruction || '',
          ...call.parameters,
        };
        const result = await executeToolFromPlan({
          ...options,
          toolName: validation.mappedFunction,
          toolArgs,
          userInput: toolArgs.user_input,
          tabs: options.tabs,
          trajectoryId: options.trajectoryId,
          plannerPrevSteps: options.previousSteps,
          agentLog: options.agentLog,
          ctx: options.ctx,
          bridgeRpc: options.bridgeRpc,
          functionDeclarations: options.functionDeclarations,
          onPrevStepsUpdate: options.onPrevStepsUpdate,
        });
        executedFunctions.push({
          name: call.functionName,
          parameters: call.parameters,
          result: result.output,
          error: result.error,
          isRequired: true,
          prevSteps: result.prevSteps,
        });
      } else if (validation.functionDef) {
        try {
          const typedParams = convertParametersToTypes(call.parameters, validation.functionDef);
          const res = await options.bridgeRpc('executeClientTool', { name: call.functionName, args: typedParams });
          executedFunctions.push({
            name: call.functionName,
            parameters: typedParams,
            result: res,
            isRequired: false,
          });
        } catch (err: any) {
          executedFunctions.push({
            name: call.functionName,
            parameters: call.parameters,
            error: err?.message || String(err),
            isRequired: false,
          });
        }
      }
    }

    return {
      processedMessage: parsed.cleanedMessage,
      executedFunctions,
      shouldRunPlanner: false,
    };
  }

  return { processedMessage: message, executedFunctions: [], shouldRunPlanner: true };
}

export async function handleSendMessageWithFunctions(
  userInput: string,
  context: Omit<MessageOrchestratorOptions, 'message'> & { ctx: AgentContext; bridgeRpc: (method: string, params?: any) => Promise<any>; functionDeclarations?: FunctionDeclaration[] },
): Promise<HandleSendMessageResult> {
  context.onStatusUpdate?.('Analyzing request', userInput, 'analyze');
  const result = await processMessageWithFunctions({ ...context, message: userInput });

  if (result.error) {
    return { success: false, processedMessage: result.processedMessage, error: result.error };
  }

  if (result.executedFunctions.length > 0 && !result.shouldRunPlanner) {
    return { success: true, processedMessage: result.processedMessage, executedFunctions: result.executedFunctions };
  }

  if (result.shouldRunPlanner) {
    const routing = decideRouting(userInput, context);
    context.onStatusUpdate?.(`Route selected: ${routing.mode}`, routing.reason, 'route');
    let routedAgentPrevSteps = context.agentLog?.prevSteps;
    if (routing.mode === 'act') {
      context.onStatusUpdate?.('Executing action plan', 'Using ACT tool loop', 'execute');
      const actStartedAt = Date.now();
      const actResult = await executeToolFromPlan({
        ...context,
        toolName: PLANNER_FUNCTION_CALLS.ACT,
        toolArgs: { user_input: userInput },
        userInput,
        tabs: context.tabs,
        trajectoryId: context.trajectoryId,
        plannerPrevSteps: context.previousSteps,
        agentLog: context.agentLog,
        ctx: context.ctx,
        bridgeRpc: context.bridgeRpc,
        functionDeclarations: context.functionDeclarations,
        onPrevStepsUpdate: context.onPrevStepsUpdate,
      });
      if (Array.isArray(actResult.prevSteps) && actResult.prevSteps.length > 0) {
        routedAgentPrevSteps = actResult.prevSteps;
        context.onPrevStepsUpdate?.(routedAgentPrevSteps);
      }

      const actElapsedMs = Date.now() - actStartedAt;
      const actFunctionCount = Array.isArray(actResult.prevSteps?.[actResult.prevSteps.length - 1]?.functions)
        ? actResult.prevSteps![actResult.prevSteps!.length - 1].functions!.length
        : 0;
      const recoverableFailures = Array.isArray(actResult.prevSteps)
        ? actResult.prevSteps.reduce((count, step) => {
            const failures = Array.isArray(step.functions)
              ? step.functions.filter(fn => fn?.response?.status === 'Failure').length
              : 0;
            return count + failures;
          }, 0)
        : 0;
      const crossDomainPlanDependency = hasCrossDomainPlanDependency(userInput, context.tabs || []);
      const actProducedUsableOutcome = hasUsableActOutcome(actResult);

      const shouldEscalateToPlanner =
        !actProducedUsableOutcome
        && (
          (
            !!actResult.error &&
            (context.taskRouting?.plannerOnActError ?? true) &&
            context.taskRouting?.mode !== 'act'
          )
          || actElapsedMs > 8_000
          || actFunctionCount > 3
          || recoverableFailures >= 2
          || crossDomainPlanDependency
        );

      if (!shouldEscalateToPlanner) {
        return {
          success: !actResult.error,
          processedMessage: result.processedMessage,
          directToolResult: actResult,
          route: routing,
          error: actResult.error,
        };
      }
    }

    const plannerOptions: PlannerOptions & { ctx: AgentContext; bridgeRpc: (method: string, params?: any) => Promise<any>; functionDeclarations?: FunctionDeclaration[] } = {
      ...context,
      userInput,
      continuePlanning: false,
      agentLog: {
        prevSteps: routedAgentPrevSteps || context.agentLog?.prevSteps,
        chatLog: context.agentLog?.chatLog,
      },
      lastToolPreviousSteps: routedAgentPrevSteps || context.lastToolPreviousSteps,
      ctx: context.ctx,
      bridgeRpc: context.bridgeRpc,
      functionDeclarations: context.functionDeclarations,
      onPrevStepsUpdate: context.onPrevStepsUpdate,
      onPlannerHistoryUpdate: context.onPlannerHistoryUpdate,
    };

    const plannerResult = await executePlannerWithTools(plannerOptions, []);
    return {
      success: !plannerResult.response.error,
      processedMessage: result.processedMessage,
      plannerResponse: plannerResult,
      route: routing,
      error: plannerResult.response.error,
    };
  }

  return { success: true, processedMessage: result.processedMessage };
}
