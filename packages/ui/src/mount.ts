/**
 * Rover UI — Slim Orchestrator
 *
 * Wires together modular components into the mountWidget() entry point.
 * All DOM construction, styles, and behavior are delegated to extracted modules.
 */

// Re-export types for SDK compatibility
export type {
  RoverShortcut,
  RoverAskUserQuestion,
  RoverAskUserAnswerMeta,
  RoverTimelineKind,
  RoverExecutionMode,
  RoverTimelineEvent,
  RoverMessageBlock,
  RoverTaskSuggestion,
  RoverTabInfo,
  ConversationListItem,
  RoverPresenceState,
  RoverUi,
  RoverExperienceConfig,
  RoverVoiceConfig,
  MountOptions,
  RoverMood,
} from './types.js';

// Re-export constants for SDK compatibility
export {
  ROVER_WIDGET_MOBILE_BREAKPOINT_PX,
  ROVER_WIDGET_LAUNCHER_DESKTOP_INSET_PX,
  ROVER_WIDGET_LAUNCHER_MOBILE_INSET_PX,
  ROVER_WIDGET_LAUNCHER_DESKTOP_SIZE_PX,
  ROVER_WIDGET_LAUNCHER_MOBILE_SIZE_PX,
} from './config.js';

import type {
  RoverUi,
  MountOptions,
  RoverExperienceConfig,
  RoverExecutionMode,
  RoverAskUserQuestion,
  RoverAskUserAnswerMeta,
  RoverShortcut,
  RoverMessageBlock,
  RoverTaskSuggestion,
  RoverTabInfo,
  ConversationListItem,
  RoverPresenceState,
  RoverVoiceConfig,
} from './types.js';
import type { VoiceRecognitionError, VoiceTranscriber } from './voice.js';

import {
  resolveAgentName,
  deriveAgentInitial,
  deriveLauncherToken,
  resolveMountExperienceConfig,
  sanitizeExperienceConfig,
  sanitizeVoiceConfig,
  sanitizeText,
  normalizeVoiceAutoStopMs,
  deriveAccentTokens,
  DEFAULT_AGENT_NAME,
  DEFAULT_ATTACHMENT_LIMIT,
  VOICE_AUTO_STOP_DEFAULT_MS,
  VOICE_INITIAL_SPEECH_GRACE_MS,
  VOICE_MAX_SESSION_MS,
  VOICE_MAX_PRE_SPEECH_RESTARTS,
  VOICE_RESTART_DELAY_MS,
  SHORTCUTS_RENDER_LIMIT,
  GREETING_REVEAL_DELAY_MS,
} from './config.js';
import { resolveMascotMutePreference } from './audio.js';
import { composeVoiceDraft, formatTime, renderMessageBlock } from './dom-helpers.js';
import { createStateMachine } from './state-machine.js';
import { morphSeedToWindow, morphWindowToSeed, morphBarToSeed, morphSeedToBar, prefersReducedMotion, scaleDuration } from './animation.js';
import { createSeed } from './components/seed.js';
import { createHeader } from './components/header.js';
import { createFeed } from './components/feed.js';
import { createComposer } from './components/composer.js';
import { createShortcuts } from './components/shortcuts.js';
import { createWindow } from './components/window.js';
import { createBrowserVoiceTranscriber, createAudioAnalyser } from './voice.js';
import { createInputBar } from './components/input-bar.js';
import { createCommandBar } from './components/command-bar.js';
import { createParticleSystem } from './components/particles.js';
import { createFilamentSystem } from './components/filaments.js';
import { createLiveStack } from './components/live-stack.js';

// Style imports
import { baseStyles } from './styles/base.css.js';
import { animationStyles } from './styles/animations.css.js';
import { seedStyles } from './styles/seed.css.js';
import { windowStyles } from './styles/window.css.js';
import { responsiveStyles } from './styles/responsive.css.js';
import { commandBarStyles } from './styles/command-bar.css.js';
import { effectsStyles } from './styles/effects.css.js';
import { inputBarStyles } from './styles/input-bar.css.js';
import { liveStackStyles } from './styles/live-stack.css.js';

