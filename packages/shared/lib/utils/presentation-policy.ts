export type RoverPresentationRunKind = 'guide' | 'task';
export type RoverPresentationIntent = 'off' | 'task' | 'guide';
export type RoverPresentationPolicySource =
  | 'visitor'
  | 'shortcut'
  | 'query'
  | 'api'
  | 'site_default'
  | 'voice'
  | 'heuristic'
  | 'default';
export type RoverSpeechProvider = 'elevenlabs' | 'browser' | 'none';

export type RoverPresentationPolicyInput = {
  userInput?: string;
  queryPrompt?: string;
  shortcutRunKind?: RoverPresentationRunKind;
  explicitRunKind?: RoverPresentationRunKind;
  explicitRunKindSource?: Extract<RoverPresentationPolicySource, 'shortcut' | 'query' | 'api' | 'site_default'>;
  voiceStarted?: boolean;
  narrationOwnerEnabled?: boolean;
  narrationAvailable?: boolean;
  narrationDefaultMode?: 'guided' | 'always' | 'off';
  narrationVisitorSource?: 'default' | 'visitor';
  narrationVisitorEnabled?: boolean;
  actionSpotlightOwnerEnabled?: boolean;
  actionSpotlightAvailable?: boolean;
  actionSpotlightAllowedRunKinds?: ReadonlyArray<RoverPresentationRunKind>;
  actionSpotlightVisitorSource?: 'default' | 'visitor';
  actionSpotlightVisitorEnabled?: boolean;
  naturalVoiceNarration?: boolean;
  browserVoiceSupported?: boolean;
};

export type RoverPresentationPolicy = {
  presentationIntent: RoverPresentationIntent;
  runKind?: RoverPresentationRunKind;
  voiceActive: boolean;
  /** @deprecated Use voiceActive. Kept for old UI/runtime callers. */
  narrationActive: boolean;
  spotlightActive: boolean;
  source: RoverPresentationPolicySource;
  speechProvider: RoverSpeechProvider;
};

const STRONG_GUIDE_PATTERNS: RegExp[] = [
  /\bproduct\s+demo\b/i,
  /\bproduct\s+walk[- ]?through\b/i,
  /\bguided?\s+tour\b/i,
  /\bgive\s+me\s+(?:a\s+)?(?:tour|demo|walkthrough)\b/i,
  /\bbook\s+a\s+demo\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?demo\b/i,
  /\bshow\s+me\s+how\b/i,
  /\bshow\s+me\s+around\b/i,
  /\bsee\s+how\s+(?:it|this)\s+works\b/i,
  /\bcan\s+you\s+show\s+me\b/i,
  /\bwalk(?:\s|-)?through\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bguide\s+me\b/i,
  /\bteach\s+me\b/i,
  /\bexplain\s+how\b/i,
  /\bhow\s+do\s+i\b/i,
  /\bhelp\s+me\s+get\s+started\b/i,
  /\bhelp\s+me\s+sign\s+up\b/i,
  /\bgetting\s+started\b/i,
  /\bonboarding\b/i,
  /\btutorial\b/i,
  /\boverview\b/i,
  /\btrial\b/i,
  /\blearn\b/i,
  /\bfind\s+the\s+right\s+plan\b/i,
  /\bchoose\s+(?:a\s+)?product\b/i,
  /\bcompare\s+plans?\b/i,
  /\bshow\s+(?:me\s+)?features?\b/i,
  /\bwhat\s+can\s+i\s+do\b/i,
  /\bwhere\s+should\s+i\s+start\b/i,
];

const GUIDE_TERMS: RegExp[] = [
  /\bdemo\b/i,
  /\btour\b/i,
  /\bguide\b/i,
  /\bsetup\b/i,
  /\bset\s+up\b/i,
  /\bsigning\s+up\b/i,
  /\bcheckout\s+flow\b/i,
  /\bintro(?:duction)?\b/i,
  /\bcapabilit(?:y|ies)\b/i,
];

const TASK_PATTERNS: RegExp[] = [
  /\bextract\b/i,
  /\bscrape\b/i,
  /\bcrawl\b/i,
  /\bdownload\b/i,
  /\bexport\b/i,
  /\bsummarize\b/i,
  /\bclassify\b/i,
  /\benrich\b/i,
  /\bautomate\b/i,
  /\bbatch\b/i,
  /\bbulk\b/i,
  /\bfor\s+each\b/i,
  /\bcreate\s+(?:a\s+)?sheet\b/i,
  /\bsend\b/i,
  /\bschedule\b/i,
  /\brun\s+(?:a\s+)?workflow\b/i,
  /\bdo\s+this\s+for\s+me\b/i,
  /\bbackground\b/i,
  /\bquick\s+task\b/i,
  /\bno\s+narration\b/i,
  /\bquiet\b/i,
  /\bmute\b/i,
  /\bsilent(?:ly)?\b/i,
];

