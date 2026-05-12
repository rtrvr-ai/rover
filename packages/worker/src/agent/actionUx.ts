import { SUB_AGENTS } from '@rover/shared/lib/types/agent-types.js';
import { SystemToolNames } from '@rover/shared/lib/system-tools/tools.js';
import type { FunctionCall, RoverRuntimeContext, StatusStage } from './types.js';
import type { AgentContext } from './context.js';
import type { ActionUxToolHooks, LLMFunction, SystemToolBatchResult } from './systemTools.js';
import { stripToolUiHintsFromArgs } from './uiHints.js';

type BridgeRpc = (method: string, params?: any) => Promise<any>;

type ToolLifecyclePoster = (
  type: 'tool_start' | 'tool_result',
  payload: {
    call: FunctionCall & { id?: string };
    toolCallId: string;
    actionSpotlightActive?: boolean;
    result?: unknown;
  },
) => void;

type StatusPoster = (
  message: string,
  thought?: string,
  stage?: StatusStage,
  meta?: { narration?: string; narrationActive?: boolean },
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
  actionNarration?: boolean;
  actionNarrationDefaultActive?: boolean;
  actionSpotlight?: boolean;
  actionSpotlightDefaultActive?: boolean;
  postToolLifecycleEvent: ToolLifecyclePoster;
  postStatus: StatusPoster;
  isCancelled?: () => boolean;
};

type TargetDescription = {
  targetId?: string;
  elementId?: number;
  role?: string;
  name?: string;
  label?: string;
  sectionLabel?: string;
  formLabel?: string;
  valueKind?: string;
  sensitivity?: 'none' | 'personal' | 'secret' | 'payment';
  visible?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  page?: { title?: string; url?: string; host?: string };
};

type NeutralAction = {
  id?: string;
  name: string;
  actionType?: string;
  phase?: string;
  targetId?: string;
  targetLabel?: string;
  targetRole?: string;
  sensitivity?: 'none' | 'personal' | 'secret' | 'payment';
};

const SPOTLIGHT_PREVIEW_TIMEOUT_MS = 120;
const NARRATION_SOFT_DROP_MS = 900;
const NARRATION_HARD_TIMEOUT_MS = 1800;
const MAX_PREVIOUS_NARRATIONS = 4;
const MAX_NARRATION_CHARS = 150;

const FIELD_ACTIONS = new Set<string>([
  SystemToolNames.type_into_element,
  SystemToolNames.type_and_enter,
  SystemToolNames.select_dropdown_value,
  SystemToolNames.clear_element,
  SystemToolNames.paste_text,
  SystemToolNames.upload_file,
]);

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

function neutralActionTypeForName(name: unknown): string {
  switch (String(name || '').trim()) {
    case SystemToolNames.click_element:
    case SystemToolNames.double_click_element:
    case SystemToolNames.right_click_element:
    case SystemToolNames.long_press_element:
      return 'activate';
    case SystemToolNames.type_into_element:
    case SystemToolNames.type_and_enter:
    case SystemToolNames.paste_text:
      return 'fill_field';
    case SystemToolNames.select_dropdown_value:
      return 'choose_option';
    case SystemToolNames.clear_element:
      return 'clear_field';
    case SystemToolNames.upload_file:
      return 'upload_file';
    case SystemToolNames.scroll_page:
    case SystemToolNames.scroll_to_element:
    case SystemToolNames.mouse_wheel:
    case SystemToolNames.swipe_element:
      return 'move_view';
    case SystemToolNames.goto_url:
    case SystemToolNames.google_search:
    case SystemToolNames.open_new_tab:
    case SystemToolNames.switch_tab:
    case SystemToolNames.go_back:
    case SystemToolNames.go_forward:
    case SystemToolNames.refresh_page:
      return 'navigate';
    case SystemToolNames.hover_element:
    case SystemToolNames.focus_element:
      return 'inspect';
    default:
      return 'continue';
  }
}

function isFieldAction(call?: FunctionCall): boolean {
  return FIELD_ACTIONS.has(String(call?.name || '').trim());
}

