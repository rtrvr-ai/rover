import type {
  ClientToolDefinition,
  ChatMessage,
  FunctionDeclaration,
  ExternalWebConfig,
  RoverRuntimeContext,
  RoverRuntimeContextExternalTab,
  RoverTab,
  PlannerQuestion,
  PreviousSteps,
  StatusStage,
  TaskRoutingConfig,
} from './agent/types.js';
import { ToolRegistry } from './agent/toolRegistry.js';
import { createAgentContext, type RoverAgentConfig } from './agent/context.js';
import { handleSendMessageWithFunctions } from './agent/messageOrchestrator.js';
import { TabularStore } from './tabular-memory/tabular-store.js';
import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';
import { isApiKeyRequiredError, toRoverErrorEnvelope } from './agent/errors.js';
import { resolveRuntimeTabs } from './agent/runtimeTabs.js';

type RpcRequest = { t: 'req'; id: string; method: string; params?: unknown };
type RpcResponse = { t: 'res'; id: string; ok: boolean; result?: unknown; error?: { message: string } };

type RoverWorkerConfig = RoverAgentConfig & {
  siteId: string;
  allowActions?: boolean;
  maxToolSteps?: number;
  tools?: { client?: ClientToolDefinition[]; web?: ExternalWebConfig } | ClientToolDefinition[];
  ui?: {
    agent?: {
      name?: string;
    };
  };
  sessionId?: string;
  taskBoundaryId?: string;
  taskRouting?: TaskRoutingConfig;
};

type PersistedWorkerState = {
  trajectoryId: string;
  taskBoundaryId?: string;
  history: ChatMessage[];
  plannerHistory: unknown[];
  agentPrevSteps: PreviousSteps[];
  lastToolPreviousSteps?: PreviousSteps[];
  pendingAskUser?: PendingAskUserPrompt;
};

type RunOutcome = {
  route?: { mode?: 'act' | 'planner'; score?: number; reason?: string };
  taskComplete: boolean;
  needsUserInput?: boolean;
  questions?: PlannerQuestion[];
};

type AskUserAnswerMeta = {
  answersByKey?: Record<string, string>;
  rawText?: string;
  keys?: string[];
};

type PendingAskUserPrompt = {
  questions: PlannerQuestion[];
  source: 'act' | 'planner';
  askedAt: number;
};

type AssistantMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_output' | 'json'; data: unknown; label?: string; toolName?: string };

type AssistantMessagePayload = {
  text?: string;
  blocks?: AssistantMessageBlock[];
};

type TerminalRunResult =
  | {
      ok: true;
      outcome: RunOutcome;
    }
  | {
      ok: false;
      error: string;
      taskComplete: false;
      needsUserInput: false;
    };

const history: ChatMessage[] = [];
let config: RoverWorkerConfig | null = null;
let bridgeRpc: ((method: string, params?: any) => Promise<any>) | null = null;
let toolRegistry = new ToolRegistry();
let plannerHistory: any[] = [];
let agentPrevSteps: PreviousSteps[] = [];
let pendingAskUser: PendingAskUserPrompt | undefined;
let trajectoryId: string = crypto.randomUUID();
let taskBoundaryId: string = crypto.randomUUID();
let tabularStore: TabularStore | null = null;
const PLANNER_TOOL_NAME_SET = new Set<string>(Object.values(PLANNER_FUNCTION_CALLS));
let activeRun: { runId: string; text: string; startedAt: number; resume: boolean } | null = null;
const cancelledRunIds = new Set<string>();
let activeAbortController: AbortController | null = null;
let lastStatusKey = '';
let seenStatusKeys = new Set<string>();
const terminalRuns = new Map<string, TerminalRunResult>();

const RPC_TIMEOUT_MS = 30_000;
const DETACHED_EXTERNAL_TAB_MAX_AGE_MS = 90_000;
const PENDING_ATTACH_TAB_MAX_AGE_MS = 20_000;
const MAX_CHATLOG_ENTRIES = 12;

