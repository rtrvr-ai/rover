import type { RoverExperienceConfig, RoverExecutionMode } from '../types.js';

export type HeaderOptions = {
  agentName: string;
  agentInitial: string;
  mascotDisabled: boolean;
  launcherVideo: HTMLVideoElement | null;
  panelResizable: boolean;
  showTaskControls: boolean;
  allowSoundToggle: boolean;
  isMuted: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onCycleSize: () => void;
  onNewTask: () => void;
  onEndTask: () => void;
  onCancelRun: () => void;
  onRequestControl: () => void;
  onToggleMute: () => void;
  onToggleConversations: () => void;
};

export type HeaderComponent = {
  root: HTMLDivElement;
  avatarVideo: HTMLVideoElement | null;
  statusText: HTMLSpanElement;
  modeLabel: HTMLSpanElement;
  cancelPill: HTMLButtonElement;
  executionBar: HTMLDivElement;
  overflowMenu: HTMLDivElement;
  conversationListBtn: HTMLButtonElement;
  menuTakeControl: HTMLButtonElement;
  setRunning: (running: boolean) => void;
  setStatus: (text: string) => void;
  setExecutionMode: (mode: RoverExecutionMode, meta?: Record<string, unknown>) => void;
  setMuted: (muted: boolean) => void;
  closeOverflow: () => void;
  update: (experience: RoverExperienceConfig) => void;
  destroy: () => void;
};

