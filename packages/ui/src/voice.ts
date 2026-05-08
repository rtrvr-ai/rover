export type RoverVoiceConfig = {
  enabled?: boolean;
  language?: string;
  autoStopMs?: number;
};

export type RoverVoiceTelemetryEvent =
  | 'voice_started'
  | 'voice_stopped'
  | 'voice_transcript_ready'
  | 'voice_error'
  | 'voice_permission_denied'
  | 'voice_provider_selected';

export type VoiceRecognitionResult = {
  finalTranscript: string;
  interimTranscript: string;
};

export type VoiceRecognitionErrorCode =
  | 'permission_denied'
  | 'audio_capture'
  | 'network'
  | 'no_speech'
  | 'aborted'
  | 'unsupported'
  | 'unknown';

export type VoiceRecognitionError = {
  code: VoiceRecognitionErrorCode;
  message: string;
  recoverable: boolean;
};

export type VoiceRecognitionEndMeta = {
  requested: boolean;
};

export type VoiceTranscriberHandlers = {
  onStart?: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onResult?: (result: VoiceRecognitionResult) => void;
  onEnd?: (meta: VoiceRecognitionEndMeta) => void;
  onError?: (error: VoiceRecognitionError) => void;
};

export type VoiceTranscriber = {
  isSupported: () => boolean;
  start: (options?: { language?: string }) => void;
  stop: () => void;
  dispose: () => void;
};

export type VoiceAuthProvider = () => Promise<{
  sessionId?: string;
  sessionToken?: string;
}>;

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
};

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal?: boolean;
};

type SpeechRecognitionEventLike = Event & {
  results?: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => any) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => any) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => any) | null;
  onspeechstart: ((this: SpeechRecognitionLike, ev: Event) => any) | null;
  onspeechend: ((this: SpeechRecognitionLike, ev: Event) => any) | null;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructorLike | undefined {
  const root = window as Window & typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  return root.SpeechRecognition || root.webkitSpeechRecognition;
}

function normalizeVoiceText(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readTranscripts(event: SpeechRecognitionEventLike): VoiceRecognitionResult {
  const results = event.results;
  if (!results || typeof results.length !== 'number') {
    return {
      finalTranscript: '',
      interimTranscript: '',
    };
  }

  const finals: string[] = [];
  const interim: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result || typeof result.length !== 'number') continue;
    const transcript = normalizeVoiceText(String(result[0]?.transcript || ''));
    if (!transcript) continue;
    if (result.isFinal) finals.push(transcript);
    else interim.push(transcript);
  }

  return {
    finalTranscript: normalizeVoiceText(finals.join(' ')),
    interimTranscript: normalizeVoiceText(interim.join(' ')),
  };
}

function normalizeVoiceError(event: SpeechRecognitionErrorEventLike | unknown): VoiceRecognitionError {
  const rawCode = typeof (event as SpeechRecognitionErrorEventLike | undefined)?.error === 'string'
    ? String((event as SpeechRecognitionErrorEventLike).error || '').trim().toLowerCase()
    : '';
  const rawMessage = typeof (event as SpeechRecognitionErrorEventLike | undefined)?.message === 'string'
    ? String((event as SpeechRecognitionErrorEventLike).message || '').trim()
    : '';

  if (rawCode === 'not-allowed' || rawCode === 'service-not-allowed') {
    return {
      code: 'permission_denied',
      message: 'Microphone access was blocked. Allow microphone access and try again.',
      recoverable: false,
    };
  }
  if (rawCode === 'audio-capture') {
    return {
      code: 'audio_capture',
      message: 'No working microphone was found for voice dictation.',
      recoverable: true,
    };
  }
  if (rawCode === 'network') {
    return {
      code: 'network',
      message: 'Network issues interrupted browser dictation.',
      recoverable: true,
    };
  }
  if (rawCode === 'no-speech') {
    return {
      code: 'no_speech',
      message: 'No speech was detected.',
      recoverable: true,
    };
  }
  if (rawCode === 'aborted') {
    return {
      code: 'aborted',
      message: 'Voice dictation was interrupted.',
      recoverable: true,
    };
  }

  return {
    code: 'unknown',
    message: rawMessage || 'Voice dictation stopped unexpectedly.',
    recoverable: true,
  };
}

// ── Audio Analyser (for voice-active visualisation) ──

export type AudioAnalyser = {
  start: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
  isActive: () => boolean;
};

export function createAudioAnalyser(handlers: {
  onFrequencyData?: (avg: number) => void;
}): AudioAnalyser {
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;
  let rafId: number | null = null;
  let active = false;
  let disposed = false;
  let dataArray: Uint8Array<ArrayBuffer> | null = null;

  function tick(): void {
    if (!active || !analyser || !dataArray) { rafId = null; return; }
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length / 255; // normalize to 0-1
    handlers.onFrequencyData?.(avg);
    rafId = requestAnimationFrame(tick);
  }

  async function start(): Promise<void> {
    if (disposed || active) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      // Do NOT connect to destination (no playback)
      active = true;
      rafId = requestAnimationFrame(tick);
    } catch {
      // Silently fail if permissions denied
      cleanup();
    }
  }

  function cleanup(): void {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (source) { try { source.disconnect(); } catch {} source = null; }
    if (analyser) { try { analyser.disconnect(); } catch {} analyser = null; }
    if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    dataArray = null;
    active = false;
  }

  function stop(): void {
    cleanup();
  }

  function dispose(): void {
    disposed = true;
    cleanup();
  }

  return {
    start,
    stop,
    dispose,
    isActive: () => active,
  };
}

