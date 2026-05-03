import type {
  ClientToolDefinition,
  ChatMessage,
  FunctionCall,
  FunctionDeclaration,
  ExternalWebConfig,
  RoverRuntimeContext,
  RoverRuntimeContextExternalTab,
  RoverTab,
  PlannerQuestion,
  PreviousSteps,
  ToolExecutionResult,
  RuntimeToolOutput,
  StatusStage,
  TaskRoutingConfig,
  AssistantCheckpointPayload,
} from './agent/types.js';
import { ToolRegistry } from './agent/toolRegistry.js';
import { createAgentContext, type RoverAgentConfig } from './agent/context.js';
import { handleSendMessageWithFunctions } from './agent/messageOrchestrator.js';
import { TabularStore } from './tabular-memory/tabular-store.js';
import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';
import { isApiKeyRequiredError, toRoverErrorEnvelope } from './agent/errors.js';
import { resolveRuntimeTabs } from './agent/runtimeTabs.js';
import { shouldClearHistoryForRun } from './runHistoryGuards.js';
import { classifyNavigationContinuation } from './navigationContinuation.js';
import { extractActionNarrationFromArgs, extractActionHighlightFromArgs, stripToolUiHintsFromArgs } from './agent/uiHints.js';
import {
  deriveResponseNarrationFromOutput,
  deriveResponseTextFromOutput,
  responseNarrationDedupeKey,
  sanitizeResponseNarration,
  type AssistantResponseKind,
} from './agent/responseNarration.js';
import type { LLMDataInput } from '@rover/shared/lib/types/workflow-types.js';
import { ROVER_V2_PERSIST_CAPS } from '@rover/shared';

type RpcRequest = { t: 'req'; id: string; method: string; params?: unknown };
type RpcResponse = { t: 'res'; id: string; ok: boolean; result?: unknown; error?: { message: string } };

type RoverWorkerConfig = RoverAgentConfig & {
  siteId: string;
  allowActions?: boolean;
  maxToolSteps?: number;
  scopedTabIds?: number[];
  taskTabScope?: {
    boundaryId?: string;
    seedTabId?: number;
    touchedTabIds?: number[];
  };
  task?: {
    singleActiveScope?: 'host_session';
    tabScope?: 'task_touched_only';
    resume?: {
      mode?: 'crash_only';
      ttlMs?: number;
    };
    followup?: {
      mode?: 'heuristic_same_window';
      ttlMs?: number;
      minLexicalOverlap?: number;
    };
    observerInput?: 'read_only';
  };
  chat?: {
    inRun?: 'empty';
    resumeFollowup?: {
      mode?: 'deterministic_cues';
      maxTurns?: number;
    };
  };
  external?: {
    intentSelection?: 'auto';
    requireUserConfirm?: boolean;
    adversarialGate?: 'pre_tool_block';
  };
  tools?: { client?: ClientToolDefinition[]; web?: ExternalWebConfig } | ClientToolDefinition[];
  siteName?: string;
  siteUrl?: string;
  ui?: {
    agent?: {
      name?: string;
    };
    experience?: {
      experienceMode?: 'guided' | 'minimal';
      presence?: {
        assistantName?: string;
      };
      audio?: {
        narration?: {
          enabled?: boolean;
          defaultMode?: 'guided' | 'always' | 'off';
        };
      };
      motion?: {
        actionSpotlight?: boolean;
        actionSpotlightRunKinds?: ReadonlyArray<'guide' | 'task'>;
      };
    };
  };
  sessionId?: string;
  taskBoundaryId?: string;
  taskRouting?: TaskRoutingConfig;
};

type PersistedWorkerState = {
  trajectoryId: string;
  taskBoundaryId?: string;
  rootUserInput?: string;
  seedChatLog?: FollowupChatLogEntry[];
  files?: LLMDataInput[];
  history: ChatMessage[];
  plannerHistory: unknown[];
  agentPrevSteps: PreviousSteps[];
  lastToolPreviousSteps?: PreviousSteps[];
  pendingAskUser?: PendingAskUserPrompt;
};

type FollowupChatLogEntry = {
  role: 'user' | 'model';
  message: string;
};

type RunTerminalState = 'waiting_input' | 'in_progress' | 'completed' | 'failed';
type RunContinuationReason = 'loop_continue' | 'same_tab_navigation_handoff' | 'awaiting_user';

type RunOutcome = {
  route?: { mode?: 'act' | 'planner'; score?: number; reason?: string };
  taskComplete: boolean;
  needsUserInput?: boolean;
  questions?: PlannerQuestion[];
  terminalState?: RunTerminalState;
  navigationPending?: boolean;
  continuationReason?: RunContinuationReason;
  contextResetRecommended?: boolean;
};

type AskUserAnswerMeta = {
  answersByKey?: Record<string, string>;
  rawText?: string;
  keys?: string[];
};

type PendingAskUserStepRef = {
  stepIndex: number;
  functionIndex: number;
  accTreeId?: string;
};

type PendingAskUserPrompt = {
  questions: PlannerQuestion[];
  source: 'act' | 'planner';
  askedAt: number;
  boundaryId?: string;
  stepRef?: PendingAskUserStepRef;
};

type AssistantMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_output' | 'json'; data: RuntimeToolOutput; label?: string; toolName?: string };

type AssistantMessagePayload = {
  text?: string;
  blocks?: AssistantMessageBlock[];
  responseKind?: AssistantResponseKind;
  narration?: string;
};

type TerminalRunResult =
  | {
      ok: true;
      outcome: RunOutcome;
      taskBoundaryId: string;
    }
  | {
      ok: false;
      error: string;
      taskComplete: false;
      needsUserInput: false;
      terminalState: 'failed';
      contextResetRecommended: boolean;
      taskBoundaryId: string;
    };

const history: ChatMessage[] = [];
let config: RoverWorkerConfig | null = null;
let bridgeRpc: ((method: string, params?: any) => Promise<any>) | null = null;
let toolRegistry = new ToolRegistry();
let plannerHistory: any[] = [];
let agentPrevSteps: PreviousSteps[] = [];
let pendingAskUser: PendingAskUserPrompt | undefined;
let rootUserInput = '';
let taskSeedChatLog: FollowupChatLogEntry[] = [];
let workerSessionId = '';
let taskTrajectoryId: string = crypto.randomUUID();
let taskBoundaryId: string = crypto.randomUUID();
let scopedTabIds: number[] = [];
let scopedSeedTabId: number | undefined;
let tabularStore: TabularStore | null = null;
let attachedFiles: LLMDataInput[] = [];
const PLANNER_TOOL_NAME_SET = new Set<string>(Object.values(PLANNER_FUNCTION_CALLS));
let activeRun: { runId: string; text: string; startedAt: number; resume: boolean; preserveHistory: boolean } | null = null;
const cancelledRunIds = new Set<string>();
let activeAbortController: AbortController | null = null;
let lastStatusKey = '';
let seenStatusKeys = new Set<string>();
let lastRuntimeTabsDiagnosticsKey = '';
const terminalRuns = new Map<string, TerminalRunResult>();
let activeActionNarration = false;
let activeActionNarrationDefaultActive = false;
let lastAssistantResponseNarrationKey = '';

let RPC_TIMEOUT_MS = 30_000;
const DETACHED_EXTERNAL_TAB_MAX_AGE_MS = 90_000;
const PENDING_ATTACH_TAB_MAX_AGE_MS = 20_000;
function resolveAgentName(config: RoverWorkerConfig | null): string {
  const raw = String(config?.ui?.agent?.name || config?.ui?.experience?.presence?.assistantName || '').trim();
  if (!raw) return 'Rover';
  return raw.slice(0, 64);
}

function normalizeNarrationRunKind(input: unknown): 'guide' | 'task' | undefined {
  return input === 'guide' || input === 'task' ? input : undefined;
}

function classifyNarrationRunKind(input?: string): 'guide' | 'task' {
  const text = String(input || '').toLowerCase();
  if (/\b(show me|walk me through|guide me|give me a tour|demo|tutorial|teach me|how do i|how to|explain how)\b/.test(text)) {
    return 'guide';
  }
  return 'task';
}

function normalizeActionSpotlightRunKinds(input: unknown): Array<'guide' | 'task'> | undefined {
  if (!Array.isArray(input)) return undefined;
  const kinds = input.filter((kind): kind is 'guide' | 'task' => kind === 'guide' || kind === 'task');
  return kinds.length ? Array.from(new Set(kinds)) : undefined;
}

function isDefaultActionSpotlightActive(config: RoverWorkerConfig | null, runKind?: 'guide' | 'task'): boolean {
  const motion = config?.ui?.experience?.motion;
  if (motion?.actionSpotlight === false) return false;
  const allowedKinds = normalizeActionSpotlightRunKinds(motion?.actionSpotlightRunKinds);
  return !runKind || !allowedKinds || allowedKinds.length === 0 || allowedKinds.includes(runKind);
}

function isDefaultNarrationActive(config: RoverWorkerConfig | null, runKind?: 'guide' | 'task'): boolean {
  const experience = config?.ui?.experience;
  const narration = experience?.audio?.narration;
  if (narration?.enabled === false) return false;
  const defaultMode = narration?.defaultMode === 'always' || narration?.defaultMode === 'off'
    ? narration.defaultMode
    : experience?.experienceMode === 'minimal'
      ? 'off'
    : 'guided';
  if (defaultMode === 'off') return false;
  if (defaultMode === 'always') return true;
  return !runKind || runKind === 'guide';
}

function resolveActionNarrationHints(
  config: RoverWorkerConfig | null,
  userInput?: string,
  options?: {
    narrationEnabledForRun?: boolean;
    narrationPreferenceSource?: 'default' | 'visitor';
    narrationDefaultActiveForRun?: boolean;
    narrationRunKind?: 'guide' | 'task';
    narrationLanguage?: string;
    actionSpotlightEnabledForRun?: boolean;
    actionSpotlightRunKind?: 'guide' | 'task';
    actionSpotlightDefaultActiveForRun?: boolean;
  },
): {
  actionNarration?: boolean;
  actionNarrationDefaultActive?: boolean;
  actionSpotlight?: boolean;
  actionSpotlightDefaultActive?: boolean;
  runKind?: 'guide' | 'task';
  narrationLanguage?: string;
} {
  const experience = config?.ui?.experience;
  const narration = experience?.audio?.narration;
  const narrationOwnerEnabled = narration?.enabled !== false;
  const defaultMode = narration?.defaultMode === 'always' || narration?.defaultMode === 'off'
    ? narration.defaultMode
    : experience?.experienceMode === 'minimal'
      ? 'off'
    : 'guided';
  const runKind = normalizeNarrationRunKind(options?.narrationRunKind)
    || normalizeNarrationRunKind(options?.actionSpotlightRunKind)
    || classifyNarrationRunKind(userInput || rootUserInput);
  const next: {
    actionNarration?: boolean;
    actionNarrationDefaultActive?: boolean;
    actionSpotlight?: boolean;
    actionSpotlightDefaultActive?: boolean;
    runKind?: 'guide' | 'task';
    narrationLanguage?: string;
  } = {};

  if (options?.actionSpotlightEnabledForRun === true) {
    next.actionSpotlight = true;
    next.actionSpotlightDefaultActive = typeof options.actionSpotlightDefaultActiveForRun === 'boolean'
      ? options.actionSpotlightDefaultActiveForRun
      : isDefaultActionSpotlightActive(config, runKind);
  }

  const narrationDefaultActive = typeof options?.narrationDefaultActiveForRun === 'boolean'
    ? options.narrationDefaultActiveForRun
    : isDefaultNarrationActive(config, runKind);
  const narrationAvailable = narrationOwnerEnabled && (
    options?.narrationEnabledForRun === true
      || (options?.narrationEnabledForRun === undefined && defaultMode !== 'off' && (defaultMode === 'always' || runKind === 'guide'))
  );
  if (narrationAvailable) {
    next.actionNarration = true;
    next.actionNarrationDefaultActive = narrationDefaultActive;
    if (normalizeNarrationLanguage(options?.narrationLanguage)) {
      next.narrationLanguage = normalizeNarrationLanguage(options?.narrationLanguage);
    }
  }

  if (next.actionNarration || next.actionSpotlight) next.runKind = runKind;
  return next;
}

function normalizeNarrationLanguage(input: unknown): string | undefined {
  const value = String(input || '').trim();
  if (!value || value.length > 32) return undefined;
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value)) return undefined;
  return value
    .split('-')
    .map((part, index) => index === 0 ? part.toLowerCase() : part.toUpperCase())
    .join('-');
}

