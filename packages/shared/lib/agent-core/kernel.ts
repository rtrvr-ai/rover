export const ROVER_V2_PERSIST_CAPS = {
  plannerHistory: 24,
  prevSteps: 12,
  uiMessages: 80,
  timelineEvents: 120,
  localPersistBytes: 262_144,
  snapshotBytes: 524_288,
} as const;

export const ROVER_V2_ACC_TREE_POLICY = {
  keepFirst: 1,
  keepTail: 2,
} as const;

export const ROVER_V2_TRANSPORT_DEFAULTS = {
  activation: 'on_demand',
  idleCloseMs: 30_000,
  fallbackPollMinMs: 2_000,
  fallbackPollMaxMs: 15_000,
  maxInflightCommands: 1,
} as const;

export type DomainScopeMode = 'registrable_domain' | 'origin' | 'host';

export function isSameRegistrableDomain(aHost: string, bHost: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed) return '';
    const parts = trimmed.split('.').filter(Boolean);
    if (parts.length <= 2) return trimmed;
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  };

  const a = normalize(aHost);
  const b = normalize(bHost);
  return !!a && a === b;
}