export function createHeader(opts: HeaderOptions): HeaderComponent {
  const { agentName, agentInitial, mascotDisabled } = opts;

  const header = document.createElement('div');
  header.className = 'header';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  let avatarVideo: HTMLVideoElement | null = null;
  if (!mascotDisabled && opts.launcherVideo) {
    avatarVideo = opts.launcherVideo.cloneNode(true) as HTMLVideoElement;
    avatar.appendChild(avatarVideo);
  }
  const avatarFallback = document.createElement('span');
  avatarFallback.className = 'avatarFallback';
  avatarFallback.textContent = agentInitial;
  avatar.appendChild(avatarFallback);

  if (avatarVideo) {
    const showFallback = () => {
      avatarVideo!.style.display = 'none';
      avatarFallback.style.display = 'grid';
    };
    avatarVideo.addEventListener('error', showFallback, { once: true });
    avatarFallback.style.display = 'none';
  }

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

  const headerActions = document.createElement('div');
  headerActions.className = 'headerActions';

  const sizeBtn = document.createElement('button');
  sizeBtn.type = 'button';
  sizeBtn.className = 'sizeBtn hidden';
  sizeBtn.setAttribute('aria-label', 'Resize Rover panel');
  sizeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 4H4v4"></path><path d="M4 4l6 6"></path><path d="M16 20h4v-4"></path><path d="M20 20l-6-6"></path><path d="M20 8V4h-4"></path><path d="M20 4l-6 6"></path><path d="M8 20H4v-4"></path><path d="M4 20l6-6"></path></svg>';
  sizeBtn.addEventListener('click', () => opts.onCycleSize());

  const conversationListBtn = document.createElement('button');
  conversationListBtn.type = 'button';
  conversationListBtn.className = 'conversationListBtn';
  conversationListBtn.setAttribute('aria-label', 'Conversations');
  conversationListBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  conversationListBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onToggleConversations();
  });

  const overflowBtn = document.createElement('button');
  overflowBtn.type = 'button';
  overflowBtn.className = 'overflowBtn';
  overflowBtn.setAttribute('aria-label', 'More options');
  overflowBtn.innerHTML = '&#x22EF;';

  const cancelPill = document.createElement('button');
  cancelPill.type = 'button';
  cancelPill.className = 'cancelPill';
  cancelPill.setAttribute('aria-label', 'Cancel task');
  const cancelIcon = document.createElement('span');
  cancelIcon.className = 'cancelIcon';
  cancelPill.appendChild(cancelIcon);
  cancelPill.appendChild(document.createTextNode(' Cancel'));
  cancelPill.addEventListener('click', () => opts.onCancelRun());

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'closeBtn';
  closeBtn.setAttribute('aria-label', 'Close Rover panel');
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => opts.onClose());

  headerActions.appendChild(sizeBtn);
  headerActions.appendChild(conversationListBtn);
  headerActions.appendChild(overflowBtn);
  headerActions.appendChild(cancelPill);
  headerActions.appendChild(closeBtn);

  // Overflow menu
  let overflowOpen = false;
  let runningState = false;
  const overflowMenu = document.createElement('div');
  overflowMenu.className = 'overflowMenu';

  const menuNewTask = document.createElement('button');
  menuNewTask.type = 'button';
  menuNewTask.className = 'menuItem';
  menuNewTask.textContent = 'New task';
  menuNewTask.addEventListener('click', () => { closeOverflow(); opts.onNewTask(); });

  const menuEndTask = document.createElement('button');
  menuEndTask.type = 'button';
  menuEndTask.className = 'menuItem danger';
  menuEndTask.textContent = 'End task';
  menuEndTask.addEventListener('click', () => { closeOverflow(); opts.onEndTask(); });

  const menuDivider = document.createElement('div');
  menuDivider.className = 'menuDivider';

  let isMuted = opts.isMuted;
  const menuMuteToggle = document.createElement('button');
  menuMuteToggle.type = 'button';
  menuMuteToggle.className = 'menuItem';
  menuMuteToggle.textContent = isMuted ? 'Unmute sounds' : 'Mute sounds';
  menuMuteToggle.addEventListener('click', () => {
    closeOverflow();
    opts.onToggleMute();
    isMuted = !isMuted;
    menuMuteToggle.textContent = isMuted ? 'Unmute sounds' : 'Mute sounds';
  });

  const menuTakeControl = document.createElement('button');
  menuTakeControl.type = 'button';
  menuTakeControl.className = 'menuItem';
  menuTakeControl.textContent = 'Take control';
  menuTakeControl.style.display = 'none';
  menuTakeControl.addEventListener('click', () => { closeOverflow(); opts.onRequestControl(); });

  overflowMenu.appendChild(menuNewTask);
  overflowMenu.appendChild(menuEndTask);
  overflowMenu.appendChild(menuDivider);
  overflowMenu.appendChild(menuMuteToggle);
  overflowMenu.appendChild(menuTakeControl);

  if (!opts.showTaskControls) {
    menuNewTask.style.display = 'none';
    menuEndTask.style.display = 'none';
  }
  if (!opts.allowSoundToggle) {
    menuDivider.style.display = 'none';
    menuMuteToggle.style.display = 'none';
  }

  function syncOverflowVisibility(): void {
    const hasVisibleMenuItem = opts.showTaskControls || opts.allowSoundToggle || menuTakeControl.style.display !== 'none';
    overflowBtn.style.display = runningState || !hasVisibleMenuItem ? 'none' : '';
  }

  overflowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    overflowOpen = !overflowOpen;
    overflowMenu.classList.toggle('visible', overflowOpen);
  });

  function closeOverflow(): void {
    overflowOpen = false;
    overflowMenu.classList.remove('visible');
  }

  const executionBar = document.createElement('div');
  executionBar.className = 'executionBar';

  header.appendChild(avatar);
  header.appendChild(meta);
  header.appendChild(headerActions);
  header.appendChild(overflowMenu);
  header.appendChild(executionBar);
  syncOverflowVisibility();

  return {
    root: header,
    avatarVideo,
    statusText,
    modeLabel,
    cancelPill,
    executionBar,
    overflowMenu,
    conversationListBtn,
    menuTakeControl,
    setRunning(running: boolean) {
      runningState = running;
      cancelPill.classList.toggle('visible', running);
      conversationListBtn.style.display = running ? 'none' : '';
      executionBar.classList.toggle('active', running);
      syncOverflowVisibility();
    },
    setStatus(text: string) {
      statusText.textContent = text;
    },
    setExecutionMode(mode: RoverExecutionMode, executionMeta?: Record<string, unknown>) {
      modeLabel.classList.remove('controller', 'observer');
      modeLabel.classList.add(mode);
      if (mode === 'controller') {
        modeLabel.textContent = 'active';
        menuTakeControl.style.display = 'none';
      } else {
        modeLabel.textContent = 'observer';
        menuTakeControl.style.display = executionMeta?.canTakeControl !== false ? '' : 'none';
      }
      syncOverflowVisibility();
    },
    setMuted(muted: boolean) {
      isMuted = muted;
      menuMuteToggle.textContent = muted ? 'Unmute sounds' : 'Mute sounds';
      if (avatarVideo) avatarVideo.muted = muted;
    },
    closeOverflow,
    update(_experience: RoverExperienceConfig) {
      // Future: update avatar, title, etc.
    },
    destroy() {},
  };
}
