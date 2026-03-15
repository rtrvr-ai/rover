import type { ToolOutput } from '@rover/shared/lib/types/index.js';
import {
  createBrowserVoiceTranscriber,
  type RoverVoiceConfig,
  type RoverVoiceTelemetryEvent,
  type VoiceRecognitionError,
  type VoiceTranscriber,
} from './voice.js';

export type RoverShortcut = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  prompt: string;
  enabled?: boolean;
  order?: number;
  routing?: 'auto' | 'act' | 'planner';
};

export type RoverAskUserQuestion = {
  key: string;
  query: string;
  id?: string;
  question?: string;
  choices?: string[];
  required?: boolean;
};

export type RoverAskUserAnswerMeta = {
  answersByKey: Record<string, string>;
  rawText: string;
  keys: string[];
};

export type RoverTimelineKind =
  | 'status'
  | 'plan'
  | 'tool_start'
  | 'tool_result'
  | 'thought'
  | 'info'
  | 'error';

export type RoverExecutionMode = 'controller' | 'observer';

export type RoverTimelineEvent = {
  id?: string;
  kind: RoverTimelineKind;
  title: string;
  detail?: string;
  detailBlocks?: RoverMessageBlock[];
  status?: 'pending' | 'success' | 'error' | 'info';
  ts?: number;
};

export type RoverMessageBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'tool_output' | 'json';
      data: ToolOutput | Record<string, unknown> | unknown[] | string | number | boolean | null;
      label?: string;
      toolName?: string;
    };

export type RoverTaskSuggestion = {
  visible: boolean;
  text?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
};

/** Tab info for the in-widget tab bar. */
export type RoverTabInfo = {
  logicalTabId: number;
  url: string;
  title?: string;
  isActive: boolean;
  isCurrent: boolean;
  external?: boolean;
  taskId?: string;
};

/** Conversation item for the conversation drawer. */
export type ConversationListItem = {
  id: string;
  summary: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'awaiting_user' | 'blocked' | 'idle';
  updatedAt: number;
  isActive: boolean;
};

export type RoverUi = {
  addMessage: (
    role: 'user' | 'assistant' | 'system',
    text: string,
    options?: { blocks?: RoverMessageBlock[] },
  ) => void;
  setQuestionPrompt: (prompt?: { questions: RoverAskUserQuestion[] }) => void;
  clearMessages: () => void;
  addTimelineEvent: (event: RoverTimelineEvent) => void;
  clearTimeline: () => void;
  setTaskSuggestion: (suggestion: RoverTaskSuggestion) => void;
  setStatus: (text: string) => void;
  setRunning: (running: boolean) => void;
  setExecutionMode: (
    mode: RoverExecutionMode,
    meta?: {
      controllerRuntimeId?: string;
      localLogicalTabId?: number;
      activeLogicalTabId?: number;
      canTakeControl?: boolean;
      canComposeInObserver?: boolean;
      note?: string;
    },
  ) => void;
  setShortcuts: (shortcuts: RoverShortcut[]) => void;
  showGreeting: (text: string) => void;
  dismissGreeting: () => void;
  setVisitorName: (name: string) => void;
  setVoiceConfig: (voice?: RoverVoiceConfig) => void;
  open: () => void;
  close: () => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
  // Multi-conversation support
  setTabs: (tabs: RoverTabInfo[]) => void;
  setConversations: (conversations: ConversationListItem[]) => void;
  setActiveConversationId: (id: string) => void;
  getScrollPosition: () => number;
  setScrollPosition: (position: number) => void;
  showPausedTaskBanner: (task: { taskId: string; rootUserInput: string }) => void;
  hidePausedTaskBanner: () => void;
};

export type MountOptions = {
  onSend: (text: string, meta?: { askUserAnswers?: RoverAskUserAnswerMeta }) => void;
  onVoiceTelemetry?: (event: RoverVoiceTelemetryEvent, payload?: Record<string, unknown>) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRequestControl?: () => void;
  onNewTask?: () => void;
  onEndTask?: () => void;
  onCancelRun?: () => void;
  onCancelQuestionFlow?: () => void;
  onTaskSuggestionPrimary?: () => void;
  onTaskSuggestionSecondary?: () => void;
  shortcuts?: RoverShortcut[];
  onShortcutClick?: (shortcut: RoverShortcut) => void;
  showTaskControls?: boolean;
  muted?: boolean;
  agent?: {
    name?: string;
  };
  mascot?: {
    disabled?: boolean;
    mp4Url?: string;
    webmUrl?: string;
  };
  greeting?: {
    text?: string;
    delay?: number;
    duration?: number;
    disabled?: boolean;
  };
  voice?: RoverVoiceConfig;
  visitorName?: string;
  // Multi-conversation callbacks
  onSwitchConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCancelPausedTask?: (taskId: string) => void;
  onTabClick?: (logicalTabId: number) => void;
};

const DEFAULT_AGENT_NAME = 'Rover';
const DEFAULT_MASCOT_MP4 = 'https://www.rtrvr.ai/rover/mascot.mp4';
const DEFAULT_MASCOT_WEBM = 'https://www.rtrvr.ai/rover/mascot.webm';

const EXPAND_THRESHOLD_OUTPUT = 1200;
const EXPAND_THRESHOLD_THOUGHT = 1200;
const EXPAND_THRESHOLD_TOOL = 1200;
const STRUCTURED_PAGE_SIZE = 25;
const STRUCTURED_MAX_DEPTH = 4;
const SHORTCUTS_RENDER_LIMIT = 12;
const GREETING_REVEAL_DELAY_MS = 800;
const VOICE_AUTO_STOP_DEFAULT_MS = 2600;
const VOICE_AUTO_STOP_MIN_MS = 800;
const VOICE_AUTO_STOP_MAX_MS = 5000;
const VOICE_INITIAL_SPEECH_GRACE_MS = 5000;
const VOICE_MAX_SESSION_MS = 60000;
const VOICE_MAX_PRE_SPEECH_RESTARTS = 3;
const VOICE_RESTART_DELAY_MS = 160;

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function normalizeTimelineStatus(event: RoverTimelineEvent): 'pending' | 'success' | 'error' | 'info' {
  if (event.status) return event.status;
  if (event.kind === 'tool_start' || event.kind === 'plan' || event.kind === 'thought') return 'pending';
  if (event.kind === 'tool_result') return 'success';
  if (event.kind === 'error') return 'error';
  return 'info';
}

function deriveTraceKey(event: RoverTimelineEvent): string {
  const title = String(event.title || '').trim().toLowerCase();
  if (title.startsWith('running ')) {
    return `tool:${title.replace(/^running\s+/, '').trim()}`;
  }
  if (title.endsWith(' completed')) {
    return `tool:${title.replace(/\s+completed$/, '').trim()}`;
  }
  if (title === 'run started' || title === 'run resumed' || title === 'run completed') {
    return 'run';
  }
  if (event.kind === 'status') {
    return `status:${title || 'status'}`;
  }
  return event.id || createId('trace');
}

function sanitizeText(text: string): string {
  return String(text || '').trim();
}

function normalizeVoiceLanguage(input?: string): string | undefined {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 48);
  return cleaned || undefined;
}

function normalizeVoiceAutoStopMs(input: unknown): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return VOICE_AUTO_STOP_DEFAULT_MS;
  return Math.max(VOICE_AUTO_STOP_MIN_MS, Math.min(VOICE_AUTO_STOP_MAX_MS, Math.trunc(parsed)));
}

function sanitizeVoiceConfig(input?: RoverVoiceConfig): RoverVoiceConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const next: RoverVoiceConfig = {};
  if (typeof input.enabled === 'boolean') {
    next.enabled = input.enabled;
  }
  const language = normalizeVoiceLanguage(input.language);
  if (language) {
    next.language = language;
  }
  if (input.autoStopMs !== undefined) {
    next.autoStopMs = normalizeVoiceAutoStopMs(input.autoStopMs);
  }
  return Object.keys(next).length ? next : undefined;
}

function createNoSpeechVoiceError(): VoiceRecognitionError {
  return {
    code: 'no_speech',
    message: 'No speech was detected.',
    recoverable: true,
  };
}

function normalizeVoiceDraftSegment(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function composeVoiceDraft(base: string, finalTranscript: string, interimTranscript: string): string {
  const chunks = [
    String(base || '').trim(),
    normalizeVoiceDraftSegment(finalTranscript),
    normalizeVoiceDraftSegment(interimTranscript),
  ].filter(Boolean);
  return chunks.join(' ');
}

function resolveAgentName(input?: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) return DEFAULT_AGENT_NAME;
  return normalized.slice(0, 64);
}

function deriveAgentInitial(name: string): string {
  const normalized = String(name || '').trim();
  if (!normalized) return 'R';
  return normalized[0].toUpperCase();
}

function deriveLauncherToken(name: string): string {
  const compact = String(name || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return compact || 'RVR';
}

function parseStageFromTitle(title: string): { stage?: string; plainTitle: string } {
  const clean = sanitizeText(title);
  const match = /^(Analyze|Route|Execute|Verify|Complete):\s*(.*)$/i.exec(clean);
  if (!match) return { plainTitle: clean };
  const stage = match[1].toLowerCase();
  const plainTitle = sanitizeText(match[2] || clean);
  return { stage, plainTitle: plainTitle || clean };
}

function classifyVisibility(event: RoverTimelineEvent): 'primary' | 'detail' {
  const title = (event.title || '').toLowerCase();
  if (title === 'run started' || title === 'run resumed' || title === 'run completed') return 'detail';
  if (title === 'started new task' || title === 'execution completed') return 'detail';
  if (event.kind === 'status') {
    const parsed = parseStageFromTitle(event.title || '');
    if (parsed.stage === 'analyze' || parsed.stage === 'route' || parsed.stage === 'complete') return 'detail';
  }
  return 'primary';
}

function createExpandableContent(text: string, threshold: number): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'expandableWrap';

  if (text.length <= threshold) {
    wrapper.textContent = text;
    return wrapper;
  }

  const preview = document.createElement('span');
  preview.className = 'expandPreview';
  preview.textContent = text.slice(0, threshold);

  const rest = document.createElement('span');
  rest.className = 'expandRest';
  rest.textContent = text.slice(threshold);
  rest.style.display = 'none';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'expandToggle';
  toggle.textContent = 'See more';

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = rest.style.display === 'none';
    rest.style.display = hidden ? 'inline' : 'none';
    toggle.textContent = hidden ? 'See less' : 'See more';
  });

  wrapper.appendChild(preview);
  wrapper.appendChild(rest);
  wrapper.appendChild(toggle);
  return wrapper;
}

function appendInlineContent(parent: HTMLElement, text: string): void {
  const inlineRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    if (match[1] && match[2]) {
      const a = document.createElement('a');
      a.className = 'rvLink';
      a.href = match[2];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = match[1];
      parent.appendChild(a);
    } else if (match[3]) {
      const strong = document.createElement('strong');
      strong.textContent = match[3];
      parent.appendChild(strong);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderRichContent(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  let currentList: HTMLUListElement | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentList) { frag.appendChild(currentList); currentList = null; }
      continue;
    }

    if (trimmed === '---') {
      if (currentList) { frag.appendChild(currentList); currentList = null; }
      const hr = document.createElement('hr');
      hr.className = 'rvSep';
      frag.appendChild(hr);
      continue;
    }

    if (trimmed.startsWith('- ')) {
      if (!currentList) { currentList = document.createElement('ul'); currentList.className = 'rvList'; }
      const li = document.createElement('li');
      appendInlineContent(li, trimmed.slice(2));
      currentList.appendChild(li);
      continue;
    }

    if (currentList) { frag.appendChild(currentList); currentList = null; }

    if (/^Step \d+/i.test(trimmed)) {
      const h = document.createElement('div');
      h.className = 'rvStepHeader';
      h.textContent = trimmed;
      frag.appendChild(h);
      continue;
    }

    if (trimmed.startsWith('[error] ')) {
      const errEl = document.createElement('div');
      errEl.className = 'rvError';
      errEl.textContent = trimmed.slice(8);
      frag.appendChild(errEl);
      continue;
    }

    if (trimmed.startsWith('[next] ')) {
      const nextEl = document.createElement('div');
      nextEl.className = 'rvNext';
      nextEl.textContent = trimmed.slice(7);
      frag.appendChild(nextEl);
      continue;
    }

    const kvMatch = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (kvMatch) {
      const kvRow = document.createElement('div');
      kvRow.className = 'rvKv';
      const label = document.createElement('span');
      label.className = 'rvKvLabel';
      label.textContent = kvMatch[1];
      const val = document.createElement('span');
      val.className = 'rvKvValue';
      appendInlineContent(val, kvMatch[2]);
      kvRow.appendChild(label);
      kvRow.appendChild(val);
      frag.appendChild(kvRow);
      continue;
    }

    const p = document.createElement('div');
    p.className = 'rvLine';
    appendInlineContent(p, trimmed);
    frag.appendChild(p);
  }

  if (currentList) frag.appendChild(currentList);
  return frag;
}

function createExpandableRichContent(text: string, threshold: number): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'expandableWrap';

  if (text.length <= threshold) {
    wrapper.appendChild(renderRichContent(text));
    return wrapper;
  }

  const lines = text.split('\n');
  let charCount = 0;
  let splitLine = 0;
  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i].length + 1;
    if (charCount >= threshold) { splitLine = i + 1; break; }
  }
  if (splitLine === 0) splitLine = 1;

  const previewText = lines.slice(0, splitLine).join('\n');
  const restText = lines.slice(splitLine).join('\n');

  const preview = document.createElement('div');
  preview.className = 'expandPreview';
  preview.appendChild(renderRichContent(previewText));
  wrapper.appendChild(preview);

  if (restText.trim()) {
    const rest = document.createElement('div');
    rest.className = 'expandRest';
    rest.appendChild(renderRichContent(restText));
    rest.style.display = 'none';
    wrapper.appendChild(rest);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'expandToggle';
    toggle.textContent = 'See more';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const hidden = rest.style.display === 'none';
      rest.style.display = hidden ? 'block' : 'none';
      toggle.textContent = hidden ? 'See less' : 'See more';
    });
    wrapper.appendChild(toggle);
  }

  return wrapper;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toSummaryText(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    const listed = keys.slice(0, 4).join(', ');
    return `{ ${listed}${keys.length > 4 ? ', ...' : ''} }`;
  }
  try {
    return String(value);
  } catch {
    return 'value';
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, val) => {
        if (!val || typeof val !== 'object') return val;
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
        return val;
      },
      2,
    ) || 'null';
  } catch {
    return toSummaryText(value);
  }
}

function appendLoadMoreControl(params: {
  total: number;
  shown: number;
  onLoadMore: () => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rvStructuredMore';
  button.textContent = `Show ${Math.min(STRUCTURED_PAGE_SIZE, params.total - params.shown)} more (${params.total - params.shown} left)`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    params.onLoadMore();
  });
  return button;
}

function createRawToggle(value: unknown): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'rvRawToggleWrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rvRawToggle';
  button.textContent = 'View raw JSON';

  const pre = document.createElement('pre');
  pre.className = 'rvRawJson';
  pre.textContent = safeJsonStringify(value);
  pre.style.display = 'none';

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const hidden = pre.style.display === 'none';
    pre.style.display = hidden ? 'block' : 'none';
    button.textContent = hidden ? 'Hide raw JSON' : 'View raw JSON';
  });

  wrap.appendChild(button);
  wrap.appendChild(pre);
  return wrap;
}

function renderPrimitiveValue(value: string | number | boolean | null): HTMLElement {
  const node = document.createElement('div');
  node.className = 'rvStructuredPrimitive';
  if (value === null) {
    node.textContent = 'null';
    node.classList.add('isNull');
    return node;
  }
  if (typeof value === 'string') {
    const clean = sanitizeText(value);
    if (!clean) {
      node.textContent = '""';
      return node;
    }
    if (clean.length > EXPAND_THRESHOLD_OUTPUT) {
      node.appendChild(createExpandableRichContent(clean, EXPAND_THRESHOLD_OUTPUT));
    } else {
      node.appendChild(renderRichContent(clean));
    }
    return node;
  }
  node.textContent = String(value);
  return node;
}

function canRenderObjectArrayAsTable(items: unknown[]): string[] | undefined {
  const candidates = items.slice(0, 25);
  if (!candidates.length) return undefined;
  const columns: string[] = [];

  for (const item of candidates) {
    if (!isPlainObject(item)) return undefined;
    for (const key of Object.keys(item)) {
      if (!columns.includes(key)) columns.push(key);
    }
    if (columns.length > 8) return undefined;
  }

  for (const item of candidates) {
    const record = item as Record<string, unknown>;
    for (const key of columns) {
      const value = record[key];
      if (value == null) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') continue;
      return undefined;
    }
  }

  return columns.length ? columns : undefined;
}

