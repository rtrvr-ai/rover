import type {
  RoverAgentDiscoverySurfaceSnapshot,
  RoverAgentDiscoveryCapabilitySnapshot,
  RoverAgentDiscoveryPageSnapshot,
  RoverAgentDiscoverySkillSnapshot,
  RoverDiscoveryActionReveal,
  RoverDiscoveryHostSurface,
  RoverDiscoverySurfaceBranding,
  RoverDiscoverySurfaceMode,
  RoverAgentDiscoverySnapshot,
  RoverDiscoveryExecutionPreference,
  RoverDiscoveryResultMode,
  RoverDiscoverySkillInterface,
  RoverDiscoverySkillSource,
} from './types/index.js';

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function text(value: unknown, max = 0): string {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  if (!max || out.length <= max) return out;
  return out.slice(0, max).trim();
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function uniqueStrings(input: unknown, options?: { max?: number; maxLen?: number }): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const max = Math.max(1, Number(options?.max) || 24);
  const maxLen = Math.max(8, Number(options?.maxLen) || 240);
  for (const raw of input) {
    const value = text(raw, maxLen);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeExecutionPreference(value: unknown): RoverDiscoveryExecutionPreference {
  return value === 'browser' || value === 'cloud' || value === 'auto' ? value : 'auto';
}

function normalizePreferredInterface(value: unknown): RoverDiscoverySkillInterface | undefined {
  return value === 'task' || value === 'shortcut' || value === 'client_tool' || value === 'webmcp'
    ? value
    : undefined;
}

function normalizeSource(value: unknown): RoverDiscoverySkillSource | undefined {
  return value === 'shortcut' || value === 'client_tool' || value === 'webmcp' || value === 'additional'
    ? value
    : undefined;
}

function normalizeDiscoveryMode(value: unknown): RoverDiscoverySurfaceMode | undefined {
  return value === 'silent' || value === 'beacon' || value === 'integrated' || value === 'debug'
    ? value
    : undefined;
}

function normalizeDiscoveryBranding(value: unknown): RoverDiscoverySurfaceBranding | undefined {
  return value === 'site' || value === 'co' || value === 'rover'
    ? value
    : undefined;
}

function normalizeHostSurface(value: unknown): RoverDiscoveryHostSurface | undefined {
  return value === 'auto'
    || value === 'existing-assistant'
    || value === 'floating-corner'
    || value === 'inline-primary'
    ? value
    : undefined;
}

function normalizeActionReveal(value: unknown): RoverDiscoveryActionReveal | undefined {
  return value === 'click'
    || value === 'focus'
    || value === 'keyboard'
    || value === 'agent-handshake'
    ? value
    : undefined;
}

function normalizeRunPayload(value: unknown): Record<string, unknown> | undefined {
  const object = asObject(value);
  return object ? { ...object } : undefined;
}

function normalizeResultMode(value: unknown): RoverDiscoveryResultMode | undefined {
  return value === 'text'
    || value === 'markdown'
    || value === 'json'
    || value === 'observation'
    || value === 'artifacts'
    ? value
    : undefined;
}

function normalizeSkill(value: unknown): RoverAgentDiscoverySkillSnapshot | null {
  const skill = asObject(value);
  if (!skill) return null;
  const rover = asObject(skill.rover);
  const id = text(skill.id, 120);
  const name = text(skill.name, 180);
  if (!id || !name) return null;
  return {
    id,
    name,
    preferredInterface: normalizePreferredInterface(skill.preferredInterface),
    source: normalizeSource(rover?.source),
    deepLink: text(rover?.deepLink, 2048) || undefined,
    toolName: text(rover?.toolName, 120) || undefined,
    runPayload: normalizeRunPayload(asObject(rover?.run)?.payload),
  };
}

function normalizeCapability(value: unknown): RoverAgentDiscoveryCapabilitySnapshot | null {
  const capability = asObject(value);
  if (!capability) return null;
  const rover = asObject(capability.rover);
  const capabilityId = text(capability.capabilityId || capability.id, 120);
  const label = text(capability.label || capability.name, 180);
  if (!capabilityId || !label) return null;
  const resultModes = Array.isArray(capability.resultModes)
    ? capability.resultModes
        .map(entry => normalizeResultMode(entry))
        .filter((entry): entry is RoverDiscoveryResultMode => !!entry)
    : [];
  return {
    capabilityId,
    version: text(capability.version, 80) || undefined,
    label,
    description: text(capability.description, 320) || undefined,
    preferredInterface: normalizePreferredInterface(capability.preferredInterface),
    source: normalizeSource(rover?.source),
    ...(resultModes.length ? { resultModes } : {}),
    pageScope: uniqueStrings(capability.pageScope, { max: 24, maxLen: 80 }),
    analyticsTags: uniqueStrings(capability.analyticsTags, { max: 24, maxLen: 64 }),
    deepLink: text(rover?.deepLink, 2048) || undefined,
    toolName: text(rover?.toolName, 120) || undefined,
    runPayload: normalizeRunPayload(asObject(rover?.run)?.payload),
  };
}

function normalizeDiscoverySurface(value: unknown): RoverAgentDiscoverySurfaceSnapshot | undefined {
  const surface = asObject(value);
  if (!surface) return undefined;
  const mode = normalizeDiscoveryMode(surface.mode);
  const branding = normalizeDiscoveryBranding(surface.branding);
  const hostSurface = normalizeHostSurface(surface.hostSurface);
  const actionReveal = normalizeActionReveal(surface.actionReveal);
  if (!mode || !branding || !hostSurface || !actionReveal) return undefined;
  return {
    mode,
    branding,
    hostSurface,
    actionReveal,
    beaconLabel: text(surface.beaconLabel, 180) || undefined,
    agentModeEntryHints: uniqueStrings(surface.agentModeEntryHints, { max: 8, maxLen: 240 }),
  };
}

function normalizePage(value: unknown): RoverAgentDiscoveryPageSnapshot | null {
  const page = asObject(value);
  if (!page) return null;
  const pageId = text(page.pageId || page.id, 120);
  if (!pageId) return null;
  const beaconLabel = text(page.beaconLabel || page.visibleCueLabel, 180) || undefined;
  return {
    pageId,
    route: text(page.route, 512) || undefined,
    label: text(page.label, 180) || undefined,
    capabilityIds: uniqueStrings(page.capabilityIds, { max: 48, maxLen: 120 }),
    entityHints: uniqueStrings(page.entityHints, { max: 24, maxLen: 120 }),
    formHints: uniqueStrings(page.formHints, { max: 24, maxLen: 120 }),
    visibleCueLabel: beaconLabel,
    beaconLabel,
    discoveryMode: normalizeDiscoveryMode(page.discoveryMode),
    hostSurface: normalizeHostSurface(page.hostSurface),
    actionReveal: normalizeActionReveal(page.actionReveal),
    agentModeEntryHints: uniqueStrings(page.agentModeEntryHints, { max: 8, maxLen: 240 }),
    capabilitySummary: uniqueStrings(page.capabilitySummary, { max: 12, maxLen: 180 }),
  };
}

export function createRoverAgentDiscoverySnapshot(cardLike: unknown): RoverAgentDiscoverySnapshot | undefined {
  const card = asObject(cardLike);
  if (!card) return undefined;
  const extensions = asObject(card.extensions);
  const rover = asObject(extensions?.rover);
  if (!rover) return undefined;

  const siteUrl = text(rover.siteUrl, 2048);
  const runEndpoint = text(rover.runEndpoint || card.url, 2048);
  const workflowEndpoint = text(rover.workflowEndpoint, 2048);
  if (!siteUrl || !runEndpoint || !workflowEndpoint) return undefined;

  const a2wRunsEnabled = bool(rover.a2wRunsEnabled);
  const delegatedHandoffs = bool(rover.delegatedHandoffs);
  const webmcp = asObject(rover.webmcp);
  const webmcpAvailable = bool(webmcp?.available);
  const discoverySurface = normalizeDiscoverySurface(rover.discoverySurface);
  const skills = Array.isArray(card.skills)
    ? card.skills
        .map(entry => normalizeSkill(entry))
        .filter((entry): entry is RoverAgentDiscoverySkillSnapshot => !!entry)
    : [];
  const capabilities = Array.isArray(rover.capabilitiesGraph)
    ? rover.capabilitiesGraph
        .map(entry => normalizeCapability(entry))
        .filter((entry): entry is RoverAgentDiscoveryCapabilitySnapshot => !!entry)
    : [];
  const pages = Array.isArray(rover.pages)
    ? rover.pages
        .map(entry => normalizePage(entry))
        .filter((entry): entry is RoverAgentDiscoveryPageSnapshot => !!entry)
    : [];
  const page = normalizePage(rover.currentPage);
  const instructions = uniqueStrings(rover.instructions, { max: 12, maxLen: 280 });

  return {
    roverEnabled: a2wRunsEnabled || webmcpAvailable,
    siteUrl,
    runEndpoint,
    workflowEndpoint,
    serviceDescUrl: text(rover.serviceDescUrl, 2048) || undefined,
    llmsUrl: text(rover.llmsUrl, 2048) || undefined,
    roverSiteUrl: text(rover.roverSiteUrl, 2048) || undefined,
    preferredExecution: normalizeExecutionPreference(rover.preferredExecution),
    a2wRunsEnabled,
    delegatedHandoffs,
    webmcpAvailable,
    skills,
    ...(discoverySurface ? { discoverySurface } : {}),
    ...(capabilities.length ? { capabilities } : {}),
    ...(pages.length ? { pages } : {}),
    ...(page ? { page } : {}),
    instructions,
  };
}