function positiveElementId(args: Record<string, any>): number | undefined {
  const value = args.element_id ?? args.target_element_id ?? args.source_element_id ?? args.center_element_id;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function fallbackTargetId(call: FunctionCall): string | undefined {
  const id = positiveElementId(cloneArgs(call.args));
  return id ? `element:${id}` : undefined;
}

function targetFromDescription(input: unknown, fallbackId?: string): TargetDescription | undefined {
  if (!input || typeof input !== 'object') return fallbackId ? { targetId: fallbackId } : undefined;
  const raw = ((input as any).target || input) as Record<string, unknown>;
  const targetId = String(raw.targetId || fallbackId || '').trim();
  if (!targetId) return undefined;
  const elementId = Number(raw.elementId);
  const sensitivity = raw.sensitivity === 'payment' || raw.sensitivity === 'secret' || raw.sensitivity === 'personal'
    ? raw.sensitivity
    : 'none';
  const boundsRaw = raw.bounds && typeof raw.bounds === 'object' ? raw.bounds as Record<string, unknown> : undefined;
  return {
    targetId,
    elementId: Number.isFinite(elementId) && elementId > 0 ? elementId : undefined,
    role: String(raw.role || '').trim() || undefined,
    name: String(raw.name || '').trim().slice(0, 96) || undefined,
    label: String(raw.label || '').trim().slice(0, 96) || undefined,
    sectionLabel: String(raw.sectionLabel || '').trim().slice(0, 96) || undefined,
    formLabel: String(raw.formLabel || '').trim().slice(0, 96) || undefined,
    valueKind: String(raw.valueKind || '').trim().slice(0, 48) || undefined,
    sensitivity,
    visible: typeof raw.visible === 'boolean' ? raw.visible : undefined,
    bounds: boundsRaw
      ? {
          x: Number(boundsRaw.x) || 0,
          y: Number(boundsRaw.y) || 0,
          width: Number(boundsRaw.width) || 0,
          height: Number(boundsRaw.height) || 0,
        }
      : undefined,
    page: (input as any).page && typeof (input as any).page === 'object'
      ? {
          title: String((input as any).page.title || '').trim().slice(0, 120) || undefined,
          url: String((input as any).page.url || '').trim().slice(0, 240) || undefined,
          host: String((input as any).page.host || '').trim().slice(0, 120) || undefined,
        }
      : undefined,
  };
}

function neutralActionFromCall(call: FunctionCall, target?: TargetDescription, phase?: string): NeutralAction {
  const targetId = target?.targetId || fallbackTargetId(call);
  const label = target?.label || target?.name || target?.formLabel || target?.sectionLabel;
  const actionType = neutralActionTypeForName(call.name);
  return {
    id: typeof (call as any).id === 'string' ? (call as any).id : undefined,
    name: actionType,
    actionType,
    phase,
    targetId,
    targetLabel: label,
    targetRole: target?.role,
    sensitivity: target?.sensitivity || 'none',
  };
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

function pageHostFromUrl(url?: string): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
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
  private previousNarrations: string[] = [];
  private narratedGroups = new Map<string, number>();
  private batchId = 0;

  constructor(private readonly opts: ActionUxControllerOptions) {}

  async beforeTool(call: FunctionCall, index: number, calls: FunctionCall[]): Promise<FunctionCall> {
    const toolCallId = typeof (call as any).id === 'string' && (call as any).id.trim()
      ? (call as any).id.trim()
      : crypto.randomUUID();
    const cleanCall = cloneToolCall(call, toolCallId);
    const spotlightActive = this.opts.actionSpotlight === true && this.opts.actionSpotlightDefaultActive === true;

    this.opts.postToolLifecycleEvent('tool_start', {
      call: cleanCall,
      toolCallId,
      actionSpotlightActive: spotlightActive || undefined,
    });

    let preview: unknown | undefined;
    if (spotlightActive) {
      preview = await withTimeout(
        this.opts.bridgeRpc('previewActionTarget', { call: cleanCall, toolCallId }),
        SPOTLIGHT_PREVIEW_TIMEOUT_MS,
      );
    }

    if (this.shouldComposeNarration(call, index, calls)) {
      const currentBatch = this.batchId;
      void this.composeNarration(cleanCall, index, calls, preview, currentBatch);
    }

    return cleanCall;
  }

  async afterTool(call: FunctionCall, result: LLMFunction, _index: number, _calls: FunctionCall[]): Promise<void> {
    const toolCallId = typeof (call as any).id === 'string' && (call as any).id.trim()
      ? (call as any).id.trim()
      : crypto.randomUUID();
    this.opts.postToolLifecycleEvent('tool_result', {
      call: call as FunctionCall & { id?: string },
      toolCallId,
      actionSpotlightActive: (this.opts.actionSpotlight === true && this.opts.actionSpotlightDefaultActive === true) || undefined,
      result: {
        success: result.response.status === 'Success',
        error: result.response.error,
        output: result.response.output,
        allowFallback: result.response.allowFallback,
      },
    });
    if (resultIndicatesNavigation(call, result)) {
      this.batchId += 1;
    }
    try {
      await this.opts.bridgeRpc('clearActionTarget', { call, toolCallId });
    } catch {
      // best-effort cleanup
    }
  }

  async onBatchFinish(_result: Pick<SystemToolBatchResult, 'navigationOccurred' | 'navigationTool' | 'navigationOutcome'>): Promise<void> {
    this.batchId += 1;
    try {
      await this.opts.bridgeRpc('clearActionTarget');
    } catch {
      // best-effort cleanup
    }
  }

  private shouldComposeNarration(call: FunctionCall, index: number, calls: FunctionCall[]): boolean {
    if (this.opts.actionNarration !== true) return false;
    if (this.opts.actionNarrationDefaultActive !== true) return false;
    if (this.opts.isCancelled?.()) return false;
    if (isFieldAction(call) && index > 0 && isFieldAction(calls[index - 1])) return false;
    return true;
  }

  private async composeNarration(
    call: FunctionCall,
    index: number,
    calls: FunctionCall[],
    preview: unknown,
    currentBatch: number,
  ): Promise<void> {
    const startedAt = Date.now();
    const fallbackId = fallbackTargetId(call);
    const described = preview || await withTimeout(
      this.opts.bridgeRpc('describeActionTarget', { call, toolCallId: (call as any).id }),
      NARRATION_SOFT_DROP_MS,
    );
    const target = targetFromDescription(described, fallbackId);
    const pageFromTarget = target?.page;
    const tabContext = !pageFromTarget
      ? await withTimeout(this.opts.bridgeRpc('getTabContext'), 120)
      : undefined;
    const page = pageFromTarget || {
      title: String((tabContext as any)?.title || '').trim().slice(0, 120) || undefined,
      url: String((tabContext as any)?.url || '').trim().slice(0, 240) || undefined,
      host: pageHostFromUrl((tabContext as any)?.url),
    };
    const actions = this.buildNeutralActions(call, index, calls, target);
    const targetCandidates = target ? [target] : [];
    const groupKey = this.groupKey(call, target, index);
    if (this.isDuplicateGroup(groupKey)) return;

    const response = await this.opts.ctx.callExtensionRouter(
      SUB_AGENTS.roverNarrationCompose,
      {
        userInput: this.opts.rootUserInput,
        runKind: this.opts.runKind,
        runKindSource: this.opts.runKindSource || (this.opts.runKind ? 'explicit' : 'unspecified'),
        page,
        actions,
        targetCandidates,
        previousNarrations: this.previousNarrations,
        language: this.opts.narrationLanguage,
        maxChars: MAX_NARRATION_CHARS,
        llmIntegration: this.opts.ctx.llmIntegration,
        timestamp: this.opts.ctx.userTimestamp,
        trajectoryId: this.opts.trajectoryId || this.opts.ctx.userTimestamp,
        runtimeContext: this.opts.runtimeContext,
      },
      { timeoutMs: NARRATION_HARD_TIMEOUT_MS, retry: false, sessionTokenWaitMs: 0 },
    ).catch(() => undefined);

    if (this.opts.isCancelled?.()) return;
    if (currentBatch !== this.batchId) return;
    if (Date.now() - startedAt > NARRATION_SOFT_DROP_MS) return;
    const data = response?.data || response;
    if (!data?.shouldNarrate) return;
    const displayText = String(data.displayText || data.speechText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NARRATION_CHARS);
    const speechText = String(data.speechText || displayText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NARRATION_CHARS);
    if (!displayText && !speechText) return;
    this.previousNarrations.push(speechText || displayText);
    this.previousNarrations = this.previousNarrations.slice(-MAX_PREVIOUS_NARRATIONS);
    this.narratedGroups.set(groupKey, Date.now());
    this.opts.postStatus(displayText || speechText, undefined, 'execute', {
      narration: speechText || displayText,
      narrationActive: this.opts.actionNarrationDefaultActive === true,
    });
  }

  private buildNeutralActions(call: FunctionCall, index: number, calls: FunctionCall[], target?: TargetDescription): NeutralAction[] {
    const actions: NeutralAction[] = [neutralActionFromCall(call, target, 'current')];
    if (!isFieldAction(call)) return actions;
    for (let offset = 1; offset <= 2; offset += 1) {
      const next = calls[index + offset];
      if (!isFieldAction(next)) break;
      actions.push(neutralActionFromCall(next, undefined, 'next'));
    }
    return actions;
  }

  private groupKey(call: FunctionCall, target: TargetDescription | undefined, index: number): string {
    if (!isFieldAction(call)) {
      return `${neutralActionTypeForName(call.name)}:${target?.targetId || fallbackTargetId(call) || index}`;
    }
    return `form:${target?.formLabel || target?.sectionLabel || target?.targetId || fallbackTargetId(call) || index}`;
  }

  private isDuplicateGroup(groupKey: string): boolean {
    const last = this.narratedGroups.get(groupKey);
    if (!last) return false;
    return Date.now() - last < 2500;
  }
}
