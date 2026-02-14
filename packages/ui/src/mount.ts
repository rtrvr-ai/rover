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
  status?: 'pending' | 'success' | 'error' | 'info';
  ts?: number;
};

export type RoverTaskSuggestion = {
  visible: boolean;
  text?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
};

export type RoverUi = {
  addMessage: (role: 'user' | 'assistant' | 'system', text: string) => void;
  clearMessages: () => void;
  addTimelineEvent: (event: RoverTimelineEvent) => void;
  clearTimeline: () => void;
  setTaskSuggestion: (suggestion: RoverTaskSuggestion) => void;
  setStatus: (text: string) => void;
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
  open: () => void;
  close: () => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
};

export type MountOptions = {
  onSend: (text: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRequestControl?: () => void;
  onNewTask?: () => void;
  onEndTask?: () => void;
  onTaskSuggestionPrimary?: () => void;
  onTaskSuggestionSecondary?: () => void;
  showTaskControls?: boolean;
  muted?: boolean;
  mascot?: {
    disabled?: boolean;
    mp4Url?: string;
    webmUrl?: string;
  };
};

const DEFAULT_MASCOT_MP4 = 'https://www.rtrvr.ai/rover/mascot.mp4';
const DEFAULT_MASCOT_WEBM = 'https://www.rtrvr.ai/rover/mascot.webm';

const EXPAND_THRESHOLD_OUTPUT = 280;
const EXPAND_THRESHOLD_THOUGHT = 150;
const EXPAND_THRESHOLD_TOOL = 100;

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
  toggle.textContent = '...Show more';

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = rest.style.display === 'none';
    rest.style.display = hidden ? 'inline' : 'none';
    toggle.textContent = hidden ? ' Show less' : '...Show more';
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
    toggle.textContent = '...Show more';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const hidden = rest.style.display === 'none';
      rest.style.display = hidden ? 'block' : 'none';
      toggle.textContent = hidden ? ' Show less' : '...Show more';
    });
    wrapper.appendChild(toggle);
  }

  return wrapper;
}

