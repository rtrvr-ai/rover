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
  mascot?: {
    mp4Url?: string;
    webmUrl?: string;
  };
};

const DEFAULT_MASCOT_MP4 = 'https://www.rtrvr.ai/rover/mascot.mp4';
const DEFAULT_MASCOT_WEBM = 'https://www.rtrvr.ai/rover/mascot.webm';

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

export function mountWidget(opts: MountOptions): RoverUi {
  const host = document.createElement('div');
  host.id = 'rover-widget-root';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      --rv-bg-0: #fffdfa;
      --rv-bg-1: #fff4eb;
      --rv-surface: rgba(255, 255, 255, 0.94);
      --rv-border: rgba(255, 102, 45, 0.24);
      --rv-text: #132033;
      --rv-subtext: #5f6c7f;
      --rv-accent: #f45d05;
      --rv-accent-2: #ff8b46;
      --rv-success: #059669;
      --rv-error: #dc2626;
      --rv-info: #2563eb;
    }
    .rover { all: initial; font-family: 'Sora', 'Manrope', 'Space Grotesk', system-ui, -apple-system, Segoe UI, sans-serif; }
    .rover * { box-sizing: border-box; }

    .launcher {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 58px;
      height: 58px;
      border-radius: 18px;
      border: 1px solid var(--rv-border);
      background: linear-gradient(140deg, var(--rv-accent), var(--rv-accent-2));
      box-shadow: 0 18px 44px rgba(244, 93, 5, 0.3);
      color: #fff;
      cursor: pointer;
      z-index: 2147483647;
      overflow: hidden;
      display: grid;
      place-items: center;
      padding: 0;
    }

    .launcher video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
      transition: filter 180ms ease, transform 180ms ease;
    }

    .rover[data-mood="running"] .launcher video,
    .rover[data-mood="running"] .avatar video {
      filter: saturate(1.2);
      transform: scale(1.02);
    }

    .rover[data-mood="typing"] .launcher {
      box-shadow: 0 20px 54px rgba(37, 99, 235, 0.26);
      border-color: rgba(37, 99, 235, 0.3);
    }

    .rover[data-mood="success"] .launcher {
      box-shadow: 0 20px 54px rgba(5, 150, 105, 0.28);
      border-color: rgba(5, 150, 105, 0.34);
    }

    .rover[data-mood="error"] .launcher {
      box-shadow: 0 20px 54px rgba(220, 38, 38, 0.28);
      border-color: rgba(220, 38, 38, 0.34);
    }

    .launcherFallback {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.7px;
    }

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
        radial-gradient(120% 80% at 100% 0%, rgba(255, 109, 37, 0.14), transparent 52%),
        linear-gradient(180deg, var(--rv-bg-0), var(--rv-bg-1));
      border: 1px solid var(--rv-border);
      border-radius: 24px;
      box-shadow: 0 30px 90px rgba(244, 93, 5, 0.18), 0 14px 36px rgba(15, 23, 42, 0.16);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483646;
      color: var(--rv-text);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    .panel.open { display: flex; }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 76, 0, 0.14);
      background: linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255, 244, 236, 0.9));
      min-height: 48px;
    }

    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid rgba(255, 76, 0, 0.22);
      background: #fff;
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
      color: #ff4c00;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.45px;
    }

    .meta {
      min-width: 44px;
      flex: 1 1 44px;
      display: flex;
      flex-direction: column;
      gap: 1px;
      overflow: hidden;
    }

    .title {
      font-size: 15px;
      font-weight: 700;
      color: #111827;
      letter-spacing: 0.2px;
    }

    .status {
      font-size: 11px;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      margin-left: auto;
      overflow: hidden;
    }

    .taskBtn,
    .traceBtn,
    .takeControl,
    .closeBtn {
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.22px;
      height: 22px;
      padding: 0 7px;
      cursor: pointer;
      border: 1px solid rgba(100, 116, 139, 0.24);
      background: rgba(255, 255, 255, 0.92);
      color: #334155;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .taskBtn:hover,
    .traceBtn:hover,
    .takeControl:hover,
    .closeBtn:hover {
      border-color: rgba(255, 76, 0, 0.35);
      color: #9a3412;
    }

    .taskBtn.endTask {
      border-color: rgba(239, 68, 68, 0.28);
      color: #991b1b;
      background: rgba(254, 242, 242, 0.9);
    }

    .traceBtn.active {
      border-color: rgba(255, 76, 0, 0.34);
      color: #9a3412;
      background: rgba(255, 240, 232, 0.92);
    }

    .modeBadge {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      border-radius: 999px;
      padding: 3px 6px;
      border: 1px solid transparent;
      flex: 0 0 auto;
    }

    .modeBadge.controller {
      color: #9a3412;
      background: rgba(255, 76, 0, 0.11);
      border-color: rgba(255, 76, 0, 0.22);
    }

    .modeBadge.observer {
      color: #475569;
      background: rgba(148, 163, 184, 0.16);
      border-color: rgba(100, 116, 139, 0.2);
    }

    .takeControl {
      display: none;
      border-color: rgba(255, 76, 0, 0.24);
      color: #9a3412;
      background: rgba(255, 76, 0, 0.08);
    }

    .takeControl.visible { display: inline-flex; }

    .closeBtn {
      width: 22px;
      min-width: 22px;
      padding: 0;
      display: grid;
      place-items: center;
      font-size: 14px;
      line-height: 1;
      color: #64748b;
    }

    .feed {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 12px 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: radial-gradient(circle at 10% 0%, rgba(255, 76, 0, 0.06), transparent 45%);
    }

    .entry {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .entry .stamp {
      font-size: 10px;
      color: #6b7280;
      align-self: flex-end;
      padding: 0 2px;
    }

    .entry.message { max-width: 90%; }
    .entry.message.user { align-self: flex-end; }
    .entry.message.assistant,
    .entry.message.system { align-self: flex-start; }

    .bubble {
      border-radius: 14px;
      padding: 10px 12px;
      line-height: 1.42;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid transparent;
    }

    .entry.message.user .bubble {
      background: linear-gradient(145deg, #ff4c00, #ff7a39);
      border-color: rgba(255, 76, 0, 0.4);
      color: #fff;
      box-shadow: 0 8px 18px rgba(255, 76, 0, 0.24);
    }

    .entry.message.assistant .bubble {
      background: rgba(255, 255, 255, 0.92);
      border-color: rgba(255, 76, 0, 0.2);
      color: #111827;
    }

    .entry.message.system .bubble {
      background: rgba(241, 245, 249, 0.94);
      border-color: rgba(148, 163, 184, 0.25);
      color: #334155;
      font-size: 11px;
    }

    .entry.trace {
      width: 100%;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 14px;
      padding: 9px 10px;
      background: rgba(255, 255, 255, 0.9);
      transition: all 140ms ease;
    }

    .entry.trace.pending {
      border-color: rgba(255, 76, 0, 0.24);
      background: rgba(255, 243, 236, 0.9);
    }

    .entry.trace.success {
      border-color: rgba(16, 185, 129, 0.24);
      background: rgba(236, 253, 245, 0.9);
    }

    .entry.trace.error {
      border-color: rgba(239, 68, 68, 0.26);
      background: rgba(254, 242, 242, 0.9);
    }

    .entry.trace.info {
      border-color: rgba(37, 99, 235, 0.22);
      background: rgba(239, 246, 255, 0.88);
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
      font-size: 9px;
      letter-spacing: 0.25px;
      text-transform: uppercase;
      font-weight: 700;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(255, 255, 255, 0.96);
      color: #334155;
      padding: 2px 7px;
      flex: 0 0 auto;
    }

    .traceTitle {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .traceTs {
      font-size: 10px;
      color: #6b7280;
      flex: 0 0 auto;
    }

    .traceDetail {
      font-size: 11px;
      line-height: 1.42;
      color: #475569;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .entry.trace.compact .traceDetail {
      display: none;
    }

    .taskSuggestion {
      display: none;
      border-top: 1px solid rgba(148, 163, 184, 0.18);
      padding: 8px 10px;
      background: rgba(255, 251, 235, 0.85);
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .taskSuggestion.visible {
      display: flex;
    }

    .taskSuggestionText {
      font-size: 11px;
      line-height: 1.35;
      color: #7c2d12;
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
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: rgba(255, 255, 255, 0.95);
      color: #334155;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.18px;
      padding: 4px 8px;
      cursor: pointer;
    }

    .taskSuggestionBtn.primary {
      border-color: rgba(255, 76, 0, 0.36);
      color: #9a3412;
      background: rgba(255, 241, 234, 0.9);
    }

    .composer {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border-top: 1px solid rgba(148, 163, 184, 0.2);
      padding: 10px;
      background: rgba(255, 255, 255, 0.95);
    }

    .composer textarea {
      flex: 1;
      resize: none;
      min-height: 42px;
      max-height: 96px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 12px;
      padding: 10px 11px;
      font-size: 12px;
      line-height: 1.35;
      font-family: inherit;
      color: #111827;
      background: #fff;
      outline: none;
    }

    .composer textarea:focus {
      border-color: rgba(255, 76, 0, 0.5);
      box-shadow: 0 0 0 3px rgba(255, 76, 0, 0.12);
    }

    .composer button {
      border: none;
      background: linear-gradient(145deg, #ff4c00, #ff7a39);
      color: #fff;
      border-radius: 11px;
      height: 42px;
      min-width: 78px;
      padding: 0 12px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.25px;
      cursor: pointer;
    }

    .composer button:hover { filter: brightness(0.98); }

    .resizeHandle {
      position: absolute;
      left: 8px;
      bottom: 8px;
      width: 14px;
      height: 14px;
      border-left: 2px solid rgba(148, 163, 184, 0.4);
      border-bottom: 2px solid rgba(148, 163, 184, 0.4);
      border-radius: 2px;
      cursor: nwse-resize;
      opacity: 0.8;
    }

    .feed::-webkit-scrollbar {
      width: 6px;
    }

    .feed::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.4);
      border-radius: 999px;
    }

    @media (max-width: 640px) {
      .launcher {
        right: 14px;
        bottom: 14px;
        width: 54px;
        height: 54px;
      }

      .panel {
        right: 8px;
        left: 8px;
        bottom: 78px;
        width: auto;
        min-width: 0;
        height: min(76vh, calc(100vh - 92px));
        border-radius: 18px;
      }

      .controls {
        gap: 3px;
      }

      .taskBtn,
      .traceBtn,
      .takeControl,
      .closeBtn {
        height: 20px;
        padding: 0 5px;
        font-size: 9px;
      }

      .modeBadge {
        font-size: 8px;
        padding: 2px 5px;
      }

      .resizeHandle {
        display: none;
      }
    }
  `;

  const wrapper = document.createElement('div');
  wrapper.className = 'rover';
  wrapper.dataset.mood = 'idle';

  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', 'Open Rover assistant');

  const launcherVideo = document.createElement('video');
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

  const launcherFallback = document.createElement('span');
  launcherFallback.className = 'launcherFallback';
  launcherFallback.textContent = 'RVR';

  launcher.appendChild(launcherVideo);
  launcher.appendChild(launcherFallback);

  const panel = document.createElement('div');
  panel.className = 'panel';

  const header = document.createElement('div');
  header.className = 'header';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  const avatarVideo = launcherVideo.cloneNode(true) as HTMLVideoElement;
  avatar.appendChild(avatarVideo);
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
  statusEl.textContent = 'ready';
  meta.appendChild(titleEl);
  meta.appendChild(statusEl);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const newTaskBtn = document.createElement('button');
  newTaskBtn.type = 'button';
  newTaskBtn.className = 'taskBtn newTask';
  newTaskBtn.textContent = 'New task';
  if (opts.showTaskControls === false) {
    newTaskBtn.style.display = 'none';
  }

  const endTaskBtn = document.createElement('button');
  endTaskBtn.type = 'button';
  endTaskBtn.className = 'taskBtn endTask';
  endTaskBtn.textContent = 'End';
  if (opts.showTaskControls === false) {
    endTaskBtn.style.display = 'none';
  }

  const traceToggleBtn = document.createElement('button');
  traceToggleBtn.type = 'button';
  traceToggleBtn.className = 'traceBtn';
  traceToggleBtn.textContent = 'Details';

  const modeBadge = document.createElement('span');
  modeBadge.className = 'modeBadge controller';
  modeBadge.textContent = 'active';

  const controlBtn = document.createElement('button');
  controlBtn.type = 'button';
  controlBtn.className = 'takeControl';
  controlBtn.textContent = 'Take control';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'closeBtn';
  closeBtn.setAttribute('aria-label', 'Close Rover panel');
  closeBtn.textContent = '×';

  controls.appendChild(newTaskBtn);
  controls.appendChild(endTaskBtn);
  controls.appendChild(traceToggleBtn);
  controls.appendChild(modeBadge);
  controls.appendChild(controlBtn);
  controls.appendChild(closeBtn);

  header.appendChild(avatar);
  header.appendChild(meta);
  header.appendChild(controls);

  const feed = document.createElement('div');
  feed.className = 'feed';

  const composer = document.createElement('form');
  composer.className = 'composer';
  composer.innerHTML = `
    <textarea rows="1" placeholder="Ask Rover to act on this website..."></textarea>
    <button type="submit">Send</button>
  `;

  const taskSuggestion = document.createElement('div');
  taskSuggestion.className = 'taskSuggestion';
  taskSuggestion.innerHTML = `
    <div class="taskSuggestionText"></div>
    <div class="taskSuggestionActions">
      <button type="button" class="taskSuggestionBtn primary">Start new</button>
      <button type="button" class="taskSuggestionBtn secondary">Continue</button>
    </div>
  `;

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resizeHandle';
  resizeHandle.setAttribute('aria-hidden', 'true');

  panel.appendChild(header);
  panel.appendChild(feed);
  panel.appendChild(taskSuggestion);
  panel.appendChild(composer);
  panel.appendChild(resizeHandle);

  wrapper.appendChild(launcher);
  wrapper.appendChild(panel);
  shadow.appendChild(style);
  shadow.appendChild(wrapper);

  const inputEl = composer.querySelector('textarea') as HTMLTextAreaElement;
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

  function setMascotMood(mood: 'idle' | 'typing' | 'running' | 'success' | 'error', holdMs = 0): void {
    wrapper.dataset.mood = mood;
    if (moodResetTimer != null) {
      window.clearTimeout(moodResetTimer);
      moodResetTimer = null;
    }
    if (holdMs > 0 && mood !== 'idle') {
      moodResetTimer = window.setTimeout(() => {
        wrapper.dataset.mood = 'idle';
        moodResetTimer = null;
      }, holdMs);
    }
  }

  function scrollFeedToBottom(): void {
    feed.scrollTop = feed.scrollHeight;
  }

  function syncComposerDisabledState(): void {
    inputEl.disabled = currentMode === 'observer' && !canComposeInObserver;
  }

  function setTraceExpanded(next: boolean): void {
    traceExpanded = next;
    traceToggleBtn.classList.toggle('active', traceExpanded);
    traceToggleBtn.textContent = traceExpanded ? 'Hide details' : 'Details';
    for (const item of traceOrder) {
      const status = item.dataset.status;
      const done = status === 'success' || status === 'error' || status === 'info';
      item.classList.toggle('compact', !traceExpanded && done);
    }
  }

  function open(): void {
    wrapper.style.display = '';
    panel.classList.add('open');
    setMascotMood('idle');
    opts.onOpen?.();
    if (!inputEl.disabled) inputEl.focus();
  }

  function close(): void {
    panel.classList.remove('open');
    setMascotMood('idle');
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
    bubble.textContent = clean;

    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.textContent = formatTime(Date.now());

    entry.appendChild(bubble);
    entry.appendChild(stamp);
    feed.appendChild(entry);
    if (role === 'user') setMascotMood('typing', 1200);
    else if (role === 'assistant') setMascotMood('success', 1400);
    else setMascotMood('running', 900);
    scrollFeedToBottom();
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

    const meta = document.createElement('div');
    meta.className = 'traceMeta';

    const stage = document.createElement('span');
    stage.className = 'traceStage';
    stage.textContent = 'step';

    const title = document.createElement('div');
    title.className = 'traceTitle';

    const ts = document.createElement('div');
    ts.className = 'traceTs';

    meta.appendChild(stage);
    meta.appendChild(title);
    top.appendChild(meta);
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
    const meta = top.querySelector('.traceMeta') as HTMLDivElement;
    const stageEl = meta.querySelector('.traceStage') as HTMLSpanElement;
    const title = top.querySelector('.traceTitle') as HTMLDivElement;
    const tsEl = top.querySelector('.traceTs') as HTMLDivElement;
    const detail = entry.querySelector('.traceDetail') as HTMLDivElement;
    const parsed = parseStageFromTitle(event.title || '');

    title.textContent = parsed.plainTitle || 'Step';
    stageEl.textContent = parsed.stage || event.kind || 'step';
    stageEl.style.display = parsed.stage || event.kind === 'status' || event.kind === 'plan' ? '' : 'none';
    tsEl.textContent = formatTime(ts);
    detail.textContent = sanitizeText(event.detail || '');
    detail.style.display = detail.textContent ? '' : 'none';

    entry.classList.remove('pending', 'success', 'error', 'info');
    entry.classList.add(status);
    entry.dataset.status = status;
    entry.dataset.kind = event.kind;

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
    scrollFeedToBottom();
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
    statusEl.textContent = clean;
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
    meta?: {
      controllerRuntimeId?: string;
      localLogicalTabId?: number;
      activeLogicalTabId?: number;
      canTakeControl?: boolean;
      canComposeInObserver?: boolean;
      note?: string;
    },
  ): void {
    currentMode = mode;
    canComposeInObserver = mode === 'observer' ? meta?.canComposeInObserver === true : true;
    syncComposerDisabledState();

    modeBadge.classList.remove('controller', 'observer');
    modeBadge.classList.add(mode);

    if (mode === 'controller') {
      modeBadge.textContent = 'active';
      controlBtn.classList.remove('visible');
      inputEl.placeholder = 'Ask Rover to act on this website...';
    } else {
      modeBadge.textContent = 'observer';
      if (meta?.canTakeControl !== false) {
        controlBtn.classList.add('visible');
      } else {
        controlBtn.classList.remove('visible');
      }

      if (meta?.note) {
        inputEl.placeholder = meta.note;
      } else if (canComposeInObserver) {
        inputEl.placeholder = 'Send to take control and run here.';
      } else if (meta?.activeLogicalTabId && meta?.localLogicalTabId && meta.activeLogicalTabId !== meta.localLogicalTabId) {
        inputEl.placeholder = `Observing: Rover is acting in tab #${meta.activeLogicalTabId}`;
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
    host.remove();
  }

  launcher.addEventListener('click', () => {
    if (panel.classList.contains('open')) close();
    else open();
  });

  closeBtn.addEventListener('click', () => close());

  controlBtn.addEventListener('click', () => {
    opts.onRequestControl?.();
  });

  newTaskBtn.addEventListener('click', () => {
    opts.onNewTask?.();
  });

  endTaskBtn.addEventListener('click', () => {
    opts.onEndTask?.();
  });

  traceToggleBtn.addEventListener('click', () => {
    setTraceExpanded(!traceExpanded);
  });

  taskSuggestionPrimaryBtn.addEventListener('click', () => {
    opts.onTaskSuggestionPrimary?.();
  });

  taskSuggestionSecondaryBtn.addEventListener('click', () => {
    opts.onTaskSuggestionSecondary?.();
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(96, Math.max(42, inputEl.scrollHeight))}px`;
  });

  composer.addEventListener('submit', ev => {
    ev.preventDefault();
    if (inputEl.disabled) return;
    const text = sanitizeText(inputEl.value);
    if (!text) return;
    setTaskSuggestion({ visible: false });
    opts.onSend(text);
    inputEl.value = '';
    inputEl.style.height = '42px';
  });

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

  const showLauncherFallback = () => {
    launcherVideo.style.display = 'none';
    launcherFallback.style.display = 'grid';
  };
  const showAvatarFallback = () => {
    avatarVideo.style.display = 'none';
    avatarFallback.style.display = 'grid';
  };

  launcherVideo.addEventListener('error', showLauncherFallback, { once: true });
  avatarVideo.addEventListener('error', showAvatarFallback, { once: true });

  launcherFallback.style.display = 'none';
  avatarFallback.style.display = 'none';

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
