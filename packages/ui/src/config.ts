import type {
  RoverExperienceConfig,
  RoverVoiceConfig,
  MountOptions,
} from './types.js';

export const DEFAULT_AGENT_NAME = 'Rover';
export const DEFAULT_MASCOT_MP4 = 'https://www.rtrvr.ai/rover/mascot.mp4';
export const DEFAULT_MASCOT_WEBM = 'https://www.rtrvr.ai/rover/mascot.webm';
export const DEFAULT_ATTACHMENT_LIMIT = 6;
export const DEFAULT_ATTACHMENT_MAX_FILE_SIZE_MB = 12;
export const SHORTCUTS_RENDER_LIMIT = 12;
export const GREETING_REVEAL_DELAY_MS = 800;
export const DEFAULT_ACTION_SPOTLIGHT_COLOR = '#FF4C00';

// Voice constants
export const VOICE_AUTO_STOP_DEFAULT_MS = 2600;
export const VOICE_AUTO_STOP_MIN_MS = 800;
export const VOICE_AUTO_STOP_MAX_MS = 5000;
export const VOICE_INITIAL_SPEECH_GRACE_MS = 5000;
export const VOICE_MAX_SESSION_MS = 60000;
export const VOICE_MAX_PRE_SPEECH_RESTARTS = 3;
export const VOICE_RESTART_DELAY_MS = 160;

// Layout constants
export const ROVER_WIDGET_MOBILE_BREAKPOINT_PX = 640;
export const ROVER_WIDGET_LAUNCHER_DESKTOP_INSET_PX = 20;
export const ROVER_WIDGET_LAUNCHER_MOBILE_INSET_PX = 14;
export const ROVER_WIDGET_LAUNCHER_DESKTOP_SIZE_PX = 58;
export const ROVER_WIDGET_LAUNCHER_MOBILE_SIZE_PX = 52;
export const ROVER_WIDGET_LAUNCHER_STACK_GAP_PX = 10;

// Panel constants
export const PANEL_DESKTOP_DEFAULT_WIDTH = 960;
export const PANEL_DESKTOP_DEFAULT_HEIGHT = 600;
export const PANEL_DESKTOP_MIN_WIDTH = 640;
export const PANEL_DESKTOP_MIN_HEIGHT = 400;
export const PANEL_DESKTOP_MAX_WIDTH = 1200;

// Input bar constants
export const INPUT_BAR_MAX_WIDTH = 640;
export const INPUT_BAR_HEIGHT = 60;
export const INPUT_BAR_MOBILE_HEIGHT = 56;
export const PANEL_DESKTOP_MARGIN = 16;
export const PANEL_PHONE_BOTTOM_OFFSET = 8;
export const PANEL_TABLET_BOTTOM_OFFSET = 16;
export const PANEL_PHONE_TOP_OFFSET = 16;
export const PANEL_TABLET_TOP_OFFSET = 16;
export const PANEL_PHONE_SNAP_RATIOS = [0.52, 0.72, 1] as const;
export const PANEL_TABLET_SNAP_RATIOS = [0.56, 0.72, 0.88] as const;
export const PANEL_PHONE_MIN_HEIGHT = 280;
export const PANEL_TABLET_MIN_HEIGHT = 360;

// Data rendering constants
export const EXPAND_THRESHOLD_OUTPUT = 1200;
export const EXPAND_THRESHOLD_THOUGHT = 1200;
export const EXPAND_THRESHOLD_TOOL = 1200;
export const STRUCTURED_PAGE_SIZE = 25;
export const STRUCTURED_MAX_DEPTH = 4;

export function sanitizeText(text: string): string {
  return String(text || '').trim();
}

export function normalizeHexColor(input: unknown): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : undefined;
}

export function normalizeVoiceLanguage(input?: string): string | undefined {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 48);
  return cleaned || undefined;
}

export function normalizeVoiceAutoStopMs(input: unknown): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return VOICE_AUTO_STOP_DEFAULT_MS;
  return Math.max(VOICE_AUTO_STOP_MIN_MS, Math.min(VOICE_AUTO_STOP_MAX_MS, Math.trunc(parsed)));
}

