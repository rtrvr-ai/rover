import type { MountOptions } from './types.js';

type MascotAudioInput = Pick<MountOptions, 'siteId' | 'muted' | 'mascot'> & {
  host?: string;
  readStored?: (key: string) => string | null;
};

function normalizeStorageScope(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isMascotSoundEnabled(input: Pick<MountOptions, 'muted' | 'mascot'> | null | undefined): boolean {
  if (input?.mascot?.soundEnabled !== true) return false;
  if (input?.mascot?.disabled === true) return false;
  const hasCustomVideo = !!String(input?.mascot?.mp4Url || '').trim() || !!String(input?.mascot?.webmUrl || '').trim();
  const hasImage = !!String(input?.mascot?.imageUrl || '').trim();
  if (hasCustomVideo) return true;
  if (hasImage) return false;
  return true;
}

export function buildMutePreferenceStorageKey(input: { siteId?: string; host?: string }): string {
  const siteScope = normalizeStorageScope(input.siteId);
  if (siteScope) return `rover:muted:${siteScope}`;
  const hostScope = normalizeStorageScope(input.host);
  return `rover:muted:${hostScope || 'shared'}`;
}

export function buildNarrationPreferenceStorageKey(input: { siteId?: string; host?: string }): string {
  const siteScope = normalizeStorageScope(input.siteId);
  if (siteScope) return `rover:narration:${siteScope}`;
  const hostScope = normalizeStorageScope(input.host);
  return `rover:narration:${hostScope || 'shared'}`;
}

export type NarrationVoicePreference = 'auto' | 'system' | 'natural';

export type NarrationVisitorPreference = {
  enabled?: boolean;
  language?: string;
  voiceURI?: string;
  voicePreference?: NarrationVoicePreference;
};

function normalizeNarrationLanguage(input: unknown): string | undefined {
  const value = String(input || '').trim();
  if (!value || value.length > 32) return undefined;
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value)) return undefined;
  return value
    .split('-')
    .map((part, index) => index === 0 ? part.toLowerCase() : part.toUpperCase())
    .join('-');
}

function normalizeVoiceUri(input: unknown): string | undefined {
  const value = String(input || '').trim();
  if (!value || value.length > 180) return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || undefined;
}

function normalizeVoicePreference(input: unknown): NarrationVoicePreference | undefined {
  return input === 'auto' || input === 'system' || input === 'natural' ? input : undefined;
}

export function parseNarrationVisitorPreference(raw: string | null | undefined): {
  value: NarrationVisitorPreference;
  source: 'default' | 'visitor';
} {
  if (raw === null || raw === undefined || raw === '') {
    return { value: {}, source: 'default' };
  }
  const trimmed = String(raw).trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return {
      value: { enabled: trimmed === 'true' },
      source: 'visitor',
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      return { value: {}, source: 'default' };
    }
    const input = parsed as Record<string, unknown>;
    const value: NarrationVisitorPreference = {};
    if (typeof input.enabled === 'boolean') value.enabled = input.enabled;
    const language = normalizeNarrationLanguage(input.language);
    if (language) value.language = language;
    const voiceURI = normalizeVoiceUri(input.voiceURI);
    if (voiceURI) value.voiceURI = voiceURI;
    const voicePreference = normalizeVoicePreference(input.voicePreference);
    if (voicePreference) value.voicePreference = voicePreference;
    return { value, source: Object.keys(value).length ? 'visitor' : 'default' };
  } catch {
    return { value: {}, source: 'default' };
  }
}

export function serializeNarrationVisitorPreference(input: NarrationVisitorPreference): string {
  const value: NarrationVisitorPreference = {};
  if (typeof input.enabled === 'boolean') value.enabled = input.enabled;
  const language = normalizeNarrationLanguage(input.language);
  if (language) value.language = language;
  const voiceURI = normalizeVoiceUri(input.voiceURI);
  if (voiceURI) value.voiceURI = voiceURI;
  const voicePreference = normalizeVoicePreference(input.voicePreference);
  if (voicePreference) value.voicePreference = voicePreference;
  return JSON.stringify(value);
}

export function resolveMascotMutePreference(input: MascotAudioInput): {
  soundEnabled: boolean;
  isMuted: boolean;
  storageKey?: string;
} {
  const soundEnabled = isMascotSoundEnabled(input);
  if (!soundEnabled) {
    return {
      soundEnabled,
      isMuted: true,
    };
  }

  const storageKey = buildMutePreferenceStorageKey({
    siteId: input.siteId,
    host: input.host,
  });
  let isMuted = input.muted ?? true;
  const stored = input.readStored?.(storageKey);
  if (stored !== null && stored !== undefined) {
    isMuted = stored !== 'false';
  }

  return {
    soundEnabled,
    isMuted,
    storageKey,
  };
}

export function resolveNarrationPreference(input: {
  siteId?: string;
  host?: string;
  enabled?: boolean;
  defaultOn?: boolean;
  readStored?: (key: string) => string | null;
}): {
  supportedByConfig: boolean;
  enabled: boolean;
  source: 'default' | 'visitor';
  language?: string;
  voiceURI?: string;
  voicePreference?: NarrationVoicePreference;
  storageKey?: string;
} {
  const supportedByConfig = input.enabled !== false;
  if (!supportedByConfig) {
    return {
      supportedByConfig,
      enabled: false,
      source: 'default',
    };
  }
  const storageKey = buildNarrationPreferenceStorageKey({
    siteId: input.siteId,
    host: input.host,
  });
  let enabled = input.defaultOn !== false;
  let source: 'default' | 'visitor' = 'default';
  const stored = input.readStored?.(storageKey);
  const parsed = parseNarrationVisitorPreference(stored);
  if (parsed.source === 'visitor') {
    if (typeof parsed.value.enabled === 'boolean') enabled = parsed.value.enabled;
    source = 'visitor';
  }
  return {
    supportedByConfig,
    enabled,
    source,
    ...(parsed.value.language ? { language: parsed.value.language } : {}),
    ...(parsed.value.voiceURI ? { voiceURI: parsed.value.voiceURI } : {}),
    ...(parsed.value.voicePreference ? { voicePreference: parsed.value.voicePreference } : {}),
    storageKey,
  };
}