export function createBrowserVoiceTranscriber(handlers: VoiceTranscriberHandlers = {}): VoiceTranscriber {
  let recognition: SpeechRecognitionLike | null = null;
  let disposed = false;
  let stopRequested = false;

  function cleanupRecognition(): void {
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onspeechstart = null;
    recognition.onspeechend = null;
    recognition = null;
  }

  function createRecognition(language?: string): SpeechRecognitionLike | null {
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) return null;
    const next = new RecognitionCtor();
    next.continuous = true;
    next.interimResults = true;
    next.maxAlternatives = 1;
    next.lang = String(language || navigator.language || 'en-US').trim() || 'en-US';
    next.onstart = () => {
      handlers.onStart?.();
    };
    next.onresult = (event) => {
      handlers.onResult?.(readTranscripts(event));
    };
    next.onspeechstart = () => {
      handlers.onSpeechStart?.();
    };
    next.onspeechend = () => {
      handlers.onSpeechEnd?.();
    };
    next.onerror = (event) => {
      handlers.onError?.(normalizeVoiceError(event));
    };
    next.onend = () => {
      const requested = stopRequested;
      stopRequested = false;
      cleanupRecognition();
      handlers.onEnd?.({ requested });
    };
    return next;
  }

  return {
    isSupported(): boolean {
      return !!getSpeechRecognitionCtor();
    },
    start(options?: { language?: string }): void {
      if (disposed) return;
      if (recognition) return;
      const nextRecognition = createRecognition(options?.language);
      if (!nextRecognition) {
        handlers.onError?.({
          code: 'unsupported',
          message: 'Voice dictation is not available in this browser.',
          recoverable: false,
        });
        return;
      }
      recognition = nextRecognition;
      stopRequested = false;
      try {
        recognition.start();
      } catch (error) {
        cleanupRecognition();
        handlers.onError?.(normalizeVoiceError(error));
        handlers.onEnd?.({ requested: false });
      }
    },
    stop(): void {
      if (!recognition) return;
      stopRequested = true;
      try {
        recognition.stop();
      } catch {
        cleanupRecognition();
        handlers.onEnd?.({ requested: true });
      }
    },
    dispose(): void {
      disposed = true;
      stopRequested = true;
      if (!recognition) return;
      const current = recognition;
      cleanupRecognition();
      try {
        current.abort?.();
      } catch {
        // no-op
      }
    },
  };
}

type ElevenLabsRealtimeTokenResponse = {
  token?: string;
  wssUrl?: string;
  modelId?: string;
  data?: {
    token?: string;
    wssUrl?: string;
    modelId?: string;
  };
};

