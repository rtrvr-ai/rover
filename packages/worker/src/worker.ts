import type {
  ClientToolDefinition,
  ChatMessage,
  FunctionDeclaration,
  ExternalWebConfig,
  RoverRuntimeContext,
  RoverRuntimeContextExternalTab,
  RoverTab,
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
  taskRouting?: TaskRoutingConfig;
};

type PersistedWorkerState = {
  trajectoryId: string;
  history: ChatMessage[];
  plannerHistory: unknown[];
  agentPrevSteps: PreviousSteps[];
  lastToolPreviousSteps?: PreviousSteps[];
};

type RunOutcome = {
  route?: { mode?: 'act' | 'planner'; score?: number; reason?: string };
  taskComplete: boolean;
  needsUserInput?: boolean;
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
let trajectoryId: string = crypto.randomUUID();
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
const MAX_CHATLOG_ENTRIES = 24;
const MAX_CHATLOG_MESSAGE_CHARS = 1000;

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
          if (!tab.external || tab.runtimeId) return true;
          return nowMs - (tab.updatedAt || 0) <= DETACHED_EXTERNAL_TAB_MAX_AGE_MS;
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

function truncateText(value: string, max = 8_000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
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

function buildPersistedState(): PersistedWorkerState {
  const safePrevSteps = sanitizeAgentPrevStepsForPersist(Array.isArray(agentPrevSteps) ? agentPrevSteps : []);
  return {
    trajectoryId,
    history: sanitizeHistoryForPersist(history),
    plannerHistory: sanitizePlannerHistoryForPersist(Array.isArray(plannerHistory) ? plannerHistory : []),
    agentPrevSteps: safePrevSteps,
    lastToolPreviousSteps: safePrevSteps,
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

  if (typeof snapshot.trajectoryId === 'string' && snapshot.trajectoryId.trim()) {
    trajectoryId = snapshot.trajectoryId.trim();
  }

  if (!tabularStore) {
    tabularStore = new TabularStore(`rover-${trajectoryId}`);
  }

  postStateSnapshot();
}

function shortText(value: any, max = 240): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  const clean = text.trim();
  if (!clean) return '';
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function formatInlineValue(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return shortText(value, 200);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return shortText(value.message, 200);
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`;
  }
  return shortText(value, 200);
}

function formatObjectBlock(value: Record<string, any>): string {
  const preferredKeys = [
    'message',
    'summary',
    'status',
    'result',
    'url',
    'title',
    'name',
    'count',
    'total',
    'next_action',
  ];
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()));
  if (!entries.length) return '';

  const sorted = entries.sort((a, b) => {
    const ai = preferredKeys.indexOf(a[0]);
    const bi = preferredKeys.indexOf(b[0]);
    const ar = ai === -1 ? preferredKeys.length : ai;
    const br = bi === -1 ? preferredKeys.length : bi;
    return ar - br;
  });

  const lines: string[] = [];
  const limit = 7;
  const CONTENT_KEYS = new Set(['response', 'message', 'summary', 'result', 'output', 'text', 'content', 'description']);
  const URL_KEYS = new Set(['url', 'href', 'link', 'sheetUrl', 'downloadUrl', 'storageUrl']);
  for (const [key, raw] of sorted.slice(0, limit)) {
    const isContent = CONTENT_KEYS.has(key);
    const isUrl = URL_KEYS.has(key) || (typeof raw === 'string' && /^https?:\/\/.+/.test(raw.trim()));
    let rendered: string;
    if (typeof raw === 'string' && isUrl) {
      const url = raw.trim();
      rendered = `[${url}](${url})`;
    } else if (typeof raw === 'string' && isContent) {
      rendered = shortText(raw, 2000);
    } else {
      rendered = formatInlineValue(raw);
    }
    if (!rendered) continue;
    lines.push(`**${key}:** ${rendered}`);
  }
  if (sorted.length > limit) {
    lines.push(`… ${sorted.length - limit} more field(s)`);
  }
  return lines.join('\n');
}

function formatArrayBlock(value: any[]): string {
  if (!value.length) return '';
  const lines: string[] = [];
  const limit = 6;
  for (const item of value.slice(0, limit)) {
    if (typeof item === 'string') {
      const text = shortText(item, 260);
      if (text) lines.push(`- ${text}`);
      continue;
    }
    if (item && typeof item === 'object') {
      const block = formatObjectBlock(item);
      if (block) {
        if (lines.length > 0) lines.push('---');
        lines.push(block);
      }
      continue;
    }
    if (item != null) {
      lines.push(`- ${shortText(item, 260)}`);
    }
  }
  if (value.length > limit) {
    lines.push(`- … ${value.length - limit} more item(s)`);
  }
  return lines.join('\n');
}

function formatToolOutput(output: any): string | null {
  if (output == null) return null;
  if (typeof output === 'string') {
    const clean = output.trim();
    return clean ? truncateText(clean, 12_000) : null;
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return String(output);
  }
  if (Array.isArray(output)) {
    const block = formatArrayBlock(output);
    if (block) return truncateText(block, 12_000);
  } else if (typeof output === 'object') {
    if (output.success === false && output.error) {
      const message = shortText(output.error?.message || output.error, 300) || 'Operation failed';
      const nextAction = shortText(output.next_action || output.error?.next_action, 220);
      const base = `[error] ${message}`;
      return nextAction ? `${base}\n[next] ${nextAction}` : base;
    }
    const block = formatObjectBlock(output);
    if (block) return truncateText(block, 12_000);
  }
  try {
    return truncateText(JSON.stringify(output, null, 2), 12_000);
  } catch {
    return truncateText(String(output), 12_000);
  }
}

function postAssistantMessage(text: string): void {
  (self as any).postMessage({ type: 'assistant', text, runId: activeRun?.runId });
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

function formatStructuredErrorForAssistant(payload: StructuredErrorPayload): string {
  const summary = `${payload.error.code}: ${payload.error.message}`;
  return `${summary}\n${JSON.stringify(payload, null, 2)}`;
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
  const sanitizeChatText = (raw: string, role: 'user' | 'assistant'): string => {
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    // Prevent large structured payloads from dominating context while keeping the key signal.
    if (role === 'assistant') {
      if (/^\w[\w_]*:\s*\{/.test(text) || /^\[error\]/i.test(text) || /"success":\s*false/.test(text)) {
        const firstSentence = text.split(/(?<=\.)\s+/)[0] || text;
        text = firstSentence.trim();
      }
    }

    if (text.length > MAX_CHATLOG_MESSAGE_CHARS) {
      text = `${text.slice(0, MAX_CHATLOG_MESSAGE_CHARS - 1)}…`;
    }
    return text;
  };

  const normalizedCurrentUserInput = currentUserInput
    ? sanitizeChatText(currentUserInput, 'user')
    : '';

  const entries = input
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: sanitizeChatText(String(message.content || ''), message.role as 'user' | 'assistant'),
    }))
    .filter(message => !!message.content);

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

  // Keep latest turns and ensure chat log starts with a user turn when possible.
  const tail = deduped.slice(-MAX_CHATLOG_ENTRIES);
  while (tail.length > 1 && tail[0]?.role !== 'user') {
    tail.shift();
  }

  return tail.map(message => ({
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

function formatPlannerToolResults(toolResults: any[] | undefined): string | null {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return null;
  const sections: string[] = [];

  for (let i = 0; i < toolResults.length; i += 1) {
    const result = toolResults[i];
    if (!result) continue;
    const output = result.output ?? result.generatedContentRef ?? result.schemaHeaderSheetInfo;
    const outputText = formatToolOutput(output);
    const links = extractArtifactLinks(result);
    const lines: string[] = [];

    if (outputText) lines.push(outputText);
    if (result.error) lines.push(`Error: ${String(result.error)}`);
    if (links.length) lines.push(`Artifacts:\n${links.map(link => `- ${link}`).join('\n')}`);
    if (!lines.length) continue;

    sections.push(`Step ${i + 1}\n${lines.join('\n')}`);
  }

  if (!sections.length) return null;
  return truncateText(sections.join('\n\n'), 12_000);
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

async function waitForNewTabReady(logicalTabId: number, timeoutMs = 10000): Promise<boolean> {
  if (!bridgeRpc) return false;
  const pollInterval = 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const tabs = await bridgeRpc('listSessionTabs');
      if (Array.isArray(tabs)) {
        const target = tabs.find((t: any) => Number(t?.logicalTabId) === logicalTabId);
        if (target?.external) {
          return true;
        }
        if (target?.runtimeId) {
          // Tab has registered - wait an additional 1s for DOM to settle
          await new Promise(resolve => setTimeout(resolve, 1000));
          return true;
        }
      }
    } catch {
      // ignore polling errors
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return false;
}

function detectOpenedTabFromToolResult(result: any): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const output = result.output ?? result;
  if (output?.openedInNewTab && typeof output?.logicalTabId === 'number') {
    return output.logicalTabId;
  }
  return undefined;
}

function deriveDirectToolRunOutcome(result: any): RunOutcome {
  if (!result || typeof result !== 'object') {
    return { taskComplete: false };
  }

  const topLevelStatus = String(result.status || '').trim().toLowerCase();
  if (topLevelStatus === 'failure' || topLevelStatus === 'failed' || topLevelStatus === 'error') {
    return { taskComplete: false };
  }
  if (topLevelStatus === 'waiting_input' || topLevelStatus === 'needs_input' || topLevelStatus === 'pending_user_input') {
    return { taskComplete: false, needsUserInput: true };
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
      return { taskComplete: false, needsUserInput: true };
    }

    if (Array.isArray((output as any).questions) && (output as any).questions.length > 0) {
      return { taskComplete: false, needsUserInput: true };
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
  return {
    route: outcome.route,
    taskComplete,
    needsUserInput,
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

function clearTaskScopedContextAfterCompletion(): void {
  history.length = 0;
  plannerHistory = [];
  agentPrevSteps = [];
}

async function maybeWaitForNewTab(result: any): Promise<void> {
  const logicalTabId = detectOpenedTabFromToolResult(result);
  if (logicalTabId) {
    postStatus('Waiting for new tab to load...', undefined, 'execute');
    await waitForNewTabReady(logicalTabId);
  }
}

async function handleUserMessage(
  text: string,
  options?: { resume?: boolean },
): Promise<RunOutcome> {
  if (!config) throw new Error('Worker not initialized');
  if (!bridgeRpc) throw new Error('Bridge RPC not initialized');
  postStatus('Analyzing request', text, 'analyze');

  const shouldSkipUserPush =
    options?.resume &&
    history.length > 0 &&
    history[history.length - 1]?.role === 'user' &&
    history[history.length - 1]?.content === text;

  if (!shouldSkipUserPush) {
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

  if (!tabularStore) {
    tabularStore = new TabularStore(`rover-${trajectoryId}`);
  }
  const agentName = resolveAgentName(config);
  const runtimeContext = buildRoverRuntimeContext({
    tabs: tabsForRun,
    agentName,
    externalNavigationPolicy: resolveRuntimeExternalNavigationPolicy(config),
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

  const result = await handleSendMessageWithFunctions(text, {
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
    taskRouting: config.taskRouting,
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
    const errorMsg = formatStructuredErrorForAssistant(errorPayload);
    postAssistantMessage(errorMsg);
    history.push({ role: 'assistant', content: errorMsg });
    postStatus('Execution failed', errorPayload.error.message, 'complete');
    postStateSnapshot();
    return { route: result.route, taskComplete: false };
  }

  if (result.executedFunctions?.length) {
    for (const fn of result.executedFunctions) {
      applyAgentPrevSteps(fn.prevSteps, { snapshot: false });
    }
    const lines = result.executedFunctions.map(fn => {
      const out = formatToolOutput(fn.result);
      return out ? `@${fn.name}: ${out}` : `@${fn.name}: ${fn.error || 'ok'}`;
    });
    const msg = lines.join('\n');
    postAssistantMessage(msg);
    history.push({ role: 'assistant', content: msg });
    postStatus('Execution completed', 'Function calls finished', 'complete');
    postStateSnapshot();
    return { route: result.route, taskComplete: true };
  }

  if (result.directToolResult) {
    await maybeWaitForNewTab(result.directToolResult);
    postStatus('Verifying result', undefined, 'verify');
    maybePostNavigationGuardrailFromToolResult(result.directToolResult);
    applyAgentPrevSteps(result.directToolResult.prevSteps, { snapshot: false });
    const output =
      result.directToolResult.output ??
      result.directToolResult.generatedContentRef ??
      result.directToolResult.schemaHeaderSheetInfo;
    const formattedOutput = output ? formatToolOutput(output) : null;
    const structuredError = extractStructuredErrorFromToolResult(result.directToolResult);
    if (structuredError?.error.requires_api_key) {
      postAuthRequired(structuredError.error);
    }
    const msg = structuredError
      ? formatStructuredErrorForAssistant(structuredError)
      : formattedOutput ?? 'Done.';
    postAssistantMessage(msg);
    history.push({ role: 'assistant', content: msg });
    postStatus('Execution completed', structuredError?.error.message, 'complete');
    postStateSnapshot();
    const outcome = deriveDirectToolRunOutcome(result.directToolResult);
    return {
      route: result.route,
      taskComplete: outcome.taskComplete,
      needsUserInput: outcome.needsUserInput,
    };
  }

  if (result.plannerResponse) {
    postStatus('Verifying planner output', undefined, 'verify');
    const response = result.plannerResponse.response;
    if (result.plannerResponse.previousSteps) {
      plannerHistory = result.plannerResponse.previousSteps;
      postStateSnapshot();
    }
    const latestToolPrevSteps = extractLatestPrevStepsFromPlanner(result.plannerResponse.toolResults);
    applyAgentPrevSteps(latestToolPrevSteps, { snapshot: false });

    if (response.questions?.length) {
      const qText = response.questions.map((q: any) => `- ${q.question}`).join('\n');
      const msg = `I need a bit more info:\n${qText}`;
      postAssistantMessage(msg);
      history.push({ role: 'assistant', content: msg });
      postStatus('Planner needs user input', undefined, 'verify');
      postStateSnapshot();
      return { route: result.route, taskComplete: false, needsUserInput: true };
    }

    const toolResults = result.plannerResponse.toolResults || [];
    for (const toolResult of toolResults) {
      await maybeWaitForNewTab(toolResult);
      maybePostNavigationGuardrailFromToolResult(toolResult);
    }
    const formattedOutput = formatPlannerToolResults(toolResults);
    const responseError = response.error || response.errorDetails
      ? toStructuredErrorPayload(response.errorDetails || { message: response.error }, 'Planner failed')
      : undefined;
    if (responseError?.error.requires_api_key) {
      postAuthRequired(responseError.error);
    }
    const msg = formattedOutput ?? (responseError ? formatStructuredErrorForAssistant(responseError) : response.overallThought ?? 'Done.');
    postAssistantMessage(msg);
    history.push({ role: 'assistant', content: msg });
    postStatus('Planner execution completed', response.overallThought, 'complete');
    postStateSnapshot();
    return {
      route: result.route,
      taskComplete: !!response.taskComplete && !responseError,
      needsUserInput: false,
    };
  }

  postAssistantMessage('Done.');
  history.push({ role: 'assistant', content: 'Done.' });
  postStatus('Completed', undefined, 'complete');
  postStateSnapshot();
  return { route: result.route, taskComplete: true };
}

async function runUserMessage(text: string, meta?: { runId?: string; resume?: boolean }): Promise<void> {
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
    const outcome = normalizeRunOutcome(await handleUserMessage(text, { resume }));
    rememberTerminalRun(runId, { ok: true, outcome });
    (self as any).postMessage({
      type: 'run_completed',
      runId,
      ok: true,
      route: outcome.route,
      taskComplete: outcome.taskComplete,
      needsUserInput: outcome.needsUserInput,
    });
    if (outcome.taskComplete && !outcome.needsUserInput) {
      clearTaskScopedContextAfterCompletion();
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
        plannerHistory = [];
        agentPrevSteps = [];
        terminalRuns.clear();
        cancelledRunIds.clear();
        tabularStore = new TabularStore(`rover-${trajectoryId}`);
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
      activeAbortController?.abort();
      history.length = 0;
      plannerHistory = [];
      agentPrevSteps = [];
      terminalRuns.clear();
      cancelledRunIds.clear();
      trajectoryId = nextTaskId;
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
      return;
    }

    if (data.type === 'run') {
      await runUserMessage(String(data.text || ''), { runId: data.runId, resume: !!data.resume });
      return;
    }

    if (data.type === 'user') {
      await runUserMessage(String(data.text || ''), { runId: data.runId, resume: !!data.resume });
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
