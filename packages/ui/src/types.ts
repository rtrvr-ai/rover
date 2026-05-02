import type { ToolOutput } from '@rover/shared/lib/types/index.js';
export type { RoverVoiceConfig, RoverVoiceTelemetryEvent } from './voice.js';
import type { RoverVoiceConfig, RoverVoiceTelemetryEvent } from './voice.js';

export type RoverShortcut = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  prompt: string;
  enabled?: boolean;
  order?: number;
  routing?: 'auto' | 'act' | 'planner';
  runKind?: 'guide' | 'task';
  tags?: string[];
  examples?: string[];
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  sideEffect?: 'none' | 'read' | 'write' | 'transactional';
  requiresConfirmation?: boolean;
  preferredInterface?: 'run' | 'shortcut' | 'client_tool' | 'webmcp';
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
  | 'assistant_response'
  | 'thought'
  | 'info'
  | 'debug'
  | 'error';

export type RoverAssistantResponseKind = 'checkpoint' | 'final' | 'question' | 'error';

export type RoverExecutionMode = 'controller' | 'observer';

export type RoverActionCueKind =
  | 'click'
  | 'type'
  | 'select'
  | 'clear'
  | 'focus'
  | 'hover'
  | 'press'
  | 'scroll'
  | 'drag'
  | 'copy'
  | 'paste'
  | 'upload'
  | 'navigate'
  | 'read'
  | 'wait'
  | 'unknown';

export type RoverActionCue = {
  kind: RoverActionCueKind;
  toolCallId?: string;
  primaryElementId?: number;
  elementIds?: number[];
  logicalTabId?: number;
  valueRedacted?: boolean;
  targetLabel?: string;
};

