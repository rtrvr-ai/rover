export type RoverNarrator = {
  isSupported: () => boolean;
  unlock: () => void;
  speak: (text: string) => void;
  cancel: () => void;
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
};

export type RoverNarratorOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  voicePreference?: 'auto' | 'system' | 'natural';
  voiceMatcher?: (voice: SpeechSynthesisVoice) => number;
};

const MAX_NARRATION_CHARS = 220;
const MAX_CHUNK_CHARS = 150;
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

export function createWebSpeechNarrator(opts: RoverNarratorOptions = {}): RoverNarrator {
  const synth: SpeechSynthesis | undefined = typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined;
  const UtteranceCtor: typeof SpeechSynthesisUtterance | undefined =
    typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined;
  const supported = !!synth && !!UtteranceCtor;
  const lang = String(opts.lang || 'en-US').trim() || 'en-US';
  const rate = clampRate(opts.rate);
  const pitch = Number.isFinite(Number(opts.pitch)) ? Math.max(0.7, Math.min(1.3, Number(opts.pitch))) : 1;
  const preference = opts.voicePreference || 'auto';
  let enabled = true;
  let unlocked = false;
  let disposed = false;
  let selectedVoice: SpeechSynthesisVoice | null = null;
  let pendingText = '';
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function selectVoice(): SpeechSynthesisVoice | null {
    if (!supported || !synth) return null;
    const voices = Array.from(synth.getVoices?.() || []);
    if (!voices.length) return null;
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

  function speakNow(text: string): void {
    if (!supported || !synth || !UtteranceCtor || disposed || !enabled) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const chunks = splitNarration(text);
    if (!chunks.length) return;
    try { synth.cancel(); } catch { /* ignore */ }
    ensureVoices();
    for (const chunk of chunks) {
      const utterance = new UtteranceCtor(chunk);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      if (selectedVoice) utterance.voice = selectedVoice;
      try { synth.speak(utterance); } catch { /* ignore */ }
    }
  }

  function flushPending(): void {
    if (!pendingText) return;
    const next = pendingText;
    pendingText = '';
    speakNow(next);
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
      flushPending();
    },
    speak(text: string) {
      const normalized = normalizeNarrationText(text);
      if (!normalized || !enabled || disposed) return;
      if (!unlocked) {
        pendingText = normalized;
        return;
      }
      speakNow(normalized);
    },
    cancel() {
      pendingText = '';
      try { synth?.cancel(); } catch { /* ignore */ }
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      if (!enabled) {
        pendingText = '';
        try { synth?.cancel(); } catch { /* ignore */ }
      }
    },
    dispose() {
      disposed = true;
      pendingText = '';
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