function hostFromUrl(url?: string): string | undefined {
  const raw = String(url || '').trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function extractWebToolsConfig(config: RoverWorkerConfig | null): ExternalWebConfig | undefined {
  if (!config?.tools || Array.isArray(config.tools)) return undefined;
  return config.tools.web;
}

function buildRoverRuntimeContext(params: {
  tabs: RoverTab[];
  config: RoverWorkerConfig | null;
  agentName: string;
  taskBoundaryId?: string;
  actionNarration?: boolean;
  actionNarrationDefaultActive?: boolean;
  actionSpotlight?: boolean;
  actionSpotlightDefaultActive?: boolean;
  runKind?: 'guide' | 'task';
  narrationLanguage?: string;
}): RoverRuntimeContext {
  const externalTabs = params.tabs
    .map((tab, index): RoverRuntimeContextExternalTab | undefined => {
      if (!tab.external && tab.accessMode !== 'external_placeholder' && tab.accessMode !== 'external_scraped') {
        return undefined;
      }
      const accessMode: 'external_placeholder' | 'external_scraped' =
        tab.accessMode === 'external_scraped' ? 'external_scraped' : 'external_placeholder';
      return {
        tabId: index,
        host: hostFromUrl(tab.url),
        title: String(tab.title || '').trim() || undefined,
        accessMode,
        reason: String(tab.inaccessibleReason || '').trim() || undefined,
      };
    })
    .filter((tab): tab is RoverRuntimeContextExternalTab => !!tab)
    .slice(0, 8);

  const primaryTab = params.tabs.find(tab => !tab.external && !!tab.url) || params.tabs.find(tab => !!tab.url);
  const siteUrlRaw = String(params.config?.siteUrl || primaryTab?.url || '').trim();
  const siteUrl = siteUrlRaw ? siteUrlRaw.slice(0, 240) : undefined;
  const siteHost = hostFromUrl(siteUrl)
    || (Array.isArray(params.config?.allowedDomains) ? String(params.config?.allowedDomains[0] || '').replace(/^[=*.]+/, '').trim().toLowerCase() : '')
    || undefined;
  const siteId = String(params.config?.siteId || '').trim().slice(0, 128) || undefined;
  const siteName = String(params.config?.siteName || '').trim().slice(0, 120) || undefined;
  const site = siteId || siteName || siteUrl || siteHost
    ? {
        ...(siteId ? { siteId } : {}),
        ...(siteName ? { siteName } : {}),
        ...(siteUrl ? { siteUrl } : {}),
        ...(siteHost ? { host: siteHost.slice(0, 120) } : {}),
      }
    : undefined;

  return {
    mode: 'rover_embed',
    agentName: params.agentName,
    ...(site ? { site } : {}),
    tabIdContract: 'tree_index_mapped_by_tab_order',
    taskBoundaryId: params.taskBoundaryId,
    ...(params.actionNarration || typeof params.actionNarrationDefaultActive === 'boolean' || params.actionSpotlight || typeof params.actionSpotlightDefaultActive === 'boolean' || params.runKind || params.narrationLanguage
      ? {
          uiHints: {
            ...(params.actionNarration ? { actionNarration: true } : {}),
            ...(typeof params.actionNarrationDefaultActive === 'boolean' ? { actionNarrationDefaultActive: params.actionNarrationDefaultActive } : {}),
            ...(params.actionSpotlight ? { actionSpotlight: true } : {}),
            ...(typeof params.actionSpotlightDefaultActive === 'boolean' ? { actionSpotlightDefaultActive: params.actionSpotlightDefaultActive } : {}),
            ...(params.runKind ? { runKind: params.runKind } : {}),
            ...(params.narrationLanguage ? { narrationLanguage: params.narrationLanguage } : {}),
          },
        }
      : {}),
    ...(externalTabs.length ? { externalTabs } : {}),
  };
}

function mergeWorkerTools(
  current: RoverWorkerConfig['tools'],
  incoming: RoverWorkerConfig['tools'] | undefined,
): RoverWorkerConfig['tools'] {
  if (incoming === undefined) return current;
  if (Array.isArray(incoming)) return incoming;
  if (Array.isArray(current)) {
    return {
      ...incoming,
      client: incoming.client ?? current,
      web: {
        ...(incoming.web || {}),
      },
    };
  }
  return {
    ...current,
    ...incoming,
    client: incoming.client ?? current?.client,
    web: {
      ...(current?.web || {}),
      ...(incoming.web || {}),
    },
  };
}

function sanitizeAttachedFiles(input: unknown): LLMDataInput[] {
  if (!Array.isArray(input)) return [];
  const out: LLMDataInput[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = String(item.id || '').trim();
    const displayName = String(item.displayName || '').trim();
    const mimeType = String(item.mimeType || '').trim();
    if (!id || !displayName || !mimeType || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      displayName,
      mimeType,
      storageUrl: typeof item.storageUrl === 'string' && item.storageUrl.trim() ? item.storageUrl.trim() : undefined,
      gcsUri: typeof item.gcsUri === 'string' && item.gcsUri.trim() ? item.gcsUri.trim() : undefined,
      sizeBytes: Number.isFinite(Number(item.sizeBytes)) ? Math.max(0, Number(item.sizeBytes)) : undefined,
      downloadUrl: typeof item.downloadUrl === 'string' && item.downloadUrl.trim() ? item.downloadUrl.trim() : undefined,
      expiresAt: typeof item.expiresAt === 'string' && item.expiresAt.trim() ? item.expiresAt.trim() : undefined,
      kind: typeof item.kind === 'string' && item.kind.trim() ? item.kind.trim() as any : undefined,
      sourceStepId: typeof item.sourceStepId === 'string' && item.sourceStepId.trim() ? item.sourceStepId.trim() : undefined,
      originalIndex: Number.isFinite(Number(item.originalIndex)) ? Math.max(0, Number(item.originalIndex)) : undefined,
      data: typeof item.data === 'string' && item.data.trim() ? item.data.trim() : undefined,
      ORIGIN_KEY: item.ORIGIN_KEY === 'tool' ? 'tool' : 'user',
    });
    if (out.length >= 12) break;
  }
  return out;
}

function mergeWorkerUi(
  current: RoverWorkerConfig['ui'],
  incoming: RoverWorkerConfig['ui'] | undefined,
): RoverWorkerConfig['ui'] {
  if (!incoming) return current;
  return {
    ...current,
    ...incoming,
    agent: {
      ...(current?.agent || {}),
      ...(incoming.agent || {}),
    },
    experience: {
      ...(current?.experience || {}),
      ...(incoming.experience || {}),
      presence: {
        ...(current?.experience?.presence || {}),
        ...(incoming.experience?.presence || {}),
      },
      audio: {
        ...(current?.experience?.audio || {}),
        ...(incoming.experience?.audio || {}),
        narration: {
          ...(current?.experience?.audio?.narration || {}),
          ...(incoming.experience?.audio?.narration || {}),
        },
      },
      motion: {
        ...(current?.experience?.motion || {}),
        ...(incoming.experience?.motion || {}),
      },
    },
  };
}

function createRpcClient(port: MessagePort) {
  const pending = new Map<string, (res: RpcResponse) => void>();
  port.onmessage = ev => {
    const msg = ev.data as RpcResponse;
    if (!msg || msg.t !== 'res') return;
    const cb = pending.get(msg.id);
    if (!cb) return;
    pending.delete(msg.id);
    cb(msg);
  };

  return async function call(method: string, params?: any) {
    const id = crypto.randomUUID();
    const p = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${RPC_TIMEOUT_MS}ms)`));
      }, RPC_TIMEOUT_MS);
      pending.set(id, res => {
        clearTimeout(timer);
        res.ok ? resolve(res.result) : reject(new Error(res.error?.message || 'RPC error'));
      });
    });
    port.postMessage({ t: 'req', id, method, params } satisfies RpcRequest);
    return p;
  };
}

async function getCurrentTab(): Promise<RoverTab> {
  if (!bridgeRpc) return { id: 1 };
  try {
    const tabContext = await bridgeRpc('getTabContext');
    if (tabContext && typeof tabContext === 'object') {
      return {
        id: Number((tabContext as any).logicalTabId || (tabContext as any).id || 1),
        url: (tabContext as any).url,
        title: (tabContext as any).title,
        external: false,
        accessMode: 'live_dom',
      };
    }
  } catch {
    // Ignore. Worker bootstrap must stay DOM-passive until the first real task
    // requests page analysis.
  }

  return { id: 1, external: false, accessMode: 'live_dom' };
}

async function getKnownTabs(): Promise<RoverTab[]> {
  if (!bridgeRpc) return [{ id: 1 }];

  try {
    const listed = await bridgeRpc('listSessionTabs');
    if (Array.isArray(listed) && listed.length > 0) {
      const nowMs = Date.now();
      const mapped = listed
        .map((tab: any) => {
          const id = Number(tab?.logicalTabId || tab?.id || 0);
          const external = !!tab?.external;
          return {
            id,
            runtimeId: typeof tab?.runtimeId === 'string' ? tab.runtimeId : undefined,
            updatedAt: Number(tab?.updatedAt) || 0,
            detachedAt: Number(tab?.detachedAt) || 0,
            detachedReason: typeof tab?.detachedReason === 'string' ? tab.detachedReason : undefined,
            url: typeof tab?.url === 'string' ? tab.url : undefined,
            title: typeof tab?.title === 'string' ? tab.title : undefined,
            external,
            accessMode:
              tab?.accessMode === 'external_scraped' || tab?.accessMode === 'external_placeholder'
                ? tab.accessMode
                : (external ? 'external_placeholder' : 'live_dom'),
            inaccessibleReason: typeof tab?.inaccessibleReason === 'string' ? tab.inaccessibleReason : undefined,
          };
        })
        .filter(tab => Number.isFinite(tab.id) && tab.id > 0)
        .filter(tab => {
          const freshness = Math.max(Number(tab.updatedAt) || 0, Number(tab.detachedAt) || 0);
          if (tab.runtimeId) return true;
          if (tab.external) return nowMs - freshness <= DETACHED_EXTERNAL_TAB_MAX_AGE_MS;
          if (tab.detachedReason === 'opened_pending_attach') {
            return nowMs - freshness <= PENDING_ATTACH_TAB_MAX_AGE_MS;
          }
          return false;
        })
        .map((tab): RoverTab => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          external: tab.external,
          accessMode: tab.accessMode,
          inaccessibleReason: tab.inaccessibleReason,
        }));

      if (mapped.length) return mapped;
    }
  } catch {
    // ignore and fall back
  }

  return [await getCurrentTab()];
}

function inferStatusStage(message: string, thought?: string, explicit?: StatusStage): StatusStage {
  if (explicit) return explicit;
  const text = `${String(message || '')} ${String(thought || '')}`.toLowerCase();
  if (!text.trim()) return 'analyze';
  if (/route|routing|complexity/.test(text)) return 'route';
  if (/complete|completed|done|finished|task complete/.test(text)) return 'complete';
  if (/verify|validated|checking|question/.test(text)) return 'verify';
  if (/execute|executing|running|calling|processing|generating|filling|inferring|extracting/.test(text)) return 'execute';
  return 'analyze';
}

function compactThought(message: string, thought?: string): string {
  const source = String(thought || message || '').trim();
  if (!source) return '';
  return source.length <= 120 ? source : `${source.slice(0, 119)}…`;
}

function postStatus(message: string, thought?: string, stage?: StatusStage, meta?: { narration?: string; narrationActive?: boolean }) {
  const resolvedStage = inferStatusStage(message, thought, stage);
  const compact = compactThought(message, thought);
  const runId = activeRun?.runId || 'no-run';
  if (runId !== 'no-run' && cancelledRunIds.has(runId)) return;
  const key = `${runId}|${resolvedStage}|${String(message || '').trim().toLowerCase()}|${compact.toLowerCase()}`;
  if (key === lastStatusKey || seenStatusKeys.has(key)) return;
  lastStatusKey = key;
  seenStatusKeys.add(key);
  if (seenStatusKeys.size > 60) {
    const recent = Array.from(seenStatusKeys).slice(-30);
    seenStatusKeys = new Set(recent);
  }
  (self as any).postMessage({
    type: 'status',
    message,
    thought,
    stage: resolvedStage,
    compactThought: compact,
    executionId: activeRun?.runId,
    narration: meta?.narration,
    narrationActive: meta?.narrationActive ?? (activeActionNarrationDefaultActive || undefined),
  });
  postStateSnapshot();
}

function cloneToolCall(call: FunctionCall & { id?: string }, toolCallId: string): FunctionCall & { id?: string } {
  const args = cloneUnknown(call.args || {}) || {};
  return {
    ...call,
    id: toolCallId,
    args: stripToolUiHintsFromArgs(args as Record<string, any>),
  };
}

function positiveLogicalTabId(value: unknown): number | undefined {
  const id = Math.trunc(Number(value));
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function extractToolLifecycleLogicalTabId(args: unknown): number | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  return positiveLogicalTabId(record.logical_tab_id)
    ?? positiveLogicalTabId(record.tab_id)
    ?? positiveLogicalTabId(record.logicalTabId)
    ?? positiveLogicalTabId(record.tabId);
}

function postToolLifecycleEvent(type: 'tool_start' | 'tool_result', payload: {
  call: FunctionCall & { id?: string };
  toolCallId: string;
  narration?: string;
  actionSpotlightActive?: boolean;
  result?: unknown;
}): void {
  const runId = activeRun?.runId || 'no-run';
  if (runId !== 'no-run' && cancelledRunIds.has(runId)) return;
  (self as any).postMessage({
    type,
    call: payload.call,
    toolCallId: payload.toolCallId,
    narration: type === 'tool_start' ? payload.narration : undefined,
    narrationActive: activeActionNarrationDefaultActive || undefined,
    actionSpotlightActive: typeof payload.actionSpotlightActive === 'boolean' ? payload.actionSpotlightActive : undefined,
    logicalTabId: extractToolLifecycleLogicalTabId(payload.call.args),
    result: payload.result,
    executionId: activeRun?.runId,
  });
}

function wrapBridgeRpcWithToolLifecycle(
  rawBridgeRpc: (method: string, params?: any) => Promise<any>,
): (method: string, params?: any) => Promise<any> {
  return async (method: string, params?: any) => {
    const rawCall = method === 'executeTool' && params?.call && typeof params.call === 'object'
      ? params.call as FunctionCall & { id?: string }
      : null;
    if (!rawCall?.name) {
      return rawBridgeRpc(method, params);
    }

    const toolCallId = typeof rawCall.id === 'string' && rawCall.id.trim() ? rawCall.id.trim() : crypto.randomUUID();
    const narration = extractActionNarrationFromArgs(rawCall.args);
    const actionSpotlightActive = extractActionHighlightFromArgs(rawCall.args);
    const call = cloneToolCall(rawCall, toolCallId);
    postToolLifecycleEvent('tool_start', { call, toolCallId, narration, actionSpotlightActive });
    try {
      const result = await rawBridgeRpc(method, { ...(params || {}), call });
      postToolLifecycleEvent('tool_result', { call, toolCallId, narration, actionSpotlightActive, result: cloneUnknown(result) });
      return result;
    } catch (err: any) {
      const result = {
        success: false,
        error: err?.message || String(err),
      };
      postToolLifecycleEvent('tool_result', { call, toolCallId, narration, actionSpotlightActive, result });
      throw err;
    }
  };
}

function postRuntimeTabsDiagnostics(payload: {
  hasExplicitScope: boolean;
  scopedTabIdsInput: number[];
  listedTabIds: number[];
  keptScopedTabIds: number[];
  resolvedTabOrder: number[];
}): void {
  const runId = activeRun?.runId || 'no-run';
  if (runId !== 'no-run' && cancelledRunIds.has(runId)) return;
  const signature = [
    runId,
    payload.hasExplicitScope ? '1' : '0',
    payload.scopedTabIdsInput.join(','),
    payload.listedTabIds.join(','),
    payload.keptScopedTabIds.join(','),
    payload.resolvedTabOrder.join(','),
  ].join('|');
  if (signature === lastRuntimeTabsDiagnosticsKey) return;
  lastRuntimeTabsDiagnosticsKey = signature;
  (self as any).postMessage({
    type: 'runtime_tabs_diagnostics',
    executionId: activeRun?.runId,
    diagnostics: payload,
  });
}

function cloneUnknown<T>(value: T): T | undefined {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return undefined;
    }
  }
}

function sanitizeHistoryForPersist(input: ChatMessage[]): ChatMessage[] {
  return input
    .filter(message => message?.role === 'user')
    .slice(-20)
    .map(message => ({
      role: 'user',
      content: String(message?.content ?? ''),
    }));
}

function sanitizePlannerHistoryForPersist(input: unknown[]): unknown[] {
  if (!Array.isArray(input)) return [];
  if (input.length <= ROVER_V2_PERSIST_CAPS.plannerHistory) {
    return input
      .map(step => cloneUnknown(step))
      .filter(step => step !== undefined);
  }

  const anchored = [
    input[0],
    ...input.slice(-(ROVER_V2_PERSIST_CAPS.plannerHistory - 1)),
  ];
  const out: unknown[] = [];
  for (const step of anchored) {
    const cloned = cloneUnknown(step);
    if (cloned !== undefined) out.push(cloned);
  }
  return out;
}

function enforceAccTreeRetention(steps: PreviousSteps[]): void {
  if (!Array.isArray(steps) || steps.length === 0) return;
  const withAccTree: number[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const accTreeId = (steps[i] as any)?.accTreeId;
    if (typeof accTreeId === 'string' && accTreeId.trim()) {
      withAccTree.push(i);
    }
  }
  if (withAccTree.length <= 3) return;
  const keep = new Set<number>([withAccTree[0], ...withAccTree.slice(-2)]);
  for (const index of withAccTree) {
    if (keep.has(index)) continue;
    delete (steps[index] as any).accTreeId;
  }
}

function sanitizeAgentPrevStepsForPersist(input: PreviousSteps[]): PreviousSteps[] {
  if (!Array.isArray(input)) return [];
  if (input.length <= ROVER_V2_PERSIST_CAPS.prevSteps) {
    const out: PreviousSteps[] = [];
    for (const step of input) {
      const cloned = cloneUnknown(step);
      if (cloned && typeof cloned === 'object') {
        out.push(cloned as PreviousSteps);
      }
    }
    enforceAccTreeRetention(out);
    return out;
  }

  const anchored = [
    input[0],
    ...input.slice(-(ROVER_V2_PERSIST_CAPS.prevSteps - 1)),
  ];
  const out: PreviousSteps[] = [];
  for (const step of anchored) {
    const cloned = cloneUnknown(step);
    if (cloned && typeof cloned === 'object') {
      out.push(cloned as PreviousSteps);
    }
  }
  enforceAccTreeRetention(out);
  return out;
}

function normalizePlannerQuestion(input: any, index: number): PlannerQuestion | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const keyCandidate = String(input.key || input.id || '').trim();
  const queryCandidate = String(input.query || input.question || '').trim();
  const key = keyCandidate || `clarification_${index + 1}`;
  if (!queryCandidate) return undefined;
  const hasRequired = typeof input.required === 'boolean';
  const hasOptional = typeof input.optional === 'boolean';
  const required = hasRequired ? !!input.required : (hasOptional ? !input.optional : true);
  return {
    key,
    query: queryCandidate,
    ...(typeof input.id === 'string' && input.id.trim() ? { id: input.id.trim() } : {}),
    ...(typeof input.question === 'string' && input.question.trim() ? { question: input.question.trim() } : {}),
    ...(Array.isArray(input.choices) ? { choices: input.choices } : {}),
    required,
  };
}

function normalizePlannerQuestions(input: any): PlannerQuestion[] {
  if (!Array.isArray(input)) return [];
  const out: PlannerQuestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const question = normalizePlannerQuestion(input[i], i);
    if (!question) continue;
    const key = `${question.key}::${question.query}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
  }
  return out.slice(0, 6);
}

