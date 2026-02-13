import { SystemToolNames } from '@rover/shared/lib/system-tools/tools.js';
import type { FunctionCall } from './types.js';

export type LLMFunction = {
  name: string;
  args: Record<string, any>;
  response: {
    status: 'Success' | 'Failure' | 'Pending execution';
    error?: string;
    output?: any;
    allowFallback?: boolean;
  };
};

export type SystemToolBatchResult = {
  results: LLMFunction[];
  disableAutoScroll: boolean;
  navigationOccurred: boolean;
  navigationTool?: SystemToolNames;
};

const NAVIGATION_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.goto_url,
  SystemToolNames.google_search,
  SystemToolNames.go_back,
  SystemToolNames.go_forward,
  SystemToolNames.refresh_page,
  SystemToolNames.switch_tab,
  SystemToolNames.close_tab,
]);

const VIEWPORT_SENSITIVE_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.scroll_page,
  SystemToolNames.scroll_to_element,
  SystemToolNames.mouse_wheel,
  SystemToolNames.swipe_element,
  SystemToolNames.pinch_zoom,
  SystemToolNames.dispatch_pointer_path,
  SystemToolNames.hover_element,
  SystemToolNames.focus_element,
]);

const ACTION_DELAY_MS = 600;

export async function executeSystemToolCallsSequentially({
  calls,
  bridgeRpc,
}: {
  calls: FunctionCall[];
  bridgeRpc: (method: string, params?: any) => Promise<any>;
}): Promise<SystemToolBatchResult> {
  const results: LLMFunction[] = [];
  let sawViewportSensitiveToolSuccess = false;
  let navigationOccurred = false;
  let navigationTool: SystemToolNames | undefined;

  for (const call of calls) {
    const name = call.name as SystemToolNames;
    const args = (call.args || {}) as Record<string, any>;

    if (navigationOccurred) {
      const skippedResult = {
        name: name || 'unknown',
        args,
        response: {
          status: 'Failure',
          error: `Tool '${name}' skipped because navigation tool '${navigationTool}' already ran. Re-plan using new page state.`,
          output: undefined,
          allowFallback: true,
        },
      } satisfies LLMFunction;
      results.push(skippedResult);
      continue;
    }

    let response: any;
    try {
      response = await bridgeRpc('executeTool', { call });
    } catch (err: any) {
      response = { success: false, error: err?.message || String(err), allowFallback: true };
    }

    const llmResponse = {
      status: response?.success ? 'Success' : 'Failure',
      error: response?.error,
      output: response?.output,
      allowFallback: response?.allowFallback,
    } as const;

    const resolvedResult = { name: name || 'unknown', args, response: llmResponse } satisfies LLMFunction;
    results.push(resolvedResult);

    if (response?.success) {
      if (NAVIGATION_TOOLS.has(name)) {
        navigationOccurred = true;
        navigationTool = name;
        sawViewportSensitiveToolSuccess = false;
      } else if (VIEWPORT_SENSITIVE_TOOLS.has(name)) {
        sawViewportSensitiveToolSuccess = true;
      }
    }

    if (ACTION_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, ACTION_DELAY_MS));
    }
  }

  const disableAutoScroll = sawViewportSensitiveToolSuccess && !navigationOccurred;
  return { results, disableAutoScroll, navigationOccurred, navigationTool };
}
