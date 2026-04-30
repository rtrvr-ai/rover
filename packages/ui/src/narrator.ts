export type RoverNarrator = {
  isSupported: () => boolean;
  unlock: () => void;
  speak: (text: string, options?: RoverNarratorSpeakOptions) => void;
  cancel: () => void;
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
};

export type RoverNarratorSpeakOptions = {
  mode?: 'append' | 'replace';
  key?: string;
  priority?: 'low' | 'normal' | 'high';
};

export type RoverSpeechVoiceOption = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

export type RoverNarratorOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceURI?: string;
  voicePreference?: 'auto' | 'system' | 'natural';
  voiceMatcher?: (voice: SpeechSynthesisVoice) => number;
};

const MAX_NARRATION_CHARS = 220;
const MAX_CHUNK_CHARS = 150;
const MAX_PENDING_UTTERANCES = 4;
const MAX_PENDING_SPEECH_MS = 7_000;
const CATCH_UP_NARRATION = 'Continuing through the form.';
const VOICE_POLL_INTERVAL_MS = 250;
const VOICE_POLL_ATTEMPTS = 10;
const NATURAL_VOICE_RE = /google|natural|neural|online|premium|enhanced/i;

function normalizeNarrationText(input: string): string {
  return String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NARRATION_CHARS)
    .trim();
}

function clampRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0.85, Math.min(1.15, parsed));
}

function splitNarration(text: string): string[] {
  const normalized = normalizeNarrationText(text);
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const next = sentence.trim();
    if (!next) continue;
    if ((current ? `${current} ${next}` : next).length <= MAX_CHUNK_CHARS) {
      current = current ? `${current} ${next}` : next;
      continue;
    }
    if (current) chunks.push(current);
    current = next.length > MAX_CHUNK_CHARS ? next.slice(0, MAX_CHUNK_CHARS).trim() : next;
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 3);
}

function estimateSpeechMs(text: string): number {
  const normalized = normalizeNarrationText(text);
  if (!normalized) return 0;
  return Math.max(900, Math.min(5_000, normalized.length * 55));
}

function scoreVoice(
  voice: SpeechSynthesisVoice,
  lang: string,
  preference: RoverNarratorOptions['voicePreference'],
  matcher?: (voice: SpeechSynthesisVoice) => number,
): number {
  let score = 0;
  const voiceLang = String(voice.lang || '').toLowerCase();
  const desired = lang.toLowerCase();
  const desiredBase = desired.split('-')[0];
  if (voiceLang === desired) score += 80;
  else if (desiredBase && voiceLang.startsWith(desiredBase)) score += 55;
  else if (voiceLang.startsWith('en')) score += 20;
  if (preference === 'system' && voice.localService) score += 24;
  if (preference !== 'system' && NATURAL_VOICE_RE.test(voice.name || '')) score += 36;
  if (preference === 'natural' && voice.localService === false) score += 18;
  if (/female|samantha|victoria|karen|zira|aria|jenny/i.test(voice.name || '')) score += 2;
  if (matcher) score += matcher(voice);
  return score;
}

