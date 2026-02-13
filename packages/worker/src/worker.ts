import type {
  ClientToolDefinition,
  ChatMessage,
  FunctionDeclaration,
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

type RpcRequest = { t: 'req'; id: string; method: string; params?: unknown };
type RpcResponse = { t: 'res'; id: string; ok: boolean; result?: unknown; error?: { message: string } };

type RoverWorkerConfig = RoverAgentConfig & {
  siteId: string;
  allowActions?: boolean;
  maxToolSteps?: number;
  tools?: { client?: ClientToolDefinition[] } | ClientToolDefinition[];
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
let lastStatusKey = '';
let seenStatusKeys = new Set<string>();
const completedRunIds = new Set<string>();

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
      pending.set(id, res => (res.ok ? resolve(res.result) : reject(new Error(res.error?.message || 'RPC error'))));
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
      };
    }
  } catch {
    // ignore and fall back
  }

  try {
    const pageData = await bridgeRpc('getPageData');
    return { id: 1, url: pageData?.url, title: pageData?.title };
  } catch {
    return { id: 1 };
  }
}

async function getKnownTabs(): Promise<RoverTab[]> {
  if (!bridgeRpc) return [{ id: 1 }];

  try {
    const listed = await bridgeRpc('listSessionTabs');
    if (Array.isArray(listed) && listed.length > 0) {
      const mapped = listed
        .map((tab: any) => ({
          id: Number(tab?.logicalTabId || tab?.id || 0),
          url: typeof tab?.url === 'string' ? tab.url : undefined,
          title: typeof tab?.title === 'string' ? tab.title : undefined,
        }))
        .filter((tab: RoverTab) => Number.isFinite(tab.id) && tab.id > 0);

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
  for (const [key, raw] of sorted.slice(0, limit)) {
    const rendered = formatInlineValue(raw);
    if (!rendered) continue;
    lines.push(`${key}: ${rendered}`);
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
        const oneLine = block.replace(/\n+/g, '; ');
        lines.push(`- ${shortText(oneLine, 280)}`);
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
      const base = `Error: ${message}`;
      return nextAction ? `${base}\nNext: ${nextAction}` : base;
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
  const entries = input
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role,
      content: String(message.content || ''),
    }));

  if (currentUserInput) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].role === 'user' && entries[i].content === currentUserInput) {
        entries.splice(i, 1);
        break;
      }
    }
  }

  return entries
    .slice(-40)
    .map(message => ({
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
    if (doc?.url) links.push(`Doc: ${doc.url}`);
  }

  const slides = Array.isArray(generated.slides) ? generated.slides : [];
  for (const slide of slides) {
    if (slide?.url) links.push(`Slides: ${slide.url}`);
  }

  const webpages = Array.isArray(generated.webpages) ? generated.webpages : [];
  for (const page of webpages) {
    const url = page?.storageUrl || page?.downloadUrl;
    if (url) links.push(`Webpage: ${url}`);
  }

  const pdfs = Array.isArray(generated.pdfs) ? generated.pdfs : [];
  for (const pdf of pdfs) {
    const url = pdf?.storageUrl || pdf?.downloadUrl;
    if (url) links.push(`PDF: ${url}`);
  }

  const sheets = Array.isArray(toolResult?.schemaHeaderSheetInfo) ? toolResult.schemaHeaderSheetInfo : [];
  for (const entry of sheets) {
    const sheetId = entry?.sheetInfo?.sheetId;
    if (!sheetId) continue;
    const tabId = entry?.sheetInfo?.sheetTabId;
    const url = tabId
      ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${tabId}`
      : `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    links.push(`Sheet: ${url}`);
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

async function handleUserMessage(
  text: string,
  options?: { resume?: boolean },
): Promise<{ mode?: 'act' | 'planner'; score?: number; reason?: string } | undefined> {
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
  if (!tabularStore) {
    tabularStore = new TabularStore(`rover-${trajectoryId}`);
  }
  const ctx = createAgentContext(config, bridgeRpc, tabularStore);
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
    tabs,
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
    return result.route;
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
    return result.route;
  }

  if (result.directToolResult) {
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
    return result.route;
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
      return result.route;
    }

    const toolResults = result.plannerResponse.toolResults || [];
    for (const toolResult of toolResults) {
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
    return result.route;
  }

  postAssistantMessage('Done.');
  history.push({ role: 'assistant', content: 'Done.' });
  postStatus('Completed', undefined, 'complete');
  postStateSnapshot();
  return result.route;
}

async function runUserMessage(text: string, meta?: { runId?: string; resume?: boolean }): Promise<void> {
  const runId = meta?.runId || crypto.randomUUID();
  if (completedRunIds.has(runId)) {
    (self as any).postMessage({ type: 'run_completed', runId, ok: true, route: undefined });
    return;
  }
  if (activeRun && activeRun.runId === runId) {
    return;
  }
  const resume = !!meta?.resume;
  lastStatusKey = '';
  seenStatusKeys = new Set<string>();
  activeRun = { runId, text, startedAt: Date.now(), resume };
  (self as any).postMessage({ type: 'run_started', runId, text, resume });
  postStateSnapshot();

  try {
    const route = await handleUserMessage(text, { resume });
    (self as any).postMessage({ type: 'run_completed', runId, ok: true, route });
  } catch (error: any) {
    (self as any).postMessage({ type: 'run_completed', runId, ok: false, error: error?.message || String(error) });
    throw error;
  } finally {
    activeRun = null;
    completedRunIds.add(runId);
    if (completedRunIds.size > 50) {
      const oldest = completedRunIds.values().next().value;
      if (oldest) completedRunIds.delete(oldest);
    }
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
      config = { ...config, ...partial };
      if (typeof partial.sessionId === 'string' && partial.sessionId.trim() && partial.sessionId.trim() !== trajectoryId) {
        trajectoryId = partial.sessionId.trim();
        plannerHistory = [];
        agentPrevSteps = [];
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
      history.length = 0;
      plannerHistory = [];
      agentPrevSteps = [];
      trajectoryId = nextTaskId;
      tabularStore = new TabularStore(`rover-${trajectoryId}`);
      activeRun = null;
      postStateSnapshot();
      (self as any).postMessage({ type: 'task_started', taskId: nextTaskId });
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
    }
    (self as any).postMessage({ type: 'error', message: err?.message || String(err), runId: activeRun?.runId });
  }
};
