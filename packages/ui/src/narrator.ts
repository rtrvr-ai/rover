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
  provider?: 'browser' | 'elevenlabs';
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceURI?: string;
  voicePreference?: 'auto' | 'system' | 'natural';
  voiceMatcher?: (voice: SpeechSynthesisVoice) => number;
  apiBase?: string;
  getAuth?: () => Promise<{ sessionId?: string; sessionToken?: string }>;
  onProviderFailure?: (text?: string, options?: RoverNarratorSpeakOptions) => void;
};

const MAX_NARRATION_CHARS = 220;
const MAX_CHUNK_CHARS = 150;
const MAX_PENDING_UTTERANCES = 4;
const MAX_PENDING_SPEECH_MS = 7_000;
const CATCH_UP_NARRATION = 'Continuing through the form.';
const VOICE_POLL_INTERVAL_MS = 250;
const VOICE_POLL_ATTEMPTS = 10;
const NATURAL_VOICE_RE = /google|natural|neural|online|premium|enhanced/i;
const ELEVENLABS_CACHE_MAX_ITEMS = 64;
const ELEVENLABS_CACHE_MAX_TEXT_CHARS = 140;
const ELEVENLABS_NARRATION_CACHE = new Map<string, Promise<Blob>>();
const ELEVENLABS_AUDIO_PROFILE_CACHE = new Map<string, { voiceId?: string; modelId?: string; language?: string }>();

function normalizeNarrationText(input: string): string {
  return String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NARRATION_CHARS)
    .trim();
}

function resolveNarrationApiBase(apiBase?: string): string {
  const raw = String(apiBase || '').trim();
  if (!raw) return 'https://agent.rtrvr.ai';
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  try {
    const parsed = new URL(raw, window.location.href);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'https://agent.rtrvr.ai';
  }
}

function normalizeCachePart(input: unknown): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'default';
}

function buildElevenLabsSessionCacheKey(apiBase: string, sessionId: string): string {
  return `${apiBase}:${normalizeCachePart(sessionId)}`;
}