export function mountWidget(opts: MountOptions): RoverUi {
  const host = document.createElement('div');
  host.id = 'rover-widget-root';
  document.documentElement.appendChild(host);

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

    .modeBadge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      border-radius: 999px;
      padding: 3px 8px;
      border: 1px solid transparent;
      flex: 0 0 auto;
    }

    .modeBadge.controller {
      color: #9a3412;
      background: rgba(255, 76, 0, 0.08);
      border-color: var(--rv-accent-border);
    }

    .modeBadge.observer {
      color: var(--rv-text-secondary);
      background: rgba(0, 0, 0, 0.04);
      border-color: var(--rv-border-strong);
    }

    .muteBtn {
      width: 32px; height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      cursor: pointer;
      display: grid; place-items: center;
      color: var(--rv-text-secondary);
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      flex: 0 0 auto; padding: 0;
    }
    .muteBtn:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
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

    /* ── Step 10: Composer Enhancement ── */
    .composer {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border-top: 1px solid var(--rv-border);
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
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

      .modeBadge {
        font-size: 9px;
        padding: 2px 6px;
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
    }
  `;

  const wrapper = document.createElement('div');
  wrapper.className = 'rover';
  wrapper.dataset.mood = 'idle';

  /* ── Launcher ── */
  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', 'Open Rover assistant');

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
  launcherFallback.textContent = 'RVR';

  const launcherShine = document.createElement('div');
  launcherShine.className = 'launcherShine';

  launcher.appendChild(launcherFallback);
  launcher.appendChild(launcherShine);

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
  avatarFallback.textContent = 'R';
  avatar.appendChild(avatarFallback);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = 'Rover';
  const statusEl = document.createElement('div');
  statusEl.className = 'status';
  const statusDot = document.createElement('span');
  statusDot.className = 'statusDot';
  const statusText = document.createElement('span');
  statusText.textContent = 'ready';
  statusEl.appendChild(statusDot);
  statusEl.appendChild(statusText);
  meta.appendChild(titleEl);
  meta.appendChild(statusEl);

  /* ── Header Actions ── */
  const headerActions = document.createElement('div');
  headerActions.className = 'headerActions';

  const modeBadge = document.createElement('span');
  modeBadge.className = 'modeBadge controller';
  modeBadge.textContent = 'active';

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

  /* ── Mute Button ── */
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'muteBtn';
  muteBtn.setAttribute('aria-label', 'Toggle sound');

  let isMuted = opts.muted ?? false;
  try {
    const stored = localStorage.getItem('rover:muted');
    if (stored !== null) isMuted = stored !== 'false';
  } catch { /* ignore */ }

  const ICON_MUTED = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  const ICON_UNMUTED = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';

  function syncMuteState(): void {
    muteBtn.innerHTML = isMuted ? ICON_MUTED : ICON_UNMUTED;
    muteBtn.setAttribute('aria-label', isMuted ? 'Unmute' : 'Mute');
    if (launcherVideo) launcherVideo.muted = isMuted;
    if (avatarVideo) avatarVideo.muted = isMuted;
  }
  syncMuteState();

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isMuted = !isMuted;
    try { localStorage.setItem('rover:muted', String(isMuted)); } catch { /* ignore */ }
    syncMuteState();
  });

  headerActions.appendChild(modeBadge);
  headerActions.appendChild(muteBtn);
  headerActions.appendChild(overflowBtn);
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

  const menuToggleDetails = document.createElement('button');
  menuToggleDetails.type = 'button';
  menuToggleDetails.className = 'menuItem';
  menuToggleDetails.textContent = 'Show details';

  const menuTakeControl = document.createElement('button');
  menuTakeControl.type = 'button';
  menuTakeControl.className = 'menuItem';
  menuTakeControl.textContent = 'Take control';
  menuTakeControl.style.display = 'none';

  overflowMenu.appendChild(menuNewTask);
  overflowMenu.appendChild(menuEndTask);
  overflowMenu.appendChild(menuDivider);
  overflowMenu.appendChild(menuToggleDetails);
  overflowMenu.appendChild(menuTakeControl);

  if (opts.showTaskControls === false) {
    menuNewTask.style.display = 'none';
    menuEndTask.style.display = 'none';
  }

  header.appendChild(avatar);
  header.appendChild(meta);
  header.appendChild(headerActions);
  header.appendChild(overflowMenu);

  /* ── Feed ── */
  const feedWrapper = document.createElement('div');
  feedWrapper.style.cssText = 'position:relative;flex:1;min-height:0;display:flex;flex-direction:column;';

  const feed = document.createElement('div');
  feed.className = 'feed';

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

  /* ── Composer ── */
  const composer = document.createElement('form');
  composer.className = 'composer';

  const composerTextarea = document.createElement('textarea');
  composerTextarea.rows = 1;
  composerTextarea.placeholder = 'Ask Rover to act on this website...';
  composer.appendChild(composerTextarea);

  const sendButton = document.createElement('button');
  sendButton.type = 'submit';
  sendButton.className = 'sendBtn';
  sendButton.innerHTML = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  composer.appendChild(sendButton);

  /* ── Resize Handle ── */
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resizeHandle';
  resizeHandle.setAttribute('aria-hidden', 'true');

  panel.appendChild(header);
  panel.appendChild(feedWrapper);
  panel.appendChild(taskSuggestion);
  panel.appendChild(composer);
  panel.appendChild(resizeHandle);

  wrapper.appendChild(launcher);
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
  let traceExpanded = false;
  let moodResetTimer: number | null = null;
  let overflowOpen = false;
  let userScrolledUp = false;
  let lastAutoScrollTs = 0;

  /* ── Overflow menu logic ── */
  function toggleOverflow(): void {
    overflowOpen = !overflowOpen;
    overflowMenu.classList.toggle('visible', overflowOpen);
  }

  function closeOverflow(): void {
    overflowOpen = false;
    overflowMenu.classList.remove('visible');
  }

  function setMascotMood(mood: 'idle' | 'typing' | 'running' | 'success' | 'error', holdMs = 0): void {
    wrapper.dataset.mood = mood;
    if (moodResetTimer != null) {
      window.clearTimeout(moodResetTimer);
      moodResetTimer = null;
    }

    /* Step 15: Show/hide typing indicator */
    if (mood === 'typing' || mood === 'running') {
      typingIndicator.classList.add('visible');
      feed.appendChild(typingIndicator);
      smartScrollToBottom();
    } else {
      typingIndicator.classList.remove('visible');
    }

    if (holdMs > 0 && mood !== 'idle') {
      moodResetTimer = window.setTimeout(() => {
        wrapper.dataset.mood = 'idle';
        typingIndicator.classList.remove('visible');
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
    inputEl.disabled = currentMode === 'observer' && !canComposeInObserver;
  }

  function setTraceExpanded(next: boolean): void {
    traceExpanded = next;
    wrapper.dataset.showDetails = next ? 'true' : 'false';
    menuToggleDetails.textContent = traceExpanded ? 'Hide details' : 'Show details';
    for (const item of traceOrder) {
      const status = item.dataset.status;
      const done = status === 'success' || status === 'error' || status === 'info';
      item.classList.toggle('compact', !traceExpanded && done);
    }
  }

  /* ── Step 5: Panel open/close with animation ── */
  function open(): void {
    wrapper.style.display = '';
    panel.classList.remove('closing');
    panel.classList.add('open');
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

  function addMessage(role: 'user' | 'assistant' | 'system', text: string): void {
    const clean = sanitizeText(text);
    if (!clean) return;

    const entry = document.createElement('div');
    entry.className = `entry message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'assistant') {
      if (clean.length > EXPAND_THRESHOLD_OUTPUT) {
        bubble.appendChild(createExpandableRichContent(clean, EXPAND_THRESHOLD_OUTPUT));
      } else {
        bubble.appendChild(renderRichContent(clean));
      }
    } else {
      bubble.textContent = clean;
    }

    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.textContent = formatTime(Date.now());

    entry.appendChild(bubble);
    entry.appendChild(stamp);
    feed.appendChild(entry);
    if (role === 'user') setMascotMood('typing', 1200);
    else if (role === 'assistant') setMascotMood('success', 1400);
    else setMascotMood('running', 900);
    smartScrollToBottom();
  }

  function clearMessages(): void {
    for (const node of Array.from(feed.querySelectorAll('.entry.message'))) {
      node.remove();
    }
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
    const detailText = sanitizeText(event.detail || '');
    if (detailText) {
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
    if (title.toLowerCase() === 'run completed') {
      setTraceExpanded(false);
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

    modeBadge.classList.remove('controller', 'observer');
    modeBadge.classList.add(mode);

    if (mode === 'controller') {
      modeBadge.textContent = 'active';
      menuTakeControl.style.display = 'none';
      inputEl.placeholder = 'Ask Rover to act on this website...';
    } else {
      modeBadge.textContent = 'observer';
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
        inputEl.placeholder = `Observing: Rover is acting in tab #${executionMeta.activeLogicalTabId}`;
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
    document.removeEventListener('keydown', globalToggleHandler);
    fontStyle.remove();
    host.remove();
  }

  /* ── Event Listeners ── */
  launcher.addEventListener('click', () => {
    if (panel.classList.contains('open')) close();
    else open();
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
    opts.onNewTask?.();
  });

  menuEndTask.addEventListener('click', () => {
    closeOverflow();
    opts.onEndTask?.();
  });

  menuToggleDetails.addEventListener('click', () => {
    closeOverflow();
    setTraceExpanded(!traceExpanded);
  });

  menuTakeControl.addEventListener('click', () => {
    closeOverflow();
    opts.onRequestControl?.();
  });

  taskSuggestionPrimaryBtn.addEventListener('click', () => {
    opts.onTaskSuggestionPrimary?.();
  });

  taskSuggestionSecondaryBtn.addEventListener('click', () => {
    opts.onTaskSuggestionSecondary?.();
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(96, Math.max(44, inputEl.scrollHeight))}px`;
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
    const text = sanitizeText(inputEl.value);
    if (!text) return;
    setTaskSuggestion({ visible: false });
    opts.onSend(text);
    inputEl.value = '';
    inputEl.style.height = '44px';
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
  setTraceExpanded(false);

  return {
    addMessage,
    clearMessages,
    addTimelineEvent,
    clearTimeline,
    setTaskSuggestion,
    setStatus,
    setExecutionMode,
    open,
    close,
    show,
    hide,
    destroy,
  };
}