function questionToDisplayText(question: PlannerQuestion): string {
  return String(question.query || question.question || '').trim();
}

function buildAskUserResponseText(prefix: string, questions: PlannerQuestion[]): string {
  const lines = normalizePlannerQuestions(questions)
    .map(questionToDisplayText)
    .filter(Boolean)
    .map(text => `- ${text}`);
  return lines.length ? `${prefix}\n${lines.join('\n')}` : prefix;
}

function normalizeAskUserAnswerMeta(
  raw: AskUserAnswerMeta | undefined,
  questions: PlannerQuestion[],
  fallbackText: string,
): { answersByKey: Record<string, string>; rawText: string } | undefined {
  const validKeys = new Set(questions.map(question => question.key));
  const answersByKey: Record<string, string> = {};
  const submittedKeys = Array.isArray(raw?.keys)
    ? raw.keys
      .map(key => String(key || '').trim())
      .filter(key => !!key && validKeys.has(key))
    : [];

  if (raw?.answersByKey && typeof raw.answersByKey === 'object') {
    for (const [key, value] of Object.entries(raw.answersByKey)) {
      if (!validKeys.has(key)) continue;
      const normalizedValue = String(value || '').trim();
      if (!normalizedValue) continue;
      answersByKey[key] = normalizedValue;
    }
  }

  const fallback = String(fallbackText || '').trim();
  if (Object.keys(answersByKey).length === 0 && fallback) {
    if (questions.length === 1) {
      answersByKey[questions[0].key] = fallback;
    } else {
      const lines = fallback.split('\n').map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        const splitIndex = line.indexOf(':');
        if (splitIndex <= 0) continue;
        const key = line.slice(0, splitIndex).trim();
        const value = line.slice(splitIndex + 1).trim();
        if (!key || !value || !validKeys.has(key)) continue;
        answersByKey[key] = value;
      }
    }
  }

  const rawText = String(raw?.rawText || fallback || '').trim();
  if (!rawText && Object.keys(answersByKey).length === 0) {
    if (!submittedKeys.length) return undefined;
    return {
      answersByKey,
      rawText: submittedKeys.map(key => `${key}: (no answer provided)`).join('\n'),
    };
  }
  return { answersByKey, rawText };
}

function buildAskUserAnswerContext(
  questions: PlannerQuestion[],
  answers: { answersByKey: Record<string, string>; rawText: string },
): string {
  const lines: string[] = ['[ASK_USER_ANSWERS]'];
  for (const question of questions) {
    const answer = String(answers.answersByKey[question.key] || '').trim();
    lines.push(`${question.key}: ${answer || '(no answer provided)'}`);
  }
  if (answers.rawText) {
    lines.push('[RAW_USER_REPLY]');
    lines.push(answers.rawText);
  }
  return lines.join('\n');
}

function normalizeRootUserInput(input: string | undefined): string | undefined {
  const normalized = String(input || '').trim();
  return normalized || undefined;
}

function normalizeFollowupChatLog(
  input: unknown,
): FollowupChatLogEntry[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .map(entry => ({
      role: entry?.role === 'user' ? ('user' as const) : ('model' as const),
      message: String(entry?.message || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(entry => !!entry.message);
  if (!normalized.length) return [];

  const deduped: FollowupChatLogEntry[] = [];
  for (const entry of normalized) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === entry.role && previous.message === entry.message) continue;
    deduped.push(entry);
  }
  return deduped.slice(-12);
}

function dedupePositiveTabIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of input) {
    const tabId = Number(value);
    if (!Number.isFinite(tabId) || tabId <= 0 || seen.has(tabId)) continue;
    seen.add(tabId);
    out.push(tabId);
  }
  return out;
}

function resolveScopedTabConfig(
  partial: Partial<RoverWorkerConfig> | undefined,
): { scoped: number[]; seedTabId?: number } {
  const directScoped = dedupePositiveTabIds((partial as any)?.scopedTabIds);
  const scope = (partial as any)?.taskTabScope;
  const scopedFromScope = dedupePositiveTabIds(scope?.touchedTabIds);
  const seedCandidate = Number(scope?.seedTabId);
  const seedTabId = Number.isFinite(seedCandidate) && seedCandidate > 0 ? seedCandidate : undefined;

  const scoped = dedupePositiveTabIds(
    directScoped.length > 0
      ? directScoped
      : (scopedFromScope.length > 0
        ? scopedFromScope
        : (seedTabId ? [seedTabId] : [])),
  );
  if (seedTabId && !scoped.includes(seedTabId)) {
    scoped.unshift(seedTabId);
  }
  return { scoped, seedTabId };
}

function applyScopedTabConfig(partial: Partial<RoverWorkerConfig> | undefined): void {
  if (!partial || typeof partial !== 'object') return;
  const hasScopedTabIds = Object.prototype.hasOwnProperty.call(partial, 'scopedTabIds');
  const hasTaskTabScope = Object.prototype.hasOwnProperty.call(partial, 'taskTabScope');
  if (!hasScopedTabIds && !hasTaskTabScope) return;
  const next = resolveScopedTabConfig(partial);
  scopedTabIds = next.scoped;
  scopedSeedTabId = next.seedTabId;
}

function touchRunScopedTabIds(tabIds: unknown): number[] {
  const touched = dedupePositiveTabIds(Array.isArray(tabIds) ? tabIds : [tabIds]);
  if (!touched.length) return scopedTabIds;
  const next = dedupePositiveTabIds([
    ...(Number(scopedSeedTabId) > 0 ? [Number(scopedSeedTabId)] : []),
    ...scopedTabIds,
    ...touched,
  ]);
  if (next.length === scopedTabIds.length && next.every((tabId, index) => tabId === scopedTabIds[index])) {
    return scopedTabIds;
  }
  scopedTabIds = next;
  return scopedTabIds;
}

function getRootUserInputFallbackFromHistory(): string | undefined {
  for (const message of history) {
    if (message.role !== 'user') continue;
    const content = normalizeRootUserInput(String(message.content || ''));
    if (content) return content;
  }
  return undefined;
}

function buildContinuePlanningInput(
  focus: string,
  lastToolName?: string,
  lastToolOutput?: string,
): string {
  const safeToolName = String(lastToolName || '').trim();
  const safeFocus = String(focus || '').trim();
  const lines = [
    safeToolName
      ? `The tool \`${safeToolName}\` just finished executing.`
      : 'No tool was issued previously.',
    `Please analyze the progress based on the complete history and determine the single next best step required to fulfill the overall request: ${safeFocus || '(none)'}.`,
    `If the request is complete, invoke tool \`${PLANNER_FUNCTION_CALLS.TASK_COMPLETE}\` via \`tool_code\`. If not, invoke the appropriate tool.`,
  ];
  const output = String(lastToolOutput || '').trim();
  if (output) {
    lines.push('[LAST_TOOL_OUTPUT]');
    lines.push(output);
  }
  return lines.join('\n');
}

function findLatestAskUserFunctionStep(
  steps: PreviousSteps[],
): { stepIndex: number; functionIndex: number } | undefined {
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex];
    const functions = Array.isArray(step?.functions) ? step.functions : [];
    for (let functionIndex = functions.length - 1; functionIndex >= 0; functionIndex -= 1) {
      const fn = functions[functionIndex];
      if (String(fn?.name || '').trim().toLowerCase() === 'ask_user') {
        return { stepIndex, functionIndex };
      }
    }
  }
  return undefined;
}

function resolveAskUserStepRef(
  steps: PreviousSteps[],
  prompt?: PendingAskUserPrompt,
): { stepIndex: number; functionIndex: number } | undefined {
  const explicit = prompt?.stepRef;
  if (
    explicit
    && prompt?.boundaryId
    && prompt.boundaryId === taskBoundaryId
    && Number.isFinite(explicit.stepIndex)
    && explicit.stepIndex >= 0
    && Number.isFinite(explicit.functionIndex)
    && explicit.functionIndex >= 0
    && explicit.stepIndex < steps.length
  ) {
    const step = steps[explicit.stepIndex];
    const functions = Array.isArray(step?.functions) ? step.functions : [];
    const fn = functions[explicit.functionIndex];
    if (String(fn?.name || '').trim().toLowerCase() === 'ask_user') {
      return {
        stepIndex: explicit.stepIndex,
        functionIndex: explicit.functionIndex,
      };
    }
  }

  const refs: Array<{ stepIndex: number; functionIndex: number }> = [];
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const functions = Array.isArray(step?.functions) ? step.functions : [];
    for (let functionIndex = 0; functionIndex < functions.length; functionIndex += 1) {
      const fn = functions[functionIndex];
      if (String(fn?.name || '').trim().toLowerCase() === 'ask_user') {
        refs.push({ stepIndex, functionIndex });
      }
    }
  }
  if (refs.length === 1) return refs[0];
  if (refs.length > 1) return refs[refs.length - 1];
  return undefined;
}

function captureLatestAskUserStepRef(steps: PreviousSteps[]): PendingAskUserStepRef | undefined {
  const ref = findLatestAskUserFunctionStep(steps);
  if (!ref) return undefined;
  const step = steps[ref.stepIndex];
  return {
    stepIndex: ref.stepIndex,
    functionIndex: ref.functionIndex,
    ...(typeof (step as any)?.accTreeId === 'string' && String((step as any).accTreeId).trim()
      ? { accTreeId: String((step as any).accTreeId).trim() }
      : {}),
  };
}

function buildPendingAskUserPrompt(
  source: 'act' | 'planner',
  questions: PlannerQuestion[],
): PendingAskUserPrompt {
  const stepRef = captureLatestAskUserStepRef(agentPrevSteps);
  return {
    questions,
    source,
    askedAt: Date.now(),
    boundaryId: taskBoundaryId,
    ...(stepRef ? { stepRef } : {}),
  };
}

function mergeAskUserAnswerIntoPrevSteps(
  inputSteps: PreviousSteps[],
  prompt: PendingAskUserPrompt | undefined,
  answers: { answersByKey: Record<string, string>; rawText: string },
): PreviousSteps[] {
  const next = sanitizeAgentPrevStepsForPersist(Array.isArray(inputSteps) ? inputSteps : []);
  const questions = normalizePlannerQuestions(prompt?.questions);
  if (!questions.length) return next;
  const askUserRef = resolveAskUserStepRef(next, prompt);
  const questionPayload = normalizePlannerQuestions(questions).map(question => ({
    key: question.key,
    query: question.query,
    ...(question.required === false ? { required: false } : {}),
  }));

  const buildOutputPayload = (previousOutput: unknown) => {
    const prev =
      previousOutput && typeof previousOutput === 'object' && !Array.isArray(previousOutput)
        ? previousOutput as Record<string, unknown>
        : {};
    const prevQuestions = normalizePlannerQuestions((prev as any).questions);
    const resolvedQuestions = prevQuestions.length ? prevQuestions : normalizePlannerQuestions(questions);
    return {
      ...prev,
      status: 'answered',
      needsUserInput: false,
      ...(resolvedQuestions.length ? { questions: resolvedQuestions } : {}),
      ask_user_answers: { ...answers.answersByKey },
      ...(answers.rawText ? { raw_user_reply: answers.rawText } : {}),
      answeredAt: Date.now(),
    };
  };

  if (!askUserRef) {
    // Do not synthesize a new ask_user step when the original step is unavailable.
    return next;
  }

  const step = next[askUserRef.stepIndex];
  if (!Array.isArray(step.functions)) step.functions = [];
  const existingFn = step.functions[askUserRef.functionIndex];
  const previousOutput = existingFn?.response?.output;
  step.functions[askUserRef.functionIndex] = {
    name: 'ask_user',
    args: {
      questions_to_ask: questionPayload,
    },
    response: {
      status: 'Success',
      output: buildOutputPayload(previousOutput),
    },
  };
  return next;
}

function mergeAskUserAnswersIntoPlannerHistory(
  input: unknown[],
  questions: PlannerQuestion[],
  answersByKey: Record<string, string>,
): unknown[] {
  const next = sanitizePlannerHistoryForPersist(Array.isArray(input) ? input : []);
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const step = next[i] as any;
    if (!step || typeof step !== 'object') continue;
    const asked = normalizePlannerQuestions(step.questionsAsked);
    if (!asked.length) continue;
    const askedKeys = new Set(asked.map(question => question.key.toLowerCase()));
    const overlaps = questions.some(question => askedKeys.has(String(question.key || '').toLowerCase()));
    if (!overlaps) continue;
    const existingAnswers =
      step.userAnswers && typeof step.userAnswers === 'object' && !Array.isArray(step.userAnswers)
        ? step.userAnswers as Record<string, unknown>
        : {};
    step.userAnswers = {
      ...existingAnswers,
      ...answersByKey,
    };
    return sanitizePlannerHistoryForPersist(next);
  }

  next.push({
    thought: 'User provided clarification answers.',
    questionsAsked: questions,
    userAnswers: answersByKey,
  });
  return sanitizePlannerHistoryForPersist(next);
}