function buildElevenLabsCacheKey(input: {
  apiBase: string;
  sessionId?: string;
  language?: string;
  voiceId?: string;
  modelId?: string;
  voiceURI?: string;
  voicePreference?: string;
  text: string;
}): string {
  const voice = input.voiceId || input.voiceURI || input.voicePreference || 'server';
  return [
    normalizeCachePart(input.apiBase),
    `session=${normalizeCachePart(input.sessionId)}`,
    `lang=${normalizeCachePart(input.language || 'default')}`,
    `voice=${normalizeCachePart(voice)}`,
    `model=${normalizeCachePart(input.modelId || 'server')}`,
    normalizeNarrationText(input.text).toLowerCase(),
  ].join('|');
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

export function createElevenLabsNarrator(opts: RoverNarratorOptions = {}): RoverNarrator {
  const supported = typeof fetch === 'function'
    && typeof Audio !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof opts.getAuth === 'function';
  let enabled = true;
  let unlocked = false;
  let disposed = false;
  let permanentlyDisabled = false;
  let activeAudio: HTMLAudioElement | null = null;
  let activeObjectUrl: string | null = null;
  let activeAbort: AbortController | null = null;
  let playing = false;
  let generation = 0;
  let queue: Array<{
    text: string;
    key?: string;
    priority: 'low' | 'normal' | 'high';
    estimatedMs: number;
  }> = [];

  function notifyProviderFailure(item?: { text: string; key?: string; priority: 'low' | 'normal' | 'high' }): void {
    try {
      opts.onProviderFailure?.(item?.text, item
        ? { mode: 'append', key: item.key, priority: item.priority }
        : undefined);
    } catch {
      // Narration fallback is best-effort.
    }
  }

  function cleanupActive(): void {
    if (activeAbort) {
      try { activeAbort.abort(); } catch { /* ignore */ }
      activeAbort = null;
    }
    if (activeAudio) {
      try { activeAudio.pause(); } catch { /* ignore */ }
      activeAudio.src = '';
      activeAudio = null;
    }
    if (activeObjectUrl) {
      try { URL.revokeObjectURL(activeObjectUrl); } catch { /* ignore */ }
      activeObjectUrl = null;
    }
    playing = false;
  }

  function cancelSpeech(): void {
    queue = [];
    generation += 1;
    cleanupActive();
  }

  function enforceQueueBudget(): void {
    let totalMs = queue.reduce((sum, item) => sum + item.estimatedMs, 0);
    while (queue.length > MAX_PENDING_UTTERANCES || totalMs > MAX_PENDING_SPEECH_MS) {
      const dropIndex = queue.findIndex(item => item.priority !== 'high');
      queue.splice(dropIndex >= 0 ? dropIndex : 0, 1);
      totalMs = queue.reduce((sum, item) => sum + item.estimatedMs, 0);
    }
  }

  function rememberCachedBlob(key: string, blobPromise: Promise<Blob>): void {
    if (ELEVENLABS_NARRATION_CACHE.has(key)) {
      ELEVENLABS_NARRATION_CACHE.delete(key);
    }
    ELEVENLABS_NARRATION_CACHE.set(key, blobPromise);
    while (ELEVENLABS_NARRATION_CACHE.size > ELEVENLABS_CACHE_MAX_ITEMS) {
      const oldest = ELEVENLABS_NARRATION_CACHE.keys().next().value;
      if (!oldest) break;
      ELEVENLABS_NARRATION_CACHE.delete(oldest);
    }
  }

  async function playBlob(blob: Blob, item: { text: string; key?: string; priority: 'low' | 'normal' | 'high' }, currentGeneration: number): Promise<void> {
    if (currentGeneration !== generation || disposed) {
      cleanupActive();
      return;
    }
    const audio = new Audio();
    activeAudio = audio;
    activeObjectUrl = URL.createObjectURL(blob);
    audio.src = activeObjectUrl;
    audio.onended = () => {
      cleanupActive();
      void playNext(generation);
    };
    audio.onerror = () => {
      cleanupActive();
      void playNext(generation);
    };
    await audio.play().catch(() => {
      notifyProviderFailure(item);
      cleanupActive();
      void playNext(generation);
    });
  }

  async function playNext(currentGeneration: number): Promise<void> {
    if (!supported || permanentlyDisabled || disposed || !enabled || !unlocked || playing) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const item = queue.shift();
    if (!item) return;
    playing = true;
    const abort = new AbortController();
    activeAbort = abort;
    try {
      const auth = await opts.getAuth?.();
      const sessionToken = String(auth?.sessionToken || '').trim();
      if (!sessionToken || currentGeneration !== generation || disposed) {
        cleanupActive();
        return;
      }
      const apiBase = resolveNarrationApiBase(opts.apiBase);
      const sessionId = String(auth?.sessionId || '').trim();
      const profileKey = buildElevenLabsSessionCacheKey(apiBase, sessionId);
      const profile = ELEVENLABS_AUDIO_PROFILE_CACHE.get(profileKey);
      const cacheKey = buildElevenLabsCacheKey({
        apiBase,
        sessionId,
        language: profile?.language || opts.lang,
        voiceId: profile?.voiceId,
        modelId: profile?.modelId,
        voiceURI: opts.voiceURI,
        voicePreference: opts.voicePreference,
        text: item.text,
      });
      const cached = item.text.length <= ELEVENLABS_CACHE_MAX_TEXT_CHARS
        ? ELEVENLABS_NARRATION_CACHE.get(cacheKey)
        : undefined;
      if (cached) {
        const blob = await cached;
        await playBlob(blob, item, currentGeneration);
        return;
      }
      const response = await fetch(`${apiBase}/v2/rover/audio/narration/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        signal: abort.signal,
        body: JSON.stringify({
          sessionToken,
          sessionId: auth?.sessionId,
          text: item.text,
        }),
      });
      if ((response.status === 401 || response.status === 403) && currentGeneration === generation && !disposed) {
        permanentlyDisabled = true;
        notifyProviderFailure(item);
        cleanupActive();
        return;
      }
      if (!response.ok || currentGeneration !== generation || disposed) {
        notifyProviderFailure(item);
        cleanupActive();
        void playNext(generation);
        return;
      }
      const responseVoiceId = response.headers?.get?.('x-rover-voice-id') || undefined;
      const responseModelId = response.headers?.get?.('x-rover-tts-model')
        || response.headers?.get?.('x-rover-audio-model')
        || undefined;
      const responseLanguage = response.headers?.get?.('x-rover-tts-language') || undefined;
      if (responseVoiceId || responseModelId || responseLanguage) {
        ELEVENLABS_AUDIO_PROFILE_CACHE.set(profileKey, {
          voiceId: responseVoiceId || profile?.voiceId,
          modelId: responseModelId || profile?.modelId,
          language: responseLanguage || profile?.language || opts.lang,
        });
      }
      const responseCacheKey = buildElevenLabsCacheKey({
        apiBase,
        sessionId,
        language: responseLanguage || profile?.language || opts.lang,
        voiceId: responseVoiceId || profile?.voiceId,
        modelId: responseModelId || profile?.modelId,
        voiceURI: opts.voiceURI,
        voicePreference: opts.voicePreference,
        text: item.text,
      });
      const cachedBlobPromise = item.text.length <= ELEVENLABS_CACHE_MAX_TEXT_CHARS
        ? response.clone().blob()
        : undefined;
      if (cachedBlobPromise) {
        cachedBlobPromise.catch(() => {
          ELEVENLABS_NARRATION_CACHE.delete(cacheKey);
          ELEVENLABS_NARRATION_CACHE.delete(responseCacheKey);
        });
        rememberCachedBlob(cacheKey, cachedBlobPromise);
        if (responseCacheKey !== cacheKey) rememberCachedBlob(responseCacheKey, cachedBlobPromise);
      }
      const streamed = await playStreamingResponse(response, currentGeneration);
      if (streamed) return;
      const blob = cachedBlobPromise ? await cachedBlobPromise : await response.blob();
      await playBlob(blob, item, currentGeneration);
    } catch {
      if (!abort.signal.aborted && currentGeneration === generation && !disposed) {
        notifyProviderFailure(item);
      }
      cleanupActive();
      void playNext(generation);
    }
  }

  async function playStreamingResponse(response: Response, currentGeneration: number): Promise<boolean> {
    const body = response.body;
    const MediaSourceCtor = typeof MediaSource !== 'undefined' ? MediaSource : undefined;
    if (!body || !MediaSourceCtor || !MediaSourceCtor.isTypeSupported?.('audio/mpeg')) return false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const audio = new Audio();
      const mediaSource = new MediaSourceCtor();
      activeAudio = audio;
      activeObjectUrl = URL.createObjectURL(mediaSource);
      audio.src = activeObjectUrl;
      audio.onended = () => {
        cleanupActive();
        void playNext(generation);
      };
      audio.onerror = () => {
        cleanupActive();
        void playNext(generation);
      };
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          try { mediaSource.removeEventListener('sourceopen', onOpen); } catch { /* ignore */ }
          try { mediaSource.removeEventListener('error', onError); } catch { /* ignore */ }
        };
        const onOpen = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('MediaSource failed.')); };
        if (mediaSource.readyState === 'open') {
          resolve();
          return;
        }
        mediaSource.addEventListener('sourceopen', onOpen, { once: true });
        mediaSource.addEventListener('error', onError, { once: true });
      });
      if (currentGeneration !== generation || disposed) return true;
      const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
      const appendChunk = (chunk: Uint8Array) => new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          try { sourceBuffer.removeEventListener('updateend', onDone); } catch { /* ignore */ }
          try { sourceBuffer.removeEventListener('error', onError); } catch { /* ignore */ }
        };
        const onDone = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('Audio stream append failed.')); };
        sourceBuffer.addEventListener('updateend', onDone, { once: true });
        sourceBuffer.addEventListener('error', onError, { once: true });
        const buffer = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(buffer).set(chunk);
        sourceBuffer.appendBuffer(buffer);
      });
      reader = body.getReader();
      let playStarted = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        if (currentGeneration !== generation || disposed) return true;
        await appendChunk(value);
        if (!playStarted) {
          playStarted = true;
          await audio.play();
        }
      }
      if (mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream(); } catch { /* ignore */ }
      }
      if (!playStarted) return false;
      return true;
    } catch {
      try { await reader?.cancel(); } catch { /* ignore */ }
      if (activeAudio) {
        try { activeAudio.pause(); } catch { /* ignore */ }
        activeAudio.src = '';
        activeAudio = null;
      }
      if (activeObjectUrl) {
        try { URL.revokeObjectURL(activeObjectUrl); } catch { /* ignore */ }
        activeObjectUrl = null;
      }
      playing = false;
      return false;
    }
  }

  function enqueueSpeech(text: string, options: RoverNarratorSpeakOptions = {}): void {
    if (!supported || permanentlyDisabled || disposed || !enabled) return;
    const normalized = normalizeNarrationText(text);
    if (!normalized) return;
    if ((options.mode || 'replace') === 'replace') cancelSpeech();
    const key = String(options.key || '').trim().slice(0, 160) || undefined;
    if (key && queue.some(item => item.key === key)) return;
    queue.push({
      text: normalized,
      key,
      priority: options.priority || 'normal',
      estimatedMs: estimateSpeechMs(normalized),
    });
    enforceQueueBudget();
    void playNext(generation);
  }

  return {
    isSupported: () => supported && !permanentlyDisabled && !disposed,
    unlock() {
      if (!supported || permanentlyDisabled || disposed) return;
      unlocked = true;
      void playNext(generation);
    },
    speak(text: string, options?: RoverNarratorSpeakOptions) {
      enqueueSpeech(text, options);
    },
    cancel() {
      cancelSpeech();
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      if (!enabled) cancelSpeech();
    },
    dispose() {
      disposed = true;
      cancelSpeech();
    },
  };
}

export function createRoverNarrator(opts: RoverNarratorOptions = {}): RoverNarrator {
  const browserNarrator = createWebSpeechNarrator(opts);
  if (opts.provider !== 'elevenlabs') return browserNarrator;

  let enabled = true;
  let unlocked = false;
  let disposed = false;
  let active: RoverNarrator = browserNarrator;
  let elevenLabsNarrator: RoverNarrator | null = null;

  function switchToBrowserFallback(text?: string, options?: RoverNarratorSpeakOptions): void {
    if (disposed || active === browserNarrator) return;
    try { elevenLabsNarrator?.dispose(); } catch { /* ignore */ }
    active = browserNarrator;
    active.setEnabled(enabled);
    if (unlocked) active.unlock();
    if (text) active.speak(text, options);
  }

  elevenLabsNarrator = createElevenLabsNarrator({
    ...opts,
    provider: 'elevenlabs',
    onProviderFailure: switchToBrowserFallback,
  });
  if (elevenLabsNarrator.isSupported()) {
    active = elevenLabsNarrator;
  }

  return {
    isSupported: () => !disposed && (active.isSupported() || browserNarrator.isSupported()),
    unlock() {
      if (disposed) return;
      unlocked = true;
      active.unlock();
    },
    speak(text: string, options?: RoverNarratorSpeakOptions) {
      if (disposed) return;
      active.speak(text, options);
    },
    cancel() {
      active.cancel();
      if (active !== browserNarrator) browserNarrator.cancel();
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      active.setEnabled(nextEnabled);
      if (active !== browserNarrator) browserNarrator.setEnabled(nextEnabled);
    },
    dispose() {
      disposed = true;
      try { active.dispose(); } catch { /* ignore */ }
      if (active !== browserNarrator) {
        try { browserNarrator.dispose(); } catch { /* ignore */ }
      }
    },
  };
}