function resolveAgentName(config: RoverWorkerConfig | null): string {
  const raw = String(config?.ui?.agent?.name || '').trim();
  if (!raw) return 'Rover';
  return raw.slice(0, 64);
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

function resolveRuntimeExternalNavigationPolicy(
  config: RoverWorkerConfig | null,
): 'open_new_tab_notice' | 'block' | 'allow' | undefined {
  if (!config) return undefined;
  if (config.externalNavigationPolicy === 'open_new_tab_notice' || config.externalNavigationPolicy === 'block' || config.externalNavigationPolicy === 'allow') {
    return config.externalNavigationPolicy;
  }
  return undefined;
}

function buildRoverRuntimeContext(params: {
  tabs: RoverTab[];
  agentName: string;
  externalNavigationPolicy?: 'open_new_tab_notice' | 'block' | 'allow';
  taskBoundaryId?: string;
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

  return {
    mode: 'rover_embed',
    agentName: params.agentName,
    externalNavigationPolicy: params.externalNavigationPolicy,
    tabIdContract: 'tree_index_mapped_by_tab_order',
    taskBoundaryId: params.taskBoundaryId,
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
    // ignore and fall back
  }

  try {
    const pageData = await bridgeRpc('getPageData');
    return { id: 1, url: pageData?.url, title: pageData?.title, external: false, accessMode: 'live_dom' };
  } catch {
    return { id: 1, external: false, accessMode: 'live_dom' };
  }
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

function postStatus(message: string, thought?: string, stage?: StatusStage) {
  const resolvedStage = inferStatusStage(message, thought, stage);
  const compact = compactThought(message, thought);
  const runId = activeRun?.runId || 'no-run';
  const key = `${runId}|${resolvedStage}|${String(message || '').trim().toLowerCase()}|${compact.toLowerCase()}`;
  if (key === lastStatusKey || seenStatusKeys.has(key)) return;
  lastStatusKey = key;
  seenStatusKeys.add(key);
  if (seenStatusKeys.size > 120) {
    const recent = Array.from(seenStatusKeys).slice(-60);
    seenStatusKeys = new Set(recent);
  }
  (self as any).postMessage({ type: 'status', message, thought, stage: resolvedStage, compactThought: compact, runId: activeRun?.runId });
  postStateSnapshot();
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
  return input.slice(-80).map(message => ({
    ...message,
    content: String(message?.content ?? ''),
  }));
}

function sanitizePlannerHistoryForPersist(input: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const step of input.slice(-40)) {
    const cloned = cloneUnknown(step);
    if (cloned !== undefined) out.push(cloned);
  }
  return out;
}

function sanitizeAgentPrevStepsForPersist(input: PreviousSteps[]): PreviousSteps[] {
  if (!Array.isArray(input)) return [];
  const out: PreviousSteps[] = [];
  for (const step of input.slice(-60)) {
    const cloned = cloneUnknown(step);
    if (cloned && typeof cloned === 'object') {
      out.push(cloned as PreviousSteps);
    }
  }
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

function normalizeAskUserAnswerMeta(
  raw: AskUserAnswerMeta | undefined,
  questions: PlannerQuestion[],
  fallbackText: string,
): { answersByKey: Record<string, string>; rawText: string } | undefined {
  const validKeys = new Set(questions.map(question => question.key));
  const answersByKey: Record<string, string> = {};

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
  if (!rawText && Object.keys(answersByKey).length === 0) return undefined;
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

function buildPersistedState(): PersistedWorkerState {
  const safePrevSteps = sanitizeAgentPrevStepsForPersist(Array.isArray(agentPrevSteps) ? agentPrevSteps : []);
  return {
    trajectoryId,
    taskBoundaryId,
    history: sanitizeHistoryForPersist(history),
    plannerHistory: sanitizePlannerHistoryForPersist(Array.isArray(plannerHistory) ? plannerHistory : []),
    agentPrevSteps: safePrevSteps,
    lastToolPreviousSteps: safePrevSteps,
    pendingAskUser: pendingAskUser
      ? {
          questions: normalizePlannerQuestions(pendingAskUser.questions),
          source: pendingAskUser.source,
          askedAt: Number(pendingAskUser.askedAt) || Date.now(),
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
  if (hydratedQuestions.length > 0) {
    pendingAskUser = {
      questions: hydratedQuestions,
      source: (snapshot as any).pendingAskUser?.source === 'planner' ? 'planner' : 'act',
      askedAt: Number((snapshot as any).pendingAskUser?.askedAt) || Date.now(),
    };
  } else {
    pendingAskUser = undefined;
  }

  if (typeof snapshot.trajectoryId === 'string' && snapshot.trajectoryId.trim()) {
    trajectoryId = snapshot.trajectoryId.trim();
  }

  if (typeof (snapshot as any).taskBoundaryId === 'string' && String((snapshot as any).taskBoundaryId).trim()) {
    taskBoundaryId = String((snapshot as any).taskBoundaryId).trim();
  }

  if (!tabularStore) {
    tabularStore = new TabularStore(`rover-${trajectoryId}`);
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
        data: cloneUnknown((raw as any).data),
        label: typeof (raw as any).label === 'string' ? (raw as any).label : undefined,
        toolName: typeof (raw as any).toolName === 'string' ? (raw as any).toolName : undefined,
      });
    }
  }

  return out.length ? out : undefined;
}

function summarizeOutputText(output: any): string | undefined {
  if (output == null) return undefined;
  if (typeof output === 'string') {
    const clean = output.trim();
    return clean || undefined;
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return String(output);
  }
  if (Array.isArray(output)) {
    const lines: string[] = [];
    for (const item of output.slice(0, 4)) {
      const candidate = summarizeOutputText(item);
      if (candidate) lines.push(candidate);
      if (lines.length >= 3) break;
    }
    if (lines.length) return lines.join('\n');
    return `Received ${output.length} item(s).`;
  }
  if (typeof output === 'object') {
    const preferredKeys = ['response', 'message', 'summary', 'text', 'content', 'result', 'description'];
    for (const key of preferredKeys) {
      const value = (output as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    const keys = Object.keys(output);
    if (!keys.length) return undefined;
    return `Received ${keys.length} field(s).`;
  }
  return undefined;
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

function shouldAttachStructuredBlock(output: any, summaryText?: string): boolean {
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
  output: any,
  options?: { label?: string; toolName?: string; fallbackText?: string },
): AssistantMessagePayload {
  const summaryText = summarizeOutputText(output);
  const text = summaryText || options?.fallbackText || 'Done.';
  const blocks: AssistantMessageBlock[] = [];
  if (shouldAttachStructuredBlock(output, summaryText)) {
    blocks.push({
      type: 'tool_output',
      label: options?.label,
      toolName: options?.toolName,
      data: cloneUnknown(output),
    });
  }
  return { text, blocks: blocks.length ? blocks : undefined };
}

function postAssistantMessage(payload: string | AssistantMessagePayload): string {
  const text = typeof payload === 'string'
    ? String(payload || '').trim()
    : String(payload?.text || '').trim();
  const blocks = typeof payload === 'string' ? undefined : sanitizeAssistantBlocks(payload.blocks);
  const firstTextBlock = blocks?.find((block): block is Extract<AssistantMessageBlock, { type: 'text' }> => block.type === 'text');
  const firstStructuredBlock = blocks?.find((block): block is Extract<AssistantMessageBlock, { type: 'tool_output' | 'json' }> =>
    block.type === 'tool_output' || block.type === 'json');
  const resolvedText =
    text
    || firstTextBlock?.text
    || summarizeOutputText(firstStructuredBlock?.data)
    || 'Done.';
  (self as any).postMessage({ type: 'assistant', text: resolvedText, blocks, runId: activeRun?.runId });
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
  const envelope =
    err && typeof err === 'object' && err.code && err.message
      ? toRoverErrorEnvelope({ errorDetails: err }, 'Rover API key is required.')
      : toRoverErrorEnvelope(err, 'Rover API key is required.');
  (self as any).postMessage({ type: 'auth_required', error: envelope, runId: activeRun?.runId });
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
    runId: activeRun?.runId,
    blockedUrl: output?.blocked_url || output?.url || details?.details?.blockedUrl,
    currentUrl: output?.current_url || details?.details?.currentUrl,
    reason: output?.error?.message || details?.message || output?.message,
    policyAction,
    openedInNewTab: !!output?.openedInNewTab,
    allowedDomains: output?.allowed_domains || details?.details?.allowedDomains,
  });
}

function buildChatLogFromHistory(input: ChatMessage[], currentUserInput?: string): Array<{ role: 'user' | 'model'; message: string }> {
  const sanitizeChatText = (raw: string): string => {
    return String(raw || '').replace(/\s+/g, ' ').trim();
  };
  const ASK_USER_PROMPT_PREFIX = 'i need a bit more info before continuing:';

  const normalizedCurrentUserInput = currentUserInput
    ? sanitizeChatText(currentUserInput)
    : '';

  const entries = input
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: sanitizeChatText(String(message.content || '')),
    }))
    .filter(message => !!message.content)
    .filter(message => !(message.role === 'assistant' && message.content.toLowerCase().startsWith(ASK_USER_PROMPT_PREFIX)));

  if (normalizedCurrentUserInput) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].role === 'user' && entries[i].content === normalizedCurrentUserInput) {
        entries.splice(i, 1);
        break;
      }
    }
  }

  const deduped: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const entry of entries) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === entry.role && previous.content === entry.content) continue;
    deduped.push(entry);
  }

  let selected = deduped.slice(-MAX_CHATLOG_ENTRIES);
  const seen = new Set<string>();
  const compactedReverse: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const entry = selected[i];
    const key = `${entry.role}::${entry.content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    compactedReverse.push(entry);
  }
  selected = compactedReverse.reverse();

  return selected.map(message => ({
    role: message.role === 'user' ? 'user' : 'model',
    message: message.content,
  }));
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

function buildPlannerToolResultBlocks(toolResults: any[] | undefined): AssistantMessageBlock[] | undefined {
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
        data: cloneUnknown(output),
      });
    }

    if (result.error || result.errorDetails) {
      blocks.push({
        type: 'json',
        label: `${stepLabel} error`,
        data: cloneUnknown({
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

function summarizePlannerToolResults(toolResults: any[] | undefined): string | undefined {
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

function extractLatestPrevStepsFromPlanner(toolResults: any[] | undefined): PreviousSteps[] | undefined {
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

function extractQuestionsFromResult(result: any): PlannerQuestion[] | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const topLevel = normalizePlannerQuestions((result as any).questions);
  if (topLevel.length) return topLevel;
  const output = (result as any).output;
  const outputQuestions = normalizePlannerQuestions(output?.questions);
  if (outputQuestions.length) return outputQuestions;
  return undefined;
}

function extractPlannerQuestionsFromToolResults(toolResults: any[] | undefined): PlannerQuestion[] {
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

function deriveDirectToolRunOutcome(result: any): RunOutcome {
  if (!result || typeof result !== 'object') {
    return { taskComplete: false };
  }

  const questions = extractQuestionsFromResult(result);

  const topLevelStatus = String(result.status || '').trim().toLowerCase();
  if (topLevelStatus === 'failure' || topLevelStatus === 'failed' || topLevelStatus === 'error') {
    return { taskComplete: false };
  }
  if (topLevelStatus === 'waiting_input' || topLevelStatus === 'needs_input' || topLevelStatus === 'pending_user_input') {
    return { taskComplete: false, needsUserInput: true, questions };
  }
  if (result.error) {
    return { taskComplete: false };
  }

  const output = result.output;
  if (output && typeof output === 'object') {
    if (Array.isArray(output)) {
      return { taskComplete: true };
    }

    if ((output as any).needsUserInput === true || (output as any).waitingForUserInput === true) {
      return { taskComplete: false, needsUserInput: true, questions };
    }

    if (Array.isArray((output as any).questions) && (output as any).questions.length > 0) {
      return { taskComplete: false, needsUserInput: true, questions };
    }

    if ((output as any).error) {
      return { taskComplete: false };
    }

    if (typeof (output as any).taskComplete === 'boolean') {
      return { taskComplete: !!(output as any).taskComplete };
    }

    const taskStatus = String((output as any).taskStatus || (output as any).status || '').toLowerCase();
    if (taskStatus) {
      if (taskStatus === 'waiting_input' || taskStatus === 'needs_input' || taskStatus === 'pending_user_input') {
        return { taskComplete: false, needsUserInput: true };
      }
      if (taskStatus === 'running' || taskStatus === 'in_progress' || taskStatus === 'pending') {
        return { taskComplete: false };
      }
      if (taskStatus === 'completed' || taskStatus === 'complete' || taskStatus === 'done' || taskStatus === 'success') {
        return { taskComplete: true };
      }
      if (taskStatus === 'failure' || taskStatus === 'failed' || taskStatus === 'error') {
        return { taskComplete: false };
      }
    }

    if ((output as any).success === false) {
      return { taskComplete: false };
    }

    if (String((output as any).status || '').trim().toLowerCase() === 'failure') {
      return { taskComplete: false };
    }
  }

  if (output != null) {
    return { taskComplete: true };
  }

  // Direct tool invocation without explicit continuation signals is treated as complete.
  return { taskComplete: true };
}

function normalizeRunOutcome(outcome?: Partial<RunOutcome> | null): RunOutcome {
  if (!outcome || typeof outcome !== 'object') {
    return { taskComplete: false, needsUserInput: false };
  }
  const needsUserInput = outcome.needsUserInput === true;
  const taskComplete = outcome.taskComplete === true && !needsUserInput;
  const questions = normalizePlannerQuestions((outcome as any).questions);
  return {
    route: outcome.route,
    taskComplete,
    needsUserInput,
    questions: questions.length ? questions : undefined,
  };
}

function rememberTerminalRun(runId: string, result: TerminalRunResult): void {
  terminalRuns.set(runId, result);
  while (terminalRuns.size > 80) {
    const oldest = terminalRuns.keys().next().value;
    if (!oldest) break;
    terminalRuns.delete(oldest);
  }
}

function rememberCancelledRun(runId: string): void {
  cancelledRunIds.add(runId);
  while (cancelledRunIds.size > 80) {
    const oldest = cancelledRunIds.values().next().value;
    if (!oldest) break;
    cancelledRunIds.delete(oldest);
  }
}

function clearTaskScopedContextAfterBoundary(_reason: 'cancel' | 'end' | 'new_task' | 'complete'): void {
  history.length = 0;
  plannerHistory = [];
  agentPrevSteps = [];
  pendingAskUser = undefined;
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
  options?: { resume?: boolean; routing?: 'auto' | 'act' | 'planner'; askUserAnswers?: AskUserAnswerMeta },
): Promise<RunOutcome> {
  if (!config) throw new Error('Worker not initialized');
  if (!bridgeRpc) throw new Error('Bridge RPC not initialized');
  postStatus('Analyzing request', text, 'analyze');

  const shouldSkipUserPush =
    options?.resume &&
    history.length > 0 &&
    history[history.length - 1]?.role === 'user' &&
    history[history.length - 1]?.content === text;

  let effectiveUserInput = text;
  let consumedAsAskUserAnswer = false;
  if (pendingAskUser?.questions?.length) {
    const normalizedAnswers = normalizeAskUserAnswerMeta(options?.askUserAnswers, pendingAskUser.questions, text);
    if (normalizedAnswers) {
      consumedAsAskUserAnswer = true;
      const answerContext = buildAskUserAnswerContext(pendingAskUser.questions, normalizedAnswers);
      effectiveUserInput = answerContext;

      plannerHistory = sanitizePlannerHistoryForPersist([
        ...plannerHistory,
        {
          thought: 'User provided clarification answers.',
          questionsAsked: pendingAskUser.questions,
          userAnswers: normalizedAnswers.answersByKey,
        },
      ]);

      applyAgentPrevSteps([
        ...agentPrevSteps,
        {
          functions: [{
            name: 'ask_user',
            args: {
              questions_to_ask: pendingAskUser.questions.map(q => ({
                key: q.key,
                query: q.query,
              })),
            },
            response: {
              status: 'Success',
              output: {
                ask_user_answers: normalizedAnswers.answersByKey,
                raw_user_reply: normalizedAnswers.rawText,
              },
            },
          }],
        },
      ], { snapshot: false });

      pendingAskUser = undefined;
      postStateSnapshot();
    }
  }

  if (!shouldSkipUserPush && !consumedAsAskUserAnswer) {
    history.push({ role: 'user', content: text });
    postStateSnapshot();
  }

  const tabs = await getKnownTabs();
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
  const resolvedTabs = await resolveRuntimeTabs(bridgeRpc, fallbackTabs);
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
    tabularStore = new TabularStore(`rover-${trajectoryId}`);
  }
  const agentName = resolveAgentName(config);
  const runtimeContext = buildRoverRuntimeContext({
    tabs: tabsForRun,
    agentName,
    externalNavigationPolicy: resolveRuntimeExternalNavigationPolicy(config),
    taskBoundaryId,
  });
  const ctx = createAgentContext(
    {
      ...config,
      signal: activeAbortController?.signal,
      runtimeContext,
      tools: {
        web: extractWebToolsConfig(config),
      },
    },
    bridgeRpc,
    tabularStore,
  );
  const currentRunId = activeRun?.runId;
  ctx.isCancelled = () => !!(currentRunId && cancelledRunIds.has(currentRunId));
  // Only pass user/client-declared tools. Planner built-ins come from backend.
  const functionDeclarations = dedupeFunctionDeclarations(
    removePlannerNameCollisions(toolRegistry.getFunctionDeclarations()),
  );
  const toolFunctions = toolRegistry.getToolFunctions();
  const chatLog = buildChatLogFromHistory(history, text);
  const onPrevStepsUpdate = (steps: PreviousSteps[]) => {
    applyAgentPrevSteps(steps, { snapshot: true });
  };
  const onPlannerHistoryUpdate = (steps: any[]) => {
    plannerHistory = sanitizePlannerHistoryForPersist(Array.isArray(steps) ? steps : []);
    postStateSnapshot();
  };

  const result = await handleSendMessageWithFunctions(effectiveUserInput, {
    tabs: tabsForRun,
    previousMessages: history,
    trajectoryId,
    files: [],
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
  });

  if (!result.success) {
    const errorPayload = toStructuredErrorPayload(result.error, 'Something went wrong.');
    if (errorPayload.error.requires_api_key) {
      postAuthRequired(errorPayload.error);
    }
    const errorMsg = postAssistantMessage({
      text: `${errorPayload.error.code}: ${errorPayload.error.message}`,
      blocks: [
        {
          type: 'json',
          label: 'Error details',
          data: cloneUnknown(errorPayload),
        },
      ],
    });
    history.push({ role: 'assistant', content: errorMsg });
    postStatus('Execution failed', errorPayload.error.message, 'complete');
    postStateSnapshot();
    return { route: result.route, taskComplete: false };
  }

  if (result.executedFunctions?.length) {
    for (const fn of result.executedFunctions) {
      applyAgentPrevSteps(fn.prevSteps, { snapshot: false });
    }
    const blocks: AssistantMessageBlock[] = [];
    const lines: string[] = [];
    for (const fn of result.executedFunctions) {
      const summary = summarizeOutputText(fn.result);
      if (fn.result !== undefined && shouldAttachStructuredBlock(fn.result, summary)) {
        blocks.push({
          type: 'tool_output',
          toolName: fn.name,
          label: `${fn.name} output`,
          data: cloneUnknown(fn.result),
        });
      }
      if (fn.error) {
        blocks.push({
          type: 'json',
          label: `${fn.name} error`,
          data: cloneUnknown({ error: fn.error }),
        });
      }
      lines.push(summary ? `@${fn.name}: ${summary}` : `@${fn.name}: ${fn.error || 'ok'}`);
    }
    const msg = postAssistantMessage({
      text: lines.join('\n') || 'Done.',
      blocks,
    });
    history.push({ role: 'assistant', content: msg });
    postStatus('Execution completed', 'Function calls finished', 'complete');
    postStateSnapshot();
    return { route: result.route, taskComplete: true };
  }

  if (result.directToolResult) {
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
        questions,
        source: 'act',
        askedAt: Date.now(),
      };
      plannerHistory = sanitizePlannerHistoryForPersist([
        ...plannerHistory,
        {
          thought: 'Need user clarification before continuing act workflow.',
          questionsAsked: questions,
        },
      ]);
      const qText = questions.map(question => `- ${question.key}: ${questionToDisplayText(question)}`).join('\n');
      const msg = postAssistantMessage(`I need a bit more info before continuing:\n${qText}`);
      history.push({ role: 'assistant', content: msg });
      postStatus('Need more input to continue', undefined, 'verify');
      postStateSnapshot();
      return {
        route: result.route,
        taskComplete: false,
        needsUserInput: true,
        questions,
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
    const msg = structuredError
      ? postAssistantMessage({
          text: `${structuredError.error.code}: ${structuredError.error.message}`,
          blocks: [
            {
              type: 'json',
              label: 'Error details',
              data: cloneUnknown(structuredError),
            },
          ],
        })
      : postAssistantMessage(buildAssistantPayloadFromToolOutput(output, {
          label: 'Tool output',
          fallbackText: 'Done.',
        }));
    history.push({ role: 'assistant', content: msg });
    postStatus('Execution completed', structuredError?.error.message, 'complete');
    postStateSnapshot();
    return {
      route: result.route,
      taskComplete: outcome.taskComplete,
      needsUserInput: outcome.needsUserInput,
      questions: normalizePlannerQuestions(outcome.questions),
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
        ? {
            questions,
            source: 'planner',
            askedAt: Date.now(),
          }
        : undefined;
      const qText = questions.map(question => `- ${question.key}: ${questionToDisplayText(question)}`).join('\n');
      const msg = `I need a bit more info:\n${qText}`;
      postAssistantMessage(msg);
      history.push({ role: 'assistant', content: msg });
      postStatus('Planner needs user input', undefined, 'verify');
      postStateSnapshot();
      return {
        route: result.route,
        taskComplete: false,
        needsUserInput: true,
        questions,
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
    if (responseError?.error.requires_api_key) {
      postAuthRequired(responseError.error);
    }
    const msg = responseError
      ? postAssistantMessage({
          text: `${responseError.error.code}: ${responseError.error.message}`,
          blocks: [
            {
              type: 'json',
              label: 'Planner error',
              data: cloneUnknown(responseError),
            },
            ...(toolBlocks || []),
          ],
        })
      : postAssistantMessage({
          text: String(response.overallThought || summarizePlannerToolResults(toolResults) || 'Done.'),
          blocks: toolBlocks,
        });
    history.push({ role: 'assistant', content: msg });
    postStatus('Planner execution completed', response.overallThought, 'complete');
    postStateSnapshot();
    return {
      route: result.route,
      taskComplete: !!response.taskComplete && !responseError,
      needsUserInput: false,
    };
  }

  const doneMsg = postAssistantMessage('Done.');
  history.push({ role: 'assistant', content: doneMsg });
  postStatus('Completed', undefined, 'complete');
  postStateSnapshot();
  return { route: result.route, taskComplete: true };
}

async function runUserMessage(
  text: string,
  meta?: { runId?: string; resume?: boolean; routing?: 'auto' | 'act' | 'planner'; askUserAnswers?: AskUserAnswerMeta },
): Promise<void> {
  const runId = meta?.runId || crypto.randomUUID();
  const terminal = terminalRuns.get(runId);
  if (terminal) {
    if (terminal.ok) {
      const cachedOutcome = normalizeRunOutcome(terminal.outcome);
      (self as any).postMessage({
        type: 'run_completed',
        runId,
        ok: true,
        route: cachedOutcome.route,
        taskComplete: cachedOutcome.taskComplete,
        needsUserInput: cachedOutcome.needsUserInput,
        questions: cachedOutcome.questions,
      });
    } else {
      (self as any).postMessage({
        type: 'run_completed',
        runId,
        ok: false,
        error: terminal.error,
        taskComplete: false,
        needsUserInput: false,
      });
    }
    return;
  }
  if (activeRun && activeRun.runId === runId) {
    return;
  }
  const resume = !!meta?.resume;
  lastStatusKey = '';
  seenStatusKeys = new Set<string>();
  cancelledRunIds.delete(runId);
  activeAbortController = new AbortController();
  activeRun = { runId, text, startedAt: Date.now(), resume };
  (self as any).postMessage({ type: 'run_started', runId, text, resume });
  postStateSnapshot();

  try {
    const outcome = normalizeRunOutcome(await handleUserMessage(text, {
      resume,
      routing: meta?.routing,
      askUserAnswers: meta?.askUserAnswers,
    }));
    rememberTerminalRun(runId, { ok: true, outcome });
    (self as any).postMessage({
      type: 'run_completed',
      runId,
      ok: true,
      route: outcome.route,
      taskComplete: outcome.taskComplete,
      needsUserInput: outcome.needsUserInput,
      questions: outcome.questions,
    });
    if (outcome.taskComplete && !outcome.needsUserInput) {
      clearTaskScopedContextAfterBoundary('complete');
      postStateSnapshot();
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      rememberTerminalRun(runId, {
        ok: false,
        error: 'Run cancelled',
        taskComplete: false,
        needsUserInput: false,
      });
      (self as any).postMessage({
        type: 'run_completed',
        runId,
        ok: false,
        error: 'Run cancelled',
        taskComplete: false,
        needsUserInput: false,
      });
    } else {
      rememberTerminalRun(runId, {
        ok: false,
        error: error?.message || String(error),
        taskComplete: false,
        needsUserInput: false,
      });
      (self as any).postMessage({
        type: 'run_completed',
        runId,
        ok: false,
        error: error?.message || String(error),
        taskComplete: false,
        needsUserInput: false,
      });
      throw error;
    }
  } finally {
    activeAbortController = null;
    activeRun = null;
    postStateSnapshot();
  }
}

(self as any).onmessage = async (ev: MessageEvent) => {
  const data = ev.data || {};
  try {
    if (data.type === 'init') {
      config = data.config as RoverWorkerConfig;
      trajectoryId = config.sessionId || crypto.randomUUID();
      taskBoundaryId =
        typeof config.taskBoundaryId === 'string' && config.taskBoundaryId.trim()
          ? config.taskBoundaryId.trim()
          : taskBoundaryId;
      if (!tabularStore) {
        tabularStore = new TabularStore(`rover-${trajectoryId}`);
      }
      if (data.port) {
        bridgeRpc = createRpcClient(data.port as MessagePort);
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
      if (typeof partial.sessionId === 'string' && partial.sessionId.trim() && partial.sessionId.trim() !== trajectoryId) {
        trajectoryId = partial.sessionId.trim();
        clearTaskScopedContextAfterBoundary('new_task');
        terminalRuns.clear();
        cancelledRunIds.clear();
        tabularStore = new TabularStore(`rover-${trajectoryId}`);
        taskBoundaryId = crypto.randomUUID();
      }
      if (typeof partial.taskBoundaryId === 'string' && partial.taskBoundaryId.trim()) {
        taskBoundaryId = partial.taskBoundaryId.trim();
      }
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
      trajectoryId = nextTaskId;
      taskBoundaryId = nextTaskBoundaryId;
      tabularStore = new TabularStore(`rover-${trajectoryId}`);
      activeRun = null;
      activeAbortController = null;
      postStateSnapshot();
      (self as any).postMessage({ type: 'task_started', taskId: nextTaskId });
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
      await runUserMessage(String(data.text || ''), {
        runId: data.runId,
        resume: !!data.resume,
        routing: data.routing,
        askUserAnswers: data.askUserAnswers,
      });
      return;
    }

    if (data.type === 'user') {
      await runUserMessage(String(data.text || ''), {
        runId: data.runId,
        resume: !!data.resume,
        askUserAnswers: data.askUserAnswers,
      });
      return;
    }
  } catch (err: any) {
    if (isApiKeyRequiredError(err)) {
      postAuthRequired(err);
      return;
    }
    (self as any).postMessage({ type: 'error', message: err?.message || String(err), runId: activeRun?.runId });
  }
};
