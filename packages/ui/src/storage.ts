import type {
  RoverPresencePosition,
  RoverPanelStorageState,
  RoverPanelLayoutKey,
} from './types.js';

const PRESENCE_STORAGE_PREFIX = 'rover:presence:';

export function buildPresenceStorageKey(siteId?: string, breakpoint?: 'desktop' | 'mobile'): string {
  const scope = String(siteId || window.location.hostname || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 120);
  const layout = breakpoint || 'desktop';
  return `${PRESENCE_STORAGE_PREFIX}${window.location.origin}:${scope}:${layout}`;
}

export function readPresencePosition(storageKey: string): RoverPresencePosition | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

export function writePresencePosition(storageKey: string, position: RoverPresencePosition | null): void {
  try {
    if (!position) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(position));
  } catch {
    // Ignore storage failures.
  }
}

export function buildPanelStorageKey(): string {
  const cleanedSiteId = String(window.location.hostname || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 96);
  return `rover:panel-layout:${cleanedSiteId || 'default'}`;
}

export function readPanelStorageState(storageKey: string): RoverPanelStorageState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as RoverPanelStorageState;
  } catch {
    return {};
  }
}

export function writePanelStorageState(storageKey: string, next: RoverPanelStorageState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Ignore storage failures in constrained browser environments.
  }
}
