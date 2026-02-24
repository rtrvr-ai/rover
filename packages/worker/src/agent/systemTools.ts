import { SystemToolNames } from '@rover/shared/lib/system-tools/tools.js';
import type { FunctionCall, RuntimeToolOutput } from './types.js';

export type LLMFunction = {
  name: string;
  args: Record<string, any>;
  response: {
    status: 'Success' | 'Failure' | 'Pending execution';
    error?: string;
    output?: RuntimeToolOutput;
    allowFallback?: boolean;
  };
};

type BridgeToolResponse = {
  success?: boolean;
  error?: string;
  allowFallback?: boolean;
  output?: RuntimeToolOutput;
};

export type SystemNavigationOutcome =
  | 'same_tab_scheduled'
  | 'same_host_navigated'
  | 'subdomain_navigated'
  | 'new_tab_opened'
  | 'blocked'
  | 'switch_tab';

export type SystemToolBatchResult = {
  results: LLMFunction[];
  disableAutoScroll: boolean;
  navigationOccurred: boolean;
  navigationTool?: SystemToolNames;
  navigationOutcome?: SystemNavigationOutcome;
  logicalTabId?: number;
};

const NAVIGATION_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.goto_url,
  SystemToolNames.google_search,
  SystemToolNames.go_back,
  SystemToolNames.go_forward,
  SystemToolNames.refresh_page,
  SystemToolNames.open_new_tab,
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
const NAVIGATION_OUTCOMES = new Set<SystemNavigationOutcome>([
  'same_tab_scheduled',
  'same_host_navigated',
  'subdomain_navigated',
  'new_tab_opened',
  'blocked',
  'switch_tab',
]);

function throwIfCancelled(isCancelled?: () => boolean): void {
  if (!isCancelled?.()) return;
  throw new DOMException('Run cancelled', 'AbortError');
}

export async function executeSystemToolCallsSequentially({
  calls,
  bridgeRpc,
  isCancelled,
}: {
  calls: FunctionCall[];
  bridgeRpc: (method: string, params?: any) => Promise<BridgeToolResponse>;
  isCancelled?: () => boolean;
}): Promise<SystemToolBatchResult> {
  const results: LLMFunction[] = [];
  let sawViewportSensitiveToolSuccess = false;
  let navigationOccurred = false;
  let navigationTool: SystemToolNames | undefined;
  let navigationOutcome: SystemNavigationOutcome | undefined;
  let logicalTabId: number | undefined;

  for (const call of calls) {
    throwIfCancelled(isCancelled);

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

    let response: BridgeToolResponse;
    try {
      throwIfCancelled(isCancelled);
      response = await bridgeRpc('executeTool', { call });
    } catch (err: any) {
      throwIfCancelled(isCancelled);
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
      const output = response?.output && typeof response.output === 'object'
        ? response.output as Record<string, unknown>
        : undefined;

      const outputNavigationOutcomeRaw = String(output?.navigationOutcome || '').trim().toLowerCase();
      const outputNavigationOutcome =
        NAVIGATION_OUTCOMES.has(outputNavigationOutcomeRaw as SystemNavigationOutcome)
          ? outputNavigationOutcomeRaw as SystemNavigationOutcome
          : undefined;
      const outputNavigationPending = output?.navigationPending === true;
      const outputOpenedInNewTab = output?.openedInNewTab === true;
      const inferredNavigation =
        !!outputNavigationOutcome
        || outputNavigationPending
        || outputOpenedInNewTab;

      if (NAVIGATION_TOOLS.has(name) || inferredNavigation) {
        navigationOccurred = true;
        navigationTool = name;
        sawViewportSensitiveToolSuccess = false;
        if (outputNavigationOutcome) {
          navigationOutcome = outputNavigationOutcome;
        } else if (outputOpenedInNewTab) {
          navigationOutcome = 'new_tab_opened';
        } else if (name === SystemToolNames.switch_tab) {
          navigationOutcome = 'switch_tab';
        } else if (name === SystemToolNames.open_new_tab) {
          navigationOutcome = 'new_tab_opened';
        } else if (outputNavigationPending) {
          navigationOutcome = 'same_tab_scheduled';
        } else {
          navigationOutcome = 'same_tab_scheduled';
        }

        const outputLogicalTabId = Number(
          output?.logicalTabId
          ?? output?.logical_tab_id
          ?? output?.tabId
          ?? output?.tab_id
          ?? args?.logical_tab_id
          ?? args?.tab_id,
        );
        if (Number.isFinite(outputLogicalTabId) && outputLogicalTabId > 0) {
          logicalTabId = outputLogicalTabId;
        }
      } else if (VIEWPORT_SENSITIVE_TOOLS.has(name)) {
        sawViewportSensitiveToolSuccess = true;
      }
    }

    if (ACTION_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, ACTION_DELAY_MS));
      throwIfCancelled(isCancelled);
    }
  }

  const disableAutoScroll = sawViewportSensitiveToolSuccess && !navigationOccurred;
  return {
    results,
    disableAutoScroll,
    navigationOccurred,
    navigationTool,
    navigationOutcome,
    logicalTabId,
  };
}
