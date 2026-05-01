import type { RoverExperienceConfig, RoverExecutionMode } from '../types.js';
import { mountMascotMedia } from '../mascot-media.js';

export type HeaderOptions = {
  agentName: string;
  agentInitial: string;
  mascotDisabled: boolean;
  mascotImage?: string;
  mascotMp4?: string;
  mascotWebm?: string;
  panelResizable: boolean;
  showTaskControls: boolean;
  allowSoundToggle: boolean;
  isMuted: boolean;
  allowNarrationToggle: boolean;
  narrationEnabled: boolean;
  allowSpotlightToggle: boolean;
  spotlightEnabled: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onCycleSize: () => void;
  onNewTask: () => void;
  onEndTask: () => void;
  onCancelRun: () => void;
  onRequestControl: () => void;
  onToggleMute: () => void;
  onToggleNarration: () => void;
  onToggleSpotlight: () => void;
  onOpenVoiceSettings: () => void;
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
  setNarrationEnabled: (enabled: boolean) => void;
  setNarrationAvailable: (available: boolean) => void;
  setSpotlightEnabled: (enabled: boolean) => void;
  setSpotlightAvailable: (available: boolean) => void;
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
  const avatarMedia = mountMascotMedia({
    container: avatar,
    token: agentInitial,
    disabled: mascotDisabled,
    imageUrl: opts.mascotImage,
    mp4Url: opts.mascotMp4,
    webmUrl: opts.mascotWebm,
    muted: opts.isMuted,
    fallbackClassName: 'avatarFallback',
  });
  const avatarVideo = avatarMedia.video;

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

  let narrationEnabled = opts.narrationEnabled;
  let narrationAvailable = opts.allowNarrationToggle;
  const narrationBtn = document.createElement('button');
  narrationBtn.type = 'button';
  narrationBtn.className = 'narrationBtn';
  narrationBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onToggleNarration();
  });

  let spotlightEnabled = opts.spotlightEnabled;
  let spotlightAvailable = opts.allowSpotlightToggle;
  const spotlightBtn = document.createElement('button');
  spotlightBtn.type = 'button';
  spotlightBtn.className = 'spotlightBtn';
  spotlightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onToggleSpotlight();
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
  headerActions.appendChild(narrationBtn);
  headerActions.appendChild(spotlightBtn);
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

  const menuNarrationToggle = document.createElement('button');
  menuNarrationToggle.type = 'button';
  menuNarrationToggle.className = 'menuItem';
  menuNarrationToggle.addEventListener('click', () => {
    closeOverflow();
    opts.onToggleNarration();
  });

  const menuSpotlightToggle = document.createElement('button');
  menuSpotlightToggle.type = 'button';
  menuSpotlightToggle.className = 'menuItem';
  menuSpotlightToggle.addEventListener('click', () => {
    closeOverflow();
    opts.onToggleSpotlight();
  });

  const menuVoiceSettings = document.createElement('button');
  menuVoiceSettings.type = 'button';
  menuVoiceSettings.className = 'menuItem';
  menuVoiceSettings.textContent = 'Voice & language';
  menuVoiceSettings.addEventListener('click', () => {
    closeOverflow();
    opts.onOpenVoiceSettings();
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
  overflowMenu.appendChild(menuNarrationToggle);
  overflowMenu.appendChild(menuSpotlightToggle);
  overflowMenu.appendChild(menuVoiceSettings);
  overflowMenu.appendChild(menuTakeControl);

  if (!opts.showTaskControls) {
    menuNewTask.style.display = 'none';
    menuEndTask.style.display = 'none';
  }
  if (!opts.allowSoundToggle) {
    menuMuteToggle.style.display = 'none';
  }

  function syncNarrationButton(): void {
    const label = narrationEnabled ? 'Turn off step narration' : 'Turn on step narration';
    narrationBtn.setAttribute('aria-label', label);
    narrationBtn.setAttribute('aria-pressed', narrationEnabled ? 'true' : 'false');
    narrationBtn.classList.toggle('enabled', narrationEnabled);
    narrationBtn.style.display = narrationAvailable ? '' : 'none';
    narrationBtn.innerHTML = narrationEnabled
      ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="m19 9-4 4"></path><path d="m15 9 4 4"></path></svg>';
    menuNarrationToggle.textContent = narrationEnabled ? 'Turn off narration' : 'Turn on narration';
    menuNarrationToggle.style.display = narrationAvailable ? '' : 'none';
    menuVoiceSettings.style.display = narrationAvailable ? '' : 'none';
  }

  function syncSpotlightButton(): void {
    const label = spotlightEnabled ? 'Turn off action highlights' : 'Turn on action highlights';
    spotlightBtn.setAttribute('aria-label', label);
    spotlightBtn.setAttribute('aria-pressed', spotlightEnabled ? 'true' : 'false');
    spotlightBtn.classList.toggle('enabled', spotlightEnabled);
    spotlightBtn.style.display = spotlightAvailable ? '' : 'none';
    spotlightBtn.innerHTML = spotlightEnabled
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path><path d="M4.93 4.93l2.12 2.12"></path><path d="M16.95 16.95l2.12 2.12"></path><path d="M4.93 19.07l2.12-2.12"></path><path d="M16.95 7.05l2.12-2.12"></path></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><line x1="4" y1="4" x2="20" y2="20"></line></svg>';
    menuSpotlightToggle.textContent = spotlightEnabled ? 'Turn off action highlights' : 'Turn on action highlights';
    menuSpotlightToggle.style.display = spotlightAvailable ? '' : 'none';
  }

  function syncOverflowVisibility(): void {
    const hasVisibleMenuItem =
      opts.showTaskControls ||
      opts.allowSoundToggle ||
      narrationAvailable ||
      spotlightAvailable ||
      menuTakeControl.style.display !== 'none';
    menuDivider.style.display = opts.allowSoundToggle || narrationAvailable || spotlightAvailable ? '' : 'none';
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
  syncNarrationButton();
  syncSpotlightButton();
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
      avatarMedia.setMuted(muted);
    },
    setNarrationEnabled(enabled: boolean) {
      narrationEnabled = enabled;
      syncNarrationButton();
      syncOverflowVisibility();
    },
    setNarrationAvailable(available: boolean) {
      narrationAvailable = available;
      syncNarrationButton();
      syncOverflowVisibility();
    },
    setSpotlightEnabled(enabled: boolean) {
      spotlightEnabled = enabled;
      syncSpotlightButton();
      syncOverflowVisibility();
    },
    setSpotlightAvailable(available: boolean) {
      spotlightAvailable = available;
      syncSpotlightButton();
      syncOverflowVisibility();
    },
    closeOverflow,
    update(_experience: RoverExperienceConfig) {
      // Future: update avatar, title, etc.
    },
    destroy() {},
  };
}