export function sanitizeVoiceConfig(input?: RoverVoiceConfig): RoverVoiceConfig | undefined {
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

export function sanitizeExperienceConfig(input?: RoverExperienceConfig): RoverExperienceConfig {
  if (!input || typeof input !== 'object') return {};
  const next: RoverExperienceConfig = {};
  if (input.experienceMode === 'guided' || input.experienceMode === 'minimal') {
    next.experienceMode = input.experienceMode;
  }
  if (input.presence && typeof input.presence === 'object') {
    next.presence = {
      assistantName: sanitizeText(String(input.presence.assistantName || '')).slice(0, 160) || undefined,
      ctaText: sanitizeText(String(input.presence.ctaText || '')).slice(0, 160) || undefined,
      iconMode:
        input.presence.iconMode === 'logo' || input.presence.iconMode === 'mascot' || input.presence.iconMode === 'rover'
          ? input.presence.iconMode
          : undefined,
      draggable: typeof input.presence.draggable === 'boolean' ? input.presence.draggable : undefined,
      defaultAnchor:
        input.presence.defaultAnchor === 'bottom-right'
        || input.presence.defaultAnchor === 'bottom-left'
        || input.presence.defaultAnchor === 'top-right'
        || input.presence.defaultAnchor === 'top-left'
        || input.presence.defaultAnchor === 'bottom-center'
          ? input.presence.defaultAnchor
          : undefined,
      persistPosition: typeof input.presence.persistPosition === 'boolean' ? input.presence.persistPosition : undefined,
      idleAnimation:
        input.presence.idleAnimation === 'breathe' || input.presence.idleAnimation === 'orbit' || input.presence.idleAnimation === 'none'
          ? input.presence.idleAnimation
          : undefined,
      firstRunIntro:
        input.presence.firstRunIntro === 'ambient' || input.presence.firstRunIntro === 'headline' || input.presence.firstRunIntro === 'none'
          ? input.presence.firstRunIntro
          : undefined,
      defaultState:
        input.presence.defaultState === 'seed' || input.presence.defaultState === 'bar'
          ? input.presence.defaultState
          : undefined,
    };
  }
  if (input.shell && typeof input.shell === 'object') {
    next.shell = {
      openMode: input.shell.openMode === 'center_stage' ? input.shell.openMode : undefined,
      mobileMode: input.shell.mobileMode === 'fullscreen_sheet' ? input.shell.mobileMode : undefined,
      desktopSize:
        input.shell.desktopSize === 'compact' || input.shell.desktopSize === 'stage' || input.shell.desktopSize === 'cinema'
          ? input.shell.desktopSize
          : undefined,
      desktopHeight:
        input.shell.desktopHeight === 'tall' || input.shell.desktopHeight === 'full'
          ? input.shell.desktopHeight
          : undefined,
      dimBackground: typeof input.shell.dimBackground === 'boolean' ? input.shell.dimBackground : undefined,
      blurBackground: typeof input.shell.blurBackground === 'boolean' ? input.shell.blurBackground : undefined,
      safeAreaInsetPx: Number.isFinite(Number(input.shell.safeAreaInsetPx))
        ? Math.max(0, Math.min(48, Math.trunc(Number(input.shell.safeAreaInsetPx))))
        : undefined,
      transitionStyle:
        input.shell.transitionStyle === 'morph' || input.shell.transitionStyle === 'crossfade'
          ? input.shell.transitionStyle
          : undefined,
    };
  }
  if (input.stream && typeof input.stream === 'object') {
    next.stream = {
      layout: input.stream.layout === 'single_column' ? input.stream.layout : undefined,
      maxVisibleLiveCards: Number.isFinite(Number(input.stream.maxVisibleLiveCards))
        ? Math.max(1, Math.min(4, Math.trunc(Number(input.stream.maxVisibleLiveCards))))
        : undefined,
      collapseCompletedSteps: typeof input.stream.collapseCompletedSteps === 'boolean' ? input.stream.collapseCompletedSteps : undefined,
      artifactAutoMinimize: typeof input.stream.artifactAutoMinimize === 'boolean' ? input.stream.artifactAutoMinimize : undefined,
      artifactOpenMode:
        input.stream.artifactOpenMode === 'inline' || input.stream.artifactOpenMode === 'overlay'
          ? input.stream.artifactOpenMode
          : undefined,
    };
  }
  if (input.inputs && typeof input.inputs === 'object') {
    next.inputs = {
      text: typeof input.inputs.text === 'boolean' ? input.inputs.text : undefined,
      voice: typeof input.inputs.voice === 'boolean' ? input.inputs.voice : undefined,
      files: typeof input.inputs.files === 'boolean' ? input.inputs.files : undefined,
      acceptedMimeGroups: Array.isArray(input.inputs.acceptedMimeGroups)
        ? input.inputs.acceptedMimeGroups.filter(group => group === 'images' || group === 'pdfs' || group === 'office' || group === 'text')
        : undefined,
      allowMultipleFiles: typeof input.inputs.allowMultipleFiles === 'boolean' ? input.inputs.allowMultipleFiles : undefined,
      mobileCameraCapture: typeof input.inputs.mobileCameraCapture === 'boolean' ? input.inputs.mobileCameraCapture : undefined,
      attachmentLimit: Number.isFinite(Number(input.inputs.attachmentLimit))
        ? Math.max(1, Math.min(12, Math.trunc(Number(input.inputs.attachmentLimit))))
        : undefined,
      maxFileSizeMb: Number.isFinite(Number(input.inputs.maxFileSizeMb))
        ? Math.max(1, Math.min(32, Math.trunc(Number(input.inputs.maxFileSizeMb))))
        : undefined,
    };
  }
  if (input.audio && typeof input.audio === 'object') {
    const narrationInput = input.audio.narration && typeof input.audio.narration === 'object'
      ? input.audio.narration
      : undefined;
    if (narrationInput) {
      next.audio = {
        narration: {
          enabled: typeof narrationInput.enabled === 'boolean' ? narrationInput.enabled : undefined,
          defaultMode:
            narrationInput.defaultMode === 'guided' || narrationInput.defaultMode === 'always' || narrationInput.defaultMode === 'off'
              ? narrationInput.defaultMode
              : undefined,
          rate: Number.isFinite(Number(narrationInput.rate))
            ? Math.max(0.85, Math.min(1.15, Number(narrationInput.rate)))
            : undefined,
          language: String(narrationInput.language || '').trim().slice(0, 24) || undefined,
          voicePreference:
            narrationInput.voicePreference === 'auto' ||
            narrationInput.voicePreference === 'system' ||
            narrationInput.voicePreference === 'natural'
              ? narrationInput.voicePreference
              : undefined,
        },
      };
    }
  }
  if (input.motion && typeof input.motion === 'object') {
    next.motion = {
      intensity:
        input.motion.intensity === 'calm' || input.motion.intensity === 'balanced' || input.motion.intensity === 'expressive'
          ? input.motion.intensity
          : undefined,
      reducedMotionFallback:
        input.motion.reducedMotionFallback === 'reduce' || input.motion.reducedMotionFallback === 'remove'
          ? input.motion.reducedMotionFallback
          : undefined,
      performanceBudget:
        input.motion.performanceBudget === 'standard' || input.motion.performanceBudget === 'high'
          ? input.motion.performanceBudget
          : undefined,
      actionSpotlight: typeof input.motion.actionSpotlight === 'boolean' ? input.motion.actionSpotlight : undefined,
      actionSpotlightColor: normalizeHexColor(input.motion.actionSpotlightColor),
      actionSpotlightRunKinds: Array.isArray(input.motion.actionSpotlightRunKinds)
        ? (input.motion.actionSpotlightRunKinds.filter(k => k === 'guide' || k === 'task') as Array<'guide' | 'task'>)
        : undefined,
      filaments: typeof input.motion.filaments === 'boolean' ? input.motion.filaments : undefined,
      particles: typeof input.motion.particles === 'boolean' ? input.motion.particles : undefined,
      palimpsest: typeof input.motion.palimpsest === 'boolean' ? input.motion.palimpsest : undefined,
    };
  }
  if (input.theme && typeof input.theme === 'object') {
    next.theme = {
      mode: input.theme.mode === 'auto' || input.theme.mode === 'light' || input.theme.mode === 'dark' ? input.theme.mode : undefined,
      accentColor: sanitizeText(String(input.theme.accentColor || '')).slice(0, 32) || undefined,
      surfaceStyle:
        input.theme.surfaceStyle === 'glass' || input.theme.surfaceStyle === 'solid'
          ? input.theme.surfaceStyle
          : undefined,
      radius:
        input.theme.radius === 'soft' || input.theme.radius === 'rounded' || input.theme.radius === 'pill'
          ? input.theme.radius
          : undefined,
      fontFamily: String(input.theme.fontFamily || '').trim().slice(0, 120) || undefined,
    };
  }
  return next;
}

export function resolveMountExperienceConfig(opts: MountOptions, agentName: string, mascotDisabled: boolean): RoverExperienceConfig {
  const explicit = sanitizeExperienceConfig(opts.experience);
  const presetMode = explicit.experienceMode;
  const presetSpotlight = presetMode === 'guided' ? true : presetMode === 'minimal' ? false : undefined;
  const presetSpotlightRunKinds: ReadonlyArray<'guide' | 'task'> | undefined =
    presetMode === 'guided' ? ['guide'] : undefined;
  const presetNarrationEnabled = presetMode === 'minimal' ? false : undefined;
  const presetNarrationMode: 'guided' | 'always' | 'off' | undefined =
    presetMode === 'guided' ? 'guided' : presetMode === 'minimal' ? 'off' : undefined;
  return {
    experienceMode: presetMode,
    presence: {
      assistantName: explicit.presence?.assistantName || agentName,
      ctaText: explicit.presence?.ctaText || `Do it with ${agentName}`,
      iconMode: explicit.presence?.iconMode || (mascotDisabled ? 'logo' : 'mascot'),
      draggable: explicit.presence?.draggable ?? true,
      defaultAnchor: explicit.presence?.defaultAnchor || 'bottom-center',
      persistPosition: explicit.presence?.persistPosition ?? false,
      idleAnimation: explicit.presence?.idleAnimation || 'breathe',
      firstRunIntro: explicit.presence?.firstRunIntro || 'ambient',
      defaultState: explicit.presence?.defaultState,
    },
    shell: {
      openMode: 'center_stage',
      mobileMode: 'fullscreen_sheet',
      desktopSize: explicit.shell?.desktopSize || 'stage',
      desktopHeight: explicit.shell?.desktopHeight || 'tall',
      dimBackground: explicit.shell?.dimBackground ?? true,
      blurBackground: explicit.shell?.blurBackground ?? true,
      safeAreaInsetPx: explicit.shell?.safeAreaInsetPx ?? 16,
      transitionStyle: explicit.shell?.transitionStyle || 'morph',
    },
    stream: {
      layout: 'single_column',
      maxVisibleLiveCards: explicit.stream?.maxVisibleLiveCards ?? 2,
      collapseCompletedSteps: explicit.stream?.collapseCompletedSteps ?? true,
      artifactAutoMinimize: explicit.stream?.artifactAutoMinimize ?? true,
      artifactOpenMode: explicit.stream?.artifactOpenMode || 'inline',
    },
    inputs: {
      text: explicit.inputs?.text ?? true,
      voice: explicit.inputs?.voice ?? true,
      files: explicit.inputs?.files ?? true,
      acceptedMimeGroups: explicit.inputs?.acceptedMimeGroups || ['images', 'pdfs', 'office', 'text'],
      allowMultipleFiles: explicit.inputs?.allowMultipleFiles ?? true,
      mobileCameraCapture: explicit.inputs?.mobileCameraCapture ?? true,
      attachmentLimit: explicit.inputs?.attachmentLimit ?? DEFAULT_ATTACHMENT_LIMIT,
      maxFileSizeMb: explicit.inputs?.maxFileSizeMb ?? DEFAULT_ATTACHMENT_MAX_FILE_SIZE_MB,
    },
    audio: {
      narration: {
        enabled: explicit.audio?.narration?.enabled ?? presetNarrationEnabled ?? true,
        defaultMode: explicit.audio?.narration?.defaultMode || presetNarrationMode || 'guided',
        rate: explicit.audio?.narration?.rate ?? 1,
        language: explicit.audio?.narration?.language || 'en-US',
        voicePreference: explicit.audio?.narration?.voicePreference || 'auto',
      },
    },
    motion: {
      intensity: explicit.motion?.intensity || 'balanced',
      reducedMotionFallback: explicit.motion?.reducedMotionFallback || 'reduce',
      performanceBudget: explicit.motion?.performanceBudget || 'standard',
      actionSpotlight: explicit.motion?.actionSpotlight ?? presetSpotlight ?? true,
      actionSpotlightColor:
        explicit.motion?.actionSpotlightColor ||
        normalizeHexColor(explicit.theme?.accentColor) ||
        DEFAULT_ACTION_SPOTLIGHT_COLOR,
      actionSpotlightRunKinds: explicit.motion?.actionSpotlightRunKinds || presetSpotlightRunKinds,
      filaments: explicit.motion?.filaments,
      particles: explicit.motion?.particles,
      palimpsest: explicit.motion?.palimpsest,
    },
    theme: {
      mode: explicit.theme?.mode || 'auto',
      accentColor: explicit.theme?.accentColor || DEFAULT_ACTION_SPOTLIGHT_COLOR,
      surfaceStyle: explicit.theme?.surfaceStyle || 'glass',
      radius: explicit.theme?.radius || 'pill',
      fontFamily: explicit.theme?.fontFamily,
    },
  };
}

export function resolveAgentName(input?: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) return DEFAULT_AGENT_NAME;
  return normalized.slice(0, 64);
}

