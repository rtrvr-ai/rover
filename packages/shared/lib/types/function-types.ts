// packages/shared/lib/types/function-types.ts

import type { CustomFunction } from './index.js';
import type { FunctionCall } from '@google/genai';

export interface CustomFunctionMetadata {
  id: string;
  name: string;
  description: string;
  llmCallable: string; // Firebase only stores as string
}

export enum FUNCTION_CALL_STATE_ORIGIN {
  planner = 'planner',
  planner_multi_step = 'planner_multi_step',
  direct_user_call = 'direct_user_call',
  task_rerun = 'task_rerun',
  agent_execution = 'agent_execution',
  scheduled_task = 'scheduled_task',
  sheets_workflow = 'sheets_workflow',
}

export interface FunctionCallArgs {
  functionToExecute: CustomFunction;
  parameters: { [key: string]: any };
  sourceLLMCall?: FunctionCall;
}
