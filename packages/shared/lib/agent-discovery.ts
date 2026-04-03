import type {
  RoverAgentDiscoverySkillSnapshot,
  RoverAgentDiscoverySnapshot,
  RoverDiscoveryExecutionPreference,
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

function normalizeTaskPayload(value: unknown): Record<string, unknown> | undefined {
  const object = asObject(value);
  return object ? { ...object } : undefined;
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
    taskPayload: normalizeTaskPayload(asObject(rover?.task)?.payload),
  };
}

export function createRoverAgentDiscoverySnapshot(cardLike: unknown): RoverAgentDiscoverySnapshot | undefined {
  const card = asObject(cardLike);
  if (!card) return undefined;
  const extensions = asObject(card.extensions);
  const rover = asObject(extensions?.rover);
  if (!rover) return undefined;

  const siteUrl = text(rover.siteUrl, 2048);
  const taskEndpoint = text(rover.taskEndpoint || card.url, 2048);
  const workflowEndpoint = text(rover.workflowEndpoint, 2048);
  if (!siteUrl || !taskEndpoint || !workflowEndpoint) return undefined;

  const promptLaunchEnabled = bool(rover.promptLaunchEnabled);
  const shortcutLaunchEnabled = bool(rover.shortcutLaunchEnabled);
  const delegatedHandoffs = bool(rover.delegatedHandoffs);
  const webmcp = asObject(rover.webmcp);
  const webmcpAvailable = bool(webmcp?.available);
  const skills = Array.isArray(card.skills)
    ? card.skills
        .map(entry => normalizeSkill(entry))
        .filter((entry): entry is RoverAgentDiscoverySkillSnapshot => !!entry)
    : [];
  const instructions = uniqueStrings(rover.instructions, { max: 12, maxLen: 280 });

  return {
    roverEnabled: promptLaunchEnabled || shortcutLaunchEnabled || webmcpAvailable,
    siteUrl,
    taskEndpoint,
    workflowEndpoint,
    serviceDescUrl: text(rover.serviceDescUrl, 2048) || undefined,
    llmsUrl: text(rover.llmsUrl, 2048) || undefined,
    preferredExecution: normalizeExecutionPreference(rover.preferredExecution),
    promptLaunchEnabled,
    shortcutLaunchEnabled,
    delegatedHandoffs,
    webmcpAvailable,
    skills,
    instructions,
  };
}
