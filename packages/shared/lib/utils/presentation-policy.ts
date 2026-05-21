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
  /\bshow\s+(?:me\s+)?(?:a|the)?\s*demo\b/i,
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
  // Additional strong guide signals (lose to task when both fire, but catch
  // common request phrasings on their own).
  /\bcan\s+you\s+demo\b/i,
  /\b(?:live|quick|interactive|product|short|video)\s+demo\b/i,
  /\bi\s+want\s+(?:a|to\s+see\s+a)\s+demo\b/i,
  /\bi\s+want\s+to\s+(?:try|see|learn)\b/i,
  /\blet\s+me\s+(?:try|see)\b/i,
  /\bsign\s+me\s+up\b/i,
  /\bnewbie\b/i,
  /\bwhat\s+should\s+i\s+do\s+first\b/i,
  /\bnew\s+to\s+(?:this|rover|the\s+platform|the\s+app|here)\b/i,
  /\bwhere\s+do\s+i\s+(?:start|begin)\b/i,
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
  /\bhands[- ]on\b/i,
  /\bget\s+to\s+know\b/i,
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
  // Direct hand-holding asks.
  /\bshow\s+me\s+how\s+to\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bteach\s+me\s+(?:how\s+)?to\b/i,

  // Explicit demo / tour / walkthrough / tutorial / demonstration / presentation
  // asks. Definitive guide-intent markers; override a co-occurring task verb
  // (e.g. "show me a demo of how to run a workflow" — "demo of" is the user's
  // ask, "run a workflow" is just the topic).
  /\bshow\s+me\s+(?:a|the)\s+(?:demo|tour|walkthrough|tutorial|demonstration|presentation)\b/i,
  /\bgive\s+me\s+(?:a|the)\s+(?:demo|tour|walkthrough|tutorial|demonstration|presentation)\b/i,
  /\b(?:demo|tour|walkthrough|tutorial|demonstration)\s+(?:of|on|for|about)\b/i,
  // Narrow presentation override — must say "presentation of how" / "presentation
  // about how" so we don't catch "create a presentation about Q4" (slides task).
  /\bpresentation\s+(?:of|about)\s+how\b/i,

  // Polite "can/could/would you" hand-holding asks.
  /\b(?:can|could|would)\s+you\s+(?:demo|walk|tour|teach|explain|guide|show\s+me)\b/i,

  // "Take me on a tour" / "take me through".
  /\btake\s+me\s+(?:on\s+a\s+)?(?:tour|through)\b/i,

  // Step-by-step requests.
  /\bstep[- ]by[- ]step\b/i,
  /\bgo\s+through\s+(?:it|this|that|the\s+\w+)\s+(?:with\s+me|step\s+by\s+step|step[- ]by[- ]step)\b/i,

  // Onboarding asks.
  /\bonboard\s+me\b/i,
  /\bhelp\s+me\s+onboard\b/i,
  /\b(?:i'?m|i\s+am)\s+new\s+(?:here|to)\b/i,
  /\bfirst[- ]time\s+(?:user|using|here|setting?\s+up)\b/i,

  // How-to questions — promoted from STRONG so they beat task verbs (e.g.
  // "how do I extract X" is a how-to ask, not a pure task command).
  /\bhow\s+(?:do|can)\s+(?:i|we)\b/i,
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

  // Visitor-driven narration: when the speaker icon is effectively ON
  // (visitor toggled it, or site default is on and the visitor has not
  // disabled it), treat the run as a 'task' so the policy chain stays
  // "active" all the way through to the worker. Without this, an ordinary
  // typed query has no runKind, presentationIntent collapses to 'off', and
  // the worker silences narration text generation — even though the visitor
  // clearly asked for voice via the UI toggle.
  if (!runKind && narrationAvailable && !visitorNarrationOff && input.narrationVisitorEnabled === true) {
    runKind = 'task';
    source = source === 'default' ? 'visitor' : source;
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
      // Visitor's effective enabled state is the source of truth. If the
      // speaker icon shows ON (whether from an explicit toggle click or
      // because site default is on), narration is active — regardless of
      // whether a host-API runKind was supplied. This unifies the gate so
      // ordinary user queries narrate just like guided demos do.
      input.narrationVisitorEnabled === true
      || defaultMode === 'always'
      || (defaultMode === 'guided' && runKind === 'guide')
    );
  const spotlightActive = spotlightAvailable
    && !visitorSpotlightOff
    && (
      // Same source-of-truth model as narration: if the visitor has
      // highlighting effectively enabled (currently piggybacks on the
      // narration toggle until we split them), spotlight is active.
      input.actionSpotlightVisitorEnabled === true
      || (!!runKind && runKindAllowed(runKind, input.actionSpotlightAllowedRunKinds))
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