function renderStructuredArray(
  items: unknown[],
  depth: number,
  renderValue: (value: unknown, depth: number) => HTMLElement,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rvStructuredArray';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'rvStructuredEmpty';
    empty.textContent = 'No items';
    wrap.appendChild(empty);
    return wrap;
  }

  const tableColumns = canRenderObjectArrayAsTable(items);
  let visibleCount = Math.min(STRUCTURED_PAGE_SIZE, items.length);

  const list = document.createElement('div');
  list.className = tableColumns ? 'rvStructuredTable' : 'rvStructuredList';
  wrap.appendChild(list);

  const controls = document.createElement('div');
  controls.className = 'rvStructuredControls';
  wrap.appendChild(controls);

  const renderRows = () => {
    list.innerHTML = '';

    if (tableColumns) {
      const table = document.createElement('table');
      table.className = 'rvTable';
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const indexHeader = document.createElement('th');
      indexHeader.textContent = '#';
      headerRow.appendChild(indexHeader);
      for (const column of tableColumns) {
        const th = document.createElement('th');
        th.textContent = column;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (let index = 0; index < visibleCount; index += 1) {
        const row = document.createElement('tr');
        const indexCell = document.createElement('td');
        indexCell.textContent = String(index + 1);
        row.appendChild(indexCell);
        const record = (items[index] as Record<string, unknown>) || {};
        for (const column of tableColumns) {
          const cell = document.createElement('td');
          const raw = record[column];
          if (raw == null) {
            cell.textContent = '—';
          } else {
            cell.textContent = toSummaryText(raw);
          }
          row.appendChild(cell);
        }
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      list.appendChild(table);
    } else {
      for (let index = 0; index < visibleCount; index += 1) {
        const item = items[index];
        const row = document.createElement('div');
        row.className = 'rvStructuredItem';

        const label = document.createElement('div');
        label.className = 'rvStructuredItemLabel';
        label.textContent = `#${index + 1}`;
        row.appendChild(label);

        const body = document.createElement('div');
        body.className = 'rvStructuredItemBody';
        body.appendChild(renderValue(item, depth + 1));
        row.appendChild(body);

        list.appendChild(row);
      }
    }

    controls.innerHTML = '';
    if (visibleCount < items.length) {
      controls.appendChild(appendLoadMoreControl({
        total: items.length,
        shown: visibleCount,
        onLoadMore: () => {
          visibleCount = Math.min(items.length, visibleCount + STRUCTURED_PAGE_SIZE);
          renderRows();
        },
      }));
    }
  };

  renderRows();
  return wrap;
}

function renderStructuredObject(
  value: Record<string, unknown>,
  depth: number,
  renderValue: (entry: unknown, depth: number) => HTMLElement,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rvStructuredObject';

  const entries = Object.entries(value);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'rvStructuredEmpty';
    empty.textContent = 'No fields';
    wrap.appendChild(empty);
    return wrap;
  }

  let visibleCount = Math.min(STRUCTURED_PAGE_SIZE, entries.length);
  const list = document.createElement('div');
  list.className = 'rvStructuredObjectRows';
  wrap.appendChild(list);

  const controls = document.createElement('div');
  controls.className = 'rvStructuredControls';
  wrap.appendChild(controls);

  const renderRows = () => {
    list.innerHTML = '';

    for (let index = 0; index < visibleCount; index += 1) {
      const [key, raw] = entries[index];
      const row = document.createElement('div');
      row.className = 'rvStructuredRow';

      const keyEl = document.createElement('div');
      keyEl.className = 'rvStructuredKey';
      keyEl.textContent = key;

      const valueEl = document.createElement('div');
      valueEl.className = 'rvStructuredValue';
      valueEl.appendChild(renderValue(raw, depth + 1));

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      list.appendChild(row);
    }

    controls.innerHTML = '';
    if (visibleCount < entries.length) {
      controls.appendChild(appendLoadMoreControl({
        total: entries.length,
        shown: visibleCount,
        onLoadMore: () => {
          visibleCount = Math.min(entries.length, visibleCount + STRUCTURED_PAGE_SIZE);
          renderRows();
        },
      }));
    }
  };

  renderRows();
  return wrap;
}

function renderStructuredValue(value: unknown, depth = 0): HTMLElement {
  if (depth >= STRUCTURED_MAX_DEPTH) {
    const capped = document.createElement('div');
    capped.className = 'rvStructuredCapped';
    capped.textContent = toSummaryText(value);
    return capped;
  }

  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return renderPrimitiveValue(value as string | number | boolean | null);
  }

  if (Array.isArray(value)) {
    return renderStructuredArray(value, depth, renderStructuredValue);
  }

  if (isPlainObject(value)) {
    return renderStructuredObject(value, depth, renderStructuredValue);
  }

  const fallback = document.createElement('div');
  fallback.className = 'rvStructuredPrimitive';
  fallback.textContent = toSummaryText(value);
  return fallback;
}

function renderMessageBlock(block: RoverMessageBlock): HTMLElement | undefined {
  if (block.type === 'text') {
    const clean = sanitizeText(block.text);
    if (!clean) return undefined;
    return createExpandableRichContent(clean, EXPAND_THRESHOLD_OUTPUT);
  }

  const card = document.createElement('section');
  card.className = 'rvStructuredCard';

  const header = document.createElement('div');
  header.className = 'rvStructuredHeader';

  const label = document.createElement('span');
  label.className = 'rvStructuredLabel';
  label.textContent = sanitizeText(block.label || (block.type === 'tool_output' ? (block.toolName ? `${block.toolName} output` : 'Tool output') : 'JSON output'));
  header.appendChild(label);

  const typeBadge = document.createElement('span');
  typeBadge.className = 'rvStructuredType';
  if (Array.isArray(block.data)) {
    typeBadge.textContent = `array · ${block.data.length}`;
  } else if (isPlainObject(block.data)) {
    typeBadge.textContent = `object · ${Object.keys(block.data).length}`;
  } else {
    typeBadge.textContent = typeof block.data;
  }
  header.appendChild(typeBadge);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'rvStructuredBody';
  body.appendChild(renderStructuredValue(block.data));
  card.appendChild(body);
  card.appendChild(createRawToggle(block.data));
  return card;
}

function renderAssistantMessageContent(
  text: string,
  blocks: RoverMessageBlock[] | undefined,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  let hasRenderedBlock = false;

  for (const block of normalizedBlocks) {
    const node = renderMessageBlock(block);
    if (!node) continue;
    hasRenderedBlock = true;
    fragment.appendChild(node);
  }

  if (!hasRenderedBlock) {
    const clean = sanitizeText(text);
    if (!clean) return fragment;
    if (clean.length > EXPAND_THRESHOLD_OUTPUT) {
      fragment.appendChild(createExpandableRichContent(clean, EXPAND_THRESHOLD_OUTPUT));
    } else {
      fragment.appendChild(renderRichContent(clean));
    }
    return fragment;
  }

  const trailingText = sanitizeText(text);
  const hasTextBlock = normalizedBlocks.some(block => block.type === 'text' && sanitizeText(block.text) === trailingText);
  if (trailingText && !hasTextBlock) {
    const line = document.createElement('div');
    line.className = 'rvLine';
    line.appendChild(renderRichContent(trailingText));
    fragment.insertBefore(line, fragment.firstChild);
  }

  return fragment;
}