export type RoverTimelineEvent = {
  id?: string;
  kind: RoverTimelineKind;
  title: string;
  detail?: string;
  detailBlocks?: RoverMessageBlock[];
  status?: 'pending' | 'success' | 'error' | 'info';
  ts?: number;
  elementId?: number;
  toolName?: string;
  narration?: string;
  narrationActive?: boolean;
  // Per-step override for the action spotlight gate. When set, takes precedence over
  // site preset / runKind / visitor toggle. Undefined means defer to default behavior.
  actionSpotlightActive?: boolean;
  responseKind?: RoverAssistantResponseKind;
  actionCue?: RoverActionCue;
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

export type RoverThoughtStyle = 'concise_cards' | 'minimal';

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

/** Presence state for the four-state system. */
export type RoverPresenceState = 'seed' | 'bar' | 'window';

export type RoverUi = {
  addMessage: (
    role: 'user' | 'assistant' | 'system',
    text: string,
    options?: { blocks?: RoverMessageBlock[] },
  ) => void;
  setTranscript: (
    messages: Array<{
      id?: string;
      role: 'user' | 'assistant' | 'system';
      text: string;
      blocks?: RoverMessageBlock[];
      ts?: number;
    }>,
    timeline: RoverTimelineEvent[],
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
  setPlaceholders?: (phrases: string[]) => void;
  setExperience: (experience?: RoverExperienceConfig) => void;
  open: () => void;
  close: () => void;
  minimize: () => void;
  maximize: () => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
  setState: (state: RoverPresenceState) => void;
  getState: () => RoverPresenceState;
  // Multi-conversation support
  setTabs: (tabs: RoverTabInfo[]) => void;
  setConversations: (conversations: ConversationListItem[]) => void;
  setActiveConversationId: (id: string) => void;
  getScrollPosition: () => number;
  setScrollPosition: (position: number) => void;
  showPausedTaskBanner: (task: { taskId: string; rootUserInput: string }) => void;
  hidePausedTaskBanner: () => void;
};

export type RoverExperienceMode = 'guided' | 'minimal';

export type RoverExperienceConfig = {
  experienceMode?: RoverExperienceMode;
  presence?: {
    assistantName?: string;
    ctaText?: string;
    iconMode?: 'logo' | 'mascot' | 'rover';
    draggable?: boolean;
    defaultAnchor?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';
    persistPosition?: boolean;
    idleAnimation?: 'breathe' | 'orbit' | 'none';
    firstRunIntro?: 'ambient' | 'headline' | 'none';
    defaultState?: 'seed' | 'bar';
  };
  shell?: {
    openMode?: 'center_stage';
    mobileMode?: 'fullscreen_sheet';
    desktopSize?: 'compact' | 'stage' | 'cinema';
    desktopHeight?: 'tall' | 'full';
    dimBackground?: boolean;
    blurBackground?: boolean;
    safeAreaInsetPx?: number;
    transitionStyle?: 'morph' | 'crossfade';
  };
  stream?: {
    layout?: 'single_column';
    maxVisibleLiveCards?: number;
    collapseCompletedSteps?: boolean;
    artifactAutoMinimize?: boolean;
    artifactOpenMode?: 'inline' | 'overlay';
  };
  inputs?: {
    text?: boolean;
    voice?: boolean;
    files?: boolean;
    acceptedMimeGroups?: Array<'images' | 'pdfs' | 'office' | 'text'>;
    allowMultipleFiles?: boolean;
    mobileCameraCapture?: boolean;
    attachmentLimit?: number;
    maxFileSizeMb?: number;
  };
  audio?: {
    narration?: {
      enabled?: boolean;
      defaultMode?: 'guided' | 'always' | 'off';
      rate?: number;
      language?: string;
      voicePreference?: 'auto' | 'system' | 'natural';
    };
  };
  motion?: {
    intensity?: 'calm' | 'balanced' | 'expressive';
    reducedMotionFallback?: 'reduce' | 'remove';
    performanceBudget?: 'standard' | 'high';
    actionSpotlight?: boolean;
    actionSpotlightColor?: string;
    actionSpotlightRunKinds?: ReadonlyArray<'guide' | 'task'>;
    filaments?: boolean;
    particles?: boolean;
    palimpsest?: boolean;
  };
  theme?: {
    mode?: 'auto' | 'light' | 'dark';
    accentColor?: string;
    surfaceStyle?: 'glass' | 'solid';
    radius?: 'soft' | 'rounded' | 'pill';
    fontFamily?: string;
  };
};

export type MountOptions = {
  resolveElement?: (elementId: number) => Element | null;
  getLocalLogicalTabId?: () => number | undefined;
  onSend: (text: string, meta?: {
    askUserAnswers?: RoverAskUserAnswerMeta;
    attachments?: File[];
    narrationEnabledForRun?: boolean;
    narrationPreferenceSource?: 'default' | 'visitor';
    narrationDefaultActiveForRun?: boolean;
    narrationRunKind?: 'guide' | 'task';
    narrationLanguage?: string;
    actionSpotlightEnabledForRun?: boolean;
    actionSpotlightPreferenceSource?: 'default' | 'visitor';
    actionSpotlightRunKind?: 'guide' | 'task';
    actionSpotlightDefaultActiveForRun?: boolean;
  }) => void;
  onVoiceTelemetry?: (event: RoverVoiceTelemetryEvent, payload?: Record<string, unknown>) => void;
  onNarrationPreferenceChange?: (enabled: boolean, available: boolean, source: 'default' | 'visitor', language?: string) => void;
  onSpotlightPreferenceChange?: (enabled: boolean, available: boolean, source: 'default' | 'visitor') => void;
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
  onShortcutClick?: (shortcut: RoverShortcut, meta?: {
    narrationEnabledForRun?: boolean;
    narrationPreferenceSource?: 'default' | 'visitor';
    narrationDefaultActiveForRun?: boolean;
    narrationRunKind?: 'guide' | 'task';
    narrationLanguage?: string;
    actionSpotlightEnabledForRun?: boolean;
    actionSpotlightPreferenceSource?: 'default' | 'visitor';
    actionSpotlightRunKind?: 'guide' | 'task';
    actionSpotlightDefaultActiveForRun?: boolean;
  }) => void;
  showTaskControls?: boolean;
  muted?: boolean;
  thoughtStyle?: RoverThoughtStyle;
  agent?: {
    name?: string;
  };
  mascot?: {
    disabled?: boolean;
    imageUrl?: string;
    mp4Url?: string;
    webmUrl?: string;
    soundEnabled?: boolean;
  };
  greeting?: {
    text?: string;
    delay?: number;
    duration?: number;
    disabled?: boolean;
  };
  panel?: {
    resizable?: boolean;
  };
  siteId?: string;
  experience?: RoverExperienceConfig;
  voice?: RoverVoiceConfig;
  visitorName?: string;
  // Multi-conversation callbacks
  onSwitchConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onOpenConversations?: () => void;
  onResumeTask?: (taskId: string) => void;
  onCancelPausedTask?: (taskId: string) => void;
  onTabClick?: (logicalTabId: number) => void;
};

export type RoverPanelLayout = 'desktop' | 'tablet' | 'phone';
export type RoverPanelOrientation = 'portrait' | 'landscape';
export type RoverPanelLayoutKey =
  | 'desktop'
  | 'tablet-portrait'
  | 'tablet-landscape'
  | 'phone-portrait'
  | 'phone-landscape';
export type RoverSheetPreset = 0 | 1 | 2;

export type RoverViewportMetrics = {
  width: number;
  height: number;
  layout: RoverPanelLayout;
  orientation: RoverPanelOrientation;
  storageKey: RoverPanelLayoutKey;
  keyboardInset: number;
};

export type RoverDesktopPanelState = {
  width: number;
  height: number;
};

export type RoverSheetPanelState = {
  preset: RoverSheetPreset;
};

export type RoverPanelStorageState = Partial<Record<RoverPanelLayoutKey, RoverDesktopPanelState | RoverSheetPanelState>>;

export type RoverPresencePosition = {
  x: number;
  y: number;
};

export type RoverMood = 'idle' | 'typing' | 'running' | 'success' | 'error' | 'waiting';