function resolveAudioApiBase(apiBase?: string): string {
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

function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = count ? sum / count : input[start] || 0;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function normalizeScribeError(message: string): VoiceRecognitionError {
  return {
    code: /permission|auth/i.test(message) ? 'permission_denied' : /network|socket/i.test(message) ? 'network' : 'unknown',
    message: message || 'ElevenLabs dictation stopped unexpectedly.',
    recoverable: true,
  };
}

export function createElevenLabsVoiceTranscriber(input: {
  apiBase?: string;
  getAuth?: VoiceAuthProvider;
  modelId?: string;
  handlers?: VoiceTranscriberHandlers;
}): VoiceTranscriber {
  const handlers = input.handlers || {};
  let disposed = false;
  let stopRequested = false;
  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;
  let stream: MediaStream | null = null;
  let committedTranscript = '';
  let interimTranscript = '';
  let speechActive = false;
  let started = false;
  let starting = false;
  let endEmitted = true;
  let stopCommitTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStopCommitTimer(): void {
    if (!stopCommitTimer) return;
    try { clearTimeout(stopCommitTimer); } catch { /* ignore */ }
    stopCommitTimer = null;
  }

  function cleanupAudio(): void {
    if (processor) {
      try { processor.disconnect(); } catch { /* ignore */ }
      processor.onaudioprocess = null;
      processor = null;
    }
    if (sink) {
      try { sink.disconnect(); } catch { /* ignore */ }
      sink = null;
    }
    if (source) {
      try { source.disconnect(); } catch { /* ignore */ }
      source = null;
    }
    if (audioCtx) {
      try { void audioCtx.close(); } catch { /* ignore */ }
      audioCtx = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    if (speechActive) {
      speechActive = false;
      handlers.onSpeechEnd?.();
    }
  }

  function cleanupSocket(): void {
    if (!ws) return;
    const current = ws;
    ws = null;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try { current.close(); } catch { /* ignore */ }
  }

  function finishEnd(requested: boolean): void {
    if (endEmitted) return;
    endEmitted = true;
    starting = false;
    started = false;
    clearStopCommitTimer();
    cleanupAudio();
    cleanupSocket();
    handlers.onEnd?.({ requested });
  }

  function emitResult(): void {
    handlers.onResult?.({
      finalTranscript: normalizeVoiceText(committedTranscript),
      interimTranscript: normalizeVoiceText(interimTranscript),
    });
  }

  function handleMessage(event: MessageEvent): void {
    let payload: any;
    try {
      payload = JSON.parse(String(event.data || '{}'));
    } catch {
      return;
    }
    const type = String(payload.message_type || payload.type || '').trim();
    const text = normalizeVoiceText(String(payload.text || ''));
    if (type === 'partial_transcript') {
      interimTranscript = text;
      emitResult();
      return;
    }
    if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
      if (text) {
        committedTranscript = normalizeVoiceText(`${committedTranscript} ${text}`);
      }
      interimTranscript = '';
      emitResult();
      if (speechActive) {
        speechActive = false;
        handlers.onSpeechEnd?.();
      }
      if (stopRequested) {
        finishEnd(true);
      }
      return;
    }
    if (/error|quota|rate_limited|throttled|resource_exhausted/i.test(type)) {
      handlers.onError?.(normalizeScribeError(String(payload.message || payload.error || type)));
      finishEnd(false);
    }
  }

  async function fetchToken(language?: string): Promise<string> {
    const auth = await input.getAuth?.();
    const sessionToken = String(auth?.sessionToken || '').trim();
    if (!sessionToken) throw new Error('Rover session is not ready for ElevenLabs dictation.');
    const response = await fetch(`${resolveAudioApiBase(input.apiBase)}/v2/rover/audio/stt-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        sessionToken,
        sessionId: auth?.sessionId,
        language,
        modelId: input.modelId,
      }),
    });
    if (!response.ok) throw new Error(`ElevenLabs dictation token failed (${response.status}).`);
    const json = await response.json() as ElevenLabsRealtimeTokenResponse;
    return String(json.wssUrl || json.data?.wssUrl || '').trim();
  }

  async function startAudioCapture(socket: WebSocket): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextCtor();
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(2048, 1, 1);
    sink = audioCtx.createGain();
    sink.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!ws || socket.readyState !== WebSocket.OPEN) return;
      const channel = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo16k(channel, audioCtx?.sampleRate || 48000);
      let energy = 0;
      for (let i = 0; i < downsampled.length; i += 1) energy += Math.abs(downsampled[i]);
      if (energy / downsampled.length > 0.012) {
        if (!speechActive) {
          speechActive = true;
          handlers.onSpeechStart?.();
        }
      }
      const pcm = floatTo16BitPcm(downsampled);
      socket.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: bytesToBase64(new Uint8Array(pcm.buffer)),
        sample_rate: 16000,
        commit: false,
      }));
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioCtx.destination);
  }

  function waitForCommittedStop(): void {
    clearStopCommitTimer();
    stopCommitTimer = setTimeout(() => finishEnd(true), 1_200);
  }

  return {
    isSupported(): boolean {
      return typeof fetch === 'function'
        && typeof WebSocket !== 'undefined'
        && !!navigator.mediaDevices?.getUserMedia
        && !!(window.AudioContext || (window as any).webkitAudioContext)
        && typeof input.getAuth === 'function';
    },
    start(options?: { language?: string }): void {
      if (disposed || started || starting) return;
      stopRequested = false;
      starting = true;
      endEmitted = false;
      committedTranscript = '';
      interimTranscript = '';
      void (async () => {
        try {
          const wssUrl = await fetchToken(options?.language);
          if (!wssUrl || disposed || stopRequested || endEmitted) {
            finishEnd(stopRequested);
            return;
          }
          const socket = new WebSocket(wssUrl);
          ws = socket;
          socket.onopen = () => {
            if (disposed || stopRequested || endEmitted) {
              finishEnd(stopRequested);
              return;
            }
            starting = false;
            started = true;
            handlers.onStart?.();
            void startAudioCapture(socket).catch((error) => {
              handlers.onError?.(normalizeScribeError(error instanceof Error ? error.message : String(error)));
              finishEnd(false);
            });
          };
          socket.onmessage = handleMessage;
          socket.onerror = () => {
            handlers.onError?.(normalizeScribeError('ElevenLabs dictation socket failed.'));
            finishEnd(false);
          };
          socket.onclose = () => {
            finishEnd(stopRequested);
          };
        } catch (error) {
          handlers.onError?.(normalizeScribeError(error instanceof Error ? error.message : String(error)));
          finishEnd(false);
        }
      })();
    },
    stop(): void {
      stopRequested = true;
      cleanupAudio();
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: '',
            sample_rate: 16000,
            commit: true,
          }));
        } catch { /* ignore */ }
        waitForCommittedStop();
        return;
      }
      finishEnd(true);
    },
    dispose(): void {
      disposed = true;
      stopRequested = true;
      finishEnd(true);
      cleanupAudio();
      cleanupSocket();
    },
  };
}