function buildPersistedState(): PersistedWorkerState {
  const safePrevSteps = sanitizeAgentPrevStepsForPersist(Array.isArray(agentPrevSteps) ? agentPrevSteps : []);
  const normalizedRootUserInput = normalizeRootUserInput(rootUserInput);
  const pendingStepRef = pendingAskUser?.stepRef;
  const safePendingStepRef =
    pendingStepRef
    && Number.isFinite(pendingStepRef.stepIndex)
    && pendingStepRef.stepIndex >= 0
    && Number.isFinite(pendingStepRef.functionIndex)
    && pendingStepRef.functionIndex >= 0
      ? {
          stepIndex: pendingStepRef.stepIndex,
          functionIndex: pendingStepRef.functionIndex,
          ...(typeof pendingStepRef.accTreeId === 'string' && pendingStepRef.accTreeId.trim()
            ? { accTreeId: pendingStepRef.accTreeId.trim() }
            : {}),
        }
      : undefined;
  return {
    trajectoryId: taskTrajectoryId,
    taskBoundaryId,
    ...(normalizedRootUserInput ? { rootUserInput: normalizedRootUserInput } : {}),
    ...(taskSeedChatLog.length ? { seedChatLog: normalizeFollowupChatLog(taskSeedChatLog) } : {}),
    ...(attachedFiles.length ? { files: sanitizeAttachedFiles(attachedFiles) } : {}),
    history: sanitizeHistoryForPersist(history),
    plannerHistory: sanitizePlannerHistoryForPersist(Array.isArray(plannerHistory) ? plannerHistory : []),
    agentPrevSteps: safePrevSteps,
    lastToolPreviousSteps: safePrevSteps,
    pendingAskUser: pendingAskUser
      ? {
          questions: normalizePlannerQuestions(pendingAskUser.questions),
          source: pendingAskUser.source,
          askedAt: Number(pendingAskUser.askedAt) || Date.now(),
          ...(typeof pendingAskUser.boundaryId === 'string' && pendingAskUser.boundaryId.trim()
            ? { boundaryId: pendingAskUser.boundaryId.trim() }
            : {}),
          ...(safePendingStepRef ? { stepRef: safePendingStepRef } : {}),
        }
      : undefined,
  };
}

function postStateSnapshot(): void {
  (self as any).postMessage({
    type: 'state_snapshot',
    state: buildPersistedState(),
    activeRun: activeRun
      ? {
          runId: activeRun.runId,
          text: activeRun.text,
          startedAt: activeRun.startedAt,
          resume: activeRun.resume,
        }
      : null,
  });
}

function hydrateState(raw: any): void {
  const snapshot = raw as Partial<PersistedWorkerState> | undefined;
  if (!snapshot) return;

  taskSeedChatLog = normalizeFollowupChatLog((snapshot as any).seedChatLog);
  attachedFiles = sanitizeAttachedFiles((snapshot as any).files);

  if (Array.isArray(snapshot.history)) {
    history.length = 0;
    for (const msg of sanitizeHistoryForPersist(snapshot.history as ChatMessage[])) {
      history.push(msg);
    }
  }

  if (Array.isArray(snapshot.plannerHistory)) {
    plannerHistory = sanitizePlannerHistoryForPersist(snapshot.plannerHistory);
  }

  if (Array.isArray(snapshot.agentPrevSteps)) {
    agentPrevSteps = sanitizeAgentPrevStepsForPersist(snapshot.agentPrevSteps as PreviousSteps[]);
  } else if (Array.isArray(snapshot.lastToolPreviousSteps)) {
    agentPrevSteps = sanitizeAgentPrevStepsForPersist(snapshot.lastToolPreviousSteps as PreviousSteps[]);
  }

  const hydratedQuestions = normalizePlannerQuestions((snapshot as any).pendingAskUser?.questions);
  const hydratedStepRefRaw = (snapshot as any).pendingAskUser?.stepRef;
  const hydratedStepRef =
    hydratedStepRefRaw
    && Number.isFinite(Number(hydratedStepRefRaw.stepIndex))
    && Number(hydratedStepRefRaw.stepIndex) >= 0
    && Number.isFinite(Number(hydratedStepRefRaw.functionIndex))
    && Number(hydratedStepRefRaw.functionIndex) >= 0
      ? {
          stepIndex: Number(hydratedStepRefRaw.stepIndex),
          functionIndex: Number(hydratedStepRefRaw.functionIndex),
          ...(typeof hydratedStepRefRaw.accTreeId === 'string' && hydratedStepRefRaw.accTreeId.trim()
            ? { accTreeId: hydratedStepRefRaw.accTreeId.trim() }
            : {}),
        }
      : undefined;
  if (hydratedQuestions.length > 0) {
    pendingAskUser = {
      questions: hydratedQuestions,
      source: (snapshot as any).pendingAskUser?.source === 'planner' ? 'planner' : 'act',
      askedAt: Number((snapshot as any).pendingAskUser?.askedAt) || Date.now(),
      boundaryId:
        typeof (snapshot as any).pendingAskUser?.boundaryId === 'string'
          ? String((snapshot as any).pendingAskUser.boundaryId).trim() || undefined
          : undefined,
      ...(hydratedStepRef ? { stepRef: hydratedStepRef } : {}),
    };
  } else {
    pendingAskUser = undefined;
  }

  if (typeof snapshot.trajectoryId === 'string' && snapshot.trajectoryId.trim()) {
    taskTrajectoryId = snapshot.trajectoryId.trim();
  }

  if (typeof (snapshot as any).taskBoundaryId === 'string' && String((snapshot as any).taskBoundaryId).trim()) {
    taskBoundaryId = String((snapshot as any).taskBoundaryId).trim();
  }

  const hydratedRootUserInput = normalizeRootUserInput((snapshot as any).rootUserInput);
  rootUserInput = hydratedRootUserInput || normalizeRootUserInput(getRootUserInputFallbackFromHistory()) || '';

  if (!tabularStore) {
    tabularStore = new TabularStore(`rover-${taskTrajectoryId}`);
  }

  postStateSnapshot();
}

function sanitizeAssistantBlocks(input: unknown): AssistantMessageBlock[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: AssistantMessageBlock[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const type = (raw as any).type;
    if (type === 'text') {
      const text = String((raw as any).text || '').trim();
      if (!text) continue;
      out.push({ type: 'text', text });
      continue;
    }

    if (type === 'tool_output' || type === 'json') {
      out.push({
        type,
        data: normalizeRuntimeToolOutput((raw as any).data),
        label: typeof (raw as any).label === 'string' ? (raw as any).label : undefined,
        toolName: typeof (raw as any).toolName === 'string' ? (raw as any).toolName : undefined,
      });
    }
  }

  return out.length ? out : undefined;
}

function normalizeRuntimeToolOutput(value: unknown): RuntimeToolOutput {
  const cloned = cloneUnknown(value);
  if (cloned == null) return null;
  if (typeof cloned === 'string' || typeof cloned === 'number' || typeof cloned === 'boolean') {
    return cloned;
  }
  if (Array.isArray(cloned)) {
    return cloned as RuntimeToolOutput;
  }
  if (typeof cloned === 'object') {
    return cloned as RuntimeToolOutput;
  }
  return String(cloned);
}

function summarizeOutputText(output: RuntimeToolOutput | undefined): string | undefined {
  const text = deriveResponseTextFromOutput(output);
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

function isSingleTextWrapperObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length !== 1) return false;
  const [key, raw] = entries[0];
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const textKeys = new Set(['response', 'message', 'summary', 'text', 'content', 'result', 'description']);
  return textKeys.has(key);
}

function shouldAttachStructuredBlock(output: RuntimeToolOutput | undefined, summaryText?: string): boolean {
  if (output == null) return false;
  if (typeof output === 'string') {
    const clean = output.trim();
    if (!clean) return false;
    return !summaryText || clean !== summaryText.trim();
  }
  if (Array.isArray(output)) {
    const meaningful = output.filter(item => item !== undefined && item !== null);
    if (meaningful.length === 1) {
      const first = meaningful[0];
      if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') {
        return false;
      }
      if (isSingleTextWrapperObject(first)) {
        return false;
      }
    }
    return true;
  }
  if (isSingleTextWrapperObject(output)) {
    return false;
  }
  return true;
}

function buildAssistantPayloadFromToolOutput(
  output: RuntimeToolOutput | undefined,
  options?: { label?: string; toolName?: string; fallbackText?: string },
): AssistantMessagePayload {
  const summaryText = summarizeOutputText(output);
  const text = summaryText || options?.fallbackText || '';
  const blocks: AssistantMessageBlock[] = [];
  if (shouldAttachStructuredBlock(output, summaryText)) {
    blocks.push({
      type: 'tool_output',
      label: options?.label,
      toolName: options?.toolName,
      data: normalizeRuntimeToolOutput(output),
    });
  }
  return { text, blocks: blocks.length ? blocks : undefined };
}

function buildAssistantResponseTitle(kind?: AssistantResponseKind, sourceToolName?: string): string {
  if (kind === 'question') return 'Needs input';
  if (kind === 'error') return 'Response error';
  if (kind === 'final') return 'Final response';
  return sourceToolName ? `${sourceToolName} response` : 'Step response';
}

function normalizeResponseNarration(
  input: unknown,
  kind: AssistantResponseKind,
): string | undefined {
  if (!activeActionNarration) return undefined;
  return sanitizeResponseNarration(input, { responseKind: kind });
}

function shouldEmitResponseNarration(narration: string | undefined): boolean {
  if (!narration) return false;
  const key = responseNarrationDedupeKey(narration);
  if (!key) return false;
  if (key === lastAssistantResponseNarrationKey) return false;
  lastAssistantResponseNarrationKey = key;
  return true;
}

function postAssistantResponse(payload: AssistantCheckpointPayload): string {
  if (!activeActionNarration) return '';
  const kind = payload.responseKind || 'checkpoint';
  const rawText = payload.text
    || deriveResponseNarrationFromOutput(payload.output, {
      responseKind: kind,
      toolName: payload.sourceToolName,
      fallbackText: payload.error,
    })
    || '';
  const text = sanitizeResponseNarration(rawText, { responseKind: kind, toolName: payload.sourceToolName }) || '';
  const narration = normalizeResponseNarration(text, kind);
  if (!text && !narration) return '';
  const runId = activeRun?.runId;
  if (runId && cancelledRunIds.has(runId)) return text || narration || '';
  const shouldNarrate = shouldEmitResponseNarration(narration);
  (self as any).postMessage({
    type: 'assistant_response',
    text: text || narration,
    title: buildAssistantResponseTitle(kind, payload.sourceToolName),
    responseKind: kind,
    sourceToolName: payload.sourceToolName,
    narration: shouldNarrate ? narration : undefined,
    narrationActive: activeActionNarrationDefaultActive || undefined,
    executionId: runId,
  });
  return text || narration || '';
}

function postAssistantMessage(payload: string | AssistantMessagePayload): string {
  const text = typeof payload === 'string'
    ? String(payload || '').trim()
    : String(payload?.text || '').trim();
  const blocks = typeof payload === 'string' ? undefined : sanitizeAssistantBlocks(payload.blocks);
  const responseKind = typeof payload === 'string' ? undefined : payload.responseKind;
  const firstTextBlock = blocks?.find((block): block is Extract<AssistantMessageBlock, { type: 'text' }> => block.type === 'text');
  const firstStructuredBlock = blocks?.find((block): block is Extract<AssistantMessageBlock, { type: 'tool_output' | 'json' }> =>
    block.type === 'tool_output' || block.type === 'json');
  const resolvedText =
    text
    || firstTextBlock?.text
    || summarizeOutputText(firstStructuredBlock?.data as RuntimeToolOutput | undefined)
    || '';
  if (!resolvedText && (!blocks || blocks.length === 0)) {
    return '';
  }
  const runId = activeRun?.runId;
  if (runId && cancelledRunIds.has(runId)) {
    return resolvedText;
  }
  const kind = responseKind === 'checkpoint' || responseKind === 'final' || responseKind === 'question' || responseKind === 'error'
    ? responseKind
    : undefined;
  const narration = kind
    ? normalizeResponseNarration(resolvedText, kind)
    : undefined;
  const shouldNarrate = shouldEmitResponseNarration(narration);
  (self as any).postMessage({
    type: 'assistant',
    text: resolvedText,
    blocks,
    responseKind: kind,
    narration: shouldNarrate ? narration : undefined,
    narrationActive: kind ? (activeActionNarrationDefaultActive || undefined) : undefined,
    executionId: runId,
  });
  return resolvedText;
}

function dedupeFunctionDeclarations(declarations: FunctionDeclaration[]): FunctionDeclaration[] {
  const seen = new Set<string>();
  const out: FunctionDeclaration[] = [];
  for (const decl of declarations) {
    if (!decl?.name || seen.has(decl.name)) continue;
    seen.add(decl.name);
    out.push(decl);
  }
  return out;
}

function removePlannerNameCollisions(declarations: FunctionDeclaration[]): FunctionDeclaration[] {
  return declarations.filter(decl => !!decl?.name && !PLANNER_TOOL_NAME_SET.has(decl.name));
}

function postAuthRequired(err: any): void {
  const runId = activeRun?.runId;
  if (runId && cancelledRunIds.has(runId)) return;
  const envelope =
    err && typeof err === 'object' && err.code && err.message
      ? toRoverErrorEnvelope({ errorDetails: err }, 'Rover API key is required.')
      : toRoverErrorEnvelope(err, 'Rover API key is required.');
  (self as any).postMessage({ type: 'auth_required', error: envelope, executionId: runId });
}

type StructuredErrorPayload = {
  success: false;
  error: {
    code: string;
    message: string;
    missing?: string[];
    next_action?: string;
    retryable?: boolean;
    requires_api_key?: boolean;
  };
  missing?: string[];
  next_action?: string;
  retryable?: boolean;
};

const NAVIGATION_TOOL_NAME_SET = new Set([
  'goto_url',
  'google_search',
  'go_back',
  'go_forward',
  'refresh_page',
  'open_new_tab',
]);

function toStructuredErrorPayload(err: any, fallbackMessage = 'Operation failed'): StructuredErrorPayload {
  const envelope = toRoverErrorEnvelope(err, fallbackMessage);
  const payload: StructuredErrorPayload = {
    success: false,
    error: {
      code: envelope.code,
      message: envelope.message,
      missing: envelope.missing,
      next_action: envelope.next_action,
      retryable: envelope.retryable,
      requires_api_key: envelope.requires_api_key,
    },
    missing: envelope.missing,
    next_action: envelope.next_action,
    retryable: envelope.retryable,
  };
  return payload;
}

