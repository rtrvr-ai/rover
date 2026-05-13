import type { FunctionCall, RoverPresentationDirective, RoverRuntimeContext, StatusStage } from './types.js';
import type { AgentContext } from './context.js';
import type { ActionUxToolHooks, LLMFunction, SystemToolBatchResult } from './systemTools.js';
import { stripToolUiHintsFromArgs } from './uiHints.js';
import { SystemToolNames } from '@rover/shared/lib/system-tools/tools.js';
import { deriveResponseNarrationFromOutput } from './responseNarration.js';

type BridgeRpc = (method: string, params?: any) => Promise<any>;

type ToolLifecyclePoster = (
  type: 'tool_start' | 'tool_result',
  payload: {
    call: FunctionCall & { id?: string };
    toolCallId: string;
    presentation?: RoverPresentationDirective;
    narration?: string;
    narrationActive?: boolean;
    speechProvider?: RoverPresentationDirective['speechProvider'];
    spotlightActive?: boolean;
    result?: unknown;
  },
) => void;

type StatusPoster = (
  message: string,
  thought?: string,
  stage?: StatusStage,
  meta?: { narration?: string; narrationActive?: boolean; speechProvider?: RoverPresentationDirective['speechProvider'] },
) => void;

export type ActionUxControllerOptions = {
  ctx: AgentContext;
  bridgeRpc: BridgeRpc;
  runtimeContext?: RoverRuntimeContext;
  runId?: string;
  trajectoryId?: string;
  rootUserInput?: string;
  runKind?: 'guide' | 'task';
  runKindSource?: 'shortcut' | 'launch' | 'session' | 'config' | 'explicit' | 'unknown' | 'unspecified';
  narrationLanguage?: string;
  presentationVoiceActive?: boolean;
  presentationSpotlightActive?: boolean;
  postToolLifecycleEvent: ToolLifecyclePoster;
  postStatus: StatusPoster;
  isCancelled?: () => boolean;
};

const SPOTLIGHT_PREVIEW_TIMEOUT_MS = 120;
const MAX_NARRATION_CHARS = 150;

const NAVIGATION_ACTIONS = new Set<string>([
  SystemToolNames.goto_url,
  SystemToolNames.google_search,
  SystemToolNames.open_new_tab,
  SystemToolNames.switch_tab,
  SystemToolNames.go_back,
  SystemToolNames.go_forward,
  SystemToolNames.refresh_page,
  SystemToolNames.close_tab,
]);

function cloneArgs(args: unknown): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  return stripToolUiHintsFromArgs(args as Record<string, any>) as Record<string, any>;
}

function cloneToolCall(call: FunctionCall, id: string): FunctionCall & { id?: string } {
  return {
    ...call,
    id,
    args: cloneArgs(call.args),
  };
}

function positiveElementId(args: Record<string, any>): number | undefined {
  const value = args.element_id ?? args.target_element_id ?? args.source_element_id ?? args.center_element_id;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function elementIdFromTargetId(targetId?: string): number | undefined {
  const match = String(targetId || '').trim().match(/^element:(\d+)$/);
  const parsed = match?.[1] ? Math.trunc(Number(match[1])) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function callTargetId(call: FunctionCall): string | undefined {
  const id = positiveElementId(cloneArgs(call.args));
  return id ? `element:${id}` : undefined;
}

function normalizeText(input: unknown, maxChars = MAX_NARRATION_CHARS): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function normalizePresentations(input?: RoverPresentationDirective | RoverPresentationDirective[]): RoverPresentationDirective[] {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list
    .filter(item => item && item.shouldNarrate === true)
    .map(item => ({
      ...item,
      displayText: normalizeText(item.displayText || item.speechText),
      speechText: normalizeText(item.speechText || item.displayText),
      spotlightTargetIds: Array.isArray(item.spotlightTargetIds)
        ? item.spotlightTargetIds.map(value => normalizeText(value, 80)).filter(Boolean).slice(0, 3)
        : [],
    }))
    .filter(item => !!(item.displayText || item.speechText));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    promise
      .then(value => resolve(value))
      .catch(() => resolve(undefined))
      .finally(() => clearTimeout(timer));
  });
}

function resultIndicatesNavigation(call: FunctionCall, result: LLMFunction): boolean {
  if (NAVIGATION_ACTIONS.has(String(call.name || '').trim())) return true;
  const output = result.response.output && typeof result.response.output === 'object'
    ? result.response.output as Record<string, unknown>
    : undefined;
  if (!output) return false;
  return output.navigationPending === true
    || output.openedInNewTab === true
    || typeof output.navigationOutcome === 'string'
    || typeof output.navigationMode === 'string';
}