export function deriveAgentInitial(name: string): string {
  const normalized = String(name || '').trim();
  if (!normalized) return 'R';
  return normalized[0].toUpperCase();
}

export function deriveLauncherToken(name: string): string {
  const compact = String(name || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return compact || 'RVR';
}

export function buildAttachmentAccept(acceptedMimeGroups?: Array<'images' | 'pdfs' | 'office' | 'text'>): string {
  const groups = Array.isArray(acceptedMimeGroups) && acceptedMimeGroups.length > 0
    ? acceptedMimeGroups
    : ['images', 'pdfs', 'office', 'text'];
  const out: string[] = [];
  for (const group of groups) {
    if (group === 'images') out.push('image/*');
    if (group === 'pdfs') out.push('application/pdf');
    if (group === 'office') out.push('.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.rtf');
    if (group === 'text') out.push('text/plain,.md,.txt,.json');
  }
  return out.join(',');
}

/** Derive accent-related CSS variables from a hex color. */
export function deriveAccentTokens(hex: string): Record<string, string> {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return {};
  const clean = normalized.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return {};
  }
  const darken = (v: number, amt: number) => Math.max(0, Math.round(v * (1 - amt)));
  return {
    '--rv-accent': normalized,
    '--rv-accent-rgb': `${r}, ${g}, ${b}`,
    '--rv-accent-hover': `#${darken(r, 0.1).toString(16).padStart(2, '0')}${darken(g, 0.1).toString(16).padStart(2, '0')}${darken(b, 0.1).toString(16).padStart(2, '0')}`,
    '--rv-accent-soft': `rgba(${r}, ${g}, ${b}, 0.06)`,
    '--rv-accent-border': `rgba(${r}, ${g}, ${b}, 0.14)`,
    '--rv-accent-glow': `rgba(${r}, ${g}, ${b}, 0.10)`,
  };
}

