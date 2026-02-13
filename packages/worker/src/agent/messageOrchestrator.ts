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
  'plan',
  'research',
  'compare',
  'summarize',
  'table',
  'spreadsheet',
  'sheet',
  'extract',
  'crawl',
  'workflow',
  'across',
  'multi',
  'multiple',
  'then',
  'after',
  'finally',
  'slides',
  'document',
  'website',
  'webpage',
  'pdf',
];

function computeComplexityScore(text: string): number {
  const input = String(text || '').toLowerCase().trim();
  if (!input) return 0;

  let score = 0;
  const words = input.split(/\s+/).filter(Boolean);
  if (words.length >= 14) score += 1;
  if (words.length >= 26) score += 1;
  if ((input.match(/\b(and then|then|after that|next|finally)\b/g) || []).length >= 1) score += 1;
  if ((input.match(/[;,]/g) || []).length >= 2) score += 1;
  if (/https?:\/\/|www\./.test(input)) score += 1;
  if (/\b(json|csv|table|schema|columns?)\b/.test(input)) score += 1;

  for (const hint of COMPLEX_TASK_HINTS) {
    if (input.includes(hint)) {
      score += 1;
    }
  }

  if (/^(click|type|fill|open|go to|scroll|press|select)\b/.test(input) && words.length <= 10) {
    score = Math.max(0, score - 2);
  }

  return score;
}

function decideRouting(message: string, options: Pick<MessageOrchestratorOptions, 'taskRouting'>): RoutingDecision {
  const mode = options.taskRouting?.mode || 'act';
  if (mode === 'planner') {
    return { mode: 'planner', reason: 'Configured planner mode' };
  }
  if (mode === 'act') {
    return { mode: 'act', reason: 'Configured act mode' };
  }

  const threshold = Math.max(1, Number(options.taskRouting?.actHeuristicThreshold) || 5);
  const score = computeComplexityScore(message);
  if (score >= threshold) {
    return {
      mode: 'planner',
      score,
      reason: `Complexity score ${score} >= threshold ${threshold}`,
    };
  }
  return {
    mode: 'act',
    score,
    reason: `Complexity score ${score} < threshold ${threshold}`,
  };
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

      const shouldEscalateToPlanner =
        !!actResult.error &&
        (context.taskRouting?.plannerOnActError ?? true) &&
        context.taskRouting?.mode !== 'act';

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