const GUIDE_OVERRIDE_PATTERNS: RegExp[] = [
  /\bshow\s+me\s+how\s+to\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bteach\s+me\s+(?:how\s+)?to\b/i,
];

function normalizeRunKind(input: unknown): RoverPresentationRunKind | undefined {
  return input === 'guide' || input === 'task' ? input : undefined;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

export function inferRoverPresentationRunKindFromText(input: unknown): RoverPresentationRunKind | undefined {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (hasAny(text, GUIDE_OVERRIDE_PATTERNS)) return 'guide';
  const guide = hasAny(text, STRONG_GUIDE_PATTERNS) || hasAny(text, GUIDE_TERMS);
  const task = hasAny(text, TASK_PATTERNS);
  if (guide && !task) return 'guide';
  if (task && !guide) return 'task';
  if (guide && task) return 'task';
  return undefined;
}

function runKindAllowed(
  runKind: RoverPresentationRunKind | undefined,
  allowedKinds?: ReadonlyArray<RoverPresentationRunKind>,
): boolean {
  if (!allowedKinds || allowedKinds.length === 0) return true;
  return !!runKind && allowedKinds.includes(runKind);
}

function resolveSpeechProvider(input: RoverPresentationPolicyInput, narrationActive: boolean): RoverSpeechProvider {
  if (!narrationActive) return 'none';
  if (input.naturalVoiceNarration === true) return 'elevenlabs';
  return input.browserVoiceSupported === false ? 'none' : 'browser';
}

export function resolveRoverPresentationPolicy(input: RoverPresentationPolicyInput = {}): RoverPresentationPolicy {
  const narrationOwnerEnabled = input.narrationOwnerEnabled !== false;
  const narrationAvailable = narrationOwnerEnabled && input.narrationAvailable !== false;
  const spotlightOwnerEnabled = input.actionSpotlightOwnerEnabled !== false;
  const spotlightAvailable = spotlightOwnerEnabled && input.actionSpotlightAvailable !== false;
  const visitorNarrationOff = input.narrationVisitorSource === 'visitor' && input.narrationVisitorEnabled === false;
  const visitorSpotlightOff = input.actionSpotlightVisitorSource === 'visitor' && input.actionSpotlightVisitorEnabled === false;

  const explicitRunKind = normalizeRunKind(input.shortcutRunKind)
    || normalizeRunKind(input.explicitRunKind);
  const explicitSource: RoverPresentationPolicySource | undefined = normalizeRunKind(input.shortcutRunKind)
    ? 'shortcut'
    : (input.explicitRunKindSource || (explicitRunKind ? 'api' : undefined));

  let runKind = explicitRunKind;
  let source: RoverPresentationPolicySource = explicitSource || 'default';

  const defaultMode = input.narrationDefaultMode === 'always' || input.narrationDefaultMode === 'off'
    ? input.narrationDefaultMode
    : 'guided';
  if (!runKind && defaultMode === 'always') {
    runKind = 'task';
    source = 'site_default';
  }

  if (!runKind && input.voiceStarted === true && narrationAvailable && !visitorNarrationOff) {
    runKind = 'guide';
    source = 'voice';
  }

  if (!runKind) {
    const inferred = inferRoverPresentationRunKindFromText(
      [input.queryPrompt, input.userInput].filter(Boolean).join(' '),
    );
    if (inferred) {
      runKind = inferred;
      source = 'heuristic';
    }
  }

  const narrationActive = narrationAvailable
    && !visitorNarrationOff
    && (
      input.narrationVisitorSource === 'visitor'
        ? input.narrationVisitorEnabled === true
        : defaultMode === 'always' || (defaultMode === 'guided' && runKind === 'guide')
    );
  const spotlightActive = spotlightAvailable
    && !visitorSpotlightOff
    && (
      input.actionSpotlightVisitorSource === 'visitor'
        ? input.actionSpotlightVisitorEnabled === true
        : !!runKind && runKindAllowed(runKind, input.actionSpotlightAllowedRunKinds)
    );

  const presentationIntent: RoverPresentationIntent =
    runKind === 'guide' && (narrationActive || spotlightActive)
      ? 'guide'
      : runKind === 'task' && (narrationActive || spotlightActive)
        ? 'task'
        : 'off';
  const resolvedSource: RoverPresentationPolicySource =
    visitorNarrationOff && visitorSpotlightOff
      ? 'visitor'
      : presentationIntent === 'off'
        ? (source === 'default' ? 'default' : source)
        : source;

  return {
    presentationIntent,
    runKind,
    voiceActive: narrationActive,
    narrationActive,
    spotlightActive,
    source: resolvedSource,
    speechProvider: resolveSpeechProvider(input, narrationActive),
  };
}