export function mountWidget(opts: MountOptions): RoverUi {
  const agentName = resolveAgentName(opts.agent?.name);
  const agentInitial = deriveAgentInitial(agentName);
  const launcherToken = deriveLauncherToken(agentName);
  const mascotDisabled = opts.mascot?.disabled === true;
  let experience = resolveMountExperienceConfig(opts, agentName, mascotDisabled);
  let visitorName: string | undefined = opts.visitorName;
  const panelResizable = opts.panel?.resizable !== false;

  // ── Shadow DOM Setup ──
  const host = document.createElement('div');
  host.id = 'rover-widget-root';
  (document.body || document.documentElement).appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  // Self-hosted font loading
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

  // Inject all styles
  const style = document.createElement('style');
  style.textContent = baseStyles + animationStyles + seedStyles + windowStyles + responsiveStyles + commandBarStyles + effectsStyles + inputBarStyles + liveStackStyles;
  shadow.appendChild(style);

  // ── Wrapper ──
  const wrapper = document.createElement('div');
  wrapper.className = 'rover';
  wrapper.dataset.mood = 'idle';
  wrapper.dataset.shell = 'presence';

  // ── State Machine ──
  const stateMachine = createStateMachine('seed');

  // ── Mute State ──
  const mutePreference = resolveMascotMutePreference({
    siteId: opts.siteId,
    host: window.location.hostname,
    muted: opts.muted,
    mascot: opts.mascot,
    readStored: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
  });
  const allowSoundToggle = mutePreference.soundEnabled && !mascotDisabled;
  let isMuted = mutePreference.isMuted;

  function toggleMute(): void {
    if (!allowSoundToggle) return;
    isMuted = !isMuted;
    if (mutePreference.storageKey) {
      try { localStorage.setItem(mutePreference.storageKey, String(isMuted)); } catch { /* ignore */ }
    }
    seed.setMuted(isMuted);
    headerComp.setMuted(isMuted);
    inputBar.setMuted(isMuted);
  }

  // ── Seed Component ──
  const seed = createSeed({
    agentName,
    launcherToken,
    mascotDisabled,
    mascotMp4: opts.mascot?.mp4Url,
    mascotWebm: opts.mascot?.webmUrl,
    experience,
    siteId: opts.siteId,
    onClick: () => openToBar(),
  });

  // ── Window Component ──
  const win = createWindow({
    panelResizable,
    experience,
    agentName,
    onClose: close,
  });

  // ── Conversation Drawer State ──
  let drawerOpen = false;
  function toggleConversations(): void {
    drawerOpen = !drawerOpen;
    if (drawerOpen) win.conversationDrawer.classList.add('open');
    else win.conversationDrawer.classList.remove('open');
  }
  win.conversationDrawerCloseBtn.addEventListener('click', () => {
    drawerOpen = false;
    win.conversationDrawer.classList.remove('open');
  });
  win.conversationNewBtn.addEventListener('click', () => {
    drawerOpen = false;
    win.conversationDrawer.classList.remove('open');
    opts.onNewTask?.();
  });

  // ── Header Component ──
  let isRunning = false;
  let pendingConfirmAction: 'new_task' | 'end_task' | null = null;
  let userMinimized = false;

  const headerComp = createHeader({
    agentName,
    agentInitial,
    mascotDisabled,
    launcherVideo: seed.video,
    panelResizable,
    showTaskControls: opts.showTaskControls !== false,
    allowSoundToggle,
    isMuted,
    onClose: close,
    onMinimize: () => minimize(),
    onCycleSize: () => win.cyclePanelSize(),
    onNewTask: () => {
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
    },
    onEndTask: () => {
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
    },
    onCancelRun: () => opts.onCancelRun?.(),
    onRequestControl: () => opts.onRequestControl?.(),
    onToggleMute: toggleMute,
    onToggleConversations: toggleConversations,
  });

  // ── Feed Component ──
  const feedComp = createFeed({
    thoughtStyle: opts.thoughtStyle,
    stream: experience.stream,
  });

  // ── Shortcuts Component ──
  const shortcutsComp = createShortcuts(agentName, visitorName);
  let currentShortcuts: RoverShortcut[] = opts.shortcuts?.slice(0, SHORTCUTS_RENDER_LIMIT) || [];
  if (currentShortcuts.length > 0) {
    shortcutsComp.render(currentShortcuts, opts.onShortcutClick);
  }
  feedComp.feed.appendChild(shortcutsComp.emptyState);

  // ── Command Bar ──
  const commandBar = createCommandBar({
    onSelect: (shortcut) => {
      opts.onShortcutClick?.(shortcut);
    },
    onClose: () => { /* no-op, just closes */ },
  });
  if (currentShortcuts.length > 0) {
    commandBar.setItems(currentShortcuts);
  }

  // ── Input Bar Component ──
  const inputBar = createInputBar({
    mascotDisabled,
    mascotMp4: opts.mascot?.mp4Url,
    mascotWebm: opts.mascot?.webmUrl,
    launcherVideo: seed.video,
    launcherToken,
    isMuted,
    onExpand: () => {
      if (stateMachine.getState() === 'window') minimize();
      else maximize();
    },
    onClose: () => closeFromBar(),
  });

  // ── Particle System ──
  const isMobileViewport = (): boolean => (window.visualViewport?.width ?? window.innerWidth ?? 640) <= 640;
  const particleSystem = createParticleSystem({
    container: seed.root,
    reducedMotion: prefersReducedMotion(),
    mobile: isMobileViewport(),
    color: experience.theme?.accentColor || 'rgba(255, 76, 0, 0.6)',
  });

  // ── Filament System ──
  const filamentSystem = createFilamentSystem({
    container: wrapper,
    panel: win.panel,
    resolveElement: opts.resolveElement,
  });

  // ── Audio Analyser ──
  const audioAnalyser = createAudioAnalyser({
    onFrequencyData: (avg) => {
      const scale = 1 + avg * 0.08;
      seed.root.style.setProperty('--rv-audio-scale', String(scale));
    },
  });

  // ── Tide-line Progress ──
  let toolStartCount = 0;
  let toolResultCount = 0;
  function updateTideProgress(): void {
    const progress = toolStartCount > 0 ? Math.min(1, toolResultCount / toolStartCount) * 100 : 0;
    win.panel.style.setProperty('--rv-tide-progress', `${progress}%`);
  }

  // ── Pulse Badge ──
  const pulseBadge = document.createElement('span');
  pulseBadge.className = 'pulse-badge';
  pulseBadge.style.display = 'none';
  pulseBadge.textContent = '0';
  seed.root.appendChild(pulseBadge);

  // ── Pulse State (minimized but running) ──
  let pulseActive = false;
  function syncPulseState(): void {
    const currentState = stateMachine.getState();
    const shouldPulse = currentState === 'seed' && isRunning;
    if (shouldPulse === pulseActive) return;
    pulseActive = shouldPulse;
    seed.root.classList.toggle('pulse', pulseActive);
    if (experience.motion?.particles !== false) {
      particleSystem.setMode(pulseActive ? 'pulse' : 'idle');
    }
    pulseBadge.style.display = pulseActive ? 'flex' : 'none';
    // Sync bar running indicator
    inputBar.setRunning(isRunning);
  }

  // ── Tool Ripple Helper ──
  function spawnToolRipple(x: number, y: number): void {
    const ripple = document.createElement('div');
    ripple.className = 'tool-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    wrapper.appendChild(ripple);
    try {
      const anim = ripple.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0)', opacity: 0.6 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
        ],
        { duration: 500, fill: 'forwards' },
      );
      anim.onfinish = () => ripple.remove();
    } catch {
      setTimeout(() => ripple.remove(), 500);
    }
  }

  // ── Voice State ──
  let voiceConfig = sanitizeVoiceConfig(opts.voice);
  let voiceState: 'idle' | 'listening' | 'error' = 'idle';
  let voiceErrorMessage = '';
  let voiceDraftBase = '';
  let voiceFinalTranscript = '';
  let voiceInterimTranscript = '';
  let pendingVoiceSubmit = false;
  let voiceStopReason: string | null = null;
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

  function clearVoiceStopTimer(): void { if (voiceStopTimer) { clearTimeout(voiceStopTimer); voiceStopTimer = null; } }
  function clearVoiceGraceTimer(): void { if (voiceGraceTimer) { clearTimeout(voiceGraceTimer); voiceGraceTimer = null; } }
  function clearVoiceSessionTimer(): void { if (voiceSessionTimer) { clearTimeout(voiceSessionTimer); voiceSessionTimer = null; } }
  function clearVoiceRestartTimer(): void { if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; } }

  let greetingShowTimer: ReturnType<typeof setTimeout> | null = null;
  let greetingDismissTimer: ReturnType<typeof setTimeout> | null = null;
  function clearGreetingTimers(): void {
    if (greetingShowTimer) { clearTimeout(greetingShowTimer); greetingShowTimer = null; }
    if (greetingDismissTimer) { clearTimeout(greetingDismissTimer); greetingDismissTimer = null; }
  }
  function resetVoiceDraftState(): void { voiceDraftBase = ''; voiceFinalTranscript = ''; voiceInterimTranscript = ''; }
  function resetVoiceSessionState(): void {
    clearVoiceStopTimer(); clearVoiceGraceTimer(); clearVoiceSessionTimer(); clearVoiceRestartTimer();
    voiceSessionStartedAt = 0; voiceHasSpeech = false; voiceSpeechActive = false;
    voicePreSpeechRestartCount = 0; voiceLastError = null; voiceErrorTelemetrySent = false;
    voiceStartTelemetryPending = false;
  }
  function buildVoiceDraft(): string { return composeVoiceDraft(voiceDraftBase, voiceFinalTranscript, voiceInterimTranscript); }
  function applyVoiceDraft(): void { composerComp.setText(buildVoiceDraft()); }
  function getVoiceAutoStopMs(): number { return normalizeVoiceAutoStopMs(voiceConfig?.autoStopMs); }
  function getVoiceSessionDurationMs(): number { return voiceSessionStartedAt ? Math.max(0, Date.now() - voiceSessionStartedAt) : 0; }
  function emitVoiceTelemetry(event: string, payload?: Record<string, unknown>): void {
    opts.onVoiceTelemetry?.(event as any, payload);
  }
  function buildVoiceTelemetryContext(extra?: Record<string, unknown>): Record<string, unknown> {
    return { hadSpeech: voiceHasSpeech, restartCount: voicePreSpeechRestartCount, durationMs: getVoiceSessionDurationMs(), autoStopMs: getVoiceAutoStopMs(), ...(extra || {}) };
  }
  function createNoSpeechVoiceError(): VoiceRecognitionError {
    return { code: 'no_speech', message: 'No speech was detected.', recoverable: true };
  }
  function emitVoiceErrorTelemetry(error: VoiceRecognitionError): void {
    if (!voiceErrorTelemetrySent) {
      emitVoiceTelemetry('voice_error', buildVoiceTelemetryContext({ code: error.code, recoverable: error.recoverable }));
      voiceErrorTelemetrySent = true;
    }
    if (error.code === 'permission_denied') {
      emitVoiceTelemetry('voice_permission_denied', buildVoiceTelemetryContext({ code: error.code }));
    }
  }

  function syncVoiceUi(): void {
    const enabled = voiceConfig?.enabled === true && experience.inputs?.voice !== false;
    const supported = voiceProvider.isSupported();
    composerComp.setVoiceVisible(enabled && supported);
    composerComp.setVoiceActive(voiceState === 'listening');
    if (voiceState === 'error' && voiceErrorMessage) {
      composerComp.setStatusMessage(voiceErrorMessage, 'error');
      return;
    }
    if (voiceState === 'listening') {
      composerComp.setStatusMessage(voiceHasSpeech ? "Listening. Pause briefly when you're done." : "Listening. Start speaking when you're ready.");
      return;
    }
    if (enabled && !supported) {
      composerComp.setStatusMessage('Voice dictation is not available in this browser.');
      return;
    }
    composerComp.setStatusMessage('');
  }

  function canRestartVoiceBeforeSpeech(error?: VoiceRecognitionError | null): boolean {
    if (voiceState !== 'listening' || voiceHasSpeech || voiceStopReason) return false;
    if (voicePreSpeechRestartCount >= VOICE_MAX_PRE_SPEECH_RESTARTS) return false;
    const dur = getVoiceSessionDurationMs();
    if (dur >= VOICE_INITIAL_SPEECH_GRACE_MS || dur >= VOICE_MAX_SESSION_MS) return false;
    if (!error) return true;
    return error.code === 'no_speech' || error.code === 'aborted' || error.code === 'unknown';
  }

  function scheduleVoiceGraceTimeout(): void {
    if (voiceState !== 'listening' || voiceHasSpeech || !voiceSessionStartedAt) return;
    clearVoiceGraceTimer();
    const remainingMs = VOICE_INITIAL_SPEECH_GRACE_MS - getVoiceSessionDurationMs();
    if (remainingMs <= 0) {
      const error = voiceLastError?.code === 'no_speech' ? voiceLastError : createNoSpeechVoiceError();
      voiceStopReason = 'no_speech'; voiceState = 'error'; voiceErrorMessage = error.message;
      emitVoiceErrorTelemetry(error); syncVoiceUi(); voiceProvider.stop(); return;
    }
    voiceGraceTimer = setTimeout(() => {
      if (voiceState !== 'listening' || voiceHasSpeech) return;
      const error = createNoSpeechVoiceError();
      voiceLastError = error; voiceStopReason = 'no_speech'; voiceState = 'error'; voiceErrorMessage = error.message;
      emitVoiceErrorTelemetry(error); syncVoiceUi(); voiceProvider.stop();
    }, remainingMs);
  }

  function scheduleVoiceSessionTimeout(): void {
    if (voiceState !== 'listening' || !voiceSessionStartedAt) return;
    clearVoiceSessionTimer();
    const remainingMs = VOICE_MAX_SESSION_MS - getVoiceSessionDurationMs();
    if (remainingMs <= 0) {
      if (voiceHasSpeech) { stopVoiceDictation('silence'); } else {
        const error = createNoSpeechVoiceError(); voiceLastError = error;
        voiceStopReason = 'no_speech'; voiceState = 'error'; voiceErrorMessage = error.message;
        emitVoiceErrorTelemetry(error); syncVoiceUi(); voiceProvider.stop();
      }
      return;
    }
    voiceSessionTimer = setTimeout(() => {
      if (voiceState !== 'listening') return;
      if (voiceHasSpeech) { stopVoiceDictation('silence'); return; }
      const error = createNoSpeechVoiceError(); voiceLastError = error;
      voiceStopReason = 'no_speech'; voiceState = 'error'; voiceErrorMessage = error.message;
      emitVoiceErrorTelemetry(error); syncVoiceUi(); voiceProvider.stop();
    }, remainingMs);
  }

  function scheduleVoiceStop(): void {
    if (voiceState !== 'listening' || !voiceHasSpeech || voiceSpeechActive) return;
    clearVoiceStopTimer();
    voiceStopTimer = setTimeout(() => { if (voiceState === 'listening') stopVoiceDictation('silence'); }, getVoiceAutoStopMs());
  }

  function scheduleVoiceRestart(): void {
    if (!canRestartVoiceBeforeSpeech(voiceLastError)) return;
    clearVoiceRestartTimer();
    voicePreSpeechRestartCount += 1; voiceLastError = null;
    scheduleVoiceGraceTimeout(); scheduleVoiceSessionTimeout();
    voiceRestartTimer = setTimeout(() => {
      voiceRestartTimer = null;
      if (voiceState !== 'listening' || voiceHasSpeech || voiceStopReason) return;
      voiceProvider.start({ language: voiceConfig?.language });
    }, VOICE_RESTART_DELAY_MS);
  }

  function stopVoiceDictation(reason: string, options?: { resetDraftBase?: boolean }): void {
    if (voiceState !== 'listening') { if (options?.resetDraftBase) { resetVoiceDraftState(); resetVoiceSessionState(); } return; }
    clearVoiceStopTimer(); clearVoiceGraceTimer(); clearVoiceSessionTimer(); clearVoiceRestartTimer();
    voiceStopReason = reason; voiceProvider.stop();
    if (options?.resetDraftBase) resetVoiceDraftState();
  }

  function startVoiceDictation(): void {
    if (composerComp.textarea.disabled || !voiceConfig?.enabled || !voiceProvider.isSupported()) {
      if (voiceConfig?.enabled && !voiceProvider.isSupported()) {
        voiceState = 'error'; voiceErrorMessage = 'Voice dictation is not available in this browser.'; syncVoiceUi();
      }
      return;
    }
    voiceErrorMessage = ''; voiceState = 'listening'; pendingVoiceSubmit = false; voiceStopReason = null;
    voiceDraftBase = composerComp.textarea.value; voiceFinalTranscript = ''; voiceInterimTranscript = '';
    resetVoiceSessionState(); voiceSessionStartedAt = Date.now(); voiceStartTelemetryPending = true;
    scheduleVoiceGraceTimeout(); scheduleVoiceSessionTimeout(); syncVoiceUi();
    voiceProvider.start({ language: voiceConfig.language });
    // Voice-active visual
    seed.root.classList.add('voice-active');
    audioAnalyser.start();
  }

  function handleVoiceError(error: VoiceRecognitionError): void {
    voiceLastError = error;
    if (voiceStopReason && (error.code === 'aborted' || error.code === 'no_speech' || error.code === 'unknown')) return;
    if (error.code === 'aborted' || error.code === 'no_speech' || error.code === 'unknown') return;
    clearVoiceStopTimer(); clearVoiceGraceTimer(); clearVoiceRestartTimer();
    voiceState = 'error'; voiceErrorMessage = error.message; voiceStopReason = 'error';
    syncVoiceUi(); emitVoiceErrorTelemetry(error);
  }

  const voiceProvider: VoiceTranscriber = createBrowserVoiceTranscriber({
    onStart: () => {
      voiceState = 'listening'; voiceErrorMessage = ''; voiceLastError = null;
      scheduleVoiceGraceTimeout(); scheduleVoiceSessionTimeout();
      if (voiceStartTelemetryPending) { emitVoiceTelemetry('voice_started', buildVoiceTelemetryContext({ provider: 'browser' })); voiceStartTelemetryPending = false; }
      syncVoiceUi();
    },
    onSpeechStart: () => {
      if (voiceState !== 'listening') return;
      voiceHasSpeech = true; voiceSpeechActive = true; voiceLastError = null;
      clearVoiceGraceTimer(); clearVoiceStopTimer(); syncVoiceUi();
    },
    onSpeechEnd: () => {
      if (voiceState !== 'listening') return;
      voiceSpeechActive = false; if (voiceHasSpeech) scheduleVoiceStop(); syncVoiceUi();
    },
    onResult: ({ finalTranscript, interimTranscript }) => {
      if (finalTranscript || interimTranscript) {
        voiceHasSpeech = true; voiceSpeechActive = interimTranscript.length > 0;
        voiceLastError = null; clearVoiceGraceTimer(); clearVoiceStopTimer();
      }
      voiceFinalTranscript = finalTranscript; voiceInterimTranscript = interimTranscript;
      applyVoiceDraft();
      if (voiceHasSpeech && !voiceSpeechActive) scheduleVoiceStop();
      syncVoiceUi();
    },
    onEnd: ({ requested }) => {
      // Voice-active visual cleanup
      seed.root.classList.remove('voice-active');
      audioAnalyser.stop();
      seed.root.style.removeProperty('--rv-audio-scale');
      clearVoiceRestartTimer();
      if (!requested && canRestartVoiceBeforeSpeech(voiceLastError)) { scheduleVoiceRestart(); return; }
      const finalDraft = sanitizeText(buildVoiceDraft());
      const hadExistingDraft = sanitizeText(voiceDraftBase).length > 0;
      const lastError = voiceLastError;
      let stoppedReason = voiceStopReason || (requested ? 'manual' : 'silence');
      clearVoiceStopTimer(); clearVoiceGraceTimer(); clearVoiceSessionTimer();
      if (!voiceHasSpeech && !requested && voiceState !== 'error') {
        const error = lastError?.code === 'no_speech' ? lastError : createNoSpeechVoiceError();
        voiceState = 'error'; voiceErrorMessage = error.message; voiceStopReason = 'no_speech'; stoppedReason = 'no_speech';
        emitVoiceErrorTelemetry(error);
      } else if (!requested && !voiceStopReason && voiceHasSpeech) { stoppedReason = 'silence'; }
      else if (voiceStopReason) { stoppedReason = voiceStopReason; }
      if (voiceState !== 'error') { voiceState = 'idle'; voiceErrorMessage = ''; }
      if (finalDraft) emitVoiceTelemetry('voice_transcript_ready', buildVoiceTelemetryContext({ chars: finalDraft.length, hadExistingDraft }));
      emitVoiceTelemetry('voice_stopped', buildVoiceTelemetryContext({ reason: stoppedReason, stopReason: stoppedReason, requested, errorCode: lastError?.code }));
      const shouldSubmit = pendingVoiceSubmit;
      pendingVoiceSubmit = false; voiceStopReason = null; resetVoiceDraftState(); resetVoiceSessionState(); syncVoiceUi();
      if (shouldSubmit) submitComposerDraft();
    },
    onError: handleVoiceError,
  });

  // ── Composer Component ──
  const composerComp = createComposer({
    agentName,
    experience,
    onSubmit: (text, attachments) => {
      if (composerComp.textarea.disabled) return;
      if (voiceState === 'listening') { pendingVoiceSubmit = true; stopVoiceDictation('submit'); return; }
      submitComposerDraft();
    },
    onVoiceStart: () => {
      if (voiceState === 'listening') { stopVoiceDictation('manual'); return; }
      startVoiceDictation();
    },
    onVoiceStop: () => stopVoiceDictation('manual'),
  });

  // ── Widget State ──
  let hasMessages = false;
  let artifactExpanded = false;
  let taskStartedAt = 0;
  let latestTaskTitle = '';
  let latestArtifactBlock: RoverMessageBlock | null = null;
  let latestStatusText = 'Ready';
  let waitingForFirstModelSignal = false;
  let currentMode: RoverExecutionMode = 'controller';
  let canComposeInObserver = false;
  let currentQuestionPrompt: { questions: RoverAskUserQuestion[] } | null = null;
  let questionPromptSignature: string | null = null;
  let questionDraftAnswers: Record<string, string> = {};
  let pausedTaskId = '';

  function submitComposerDraft(): void {
    if (composerComp.textarea.disabled) return;
    const text = sanitizeText(composerComp.textarea.value);
    const attachments = composerComp.getPendingAttachments();
    const message = text || (attachments.length > 0 ? 'Use the attached files as context for this task.' : '');
    if (!message) return;
    setTaskSuggestion({ visible: false });
    latestTaskTitle = text || (attachments.length > 0 ? `Review ${attachments.length === 1 ? attachments[0].name : `${attachments.length} attachments`}` : latestTaskTitle);
    taskStartedAt = Date.now();
    opts.onSend(message, attachments.length > 0 ? { attachments } : undefined);
    composerComp.setText('');
    composerComp.clearAttachments();
    voiceErrorMessage = ''; voiceState = 'idle'; resetVoiceDraftState(); resetVoiceSessionState();
    pendingVoiceSubmit = false; voiceStopReason = null;
    syncTaskStage(); syncVoiceUi();
  }

  function syncTaskStage(): void {
    const hasTaskContent = !!(latestTaskTitle || isRunning);
    win.taskStage.style.display = hasTaskContent ? '' : 'none';
    if (!hasTaskContent) return;

    win.taskStageTitle.textContent = latestTaskTitle
      || `${experience.presence?.assistantName || agentName} is working…`;
    const metaParts: string[] = [];
    if (taskStartedAt > 0) metaParts.push(formatTime(taskStartedAt));
    if (latestStatusText && latestStatusText.toLowerCase() !== 'ready')
      metaParts.push(latestStatusText);
    win.taskStageMeta.textContent = metaParts.join(' • ');
    win.taskStageStatusPill.textContent = isRunning ? 'Active task' : 'Done';
    win.taskStageStatusPill.classList.toggle('running', isRunning);
    win.taskStageStatusPill.classList.toggle('idle', !isRunning);
  }

  function renderArtifactStage(): void {
    win.artifactStageBody.innerHTML = '';
    win.artifactStage.classList.toggle('visible', !!latestArtifactBlock);
    win.artifactStage.classList.toggle('expanded', artifactExpanded);
    win.artifactStageToggle.textContent = artifactExpanded ? 'Collapse' : 'Expand';
    if (!latestArtifactBlock) {
      win.artifactStageBody.appendChild(win.artifactStageEmpty);
      return;
    }
    const node = renderMessageBlock(latestArtifactBlock);
    if (node) win.artifactStageBody.appendChild(node);
    else win.artifactStageBody.appendChild(win.artifactStageEmpty);
  }

  function captureArtifactFromBlocks(blocks?: RoverMessageBlock[]): void {
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    const artifact = blocks.find(b => b.type === 'tool_output' || b.type === 'json') || null;
    if (!artifact) return;
    latestArtifactBlock = artifact;
    if (experience.stream?.artifactAutoMinimize !== false) artifactExpanded = false;
    renderArtifactStage();
  }

  win.artifactStageToggle.addEventListener('click', () => { artifactExpanded = !artifactExpanded; renderArtifactStage(); });

  function syncShellState(): void {
    const currentState = stateMachine.getState();
    const openState = win.panel.classList.contains('open') && !win.panel.classList.contains('closing');
    if (currentState === 'bar') {
      wrapper.dataset.shell = 'bar';
    } else if (currentState === 'window') {
      wrapper.dataset.shell = isRunning ? 'focus_stream' : 'stage';
    } else {
      wrapper.dataset.shell = 'presence';
    }
    const showBackdrop = openState && !isRunning && (experience.shell?.dimBackground !== false || experience.shell?.blurBackground !== false);
    win.backdrop.classList.toggle('visible', showBackdrop);
  }

  function syncProcessingIndicator(): void {
    feedComp.showTyping(isRunning && waitingForFirstModelSignal);
  }

  function syncComposerDisabledState(): void {
    const disabled = isRunning || (currentMode === 'observer' && !canComposeInObserver);
    composerComp.setDisabled(disabled);
    win.questionPromptCancel.disabled = disabled;
    win.questionPromptSubmit.disabled = disabled;
    for (const node of Array.from(win.questionPromptForm.querySelectorAll('.questionPromptInput'))) {
      (node as HTMLInputElement).disabled = disabled;
    }
    if (disabled && voiceState === 'listening') stopVoiceDictation('disabled');
    syncVoiceUi();
  }

  // ── Task Suggestion ──
  win.taskSuggestionPrimaryBtn.addEventListener('click', () => {
    if (pendingConfirmAction) {
      const action = pendingConfirmAction; pendingConfirmAction = null;
      setTaskSuggestion({ visible: false }); opts.onCancelRun?.();
      if (action === 'new_task') opts.onNewTask?.();
      else if (action === 'end_task') opts.onEndTask?.();
      return;
    }
    opts.onTaskSuggestionPrimary?.();
  });
  win.taskSuggestionSecondaryBtn.addEventListener('click', () => {
    if (pendingConfirmAction) { pendingConfirmAction = null; setTaskSuggestion({ visible: false }); return; }
    opts.onTaskSuggestionSecondary?.();
  });

  // ── Question Prompt ──
  function normalizeQuestionPrompt(prompt?: { questions: RoverAskUserQuestion[] }): RoverAskUserQuestion[] {
    if (!prompt || !Array.isArray(prompt.questions)) return [];
    const out: RoverAskUserQuestion[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < prompt.questions.length; i += 1) {
      const item = prompt.questions[i];
      if (!item || typeof item !== 'object') continue;
      const key = String(item.key || item.id || '').trim() || `clarification_${i + 1}`;
      const query = String(item.query || item.question || '').trim();
      if (!query || seen.has(key)) continue;
      seen.add(key);
      const hasRequired = typeof (item as any).required === 'boolean';
      const hasOptional = typeof (item as any).optional === 'boolean';
      const required = hasRequired ? !!(item as any).required : (hasOptional ? !(item as any).optional : true);
      out.push({ key, query, ...(item.id ? { id: item.id } : {}), ...(item.question ? { question: item.question } : {}), ...(Array.isArray(item.choices) ? { choices: item.choices } : {}), required });
    }
    return out.slice(0, 6);
  }

  function buildQuestionPromptSignature(questions: RoverAskUserQuestion[]): string {
    return questions.map(q => {
      const choices = Array.isArray(q.choices) ? q.choices.map(c => sanitizeText(String(c || ''))).filter(Boolean).join('|') : '';
      return `${q.key}::${sanitizeText(q.query)}::${choices}::${q.required === false ? 'optional' : 'required'}`;
    }).join('||');
  }

  function getQuestionInputByKey(key: string): HTMLInputElement | null {
    for (const node of Array.from(win.questionPromptForm.querySelectorAll('.questionPromptInput'))) {
      if ((node as HTMLInputElement).dataset.key === key) return node as HTMLInputElement;
    }
    return null;
  }

  win.questionPromptForm.addEventListener('submit', ev => {
    ev.preventDefault();
    if (composerComp.textarea.disabled || !currentQuestionPrompt?.questions?.length) return;
    const answersByKey: Record<string, string> = {};
    const rawLines: string[] = [];
    let firstInvalid: HTMLInputElement | null = null;
    for (const question of currentQuestionPrompt.questions) {
      const input = getQuestionInputByKey(question.key);
      if (!input) continue;
      const value = sanitizeText(input.value);
      if (!value && question.required !== false) { input.classList.add('invalid'); if (!firstInvalid) firstInvalid = input; continue; }
      input.classList.remove('invalid');
      if (value) { questionDraftAnswers[question.key] = value; answersByKey[question.key] = value; rawLines.push(`${question.key}: ${value}`); }
      else { delete questionDraftAnswers[question.key]; rawLines.push(`${question.key}: (no answer provided)`); }
    }
    if (firstInvalid) { firstInvalid.focus(); return; }
    const keys = currentQuestionPrompt.questions.map(q => q.key);
    const rawText = rawLines.length ? rawLines.join('\n') : keys.map(k => `${k}: (no answer provided)`).join('\n');
    const attachments = composerComp.getPendingAttachments();
    opts.onSend(rawText, { askUserAnswers: { answersByKey, rawText, keys }, attachments: attachments.length ? attachments : undefined });
    composerComp.clearAttachments();
  });

  win.questionPromptCancel.addEventListener('click', () => {
    if (composerComp.textarea.disabled) return;
    if (opts.onCancelQuestionFlow) { opts.onCancelQuestionFlow(); return; }
    opts.onCancelRun?.();
  });

  // ── Assemble Window Panel ──
  win.panel.appendChild(win.panelGrabber);
  win.panel.appendChild(headerComp.root);
  win.panel.appendChild(win.taskStage);
  win.panel.appendChild(win.artifactStage);
  win.panel.appendChild(win.conversationPill);
  win.panel.appendChild(win.pausedTaskBanner);
  win.panel.appendChild(feedComp.root);
  win.panel.appendChild(win.taskSuggestion);
  win.panel.appendChild(shortcutsComp.bar);
  win.panel.appendChild(win.questionPrompt);
  win.panel.appendChild(win.resizeHandle);
  win.panel.appendChild(win.conversationDrawer);

  // Composer lives permanently in the bar slot (bar is always the input mechanism)
  inputBar.composerSlot.appendChild(composerComp.root);

  // ── Live Stack Component ──
  const liveStack = createLiveStack({
    thoughtStyle: opts.thoughtStyle,
    stream: experience.stream,
  });
  liveStack.setOnExpand(() => {
    liveStack.hide();
    if (stateMachine.getState() === 'bar') {
      maximize();
    }
    feedComp.setTraceExpanded(true, experience.stream?.maxVisibleLiveCards);
  });

  // ── Assemble Wrapper ──
  wrapper.appendChild(win.backdrop);
  wrapper.appendChild(seed.root);
  wrapper.appendChild(seed.greetingBubble);
  wrapper.appendChild(win.panel);
  wrapper.appendChild(liveStack.root);
  wrapper.appendChild(inputBar.root);
  wrapper.appendChild(commandBar.root);
  shadow.appendChild(wrapper);

  // ── Keyboard Shortcuts ──
  shadow.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') {
      ke.stopPropagation();
      // Close command bar first if open
      if (commandBar.isOpen()) { commandBar.close(); return; }
      // Escape from window → minimize to bar
      if (win.panel.classList.contains('open')) { minimize(); return; }
      // Escape from bar → close to seed
      if (stateMachine.getState() === 'bar') { closeFromBar(); return; }
    }
  });

  const globalToggleHandler = (e: KeyboardEvent): void => {
    // Cmd+K / Ctrl+K → toggle command bar
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') {
      e.preventDefault(); e.stopPropagation();
      if (commandBar.isOpen()) commandBar.close(); else commandBar.open();
      return;
    }
    if (e.code === 'Period' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); e.stopPropagation();
      if (win.panel.classList.contains('open')) close(); else open();
    }
  };
  document.addEventListener('keydown', globalToggleHandler);

  // ── Resize Handlers ──
  const handleViewportMutation = (): void => { win.applyLayout(); seed.applyPosition(); };
  window.addEventListener('resize', handleViewportMutation);
  window.addEventListener('orientationchange', handleViewportMutation);
  window.visualViewport?.addEventListener('resize', handleViewportMutation);
  window.visualViewport?.addEventListener('scroll', handleViewportMutation);

  // ── Apply Initial State ──
  win.applyLayout();
  seed.applyPosition();
  seed.setMuted(isMuted);
  headerComp.setMuted(isMuted);
  inputBar.setMuted(isMuted);
  setExecutionMode('controller');
  setVoiceConfig(voiceConfig);
  feedComp.setTraceExpanded(false, experience.stream?.maxVisibleLiveCards);
  renderArtifactStage();
  syncTaskStage();

  // Apply accent tokens
  if (experience.theme?.accentColor) {
    const tokens = deriveAccentTokens(experience.theme.accentColor);
    for (const [key, value] of Object.entries(tokens)) {
      wrapper.style.setProperty(key, value);
    }
  }

  // ── Minimize / Maximize / CloseFromBar ──
  function minimize(): void {
    userMinimized = true;
    if (stateMachine.getState() !== 'window') return;
    headerComp.closeOverflow();
    const usesMorph = experience.shell?.transitionStyle !== 'crossfade' && !prefersReducedMotion();

    if (usesMorph) {
      win.backdrop.classList.remove('visible');
      win.panel.animate(
        [
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
          { opacity: 0, transform: 'translateY(12px) scale(0.97)', filter: 'blur(3px)' },
        ],
        {
          duration: scaleDuration(250, experience.motion?.intensity || 'balanced'),
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
        },
      ).finished.then(() => {
        win.panel.classList.remove('open');
        win.panel.style.display = 'none';
        win.panel.style.transform = '';
        win.panel.style.filter = '';
        win.panel.style.animation = '';
        syncShellState();
      }).catch(() => {});
    } else {
      win.panel.classList.remove('open');
      win.panel.style.display = 'none';
      win.backdrop.classList.remove('visible');
      syncShellState();
    }

    stateMachine.setState('bar');
    inputBar.setExpanded(false);
    syncPulseState();

    // If task still running, restore live stack view
    if (isRunning) {
      liveStack.show();
    }
  }

  function maximize(): void {
    if (stateMachine.getState() !== 'bar') return;
    win.applyLayout();
    win.panel.style.transition = '';   // clear any leftover collapse transition before showing

    const usesMorph = experience.shell?.transitionStyle !== 'crossfade' && !prefersReducedMotion();
    if (usesMorph) {
      win.backdrop.classList.add('visible');
      win.panel.style.animation = 'none';
      win.panel.style.opacity = '0';        // ensure transparent on first paint
      win.panel.style.display = 'flex';     // set inline display BEFORE adding .open class so that on
      // first open (no prior inline display) the CSS panelOpen animation cannot race the WAAPI start
      win.panel.classList.add('open');
      win.panel.animate(
        [
          { opacity: 0, transform: 'translateY(12px) scale(0.97)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        ],
        {
          duration: scaleDuration(320, experience.motion?.intensity || 'balanced'),
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards',
        },
      ).finished.then(() => {
        win.panel.style.transform = '';
        win.panel.style.filter = '';
        // Do NOT clear style.animation here — .open class is still present and clearing 'none'
        // back to '' re-arms the CSS panelOpen animation, which fires from opacity:0 and causes
        // a first-open flicker. style.animation is cleared in minimize().finished after .open is removed.
        win.panel.style.opacity = '';         // clear the inline override
        syncShellState();
        if (!composerComp.textarea.disabled) composerComp.textarea.focus();
      }).catch(() => {});
    } else {
      win.panel.classList.add('open');
      win.panel.style.display = 'flex';
      win.backdrop.classList.add('visible');
      syncShellState();
      if (!composerComp.textarea.disabled) composerComp.textarea.focus();
    }

    stateMachine.setState('window');
    inputBar.setExpanded(true);
    syncPulseState();
    opts.onOpen?.();
  }

  function closeFromBar(): void {
    userMinimized = false;
    const state = stateMachine.getState();

    if (state === 'window') {
      headerComp.closeOverflow();
      win.panel.classList.remove('open');
      win.panel.style.display = 'none';
      win.panel.style.transform = '';
      win.panel.style.filter = '';
      win.panel.style.animation = '';
      win.backdrop.classList.remove('visible');
      stateMachine.setState('bar');
      inputBar.setExpanded(false);
      syncPulseState();
    } else if (state !== 'bar') {
      return;
    }

    stateMachine.setState('seed');
    stateMachine.setMood('idle');
    syncPulseState();

    const usesMorph = !prefersReducedMotion();
    if (usesMorph) {
      // morphBarToSeed synchronously removes bar 'open' class THEN starts seed animate()
      morphBarToSeed({
        seed: seed.root,
        bar: inputBar.root,
        duration: scaleDuration(280, experience.motion?.intensity || 'balanced'),
      });
      // syncShellState after → seed gets display:block, but bar is already hidden. No overlap.
      syncShellState();
    } else {
      inputBar.hide();   // hide bar first
      syncShellState();  // then reveal seed
    }

    opts.onClose?.();
  }

  // ── Seed → Bar ──
  function openToBar(): void {
    if (stateMachine.getState() !== 'seed') return;
    if (commandBar.isOpen()) commandBar.close();
    seed.setGreeting(null);
    clearGreetingTimers();

    stateMachine.setState('bar');
    syncPulseState();

    const usesMorph = !prefersReducedMotion();
    if (usesMorph) {
      morphSeedToBar({
        seed: seed.root,
        bar: inputBar.root,
        duration: scaleDuration(300, experience.motion?.intensity || 'balanced'),
      }).then(() => {
        syncShellState();
        if (!userMinimized) maximize();
      });
    } else {
      inputBar.show();
      syncShellState();
      if (!userMinimized) maximize();
    }
  }

  // ── Open/Close with Morph Transitions ──
  function open(): void {
    if (commandBar.isOpen()) commandBar.close();

    // If in bar state, maximize instead
    if (stateMachine.getState() === 'bar') { maximize(); return; }

    // If in seed state, go to bar first (new flow)
    if (stateMachine.getState() === 'seed') { openToBar(); return; }
  }

  function close(): void {
    if (stateMachine.getState() === 'bar') { closeFromBar(); return; }
    headerComp.closeOverflow();
    if (!win.panel.classList.contains('open')) { opts.onClose?.(); return; }
    // Window → bar (not → seed). User reaches seed by clicking × in bar.
    minimize();
  }

  // ── RoverUi API Methods ──
  function addMessage(role: 'user' | 'assistant' | 'system', text: string, options?: { blocks?: RoverMessageBlock[] }): void {
    feedComp.addMessage(role, text, options?.blocks);
    if (role === 'assistant' && isRunning && waitingForFirstModelSignal) { waitingForFirstModelSignal = false; syncProcessingIndicator(); }
    if (role === 'user') { latestTaskTitle = sanitizeText(text) || latestTaskTitle; taskStartedAt = Date.now(); artifactExpanded = false; }
    if (role === 'assistant') captureArtifactFromBlocks(options?.blocks);
    hasMessages = true;
    syncTaskStage();
    shortcutsComp.syncVisibility(hasMessages, isRunning, !!currentQuestionPrompt?.questions?.length);
    if (role === 'user') stateMachine.setMood('typing', 1200);
    else if (role === 'assistant') stateMachine.setMood('success', 1400);
    else stateMachine.setMood('running', 900);
    wrapper.dataset.mood = stateMachine.getMood();
    if (experience.motion?.palimpsest !== false) {
      win.backdrop.classList.toggle('palimpsest', isRunning && stateMachine.getMood() === 'running');
    }
  }

  function setQuestionPrompt(prompt?: { questions: RoverAskUserQuestion[] }): void {
    const questions = normalizeQuestionPrompt(prompt);
    if (!questions.length) {
      currentQuestionPrompt = null; questionPromptSignature = null; questionDraftAnswers = {};
      win.questionPromptList.innerHTML = '';
      win.questionPrompt.classList.remove('visible');
      shortcutsComp.syncVisibility(hasMessages, isRunning, false);
      return;
    }
    const signature = buildQuestionPromptSignature(questions);
    const shouldRebuild = signature !== questionPromptSignature || !currentQuestionPrompt;
    currentQuestionPrompt = { questions };
    if (shouldRebuild) {
      const prev = questionDraftAnswers; questionDraftAnswers = {};
      win.questionPromptList.innerHTML = '';
      for (const question of questions) {
        const item = document.createElement('label'); item.className = 'questionPromptItem';
        const label = document.createElement('span'); label.className = 'questionPromptLabel';
        label.textContent = question.required === false ? `${question.query} (optional)` : question.query;
        item.appendChild(label);
        const input = document.createElement('input'); input.type = 'text'; input.className = 'questionPromptInput';
        input.dataset.key = question.key; input.required = question.required !== false;
        const draftValue = String(prev[question.key] || ''); questionDraftAnswers[question.key] = draftValue; input.value = draftValue;
        input.addEventListener('input', () => { questionDraftAnswers[question.key] = input.value; input.classList.remove('invalid'); });
        item.appendChild(input);
        win.questionPromptList.appendChild(item);
      }
      questionPromptSignature = signature;
    }
    win.questionPrompt.classList.add('visible');
    syncComposerDisabledState();
    shortcutsComp.syncVisibility(hasMessages, isRunning, true);
  }

  function clearMessages(): void {
    feedComp.clearMessages();
    hasMessages = false; latestTaskTitle = ''; taskStartedAt = 0;
    latestArtifactBlock = null; artifactExpanded = false;
    composerComp.clearAttachments();
    renderArtifactStage(); syncTaskStage();
    setQuestionPrompt(undefined);
    shortcutsComp.syncVisibility(false, isRunning, false);
  }

  function setTaskSuggestion(suggestion: RoverTaskSuggestion): void {
    win.taskSuggestion.classList.toggle('visible', !!suggestion?.visible);
    win.taskSuggestionTextEl.textContent = suggestion?.text || 'Looks like a new request. Start a new task?';
    win.taskSuggestionPrimaryBtn.textContent = suggestion?.primaryLabel || 'Start new';
    win.taskSuggestionSecondaryBtn.textContent = suggestion?.secondaryLabel || 'Continue';
  }

  function setStatus(text: string): void {
    const clean = String(text || 'ready');
    headerComp.setStatus(clean);
    latestStatusText = clean;
    const lowered = clean.toLowerCase();
    const prevMood = stateMachine.getMood();
    if (lowered.includes('error') || lowered.includes('failed')) {
      stateMachine.setMood('error', 1800);
      // Error wobble
      if (prevMood !== 'error') {
        try {
          seed.root.animate(
            [
              { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
              { transform: 'translateX(5px)' }, { transform: 'translateX(-4px)' },
              { transform: 'translateX(3px)' }, { transform: 'translateX(-1px)' },
              { transform: 'translateX(0)' },
            ],
            { duration: 800, easing: 'ease-out' },
          );
        } catch { /* no WAAPI support */ }
        seed.root.classList.add('error-wobble');
        setTimeout(() => seed.root.classList.remove('error-wobble'), 850);
      }
    } else if (lowered.includes('waiting') || lowered.includes('queued') || lowered.includes('paused')) {
      stateMachine.setMood('waiting', 0);
    } else if (lowered === 'ready' || lowered.includes('complete')) {
      stateMachine.setMood('idle');
    } else {
      stateMachine.setMood('running', 1000);
    }
    wrapper.dataset.mood = stateMachine.getMood();
    if (experience.motion?.palimpsest !== false) {
      win.backdrop.classList.toggle('palimpsest', isRunning && stateMachine.getMood() === 'running');
    }
    syncTaskStage();
  }

  function setRunning(running: boolean): void {
    const wasRunning = isRunning;
    isRunning = running;
    if (running) {
      waitingForFirstModelSignal = true;
      if (!taskStartedAt) taskStartedAt = Date.now();
      toolStartCount = 0; toolResultCount = 0; updateTideProgress();
      if (experience.motion?.particles !== false) particleSystem.setMode('ambient');

      // Close panel if open — live stack replaces it during running
      if (stateMachine.getState() === 'window') {
        headerComp.closeOverflow();
        win.panel.classList.remove('open');
        win.panel.style.display = 'none';
        win.panel.style.transform = '';
        win.panel.style.filter = '';
        win.panel.style.animation = '';
        win.backdrop.classList.remove('visible');
        stateMachine.setState('bar');
        inputBar.setExpanded(false);
      }

      // Show floating live stack — no panel, no backdrop blur
      liveStack.show();
      inputBar.setRunning(true);
      composerComp.setSendAsStop(true, () => { opts.onCancelRun?.(); });
    } else {
      // Hide live stack
      liveStack.hide();
      inputBar.setRunning(false);
      composerComp.setSendAsStop(false, () => {});

      waitingForFirstModelSignal = false;
      filamentSystem.clearAll();

      // Open canvas with results if task completed and panel isn't already open
      if (wasRunning && stateMachine.getState() !== 'window') {
        maximize();
      }
      // Scroll feed to bottom to show results
      setTimeout(() => feedComp.smartScrollToBottom(), 80);

      // Completion burst — must come BEFORE syncPulseState
      if (wasRunning && stateMachine.getMood() !== 'error') {
        if (experience.motion?.particles !== false) {
          particleSystem.setMode('burst');
        }
        try {
          seed.root.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }],
            { duration: 600, easing: 'ease-out' },
          );
        } catch { /* no WAAPI support */ }
        seed.root.classList.add('completion-burst');
        setTimeout(() => {
          seed.root.classList.remove('completion-burst');
          // Only now safe to idle particles (burst has played)
          syncPulseState();
        }, 700);
      } else {
        if (experience.motion?.particles !== false) {
          particleSystem.setMode('idle');
        }
      }
    }
    // Palimpsest toggle — tied to mood, not just running boolean
    if (experience.motion?.palimpsest !== false) {
      win.backdrop.classList.toggle('palimpsest', running && stateMachine.getMood() === 'running');
    }
    syncProcessingIndicator();
    syncComposerDisabledState();
    headerComp.setRunning(running);
    if (!running && experience.stream?.artifactAutoMinimize !== false) { artifactExpanded = false; renderArtifactStage(); }
    syncTaskStage();
    shortcutsComp.syncVisibility(hasMessages, isRunning, !!currentQuestionPrompt?.questions?.length);
    syncShellState();
    // Skip syncPulseState when in burst path (it's deferred via setTimeout above)
    if (!(wasRunning && !running && stateMachine.getMood() !== 'error')) {
      syncPulseState();
    }
  }

  function setExecutionMode(mode: RoverExecutionMode, executionMeta?: Record<string, unknown>): void {
    currentMode = mode;
    canComposeInObserver = mode === 'observer' ? (executionMeta?.canComposeInObserver as boolean) === true : true;
    syncComposerDisabledState();
    headerComp.setExecutionMode(mode, executionMeta);
    if (mode === 'controller') {
      composerComp.setStaticPlaceholder('');
    } else {
      if (executionMeta?.note) composerComp.setStaticPlaceholder(executionMeta.note as string);
      else if (canComposeInObserver) composerComp.setStaticPlaceholder('Send to take control and run here.');
      else composerComp.setStaticPlaceholder('Observer mode. Take control to run actions here.');
    }
  }

  function showGreeting(text: string): void {
    const cleanText = sanitizeText(text);
    if (cleanText && !win.panel.classList.contains('open')) {
      seed.setGreeting(cleanText);
    }
  }

  function dismissGreeting(): void {
    seed.setGreeting(null);
  }

  function setVisitorName(name: string): void {
    visitorName = name || undefined;
    shortcutsComp.setVisitorName(visitorName, agentName);
  }

  function setVoiceConfig(nextVoice?: RoverVoiceConfig): void {
    const nextConfig = sanitizeVoiceConfig(nextVoice);
    const prevSig = JSON.stringify(voiceConfig || null);
    const nextSig = JSON.stringify(nextConfig || null);
    if (prevSig === nextSig) { syncVoiceUi(); return; }
    voiceConfig = nextConfig; voiceErrorMessage = ''; pendingVoiceSubmit = false;
    if (voiceState === 'listening') stopVoiceDictation('config');
    else { resetVoiceDraftState(); resetVoiceSessionState(); voiceState = 'idle'; }
    syncVoiceUi();
  }

  function applyExperience(nextExperience?: RoverExperienceConfig): void {
    experience = resolveMountExperienceConfig({ ...opts, experience: nextExperience }, agentName, mascotDisabled);
    seed.update(experience);
    composerComp.update(experience);
    feedComp.setStreamConfig(experience.stream);
    liveStack.setStreamConfig(experience.stream);
    feedComp.setThoughtStyle(opts.thoughtStyle);
    liveStack.setThoughtStyle(opts.thoughtStyle);
    if (experience.theme?.accentColor) {
      const tokens = deriveAccentTokens(experience.theme.accentColor);
      for (const [key, value] of Object.entries(tokens)) wrapper.style.setProperty(key, value);
    }
    if (experience.theme?.fontFamily) {
      wrapper.style.setProperty('font-family', `${experience.theme.fontFamily}, Manrope, sans-serif`);
    }
    wrapper.dataset.surfaceStyle = experience.theme?.surfaceStyle || 'glass';
    // Re-evaluate motion config flags
    if (experience.motion?.particles === false) particleSystem.setMode('idle');
    if (experience.motion?.filaments === false) filamentSystem.clearAll();
    if (experience.motion?.palimpsest === false) win.backdrop.classList.remove('palimpsest');
    syncTaskStage(); renderArtifactStage(); seed.applyPosition();
  }

  function show(): void { win.applyLayout(); wrapper.style.display = ''; seed.applyPosition(); syncShellState(); }
  function hide(): void { close(); wrapper.style.display = 'none'; syncShellState(); }

  function destroy(): void {
    stateMachine.destroy();
    clearGreetingTimers();
    clearVoiceStopTimer(); voiceProvider.dispose();
    commandBar.destroy();
    inputBar.destroy();
    liveStack.destroy();
    particleSystem.destroy();
    filamentSystem.destroy();
    audioAnalyser.dispose();
    window.removeEventListener('resize', handleViewportMutation);
    window.removeEventListener('orientationchange', handleViewportMutation);
    window.visualViewport?.removeEventListener('resize', handleViewportMutation);
    window.visualViewport?.removeEventListener('scroll', handleViewportMutation);
    document.removeEventListener('keydown', globalToggleHandler);
    fontStyle.remove(); host.remove();
  }

  // ── Conversation/Tab Methods ──
  function setTabs(_tabs: RoverTabInfo[]): void { /* No-op for backward compat */ }

  let lastConversationsKey = '';
  function setConversations(conversations: ConversationListItem[]): void {
    const key = conversations.map(c => `${c.id}|${c.summary}|${c.status}|${c.updatedAt}|${c.isActive}`).join(';;');
    if (key === lastConversationsKey) return;
    lastConversationsKey = key;
    const active = conversations.find(c => c.isActive);
    win.conversationPillLabel.textContent = active ? (active.summary.length > 40 ? active.summary.slice(0, 40) + '...' : active.summary) || 'Current task' : 'Current task';
    win.conversationPill.style.display = conversations.length > 1 ? 'flex' : 'none';
    win.conversationList.innerHTML = '';
    for (const conv of conversations) {
      const item = document.createElement('div');
      item.className = `conversationItem ${conv.status}${conv.isActive ? ' active' : ''}`;
      item.dataset.id = conv.id;
      const dot = document.createElement('span'); dot.className = 'conversationDot';
      const content = document.createElement('div'); content.className = 'conversationContent';
      const summary = document.createElement('div'); summary.className = 'conversationSummary';
      summary.textContent = conv.summary.length > 60 ? conv.summary.slice(0, 60) + '...' : conv.summary;
      const meta = document.createElement('div'); meta.className = 'conversationMeta';
      const statusBadge = conv.status === 'running' ? 'Running' : conv.status === 'paused' ? 'Paused' : conv.status === 'completed' ? 'Done' : conv.status;
      meta.textContent = `${statusBadge} · ${formatTime(conv.updatedAt)}`;
      content.appendChild(summary); content.appendChild(meta);
      const actions = document.createElement('div'); actions.className = 'conversationActions';
      const deleteBtn = document.createElement('button'); deleteBtn.type = 'button'; deleteBtn.className = 'conversationDeleteBtn'; deleteBtn.textContent = '\u00D7';
      deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onDeleteConversation?.(conv.id); });
      actions.appendChild(deleteBtn);
      item.appendChild(dot); item.appendChild(content); item.appendChild(actions);
      item.addEventListener('click', () => { drawerOpen = false; win.conversationDrawer.classList.remove('open'); opts.onSwitchConversation?.(conv.id); });
      win.conversationList.appendChild(item);
    }
  }

  function setActiveConversationId(id: string): void {
    win.conversationList.querySelectorAll('.conversationItem').forEach(item => {
      if ((item as HTMLElement).dataset.id === id) item.classList.add('active');
      else item.classList.remove('active');
    });
  }

  function showPausedTaskBanner(task: { taskId: string; rootUserInput: string }): void {
    pausedTaskId = task.taskId;
    const truncated = task.rootUserInput.length > 50 ? task.rootUserInput.slice(0, 50) + '...' : task.rootUserInput;
    win.pausedTaskBanner.innerHTML = '';
    const text = document.createElement('span'); text.className = 'pausedTaskText'; text.textContent = `Paused: "${truncated}"`;
    const actions = document.createElement('div'); actions.className = 'pausedTaskActions';
    const resumeBtn = document.createElement('button'); resumeBtn.type = 'button'; resumeBtn.className = 'pausedTaskResumeBtn'; resumeBtn.textContent = 'Resume';
    resumeBtn.addEventListener('click', () => opts.onResumeTask?.(pausedTaskId));
    const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'pausedTaskCancelBtn'; cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => opts.onCancelPausedTask?.(pausedTaskId));
    actions.appendChild(resumeBtn); actions.appendChild(cancelBtn);
    win.pausedTaskBanner.appendChild(text); win.pausedTaskBanner.appendChild(actions);
    win.pausedTaskBanner.classList.add('visible');
  }

  function hidePausedTaskBanner(): void { pausedTaskId = ''; win.pausedTaskBanner.classList.remove('visible'); }

  // ── Greeting auto-timer ──
  if (opts.greeting?.text && opts.greeting.disabled !== true) {
    const greetingDelay = opts.greeting.delay ?? GREETING_REVEAL_DELAY_MS;
    greetingShowTimer = setTimeout(() => {
      greetingShowTimer = null;
      if (!win.panel.classList.contains('open')) {
        showGreeting(opts.greeting!.text!);
        if (opts.greeting!.duration != null && opts.greeting!.duration > 0) {
          greetingDismissTimer = setTimeout(() => {
            greetingDismissTimer = null;
            dismissGreeting();
          }, opts.greeting!.duration);
        }
      }
    }, greetingDelay);
  }

  return {
    addMessage,
    setQuestionPrompt,
    clearMessages,
    addTimelineEvent: (event) => {
      feedComp.addTimelineEvent(event);
      liveStack.addTimelineEvent(event);
      captureArtifactFromBlocks(event.detailBlocks);
      if (event.kind === 'thought' && isRunning && waitingForFirstModelSignal) { waitingForFirstModelSignal = false; syncProcessingIndicator(); }
      if ((event.title || '').toLowerCase() === 'run completed') {
        feedComp.setTraceExpanded(false, experience.stream?.maxVisibleLiveCards);
      }
      const status = event.status || (event.kind === 'error' ? 'error' : event.kind === 'tool_result' ? 'success' : 'pending');
      if (status === 'error') stateMachine.setMood('error', 2200);
      else if (status === 'success') stateMachine.setMood('success', 1200);
      else stateMachine.setMood('running', 800);
      wrapper.dataset.mood = stateMachine.getMood();
      if (experience.motion?.palimpsest !== false) {
        win.backdrop.classList.toggle('palimpsest', isRunning && stateMachine.getMood() === 'running');
      }
      syncTaskStage();

      // Tide-line tracking
      if (event.kind === 'tool_start') {
        toolStartCount++;
        updateTideProgress();
        // Filaments + ripples
        if (event.elementId != null && experience.motion?.filaments !== false) {
          filamentSystem.addTarget(event.elementId, event.toolName);
          const el = opts.resolveElement?.(event.elementId);
          if (el) {
            const rect = el.getBoundingClientRect();
            spawnToolRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
            // Update palimpsest center
            wrapper.style.setProperty('--rv-palimpsest-x', `${rect.left + rect.width / 2}px`);
            wrapper.style.setProperty('--rv-palimpsest-y', `${rect.top + rect.height / 2}px`);
          } else {
            // Ripple from panel edge center
            const panelRect = win.panel.getBoundingClientRect();
            spawnToolRipple(panelRect.left, panelRect.top + panelRect.height / 2);
          }
        }
      }
      if (event.kind === 'tool_result') {
        toolResultCount++;
        updateTideProgress();
        if (event.elementId != null) filamentSystem.fadeTarget(event.elementId);
      }

      // Pulse badge step count
      const stepCount = feedComp.traceOrder.length;
      pulseBadge.textContent = String(stepCount);
      syncPulseState();
    },
    clearTimeline: () => {
      feedComp.clearTimeline(); liveStack.clear(); latestArtifactBlock = null; artifactExpanded = false; renderArtifactStage(); syncTaskStage();
      toolStartCount = 0; toolResultCount = 0; updateTideProgress();
      filamentSystem.clearAll();
      pulseBadge.textContent = '0';
    },
    setTaskSuggestion,
    setStatus,
    setRunning,
    setExecutionMode,
    setShortcuts: (shortcuts) => { shortcutsComp.render(shortcuts, opts.onShortcutClick); shortcutsComp.syncVisibility(hasMessages, isRunning, !!currentQuestionPrompt?.questions?.length); commandBar.setItems(shortcuts); },
    showGreeting,
    dismissGreeting,
    setVisitorName,
    setVoiceConfig,
    setPlaceholders: (phrases: string[]) => { composerComp.setPlaceholders(phrases); },
    setExperience: applyExperience,
    open,
    close,
    minimize,
    maximize,
    show,
    hide,
    destroy,
    setState: (state: RoverPresenceState) => {
      if (state === 'window') open();
      else if (state === 'bar') minimize();
      else close();
    },
    getState: () => stateMachine.getState(),
    setTabs,
    setConversations,
    setActiveConversationId,
    getScrollPosition: () => feedComp.getScrollPosition(),
    setScrollPosition: (pos) => feedComp.setScrollPosition(pos),
    showPausedTaskBanner,
    hidePausedTaskBanner,
  };
}
