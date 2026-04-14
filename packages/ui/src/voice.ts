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