function extractStructuredErrorFromToolResult(result: any): StructuredErrorPayload | undefined {
  if (!result || typeof result !== 'object') return undefined;

  const output = result.output;
  if (output && typeof output === 'object' && output.success === false && output.error) {
    const errorObject =
      typeof output.error === 'object'
        ? output.error
        : {
            message: String(output.error || 'Operation failed'),
          };
    return toStructuredErrorPayload(
      {
        errorDetails: {
          ...errorObject,
          missing: output.missing ?? errorObject.missing,
          next_action: output.next_action ?? errorObject.next_action,
          retryable: output.retryable ?? errorObject.retryable,
        },
      },
      'Operation failed',
    );
  }

  if (result.errorDetails || result.error) {
    return toStructuredErrorPayload(result.errorDetails || { message: result.error }, 'Operation failed');
  }

  return undefined;
}

function sawRecentSuccessfulNavigationStep(steps: PreviousSteps[] | undefined): boolean {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  let inspectedStepCount = 0;
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex] as any;
    const functions = Array.isArray(step?.functions) ? step.functions : [];
    if (!functions.length) continue;
    inspectedStepCount += 1;
    for (let fnIndex = functions.length - 1; fnIndex >= 0; fnIndex -= 1) {
      const fn = functions[fnIndex] as any;
      const toolName = String(fn?.name || fn?.toolName || fn?.functionName || '').trim();
      if (!toolName || !NAVIGATION_TOOL_NAME_SET.has(toolName)) continue;
      const status = String(fn?.response?.status || fn?.status || '').trim().toLowerCase();
      if (status === 'success') {
        return true;
      }
    }
    if (inspectedStepCount >= 2) break;
  }
  return false;
}

// Error codes that can be transient during post-navigation resume
// (e.g. session token not yet available after page reload)
const NAVIGATION_TRANSIENT_CODES = new Set([
  'UNKNOWN_ERROR',
  'MISSING_AUTH_TOKEN',
  'MISSING_AUTH',
  'SESSION_TOKEN_EXPIRED',
  'SESSION_TOKEN_INVALID',
  'BOOTSTRAP_REQUIRED',
]);

function normalizeLifecycleHandoffError(
  payload: StructuredErrorPayload,
  steps: PreviousSteps[] | undefined,
): StructuredErrorPayload {
  const code = String(payload?.error?.code || '').trim().toUpperCase();
  if (code && !NAVIGATION_TRANSIENT_CODES.has(code)) return payload;
  if (!sawRecentSuccessfulNavigationStep(steps)) return payload;

  return {
    ...payload,
    error: {
      ...payload.error,
      code: 'NAVIGATION_HANDOFF_PENDING',
      message: payload.error?.message || 'Navigation handoff is in progress.',
      retryable: true,
      next_action: 'Wait for post-navigation resume and continue the task.',
    },
    retryable: true,
    next_action: 'Wait for post-navigation resume and continue the task.',
  };
}

function maybePostNavigationGuardrailFromToolResult(toolResult: any): void {
  if (!toolResult || typeof toolResult !== 'object') return;
  const output = toolResult.output;
  const details = toolResult.errorDetails;
  const policyAction =
    output?.policy_action ||
    output?.policyAction ||
    (output?.policyBlocked ? 'open_new_tab_notice' : undefined) ||
    (details?.code === 'DOMAIN_SCOPE_BLOCKED' ? 'block' : undefined);

  if (!policyAction) return;
  (self as any).postMessage({
    type: 'navigation_guardrail',
    executionId: activeRun?.runId,
    blockedUrl: output?.blocked_url || output?.url || details?.details?.blockedUrl,
    currentUrl: output?.current_url || details?.details?.currentUrl,
    reason: output?.error?.message || details?.message || output?.message,
    policyAction,
    openedInNewTab: !!output?.openedInNewTab,
    allowedDomains: output?.allowed_domains || details?.details?.allowedDomains,
  });
}

function assessAdversarialInput(rawText: string): { blocked: boolean; score: number; reasons: string[] } {
  const text = String(rawText || '').toLowerCase();
  if (!text.trim()) return { blocked: false, score: 0, reasons: [] };

  const signals: Array<{ reason: string; pattern: RegExp; weight: number }> = [
    { reason: 'prompt_injection', pattern: /\b(ignore|bypass|override)\b.{0,40}\b(instruction|policy|guardrail|system|developer)\b/i, weight: 2 },
    { reason: 'secret_exfiltration', pattern: /\b(token|cookie|password|secret|api key|session key)\b.{0,40}\b(extract|dump|reveal|steal|exfiltrat)/i, weight: 3 },
    { reason: 'credential_harvest', pattern: /\b(phish|credential|login prompt|social engineering)\b/i, weight: 3 },
    { reason: 'policy_evasion', pattern: /\b(do not tell|without asking|silently|hidden|covert)\b/i, weight: 1 },
  ];

  const reasons: string[] = [];
  let score = 0;
  for (const signal of signals) {
    if (!signal.pattern.test(text)) continue;
    reasons.push(signal.reason);
    score += signal.weight;
  }
  const blocked = score >= 3;
  return { blocked, score, reasons };
}

function applyAgentPrevSteps(next?: any[], options?: { snapshot?: boolean }): void {
  if (!Array.isArray(next) || !next.length) return;
  agentPrevSteps = sanitizeAgentPrevStepsForPersist(next as PreviousSteps[]);
  if (options?.snapshot !== false) {
    postStateSnapshot();
  }
}

function extractArtifactLinks(toolResult: any): string[] {
  const links: string[] = [];
  const generated = toolResult?.generatedContentRef || {};

  const docs = Array.isArray(generated.docs) ? generated.docs : [];
  for (const doc of docs) {
    if (doc?.url) links.push(`[Doc: ${doc.url}](${doc.url})`);
  }

  const slides = Array.isArray(generated.slides) ? generated.slides : [];
  for (const slide of slides) {
    if (slide?.url) links.push(`[Slides: ${slide.url}](${slide.url})`);
  }

  const webpages = Array.isArray(generated.webpages) ? generated.webpages : [];
  for (const page of webpages) {
    const url = page?.storageUrl || page?.downloadUrl;
    if (url) links.push(`[Webpage: ${url}](${url})`);
  }

  const pdfs = Array.isArray(generated.pdfs) ? generated.pdfs : [];
  for (const pdf of pdfs) {
    const url = pdf?.storageUrl || pdf?.downloadUrl;
    if (url) links.push(`[PDF: ${url}](${url})`);
  }

  const sheets = Array.isArray(toolResult?.schemaHeaderSheetInfo) ? toolResult.schemaHeaderSheetInfo : [];
  for (const entry of sheets) {
    const sheetId = entry?.sheetInfo?.sheetId;
    if (!sheetId) continue;
    const tabId = entry?.sheetInfo?.sheetTabId;
    const url = tabId
      ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${tabId}`
      : `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    links.push(`[Sheet: ${url}](${url})`);
  }

  return links;
}

function buildPlannerToolResultBlocks(toolResults: ToolExecutionResult[] | undefined): AssistantMessageBlock[] | undefined {
  if (!Array.isArray(toolResults) || !toolResults.length) return undefined;
  const blocks: AssistantMessageBlock[] = [];

  for (let i = 0; i < toolResults.length; i += 1) {
    const result = toolResults[i];
    if (!result) continue;
    const stepLabel = `Step ${i + 1}`;
    const output = result.output ?? result.generatedContentRef ?? result.schemaHeaderSheetInfo;
    const summary = summarizeOutputText(output);
    if (output !== undefined && shouldAttachStructuredBlock(output, summary)) {
      blocks.push({
        type: 'tool_output',
        label: result.toolName ? `${stepLabel}: ${result.toolName}` : stepLabel,
        toolName: typeof result.toolName === 'string' ? result.toolName : undefined,
        data: normalizeRuntimeToolOutput(output),
      });
    }

    if (result.error || result.errorDetails) {
      blocks.push({
        type: 'json',
        label: `${stepLabel} error`,
        data: normalizeRuntimeToolOutput({
          error: result.error,
          errorDetails: result.errorDetails,
        }),
      });
    }

    const links = extractArtifactLinks(result);
    if (links.length) {
      blocks.push({
        type: 'text',
        text: `${stepLabel} artifacts:\n${links.map(link => `- ${link}`).join('\n')}`,
      });
    }
  }

  return blocks.length ? blocks : undefined;
}

function summarizePlannerToolResults(toolResults: ToolExecutionResult[] | undefined): string | undefined {
  if (!Array.isArray(toolResults) || !toolResults.length) return undefined;
  const lines: string[] = [];
  for (let i = 0; i < toolResults.length; i += 1) {
    const result = toolResults[i];
    if (!result) continue;
    const output = result.output ?? result.generatedContentRef ?? result.schemaHeaderSheetInfo;
    const summary = summarizeOutputText(output);
    if (summary) {
      lines.push(summary);
      if (lines.length >= 3) break;
    }
  }
  if (!lines.length) return undefined;
  return lines.join('\n\n');
}

function extractLatestPrevStepsFromPlanner(toolResults: ToolExecutionResult[] | undefined): PreviousSteps[] | undefined {
  if (!Array.isArray(toolResults) || !toolResults.length) return undefined;
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const candidate = toolResults[i]?.prevSteps;
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as PreviousSteps[];
    }
  }
  return undefined;
}

type OpenedTabMetadata = {
  logicalTabId: number;
  url?: string;
  external?: boolean;
};

type NewTabReadyState = {
  ready: boolean;
  attached: boolean;
  external: boolean;
};

async function waitForNewTabReady(openedTab: OpenedTabMetadata, timeoutMs = 10000): Promise<NewTabReadyState> {
  if (!bridgeRpc) {
    return { ready: false, attached: false, external: !!openedTab.external };
  }
  const pollInterval = 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const tabs = await bridgeRpc('listSessionTabs');
      if (Array.isArray(tabs)) {
        const target = tabs.find((t: any) => Number(t?.logicalTabId) === openedTab.logicalTabId);
        if (target?.external) {
          return { ready: true, attached: false, external: true };
        }
        if (target?.runtimeId) {
          // Tab has registered - wait an additional 1s for DOM to settle
          await new Promise(resolve => setTimeout(resolve, 1000));
          return { ready: true, attached: true, external: false };
        }
      }
    } catch {
      // ignore polling errors
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { ready: false, attached: false, external: !!openedTab.external };
}

function detectOpenedTabFromToolResult(result: any): OpenedTabMetadata | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const output = result.output ?? result;
  if (output?.openedInNewTab && typeof output?.logicalTabId === 'number') {
    return {
      logicalTabId: output.logicalTabId,
      url: typeof output?.url === 'string' ? output.url : undefined,
      external: output?.external === true,
    };
  }
  return undefined;
}

function extractTouchedTabIdsFromToolResult(result: any): number[] {
  if (!result || typeof result !== 'object') return [];
  const output = result.output && typeof result.output === 'object' ? result.output : undefined;
  const candidates = [
    Number(result.logicalTabId ?? result.logical_tab_id ?? result.tabId ?? result.tab_id),
    Number(output?.logicalTabId ?? output?.logical_tab_id ?? output?.tabId ?? output?.tab_id),
  ];
  const unique = new Set<number>();
  const out: number[] = [];
  for (const value of candidates) {
    if (!Number.isFinite(value) || value <= 0 || unique.has(value)) continue;
    unique.add(value);
    out.push(value);
  }
  return out;
}

function extractQuestionsFromResult(
  result: ToolExecutionResult | Record<string, unknown> | undefined,
): PlannerQuestion[] | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const topLevel = normalizePlannerQuestions((result as { questions?: unknown }).questions);
  if (topLevel.length) return topLevel;
  const output = (result as { output?: unknown }).output;
  const outputQuestions = normalizePlannerQuestions(
    output && typeof output === 'object' ? (output as { questions?: unknown }).questions : undefined,
  );
  if (outputQuestions.length) return outputQuestions;
  return undefined;
}