export function mountWidget(opts: MountOptions): RoverUi {
  const agentName = resolveAgentName(opts.agent?.name);
  const agentInitial = deriveAgentInitial(agentName);
  const launcherToken = deriveLauncherToken(agentName);
  let visitorName: string | undefined = opts.visitorName;

  const host = document.createElement('div');
  host.id = 'rover-widget-root';
  (document.body || document.documentElement).appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  /* ── Step 2: Self-hosted font loading for Shadow DOM ── */
  const fontStyle = document.createElement('style');
  fontStyle.textContent = `
    @font-face {
      font-family: 'Manrope';
      font-style: normal;
      font-weight: 400 800;
      font-display: swap;
      src: url('https://rover.rtrvr.ai/rover/fonts/manrope-latin.woff2') format('woff2');
    }
  `;
  document.head.appendChild(fontStyle);

  const style = document.createElement('style');
  style.textContent = `
    /* ── Step 2: Self-hosted font ── */
    @font-face {
      font-family: 'Manrope';
      font-style: normal;
      font-weight: 400 800;
      font-display: swap;
      src: url('https://rover.rtrvr.ai/rover/fonts/manrope-latin.woff2') format('woff2');
    }

    /* ── Step 1: Design Token Overhaul ── */
    :host {
      all: initial;
      --rv-accent: #FF4C00;
      --rv-accent-hover: #E64400;
      --rv-accent-soft: rgba(255, 76, 0, 0.06);
      --rv-accent-border: rgba(255, 76, 0, 0.14);
      --rv-accent-glow: rgba(255, 76, 0, 0.10);
      --rv-bg: #FAFAF7;
      --rv-bg-alt: #F3F1EC;
      --rv-surface: #FFFFFF;
      --rv-text: #1A1A19;
      --rv-text-secondary: #6B6B6B;
      --rv-text-tertiary: #9A9A9A;
      --rv-border: rgba(0, 0, 0, 0.06);
      --rv-border-strong: rgba(0, 0, 0, 0.10);
      --rv-success: #059669;
      --rv-success-soft: rgba(5, 150, 105, 0.08);
      --rv-error: #DC2626;
      --rv-info: #3B82F6;
      --rv-radius-sm: 8px;
      --rv-radius-md: 12px;
      --rv-radius-lg: 16px;
      --rv-radius-xl: 20px;
      --rv-radius-2xl: 28px;
      --rv-ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
      --rv-ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
      --rv-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.03);
      --rv-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03);
      --rv-shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
      --rv-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.10), 0 8px 20px rgba(0, 0, 0, 0.05);
    }

    .rover {
      all: initial;
      font-family: 'Manrope', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .rover * { box-sizing: border-box; }

    /* ── Step 3: Keyframe Animations ── */
    @keyframes panelOpen {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes panelClose {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(12px) scale(0.96); }
    }
    @keyframes msgIn {
      from { opacity: 0; transform: translateY(8px) scale(0.98); filter: blur(2px); }
      to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
    }
    @keyframes launcherPulse {
      0%, 100% { box-shadow: 0 18px 44px rgba(255, 76, 0, 0.25), 0 0 0 0 rgba(255, 76, 0, 0.12); }
      50%      { box-shadow: 0 18px 44px rgba(255, 76, 0, 0.30), 0 0 0 8px rgba(255, 76, 0, 0.04); }
    }
    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30%           { transform: translateY(-4px); }
    }
    @keyframes livePulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.5; transform: scale(0.85); }
    }
    @keyframes scrollBtnIn {
      from { opacity: 0; transform: translateY(8px) scale(0.9); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* ── Step 4: Launcher Enhancement ── */
    .launcher {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 58px;
      height: 58px;
      border-radius: 18px;
      border: 1.5px solid var(--rv-accent-border);
      background: linear-gradient(140deg, var(--rv-accent), #FF7A39);
      box-shadow: 0 18px 44px rgba(255, 76, 0, 0.25);
      color: #fff;
      cursor: pointer;
      z-index: 2147483647;
      overflow: hidden;
      display: grid;
      place-items: center;
      padding: 0;
      transition: transform 300ms var(--rv-ease-spring), box-shadow 300ms var(--rv-ease-spring);
      animation: launcherPulse 3s ease-in-out infinite;
    }

    .launcher:hover {
      transform: translateY(-2px) scale(1.04);
      box-shadow: 0 22px 50px rgba(255, 76, 0, 0.32), 0 0 0 4px rgba(255, 76, 0, 0.08);
    }
    .launcher:active {
      transform: scale(0.98);
      box-shadow: 0 14px 36px rgba(255, 76, 0, 0.22);
    }

    .launcherShine {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(135deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 50%);
      pointer-events: none;
    }

    .launcher video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
      transform: scale(1.15);
      transform-origin: center 45%;
      transition: filter 180ms ease, transform 300ms var(--rv-ease-spring);
    }

    .rover[data-mood="running"] .launcher video,
    .rover[data-mood="running"] .avatar video {
      filter: saturate(1.2);
      transform: scale(1.18);
    }

    .rover[data-mood="typing"] .launcher {
      box-shadow: 0 20px 54px rgba(59, 130, 246, 0.22);
      border-color: rgba(59, 130, 246, 0.24);
    }

    .rover[data-mood="success"] .launcher {
      box-shadow: 0 20px 54px rgba(5, 150, 105, 0.22);
      border-color: rgba(5, 150, 105, 0.28);
    }

    .rover[data-mood="error"] .launcher {
      box-shadow: 0 20px 54px rgba(220, 38, 38, 0.22);
      border-color: rgba(220, 38, 38, 0.28);
    }

    .launcherFallback {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.7px;
    }

    /* ── Step 5: Panel with open/close animation ── */
    .panel {
      position: fixed;
      right: 20px;
      bottom: 90px;
      width: min(460px, calc(100vw - 20px));
      height: min(680px, calc(100vh - 110px));
      min-width: 320px;
      min-height: 460px;
      max-width: min(720px, calc(100vw - 16px));
      max-height: calc(100vh - 16px);
      background:
        radial-gradient(120% 80% at 100% 0%, rgba(255, 76, 0, 0.05), transparent 52%),
        linear-gradient(180deg, var(--rv-bg), var(--rv-bg-alt));
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-2xl);
      box-shadow: var(--rv-shadow-xl);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483646;
      color: var(--rv-text);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      transform-origin: bottom right;
    }

    .panel.open {
      display: flex;
      animation: panelOpen 300ms var(--rv-ease-spring) forwards;
    }

    .panel.closing {
      display: flex;
      animation: panelClose 220ms var(--rv-ease-smooth) forwards;
    }

    /* ── Step 6: Header Redesign ── */
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--rv-border);
      background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(250,250,247,0.94));
      min-height: 52px;
      position: relative;
    }

    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      overflow: hidden;
      border: 1.5px solid var(--rv-accent-border);
      background: var(--rv-surface);
      flex: 0 0 auto;
    }

    .avatar video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .avatarFallback {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      color: var(--rv-accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.45px;
    }

    .meta {
      min-width: 44px;
      flex: 1 1 44px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    .title {
      font-size: 14px;
      font-weight: 700;
      color: var(--rv-text);
      letter-spacing: -0.01em;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      color: var(--rv-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .statusDot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--rv-success);
      flex: 0 0 auto;
      animation: livePulse 2s ease-in-out infinite;
    }

    .headerActions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      margin-left: auto;
    }

    .modeLabel {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 999px;
      margin-left: 4px;
      border: 1px solid transparent;
    }

    .modeLabel.controller {
      color: #9a3412;
      background: rgba(255, 76, 0, 0.08);
      border-color: var(--rv-accent-border);
    }

    .modeLabel.observer {
      color: var(--rv-text-secondary);
      background: rgba(0, 0, 0, 0.04);
      border-color: var(--rv-border-strong);
    }

    .cancelPill {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1.5px solid rgba(220, 38, 38, 0.3);
      background: rgba(220, 38, 38, 0.08);
      color: var(--rv-error);
      font-size: 12px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      flex: 0 0 auto;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .cancelPill:hover {
      background: rgba(220, 38, 38, 0.14);
      border-color: rgba(220, 38, 38, 0.45);
    }
    .cancelPill.visible {
      display: flex;
    }
    .cancelIcon {
      display: block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--rv-error);
    }

    .overflowBtn,
    .closeBtn {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      cursor: pointer;
      display: grid;
      place-items: center;
      color: var(--rv-text-secondary);
      font-size: 16px;
      line-height: 1;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      flex: 0 0 auto;
    }

    .overflowBtn:hover,
    .closeBtn:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }

    .closeBtn {
      font-size: 18px;
    }

    /* ── Execution Progress Bar ── */
    .executionBar {
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      overflow: hidden;
    }
    .executionBar::after {
      content: '';
      position: absolute;
      top: 0;
      left: -40%;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--rv-accent), transparent);
      border-radius: 999px;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .executionBar.active::after {
      opacity: 1;
      animation: executionSlide 1.5s ease-in-out infinite;
    }
    @keyframes executionSlide {
      0% { left: -40%; }
      100% { left: 100%; }
    }

    /* ── Trace Toggle Bar ── */
    .traceToggleBar {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--rv-radius-sm);
      background: var(--rv-bg-alt);
      border: 1px solid var(--rv-border);
    }
    .traceToggleBar.visible {
      display: flex;
    }
    .traceToggleLabel {
      font-size: 11px;
      font-weight: 700;
      color: var(--rv-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .traceToggleCount {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      flex: 1;
    }
    .traceToggleBtn {
      font-size: 11px;
      font-weight: 600;
      color: var(--rv-accent);
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: inherit;
    }
    .traceToggleBtn:hover {
      background: var(--rv-accent-soft);
    }

    /* ── Overflow Menu ── */
    .overflowMenu {
      position: absolute;
      top: calc(100% + 4px);
      right: 14px;
      min-width: 180px;
      background: var(--rv-surface);
      border: 1px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-md);
      box-shadow: var(--rv-shadow-lg);
      z-index: 2147483647;
      padding: 4px;
      display: none;
      flex-direction: column;
      animation: msgIn 200ms var(--rv-ease-spring) forwards;
    }

    .overflowMenu.visible {
      display: flex;
    }

    .menuItem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      border-radius: var(--rv-radius-sm);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      color: var(--rv-text);
      cursor: pointer;
      transition: background 120ms ease;
      text-align: left;
      width: 100%;
    }

    .menuItem:hover {
      background: var(--rv-bg-alt);
    }

    .menuItem.danger {
      color: var(--rv-error);
    }
    .menuItem.danger:hover {
      background: rgba(220, 38, 38, 0.06);
    }

    .menuDivider {
      height: 1px;
      background: var(--rv-border);
      margin: 4px 8px;
    }

    /* ── Step 8: Feed & Scrollbar ── */
    .feed {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 14px 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: radial-gradient(circle at 10% 0%, var(--rv-accent-soft), transparent 45%);
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 76, 0, 0.18) transparent;
      position: relative;
    }

    .feed::-webkit-scrollbar {
      width: 6px;
    }
    .feed::-webkit-scrollbar-track {
      background: transparent;
    }
    .feed::-webkit-scrollbar-thumb {
      background: rgba(255, 76, 0, 0.18);
      border-radius: 999px;
    }
    .feed::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 76, 0, 0.30);
    }

    /* ── Step 7: Message Bubble Redesign ── */
    .entry {
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: msgIn 400ms var(--rv-ease-spring) forwards;
    }

    .entry .stamp {
      font-size: 10px;
      color: var(--rv-text-tertiary);
      align-self: flex-end;
      padding: 0 2px;
    }

    .entry.message { max-width: 90%; }
    .entry.message.user { align-self: flex-end; }
    .entry.message.assistant,
    .entry.message.system { align-self: flex-start; }

    .bubble {
      border-radius: var(--rv-radius-md);
      padding: 10px 14px;
      line-height: 1.5;
      font-size: 13.5px;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid transparent;
    }

    .entry.message.user .bubble {
      background: var(--rv-surface);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
      box-shadow: var(--rv-shadow-sm);
    }

    .entry.message.assistant .bubble {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      color: var(--rv-text);
    }

    .entry.message.system .bubble {
      background: rgba(0, 0, 0, 0.03);
      border-color: var(--rv-border);
      color: var(--rv-text-secondary);
      font-size: 12px;
    }

    /* ── Step 11: Trace/Timeline Cards ── */
    .entry.trace {
      width: 100%;
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-md);
      padding: 10px 12px;
      background: var(--rv-surface);
      transition: all 140ms ease;
      animation: msgIn 350ms var(--rv-ease-spring) forwards;
    }

    .entry.trace.pending {
      border-color: var(--rv-accent-border);
      background: rgba(255, 76, 0, 0.03);
    }

    .entry.trace.success {
      border-color: rgba(5, 150, 105, 0.15);
      background: rgba(5, 150, 105, 0.03);
    }

    .entry.trace.error {
      border-color: rgba(220, 38, 38, 0.15);
      background: rgba(220, 38, 38, 0.04);
    }

    .entry.trace.info {
      border-color: rgba(59, 130, 246, 0.15);
      background: rgba(59, 130, 246, 0.03);
    }

    .traceTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .traceMeta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .traceStage {
      font-size: 10px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-weight: 700;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      padding: 2px 7px;
      flex: 0 0 auto;
    }

    .traceTitle {
      font-size: 13px;
      line-height: 1.35;
      font-weight: 600;
      color: var(--rv-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .traceTs {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      flex: 0 0 auto;
    }

    .traceDetail {
      font-size: 12px;
      line-height: 1.45;
      color: var(--rv-text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      margin-top: 4px;
    }

    .entry.trace.compact .traceDetail {
      display: none;
    }

    /* ── Feed Hierarchy: hide detail-level trace entries ── */
    .entry.trace[data-visibility="detail"] { display: none; }
    .rover[data-show-details="true"] .entry.trace[data-visibility="detail"] { display: block; }

    /* ── Thought Card Styling ── */
    .entry.trace[data-kind="thought"] {
      border-left: 3px solid var(--rv-accent);
      background: var(--rv-accent-soft);
    }
    .entry.trace[data-kind="thought"] .traceStage {
      background: var(--rv-accent-soft);
      color: var(--rv-accent);
      border-color: var(--rv-accent-border);
    }

    /* ── Expandable Content ── */
    .expandableWrap { white-space: pre-wrap; word-break: break-word; }
    .expandToggle {
      display: inline;
      border: none;
      background: transparent;
      color: var(--rv-accent);
      font-size: inherit;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      padding: 0 2px;
    }
    .expandToggle:hover { text-decoration: underline; }

    /* ── Rich Content Elements ── */
    .rvKv {
      display: flex;
      gap: 6px;
      padding: 1px 0;
      line-height: 1.5;
    }
    .rvKvLabel {
      color: var(--rv-text-tertiary);
      font-weight: 600;
      font-size: 12px;
      flex: 0 0 auto;
      white-space: nowrap;
    }
    .rvKvLabel::after { content: ':'; }
    .rvKvValue {
      color: var(--rv-text);
      font-size: 13px;
      word-break: break-word;
      min-width: 0;
    }

    .rvList {
      margin: 4px 0;
      padding-left: 16px;
      list-style: disc;
    }
    .rvList li {
      padding: 1px 0;
      line-height: 1.45;
      font-size: 13px;
      color: var(--rv-text);
    }

    .rvSep {
      border: none;
      border-top: 1px solid var(--rv-border);
      margin: 6px 0;
    }

    .rvStepHeader {
      font-weight: 700;
      font-size: 12px;
      color: var(--rv-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 4px 0 2px;
    }

    .rvError {
      color: #dc2626;
      font-weight: 600;
      font-size: 13px;
      padding: 2px 0;
    }

    .rvNext {
      color: var(--rv-text-secondary);
      font-size: 12.5px;
      font-style: italic;
      padding: 1px 0;
    }

    .rvLink {
      color: var(--rv-accent);
      text-decoration: none;
      font-weight: 500;
      word-break: break-all;
    }
    .rvLink:hover {
      text-decoration: underline;
    }

    .rvLine {
      padding: 1px 0;
      line-height: 1.5;
    }

    .rvStructuredCard {
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      border-radius: var(--rv-radius-sm);
      padding: 8px 10px;
      margin: 6px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rvStructuredHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .rvStructuredLabel {
      font-size: 12px;
      font-weight: 700;
      color: var(--rv-text);
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rvStructuredType {
      font-size: 11px;
      color: var(--rv-text-secondary);
      border: 1px solid var(--rv-border);
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
      flex: 0 0 auto;
      background: var(--rv-bg-alt);
    }

    .rvStructuredBody {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredPrimitive {
      font-size: 12.5px;
      color: var(--rv-text);
      line-height: 1.45;
      word-break: break-word;
    }

    .rvStructuredPrimitive.isNull {
      color: var(--rv-text-tertiary);
      font-style: italic;
    }

    .rvStructuredArray,
    .rvStructuredObject {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredObjectRows {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredRow {
      display: grid;
      grid-template-columns: minmax(88px, 130px) 1fr;
      gap: 8px;
      align-items: start;
    }

    .rvStructuredKey {
      font-size: 11px;
      font-weight: 700;
      color: var(--rv-text-secondary);
      word-break: break-word;
      padding-top: 2px;
    }

    .rvStructuredValue {
      min-width: 0;
    }

    .rvStructuredList {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredItem {
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-sm);
      background: rgba(0, 0, 0, 0.01);
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .rvStructuredItemLabel {
      font-size: 11px;
      font-weight: 700;
      color: var(--rv-text-secondary);
    }

    .rvStructuredItemBody {
      min-width: 0;
    }

    .rvStructuredEmpty,
    .rvStructuredCapped {
      color: var(--rv-text-tertiary);
      font-size: 12px;
      font-style: italic;
    }

    .rvStructuredControls {
      display: flex;
      justify-content: flex-start;
    }

    .rvStructuredMore {
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      font-size: 11.5px;
      font-weight: 600;
      border-radius: var(--rv-radius-sm);
      padding: 4px 8px;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .rvStructuredMore:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-accent-border);
      color: var(--rv-text);
    }

    .rvRawToggleWrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvRawToggle {
      align-self: flex-start;
      border: none;
      background: transparent;
      color: var(--rv-accent);
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
    }

    .rvRawToggle:hover {
      text-decoration: underline;
    }

    .rvRawJson {
      margin: 0;
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-sm);
      background: #fff;
      padding: 8px;
      font-size: 11px;
      line-height: 1.45;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--rv-text-secondary);
    }

    .rvTable {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }

    .rvTable th,
    .rvTable td {
      border: 1px solid var(--rv-border);
      padding: 4px 6px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }

    .rvTable th {
      background: var(--rv-bg-alt);
      color: var(--rv-text-secondary);
      font-weight: 700;
    }

    /* Override inherited pre-wrap inside bubbles and trace details */
    .rvKv,
    .rvList,
    .rvLine,
    .rvStepHeader,
    .rvError,
    .rvNext {
      white-space: normal;
    }

    /* ── Step 12: Task Suggestion Bar ── */
    .taskSuggestion {
      display: none;
      border-top: 1px solid var(--rv-border);
      padding: 10px 14px;
      background: rgba(255, 76, 0, 0.03);
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .taskSuggestion.visible {
      display: flex;
    }

    .taskSuggestionText {
      font-size: 12.5px;
      line-height: 1.4;
      color: var(--rv-text-secondary);
      flex: 1;
      min-width: 0;
    }

    .taskSuggestionActions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }

    .taskSuggestionBtn {
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      color: var(--rv-text);
      border-radius: var(--rv-radius-sm);
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: 0.01em;
      padding: 5px 10px;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .taskSuggestionBtn:hover {
      background: var(--rv-bg-alt);
    }

    .taskSuggestionBtn.primary {
      border-color: var(--rv-accent-border);
      color: var(--rv-accent);
      background: var(--rv-accent-soft);
    }
    .taskSuggestionBtn.primary:hover {
      background: rgba(255, 76, 0, 0.10);
    }

    .questionPrompt {
      display: none;
      border-top: 1px solid var(--rv-border);
      border-bottom: 1px solid var(--rv-border);
      padding: 8px 14px;
      background: rgba(255, 76, 0, 0.035);
      gap: 8px;
      flex-direction: column;
    }

    .questionPrompt.visible {
      display: flex;
    }

    .questionPromptTitle {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--rv-text-secondary);
    }

    .questionPromptForm {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: min(32vh, 230px);
    }

    .questionPromptList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      max-height: min(24vh, 170px);
      padding-right: 2px;
    }

    .questionPromptItem {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .questionPromptLabel {
      font-size: 12px;
      line-height: 1.35;
      color: var(--rv-text);
      font-weight: 600;
    }

    .questionPromptInput {
      width: 100%;
      border: 1px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-sm);
      padding: 8px 10px;
      font-size: 12.5px;
      line-height: 1.35;
      font-family: inherit;
      color: var(--rv-text);
      background: var(--rv-surface);
      outline: none;
    }

    .questionPromptInput:focus {
      border-color: var(--rv-accent);
      box-shadow: 0 0 0 3px var(--rv-accent-glow);
    }

    .questionPromptInput.invalid {
      border-color: #d63a1e;
      box-shadow: 0 0 0 2px rgba(214, 58, 30, 0.15);
    }

    .questionPromptActions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      position: sticky;
      bottom: 0;
      padding-top: 2px;
      background: linear-gradient(to bottom, rgba(255, 247, 242, 0), rgba(255, 247, 242, 0.94) 40%);
    }

    .questionPromptCancel {
      border: 1px solid var(--rv-border-strong);
      background: rgba(255, 255, 255, 0.88);
      color: var(--rv-text-secondary);
      border-radius: var(--rv-radius-sm);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      padding: 6px 10px;
      cursor: pointer;
    }

    .questionPromptCancel:hover {
      background: rgba(242, 246, 250, 0.95);
    }

    .questionPromptSubmit {
      border: 1px solid var(--rv-accent-border);
      background: var(--rv-accent-soft);
      color: var(--rv-accent);
      border-radius: var(--rv-radius-sm);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      padding: 6px 10px;
      cursor: pointer;
    }

    .questionPromptSubmit:hover {
      background: rgba(255, 76, 0, 0.1);
    }

    /* ── Step 10: Composer Enhancement ── */
    .composer {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-top: 1px solid var(--rv-border);
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .composerRow {
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }

    .composer textarea {
      flex: 1;
      resize: none;
      min-height: 44px;
      max-height: 96px;
      border: 1.5px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-md);
      padding: 10px 12px;
      font-size: 13.5px;
      line-height: 1.4;
      font-family: inherit;
      color: var(--rv-text);
      background: var(--rv-surface);
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }

    .composer textarea::placeholder {
      color: var(--rv-text-tertiary);
      font-weight: 400;
    }

    .composer textarea:focus {
      border-color: var(--rv-accent);
      box-shadow: 0 0 0 3px var(--rv-accent-glow);
    }

    .composer textarea:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .composerActions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .voiceBtn {
      border: 1.5px solid var(--rv-border-strong);
      background: rgba(255, 255, 255, 0.9);
      color: var(--rv-accent);
      border-radius: var(--rv-radius-md);
      height: 44px;
      width: 44px;
      min-width: 44px;
      padding: 0;
      cursor: pointer;
      display: none;
      place-items: center;
      transition: transform 200ms var(--rv-ease-spring), box-shadow 200ms ease, border-color 150ms ease, background 150ms ease;
      box-shadow: 0 3px 10px rgba(19, 30, 43, 0.08);
    }

    .voiceBtn.visible {
      display: grid;
    }

    .voiceBtn:hover {
      transform: translateY(-1px);
      box-shadow: 0 5px 14px rgba(19, 30, 43, 0.12);
      border-color: var(--rv-accent-border);
    }

    .voiceBtn:active {
      transform: scale(0.96);
    }

    .voiceBtn.active {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      box-shadow: 0 0 0 3px var(--rv-accent-glow);
    }

    .voiceBtn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .voiceBtn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .sendBtn {
      border: none;
      background: linear-gradient(145deg, var(--rv-accent), #FF7A39);
      color: #fff;
      border-radius: var(--rv-radius-md);
      height: 44px;
      width: 44px;
      min-width: 44px;
      padding: 0;
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: transform 200ms var(--rv-ease-spring), box-shadow 200ms ease;
      box-shadow: 0 4px 12px rgba(255, 76, 0, 0.20);
    }

    .sendBtn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(255, 76, 0, 0.28);
    }
    .sendBtn:active {
      transform: scale(0.96);
      box-shadow: 0 2px 8px rgba(255, 76, 0, 0.16);
    }

    .sendBtn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .composerStatus {
      display: none;
      min-height: 16px;
      font-size: 11.5px;
      line-height: 1.35;
      color: var(--rv-text-secondary);
      padding: 0 2px;
    }

    .composerStatus.visible {
      display: block;
    }

    .composerStatus.error {
      color: #c2410c;
    }

    /* ── Step 13: Resize Handle ── */
    .resizeHandle {
      position: absolute;
      left: 8px;
      bottom: 8px;
      width: 14px;
      height: 14px;
      border-left: 2px solid var(--rv-border-strong);
      border-bottom: 2px solid var(--rv-border-strong);
      border-radius: 2px;
      cursor: nwse-resize;
      opacity: 0;
      transition: opacity 200ms ease;
    }

    .panel:hover .resizeHandle {
      opacity: 0.6;
    }

    .resizeHandle:hover {
      opacity: 1 !important;
      border-color: var(--rv-accent);
    }

    /* ── Step 9: Smart Scroll Button ── */
    .scrollBtn {
      position: absolute;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: var(--rv-surface);
      border: 1px solid var(--rv-border-strong);
      box-shadow: var(--rv-shadow-md);
      cursor: pointer;
      display: none;
      place-items: center;
      z-index: 10;
      color: var(--rv-accent);
      animation: scrollBtnIn 300ms var(--rv-ease-spring) forwards;
      transition: background 120ms ease, box-shadow 120ms ease;
    }

    .scrollBtn:hover {
      background: var(--rv-bg-alt);
      box-shadow: var(--rv-shadow-lg);
    }

    .scrollBtn.visible {
      display: grid;
    }

    .scrollBtn svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* ── Step 15: Typing Indicator ── */
    .typingIndicator {
      display: none;
      align-self: flex-start;
      align-items: center;
      gap: 4px;
      padding: 10px 16px;
      border-radius: var(--rv-radius-md) var(--rv-radius-md) var(--rv-radius-md) 4px;
      background: var(--rv-accent-soft);
      border: 1px solid var(--rv-accent-border);
      max-width: 70px;
    }

    .typingIndicator.visible {
      display: flex;
    }

    .typingDot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--rv-accent);
      opacity: 0.5;
      animation: typingBounce 1.2s ease-in-out infinite;
    }
    .typingDot:nth-child(2) { animation-delay: 0.15s; }
    .typingDot:nth-child(3) { animation-delay: 0.30s; }

    /* ── Shortcuts: Empty State Cards ── */
    .shortcutsEmptyState {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 20px 8px 12px;
      animation: msgIn 400ms var(--rv-ease-spring) forwards;
    }

    .shortcutsEmptyState.visible {
      display: flex;
    }

    .shortcutsHeading {
      font-size: 14px;
      font-weight: 600;
      color: var(--rv-text-secondary);
      text-align: center;
    }

    .shortcutsGrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      width: 100%;
    }

    .shortcutCard {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-md);
      background: var(--rv-surface);
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
      text-align: left;
    }

    .shortcutCard:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      box-shadow: var(--rv-shadow-sm);
      border-left: 2px solid var(--rv-accent);
    }

    .shortcutCard:active {
      transform: scale(0.98);
    }

    .shortcutCardIcon {
      font-size: 18px;
      line-height: 1;
    }

    .shortcutCardLabel {
      font-size: 13px;
      font-weight: 600;
      color: var(--rv-text);
      line-height: 1.3;
    }

    .shortcutCardDesc {
      font-size: 11.5px;
      color: var(--rv-text-secondary);
      line-height: 1.35;
    }

    /* ── Shortcuts: Compact Chips Bar ── */
    .shortcutsBar {
      display: none;
      gap: 6px;
      padding: 8px 14px;
      overflow-x: auto;
      overflow-y: hidden;
      border-top: 1px solid var(--rv-border);
      scrollbar-width: none;
      -ms-overflow-style: none;
      animation: msgIn 300ms var(--rv-ease-spring) forwards;
    }

    .shortcutsBar::-webkit-scrollbar {
      display: none;
    }

    .shortcutsBar.visible {
      display: flex;
    }

    .shortcutChip {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border: 1px solid var(--rv-border-strong);
      border-radius: 999px;
      background: var(--rv-surface);
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      color: var(--rv-text);
      cursor: pointer;
      white-space: nowrap;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .shortcutChip:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
    }

    .shortcutChip:active {
      transform: scale(0.97);
    }

    .shortcutChipIcon {
      font-size: 13px;
      line-height: 1;
    }

    /* ── Greeting Bubble ── */
    @keyframes greetingIn {
      0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
      70%  { opacity: 1; transform: translateY(-1px) scale(1.005); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes greetingOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(4px) scale(0.98); }
    }
    @keyframes dotPulse {
      0%, 100% { opacity: 0.3; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.15); }
    }
    @keyframes textReveal {
      from { opacity: 0; transform: translateY(3px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .greetingBubble {
      position: fixed;
      right: 20px;
      bottom: 88px;
      max-width: 220px;
      padding: 9px 24px 9px 12px;
      background:
        radial-gradient(120% 80% at 100% 0%, rgba(255, 76, 0, 0.05), transparent 52%),
        linear-gradient(180deg, rgba(250, 250, 247, 0.72), rgba(243, 241, 236, 0.72));
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.45);
      border-radius: var(--rv-radius-lg);
      box-shadow: var(--rv-shadow-lg);
      z-index: 2147483647;
      display: none;
      cursor: pointer;
      animation: greetingIn 380ms var(--rv-ease-spring) forwards;
    }

    .greetingBubble.visible { display: block; }
    .greetingBubble.dismissing { animation: greetingOut 250ms var(--rv-ease-smooth) forwards; }

    .greetingBubble::after {
      content: '';
      position: absolute;
      bottom: -6px;
      right: 22px;
      width: 12px;
      height: 12px;
      background: rgba(243, 241, 236, 0.72);
      border-right: 1px solid rgba(255, 255, 255, 0.45);
      border-bottom: 1px solid rgba(255, 255, 255, 0.45);
      transform: rotate(45deg);
    }

    .greetingDots {
      display: flex;
      align-items: center;
      gap: 5px;
      height: 20px;
      transition: opacity 200ms ease, max-height 200ms ease;
    }

    .greetingDot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--rv-text-tertiary);
      animation: dotPulse 1.4s ease-in-out infinite;
    }
    .greetingDot:nth-child(2) { animation-delay: 200ms; }
    .greetingDot:nth-child(3) { animation-delay: 400ms; }

    .greetingBubble.textVisible .greetingDots {
      opacity: 0;
      max-height: 0;
      overflow: hidden;
      pointer-events: none;
    }

    .greetingText {
      font-size: 13.5px;
      font-weight: 500;
      color: var(--rv-text);
      line-height: 1.45;
      letter-spacing: -0.01em;
      opacity: 0;
      transform: translateY(3px);
    }

    .greetingBubble.textVisible .greetingText {
      animation: textReveal 350ms var(--rv-ease-smooth) forwards;
    }

    .greetingClose {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: var(--rv-text-tertiary);
      font-size: 13px;
      cursor: pointer;
      display: grid;
      place-items: center;
      border-radius: 999px;
      opacity: 0;
      transition: opacity 150ms ease, background 120ms ease, color 120ms ease;
    }

    .greetingBubble:hover .greetingClose {
      opacity: 1;
    }

    .greetingClose:hover {
      background: var(--rv-bg-alt);
      color: var(--rv-text);
    }

    /* ── Step 14: Mobile Responsive ── */
    @media (max-width: 640px) {
      .launcher {
        right: 14px;
        bottom: 14px;
        width: 52px;
        height: 52px;
        border-radius: var(--rv-radius-lg);
      }

      .panel {
        right: 8px;
        left: 8px;
        bottom: 74px;
        width: auto;
        min-width: 0;
        height: min(76vh, calc(100vh - 92px));
        border-radius: var(--rv-radius-xl);
      }

      .header {
        padding: 10px 12px;
        gap: 8px;
        min-height: 48px;
      }

      .avatar {
        width: 32px;
        height: 32px;
      }

      .title {
        font-size: 13px;
      }

      .status {
        font-size: 11px;
      }

      .overflowBtn,
      .closeBtn {
        width: 36px;
        height: 36px;
      }

      .modeLabel {
        font-size: 9px;
        padding: 1px 4px;
      }

      .bubble {
        font-size: 13px;
        padding: 9px 12px;
      }

      .composer {
        padding: 10px 12px;
      }

      .composer textarea {
        min-height: 40px;
        font-size: 13px;
        padding: 9px 11px;
      }

      .sendBtn {
        height: 40px;
        width: 40px;
        min-width: 40px;
      }

      .resizeHandle {
        display: none;
      }

      .feed {
        padding: 12px 12px 8px;
        gap: 8px;
      }

      .shortcutsGrid {
        grid-template-columns: 1fr;
      }

      .shortcutsBar {
        padding: 6px 12px;
      }

      .questionPrompt {
        padding: 8px 12px;
      }

      .questionPromptForm {
        max-height: min(34vh, 210px);
      }

      .questionPromptList {
        max-height: min(26vh, 150px);
      }

      .questionPromptLabel {
        font-size: 11.5px;
      }

      .questionPromptInput {
        font-size: 12px;
      }

      .greetingBubble {
        right: 14px;
        bottom: 76px;
        max-width: 190px;
        padding: 8px 22px 8px 10px;
      }

      .roverTabBar {
        padding: 4px 8px;
      }

      .conversationDrawer {
        width: 100%;
      }
    }

    /* ── Conversation Pill (hidden — not useful) ── */
    .roverConversationPill {
      display: none !important;
    }
    .roverConversationPill:hover {
      background: rgba(0,0,0,0.03);
      border-color: var(--rv-border-strong);
    }
    .roverConversationPillLabel {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .roverConversationPillArrow {
      font-size: 10px;
      opacity: .6;
    }

    /* ── Tab Bar (hidden, kept for backward compat) ── */
    .roverTabBar {
      display: none !important;
    }

    /* ── Conversation Drawer ── */
    .conversationDrawer {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--rv-bg);
      border-right: 1px solid var(--rv-border);
      z-index: 100;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      transition: transform .25s var(--rv-ease-spring);
    }
    .conversationDrawer.open {
      transform: translateX(0);
    }
    .conversationDrawerHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--rv-border);
    }
    .conversationDrawerTitle {
      font-size: 14px;
      font-weight: 700;
      color: var(--rv-text);
    }
    .conversationDrawerClose {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      cursor: pointer;
      font-size: 18px;
      display: grid;
      place-items: center;
      padding: 0;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .conversationDrawerClose:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }
    .conversationList {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .conversationItem {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background .15s, border-color .15s;
    }
    .conversationItem:hover {
      background: rgba(0,0,0,0.03);
    }
    .conversationItem.active {
      background: var(--rv-accent-soft);
      border: 1px solid var(--rv-accent-border);
    }
    .conversationDot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--rv-text-tertiary);
    }
    .conversationItem.running .conversationDot { background: var(--rv-success); }
    .conversationItem.paused .conversationDot { background: #D97706; }
    .conversationItem.completed .conversationDot { background: var(--rv-text-tertiary); }
    .conversationItem.failed .conversationDot { background: var(--rv-error); }
    .conversationItem.awaiting_user .conversationDot { background: var(--rv-info); }
    .conversationContent {
      flex: 1;
      min-width: 0;
    }
    .conversationSummary {
      font-size: 13px;
      color: var(--rv-text);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .conversationMeta {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      margin-top: 2px;
    }
    .conversationActions {
      opacity: 0;
      transition: opacity .15s;
    }
    .conversationItem:hover .conversationActions {
      opacity: 1;
    }
    .conversationDeleteBtn {
      background: var(--rv-surface);
      border: 1px solid var(--rv-border);
      color: var(--rv-text-tertiary);
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .conversationDeleteBtn:hover {
      color: var(--rv-error);
      background: rgba(220,38,38,0.06);
      border-color: rgba(220,38,38,0.25);
    }
    .conversationNewBtn {
      display: block;
      width: calc(100% - 16px);
      margin: 8px;
      padding: 10px;
      background: var(--rv-surface);
      border: 1px dashed var(--rv-border-strong);
      border-radius: 8px;
      color: var(--rv-text-secondary);
      font-size: 13px;
      cursor: pointer;
      text-align: center;
      transition: background .15s, border-color .15s, color .15s;
    }
    .conversationNewBtn:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      color: var(--rv-accent);
    }

    /* ── Paused Task Banner ── */
    .pausedTaskBanner {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      background: rgba(251,191,36,.08);
      border-bottom: 1px solid rgba(251,191,36,.15);
      gap: 8px;
    }
    .pausedTaskBanner.visible {
      display: flex;
    }
    .pausedTaskText {
      font-size: 12px;
      color: #fbbf24;
      flex: 1;
    }
    .pausedTaskActions {
      display: flex;
      gap: 6px;
    }
    .pausedTaskActions button {
      padding: 4px 10px;
      border-radius: 6px;
      border: none;
      font-size: 11px;
      cursor: pointer;
      font-weight: 500;
    }
    .pausedTaskResumeBtn {
      background: #fbbf24;
      color: #1a1a2e;
    }
    .pausedTaskResumeBtn:hover {
      background: #f59e0b;
    }
    .pausedTaskCancelBtn {
      background: rgba(0,0,0,0.04);
      color: var(--rv-text-secondary);
    }
    .pausedTaskCancelBtn:hover {
      background: rgba(0,0,0,0.08);
    }

    /* ── Conversation List Button ── */
    .conversationListBtn {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
      flex: 0 0 auto;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .conversationListBtn:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }
  `;

  const wrapper = document.createElement('div');
  wrapper.className = 'rover';
  wrapper.dataset.mood = 'idle';

  /* ── Launcher ── */
  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', `Open ${agentName} assistant`);

  const mascotDisabled = opts.mascot?.disabled === true;

  let launcherVideo: HTMLVideoElement | null = null;
  if (!mascotDisabled) {
    launcherVideo = document.createElement('video');
    launcherVideo.autoplay = true;
    launcherVideo.muted = true;
    launcherVideo.loop = true;
    launcherVideo.playsInline = true;
    launcherVideo.preload = 'metadata';
    const launcherMp4 = document.createElement('source');
    launcherMp4.src = opts.mascot?.mp4Url || DEFAULT_MASCOT_MP4;
    launcherMp4.type = 'video/mp4';
    const launcherWebm = document.createElement('source');
    launcherWebm.src = opts.mascot?.webmUrl || DEFAULT_MASCOT_WEBM;
    launcherWebm.type = 'video/webm';
    launcherVideo.appendChild(launcherMp4);
    launcherVideo.appendChild(launcherWebm);
    launcher.appendChild(launcherVideo);
  }

  const launcherFallback = document.createElement('span');
  launcherFallback.className = 'launcherFallback';
  launcherFallback.textContent = launcherToken;

  const launcherShine = document.createElement('div');
  launcherShine.className = 'launcherShine';

  launcher.appendChild(launcherFallback);
  launcher.appendChild(launcherShine);

  /* ── Greeting Bubble ── */
  const greetingBubble = document.createElement('div');
  greetingBubble.className = 'greetingBubble';

  const greetingText = document.createElement('span');
  greetingText.className = 'greetingText';

  const greetingClose = document.createElement('button');
  greetingClose.type = 'button';
  greetingClose.className = 'greetingClose';
  greetingClose.textContent = '\u00D7';
  greetingClose.setAttribute('aria-label', 'Dismiss');

  const greetingDots = document.createElement('div');
  greetingDots.className = 'greetingDots';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'greetingDot';
    greetingDots.appendChild(dot);
  }

  greetingBubble.appendChild(greetingDots);
  greetingBubble.appendChild(greetingText);
  greetingBubble.appendChild(greetingClose);

  /* ── Panel ── */
  const panel = document.createElement('div');
  panel.className = 'panel';

  /* ── Header ── */
  const header = document.createElement('div');
  header.className = 'header';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  let avatarVideo: HTMLVideoElement | null = null;
  if (!mascotDisabled && launcherVideo) {
    avatarVideo = launcherVideo.cloneNode(true) as HTMLVideoElement;
    avatar.appendChild(avatarVideo);
  }
  const avatarFallback = document.createElement('span');
  avatarFallback.className = 'avatarFallback';
  avatarFallback.textContent = agentInitial;
  avatar.appendChild(avatarFallback);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = agentName;
  const statusEl = document.createElement('div');
  statusEl.className = 'status';
  const statusDot = document.createElement('span');
  statusDot.className = 'statusDot';
  const statusText = document.createElement('span');
  statusText.textContent = 'ready';
  const modeLabel = document.createElement('span');
  modeLabel.className = 'modeLabel controller';
  modeLabel.textContent = 'active';
  statusEl.appendChild(statusDot);
  statusEl.appendChild(statusText);
  statusEl.appendChild(modeLabel);
  meta.appendChild(titleEl);
  meta.appendChild(statusEl);

  /* ── Header Actions ── */
  const headerActions = document.createElement('div');
  headerActions.className = 'headerActions';

  const overflowBtn = document.createElement('button');
  overflowBtn.type = 'button';
  overflowBtn.className = 'overflowBtn';
  overflowBtn.setAttribute('aria-label', 'More options');
  overflowBtn.innerHTML = '&#x22EF;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'closeBtn';
  closeBtn.setAttribute('aria-label', 'Close Rover panel');
  closeBtn.textContent = '\u00D7';

  /* ── Mute state (moved to overflow menu) ── */
  let isMuted = opts.muted ?? true;
  try {
    const stored = localStorage.getItem('rover:muted');
    if (stored !== null) isMuted = stored !== 'false';
  } catch { /* ignore */ }

  function syncMuteState(): void {
    if (launcherVideo) launcherVideo.muted = isMuted;
    if (avatarVideo) avatarVideo.muted = isMuted;
  }
  syncMuteState();

  /* ── Cancel Pill ── */
  const cancelPill = document.createElement('button');
  cancelPill.type = 'button';
  cancelPill.className = 'cancelPill';
  cancelPill.setAttribute('aria-label', 'Cancel task');
  const cancelIcon = document.createElement('span');
  cancelIcon.className = 'cancelIcon';
  cancelPill.appendChild(cancelIcon);
  cancelPill.appendChild(document.createTextNode(' Cancel'));

  /* ── Execution Progress Bar ── */
  const executionBar = document.createElement('div');
  executionBar.className = 'executionBar';

  /* ── Conversation List Button (in header) ── */
  const conversationListBtn = document.createElement('button');
  conversationListBtn.type = 'button';
  conversationListBtn.className = 'conversationListBtn';
  conversationListBtn.setAttribute('aria-label', 'Conversations');
  conversationListBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

  headerActions.appendChild(conversationListBtn);
  headerActions.appendChild(overflowBtn);
  headerActions.appendChild(cancelPill);
  headerActions.appendChild(closeBtn);

  /* ── Overflow Menu ── */
  const overflowMenu = document.createElement('div');
  overflowMenu.className = 'overflowMenu';

  const menuNewTask = document.createElement('button');
  menuNewTask.type = 'button';
  menuNewTask.className = 'menuItem';
  menuNewTask.textContent = 'New task';

  const menuEndTask = document.createElement('button');
  menuEndTask.type = 'button';
  menuEndTask.className = 'menuItem danger';
  menuEndTask.textContent = 'End task';

  const menuDivider = document.createElement('div');
  menuDivider.className = 'menuDivider';

  const menuMuteToggle = document.createElement('button');
  menuMuteToggle.type = 'button';
  menuMuteToggle.className = 'menuItem';
  menuMuteToggle.textContent = isMuted ? 'Unmute sounds' : 'Mute sounds';

  menuMuteToggle.addEventListener('click', () => {
    closeOverflow();
    isMuted = !isMuted;
    try { localStorage.setItem('rover:muted', String(isMuted)); } catch { /* ignore */ }
    syncMuteState();
    menuMuteToggle.textContent = isMuted ? 'Unmute sounds' : 'Mute sounds';
  });

  const menuTakeControl = document.createElement('button');
  menuTakeControl.type = 'button';
  menuTakeControl.className = 'menuItem';
  menuTakeControl.textContent = 'Take control';
  menuTakeControl.style.display = 'none';

  overflowMenu.appendChild(menuNewTask);
  overflowMenu.appendChild(menuEndTask);
  overflowMenu.appendChild(menuDivider);
  overflowMenu.appendChild(menuMuteToggle);
  overflowMenu.appendChild(menuTakeControl);

  if (opts.showTaskControls === false) {
    menuNewTask.style.display = 'none';
    menuEndTask.style.display = 'none';
  }

  header.appendChild(avatar);
  header.appendChild(meta);
  header.appendChild(headerActions);
  header.appendChild(overflowMenu);
  header.appendChild(executionBar);

  /* ── Feed ── */
  const feedWrapper = document.createElement('div');
  feedWrapper.style.cssText = 'position:relative;flex:1;min-height:0;display:flex;flex-direction:column;';

  const feed = document.createElement('div');
  feed.className = 'feed';

  /* ── Trace Toggle Bar ── */
  const traceToggleBar = document.createElement('div');
  traceToggleBar.className = 'traceToggleBar';
  const traceToggleLabel = document.createElement('span');
  traceToggleLabel.className = 'traceToggleLabel';
  traceToggleLabel.textContent = 'Execution Log';
  const traceToggleCount = document.createElement('span');
  traceToggleCount.className = 'traceToggleCount';
  traceToggleCount.textContent = '0 steps';
  const traceToggleBtn = document.createElement('button');
  traceToggleBtn.type = 'button';
  traceToggleBtn.className = 'traceToggleBtn';
  traceToggleBtn.textContent = 'Show all';
  traceToggleBar.appendChild(traceToggleLabel);
  traceToggleBar.appendChild(traceToggleCount);
  traceToggleBar.appendChild(traceToggleBtn);
  feed.appendChild(traceToggleBar);

  /* ── Typing Indicator ── */
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'typingIndicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typingDot';
    typingIndicator.appendChild(dot);
  }
  feed.appendChild(typingIndicator);

  /* ── Scroll Button ── */
  const scrollBtn = document.createElement('button');
  scrollBtn.type = 'button';
  scrollBtn.className = 'scrollBtn';
  scrollBtn.setAttribute('aria-label', 'Scroll to bottom');
  scrollBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  feedWrapper.appendChild(feed);
  feedWrapper.appendChild(scrollBtn);

  /* ── Task Suggestion ── */
  const taskSuggestion = document.createElement('div');
  taskSuggestion.className = 'taskSuggestion';
  taskSuggestion.innerHTML = `
    <div class="taskSuggestionText"></div>
    <div class="taskSuggestionActions">
      <button type="button" class="taskSuggestionBtn primary">Start new</button>
      <button type="button" class="taskSuggestionBtn secondary">Continue</button>
    </div>
  `;

  /* ── Shortcuts: Empty State (cards inside feed) ── */
  const shortcutsEmptyState = document.createElement('div');
  shortcutsEmptyState.className = 'shortcutsEmptyState';

  const shortcutsHeading = document.createElement('div');
  shortcutsHeading.className = 'shortcutsHeading';
  shortcutsHeading.textContent = visitorName
    ? `Hey ${visitorName}! What can I help with?`
    : `What can ${agentName} help you with?`;

  const shortcutsGrid = document.createElement('div');
  shortcutsGrid.className = 'shortcutsGrid';

  shortcutsEmptyState.appendChild(shortcutsHeading);
  shortcutsEmptyState.appendChild(shortcutsGrid);
  feed.appendChild(shortcutsEmptyState);

  /* ── Shortcuts: Compact Chips Bar (above composer) ── */
  const shortcutsBar = document.createElement('div');
  shortcutsBar.className = 'shortcutsBar';

  /* ── Ask User Prompt ── */
  const questionPrompt = document.createElement('div');
  questionPrompt.className = 'questionPrompt';

  const questionPromptTitle = document.createElement('div');
  questionPromptTitle.className = 'questionPromptTitle';
  questionPromptTitle.textContent = 'Need a bit more info';

  const questionPromptForm = document.createElement('form');
  questionPromptForm.className = 'questionPromptForm';

  const questionPromptList = document.createElement('div');
  questionPromptList.className = 'questionPromptList';
  questionPromptForm.appendChild(questionPromptList);

  const questionPromptActions = document.createElement('div');
  questionPromptActions.className = 'questionPromptActions';

  const questionPromptCancel = document.createElement('button');
  questionPromptCancel.type = 'button';
  questionPromptCancel.className = 'questionPromptCancel';
  questionPromptCancel.textContent = 'Cancel';
  questionPromptActions.appendChild(questionPromptCancel);

  const questionPromptSubmit = document.createElement('button');
  questionPromptSubmit.type = 'submit';
  questionPromptSubmit.className = 'questionPromptSubmit';
  questionPromptSubmit.textContent = 'Continue';
  questionPromptActions.appendChild(questionPromptSubmit);
  questionPromptForm.appendChild(questionPromptActions);

  questionPrompt.appendChild(questionPromptTitle);
  questionPrompt.appendChild(questionPromptForm);

  /* ── Composer ── */
  const composer = document.createElement('form');
  composer.className = 'composer';

  const composerRow = document.createElement('div');
  composerRow.className = 'composerRow';

  const composerTextarea = document.createElement('textarea');
  composerTextarea.rows = 1;
  composerTextarea.placeholder = `Ask ${agentName} to act on this website...`;
  composerRow.appendChild(composerTextarea);

  const composerActions = document.createElement('div');
  composerActions.className = 'composerActions';

  const voiceButton = document.createElement('button');
  voiceButton.type = 'button';
  voiceButton.className = 'voiceBtn';
  voiceButton.setAttribute('aria-label', 'Start voice dictation');
  voiceButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v3"></path><path d="M8 21h8"></path></svg>';
  composerActions.appendChild(voiceButton);

  const sendButton = document.createElement('button');
  sendButton.type = 'submit';
  sendButton.className = 'sendBtn';
  sendButton.innerHTML = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  composerActions.appendChild(sendButton);

  composerRow.appendChild(composerActions);
  composer.appendChild(composerRow);

  const composerStatus = document.createElement('div');
  composerStatus.className = 'composerStatus';
  composerStatus.setAttribute('aria-live', 'polite');
  composer.appendChild(composerStatus);

  /* ── Resize Handle ── */
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resizeHandle';
  resizeHandle.setAttribute('aria-hidden', 'true');

  /* ── Conversation Pill (replaces tab bar) ── */
  const conversationPill = document.createElement('div');
  conversationPill.className = 'roverConversationPill';
  conversationPill.setAttribute('role', 'button');
  conversationPill.setAttribute('tabindex', '0');
  const conversationPillLabel = document.createElement('span');
  conversationPillLabel.className = 'roverConversationPillLabel';
  conversationPillLabel.textContent = 'Current task';
  const conversationPillArrow = document.createElement('span');
  conversationPillArrow.className = 'roverConversationPillArrow';
  conversationPillArrow.textContent = '\u25BE'; // ▾
  conversationPill.appendChild(conversationPillLabel);
  conversationPill.appendChild(conversationPillArrow);
  conversationPill.addEventListener('click', () => {
    conversationDrawer.classList.toggle('open');
  });

  /* ── Tab Bar (hidden — kept for backward compat, not appended to DOM) ── */
  const tabBar = document.createElement('div');
  tabBar.className = 'roverTabBar';

  /* ── Paused Task Banner ── */
  const pausedTaskBanner = document.createElement('div');
  pausedTaskBanner.className = 'pausedTaskBanner';
  let pausedTaskId = '';

  /* ── Conversation Drawer ── */
  const conversationDrawer = document.createElement('div');
  conversationDrawer.className = 'conversationDrawer';

  const conversationDrawerHeader = document.createElement('div');
  conversationDrawerHeader.className = 'conversationDrawerHeader';
  const conversationDrawerTitle = document.createElement('span');
  conversationDrawerTitle.className = 'conversationDrawerTitle';
  conversationDrawerTitle.textContent = 'Conversations';
  const conversationDrawerCloseBtn = document.createElement('button');
  conversationDrawerCloseBtn.type = 'button';
  conversationDrawerCloseBtn.className = 'conversationDrawerClose';
  conversationDrawerCloseBtn.textContent = '\u00D7';
  conversationDrawerHeader.appendChild(conversationDrawerTitle);
  conversationDrawerHeader.appendChild(conversationDrawerCloseBtn);

  const conversationList = document.createElement('div');
  conversationList.className = 'conversationList';

  const conversationNewBtn = document.createElement('button');
  conversationNewBtn.type = 'button';
  conversationNewBtn.className = 'conversationNewBtn';
  conversationNewBtn.textContent = 'New conversation';

  conversationDrawer.appendChild(conversationDrawerHeader);
  conversationDrawer.appendChild(conversationList);
  conversationDrawer.appendChild(conversationNewBtn);

  panel.appendChild(header);
  panel.appendChild(conversationPill);
  panel.appendChild(pausedTaskBanner);
  panel.appendChild(feedWrapper);
  panel.appendChild(taskSuggestion);
  panel.appendChild(shortcutsBar);
  panel.appendChild(questionPrompt);
  panel.appendChild(composer);
  panel.appendChild(resizeHandle);
  panel.appendChild(conversationDrawer);

  wrapper.appendChild(launcher);
  wrapper.appendChild(greetingBubble);
  wrapper.appendChild(panel);
  shadow.appendChild(style);
  shadow.appendChild(wrapper);

  const inputEl = composerTextarea;
  const taskSuggestionTextEl = taskSuggestion.querySelector('.taskSuggestionText') as HTMLDivElement;
  const taskSuggestionPrimaryBtn = taskSuggestion.querySelector('.taskSuggestionBtn.primary') as HTMLButtonElement;
  const taskSuggestionSecondaryBtn = taskSuggestion.querySelector('.taskSuggestionBtn.secondary') as HTMLButtonElement;

  const seenTimelineIds = new Set<string>();
  const traceEntries = new Map<string, HTMLDivElement>();
  const traceOrder: HTMLDivElement[] = [];

  let currentMode: RoverExecutionMode = 'controller';
  let canComposeInObserver = false;
  let isRunning = false;
  let hasMessages = false;
  let currentShortcuts: RoverShortcut[] = opts.shortcuts?.slice(0, SHORTCUTS_RENDER_LIMIT) || [];
  let pendingConfirmAction: 'new_task' | 'end_task' | null = null;
  let traceExpanded = false;
  let moodResetTimer: number | null = null;
  let overflowOpen = false;
  let userScrolledUp = false;
  let lastAutoScrollTs = 0;
  let greetingShown = false;
  let greetingDismissTimer: ReturnType<typeof setTimeout> | null = null;
  let greetingRevealTimer: ReturnType<typeof setTimeout> | null = null;
  let waitingForFirstModelSignal = false;
  let currentQuestionPrompt: { questions: RoverAskUserQuestion[] } | null = null;
  let questionPromptSignature: string | null = null;
  let questionDraftAnswers: Record<string, string> = {};
  let voiceConfig = sanitizeVoiceConfig(opts.voice);
  let voiceState: 'idle' | 'listening' | 'error' = 'idle';
  let voiceErrorMessage = '';
  let voiceDraftBase = '';
  let voiceFinalTranscript = '';
  let voiceInterimTranscript = '';
  let pendingVoiceSubmit = false;
  let voiceStopReason: 'manual' | 'submit' | 'typed' | 'silence' | 'disabled' | 'config' | 'no_speech' | 'error' | null = null;
  let voiceStopTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceSessionTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceSessionStartedAt = 0;
  let voiceHasSpeech = false;
  let voiceSpeechActive = false;
  let voicePreSpeechRestartCount = 0;
  let voiceLastError: VoiceRecognitionError | null = null;
  let voiceErrorTelemetrySent = false;
  let voiceStartTelemetryPending = false;
  let reportedVoiceProviderKey = '';

  function emitVoiceTelemetry(event: RoverVoiceTelemetryEvent, payload?: Record<string, unknown>): void {
    opts.onVoiceTelemetry?.(event, payload);
  }

  function setComposerText(value: string): void {
    inputEl.value = value;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(96, Math.max(44, inputEl.scrollHeight))}px`;
  }

  function setComposerStatusMessage(message = '', tone: 'info' | 'error' = 'info'): void {
    const clean = sanitizeText(message);
    composerStatus.textContent = clean;
    composerStatus.classList.toggle('visible', !!clean);
    composerStatus.classList.toggle('error', tone === 'error' && !!clean);
  }

  function clearVoiceStopTimer(): void {
    if (!voiceStopTimer) return;
    clearTimeout(voiceStopTimer);
    voiceStopTimer = null;
  }

  function clearVoiceGraceTimer(): void {
    if (!voiceGraceTimer) return;
    clearTimeout(voiceGraceTimer);
    voiceGraceTimer = null;
  }

  function clearVoiceSessionTimer(): void {
    if (!voiceSessionTimer) return;
    clearTimeout(voiceSessionTimer);
    voiceSessionTimer = null;
  }

  function clearVoiceRestartTimer(): void {
    if (!voiceRestartTimer) return;
    clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }

  function resetVoiceDraftState(): void {
    voiceDraftBase = '';
    voiceFinalTranscript = '';
    voiceInterimTranscript = '';
  }

  function resetVoiceSessionState(): void {
    clearVoiceStopTimer();
    clearVoiceGraceTimer();
    clearVoiceSessionTimer();
    clearVoiceRestartTimer();
    voiceSessionStartedAt = 0;
    voiceHasSpeech = false;
    voiceSpeechActive = false;
    voicePreSpeechRestartCount = 0;
    voiceLastError = null;
    voiceErrorTelemetrySent = false;
    voiceStartTelemetryPending = false;
  }

  function buildVoiceDraft(): string {
    return composeVoiceDraft(voiceDraftBase, voiceFinalTranscript, voiceInterimTranscript);
  }

  function applyVoiceDraft(): void {
    setComposerText(buildVoiceDraft());
  }

  function getVoiceAutoStopMs(): number {
    return normalizeVoiceAutoStopMs(voiceConfig?.autoStopMs);
  }

  function getVoiceSessionDurationMs(): number {
    if (!voiceSessionStartedAt) return 0;
    return Math.max(0, Date.now() - voiceSessionStartedAt);
  }

  function buildVoiceTelemetryContext(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      hadSpeech: voiceHasSpeech,
      restartCount: voicePreSpeechRestartCount,
      durationMs: getVoiceSessionDurationMs(),
      autoStopMs: getVoiceAutoStopMs(),
      ...(extra || {}),
    };
  }

  function emitVoiceErrorTelemetry(error: VoiceRecognitionError): void {
    if (!voiceErrorTelemetrySent) {
      emitVoiceTelemetry('voice_error', buildVoiceTelemetryContext({
        code: error.code,
        recoverable: error.recoverable,
      }));
      voiceErrorTelemetrySent = true;
    }
    if (error.code === 'permission_denied') {
      emitVoiceTelemetry('voice_permission_denied', buildVoiceTelemetryContext({
        code: error.code,
      }));
    }
  }

  function reportVoiceProviderSelection(): void {
    if (voiceConfig?.enabled !== true) {
      reportedVoiceProviderKey = '';
      return;
    }
    const supported = voiceProvider.isSupported();
    const nextKey = `${supported ? 'browser' : 'unsupported'}|${voiceConfig.language || ''}|${getVoiceAutoStopMs()}`;
    if (reportedVoiceProviderKey === nextKey) return;
    reportedVoiceProviderKey = nextKey;
    emitVoiceTelemetry('voice_provider_selected', {
      provider: supported ? 'browser' : 'unsupported',
      supported,
    });
  }

  function syncVoiceUi(): void {
    const enabled = voiceConfig?.enabled === true;
    const supported = voiceProvider.isSupported();
    voiceButton.classList.toggle('visible', enabled && supported);
    voiceButton.classList.toggle('active', voiceState === 'listening');
    voiceButton.disabled = inputEl.disabled;
    voiceButton.setAttribute('aria-pressed', voiceState === 'listening' ? 'true' : 'false');
    voiceButton.setAttribute(
      'aria-label',
      voiceState === 'listening' ? 'Stop voice dictation' : 'Start voice dictation',
    );

    if (voiceState === 'error' && voiceErrorMessage) {
      setComposerStatusMessage(voiceErrorMessage, 'error');
      return;
    }
    if (voiceState === 'listening') {
      setComposerStatusMessage(
        voiceHasSpeech
          ? "Listening. Pause briefly when you're done."
          : "Listening. Start speaking when you're ready.",
      );
      return;
    }
    if (enabled && !supported) {
      setComposerStatusMessage('Voice dictation is not available in this browser.');
      return;
    }
    setComposerStatusMessage('');
  }

  function stopVoiceDictation(
    reason: 'manual' | 'submit' | 'typed' | 'silence' | 'disabled' | 'config' | 'no_speech' | 'error',
    options?: { resetDraftBase?: boolean },
  ): void {
    if (voiceState !== 'listening') {
      if (options?.resetDraftBase) {
        resetVoiceDraftState();
        resetVoiceSessionState();
      }
      return;
    }
    clearVoiceStopTimer();
    clearVoiceGraceTimer();
    clearVoiceSessionTimer();
    clearVoiceRestartTimer();
    voiceStopReason = reason;
    voiceProvider.stop();
    if (options?.resetDraftBase) {
      resetVoiceDraftState();
    }
  }

  function canRestartVoiceBeforeSpeech(error?: VoiceRecognitionError | null): boolean {
    if (voiceState !== 'listening' || voiceHasSpeech) return false;
    if (voiceStopReason) return false;
    if (voicePreSpeechRestartCount >= VOICE_MAX_PRE_SPEECH_RESTARTS) return false;
    const durationMs = getVoiceSessionDurationMs();
    if (durationMs >= VOICE_INITIAL_SPEECH_GRACE_MS || durationMs >= VOICE_MAX_SESSION_MS) return false;
    if (!error) return true;
    return error.code === 'no_speech' || error.code === 'aborted' || error.code === 'unknown';
  }

  function scheduleVoiceGraceTimeout(): void {
    if (voiceState !== 'listening' || voiceHasSpeech || !voiceSessionStartedAt) return;
    clearVoiceGraceTimer();
    const remainingMs = VOICE_INITIAL_SPEECH_GRACE_MS - getVoiceSessionDurationMs();
    if (remainingMs <= 0) {
      const error = voiceLastError && voiceLastError.code === 'no_speech'
        ? voiceLastError
        : createNoSpeechVoiceError();
      voiceStopReason = 'no_speech';
      voiceState = 'error';
      voiceErrorMessage = error.message;
      emitVoiceErrorTelemetry(error);
      syncVoiceUi();
      voiceProvider.stop();
      return;
    }
    voiceGraceTimer = setTimeout(() => {
      if (voiceState !== 'listening' || voiceHasSpeech) return;
      const error = createNoSpeechVoiceError();
      voiceLastError = error;
      voiceStopReason = 'no_speech';
      voiceState = 'error';
      voiceErrorMessage = error.message;
      emitVoiceErrorTelemetry(error);
      syncVoiceUi();
      voiceProvider.stop();
    }, remainingMs);
  }

  function scheduleVoiceSessionTimeout(): void {
    if (voiceState !== 'listening' || !voiceSessionStartedAt) return;
    clearVoiceSessionTimer();
    const remainingMs = VOICE_MAX_SESSION_MS - getVoiceSessionDurationMs();
    if (remainingMs <= 0) {
      if (voiceHasSpeech) {
        stopVoiceDictation('silence');
      } else {
        const error = createNoSpeechVoiceError();
        voiceLastError = error;
        voiceStopReason = 'no_speech';
        voiceState = 'error';
        voiceErrorMessage = error.message;
        emitVoiceErrorTelemetry(error);
        syncVoiceUi();
        voiceProvider.stop();
      }
      return;
    }
    voiceSessionTimer = setTimeout(() => {
      if (voiceState !== 'listening') return;
      if (voiceHasSpeech) {
        stopVoiceDictation('silence');
        return;
      }
      const error = createNoSpeechVoiceError();
      voiceLastError = error;
      voiceStopReason = 'no_speech';
      voiceState = 'error';
      voiceErrorMessage = error.message;
      emitVoiceErrorTelemetry(error);
      syncVoiceUi();
      voiceProvider.stop();
    }, remainingMs);
  }

  function scheduleVoiceStop(): void {
    if (voiceState !== 'listening' || !voiceHasSpeech || voiceSpeechActive) return;
    clearVoiceStopTimer();
    voiceStopTimer = setTimeout(() => {
      if (voiceState !== 'listening') return;
      stopVoiceDictation('silence');
    }, getVoiceAutoStopMs());
  }

  function scheduleVoiceRestart(): void {
    if (!canRestartVoiceBeforeSpeech(voiceLastError)) return;
    clearVoiceRestartTimer();
    voicePreSpeechRestartCount += 1;
    voiceLastError = null;
    scheduleVoiceGraceTimeout();
    scheduleVoiceSessionTimeout();
    voiceRestartTimer = setTimeout(() => {
      voiceRestartTimer = null;
      if (voiceState !== 'listening' || voiceHasSpeech || voiceStopReason) return;
      voiceProvider.start({ language: voiceConfig?.language });
    }, VOICE_RESTART_DELAY_MS);
  }

  function handleVoiceError(error: VoiceRecognitionError): void {
    voiceLastError = error;
    if (
      voiceStopReason
      && (error.code === 'aborted' || error.code === 'no_speech' || error.code === 'unknown')
    ) {
      return;
    }
    if (
      error.code === 'aborted'
      || error.code === 'no_speech'
      || error.code === 'unknown'
    ) {
      return;
    }
    clearVoiceStopTimer();
    clearVoiceGraceTimer();
    clearVoiceRestartTimer();
    voiceState = 'error';
    voiceErrorMessage = error.message;
    voiceStopReason = 'error';
    syncVoiceUi();
    emitVoiceErrorTelemetry(error);
  }

  function submitComposerDraft(): void {
    if (inputEl.disabled) return;
    const text = sanitizeText(inputEl.value);
    if (!text) return;
    setTaskSuggestion({ visible: false });
    opts.onSend(text);
    setComposerText('');
    voiceErrorMessage = '';
    voiceState = 'idle';
    resetVoiceDraftState();
    resetVoiceSessionState();
    pendingVoiceSubmit = false;
    voiceStopReason = null;
    syncVoiceUi();
  }

  function startVoiceDictation(): void {
    if (inputEl.disabled) return;
    if (!voiceConfig?.enabled) return;
    if (!voiceProvider.isSupported()) {
      voiceState = 'error';
      voiceErrorMessage = 'Voice dictation is not available in this browser.';
      syncVoiceUi();
      return;
    }
    reportVoiceProviderSelection();
    voiceErrorMessage = '';
    voiceState = 'listening';
    pendingVoiceSubmit = false;
    voiceStopReason = null;
    voiceDraftBase = inputEl.value;
    voiceFinalTranscript = '';
    voiceInterimTranscript = '';
    resetVoiceSessionState();
    voiceSessionStartedAt = Date.now();
    voiceStartTelemetryPending = true;
    scheduleVoiceGraceTimeout();
    scheduleVoiceSessionTimeout();
    syncVoiceUi();
    voiceProvider.start({ language: voiceConfig.language });
  }

  function setVoiceConfig(nextVoice?: RoverVoiceConfig): void {
    const nextConfig = sanitizeVoiceConfig(nextVoice);
    const previousSignature = JSON.stringify(voiceConfig || null);
    const nextSignature = JSON.stringify(nextConfig || null);
    if (previousSignature === nextSignature) {
      syncVoiceUi();
      return;
    }
    voiceConfig = nextConfig;
    voiceErrorMessage = '';
    pendingVoiceSubmit = false;
    if (voiceState === 'listening') {
      stopVoiceDictation('config');
    } else {
      resetVoiceDraftState();
      resetVoiceSessionState();
      voiceState = 'idle';
    }
    reportVoiceProviderSelection();
    syncVoiceUi();
  }

  const voiceProvider: VoiceTranscriber = createBrowserVoiceTranscriber({
    onStart: () => {
      voiceState = 'listening';
      voiceErrorMessage = '';
      voiceLastError = null;
      scheduleVoiceGraceTimeout();
      scheduleVoiceSessionTimeout();
      if (voiceStartTelemetryPending) {
        emitVoiceTelemetry('voice_started', buildVoiceTelemetryContext({
          provider: 'browser',
        }));
        voiceStartTelemetryPending = false;
      }
      syncVoiceUi();
    },
    onSpeechStart: () => {
      if (voiceState !== 'listening') return;
      voiceHasSpeech = true;
      voiceSpeechActive = true;
      voiceLastError = null;
      clearVoiceGraceTimer();
      clearVoiceStopTimer();
      syncVoiceUi();
    },
    onSpeechEnd: () => {
      if (voiceState !== 'listening') return;
      voiceSpeechActive = false;
      if (voiceHasSpeech) {
        scheduleVoiceStop();
      }
      syncVoiceUi();
    },
    onResult: ({ finalTranscript, interimTranscript }) => {
      const hadTranscriptActivity = !!(finalTranscript || interimTranscript);
      if (hadTranscriptActivity) {
        voiceHasSpeech = true;
        voiceSpeechActive = interimTranscript.length > 0;
        voiceLastError = null;
        clearVoiceGraceTimer();
        clearVoiceStopTimer();
      }
      voiceFinalTranscript = finalTranscript;
      voiceInterimTranscript = interimTranscript;
      applyVoiceDraft();
      if (voiceHasSpeech && !voiceSpeechActive) {
        scheduleVoiceStop();
      }
      syncVoiceUi();
    },
    onEnd: ({ requested }) => {
      clearVoiceRestartTimer();
      if (!requested && canRestartVoiceBeforeSpeech(voiceLastError)) {
        scheduleVoiceRestart();
        return;
      }

      const finalDraft = sanitizeText(buildVoiceDraft());
      const hadExistingDraft = sanitizeText(voiceDraftBase).length > 0;
      const lastError = voiceLastError;
      let stoppedReason = voiceStopReason || (requested ? 'manual' : 'silence');
      clearVoiceStopTimer();
      clearVoiceGraceTimer();
      clearVoiceSessionTimer();
      if (!voiceHasSpeech && !requested && voiceState !== 'error') {
        const error = lastError && lastError.code === 'no_speech'
          ? lastError
          : createNoSpeechVoiceError();
        voiceState = 'error';
        voiceErrorMessage = error.message;
        voiceStopReason = 'no_speech';
        stoppedReason = 'no_speech';
        emitVoiceErrorTelemetry(error);
      } else if (!requested && !voiceStopReason && voiceHasSpeech) {
        stoppedReason = 'silence';
      } else if (voiceStopReason) {
        stoppedReason = voiceStopReason;
      }
      if (voiceState !== 'error') {
        voiceState = 'idle';
        voiceErrorMessage = '';
      }
      if (finalDraft) {
        emitVoiceTelemetry('voice_transcript_ready', buildVoiceTelemetryContext({
          chars: finalDraft.length,
          hadExistingDraft,
        }));
      }
      emitVoiceTelemetry('voice_stopped', buildVoiceTelemetryContext({
        reason: stoppedReason,
        stopReason: stoppedReason,
        requested,
        errorCode: lastError?.code,
      }));
      const shouldSubmit = pendingVoiceSubmit;
      pendingVoiceSubmit = false;
      voiceStopReason = null;
      resetVoiceDraftState();
      resetVoiceSessionState();
      syncVoiceUi();
      if (shouldSubmit) {
        submitComposerDraft();
      }
    },
    onError: handleVoiceError,
  });

  /* ── Overflow menu logic ── */
  function toggleOverflow(): void {
    overflowOpen = !overflowOpen;
    overflowMenu.classList.toggle('visible', overflowOpen);
  }

  function closeOverflow(): void {
    overflowOpen = false;
    overflowMenu.classList.remove('visible');
  }

  let lastShortcutsKey = '';

  function renderShortcuts(shortcuts: RoverShortcut[]): void {
    const filtered = shortcuts
      .filter(shortcut => shortcut && shortcut.enabled !== false)
      .slice(0, SHORTCUTS_RENDER_LIMIT);
    const key = filtered.map(sc => `${sc.id || sc.label}|${sc.label}|${sc.description || ''}|${sc.icon || ''}`).join(';;');
    if (key === lastShortcutsKey) return;
    lastShortcutsKey = key;
    currentShortcuts = filtered;

    // Render empty-state cards
    shortcutsGrid.innerHTML = '';
    for (const sc of currentShortcuts) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shortcutCard';
      if (sc.icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'shortcutCardIcon';
        iconEl.textContent = sc.icon;
        card.appendChild(iconEl);
      }
      const labelEl = document.createElement('span');
      labelEl.className = 'shortcutCardLabel';
      labelEl.textContent = sc.label;
      card.appendChild(labelEl);
      if (sc.description) {
        const descEl = document.createElement('span');
        descEl.className = 'shortcutCardDesc';
        descEl.textContent = sc.description;
        card.appendChild(descEl);
      }
      card.addEventListener('click', () => opts.onShortcutClick?.(sc));
      shortcutsGrid.appendChild(card);
    }

    // Render compact chips
    shortcutsBar.innerHTML = '';
    for (const sc of currentShortcuts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'shortcutChip';
      if (sc.icon) {
        const chipIcon = document.createElement('span');
        chipIcon.className = 'shortcutChipIcon';
        chipIcon.textContent = sc.icon;
        chip.appendChild(chipIcon);
      }
      const chipLabel = document.createTextNode(sc.label);
      chip.appendChild(chipLabel);
      chip.addEventListener('click', () => opts.onShortcutClick?.(sc));
      shortcutsBar.appendChild(chip);
    }

    syncShortcutsVisibility();
  }

  function syncShortcutsVisibility(): void {
    const hasShortcuts = currentShortcuts.length > 0;
    const hasQuestionPrompt = !!currentQuestionPrompt?.questions?.length;
    const showEmpty = hasShortcuts && !hasMessages && !isRunning;
    const showChips = hasShortcuts && hasMessages && !isRunning && !hasQuestionPrompt;
    shortcutsEmptyState.classList.toggle('visible', showEmpty);
    shortcutsBar.classList.toggle('visible', showChips);
  }

  function showGreeting(text: string): void {
    const cleanText = sanitizeText(text);
    if (!cleanText) return;
    greetingText.textContent = cleanText;
    if (greetingBubble.classList.contains('visible')) {
      greetingBubble.classList.add('textVisible');
      return;
    }
    if (greetingShown) return;
    if (panel.classList.contains('open')) return;
    greetingShown = true;
    greetingBubble.classList.remove('dismissing', 'textVisible');
    greetingBubble.classList.add('visible');
    if (greetingRevealTimer) {
      clearTimeout(greetingRevealTimer);
      greetingRevealTimer = null;
    }
    greetingRevealTimer = setTimeout(() => {
      greetingRevealTimer = null;
      greetingBubble.classList.add('textVisible');
    }, GREETING_REVEAL_DELAY_MS);
  }

  function dismissGreeting(): void {
    if (greetingRevealTimer) {
      clearTimeout(greetingRevealTimer);
      greetingRevealTimer = null;
    }
    if (!greetingBubble.classList.contains('visible')) return;
    greetingBubble.classList.add('dismissing');
    const onEnd = () => {
      greetingBubble.classList.remove('visible', 'dismissing');
      greetingBubble.removeEventListener('animationend', onEnd);
    };
    greetingBubble.addEventListener('animationend', onEnd);
    if (greetingDismissTimer) { clearTimeout(greetingDismissTimer); greetingDismissTimer = null; }
  }

  function setVisitorName(name: string): void {
    visitorName = name || undefined;
    if (visitorName) {
      shortcutsHeading.textContent = `Hey ${visitorName}! What can I help with?`;
    } else {
      shortcutsHeading.textContent = `What can ${agentName} help you with?`;
    }
  }

  function normalizeQuestionPrompt(prompt?: { questions: RoverAskUserQuestion[] }): RoverAskUserQuestion[] {
    if (!prompt || !Array.isArray(prompt.questions)) return [];
    const out: RoverAskUserQuestion[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < prompt.questions.length; i += 1) {
      const item = prompt.questions[i];
      if (!item || typeof item !== 'object') continue;
      const key = String(item.key || item.id || '').trim() || `clarification_${i + 1}`;
      const query = String(item.query || item.question || '').trim();
      if (!query) continue;
      const hasRequired = typeof (item as any).required === 'boolean';
      const hasOptional = typeof (item as any).optional === 'boolean';
      const required = hasRequired ? !!(item as any).required : (hasOptional ? !(item as any).optional : true);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        query,
        ...(typeof item.id === 'string' && item.id.trim() ? { id: item.id.trim() } : {}),
        ...(typeof item.question === 'string' && item.question.trim() ? { question: item.question.trim() } : {}),
        ...(Array.isArray(item.choices) ? { choices: item.choices } : {}),
        required,
      });
    }
    return out.slice(0, 6);
  }

  function buildQuestionPromptSignature(questions: RoverAskUserQuestion[]): string {
    return questions
      .map((question) => {
        const choices = Array.isArray(question.choices)
          ? question.choices.map(choice => sanitizeText(String(choice || ''))).filter(Boolean).join('|')
          : '';
        const required = question.required === false ? 'optional' : 'required';
        return `${question.key}::${sanitizeText(question.query)}::${choices}::${required}`;
      })
      .join('||');
  }

  function buildQuestionPlaceholder(question: RoverAskUserQuestion): string {
    const query = sanitizeText(question.query || question.question || '');
    if (!query) return `Answer for ${question.key}`;
    const compact = query
      .replace(/\s+/g, ' ')
      .replace(/[?.!:\s]+$/, '')
      .slice(0, 72);
    if (!compact) return `Answer for ${question.key}`;
    return `Answer: ${compact}`;
  }

  function getQuestionInputByKey(key: string): HTMLInputElement | null {
    for (const node of Array.from(questionPromptForm.querySelectorAll('.questionPromptInput'))) {
      const input = node as HTMLInputElement;
      if (input.dataset.key === key) return input;
    }
    return null;
  }

  function setQuestionPrompt(prompt?: { questions: RoverAskUserQuestion[] }): void {
    const questions = normalizeQuestionPrompt(prompt);
    const activeElement = document.activeElement as HTMLElement | null;
    const wasFocusedInput = activeElement instanceof HTMLInputElement
      && activeElement.classList.contains('questionPromptInput')
      && questionPrompt.contains(activeElement)
      ? activeElement
      : null;
    const focusedQuestionKey = wasFocusedInput?.dataset.key;
    const focusedSelectionStart = wasFocusedInput?.selectionStart ?? null;
    const focusedSelectionEnd = wasFocusedInput?.selectionEnd ?? null;

    if (!questions.length) {
      currentQuestionPrompt = null;
      questionPromptSignature = null;
      questionDraftAnswers = {};
      questionPromptList.innerHTML = '';
      questionPrompt.classList.remove('visible');
      syncShortcutsVisibility();
      return;
    }

    const signature = buildQuestionPromptSignature(questions);
    const shouldRebuild = signature !== questionPromptSignature || !currentQuestionPrompt;
    currentQuestionPrompt = { questions };

    if (shouldRebuild) {
      const previousDraftAnswers = questionDraftAnswers;
      questionDraftAnswers = {};
      questionPromptList.innerHTML = '';

      for (const question of currentQuestionPrompt.questions) {
        const item = document.createElement('label');
        item.className = 'questionPromptItem';

        const label = document.createElement('span');
        label.className = 'questionPromptLabel';
        label.textContent = question.required === false ? `${question.query} (optional)` : question.query;
        item.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'questionPromptInput';
        input.dataset.key = question.key;
        input.placeholder = buildQuestionPlaceholder(question);
        input.required = question.required !== false;
        const draftValue = String(previousDraftAnswers[question.key] || '');
        questionDraftAnswers[question.key] = draftValue;
        input.value = draftValue;
        input.addEventListener('input', () => {
          questionDraftAnswers[question.key] = input.value;
          input.classList.remove('invalid');
        });
        item.appendChild(input);

        questionPromptList.appendChild(item);
      }
      questionPromptSignature = signature;
    }

    questionPrompt.classList.add('visible');
    syncComposerDisabledState();
    syncShortcutsVisibility();

    if (focusedQuestionKey) {
      const input = getQuestionInputByKey(focusedQuestionKey);
      if (input) {
        input.focus();
        if (focusedSelectionStart !== null || focusedSelectionEnd !== null) {
          const start = focusedSelectionStart ?? input.value.length;
          const end = focusedSelectionEnd ?? start;
          try {
            input.setSelectionRange(start, end);
          } catch {
            // no-op
          }
        }
        return;
      }
    }

    if (shouldRebuild) {
      const firstUnanswered = currentQuestionPrompt.questions.find(
        question => !sanitizeText(questionDraftAnswers[question.key] || ''),
      );
      const targetKey = firstUnanswered?.key || currentQuestionPrompt.questions[0]?.key;
      if (!targetKey) return;
      const nextInput = getQuestionInputByKey(targetKey);
      const shouldAutoFocusQuestion =
        !activeElement
        || activeElement === document.body
        || !panel.contains(activeElement);
      if (nextInput && shouldAutoFocusQuestion) nextInput.focus();
    }
  }

  function syncProcessingIndicator(): void {
    const shouldShow = isRunning && waitingForFirstModelSignal;
    if (shouldShow) {
      typingIndicator.classList.add('visible');
      feed.appendChild(typingIndicator);
      smartScrollToBottom();
    } else {
      typingIndicator.classList.remove('visible');
    }
  }

  function setMascotMood(mood: 'idle' | 'typing' | 'running' | 'success' | 'error', holdMs = 0): void {
    wrapper.dataset.mood = mood;
    if (moodResetTimer != null) {
      window.clearTimeout(moodResetTimer);
      moodResetTimer = null;
    }

    if (holdMs > 0 && mood !== 'idle') {
      moodResetTimer = window.setTimeout(() => {
        wrapper.dataset.mood = 'idle';
        syncProcessingIndicator();
        moodResetTimer = null;
      }, holdMs);
    }
  }

  /* ── Step 9: Smart Auto-Scroll ── */
  function isNearBottom(): boolean {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  }

  function smartScrollToBottom(): void {
    if (!userScrolledUp) {
      requestAnimationFrame(() => {
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
        lastAutoScrollTs = Date.now();
      });
      scrollBtn.classList.remove('visible');
    } else {
      scrollBtn.classList.add('visible');
    }
  }

  feed.addEventListener('scroll', () => {
    if (Date.now() - lastAutoScrollTs < 200) return;
    if (isNearBottom()) {
      userScrolledUp = false;
      scrollBtn.classList.remove('visible');
    } else {
      userScrolledUp = true;
      scrollBtn.classList.add('visible');
    }
  }, { passive: true });

  scrollBtn.addEventListener('click', () => {
    userScrolledUp = false;
    lastAutoScrollTs = Date.now();
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    scrollBtn.classList.remove('visible');
  });

  function syncComposerDisabledState(): void {
    const disabled = currentMode === 'observer' && !canComposeInObserver;
    inputEl.disabled = disabled;
    voiceButton.disabled = disabled;
    questionPromptCancel.disabled = disabled;
    questionPromptSubmit.disabled = disabled;
    for (const node of Array.from(questionPromptForm.querySelectorAll('.questionPromptInput'))) {
      (node as HTMLInputElement).disabled = disabled;
    }
    if (disabled && voiceState === 'listening') {
      stopVoiceDictation('disabled');
    }
    syncVoiceUi();
  }

  function setTraceExpanded(next: boolean): void {
    traceExpanded = next;
    wrapper.dataset.showDetails = next ? 'true' : 'false';
    traceToggleBtn.textContent = traceExpanded ? 'Collapse' : `Show all (${traceOrder.length})`;
    if (traceExpanded) {
      // Show all trace entries
      for (const item of traceOrder) {
        item.style.display = '';
        const status = item.dataset.status;
        const done = status === 'success' || status === 'error' || status === 'info';
        item.classList.toggle('compact', false);
      }
    } else {
      // Show only latest 2 trace entries, hide older ones
      for (let i = 0; i < traceOrder.length; i++) {
        const item = traceOrder[i];
        const isRecent = i >= traceOrder.length - 2;
        item.style.display = isRecent ? '' : 'none';
        const status = item.dataset.status;
        const done = status === 'success' || status === 'error' || status === 'info';
        item.classList.toggle('compact', done);
      }
    }
  }

  /* ── Step 5: Panel open/close with animation ── */
  function open(): void {
    wrapper.style.display = '';
    panel.classList.remove('closing');
    panel.classList.add('open');
    dismissGreeting();
    setMascotMood('idle');
    opts.onOpen?.();
    if (!inputEl.disabled) inputEl.focus();
  }

  function close(): void {
    closeOverflow();
    if (!panel.classList.contains('open')) {
      opts.onClose?.();
      return;
    }
    panel.classList.remove('open');
    panel.classList.add('closing');
    setMascotMood('idle');

    const onEnd = () => {
      panel.classList.remove('closing');
      panel.removeEventListener('animationend', onEnd);
    };
    panel.addEventListener('animationend', onEnd);
    opts.onClose?.();
  }

  function show(): void {
    wrapper.style.display = '';
  }

  function hide(): void {
    close();
    wrapper.style.display = 'none';
  }

  function addMessage(role: 'user' | 'assistant' | 'system', text: string, options?: { blocks?: RoverMessageBlock[] }): void {
    const clean = sanitizeText(text);
    const blocks = options?.blocks;
    if (!clean && (!blocks || blocks.length === 0)) return;

    const entry = document.createElement('div');
    entry.className = `entry message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'assistant') {
      bubble.appendChild(renderAssistantMessageContent(clean, blocks));
    } else {
      bubble.textContent = clean;
    }

    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.textContent = formatTime(Date.now());

    entry.appendChild(bubble);
    entry.appendChild(stamp);
    feed.appendChild(entry);
    if (role === 'assistant' && isRunning && waitingForFirstModelSignal) {
      waitingForFirstModelSignal = false;
      syncProcessingIndicator();
    }
    hasMessages = true;
    syncShortcutsVisibility();
    if (role === 'user') setMascotMood('typing', 1200);
    else if (role === 'assistant') setMascotMood('success', 1400);
    else setMascotMood('running', 900);
    smartScrollToBottom();
  }

  function clearMessages(): void {
    for (const node of Array.from(feed.querySelectorAll('.entry.message'))) {
      node.remove();
    }
    hasMessages = false;
    setQuestionPrompt(undefined);
    syncShortcutsVisibility();
  }

  function ensureTraceEntry(key: string): HTMLDivElement {
    const existing = traceEntries.get(key);
    if (existing) return existing;

    const entry = document.createElement('div');
    entry.className = 'entry trace pending';

    const top = document.createElement('div');
    top.className = 'traceTop';

    const traceMeta = document.createElement('div');
    traceMeta.className = 'traceMeta';

    const stage = document.createElement('span');
    stage.className = 'traceStage';
    stage.textContent = 'step';

    const title = document.createElement('div');
    title.className = 'traceTitle';

    const ts = document.createElement('div');
    ts.className = 'traceTs';

    traceMeta.appendChild(stage);
    traceMeta.appendChild(title);
    top.appendChild(traceMeta);
    top.appendChild(ts);

    const detail = document.createElement('div');
    detail.className = 'traceDetail';

    entry.appendChild(top);
    entry.appendChild(detail);

    traceEntries.set(key, entry);
    traceOrder.push(entry);
    feed.appendChild(entry);
    return entry;
  }

  function updateTraceEntry(entry: HTMLDivElement, event: RoverTimelineEvent): void {
    const ts = Number(event.ts) || Date.now();
    const status = normalizeTimelineStatus(event);
    const top = entry.querySelector('.traceTop') as HTMLDivElement;
    const traceMeta = top.querySelector('.traceMeta') as HTMLDivElement;
    const stageEl = traceMeta.querySelector('.traceStage') as HTMLSpanElement;
    const title = top.querySelector('.traceTitle') as HTMLDivElement;
    const tsEl = top.querySelector('.traceTs') as HTMLDivElement;
    const detail = entry.querySelector('.traceDetail') as HTMLDivElement;
    const parsed = parseStageFromTitle(event.title || '');

    title.textContent = parsed.plainTitle || 'Step';
    stageEl.textContent = parsed.stage || event.kind || 'step';
    stageEl.style.display = parsed.stage || event.kind === 'status' || event.kind === 'plan' || event.kind === 'thought' ? '' : 'none';
    tsEl.textContent = formatTime(ts);

    detail.innerHTML = '';
    const detailBlocks = Array.isArray(event.detailBlocks) ? event.detailBlocks : [];
    const detailText = sanitizeText(event.detail || '');
    if (detailBlocks.length > 0) {
      for (const block of detailBlocks) {
        const node = renderMessageBlock(block);
        if (!node) continue;
        detail.appendChild(node);
      }
      if (detailText) {
        const line = document.createElement('div');
        line.className = 'rvLine';
        line.appendChild(renderRichContent(detailText));
        detail.insertBefore(line, detail.firstChild);
      }
      detail.style.display = '';
    } else if (detailText) {
      const threshold = event.kind === 'thought' ? EXPAND_THRESHOLD_THOUGHT
        : (event.kind === 'tool_start' || event.kind === 'tool_result') ? EXPAND_THRESHOLD_TOOL
        : EXPAND_THRESHOLD_OUTPUT;
      if (detailText.length > threshold) {
        detail.appendChild(createExpandableRichContent(detailText, threshold));
      } else {
        detail.appendChild(renderRichContent(detailText));
      }
      detail.style.display = '';
    } else {
      detail.style.display = 'none';
    }

    entry.classList.remove('pending', 'success', 'error', 'info');
    entry.classList.add(status);
    entry.dataset.status = status;
    entry.dataset.kind = event.kind;
    entry.dataset.visibility = classifyVisibility(event);

    const done = status === 'success' || status === 'error' || status === 'info';
    entry.classList.toggle('compact', !traceExpanded && done);
    if (status === 'error') setMascotMood('error', 2200);
    else if (status === 'success') setMascotMood('success', 1200);
    else if (status === 'pending') setMascotMood('running', 800);
  }

  function addTimelineEvent(event: RoverTimelineEvent): void {
    const title = sanitizeText(event.title || '');
    if (!title) return;

    if (title.toLowerCase() === 'assistant update') {
      return;
    }

    const id = event.id || createId('timeline');
    if (event.id && seenTimelineIds.has(id)) return;
    seenTimelineIds.add(id);

    const key = deriveTraceKey(event);
    const useStableKey =
      key === 'run' ||
      key.startsWith('tool:') ||
      event.kind === 'tool_result' ||
      (event.kind === 'status' && traceEntries.has(key));
    const entry = useStableKey ? ensureTraceEntry(key) : ensureTraceEntry(`${key}:${id}`);

    updateTraceEntry(entry, { ...event, title });
    if (event.kind === 'thought' && isRunning && waitingForFirstModelSignal) {
      waitingForFirstModelSignal = false;
      syncProcessingIndicator();
    }
    if (title.toLowerCase() === 'run completed') {
      setTraceExpanded(false);
    }

    // Update trace toggle bar
    const stepCount = traceOrder.length;
    traceToggleCount.textContent = `${stepCount} step${stepCount !== 1 ? 's' : ''}`;
    traceToggleBar.classList.toggle('visible', stepCount > 0);
    if (!traceExpanded) {
      traceToggleBtn.textContent = `Show all (${stepCount})`;
      // Keep only latest 2 visible when collapsed
      for (let i = 0; i < traceOrder.length; i++) {
        const item = traceOrder[i];
        const isRecent = i >= traceOrder.length - 2;
        item.style.display = isRecent ? '' : 'none';
      }
    }

    smartScrollToBottom();
  }

  function clearTimeline(): void {
    seenTimelineIds.clear();
    traceEntries.clear();
    traceOrder.length = 0;
    for (const node of Array.from(feed.querySelectorAll('.entry.trace'))) {
      node.remove();
    }
    traceToggleBar.classList.remove('visible');
    traceToggleCount.textContent = '0 steps';
  }

  function setTaskSuggestion(suggestion: RoverTaskSuggestion): void {
    const visible = !!suggestion?.visible;
    taskSuggestion.classList.toggle('visible', visible);
    taskSuggestionTextEl.textContent = suggestion?.text || 'Looks like a new request. Start a new task?';
    taskSuggestionPrimaryBtn.textContent = suggestion?.primaryLabel || 'Start new';
    taskSuggestionSecondaryBtn.textContent = suggestion?.secondaryLabel || 'Continue';
  }

  function setStatus(text: string): void {
    const clean = String(text || 'ready');
    statusText.textContent = clean;
    const lowered = clean.toLowerCase();
    if (lowered.includes('error') || lowered.includes('failed')) {
      setMascotMood('error', 1800);
    } else if (lowered === 'ready' || lowered.includes('complete')) {
      setMascotMood('idle');
    } else {
      setMascotMood('running', 1000);
    }
  }

  function setRunning(running: boolean): void {
    isRunning = running;
    if (running) {
      waitingForFirstModelSignal = true;
    } else {
      waitingForFirstModelSignal = false;
    }
    syncProcessingIndicator();
    cancelPill.classList.toggle('visible', running);
    conversationListBtn.style.display = running ? 'none' : '';
    overflowBtn.style.display = running ? 'none' : '';
    executionBar.classList.toggle('active', running);
    syncShortcutsVisibility();
  }

  function setExecutionMode(
    mode: RoverExecutionMode,
    executionMeta?: {
      controllerRuntimeId?: string;
      localLogicalTabId?: number;
      activeLogicalTabId?: number;
      canTakeControl?: boolean;
      canComposeInObserver?: boolean;
      note?: string;
    },
  ): void {
    currentMode = mode;
    canComposeInObserver = mode === 'observer' ? executionMeta?.canComposeInObserver === true : true;
    syncComposerDisabledState();

    modeLabel.classList.remove('controller', 'observer');
    modeLabel.classList.add(mode);

    if (mode === 'controller') {
      modeLabel.textContent = 'active';
      menuTakeControl.style.display = 'none';
      inputEl.placeholder = `Ask ${agentName} to act on this website...`;
    } else {
      modeLabel.textContent = 'observer';
      if (executionMeta?.canTakeControl !== false) {
        menuTakeControl.style.display = '';
      } else {
        menuTakeControl.style.display = 'none';
      }

      if (executionMeta?.note) {
        inputEl.placeholder = executionMeta.note;
      } else if (canComposeInObserver) {
        inputEl.placeholder = 'Send to take control and run here.';
      } else if (executionMeta?.activeLogicalTabId && executionMeta?.localLogicalTabId && executionMeta.activeLogicalTabId !== executionMeta.localLogicalTabId) {
        inputEl.placeholder = `Observing: ${agentName} is acting in tab #${executionMeta.activeLogicalTabId}`;
      } else {
        inputEl.placeholder = 'Observer mode. Take control to run actions here.';
      }
    }
  }

  function destroy(): void {
    if (moodResetTimer != null) {
      window.clearTimeout(moodResetTimer);
      moodResetTimer = null;
    }
    clearVoiceStopTimer();
    voiceProvider.dispose();
    if (greetingRevealTimer) {
      window.clearTimeout(greetingRevealTimer);
      greetingRevealTimer = null;
    }
    if (greetingDismissTimer) {
      window.clearTimeout(greetingDismissTimer);
      greetingDismissTimer = null;
    }
    document.removeEventListener('keydown', globalToggleHandler);
    fontStyle.remove();
    host.remove();
  }

  /* ── Event Listeners ── */
  launcher.addEventListener('click', () => {
    if (panel.classList.contains('open')) close();
    else open();
  });

  greetingClose.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissGreeting();
  });

  greetingBubble.addEventListener('click', () => {
    dismissGreeting();
    open();
  });

  closeBtn.addEventListener('click', () => close());

  overflowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOverflow();
  });

  /* Click outside closes overflow menu */
  wrapper.addEventListener('click', (e) => {
    if (overflowOpen && !overflowMenu.contains(e.target as Node) && e.target !== overflowBtn) {
      closeOverflow();
    }
  });

  menuNewTask.addEventListener('click', () => {
    closeOverflow();
    if (isRunning && opts.onCancelRun) {
      pendingConfirmAction = 'new_task';
      setTaskSuggestion({
        visible: true,
        text: 'A task is in progress. Cancel it and start new?',
        primaryLabel: 'Cancel & start new',
        secondaryLabel: 'Keep running',
      });
    } else {
      opts.onNewTask?.();
    }
  });

  menuEndTask.addEventListener('click', () => {
    closeOverflow();
    if (isRunning && opts.onCancelRun) {
      pendingConfirmAction = 'end_task';
      setTaskSuggestion({
        visible: true,
        text: 'A task is in progress. Cancel and end it?',
        primaryLabel: 'Cancel & end',
        secondaryLabel: 'Keep running',
      });
    } else {
      opts.onEndTask?.();
    }
  });

  menuTakeControl.addEventListener('click', () => {
    closeOverflow();
    opts.onRequestControl?.();
  });

  cancelPill.addEventListener('click', () => {
    opts.onCancelRun?.();
  });

  traceToggleBtn.addEventListener('click', () => {
    setTraceExpanded(!traceExpanded);
  });

  taskSuggestionPrimaryBtn.addEventListener('click', () => {
    if (pendingConfirmAction) {
      const action = pendingConfirmAction;
      pendingConfirmAction = null;
      setTaskSuggestion({ visible: false });
      opts.onCancelRun?.();
      if (action === 'new_task') opts.onNewTask?.();
      else if (action === 'end_task') opts.onEndTask?.();
      return;
    }
    opts.onTaskSuggestionPrimary?.();
  });

  taskSuggestionSecondaryBtn.addEventListener('click', () => {
    if (pendingConfirmAction) {
      pendingConfirmAction = null;
      setTaskSuggestion({ visible: false });
      return;
    }
    opts.onTaskSuggestionSecondary?.();
  });

  inputEl.addEventListener('input', () => {
    if (voiceState === 'listening') {
      stopVoiceDictation('typed');
    }
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(96, Math.max(44, inputEl.scrollHeight))}px`;
  });

  voiceButton.addEventListener('click', () => {
    if (inputEl.disabled) return;
    if (voiceState === 'listening') {
      stopVoiceDictation('manual');
      return;
    }
    startVoiceDictation();
  });

  questionPromptForm.addEventListener('submit', ev => {
    ev.preventDefault();
    if (inputEl.disabled) return;
    if (!currentQuestionPrompt?.questions?.length) return;

    const answersByKey: Record<string, string> = {};
    const rawLines: string[] = [];
    let firstInvalid: HTMLInputElement | null = null;

    for (const question of currentQuestionPrompt.questions) {
      const input = getQuestionInputByKey(question.key);
      if (!input) continue;
      const value = sanitizeText(input.value);
      const isRequired = question.required !== false;
      if (!value && isRequired) {
        input.classList.add('invalid');
        if (!firstInvalid) firstInvalid = input;
        continue;
      }
      if (!value) {
        input.classList.remove('invalid');
        delete questionDraftAnswers[question.key];
        rawLines.push(`${question.key}: (no answer provided)`);
        continue;
      }
      input.classList.remove('invalid');
      questionDraftAnswers[question.key] = value;
      answersByKey[question.key] = value;
      rawLines.push(`${question.key}: ${value}`);
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const keys = currentQuestionPrompt.questions.map(question => question.key);
    const rawText = rawLines.length
      ? rawLines.join('\n')
      : keys.map(key => `${key}: (no answer provided)`).join('\n');
    opts.onSend(rawText, {
      askUserAnswers: {
        answersByKey,
        rawText,
        keys,
      },
    });
  });

  questionPromptCancel.addEventListener('click', () => {
    if (inputEl.disabled) return;
    if (opts.onCancelQuestionFlow) {
      opts.onCancelQuestionFlow();
      return;
    }
    opts.onCancelRun?.();
  });

  /* Enter to send, Shift+Enter for newline */
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  composer.addEventListener('submit', ev => {
    ev.preventDefault();
    if (inputEl.disabled) return;
    if (voiceState === 'listening') {
      pendingVoiceSubmit = true;
      stopVoiceDictation('submit');
      return;
    }
    submitComposerDraft();
  });

  /* Escape closes panel when open */
  shadow.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape' && panel.classList.contains('open')) {
      ke.stopPropagation();
      close();
    }
  });

  /* Cmd/Ctrl + Shift + . to toggle Rover from anywhere on the page */
  const globalToggleHandler = (e: KeyboardEvent): void => {
    if (e.code === 'Period' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (panel.classList.contains('open')) close();
      else open();
    }
  };
  document.addEventListener('keydown', globalToggleHandler);

  let resizeState: { startX: number; startY: number; startW: number; startH: number } | null = null;

  const onPointerMove = (ev: PointerEvent) => {
    if (!resizeState) return;
    const dx = resizeState.startX - ev.clientX;
    const dy = ev.clientY - resizeState.startY;

    const nextW = Math.max(320, Math.min(window.innerWidth - 16, resizeState.startW + dx));
    const nextH = Math.max(460, Math.min(window.innerHeight - 16, resizeState.startH + dy));

    panel.style.width = `${nextW}px`;
    panel.style.height = `${nextH}px`;
  };

  const stopResize = () => {
    resizeState = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopResize);
  };

  resizeHandle.addEventListener('pointerdown', ev => {
    if (window.matchMedia('(max-width: 640px)').matches) return;
    ev.preventDefault();
    resizeState = {
      startX: ev.clientX,
      startY: ev.clientY,
      startW: panel.getBoundingClientRect().width,
      startH: panel.getBoundingClientRect().height,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
  });

  if (launcherVideo) {
    const showLauncherFallback = () => {
      launcherVideo!.style.display = 'none';
      launcherFallback.style.display = 'grid';
    };
    launcherVideo.addEventListener('error', showLauncherFallback, { once: true });
    launcherFallback.style.display = 'none';
  }

  if (avatarVideo) {
    const showAvatarFallback = () => {
      avatarVideo!.style.display = 'none';
      avatarFallback.style.display = 'grid';
    };
    avatarVideo.addEventListener('error', showAvatarFallback, { once: true });
    avatarFallback.style.display = 'none';
  }

  setExecutionMode('controller');
  setVoiceConfig(voiceConfig);
  setTraceExpanded(false);
  if (currentShortcuts.length > 0) {
    renderShortcuts(currentShortcuts);
  }

  /* ── Tab Bar Logic ── */
  let lastTabsKey = '';
  const faviconCache = new Map<string, string>();

  function setTabs(_tabs: RoverTabInfo[]): void {
    // Tab bar removed — tabs are no longer rendered in the widget.
    // This function is kept as a no-op for backward compatibility.
  }

  /* ── Conversation Drawer Logic ── */
  let drawerOpen = false;

  function openConversationDrawer(): void {
    drawerOpen = true;
    conversationDrawer.classList.add('open');
  }

  function closeConversationDrawer(): void {
    drawerOpen = false;
    conversationDrawer.classList.remove('open');
  }

  conversationListBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (drawerOpen) closeConversationDrawer();
    else openConversationDrawer();
  });

  conversationDrawerCloseBtn.addEventListener('click', () => closeConversationDrawer());

  conversationNewBtn.addEventListener('click', () => {
    closeConversationDrawer();
    opts.onNewTask?.();
  });

  let lastConversationsKey = '';

  function setConversations(conversations: ConversationListItem[]): void {
    const key = conversations.map(c => `${c.id}|${c.summary}|${c.status}|${c.updatedAt}|${c.isActive}`).join(';;');
    if (key === lastConversationsKey) return;
    lastConversationsKey = key;

    // Update conversation pill label with active task summary
    const active = conversations.find(c => c.isActive);
    if (active) {
      const pillText = active.summary.length > 40 ? active.summary.slice(0, 40) + '...' : active.summary;
      conversationPillLabel.textContent = pillText || 'Current task';
    } else {
      conversationPillLabel.textContent = 'Current task';
    }
    // Hide pill if only one conversation
    conversationPill.style.display = conversations.length > 1 ? 'flex' : 'none';

    conversationList.innerHTML = '';
    for (const conv of conversations) {
      const item = document.createElement('div');
      item.className = `conversationItem ${conv.status}${conv.isActive ? ' active' : ''}`;
      item.dataset.id = conv.id;

      const dot = document.createElement('span');
      dot.className = 'conversationDot';

      const content = document.createElement('div');
      content.className = 'conversationContent';
      const summary = document.createElement('div');
      summary.className = 'conversationSummary';
      summary.textContent = conv.summary.length > 60 ? conv.summary.slice(0, 60) + '...' : conv.summary;
      const meta = document.createElement('div');
      meta.className = 'conversationMeta';
      const statusBadge = conv.status === 'running' ? 'Running' : conv.status === 'paused' ? 'Paused' : conv.status === 'completed' ? 'Done' : conv.status;
      meta.textContent = `${statusBadge} · ${formatTime(conv.updatedAt)}`;
      content.appendChild(summary);
      content.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'conversationActions';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'conversationDeleteBtn';
      deleteBtn.textContent = '\u00D7';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onDeleteConversation?.(conv.id);
      });
      actions.appendChild(deleteBtn);

      item.appendChild(dot);
      item.appendChild(content);
      item.appendChild(actions);

      item.addEventListener('click', () => {
        closeConversationDrawer();
        opts.onSwitchConversation?.(conv.id);
      });

      conversationList.appendChild(item);
    }
  }

  function setActiveConversationId(id: string): void {
    const items = conversationList.querySelectorAll('.conversationItem');
    items.forEach(item => {
      if ((item as HTMLElement).dataset.id === id) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  /* ── Paused Task Banner Logic ── */
  function showPausedTaskBanner(task: { taskId: string; rootUserInput: string }): void {
    pausedTaskId = task.taskId;
    const truncatedInput = task.rootUserInput.length > 50
      ? task.rootUserInput.slice(0, 50) + '...'
      : task.rootUserInput;
    pausedTaskBanner.innerHTML = '';

    const text = document.createElement('span');
    text.className = 'pausedTaskText';
    text.textContent = `Paused: "${truncatedInput}"`;

    const actions = document.createElement('div');
    actions.className = 'pausedTaskActions';

    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'pausedTaskResumeBtn';
    resumeBtn.textContent = 'Resume';
    resumeBtn.addEventListener('click', () => opts.onResumeTask?.(pausedTaskId));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pausedTaskCancelBtn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => opts.onCancelPausedTask?.(pausedTaskId));

    actions.appendChild(resumeBtn);
    actions.appendChild(cancelBtn);
    pausedTaskBanner.appendChild(text);
    pausedTaskBanner.appendChild(actions);
    pausedTaskBanner.classList.add('visible');
  }

  function hidePausedTaskBanner(): void {
    pausedTaskId = '';
    pausedTaskBanner.classList.remove('visible');
  }

  /* ── Scroll Position ── */
  function getScrollPosition(): number {
    return feed.scrollTop;
  }

  function setScrollPosition(position: number): void {
    requestAnimationFrame(() => {
      feed.scrollTop = position;
    });
  }

  return {
    addMessage,
    setQuestionPrompt,
    clearMessages,
    addTimelineEvent,
    clearTimeline,
    setTaskSuggestion,
    setStatus,
    setRunning,
    setExecutionMode,
    setShortcuts: renderShortcuts,
    showGreeting,
    dismissGreeting,
    setVisitorName,
    setVoiceConfig,
    open,
    close,
    show,
    hide,
    destroy,
    // Multi-conversation support
    setTabs,
    setConversations,
    setActiveConversationId,
    getScrollPosition,
    setScrollPosition,
    showPausedTaskBanner,
    hidePausedTaskBanner,
  };
}
