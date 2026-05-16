import type { ToolOutput } from '@rover/shared/lib/types/index.js';
import type {
  RoverPresentationIntent,
  RoverPresentationPolicySource,
  RoverSpeechProvider,
} from '@rover/shared/lib/utils/presentation-policy.js';
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

export type RoverPresentationDirective = {
  source?: 'act' | 'plan';
  shouldNarrate?: boolean;
  speechText?: string;
  displayText?: string;
  spotlightTargetIds?: string[];
  groupKey?: string;
  intentStage?: string;
  captionTtlMs?: number;
  sensitivity?: 'none' | 'personal' | 'secret' | 'payment';
  actionRefs?: string[];
  narrationActive?: boolean;
  speechProvider?: RoverSpeechProvider;
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
  presentation?: RoverPresentationDirective;
  narration?: string;
  narrationActive?: boolean;
  speechProvider?: RoverSpeechProvider;
  // Per-step override for the action spotlight gate. When set, takes precedence over
  // site preset / runKind / visitor toggle. Undefined means defer to default behavior.
  spotlightActive?: boolean;
  /** Alternate name accepted on read. Reader prefers `spotlightActive`; both shapes flow through the SDK timeline for cross-product (rtrvr extension / boot-config / older Rover payloads) compatibility. */
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
  clearLiveExecution?: (options?: { preserveNarration?: boolean }) => void;
  setTaskSuggestion: (suggestion: RoverTaskSuggestion) => void;
  setStatus: (text: string) => void;
  setRunning: (running: boolean, options?: { preserveNarration?: boolean; openOnStop?: boolean }) => void;
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
  setEntitlements?: (entitlements?: RoverRuntimeEntitlements) => void;
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
  /**
   * Mid-run "steering" feedback lifecycle. The SDK calls markFeedbackQueued
   * optimistically when the visitor sends; markFeedbackApplied / Dropped
   * fire when the worker emits the corresponding ack event. Optional so the
   * UI can ship without breaking older SDK consumers.
   */
  markFeedbackQueued?: (id: string, text: string, source: 'text' | 'voice') => void;
  markFeedbackApplied?: (id: string, atStepIndex: number) => void;
  markFeedbackDropped?: (id: string, reason: string) => void;
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

export type RoverRuntimeEntitlements = {
  naturalVoiceNarration?: boolean;
  naturalVoiceDictation?: boolean;
};

export type RoverPresentationRunMeta = {
  askUserAnswers?: RoverAskUserAnswerMeta;
  attachments?: File[];
  presentationVoiceAvailable?: boolean;
  presentationVoicePreferenceSource?: 'default' | 'visitor';
  presentationVoiceDefaultActive?: boolean;
  presentationRunKind?: 'guide' | 'task';
  narrationLanguage?: string;
  presentationIntent?: RoverPresentationIntent;
  presentationPolicySource?: RoverPresentationPolicySource;
  speechProvider?: RoverSpeechProvider;
  presentationSpotlightAvailable?: boolean;
  presentationSpotlightPreferenceSource?: 'default' | 'visitor';
  presentationSpotlightDefaultActive?: boolean;
  // Alternate field names accepted from boot config and cross-product callers
  // (rtrvr-relay extension, third-party SDK integrations, older Rover snippets).
  // Canonical equivalents are the `presentationVoice*` / `presentationSpotlight*` /
  // `presentationRunKind` fields above. Both shapes flow through; readers prefer
  // the canonical name with `?? <alias>` fallback.
  narrationEnabledForRun?: boolean;
  narrationPreferenceSource?: 'default' | 'visitor';
  narrationDefaultActiveForRun?: boolean;
  narrationRunKind?: 'guide' | 'task';
  actionSpotlightEnabledForRun?: boolean;
  actionSpotlightPreferenceSource?: 'default' | 'visitor';
  actionSpotlightRunKind?: 'guide' | 'task';
  actionSpotlightDefaultActiveForRun?: boolean;
};

export type MountOptions = {
  resolveElement?: (elementId: number) => Element | null;
  getLocalLogicalTabId?: () => number | undefined;
  onSend: (text: string, meta?: RoverPresentationRunMeta) => void;
  /**
   * Mid-run steering: when the visitor submits while a run is active (and no
   * ask_user question is showing), the UI routes the submission here instead
   * of `onSend`. The host SDK forwards it as a `user_feedback` postMessage
   * to the worker. The UI itself manages the optimistic "Queued" card via
   * `markFeedbackQueued` once this callback is invoked.
   */
  onSendFeedback?: (text: string, opts: { source: 'text' | 'voice' }) => void;
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
  onShortcutClick?: (shortcut: RoverShortcut, meta?: RoverPresentationRunMeta) => void;
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
  apiBase?: string;
  getAudioAuth?: () => Promise<{ sessionId?: string; sessionToken?: string }>;
  siteId?: string;
  experience?: RoverExperienceConfig;
  voice?: RoverVoiceConfig;
  entitlements?: RoverRuntimeEntitlements;
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
