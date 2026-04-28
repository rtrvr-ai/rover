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
  if (stored !== null && stored !== undefined) {
    enabled = stored === 'true';
    source = 'visitor';
  }
  return {
    supportedByConfig,
    enabled,
    source,
    storageKey,
  };
}