export function listWebSpeechVoiceOptions(): RoverSpeechVoiceOption[] {
  const synth: SpeechSynthesis | undefined = typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined;
  if (!synth) return [];
  const seen = new Set<string>();
  const out: RoverSpeechVoiceOption[] = [];
  for (const voice of Array.from(synth.getVoices?.() || [])) {
    const key = String(voice.voiceURI || `${voice.name}:${voice.lang}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      voiceURI: String(voice.voiceURI || key),
      name: String(voice.name || 'System voice'),
      lang: String(voice.lang || ''),
      localService: voice.localService === true,
      default: voice.default === true,
    });
  }
  return out.sort((a, b) => {
    if (a.lang !== b.lang) return a.lang.localeCompare(b.lang);
    return a.name.localeCompare(b.name);
  });
}

export function createWebSpeechNarrator(opts: RoverNarratorOptions = {}): RoverNarrator {
  const synth: SpeechSynthesis | undefined = typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined;
  const UtteranceCtor: typeof SpeechSynthesisUtterance | undefined =
    typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined;
  const supported = !!synth && !!UtteranceCtor;
  const lang = String(opts.lang || 'en-US').trim() || 'en-US';
  const rate = clampRate(opts.rate);
  const pitch = Number.isFinite(Number(opts.pitch)) ? Math.max(0.7, Math.min(1.3, Number(opts.pitch))) : 1;
  const preference = opts.voicePreference || 'auto';
  const preferredVoiceURI = String(opts.voiceURI || '').trim();
  let enabled = true;
  let unlocked = false;
  let disposed = false;
  let selectedVoice: SpeechSynthesisVoice | null = null;
  let queue: Array<{
    text: string;
    chunks: string[];
    key?: string;
    priority: 'low' | 'normal' | 'high';
    catchUp?: boolean;
    estimatedMs: number;
  }> = [];
  let activeItem: typeof queue[number] | null = null;
  let activeChunkIndex = 0;
  let activeGeneration = 0;
  let activeWatchdog: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function selectVoice(): SpeechSynthesisVoice | null {
    if (!supported || !synth) return null;
    const voices = Array.from(synth.getVoices?.() || []);
    if (!voices.length) return null;
    if (preferredVoiceURI) {
      const exact = voices.find(voice => String(voice.voiceURI || '') === preferredVoiceURI);
      if (exact) {
        selectedVoice = exact;
        return selectedVoice;
      }
    }
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -Infinity;
    for (const voice of voices) {
      const score = scoreVoice(voice, lang, preference, opts.voiceMatcher);
      if (score > bestScore) {
        best = voice;
        bestScore = score;
      }
    }
    selectedVoice = best;
    return selectedVoice;
  }

  function ensureVoices(): void {
    if (!supported || !synth || selectedVoice) return;
    selectVoice();
    let attempts = 0;
    if (selectedVoice || pollTimer) return;
    pollTimer = setInterval(() => {
      attempts += 1;
      selectVoice();
      if (selectedVoice || attempts >= VOICE_POLL_ATTEMPTS) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    }, VOICE_POLL_INTERVAL_MS);
  }

  function clearActiveWatchdog(): void {
    if (!activeWatchdog) return;
    try { clearTimeout(activeWatchdog); } catch { /* ignore */ }
    activeWatchdog = null;
  }

  function estimateQueuedMs(): number {
    return queue.reduce((sum, item) => sum + item.estimatedMs, 0);
  }

  function insertCatchUpIfNeeded(dropped: boolean): void {
    if (!dropped) return;
    if (queue.some(item => item.catchUp) || activeItem?.catchUp) return;
    queue = [
      {
        text: CATCH_UP_NARRATION,
        chunks: [CATCH_UP_NARRATION],
        key: 'catch-up',
        priority: 'normal',
        catchUp: true,
        estimatedMs: estimateSpeechMs(CATCH_UP_NARRATION),
      },
      ...queue.slice(-(MAX_PENDING_UTTERANCES - 1)),
    ];
  }

  function enforceQueueBudget(): void {
    let dropped = false;
    while (queue.length > MAX_PENDING_UTTERANCES || estimateQueuedMs() > MAX_PENDING_SPEECH_MS) {
      const lowPriorityIndex = queue.findIndex(item => item.priority === 'low' && !item.catchUp);
      const normalPriorityIndex = queue.findIndex(item => item.priority === 'normal' && !item.catchUp);
      const dropIndex = lowPriorityIndex >= 0
        ? lowPriorityIndex
        : normalPriorityIndex >= 0
          ? normalPriorityIndex
          : queue.findIndex(item => !item.catchUp);
      if (dropIndex < 0) break;
      queue.splice(dropIndex, 1);
      dropped = true;
    }
    insertCatchUpIfNeeded(dropped);
    while (queue.length > MAX_PENDING_UTTERANCES) {
      queue.splice(queue.length - 1, 1);
    }
  }

  function cancelSpeech(): void {
    queue = [];
    activeItem = null;
    activeChunkIndex = 0;
    activeGeneration += 1;
    clearActiveWatchdog();
    try { synth?.cancel(); } catch { /* ignore */ }
  }

  function finishActiveChunk(generation: number): void {
    if (generation !== activeGeneration) return;
    clearActiveWatchdog();
    if (!activeItem) return;
    activeChunkIndex += 1;
    if (activeChunkIndex < activeItem.chunks.length) {
      speakNextChunk();
      return;
    }
    activeItem = null;
    activeChunkIndex = 0;
    speakNextChunk();
  }

  function speakNextChunk(): void {
    if (!supported || !synth || !UtteranceCtor || disposed || !enabled || !unlocked) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!activeItem) {
      activeItem = queue.shift() || null;
      activeChunkIndex = 0;
    }
    if (!activeItem) return;
    const chunk = activeItem.chunks[activeChunkIndex];
    if (!chunk) {
      activeItem = null;
      activeChunkIndex = 0;
      speakNextChunk();
      return;
    }
    ensureVoices();
    const utterance = new UtteranceCtor(chunk);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (selectedVoice) utterance.voice = selectedVoice;
    const generation = activeGeneration;
    utterance.onend = () => finishActiveChunk(generation);
    utterance.onerror = () => finishActiveChunk(generation);
    clearActiveWatchdog();
    activeWatchdog = setTimeout(() => finishActiveChunk(generation), estimateSpeechMs(chunk) + 3_000);
    try {
      synth.speak(utterance);
    } catch {
      finishActiveChunk(generation);
    }
  }

  function enqueueSpeech(text: string, options: RoverNarratorSpeakOptions = {}): void {
    if (!supported || !synth || !UtteranceCtor || disposed || !enabled) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const normalized = normalizeNarrationText(text);
    const chunks = splitNarration(normalized);
    if (!chunks.length) return;
    const mode = options.mode || 'replace';
    if (mode === 'replace') cancelSpeech();
    const key = String(options.key || '').trim().slice(0, 160) || undefined;
    if (mode === 'append' && key) {
      const duplicateIndex = queue.findIndex(item => item.key === key);
      if (duplicateIndex >= 0) {
        queue[duplicateIndex] = {
          ...queue[duplicateIndex],
          text: normalized,
          chunks,
          estimatedMs: estimateSpeechMs(normalized),
        };
        enforceQueueBudget();
        if (unlocked) speakNextChunk();
        return;
      }
      if (activeItem?.key === key && activeItem.priority !== 'high') return;
    }
    queue.push({
      text: normalized,
      chunks,
      key,
      priority: options.priority || 'normal',
      estimatedMs: estimateSpeechMs(normalized),
    });
    enforceQueueBudget();
    if (unlocked) speakNextChunk();
  }

  function handleVoicesChanged(): void {
    selectedVoice = null;
    selectVoice();
  }

  function handleVisibilityChange(): void {
    if (typeof document !== 'undefined' && document.hidden) {
      try { synth?.cancel(); } catch { /* ignore */ }
    } else if (unlocked) {
      try { synth?.resume?.(); } catch { /* ignore */ }
      speakNextChunk();
    }
  }

  if (supported && synth) {
    ensureVoices();
    try { synth.addEventListener?.('voiceschanged', handleVoicesChanged); } catch { /* ignore */ }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  return {
    isSupported: () => supported && !disposed,
    unlock() {
      if (!supported || !synth || !UtteranceCtor || disposed) return;
      unlocked = true;
      try { synth.resume?.(); } catch { /* ignore */ }
      try {
        const silent = new UtteranceCtor(' ');
        silent.volume = 0;
        silent.lang = lang;
        synth.speak(silent);
      } catch { /* ignore */ }
      speakNextChunk();
    },
    speak(text: string, options?: RoverNarratorSpeakOptions) {
      enqueueSpeech(text, options);
    },
    cancel() {
      cancelSpeech();
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      if (!enabled) {
        cancelSpeech();
      }
    },
    dispose() {
      disposed = true;
      queue = [];
      activeItem = null;
      clearActiveWatchdog();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      try { synth?.cancel(); } catch { /* ignore */ }
      try { synth?.removeEventListener?.('voiceschanged', handleVoicesChanged); } catch { /* ignore */ }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    },
  };
}