export class ActionUxController implements ActionUxToolHooks {
  private batchId = 0;
  private serverPresentations: RoverPresentationDirective[] = [];

  constructor(private readonly opts: ActionUxControllerOptions) {}

  setServerPresentations(presentations?: RoverPresentationDirective | RoverPresentationDirective[]): void {
    this.serverPresentations = normalizePresentations(presentations);
  }

  async beforeTool(call: FunctionCall, index: number, _calls: FunctionCall[]): Promise<FunctionCall> {
    const toolCallId = typeof (call as any).id === 'string' && (call as any).id.trim()
      ? (call as any).id.trim()
      : crypto.randomUUID();
    const cleanCall = cloneToolCall(call, toolCallId);
    const presentation = this.takePresentationForCall(cleanCall, index);
    const spotlightActive = this.opts.presentationSpotlightActive === true;
    const spotlightTargetId = presentation?.spotlightTargetIds?.[0] || callTargetId(cleanCall);
    const displayText = normalizeText(presentation?.displayText || presentation?.speechText);
    const speechText = normalizeText(presentation?.speechText || displayText);

    this.opts.postToolLifecycleEvent('tool_start', {
      call: cleanCall,
      toolCallId,
      presentation,
      narration: speechText || displayText || undefined,
      narrationActive: presentation?.narrationActive ?? (this.opts.presentationVoiceActive === true),
      speechProvider: presentation?.speechProvider,
      spotlightActive: spotlightActive || undefined,
    });

    if (spotlightActive) {
      await withTimeout(
        this.opts.bridgeRpc('previewActionTarget', {
          call: cleanCall,
          toolCallId,
          targetId: spotlightTargetId,
          elementId: elementIdFromTargetId(spotlightTargetId),
        }),
        SPOTLIGHT_PREVIEW_TIMEOUT_MS,
      );
    }

    return cleanCall;
  }

  async afterTool(call: FunctionCall, result: LLMFunction, _index: number, _calls: FunctionCall[]): Promise<void> {
    const toolCallId = typeof (call as any).id === 'string' && (call as any).id.trim()
      ? (call as any).id.trim()
      : crypto.randomUUID();
    // Derive a one-line summary of the visitor-visible tool output (text, count,
    // artifact framing, etc.). Sanitizer scrubs secrets and selectors. The
    // scheduler decides whether to actually speak it based on the session's
    // voiceStarted / presentationIntent gate.
    const isError = result.response.status !== 'Success';
    const toolResultNarration = deriveResponseNarrationFromOutput(result.response.output, {
      responseKind: isError ? 'error' : 'final',
      toolName: String(call.name || '') || undefined,
    });
    this.opts.postToolLifecycleEvent('tool_result', {
      call: call as FunctionCall & { id?: string },
      toolCallId,
      spotlightActive: (this.opts.presentationSpotlightActive === true) || undefined,
      narration: toolResultNarration,
      // Only signal "speak this" when the session's policy has voice active.
      // Otherwise leave undefined so the SDK scheduler can defer to visitor
      // toggle / site default (it stays silent on cold sessions by default).
      narrationActive: toolResultNarration && this.opts.presentationVoiceActive === true ? true : undefined,
      result: {
        success: result.response.status === 'Success',
        error: result.response.error,
        output: result.response.output,
        allowFallback: result.response.allowFallback,
      },
    });
    if (resultIndicatesNavigation(call, result)) {
      this.batchId += 1;
      this.serverPresentations = [];
    }
    try {
      await this.opts.bridgeRpc('clearActionTarget', { call, toolCallId });
    } catch {
      // best-effort cleanup
    }
  }

  async onBatchFinish(_result: Pick<SystemToolBatchResult, 'navigationOccurred' | 'navigationTool' | 'navigationOutcome'>): Promise<void> {
    this.batchId += 1;
    this.serverPresentations = [];
    try {
      await this.opts.bridgeRpc('clearActionTarget');
    } catch {
      // best-effort cleanup
    }
  }

  private takePresentationForCall(call: FunctionCall, index: number): RoverPresentationDirective | undefined {
    if (this.opts.isCancelled?.()) return undefined;
    if (!this.serverPresentations.length) return undefined;
    const currentTargetId = callTargetId(call);
    const matchingIndex = this.serverPresentations.findIndex(item => {
      if (!item.spotlightTargetIds?.length) return index === 0;
      return currentTargetId ? item.spotlightTargetIds.includes(currentTargetId) : index === 0;
    });
    const resolvedIndex = matchingIndex >= 0 ? matchingIndex : 0;
    const [presentation] = this.serverPresentations.splice(resolvedIndex, 1);
    return presentation;
  }
}