/** Derive dedicated Action Spotlight CSS variables from a hex color. */
export function deriveActionSpotlightTokens(hex?: string, fallbackHex = DEFAULT_ACTION_SPOTLIGHT_COLOR): Record<string, string> {
  const normalized = normalizeHexColor(hex) || normalizeHexColor(fallbackHex) || DEFAULT_ACTION_SPOTLIGHT_COLOR;
  const clean = normalized.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return {};
  }
  return {
    '--rv-action-spotlight': normalized,
    '--rv-action-spotlight-rgb': `${r}, ${g}, ${b}`,
    '--rv-action-spotlight-fill': `rgba(${r}, ${g}, ${b}, 0.045)`,
    '--rv-action-spotlight-halo': `rgba(${r}, ${g}, ${b}, 0.12)`,
    '--rv-action-spotlight-glow': `rgba(${r}, ${g}, ${b}, 0.18)`,
    '--rv-action-spotlight-pulse': `rgba(${r}, ${g}, ${b}, 0.22)`,
    '--rv-action-spotlight-pulse-soft': `rgba(${r}, ${g}, ${b}, 0.06)`,
    '--rv-action-spotlight-dark-fill': `rgba(${r}, ${g}, ${b}, 0.07)`,
    '--rv-action-spotlight-dark-halo': `rgba(${r}, ${g}, ${b}, 0.16)`,
    '--rv-action-spotlight-dark-glow': `rgba(${r}, ${g}, ${b}, 0.22)`,
  };
}