function extractPlannerQuestionsFromToolResults(toolResults: ToolExecutionResult[] | undefined): PlannerQuestion[] {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return [];
  const combined: PlannerQuestion[] = [];
  const seen = new Set<string>();

  for (const toolResult of toolResults) {
    const questions = extractQuestionsFromResult(toolResult);
    if (!questions || !questions.length) continue;
    for (const question of questions) {
      const key = `${question.key}::${question.query}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(question);
    }
  }

  return combined.slice(0, 6);
}

function inferPlannerContinuation(toolResults: ToolExecutionResult[] | undefined): {
  failed: boolean;
  needsUserInput: boolean;
  navigationPending: boolean;
  sameTabNavigationPending: boolean;
} {
  if (!Array.isArray(toolResults) || toolResults.length === 0) {
    return {
      failed: false,
      needsUserInput: false,
      navigationPending: false,
      sameTabNavigationPending: false,
    };
  }

  let failed = false;
  let needsUserInput = false;
  let navigationPending = false;
  let sameTabNavigationPending = false;

  for (const result of toolResults) {
    if (!result || typeof result !== 'object') continue;
    if (result.error || result.errorDetails) {
      failed = true;
      continue;
    }
    const output =
      result.output && typeof result.output === 'object'
        ? result.output as Record<string, unknown>
        : undefined;
    if (!output) continue;

    const navigation = classifyNavigationContinuation({
      navigationPending: output.navigationPending,
      navigationOutcome: output.navigationOutcome,
      navigationMode: output.navigation,
    });
    if (navigation.isNavigationProgress) {
      navigationPending = true;
      if (navigation.continuationReason === 'same_tab_navigation_handoff') {
        sameTabNavigationPending = true;
      }
    }

    const status = String(output.taskStatus || output.status || '').trim().toLowerCase();
    if (status === 'failure' || status === 'failed' || status === 'error') {
      failed = true;
    }
    if (status === 'waiting_input' || status === 'needs_input' || status === 'pending_user_input') {
      needsUserInput = true;
    }

    if (output.needsUserInput === true || output.waitingForUserInput === true) {
      needsUserInput = true;
    }
    const questions = normalizePlannerQuestions(output.questions);
    if (questions.length > 0) {
      needsUserInput = true;
    }
  }

  return { failed, needsUserInput, navigationPending, sameTabNavigationPending };
}

type DirectToolResult = ToolExecutionResult & {
  status?: string;
  navigationPending?: boolean;
  navigationOutcome?: string;
  navigation?: string;
};

function deriveDirectToolRunOutcome(result: DirectToolResult | undefined): RunOutcome {
  if (!result || typeof result !== 'object') {
    return {
      taskComplete: true,
      terminalState: 'completed',
      contextResetRecommended: true,
    };
  }

  const topLevelNavigation = classifyNavigationContinuation({
    navigationPending: result.navigationPending,
    navigationOutcome: result.navigationOutcome,
    navigationMode: result.navigation,
  });
  if (topLevelNavigation.isNavigationProgress) {
    return {
      taskComplete: false,
      terminalState: 'in_progress',
      navigationPending: topLevelNavigation.continuationReason === 'same_tab_navigation_handoff',
      continuationReason: topLevelNavigation.continuationReason || 'loop_continue',
    };
  }

  const questions = extractQuestionsFromResult(result);
  if (result.error) return { taskComplete: false, terminalState: 'failed' };

  const output = result.output;
  if (output && typeof output === 'object') {
    const outputRecord = output as Record<string, unknown>;
    const topLevelStatus = String(result.status || '').trim().toLowerCase();
    if (topLevelStatus === 'failure' || topLevelStatus === 'failed' || topLevelStatus === 'error') {
      return { taskComplete: false, terminalState: 'failed' };
    }
    if (topLevelStatus === 'waiting_input' || topLevelStatus === 'needs_input' || topLevelStatus === 'pending_user_input') {
      return {
        taskComplete: false,
        needsUserInput: true,
        questions,
        terminalState: 'waiting_input',
        continuationReason: 'awaiting_user',
      };
    }

    const navigation = classifyNavigationContinuation({
      navigationPending: outputRecord.navigationPending,
      navigationOutcome: outputRecord.navigationOutcome,
      navigationMode: outputRecord.navigation,
    });
    if (navigation.isNavigationProgress) {
      return {
        taskComplete: false,
        terminalState: 'in_progress',
        navigationPending: navigation.continuationReason === 'same_tab_navigation_handoff',
        continuationReason: navigation.continuationReason || 'loop_continue',
        contextResetRecommended: false,
      };
    }
    if (outputRecord.needsUserInput === true || outputRecord.waitingForUserInput === true) {
      return {
        taskComplete: false,
        needsUserInput: true,
        questions,
        terminalState: 'waiting_input',
        continuationReason: 'awaiting_user',
      };
    }

    if (Array.isArray(outputRecord.questions) && outputRecord.questions.length > 0) {
      return {
        taskComplete: false,
        needsUserInput: true,
        questions,
        terminalState: 'waiting_input',
        continuationReason: 'awaiting_user',
      };
    }

    if (outputRecord.error || outputRecord.success === false) return { taskComplete: false, terminalState: 'failed' };

    const taskStatus = String(outputRecord.taskStatus || outputRecord.status || '').toLowerCase();
    if (taskStatus) {
      if (taskStatus === 'waiting_input' || taskStatus === 'needs_input' || taskStatus === 'pending_user_input') {
        return {
          taskComplete: false,
          needsUserInput: true,
          terminalState: 'waiting_input',
          continuationReason: 'awaiting_user',
        };
      }
      if (taskStatus === 'failure' || taskStatus === 'failed' || taskStatus === 'error') {
        return { taskComplete: false, terminalState: 'failed' };
      }
    }
  }

  return {
    taskComplete: true,
    terminalState: 'completed',
    contextResetRecommended: true,
  };
}

function normalizeRunOutcome(outcome?: Partial<RunOutcome> | null): RunOutcome {
  if (!outcome || typeof outcome !== 'object') {
    return {
      taskComplete: true,
      needsUserInput: false,
      terminalState: 'completed',
      continuationReason: undefined,
      contextResetRecommended: true,
    };
  }
  const inferredNeedsUserInput = outcome.needsUserInput === true;
  const incomingTerminalState = String((outcome as any).terminalState || '').trim().toLowerCase() as RunTerminalState | '';
  const terminalState: RunTerminalState =
    incomingTerminalState === 'waiting_input'
    || incomingTerminalState === 'in_progress'
    || incomingTerminalState === 'completed'
    || incomingTerminalState === 'failed'
      ? incomingTerminalState
      : inferredNeedsUserInput
        ? 'waiting_input'
        : outcome.taskComplete === true
          ? 'completed'
          : outcome.taskComplete === false
            ? 'in_progress'
            : 'completed';
  const needsUserInput = terminalState === 'waiting_input' || inferredNeedsUserInput;
  const taskComplete = terminalState === 'completed' || (outcome.taskComplete === true && !needsUserInput);
  const questions = normalizePlannerQuestions((outcome as any).questions);
  const continuationCandidate = String((outcome as any).continuationReason || '').trim().toLowerCase();
  const continuationReason: RunContinuationReason | undefined =
    continuationCandidate === 'loop_continue'
    || continuationCandidate === 'same_tab_navigation_handoff'
    || continuationCandidate === 'awaiting_user'
      ? continuationCandidate as RunContinuationReason
      : needsUserInput
        ? 'awaiting_user'
        : (outcome.navigationPending === true
          ? 'same_tab_navigation_handoff'
          : (terminalState === 'in_progress' && !taskComplete ? 'loop_continue' : undefined));
  const contextResetRecommended =
    outcome.contextResetRecommended === true
    || terminalState === 'completed'
    || terminalState === 'failed';
  return {
    route: outcome.route,
    taskComplete,
    needsUserInput,
    questions: questions.length ? questions : undefined,
    terminalState,
    continuationReason,
    contextResetRecommended,
  };
}

function rememberTerminalRun(runId: string, result: TerminalRunResult): void {
  terminalRuns.set(runId, result);
  while (terminalRuns.size > 20) {
    const oldest = terminalRuns.keys().next().value;
    if (!oldest) break;
    terminalRuns.delete(oldest);
  }
}

function rememberCancelledRun(runId: string): void {
  cancelledRunIds.add(runId);
  while (cancelledRunIds.size > 20) {
    const oldest = cancelledRunIds.values().next().value;
    if (!oldest) break;
    cancelledRunIds.delete(oldest);
  }
}

function throwIfCancelledRun(runId?: string): void {
  if (!runId) return;
  if (cancelledRunIds.has(runId)) {
    throw new DOMException('Run cancelled', 'AbortError');
  }
}

function clearTaskScopedContextAfterBoundary(_reason: 'cancel' | 'end' | 'new_task' | 'complete'): void {
  history.length = 0;
  plannerHistory = [];
  agentPrevSteps = [];
  pendingAskUser = undefined;
  rootUserInput = '';
  taskSeedChatLog = [];
  attachedFiles = [];
}

async function maybeWaitForNewTab(
  result: any,
): Promise<{ openedTab?: OpenedTabMetadata; readyState?: NewTabReadyState }> {
  const openedTab = detectOpenedTabFromToolResult(result);
  if (openedTab) {
    postStatus('Waiting for new tab to load...', undefined, 'execute');
    const readyState = await waitForNewTabReady(openedTab);
    return { openedTab, readyState };
  }
  return {};
}

async function handleUserMessage(
  text: string,
  options?: {
    resume?: boolean;
    preserveHistory?: boolean;
    seedChatLog?: FollowupChatLogEntry[];
    files?: LLMDataInput[];
    routing?: 'auto' | 'act' | 'planner';
    askUserAnswers?: AskUserAnswerMeta;
    narrationEnabledForRun?: boolean;
    narrationPreferenceSource?: 'default' | 'visitor';
    narrationDefaultActiveForRun?: boolean;
    narrationRunKind?: 'guide' | 'task';
    narrationLanguage?: string;
    actionSpotlightEnabledForRun?: boolean;
    actionSpotlightRunKind?: 'guide' | 'task';
    actionSpotlightDefaultActiveForRun?: boolean;
  },
): Promise<RunOutcome> {
  if (!config) throw new Error('Worker not initialized');
  if (!bridgeRpc) throw new Error('Bridge RPC not initialized');
  const activeRunId = activeRun?.runId;
  throwIfCancelledRun(activeRunId);
  postStatus('Analyzing request', text, 'analyze');

  const shouldSkipUserPush =
    options?.resume &&
    history.length > 0 &&
    history[history.length - 1]?.role === 'user' &&
    history[history.length - 1]?.content === text;

  const normalizedIncomingText = String(text || '').trim();
  if (config.external?.adversarialGate === 'pre_tool_block') {
    const adversarial = assessAdversarialInput(normalizedIncomingText);
    if (adversarial.blocked) {
      const blockedMessage = 'I can’t run that request because it appears adversarial. Please rephrase with a safe, task-focused instruction.';
      postAssistantMessage(blockedMessage);
      postStatus('Blocked unsafe request', adversarial.reasons.join(', ') || 'adversarial_input', 'complete');
      postStateSnapshot();
      return {
        taskComplete: false,
        needsUserInput: false,
        terminalState: 'failed',
        contextResetRecommended: true,
      };
    }
  }

  const pendingAskUserSnapshot =
    pendingAskUser
    && pendingAskUser.boundaryId
    && pendingAskUser.boundaryId !== taskBoundaryId
      ? undefined
      : pendingAskUser;
  if (!pendingAskUserSnapshot && pendingAskUser) {
    pendingAskUser = undefined;
  }
  const fallbackRootInput = normalizeRootUserInput(getRootUserInputFallbackFromHistory());
  const existingRootInput = normalizeRootUserInput(rootUserInput) || fallbackRootInput;
  const hasStructuredAskUserAnswers = !!(options?.askUserAnswers && typeof options.askUserAnswers === 'object');
  if (existingRootInput) {
    rootUserInput = existingRootInput;
  }
  if (!pendingAskUserSnapshot?.questions?.length && normalizedIncomingText && !options?.resume && !hasStructuredAskUserAnswers) {
    rootUserInput = normalizedIncomingText;
  }

  let effectiveUserInput = text;
  let consumedAsAskUserAnswer = false;
  if (pendingAskUserSnapshot?.questions?.length) {
    const normalizedAnswers = normalizeAskUserAnswerMeta(options?.askUserAnswers, pendingAskUserSnapshot.questions, text);
    if (normalizedAnswers) {
      consumedAsAskUserAnswer = true;
      const answerContext = buildAskUserAnswerContext(pendingAskUserSnapshot.questions, normalizedAnswers);
      const focusInput = normalizeRootUserInput(rootUserInput) || normalizedIncomingText || fallbackRootInput || '';
      if (focusInput) rootUserInput = focusInput;
      effectiveUserInput = buildContinuePlanningInput(focusInput, 'ask_user', answerContext);

      if (pendingAskUserSnapshot.source === 'planner') {
        plannerHistory = mergeAskUserAnswersIntoPlannerHistory(
          plannerHistory,
          pendingAskUserSnapshot.questions,
          normalizedAnswers.answersByKey,
        );
      }

      applyAgentPrevSteps(
        mergeAskUserAnswerIntoPrevSteps(agentPrevSteps, pendingAskUserSnapshot, normalizedAnswers),
        { snapshot: false },
      );

      pendingAskUser = undefined;
      postStateSnapshot();
    }
  } else if (hasStructuredAskUserAnswers) {
    const normalizedAnswers = normalizeAskUserAnswerMeta(options?.askUserAnswers, [], text);
    const focusInput = normalizeRootUserInput(rootUserInput) || fallbackRootInput || '';
    if (focusInput) {
      rootUserInput = focusInput;
      effectiveUserInput = buildContinuePlanningInput(
        focusInput,
        'ask_user',
        normalizedAnswers?.rawText || normalizedIncomingText,
      );
    } else if (normalizedIncomingText) {
      rootUserInput = normalizedIncomingText;
    }
  }

  if (!shouldSkipUserPush && !consumedAsAskUserAnswer) {
    history.push({ role: 'user', content: text });
    postStateSnapshot();
  }

  throwIfCancelledRun(activeRunId);
  const tabs = await getKnownTabs();
  throwIfCancelledRun(activeRunId);
  const fallbackTabs: RoverTab[] =
    tabs.length > 0
      ? tabs
      : [
          {
            id: 1,
            external: false,
            accessMode: 'live_dom',
          },
        ];
  const resolvedTabs = await resolveRuntimeTabs(bridgeRpc, fallbackTabs, {
    scopedTabIds,
    seedTabId: scopedSeedTabId,
    onDiagnostics: payload => {
      postRuntimeTabsDiagnostics(payload);
    },
  });
  throwIfCancelledRun(activeRunId);
  const tabsById = new Map<number, RoverTab>(tabs.map(tab => [tab.id, tab]));
  const orderedTabs = resolvedTabs.tabOrder
    .map(tabId => {
      const knownTab = tabsById.get(tabId);
      if (knownTab) return knownTab;

      const tabMeta = resolvedTabs.tabMetaById[tabId];
      if (!tabMeta) return { id: tabId } as RoverTab;
      const external = !!tabMeta.external;
      return {
        id: tabId,
        url: tabMeta.url,
        title: tabMeta.title,
        external,
        accessMode: tabMeta.accessMode || (external ? 'external_placeholder' : 'live_dom'),
        inaccessibleReason: tabMeta.inaccessibleReason,
      } as RoverTab;
    })
    .filter(tab => Number.isFinite(tab.id) && tab.id > 0);
  const tabsForRun = orderedTabs.length > 0 ? orderedTabs : fallbackTabs;
  if (orderedTabs.length === 0) {
    postStatus(
      'Using fallback tab mapping',
      `active=${resolvedTabs.activeTabId}; order=${resolvedTabs.tabOrder.join(',') || 'none'}`,
      'analyze',
    );
  }

  if (!tabularStore) {
    tabularStore = new TabularStore(`rover-${taskTrajectoryId}`);
  }
  const agentName = resolveAgentName(config);
  const narrationHints = resolveActionNarrationHints(config, rootUserInput, {
    narrationEnabledForRun: options?.narrationEnabledForRun,
    narrationPreferenceSource: options?.narrationPreferenceSource,
    narrationDefaultActiveForRun: options?.narrationDefaultActiveForRun,
    narrationRunKind: options?.narrationRunKind,
    narrationLanguage: options?.narrationLanguage,
    actionSpotlightEnabledForRun: options?.actionSpotlightEnabledForRun,
    actionSpotlightRunKind: options?.actionSpotlightRunKind,
    actionSpotlightDefaultActiveForRun: options?.actionSpotlightDefaultActiveForRun,
  });
  activeActionNarration = narrationHints.actionNarration === true;
  activeActionNarrationDefaultActive = narrationHints.actionNarrationDefaultActive === true;
  const runtimeContext = buildRoverRuntimeContext({
    tabs: tabsForRun,
    config,
    agentName,
    taskBoundaryId,
    ...narrationHints,
  });
  const ctx = createAgentContext(
    {
      ...config,
      signal: activeAbortController?.signal,
      sessionId: workerSessionId || config.sessionId || taskTrajectoryId,
      activeRunId,
      rootUserInput: normalizeRootUserInput(rootUserInput),
      runtimeContext,
      tools: {
        web: extractWebToolsConfig(config),
      },
    },
    bridgeRpc,
    tabularStore,
  );
  ctx.isCancelled = () => !!(activeRunId && cancelledRunIds.has(activeRunId));
  // Only pass user/client-declared tools. Planner built-ins come from backend.
  const functionDeclarations = dedupeFunctionDeclarations(
    removePlannerNameCollisions(toolRegistry.getFunctionDeclarations()),
  );
  const toolFunctions = toolRegistry.getToolFunctions();
  if (Array.isArray(options?.seedChatLog)) {
    taskSeedChatLog = normalizeFollowupChatLog(options.seedChatLog);
  }
  if (Array.isArray(options?.files)) {
    attachedFiles = sanitizeAttachedFiles(options.files);
  }
  const chatLog = taskSeedChatLog;
  const onPrevStepsUpdate = (steps: PreviousSteps[]) => {
    applyAgentPrevSteps(steps, { snapshot: true });
  };
  const onPlannerHistoryUpdate = (steps: any[]) => {
    plannerHistory = sanitizePlannerHistoryForPersist(Array.isArray(steps) ? steps : []);
    postStateSnapshot();
  };
  const getScopedTabRuntimeContext = () => ({
    scopedTabIds: [...scopedTabIds],
    seedTabId: scopedSeedTabId,
  });
  const onScopedTabIdsTouched = (tabIds: number[]) => {
    touchRunScopedTabIds(tabIds);
  };
  const onAssistantCheckpoint = (payload: AssistantCheckpointPayload) => {
    postAssistantResponse(payload);
  };

  throwIfCancelledRun(activeRunId);
  const result = await handleSendMessageWithFunctions(effectiveUserInput, {
    tabs: tabsForRun,
    scopedTabIds,
    seedTabId: scopedSeedTabId,
    getScopedTabRuntimeContext,
    onScopedTabIdsTouched,
    previousMessages: history,
    trajectoryId: taskTrajectoryId,
    files: attachedFiles,
    recordingContext: config.recordingContext,
    previousSteps: plannerHistory,
    onStatusUpdate: postStatus,
    toolFunctions,
    agentLog: {
      prevSteps: agentPrevSteps,
      chatLog,
    },
    lastToolPreviousSteps: agentPrevSteps,
    taskRouting: options?.routing
      ? { ...config.taskRouting, mode: options.routing }
      : config.taskRouting,
    ctx,
    bridgeRpc,
    functionDeclarations,
    onPrevStepsUpdate,
    onPlannerHistoryUpdate,
    onAssistantCheckpoint,
  });
  throwIfCancelledRun(activeRunId);
  if (result.directToolResult) {
    touchRunScopedTabIds(extractTouchedTabIdsFromToolResult(result.directToolResult));
  }
  if (Array.isArray(result.executedFunctions) && result.executedFunctions.length > 0) {
    for (const executed of result.executedFunctions) {
      touchRunScopedTabIds(extractTouchedTabIdsFromToolResult(executed?.result));
    }
  }

  if (!result.success) {
    const rawErrorPayload = toStructuredErrorPayload(result.error, 'Something went wrong.');
    const errorPayload = normalizeLifecycleHandoffError(rawErrorPayload, agentPrevSteps);
    const errorCode = String(errorPayload.error.code || '').trim().toUpperCase();
    const isRetryableLifecycleError =
      !!errorPayload.error.retryable
      || errorCode === 'STALE_SEQ'
      || errorCode === 'STALE_EPOCH'
      || errorCode === 'SESSION_TOKEN_EXPIRED'
      || errorCode === 'NAVIGATION_HANDOFF_PENDING';

    if (isRetryableLifecycleError) {
      const retryMessage = `${errorPayload.error.code}: ${errorPayload.error.message}`;
      postAssistantMessage(retryMessage);
      postStatus('Waiting for navigation/session sync', errorPayload.error.message, 'verify');
      postStateSnapshot();
      return {
        route: result.route,
        taskComplete: false,
        terminalState: 'in_progress',
        continuationReason: 'loop_continue',
        contextResetRecommended: false,
      };
    }

    if (errorPayload.error.requires_api_key) {
      postAuthRequired(errorPayload.error);
    }
    postAssistantMessage({
      text: `${errorPayload.error.code}: ${errorPayload.error.message}`,
      responseKind: 'error',
      blocks: [
        {
          type: 'json',
          label: 'Error details',
          data: normalizeRuntimeToolOutput(errorPayload),
        },
      ],
    });
    postStatus('Execution failed', errorPayload.error.message, 'complete');
    postStateSnapshot();
    return { route: result.route, taskComplete: false, terminalState: 'failed' };
  }

  if (result.executedFunctions?.length) {
    for (const fn of result.executedFunctions) {
      applyAgentPrevSteps(fn.prevSteps, { snapshot: false });
    }
    const blocks: AssistantMessageBlock[] = [];
    const lines: string[] = [];
    let inferredFailed = false;
    let inferredCompleted = false;
    let inferredNavigationPending = false;
    let inferredSameTabPending = false;
    let inferredNeedsUserInput = false;
    let inferredQuestions: PlannerQuestion[] = [];
    for (const fn of result.executedFunctions) {
      const summary = summarizeOutputText(fn.result);
      if (fn.result !== undefined && shouldAttachStructuredBlock(fn.result, summary)) {
        blocks.push({
          type: 'tool_output',
          toolName: fn.name,
          label: `${fn.name} output`,
          data: normalizeRuntimeToolOutput(fn.result),
        });
      }
      if (fn.error) {
        blocks.push({
          type: 'json',
          label: `${fn.name} error`,
          data: normalizeRuntimeToolOutput({ error: fn.error }),
        });
      }
      lines.push(summary ? `@${fn.name}: ${summary}` : `@${fn.name}: ${fn.error || 'ok'}`);

      if (fn.error) {
        inferredFailed = true;
        continue;
      }

      const rawResult = fn.result;
      if (!rawResult || typeof rawResult !== 'object') continue;
      const normalized = Array.isArray(rawResult)
        ? rawResult.find(item => item && typeof item === 'object') as Record<string, unknown> | undefined
        : rawResult as Record<string, unknown>;
      if (!normalized) continue;

      const taskComplete = normalized.taskComplete;
      if (typeof taskComplete === 'boolean' && taskComplete) {
        inferredCompleted = true;
      }

      const navigation = classifyNavigationContinuation({
        navigationPending: normalized.navigationPending,
        navigationOutcome: normalized.navigationOutcome,
        navigationMode: normalized.navigation,
      });
      if (navigation.isNavigationProgress) {
        inferredNavigationPending = true;
        if (navigation.continuationReason === 'same_tab_navigation_handoff') {
          inferredSameTabPending = true;
        }
      }

      const statusRaw = String(normalized.taskStatus || normalized.status || '').trim().toLowerCase();
      if (statusRaw === 'failed' || statusRaw === 'error' || statusRaw === 'failure') {
        inferredFailed = true;
      }
      if (statusRaw === 'waiting_input' || statusRaw === 'needs_input' || statusRaw === 'pending_user_input') {
        inferredNeedsUserInput = true;
      }
      if (statusRaw === 'completed' || statusRaw === 'complete' || statusRaw === 'done' || statusRaw === 'success') {
        inferredCompleted = true;
      }

      if (normalized.needsUserInput === true || normalized.waitingForUserInput === true) {
        inferredNeedsUserInput = true;
      }
      const q = extractQuestionsFromResult(normalized as Record<string, unknown>);
      if (q?.length) {
        inferredNeedsUserInput = true;
        inferredQuestions = normalizePlannerQuestions([...inferredQuestions, ...q]);
      }
    }
    postAssistantMessage({
      text: lines.join('\n'),
      blocks,
      responseKind: inferredFailed ? 'error' : 'final',
    });
    postStatus('Execution completed', 'Function calls finished', 'complete');
    postStateSnapshot();
    if (inferredFailed) {
      return {
        route: result.route,
        taskComplete: false,
        terminalState: 'failed',
      };
    }
    if (inferredNavigationPending) {
      return {
        route: result.route,
        taskComplete: false,
        terminalState: 'in_progress',
        continuationReason: inferredSameTabPending ? 'same_tab_navigation_handoff' : 'loop_continue',
        contextResetRecommended: false,
      };
    }
    if (inferredNeedsUserInput) {
      return {
        route: result.route,
        taskComplete: false,
        needsUserInput: true,
        questions: inferredQuestions.length ? inferredQuestions : undefined,
        terminalState: 'waiting_input',
        continuationReason: 'awaiting_user',
      };
    }
    return {
      route: result.route,
      taskComplete: true,
      terminalState: 'completed',
      continuationReason: undefined,
      contextResetRecommended: true,
    };
  }

  if (result.directToolResult) {
    throwIfCancelledRun(activeRunId);
    const newTabWait = await maybeWaitForNewTab(result.directToolResult);
    if (
      newTabWait.openedTab
      && newTabWait.readyState
      && !newTabWait.readyState.ready
      && !newTabWait.readyState.external
    ) {
      const fallbackUrl = String(newTabWait.openedTab.url || '').trim();
      if (fallbackUrl && bridgeRpc) {
        postStatus('New tab did not attach; continuing in current tab', undefined, 'execute');
        try {
          const tabCtx = await bridgeRpc('getTabContext');
          const localLogicalTabId = Number(tabCtx?.logicalTabId ?? tabCtx?.id);
          if (Number.isFinite(localLogicalTabId) && localLogicalTabId > 0) {
            await bridgeRpc('executeTool', {
              call: {
                name: 'switch_tab',
                args: { tab_id: localLogicalTabId },
              },
              payload: {
                forceLocal: true,
                reason: 'opened_tab_unattached_reset_active',
              },
            });
          }
          const fallbackResult = await bridgeRpc('executeTool', {
            call: {
              name: 'goto_url',
              args: {
                tab_id: 0,
                url: fallbackUrl,
              },
            },
            payload: {
              forceLocal: true,
              reason: 'opened_tab_unattached_fallback',
            },
          });
          maybePostNavigationGuardrailFromToolResult(fallbackResult);
        } catch {
          // best-effort fallback
        }
      }
    }
    postStatus('Verifying result', undefined, 'verify');
    maybePostNavigationGuardrailFromToolResult(result.directToolResult);
    applyAgentPrevSteps(result.directToolResult.prevSteps, { snapshot: false });
    const outcome = deriveDirectToolRunOutcome(result.directToolResult);
    const questions = normalizePlannerQuestions(outcome.questions);
    if (outcome.needsUserInput && questions.length > 0) {
      pendingAskUser = {
        ...buildPendingAskUserPrompt('act', questions),
      };
      plannerHistory = sanitizePlannerHistoryForPersist([
        ...plannerHistory,
        {
          thought: 'Need user clarification before continuing act workflow.',
          questionsAsked: questions,
        },
      ]);
      postAssistantMessage({
        text: buildAskUserResponseText('I need a bit more info before continuing:', questions),
        responseKind: 'question',
      });
      postStatus('Need more input to continue', undefined, 'verify');
      postStateSnapshot();
      return {
        route: result.route,
        taskComplete: false,
        needsUserInput: true,
        questions,
        terminalState: 'waiting_input',
        continuationReason: 'awaiting_user',
      };
    }

    pendingAskUser = undefined;
    const output =
      result.directToolResult.output ??
      result.directToolResult.generatedContentRef ??
      result.directToolResult.schemaHeaderSheetInfo;
    const structuredError = extractStructuredErrorFromToolResult(result.directToolResult);
    if (structuredError?.error.requires_api_key) {
      postAuthRequired(structuredError.error);
    }
    structuredError
      ? postAssistantMessage({
          text: `${structuredError.error.code}: ${structuredError.error.message}`,
          responseKind: 'error',
          blocks: [
            {
              type: 'json',
              label: 'Error details',
              data: normalizeRuntimeToolOutput(structuredError),
            },
          ],
        })
      : postAssistantMessage({
        ...buildAssistantPayloadFromToolOutput(output, {
          label: 'Tool output',
          fallbackText: 'I finished the step.',
        }),
        responseKind: 'final',
      });
    postStatus('Execution completed', structuredError?.error.message, 'complete');
    postStateSnapshot();
    return {
      route: result.route,
      taskComplete: outcome.taskComplete,
      needsUserInput: outcome.needsUserInput,
      questions: normalizePlannerQuestions(outcome.questions),
      terminalState: outcome.terminalState,
      continuationReason: outcome.continuationReason,
      contextResetRecommended: outcome.contextResetRecommended,
    };
  }

  if (result.plannerResponse) {
    postStatus('Verifying planner output', undefined, 'verify');
    const response = result.plannerResponse.response;
    const toolResults = result.plannerResponse.toolResults || [];
    if (result.plannerResponse.previousSteps) {
      plannerHistory = result.plannerResponse.previousSteps;
      postStateSnapshot();
    }
    const latestToolPrevSteps = extractLatestPrevStepsFromPlanner(toolResults);
    applyAgentPrevSteps(latestToolPrevSteps, { snapshot: false });

    const responseQuestions = normalizePlannerQuestions(response.questions);
    const fallbackQuestions = responseQuestions.length
      ? []
      : extractPlannerQuestionsFromToolResults(toolResults);
    const plannerQuestions = responseQuestions.length ? responseQuestions : fallbackQuestions;

    if (plannerQuestions.length) {
      const questions = plannerQuestions;
      pendingAskUser = questions.length
        ? buildPendingAskUserPrompt('planner', questions)
        : undefined;
      postAssistantMessage({
        text: buildAskUserResponseText('I need a bit more info:', questions),
        responseKind: 'question',
      });
      postStatus('Planner needs user input', undefined, 'verify');
      postStateSnapshot();
      return {
        route: result.route,
        taskComplete: false,
        needsUserInput: true,
        questions,
        terminalState: 'waiting_input',
        continuationReason: 'awaiting_user',
      };
    }

    pendingAskUser = undefined;

    for (const toolResult of toolResults) {
      await maybeWaitForNewTab(toolResult);
      maybePostNavigationGuardrailFromToolResult(toolResult);
    }
    const toolBlocks = buildPlannerToolResultBlocks(toolResults);
    const responseError = response.error || response.errorDetails
      ? toStructuredErrorPayload(response.errorDetails || { message: response.error }, 'Planner failed')
      : undefined;
    const plannerContinuation = inferPlannerContinuation(toolResults);
    if (responseError?.error.requires_api_key) {
      postAuthRequired(responseError.error);
    }
    responseError
      ? postAssistantMessage({
          text: `${responseError.error.code}: ${responseError.error.message}`,
          responseKind: 'error',
          blocks: [
            {
              type: 'json',
              label: 'Planner error',
              data: normalizeRuntimeToolOutput(responseError),
            },
            ...(toolBlocks || []),
          ],
        })
      : postAssistantMessage({
        text: String(response.overallThought || summarizePlannerToolResults(toolResults) || ''),
        blocks: toolBlocks,
        responseKind: 'final',
      });
    postStatus('Planner execution completed', response.overallThought, 'complete');
    postStateSnapshot();
    const plannerComplete = !!response.taskComplete && !responseError && !plannerContinuation.needsUserInput && !plannerContinuation.navigationPending;
    return {
      route: result.route,
      taskComplete: plannerComplete,
      needsUserInput: plannerContinuation.needsUserInput,
      terminalState: responseError
        ? 'failed'
        : plannerContinuation.needsUserInput
          ? 'waiting_input'
          : plannerContinuation.navigationPending
            ? 'in_progress'
            : 'completed',
      continuationReason:
        responseError
          ? undefined
          : plannerContinuation.needsUserInput
            ? 'awaiting_user'
            : plannerContinuation.navigationPending
              ? (plannerContinuation.sameTabNavigationPending ? 'same_tab_navigation_handoff' : 'loop_continue')
              : undefined,
      contextResetRecommended: !responseError && plannerComplete,
    };
  }

  postStatus('Completed', undefined, 'complete');
  postStateSnapshot();
  return {
    route: result.route,
    taskComplete: true,
    terminalState: 'completed',
    contextResetRecommended: true,
  };
}

async function runUserMessage(
  text: string,
  meta?: {
    runId?: string;
    trajectoryId?: string;
    resume?: boolean;
    preserveHistory?: boolean;
    seedChatLog?: FollowupChatLogEntry[];
    files?: LLMDataInput[];
    routing?: 'auto' | 'act' | 'planner';
    askUserAnswers?: AskUserAnswerMeta;
    narrationEnabledForRun?: boolean;
    narrationPreferenceSource?: 'default' | 'visitor';
    narrationDefaultActiveForRun?: boolean;
    narrationRunKind?: 'guide' | 'task';
    narrationLanguage?: string;
    actionSpotlightEnabledForRun?: boolean;
    actionSpotlightRunKind?: 'guide' | 'task';
    actionSpotlightDefaultActiveForRun?: boolean;
  },
): Promise<void> {
  const runId = meta?.runId || crypto.randomUUID();
  const terminal = terminalRuns.get(runId);
  if (terminal) {
    if (terminal.ok) {
      const cachedOutcome = normalizeRunOutcome(terminal.outcome);
        (self as any).postMessage({
          type: 'execution_completed',
          executionId: runId,
          runBoundaryId: terminal.taskBoundaryId,
          ok: true,
          route: cachedOutcome.route,
          runComplete: cachedOutcome.taskComplete,
          needsUserInput: cachedOutcome.needsUserInput,
          questions: cachedOutcome.questions,
          terminalState: cachedOutcome.terminalState,
          continuationReason: cachedOutcome.continuationReason,
          contextResetRecommended: cachedOutcome.contextResetRecommended,
        });
    } else {
      (self as any).postMessage({
        type: 'execution_completed',
        executionId: runId,
        runBoundaryId: terminal.taskBoundaryId,
        ok: false,
        error: terminal.error,
        runComplete: false,
        needsUserInput: false,
        terminalState: 'failed',
        contextResetRecommended: terminal.contextResetRecommended,
      });
    }
    return;
  }
  if (activeRun && activeRun.runId === runId) {
    return;
  }
  if (typeof meta?.trajectoryId === 'string' && meta.trajectoryId.trim()) {
    taskTrajectoryId = meta.trajectoryId.trim();
  }
  const resume = !!meta?.resume;
  const preserveHistory = !!meta?.preserveHistory;
  const runTaskBoundaryId = taskBoundaryId;
  lastStatusKey = '';
  seenStatusKeys = new Set<string>();
  lastRuntimeTabsDiagnosticsKey = '';
  lastAssistantResponseNarrationKey = '';
  cancelledRunIds.delete(runId);
  activeAbortController = new AbortController();
  activeRun = { runId, text, startedAt: Date.now(), resume, preserveHistory };
  (self as any).postMessage({ type: 'execution_started', executionId: runId, text, resume, runBoundaryId: runTaskBoundaryId });

  if (shouldClearHistoryForRun({ resume, preserveHistory })) {
    // Keep prevSteps/planner history task-sticky. Clear chat history unless caller explicitly preserves follow-up cues.
    history.length = 0;
  }

  postStateSnapshot();

  try {
    const outcome = normalizeRunOutcome(await handleUserMessage(text, {
      resume,
      preserveHistory,
      seedChatLog: Array.isArray(meta?.seedChatLog) ? normalizeFollowupChatLog(meta.seedChatLog) : undefined,
      files: Array.isArray(meta?.files) ? sanitizeAttachedFiles(meta.files) : undefined,
      routing: meta?.routing,
      askUserAnswers: meta?.askUserAnswers,
      narrationEnabledForRun: meta?.narrationEnabledForRun,
      narrationPreferenceSource: meta?.narrationPreferenceSource,
      narrationDefaultActiveForRun: meta?.narrationDefaultActiveForRun,
      narrationRunKind: meta?.narrationRunKind,
      narrationLanguage: meta?.narrationLanguage,
      actionSpotlightEnabledForRun: meta?.actionSpotlightEnabledForRun,
      actionSpotlightRunKind: meta?.actionSpotlightRunKind,
      actionSpotlightDefaultActiveForRun: meta?.actionSpotlightDefaultActiveForRun,
    }));
    const isTerminalOutcome =
      outcome.terminalState === 'completed'
      || outcome.terminalState === 'failed';
    if (isTerminalOutcome) {
      rememberTerminalRun(runId, { ok: true, outcome, taskBoundaryId: runTaskBoundaryId });
      (self as any).postMessage({
        type: 'execution_completed',
        executionId: runId,
        runBoundaryId: runTaskBoundaryId,
        ok: true,
        route: outcome.route,
        runComplete: outcome.taskComplete,
        needsUserInput: outcome.needsUserInput,
        questions: outcome.questions,
        terminalState: outcome.terminalState,
        continuationReason: outcome.continuationReason,
        contextResetRecommended: outcome.contextResetRecommended,
      });
    } else {
      terminalRuns.delete(runId);
      (self as any).postMessage({
        type: 'execution_state_transition',
        executionId: runId,
        runBoundaryId: runTaskBoundaryId,
        ok: true,
        route: outcome.route,
        runComplete: outcome.taskComplete,
        needsUserInput: outcome.needsUserInput,
        questions: outcome.questions,
        terminalState: outcome.terminalState,
        continuationReason: outcome.continuationReason,
        contextResetRecommended: outcome.contextResetRecommended,
      });
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      rememberTerminalRun(runId, {
        ok: false,
        error: 'Run cancelled',
        taskComplete: false,
        needsUserInput: false,
        terminalState: 'failed',
        contextResetRecommended: false,
        taskBoundaryId: runTaskBoundaryId,
      });
      (self as any).postMessage({
        type: 'execution_completed',
        executionId: runId,
        runBoundaryId: runTaskBoundaryId,
        ok: false,
        error: 'Run cancelled',
        runComplete: false,
        needsUserInput: false,
        terminalState: 'failed',
        contextResetRecommended: false,
      });
    } else {
      rememberTerminalRun(runId, {
        ok: false,
        error: error?.message || String(error),
        taskComplete: false,
        needsUserInput: false,
        terminalState: 'failed',
        contextResetRecommended: true,
        taskBoundaryId: runTaskBoundaryId,
      });
      (self as any).postMessage({
        type: 'execution_completed',
        executionId: runId,
        runBoundaryId: runTaskBoundaryId,
        ok: false,
        error: error?.message || String(error),
        runComplete: false,
        needsUserInput: false,
        terminalState: 'failed',
        contextResetRecommended: true,
      });
      throw error;
    }
  } finally {
    activeAbortController = null;
    activeRun = null;
    activeActionNarration = false;
    activeActionNarrationDefaultActive = false;
    lastAssistantResponseNarrationKey = '';
    postStateSnapshot();
  }
}

(self as any).onmessage = async (ev: MessageEvent) => {
  const data = ev.data || {};
  try {
    if (data.type === 'init') {
      config = data.config as RoverWorkerConfig;
      workerSessionId =
        typeof config.sessionId === 'string' && config.sessionId.trim()
          ? config.sessionId.trim()
          : (workerSessionId || crypto.randomUUID());
      taskBoundaryId =
        typeof config.taskBoundaryId === 'string' && config.taskBoundaryId.trim()
          ? config.taskBoundaryId.trim()
          : taskBoundaryId;
      applyScopedTabConfig(config);
      if ((config as any)?.timing?.actionTimeoutMs) {
        RPC_TIMEOUT_MS = Math.max(5_000, Math.min(780_000, Number((config as any).timing.actionTimeoutMs)));
      }
      if (!tabularStore) {
        tabularStore = new TabularStore(`rover-${taskTrajectoryId}`);
      }
      if (data.port) {
        bridgeRpc = wrapBridgeRpcWithToolLifecycle(createRpcClient(data.port as MessagePort));
        (data.port as MessagePort).start?.();
      }
      // Load client tools from init config
      const tools = config.tools;
      if (Array.isArray(tools)) {
        for (const def of tools) toolRegistry.registerTool(def);
      } else if (tools?.client) {
        for (const def of tools.client) toolRegistry.registerTool(def);
      }

      (self as any).postMessage({ type: 'ready' });
      postStateSnapshot();
      return;
    }

    if (data.type === 'hydrate_state') {
      hydrateState(data.state);
      (self as any).postMessage({ type: 'hydrated' });
      return;
    }

    if (data.type === 'update_config') {
      if (!config) throw new Error('Worker not initialized');
      const partial = (data.config || {}) as Partial<RoverWorkerConfig>;
      config = {
        ...config,
        ...partial,
        ui: mergeWorkerUi(config.ui, partial.ui),
        tools: mergeWorkerTools(config.tools, partial.tools),
      };
      if (typeof partial.sessionId === 'string' && partial.sessionId.trim()) {
        workerSessionId = partial.sessionId.trim();
      }
      if ((partial as any)?.timing?.actionTimeoutMs) {
        RPC_TIMEOUT_MS = Math.max(5_000, Math.min(780_000, Number((partial as any).timing.actionTimeoutMs)));
      }
      if (typeof partial.taskBoundaryId === 'string' && partial.taskBoundaryId.trim()) {
        taskBoundaryId = partial.taskBoundaryId.trim();
      }
      applyScopedTabConfig(partial);
      const tools = partial.tools;
      if (Array.isArray(tools)) {
        for (const def of tools) toolRegistry.registerTool(def);
      } else if (tools?.client) {
        for (const def of tools.client) toolRegistry.registerTool(def);
      }
      (self as any).postMessage({ type: 'updated' });
      postStateSnapshot();
      return;
    }

    if (data.type === 'register_tool') {
      if (data.tool) toolRegistry.registerTool(data.tool as ClientToolDefinition);
      return;
    }

    if (data.type === 'start_new_task') {
      if (!config) throw new Error('Worker not initialized');
      const nextTaskId = typeof data.taskId === 'string' && data.taskId.trim() ? data.taskId.trim() : crypto.randomUUID();
      const nextTaskBoundaryId =
        typeof data.taskBoundaryId === 'string' && data.taskBoundaryId.trim()
          ? data.taskBoundaryId.trim()
          : crypto.randomUUID();
      activeAbortController?.abort();
      clearTaskScopedContextAfterBoundary('new_task');
      terminalRuns.clear();
      cancelledRunIds.clear();
      taskTrajectoryId = nextTaskId;
      taskBoundaryId = nextTaskBoundaryId;
      applyScopedTabConfig(data as Partial<RoverWorkerConfig>);
      tabularStore = new TabularStore(`rover-${taskTrajectoryId}`);
      activeRun = null;
      activeAbortController = null;
      postStateSnapshot();
      return;
    }

    if (data.type === 'cancel_run') {
      if (typeof data.runId === 'string' && data.runId) {
        rememberCancelledRun(data.runId);
        activeAbortController?.abort();
      }
      clearTaskScopedContextAfterBoundary('cancel');
      postStateSnapshot();
      return;
    }

    if (data.type === 'run') {
      applyScopedTabConfig(data as Partial<RoverWorkerConfig>);
      const seedChatLogInput = Array.isArray(data.seedChatLog)
        ? data.seedChatLog
        : (Array.isArray(data.followupChatLog) ? data.followupChatLog : undefined);
      await runUserMessage(String(data.text || ''), {
        runId: data.runId,
        resume: !!data.resume,
        preserveHistory: !!data.preserveHistory,
        seedChatLog: Array.isArray(seedChatLogInput) ? normalizeFollowupChatLog(seedChatLogInput) : undefined,
        files: Array.isArray(data.files) ? sanitizeAttachedFiles(data.files) : undefined,
        routing: data.routing,
        askUserAnswers: data.askUserAnswers,
        narrationEnabledForRun: typeof data.narrationEnabledForRun === 'boolean' ? data.narrationEnabledForRun : undefined,
        narrationPreferenceSource: data.narrationPreferenceSource === 'visitor' ? 'visitor' : 'default',
        narrationDefaultActiveForRun: typeof data.narrationDefaultActiveForRun === 'boolean' ? data.narrationDefaultActiveForRun : undefined,
        narrationRunKind: data.narrationRunKind === 'guide' || data.narrationRunKind === 'task' ? data.narrationRunKind : undefined,
        narrationLanguage: normalizeNarrationLanguage(data.narrationLanguage),
        actionSpotlightEnabledForRun: typeof data.actionSpotlightEnabledForRun === 'boolean' ? data.actionSpotlightEnabledForRun : undefined,
        actionSpotlightRunKind: data.actionSpotlightRunKind === 'guide' || data.actionSpotlightRunKind === 'task' ? data.actionSpotlightRunKind : undefined,
        actionSpotlightDefaultActiveForRun: typeof data.actionSpotlightDefaultActiveForRun === 'boolean' ? data.actionSpotlightDefaultActiveForRun : undefined,
      });
      return;
    }

    if (data.type === 'user') {
      const seedChatLogInput = Array.isArray(data.seedChatLog)
        ? data.seedChatLog
        : (Array.isArray(data.followupChatLog) ? data.followupChatLog : undefined);
      await runUserMessage(String(data.text || ''), {
        runId: data.runId,
        resume: !!data.resume,
        preserveHistory: !!data.preserveHistory,
        seedChatLog: Array.isArray(seedChatLogInput) ? normalizeFollowupChatLog(seedChatLogInput) : undefined,
        files: Array.isArray(data.files) ? sanitizeAttachedFiles(data.files) : undefined,
        askUserAnswers: data.askUserAnswers,
        narrationEnabledForRun: typeof data.narrationEnabledForRun === 'boolean' ? data.narrationEnabledForRun : undefined,
        narrationPreferenceSource: data.narrationPreferenceSource === 'visitor' ? 'visitor' : 'default',
        narrationDefaultActiveForRun: typeof data.narrationDefaultActiveForRun === 'boolean' ? data.narrationDefaultActiveForRun : undefined,
        narrationRunKind: data.narrationRunKind === 'guide' || data.narrationRunKind === 'task' ? data.narrationRunKind : undefined,
        narrationLanguage: normalizeNarrationLanguage(data.narrationLanguage),
        actionSpotlightEnabledForRun: typeof data.actionSpotlightEnabledForRun === 'boolean' ? data.actionSpotlightEnabledForRun : undefined,
        actionSpotlightRunKind: data.actionSpotlightRunKind === 'guide' || data.actionSpotlightRunKind === 'task' ? data.actionSpotlightRunKind : undefined,
        actionSpotlightDefaultActiveForRun: typeof data.actionSpotlightDefaultActiveForRun === 'boolean' ? data.actionSpotlightDefaultActiveForRun : undefined,
      });
      return;
    }
  } catch (err: any) {
    if (isApiKeyRequiredError(err)) {
      postAuthRequired(err);
      return;
    }
    (self as any).postMessage({ type: 'error', message: err?.message || String(err), executionId: activeRun?.runId });
  }
};
