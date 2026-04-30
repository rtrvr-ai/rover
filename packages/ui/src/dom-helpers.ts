import type { RoverTimelineEvent, RoverMessageBlock } from './types.js';
import {
  sanitizeText,
  EXPAND_THRESHOLD_OUTPUT,
  EXPAND_THRESHOLD_THOUGHT,
  EXPAND_THRESHOLD_TOOL,
  STRUCTURED_PAGE_SIZE,
  STRUCTURED_MAX_DEPTH,
} from './config.js';

export function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function normalizeTimelineStatus(event: RoverTimelineEvent): 'pending' | 'success' | 'error' | 'info' {
  if (event.status) return event.status;
  if (event.kind === 'tool_start' || event.kind === 'plan' || event.kind === 'thought') return 'pending';
  if (event.kind === 'tool_result') return 'success';
  if (event.kind === 'error') return 'error';
  return 'info';
}

export function deriveTraceKey(event: RoverTimelineEvent): string {
  const toolCallId = sanitizeText(event.actionCue?.toolCallId || '');
  if ((event.kind === 'tool_start' || event.kind === 'tool_result') && toolCallId) {
    return `tool:${toolCallId}`;
  }
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

export function normalizeVoiceDraftSegment(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function composeVoiceDraft(base: string, finalTranscript: string, interimTranscript: string): string {
  const chunks = [
    String(base || '').trim(),
    normalizeVoiceDraftSegment(finalTranscript),
    normalizeVoiceDraftSegment(interimTranscript),
  ].filter(Boolean);
  return chunks.join(' ');
}

export function parseStageFromTitle(title: string): { stage?: string; plainTitle: string } {
  const clean = sanitizeText(title);
  const match = /^(Analyze|Route|Execute|Verify|Complete):\s*(.*)$/i.exec(clean);
  if (!match) return { plainTitle: clean };
  const stage = match[1].toLowerCase();
  const plainTitle = sanitizeText(match[2] || clean);
  return { stage, plainTitle: plainTitle || clean };
}

function titleCase(input: string): string {
  return String(input || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractToolCandidate(event: RoverTimelineEvent): string {
  const toolName = sanitizeText(event.toolName || '');
  if (toolName) return toolName;
  const title = sanitizeText(event.title || '');
  const runningMatch = /^running\s+(.+)$/i.exec(title);
  if (runningMatch?.[1]) return runningMatch[1];
  const completedMatch = /^(.+?)\s+completed$/i.exec(title);
  if (completedMatch?.[1]) return completedMatch[1];
  return '';
}

export function humanizeToolName(value: string): string | undefined {
  const raw = sanitizeText(value);
  if (!raw) return undefined;
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return undefined;
  const toolLabels: Record<string, string> = {
    click: 'Click',
    'click element': 'Click Element',
    tap: 'Tap',
    press: 'Press',
    'open url': 'Open URL',
    'open url new tab': 'Open URL',
    'open url same tab': 'Open URL',
    navigate: 'Navigate',
    goto: 'Navigate',
    'go to': 'Navigate',
    visit: 'Navigate',
    type: 'Type',
    'type text': 'Type Text',
    input: 'Input',
    fill: 'Fill Field',
    'set value': 'Set Value',
    select: 'Select Option',
    upload: 'Upload File',
    'upload file': 'Upload File',
    scroll: 'Scroll',
    wait: 'Wait',
    monitor: 'Monitor',
    hover: 'Hover',
    read: 'Read Page',
    'read page': 'Read Page',
    extract: 'Extract Data',
    scrape: 'Extract Data',
    'search page': 'Search Page',
    'get text': 'Read Text',
    'get html': 'Read HTML',
    screenshot: 'Capture Screenshot',
    snapshot: 'Capture Snapshot',
  };
  return toolLabels[normalized] || titleCase(normalized);
}

function truncateActionLabel(label?: string): string {
  const clean = sanitizeText(label || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length <= 48 ? clean : `${clean.slice(0, 45).trim()}...`;
}

export function deriveActionCueText(event: RoverTimelineEvent): string | undefined {
  const cue = event.actionCue;
  if (!cue) return undefined;
  const label = truncateActionLabel(cue.targetLabel);
  const inProgress = event.kind !== 'tool_result';
  const verbs: Record<string, { active: string; done: string }> = {
    click: { active: 'Clicking', done: 'Clicked' },
    type: { active: 'Typing in', done: 'Typed in' },
    select: { active: 'Selecting', done: 'Selected' },
    clear: { active: 'Clearing', done: 'Cleared' },
    focus: { active: 'Focusing', done: 'Focused' },
    hover: { active: 'Hovering over', done: 'Hovered over' },
    press: { active: 'Pressing', done: 'Pressed' },
    scroll: { active: 'Scrolling to', done: 'Scrolled to' },
    drag: { active: 'Dragging', done: 'Dragged' },
    copy: { active: 'Copying', done: 'Copied' },
    paste: { active: 'Pasting into', done: 'Pasted into' },
    upload: { active: 'Uploading to', done: 'Uploaded to' },
    navigate: { active: 'Navigating', done: 'Navigated' },
    read: { active: 'Reading', done: 'Read' },
    wait: { active: 'Waiting for', done: 'Waited for' },
    unknown: { active: 'Acting on', done: 'Acted on' },
  };
  const verb = verbs[cue.kind]?.[inProgress ? 'active' : 'done'] || verbs.unknown[inProgress ? 'active' : 'done'];
  if (label) return `${verb} ${label}`;
  if (cue.kind === 'type') return inProgress ? 'Typing into field' : 'Typed into field';
  if (cue.kind === 'select') return inProgress ? 'Selecting option' : 'Selected option';
  if (cue.kind === 'clear') return inProgress ? 'Clearing field' : 'Cleared field';
  if (cue.kind === 'scroll') return inProgress ? 'Scrolling page' : 'Scrolled page';
  if (cue.kind === 'drag') return inProgress ? 'Dragging item' : 'Dragged item';
  if (cue.kind === 'copy') return inProgress ? 'Copying text' : 'Copied text';
  if (cue.kind === 'paste') return inProgress ? 'Pasting text' : 'Pasted text';
  if (cue.kind === 'upload') return inProgress ? 'Uploading file' : 'Uploaded file';
  if (cue.kind === 'navigate') return inProgress ? 'Navigating' : 'Navigated';
  if (cue.kind === 'read') return inProgress ? 'Reading page' : 'Read page';
  if (cue.kind === 'wait') return inProgress ? 'Waiting' : 'Waited';
  return inProgress ? 'Acting on page' : 'Acted on page';
}

export function deriveTimelineStatusLabel(event: RoverTimelineEvent): string {
  const kind = event.kind;
  const cueKind = event.actionCue?.kind;
  const toolCandidate = extractToolCandidate(event);
  const title = sanitizeText(event.title || '');
  if (kind === 'tool_start') {
    if (
      cueKind === 'click'
      || cueKind === 'press'
      || cueKind === 'hover'
      || cueKind === 'focus'
      || cueKind === 'clear'
      || cueKind === 'drag'
      || cueKind === 'copy'
      || cueKind === 'paste'
      || cueKind === 'upload'
    ) return 'Acting';
    if (cueKind === 'navigate') return 'Navigating';
    if (cueKind === 'type' || cueKind === 'select') return 'Inputting';
    if (cueKind === 'read') return 'Reading';
    if (cueKind === 'scroll') return 'Scrolling';
    if (cueKind === 'wait') return 'Waiting';
    if (/click|tap|press/i.test(toolCandidate) || /click|tap|press/i.test(title)) return 'Acting';
    if (/navigate|goto|go to|open|visit/i.test(toolCandidate) || /navigate|go to|visit|open/i.test(title)) return 'Navigating';
    if (/type|fill|input|write|set/i.test(toolCandidate) || /type|fill|input|write|set/i.test(title)) return 'Inputting';
    if (/read|extract|scrape|get|fetch|find|search/i.test(toolCandidate) || /read|extract|scrape|search|inspect/i.test(title)) return 'Reading';
    if (/scroll/i.test(toolCandidate) || /scroll/i.test(title)) return 'Scrolling';
    if (/wait|monitor|observe/i.test(toolCandidate) || /wait|monitor|observe/i.test(title)) return 'Waiting';
    return 'Executing';
  }
  if (kind === 'tool_result') return 'Completed';
  if (kind === 'assistant_response') return event.responseKind === 'final' ? 'Answer' : 'Update';
  if (kind === 'thought') return 'Thinking';
  if (kind === 'plan') return 'Planning';
  if (kind === 'status') {
    const parsed = parseStageFromTitle(event.title || '');
    if (parsed.stage) return titleCase(parsed.stage);
    return 'Status';
  }
  if (kind === 'debug') return 'Debug';
  if (kind === 'error') return 'Error';
  if (kind === 'info') return 'Update';
  return 'Searching';
}

export function deriveTimelineHeading(event: RoverTimelineEvent): string {
  const actionText = deriveActionCueText(event);
  if (actionText) return actionText;
  const parsed = parseStageFromTitle(event.title || '');
  const toolLabel = humanizeToolName(extractToolCandidate(event));
  if (toolLabel) return toolLabel;
  if (parsed.stage) return titleCase(parsed.stage);
  if (parsed.plainTitle) return parsed.plainTitle;
  return deriveTimelineStatusLabel(event);
}

export function deriveTimelineBody(event: RoverTimelineEvent): string {
  if (event.actionCue) return '';
  const detail = sanitizeText(event.detail || '');
  if (detail) return detail;
  const parsed = parseStageFromTitle(event.title || '');
  const heading = deriveTimelineHeading(event);
  if (parsed.plainTitle && parsed.plainTitle !== heading) return parsed.plainTitle;
  return '';
}

export type TranscriptMessageLike = {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  blocks?: RoverMessageBlock[];
  ts?: number;
  order?: number;
};

export type TranscriptTimelineLike = RoverTimelineEvent & {
  order?: number;
};

export type TranscriptItem =
  | { kind: 'message'; message: TranscriptMessageLike }
  | { kind: 'timeline'; event: TranscriptTimelineLike };

export type TranscriptSegment =
  | { kind: 'message'; message: TranscriptMessageLike }
  | { kind: 'timeline'; id: string; events: TranscriptTimelineLike[] };

function transcriptItemOrderValue(item: TranscriptItem): number {
  const value = item.kind === 'message' ? item.message.order : item.event.order;
  return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function transcriptItemTimestamp(item: TranscriptItem): number {
  const value = item.kind === 'message' ? item.message.ts : item.event.ts;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function transcriptItemPriority(item: TranscriptItem): number {
  if (item.kind === 'timeline') return 1;
  return item.message.role === 'user' ? 0 : 2;
}

function transcriptItemStableId(item: TranscriptItem): string {
  if (item.kind === 'message') return sanitizeText(item.message.id || item.message.text || '');
  return sanitizeText(item.event.id || item.event.title || '');
}

export function mergeTranscriptItems(
  messages: TranscriptMessageLike[] = [],
  timeline: TranscriptTimelineLike[] = [],
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const message of messages) {
    if (!message) continue;
    items.push({ kind: 'message', message });
  }
  for (const event of timeline) {
    if (!event) continue;
    items.push({ kind: 'timeline', event });
  }
  return items.sort((left, right) => {
    const tsDiff = transcriptItemTimestamp(left) - transcriptItemTimestamp(right);
    if (tsDiff !== 0) return tsDiff;
    const orderDiff = transcriptItemOrderValue(left) - transcriptItemOrderValue(right);
    if (orderDiff !== 0) return orderDiff;
    const priorityDiff = transcriptItemPriority(left) - transcriptItemPriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    return transcriptItemStableId(left).localeCompare(transcriptItemStableId(right));
  });
}

export function buildTranscriptSegments(
  messages: TranscriptMessageLike[] = [],
  timeline: TranscriptTimelineLike[] = [],
): TranscriptSegment[] {
  const ordered = mergeTranscriptItems(messages, timeline);
  const segments: TranscriptSegment[] = [];
  for (const item of ordered) {
    if (item.kind === 'message') {
      segments.push({ kind: 'message', message: item.message });
      continue;
    }
    const current = segments[segments.length - 1];
    if (current?.kind === 'timeline') {
      current.events.push(item.event);
      continue;
    }
    segments.push({
      kind: 'timeline',
      id: sanitizeText(item.event.id || '') || createId('trace-group'),
      events: [item.event],
    });
  }
  return segments;
}

function shortenDisplayUrl(url: string, maxLength: number): string {
  const fallback = sanitizeText(url);
  try {
    const parsed = new URL(fallback);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = `${parsed.pathname || ''}${parsed.search || ''}${parsed.hash || ''}`;
    if (!path) return host;
    const budget = Math.max(12, maxLength - host.length - 1);
    if (path.length <= budget) return `${host}${path}`;
    const head = path.slice(0, Math.max(6, Math.floor(budget * 0.55)));
    const tail = path.slice(-Math.max(4, budget - head.length - 3));
    return `${host}${head}...${tail}`;
  } catch {
    if (fallback.length <= maxLength) return fallback;
    return `${fallback.slice(0, Math.max(12, maxLength - 15))}...${fallback.slice(-12)}`;
  }
}

export function summarizeTaskText(input: string, options?: {
  maxLength?: number;
  maxUrlLength?: number;
}): string {
  const maxLength = Math.max(24, Number(options?.maxLength) || 96);
  const maxUrlLength = Math.max(20, Number(options?.maxUrlLength) || 52);
  const clean = sanitizeText(String(input || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const summarized = clean.replace(/https?:\/\/[^\s]+/gi, (url) => shortenDisplayUrl(url, maxUrlLength));
  if (summarized.length <= maxLength) return summarized;
  return `${summarized.slice(0, Math.max(20, maxLength - 3)).trimEnd()}...`;
}

export function classifyVisibility(event: RoverTimelineEvent): 'primary' | 'detail' {
  const title = (event.title || '').toLowerCase();
  if (title === 'run started' || title === 'run resumed' || title === 'run completed') return 'detail';
  if (title === 'started new task' || title === 'execution completed') return 'detail';
  if (event.kind === 'status') {
    const parsed = parseStageFromTitle(event.title || '');
    if (parsed.stage === 'analyze' || parsed.stage === 'route' || parsed.stage === 'complete') return 'detail';
  }
  return 'primary';
}

export function createExpandableContent(text: string, threshold: number): HTMLDivElement {
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

export function appendInlineContent(parent: HTMLElement, text: string): void {
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

export function renderRichContent(text: string): DocumentFragment {
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

export function createExpandableRichContent(text: string, threshold: number): HTMLDivElement {
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

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'rvRawToggle';
  copyButton.textContent = 'Copy JSON';

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

  copyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const text = pre.textContent || safeJsonStringify(value);
    const restore = copyButton.textContent || 'Copy JSON';
    const markCopied = () => {
      copyButton.textContent = 'Copied';
      setTimeout(() => {
        copyButton.textContent = restore;
      }, 1200);
    };
    try {
      const write = typeof navigator !== 'undefined'
        ? navigator.clipboard?.writeText?.bind(navigator.clipboard)
        : undefined;
      if (write) {
        void write(text).then(markCopied).catch(() => undefined);
      }
    } catch {
      // Copy support is best-effort in debug surfaces.
    }
  });

  wrap.appendChild(button);
  wrap.appendChild(copyButton);
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
            cell.textContent = '\u2014';
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

export function renderStructuredValue(value: unknown, depth = 0): HTMLElement {
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

export function renderMessageBlock(block: RoverMessageBlock): HTMLElement | undefined {
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
    typeBadge.textContent = `array \u00b7 ${block.data.length}`;
  } else if (isPlainObject(block.data)) {
    typeBadge.textContent = `object \u00b7 ${Object.keys(block.data).length}`;
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

export function renderAssistantMessageContent(
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
