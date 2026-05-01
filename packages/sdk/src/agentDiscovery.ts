import type { RoverShortcut } from '@rover/ui';
import { toBaseUrl } from './serverRuntime.js';
import { resolveAiLaunchAccess } from './deepLink.js';
import { createRoverAgentDiscoverySnapshot } from '@rover/shared/lib/agent-discovery.js';
import type { RoverAgentDiscoverySnapshot } from '@rover/shared/lib/types/index.js';

export const DEFAULT_AGENT_CARD_PATH = '/.well-known/agent-card.json';
export const DEFAULT_ROVER_SITE_PATH = '/.well-known/rover-site.json';
export const DEFAULT_LLMS_PATH = '/llms.txt';
export const ROVER_WEBMCP_DISCOVERY_GLOBAL = '__ROVER_WEBMCP_TOOL_DEFS__';
export const ROVER_DISCOVERY_ACTION_SHEET_MAX_ACTIONS = 3;
export const A2W_RUNS_PATH = '/v1/a2w/runs';
export const A2W_WORKFLOWS_PATH = '/v1/a2w/workflows';
const ROVER_DISCOVERY_SHORTCUT_PROMPT_MAX_CHARS = 2000;

type JsonSchema = Record<string, any>;

export type RoverDiscoveryExecutionPreference = 'auto' | 'browser' | 'cloud';
export type RoverDiscoverySurfaceMode = 'silent' | 'beacon' | 'integrated' | 'debug';
export type RoverDiscoverySurfaceBranding = 'site' | 'co' | 'rover';
export type RoverDiscoveryHostSurface = 'auto' | 'existing-assistant' | 'floating-corner' | 'inline-primary';
export type RoverDiscoveryActionReveal = 'click' | 'focus' | 'keyboard' | 'agent-handshake';
export type RoverCapabilityResultMode = 'text' | 'markdown' | 'json' | 'observation' | 'artifacts';
export type RoverSkillSideEffect = 'none' | 'read' | 'write' | 'transactional';
export type RoverSkillInterface = 'run' | 'shortcut' | 'client_tool' | 'webmcp';

export type RoverDiscoverySurfacePolicy = {
  mode?: RoverDiscoverySurfaceMode;
  branding?: RoverDiscoverySurfaceBranding;
  hostSurface?: RoverDiscoveryHostSurface;
  actionReveal?: RoverDiscoveryActionReveal;
  beaconLabel?: string;
  agentModeEntryHints?: string[];
};

export type RoverToolAnnotations = {
  category?: string;
  tags?: string[];
  examples?: string[];
  whenToUse?: string;
  whyUse?: string;
  sideEffect?: RoverSkillSideEffect;
  requiresConfirmation?: boolean;
  preferredInterface?: RoverSkillInterface;
  priority?: 'primary' | 'secondary';
};

export type RoverAgentDiscoveryToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  parameters?: Record<string, any>;
  required?: string[];
  schema?: JsonSchema;
  outputSchema?: JsonSchema;
  llmCallable?: boolean;
  annotations?: RoverToolAnnotations | Record<string, any>;
};

export type RoverPublicSkillDefinition = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  sideEffect?: RoverSkillSideEffect;
  requiresConfirmation?: boolean;
  preferredInterface?: RoverSkillInterface;
  category?: 'primary' | 'secondary';
  rover?: {
    shortcutId?: string;
    prompt?: string;
    routing?: 'auto' | 'act' | 'planner';
    runKind?: 'guide' | 'task';
    toolName?: string;
    run?: {
      endpoint: string;
      payload: Record<string, unknown>;
      preferExecution: RoverDiscoveryExecutionPreference;
    };
    deepLink?: string;
    source?: 'shortcut' | 'client_tool' | 'webmcp' | 'additional';
  };
};

export type RoverCapabilityRecord = {
  capabilityId: string;
  version: string;
  label: string;
  description: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  sideEffect?: RoverSkillSideEffect;
  requiresConfirmation?: boolean;
  preferredInterface?: RoverSkillInterface;
  allowedExecutionModes: RoverDiscoveryExecutionPreference[];
  resultModes: RoverCapabilityResultMode[];
  pageScope?: string[];
  analyticsTags?: string[];
  rover?: RoverPublicSkillDefinition['rover'];
};

export type RoverPageDefinition = {
  pageId: string;
  route?: string;
  label?: string;
  capabilityIds?: string[];
  entityHints?: string[];
  formHints?: string[];
  visibleCueLabel?: string;
  beaconLabel?: string;
  discoveryMode?: RoverDiscoverySurfaceMode;
  hostSurface?: RoverDiscoveryHostSurface;
  actionReveal?: RoverDiscoveryActionReveal;
  agentModeEntryHints?: string[];
  capabilitySummary?: string[];
};

export type RoverSiteProfile = {
  identity: {
    siteId?: string;
    name: string;
    description: string;
    siteUrl: string;
    version: string;
  };
  actions: RoverCapabilityRecord[];
  pages: RoverPageDefinition[];
  policies: {
    preferredExecution: RoverDiscoveryExecutionPreference;
    a2wRunsEnabled: boolean;
    cloudBrowserAllowed: boolean;
    delegatedHandoffs: boolean;
  };
  auth: {
    runEndpoint: string;
    workflowEndpoint: string;
    acceptsHttpMessageSignatures: boolean;
    supportsUnsignedSelfReportedIdentity: boolean;
  };
  analytics: {
    layer: 'roverbook';
    runIdField: 'runId';
    workflowIdField: 'workflowId';
    capabilityIdField: 'capabilityId';
    pageIdField: 'pageId';
  };
  currentPage?: RoverPageDefinition;
  display: {
    mode: RoverDiscoverySurfaceMode;
    branding: RoverDiscoverySurfaceBranding;
    hostSurface: RoverDiscoveryHostSurface;
    actionReveal: RoverDiscoveryActionReveal;
    beaconLabel?: string;
    agentModeEntryHints: string[];
    compactActionMaxActions: number;
  };
  artifacts: {
    agentCardUrl: string;
    roverSiteUrl: string;
    llmsUrl?: string;
    siteUrl: string;
  };
  interfaces?: RoverAgentCard['interfaces'];
};

export type RoverAgentCard = {
  name: string;
  description: string;
  url: string;
  version: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  capabilities: {
    streaming: boolean;
    a2wRuns: boolean;
    stateTransitions: boolean;
    delegatedHandoffs: boolean;
    webmcp: boolean;
  };
  skills: RoverPublicSkillDefinition[];
  interfaces?: Array<{
    type: 'run' | 'workflow' | 'site' | 'deep_link' | 'webmcp';
    url: string;
    description?: string;
    available?: boolean;
  }>;
  extensions?: {
    rover: {
      siteId?: string;
      siteUrl: string;
      runEndpoint: string;
      workflowEndpoint: string;
      serviceDescUrl: string;
      roverSiteUrl: string;
      llmsUrl?: string;
      preferredExecution: RoverDiscoveryExecutionPreference;
      a2wRunsEnabled: boolean;
      cloudBrowserAllowed: boolean;
      delegatedHandoffs: boolean;
      instructions: string[];
      capabilitiesGraph: RoverCapabilityRecord[];
      pages: RoverPageDefinition[];
      currentPage?: RoverPageDefinition;
      discoverySurface: {
        mode: RoverDiscoverySurfaceMode;
        branding: RoverDiscoverySurfaceBranding;
        hostSurface: RoverDiscoveryHostSurface;
        actionReveal: RoverDiscoveryActionReveal;
        beaconLabel?: string;
        agentModeEntryHints: string[];
        compactActionMaxActions: number;
      };
      shortcuts: Array<{
        id: string;
        label: string;
        description?: string;
        prompt: string;
        routing?: 'auto' | 'act' | 'planner';
      }>;
      webmcp: {
        available: boolean;
        tools: string[];
      };
    };
  };
};

export type RoverAgentDiscoveryConfig = {
  enabled?: boolean;
  siteUrl: string;
  siteId?: string;
  apiBase?: string;
  siteName?: string;
  description?: string;
  version?: string;
  agentCardUrl?: string;
  roverSiteUrl?: string;
  llmsUrl?: string;
  visibleCue?: boolean;
  discoverySurface?: RoverDiscoverySurfacePolicy;
  hostSurfaceSelector?: string;
  preferExecution?: RoverDiscoveryExecutionPreference;
  shortcuts?: RoverShortcut[];
  tools?: RoverAgentDiscoveryToolDefinition[];
  webmcpTools?: RoverAgentDiscoveryToolDefinition[];
  additionalSkills?: RoverPublicSkillDefinition[];
  capabilities?: RoverCapabilityRecord[];
  pages?: RoverPageDefinition[];
  pageContext?: Omit<RoverPageDefinition, 'capabilityIds'> & { capabilityIds?: string[] };
  aiAccess?: {
    enabled?: boolean;
    allowCloudBrowser?: boolean;
    allowDelegatedHandoffs?: boolean;
  };
};

export type RoverAgentDiscoveryRuntimeConfig = Omit<RoverAgentDiscoveryConfig, 'siteUrl'> & {
  siteUrl?: string;
};

const DEFAULT_SKILL_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      description: 'A2W run status returned by Rover.',
    },
    summary: {
      type: 'string',
      description: 'High-level summary of what Rover completed or observed.',
    },
    run: {
      type: 'string',
      description: 'Canonical A2W run URL.',
    },
    workflow: {
      type: 'string',
      description: 'Canonical A2W workflow URL when delegation occurs.',
    },
  },
};

const DEFAULT_TOOL_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    success: {
      type: 'boolean',
      description: 'Whether the tool completed successfully.',
    },
    summary: {
      type: 'string',
      description: 'Human-readable summary of the explicit site action.',
    },
  },
};

function text(value: unknown, max = 0): string {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  if (!max || out.length <= max) return out;
  return out.slice(0, max).trim();
}

function asObject<T extends Record<string, any>>(value: unknown): T | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : undefined;
}

function uniqueStrings(input: unknown, options?: { max?: number; maxLen?: number }): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const max = Math.max(1, Number(options?.max) || 24);
  const maxLen = Math.max(8, Number(options?.maxLen) || 160);
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

function normalizeSchema(value: unknown): JsonSchema | undefined {
  const schema = asObject<JsonSchema>(value);
  return schema ? { ...schema } : undefined;
}

function normalizeSiteUrl(siteUrl: string): string {
  try {
    const url = new URL(siteUrl);
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return text(siteUrl) || 'https://example.com/';
  }
}

function normalizeRoutePath(value: unknown): string | undefined {
  const raw = text(value, 512);
  if (!raw) return undefined;
  if (raw === '*' || raw === '/*') return '*';
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).pathname || '/';
    } catch {
      return undefined;
    }
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeResultModes(input: unknown): RoverCapabilityResultMode[] {
  if (!Array.isArray(input)) return [];
  const out: RoverCapabilityResultMode[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    const mode =
      value === 'text'
      || value === 'markdown'
      || value === 'json'
      || value === 'observation'
      || value === 'artifacts'
        ? value
        : undefined;
    if (!mode || seen.has(mode)) continue;
    seen.add(mode);
    out.push(mode);
  }
  return out;
}

type ResolvedDiscoverySurfacePolicy = {
  mode: RoverDiscoverySurfaceMode;
  branding: RoverDiscoverySurfaceBranding;
  hostSurface: RoverDiscoveryHostSurface;
  actionReveal: RoverDiscoveryActionReveal;
  beaconLabel?: string;
  agentModeEntryHints: string[];
};

function normalizeDiscoveryMode(
  value: unknown,
  fallback: RoverDiscoverySurfaceMode = 'beacon',
): RoverDiscoverySurfaceMode {
  return value === 'silent' || value === 'beacon' || value === 'integrated' || value === 'debug'
    ? value
    : fallback;
}

function normalizeDiscoveryBranding(
  value: unknown,
  fallback: RoverDiscoverySurfaceBranding = 'site',
): RoverDiscoverySurfaceBranding {
  return value === 'site' || value === 'co' || value === 'rover'
    ? value
    : fallback;
}

function normalizeHostSurface(
  value: unknown,
  fallback: RoverDiscoveryHostSurface = 'auto',
): RoverDiscoveryHostSurface {
  return value === 'auto'
    || value === 'existing-assistant'
    || value === 'floating-corner'
    || value === 'inline-primary'
    ? value
    : fallback;
}

function normalizeActionReveal(
  value: unknown,
  fallback: RoverDiscoveryActionReveal = 'click',
): RoverDiscoveryActionReveal {
  return value === 'click'
    || value === 'focus'
    || value === 'keyboard'
    || value === 'agent-handshake'
    ? value
    : fallback;
}

function defaultAgentModeEntryHints(
  policy: Pick<ResolvedDiscoverySurfacePolicy, 'hostSurface' | 'mode'>,
): string[] {
  if (policy.mode === 'silent') {
    return [
      'Read rover-site.json, the page manifest, or the well-known agent card before falling back to raw DOM guesses.',
    ];
  }
  if (policy.hostSurface === 'existing-assistant' || policy.mode === 'integrated') {
    return [
      'Use the site assistant or chat entrypoint first when it is present on the page.',
      'Prefer Rover A2W run and shortcut surfaces over selector or screenshot guessing once the assistant surface is active.',
    ];
  }
  return [
    'Use the page beacon or A2W run endpoint before attempting generic DOM automation.',
    'When Rover is already active, prefer the current-page actions over screenshot loops.',
  ];
}

function resolveDiscoverySurfacePolicy(config: RoverAgentDiscoveryConfig): ResolvedDiscoverySurfacePolicy {
  const input = config.discoverySurface || {};
  const mode = normalizeDiscoveryMode(
    input.mode,
    config.visibleCue === false ? 'silent' : 'beacon',
  );
  const hostSurface = normalizeHostSurface(input.hostSurface, 'auto');
  const actionReveal = normalizeActionReveal(input.actionReveal, 'click');
  const beaconLabel = text(
    input.beaconLabel
    || config.pageContext?.beaconLabel
    || config.pageContext?.visibleCueLabel,
    180,
  ) || undefined;
  const seed = {
    mode,
    branding: normalizeDiscoveryBranding(input.branding, 'site'),
    hostSurface,
    actionReveal,
    beaconLabel,
    agentModeEntryHints: uniqueStrings(input.agentModeEntryHints, { max: 8, maxLen: 240 }),
  };
  return {
    ...seed,
    agentModeEntryHints: seed.agentModeEntryHints.length ? seed.agentModeEntryHints : defaultAgentModeEntryHints(seed),
  };
}

export function sanitizeRoverAgentDiscoveryRuntimeConfig(raw: unknown): RoverAgentDiscoveryRuntimeConfig | undefined {
  const input = asObject<Record<string, unknown>>(raw);
  if (!input) return undefined;
  const surfaceInput = asObject<Record<string, unknown>>(input.discoverySurface);
  const discoverySurface: RoverDiscoverySurfacePolicy = {};
  if (surfaceInput) {
    const mode = normalizeDiscoveryMode(surfaceInput.mode, 'beacon');
    if (surfaceInput.mode === 'silent' || surfaceInput.mode === 'beacon' || surfaceInput.mode === 'integrated' || surfaceInput.mode === 'debug') {
      discoverySurface.mode = mode;
    }
    if (surfaceInput.branding === 'site' || surfaceInput.branding === 'co' || surfaceInput.branding === 'rover') {
      discoverySurface.branding = surfaceInput.branding;
    }
    if (
      surfaceInput.hostSurface === 'auto'
      || surfaceInput.hostSurface === 'existing-assistant'
      || surfaceInput.hostSurface === 'floating-corner'
      || surfaceInput.hostSurface === 'inline-primary'
    ) {
      discoverySurface.hostSurface = surfaceInput.hostSurface;
    }
    if (
      surfaceInput.actionReveal === 'click'
      || surfaceInput.actionReveal === 'focus'
      || surfaceInput.actionReveal === 'keyboard'
      || surfaceInput.actionReveal === 'agent-handshake'
    ) {
      discoverySurface.actionReveal = surfaceInput.actionReveal;
    }
    const beaconLabel = text(
      surfaceInput.beaconLabel
      || surfaceInput.visibleCueLabel,
      180,
    ) || undefined;
    if (beaconLabel) discoverySurface.beaconLabel = beaconLabel;
    const agentModeEntryHints = uniqueStrings(surfaceInput.agentModeEntryHints, { max: 8, maxLen: 240 });
    if (agentModeEntryHints.length > 0) discoverySurface.agentModeEntryHints = agentModeEntryHints;
  }
  const next: RoverAgentDiscoveryRuntimeConfig = {};
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  else if (typeof input.visibleCue === 'boolean') next.enabled = input.visibleCue;
  if (typeof input.siteUrl === 'string' && text(input.siteUrl)) next.siteUrl = text(input.siteUrl);
  if (typeof input.siteId === 'string' && text(input.siteId, 160)) next.siteId = text(input.siteId, 160);
  if (typeof input.apiBase === 'string' && text(input.apiBase, 240)) next.apiBase = text(input.apiBase, 240);
  if (typeof input.siteName === 'string' && text(input.siteName, 160)) next.siteName = text(input.siteName, 160);
  if (typeof input.description === 'string' && text(input.description, 400)) next.description = text(input.description, 400);
  if (typeof input.version === 'string' && text(input.version, 120)) next.version = text(input.version, 120);
  if (typeof input.agentCardUrl === 'string' && text(input.agentCardUrl, 240)) next.agentCardUrl = text(input.agentCardUrl, 240);
  if (typeof input.roverSiteUrl === 'string' && text(input.roverSiteUrl, 240)) next.roverSiteUrl = text(input.roverSiteUrl, 240);
  if (typeof input.llmsUrl === 'string' && text(input.llmsUrl, 240)) next.llmsUrl = text(input.llmsUrl, 240);
  if (typeof input.visibleCue === 'boolean') next.visibleCue = input.visibleCue;
  if (typeof input.hostSurfaceSelector === 'string' && text(input.hostSurfaceSelector, 240)) {
    next.hostSurfaceSelector = text(input.hostSurfaceSelector, 240);
  }
  if (input.preferExecution === 'auto' || input.preferExecution === 'browser' || input.preferExecution === 'cloud') {
    next.preferExecution = input.preferExecution;
  }
  if (Object.keys(discoverySurface).length > 0) next.discoverySurface = discoverySurface;
  return Object.keys(next).length ? next : undefined;
}

function defaultAllowedExecutionModes(preferred: RoverDiscoveryExecutionPreference): RoverDiscoveryExecutionPreference[] {
  if (preferred === 'browser') return ['browser'];
  if (preferred === 'cloud') return ['cloud'];
  return ['auto', 'browser', 'cloud'];
}

function normalizeCapabilityRecord(
  value: unknown,
  defaults: {
    version: string;
    allowedExecutionModes: RoverDiscoveryExecutionPreference[];
    resultModes: RoverCapabilityResultMode[];
  },
): RoverCapabilityRecord | null {
  const capability = asObject<Record<string, any>>(value);
  if (!capability) return null;
  const capabilityId = text(capability.capabilityId || capability.id, 120);
  const label = text(capability.label || capability.name, 180);
  const description = text(capability.description, 480);
  if (!capabilityId || !label || !description) return null;
  const allowedExecutionModes = Array.isArray(capability.allowedExecutionModes)
    ? capability.allowedExecutionModes.filter((mode): mode is RoverDiscoveryExecutionPreference => mode === 'auto' || mode === 'browser' || mode === 'cloud')
    : [];
  const resultModes = normalizeResultModes(capability.resultModes);
  return {
    capabilityId,
    version: text(capability.version, 80) || defaults.version,
    label,
    description,
    inputSchema: normalizeSchema(capability.inputSchema),
    outputSchema: normalizeSchema(capability.outputSchema),
    sideEffect:
      capability.sideEffect === 'none'
      || capability.sideEffect === 'read'
      || capability.sideEffect === 'write'
      || capability.sideEffect === 'transactional'
        ? capability.sideEffect
        : undefined,
    requiresConfirmation: typeof capability.requiresConfirmation === 'boolean' ? capability.requiresConfirmation : undefined,
    preferredInterface: normalizeAnnotations({ preferredInterface: capability.preferredInterface }).preferredInterface,
    allowedExecutionModes: allowedExecutionModes.length ? allowedExecutionModes : defaults.allowedExecutionModes,
    resultModes: resultModes.length ? resultModes : defaults.resultModes,
    pageScope: uniqueStrings(capability.pageScope, { max: 24, maxLen: 80 }),
    analyticsTags: uniqueStrings(capability.analyticsTags, { max: 24, maxLen: 64 }),
    rover: asObject<Record<string, any>>(capability.rover) ? { ...(capability.rover as RoverPublicSkillDefinition['rover']) } : undefined,
  };
}

function normalizePageDefinition(
  value: unknown,
  defaults?: Partial<ResolvedDiscoverySurfacePolicy>,
): RoverPageDefinition | null {
  const page = asObject<Record<string, any>>(value);
  if (!page) return null;
  const pageId = text(page.pageId || page.id, 120);
  if (!pageId) return null;
  const beaconLabel = text(page.beaconLabel || page.visibleCueLabel || defaults?.beaconLabel, 180) || undefined;
  return {
    pageId,
    route: normalizeRoutePath(page.route),
    label: text(page.label, 180) || undefined,
    capabilityIds: uniqueStrings(page.capabilityIds, { max: 48, maxLen: 120 }),
    entityHints: uniqueStrings(page.entityHints, { max: 24, maxLen: 120 }),
    formHints: uniqueStrings(page.formHints, { max: 24, maxLen: 120 }),
    visibleCueLabel: beaconLabel,
    beaconLabel,
    discoveryMode: normalizeDiscoveryMode(page.discoveryMode, defaults?.mode || 'beacon'),
    hostSurface: normalizeHostSurface(page.hostSurface, defaults?.hostSurface || 'auto'),
    actionReveal: normalizeActionReveal(page.actionReveal, defaults?.actionReveal || 'click'),
    agentModeEntryHints: uniqueStrings(
      Array.isArray(page.agentModeEntryHints) && page.agentModeEntryHints.length
        ? page.agentModeEntryHints
        : defaults?.agentModeEntryHints,
      { max: 8, maxLen: 240 },
    ),
    capabilitySummary: uniqueStrings(page.capabilitySummary, { max: 12, maxLen: 180 }),
  };
}

function buildRunEndpoint(apiBase?: string): string {
  return `${toBaseUrl(apiBase)}${A2W_RUNS_PATH}`;
}

function buildWorkflowEndpoint(apiBase?: string): string {
  return `${toBaseUrl(apiBase)}${A2W_WORKFLOWS_PATH}`;
}

function buildDeepLink(siteUrl: string, shortcutId: string): string {
  try {
    const url = new URL(siteUrl);
    url.searchParams.set('rover_shortcut', shortcutId);
    return url.toString();
  } catch {
    const sep = siteUrl.includes('?') ? '&' : '?';
    return `${siteUrl}${sep}rover_shortcut=${encodeURIComponent(shortcutId)}`;
  }
}

function humanizeName(name: string): string {
  return text(name)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function parametersToSchema(parameters?: Record<string, any>, required: string[] = []): JsonSchema | undefined {
  if (!parameters || typeof parameters !== 'object') return undefined;
  const properties: Record<string, JsonSchema> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const param = asObject<Record<string, any>>(value);
    if (!param) continue;
    const type = text(param.type) || 'string';
    const schema: JsonSchema = {
      type: ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(type) ? type : 'string',
    };
    if (param.description) schema.description = text(param.description, 240);
    if (param.enum && Array.isArray(param.enum)) {
      const enumValues = uniqueStrings(param.enum, { max: 24, maxLen: 80 });
      if (enumValues.length) schema.enum = enumValues;
    }
    if (type === 'array' && param.items) {
      schema.items = normalizeSchema(param.items) || {
        type: text(param.items?.type) || 'string',
      };
    }
    if (type === 'object' && param.properties && typeof param.properties === 'object') {
      schema.properties = {};
      for (const [nestedKey, nestedValue] of Object.entries(param.properties)) {
        const nested = asObject<Record<string, any>>(nestedValue);
        if (!nested) continue;
        schema.properties[nestedKey] = {
          type: text(nested.type) || 'string',
          ...(nested.description ? { description: text(nested.description, 240) } : {}),
        };
      }
      if (Array.isArray(param.required)) {
        const nestedRequired = uniqueStrings(param.required, { max: 50, maxLen: 80 });
        if (nestedRequired.length) schema.required = nestedRequired;
      }
    }
    properties[key] = schema;
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required: uniqueStrings(required, { max: 50, maxLen: 80 }) } : {}),
  };
}

function normalizeAnnotations(value: unknown): RoverToolAnnotations {
  const annotations = asObject<Record<string, any>>(value) || {};
  return {
    category: text(annotations.category, 40) || undefined,
    tags: uniqueStrings(annotations.tags, { max: 16, maxLen: 40 }),
    examples: uniqueStrings(annotations.examples, { max: 6, maxLen: 200 }),
    whenToUse: text(annotations.whenToUse, 280) || undefined,
    whyUse: text(annotations.whyUse, 280) || undefined,
    sideEffect:
      annotations.sideEffect === 'none'
      || annotations.sideEffect === 'read'
      || annotations.sideEffect === 'write'
      || annotations.sideEffect === 'transactional'
        ? annotations.sideEffect
        : undefined,
    requiresConfirmation:
      typeof annotations.requiresConfirmation === 'boolean'
        ? annotations.requiresConfirmation
        : undefined,
    preferredInterface:
      annotations.preferredInterface === 'run'
      || annotations.preferredInterface === 'shortcut'
      || annotations.preferredInterface === 'client_tool'
      || annotations.preferredInterface === 'webmcp'
        ? annotations.preferredInterface
        : undefined,
    priority:
      annotations.priority === 'primary' || annotations.priority === 'secondary'
        ? annotations.priority
        : undefined,
  };
}

function inferSideEffect(
  name: string,
  preferredInterface: RoverSkillInterface,
  annotations?: RoverToolAnnotations,
): RoverSkillSideEffect {
  if (annotations?.sideEffect) return annotations.sideEffect;
  if (preferredInterface === 'shortcut') return 'transactional';
  const normalized = name.toLowerCase();
  if (/^(get|read|list|show|find|search|compare|inspect|lookup)/.test(normalized)) return 'read';
  if (/^(save|create|reply|vote|leave|submit|answer|book|start|checkout|handoff)/.test(normalized)) return 'write';
  if (normalized.includes('run_task')) return 'transactional';
  return 'read';
}

function inferRequiresConfirmation(sideEffect: RoverSkillSideEffect, annotations?: RoverToolAnnotations): boolean {
  if (typeof annotations?.requiresConfirmation === 'boolean') return annotations.requiresConfirmation;
  return sideEffect === 'write' || sideEffect === 'transactional';
}

function buildToolDescription(
  title: string | undefined,
  description: string | undefined,
  annotations: RoverToolAnnotations,
  preferredInterface: RoverSkillInterface,
): string {
  const parts: string[] = [];
  if (title) parts.push(text(title, 120));
  if (description) parts.push(text(description, 320));
  if (annotations.whenToUse) parts.push(`When to use: ${annotations.whenToUse}`);
  if (annotations.whyUse) parts.push(`Why use this path: ${annotations.whyUse}`);
  if (!description && preferredInterface === 'shortcut') {
    parts.push('Use this explicit Rover shortcut when the user intent matches this site journey instead of improvising with raw DOM actions.');
  }
  return parts.join(' ').trim();
}

function normalizePublishedShortcut(shortcut: RoverShortcut): {
  id: string;
  label: string;
  prompt: string;
  description?: string;
  routing?: 'auto' | 'act' | 'planner';
  runKind?: 'guide' | 'task';
} | null {
  const id = text(shortcut.id, 80);
  const label = text(shortcut.label, 120);
  const prompt = text(shortcut.prompt, ROVER_DISCOVERY_SHORTCUT_PROMPT_MAX_CHARS);
  if (!id || !label || !prompt || shortcut.enabled === false) return null;

  const description = text(shortcut.description, 320);
  return {
    id,
    label,
    prompt,
    ...(description ? { description } : {}),
    ...(shortcut.routing ? { routing: shortcut.routing } : {}),
    ...(shortcut.runKind === 'guide' || shortcut.runKind === 'task' ? { runKind: shortcut.runKind } : {}),
  };
}

function buildShortcutSkill(
  shortcut: RoverShortcut,
  config: RoverAgentDiscoveryConfig,
  runEndpoint: string,
): RoverPublicSkillDefinition | null {
  const publishedShortcut = normalizePublishedShortcut(shortcut);
  if (!publishedShortcut) return null;
  const { id, label, prompt } = publishedShortcut;

  const tags = uniqueStrings([...(shortcut.tags || []), 'shortcut', 'rover'], { max: 16, maxLen: 40 });
  const examples = uniqueStrings([...(shortcut.examples || []), prompt], { max: 6, maxLen: 220 });
  const annotations = normalizeAnnotations({
    tags,
    examples,
    sideEffect: shortcut.sideEffect,
    requiresConfirmation: shortcut.requiresConfirmation,
    preferredInterface: shortcut.preferredInterface || 'shortcut',
    priority: 'primary',
  });
  const preferredInterface: RoverSkillInterface = 'shortcut';
  const sideEffect = inferSideEffect(id, preferredInterface, annotations);
  const requiresConfirmation = inferRequiresConfirmation(sideEffect, annotations);
  return {
    id,
    name: label,
    description: buildToolDescription(
      label,
      shortcut.description || `Run the "${label}" site flow with Rover using the exact shortcut id "${id}".`,
      {
        ...annotations,
        whenToUse:
          annotations.whenToUse
          || 'Use this when the user wants this exact site outcome and you want a stable path that avoids brittle DOM guessing.',
        whyUse:
          annotations.whyUse
          || 'Rover shortcuts are explicit site-owned entrypoints with structured A2W run progress and cleaner recovery than generic DOM automation.',
      },
      preferredInterface,
    ),
    tags,
    examples,
    inputSchema: normalizeSchema(shortcut.inputSchema) || {
      type: 'object',
      additionalProperties: false,
      description: 'This shortcut is parameterless. Invoke it directly by id.',
    },
    outputSchema: normalizeSchema(shortcut.outputSchema) || { ...DEFAULT_SKILL_OUTPUT_SCHEMA },
    sideEffect,
    requiresConfirmation,
    preferredInterface,
    category: 'primary',
    rover: {
      shortcutId: id,
      prompt,
      routing: shortcut.routing,
      runKind: shortcut.runKind,
      deepLink: buildDeepLink(config.siteUrl, id),
      run: {
        endpoint: runEndpoint,
        payload: {
          url: normalizeSiteUrl(config.siteUrl),
          shortcutId: id,
        },
        preferExecution: config.preferExecution || 'auto',
      },
      source: 'shortcut',
    },
  };
}

function buildToolSkill(
  tool: RoverAgentDiscoveryToolDefinition,
  preferredInterface: RoverSkillInterface,
): RoverPublicSkillDefinition | null {
  const name = text(tool.name, 120);
  if (!name || tool.llmCallable === false) return null;
  const annotations = normalizeAnnotations(tool.annotations);
  const sideEffect = inferSideEffect(name, preferredInterface, annotations);
  const requiresConfirmation = inferRequiresConfirmation(sideEffect, annotations);
  const tags = uniqueStrings([...(annotations.tags || []), preferredInterface, 'rover'], { max: 16, maxLen: 40 });
  const examples = uniqueStrings(annotations.examples || [], { max: 6, maxLen: 220 });
  return {
    id: name,
    name: text(tool.title, 120) || humanizeName(name),
    description: buildToolDescription(
      text(tool.title, 120),
      tool.description,
      {
        ...annotations,
        whenToUse:
          annotations.whenToUse
          || (preferredInterface === 'webmcp'
            ? 'Use this explicit WebMCP tool when the browser exposes it instead of simulating DOM actions for the same outcome.'
            : 'Use this explicit site tool when it matches the user goal instead of reconstructing the same action through generic DOM automation.'),
        whyUse:
          annotations.whyUse
          || 'Explicit site tools expose stable schemas, clearer validation errors, and structured results that are easier to recover from than brittle DOM inference.',
      },
      preferredInterface,
    ),
    ...(tags.length ? { tags } : {}),
    ...(examples.length ? { examples } : {}),
    inputSchema: normalizeSchema(tool.schema) || parametersToSchema(tool.parameters, tool.required || []) || {
      type: 'object',
      additionalProperties: false,
    },
    outputSchema: normalizeSchema(tool.outputSchema) || { ...DEFAULT_TOOL_OUTPUT_SCHEMA },
    sideEffect,
    requiresConfirmation,
    preferredInterface,
    category: annotations.priority === 'primary' ? 'primary' : 'secondary',
    rover: {
      toolName: name,
      source: preferredInterface === 'webmcp' ? 'webmcp' : 'client_tool',
    },
  };
}

function dedupeSkills(skills: RoverPublicSkillDefinition[]): RoverPublicSkillDefinition[] {
  const out: RoverPublicSkillDefinition[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const id = text(skill.id, 120);
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    out.push({
      ...skill,
      id,
    });
  }
  return out;
}

function dedupeCapabilities(capabilities: RoverCapabilityRecord[]): RoverCapabilityRecord[] {
  const out: RoverCapabilityRecord[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    const key = text(capability.capabilityId, 120);
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push({
      ...capability,
      capabilityId: key,
      pageScope: uniqueStrings(capability.pageScope, { max: 24, maxLen: 80 }),
      analyticsTags: uniqueStrings(capability.analyticsTags, { max: 24, maxLen: 64 }),
      allowedExecutionModes: Array.from(new Set(capability.allowedExecutionModes || [])),
      resultModes: Array.from(new Set(capability.resultModes || [])),
    });
  }
  return out;
}

function dedupePages(
  pages: RoverPageDefinition[],
  defaults?: Partial<ResolvedDiscoverySurfacePolicy>,
): RoverPageDefinition[] {
  const out: RoverPageDefinition[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const pageId = text(page.pageId, 120);
    if (!pageId || seen.has(pageId.toLowerCase())) continue;
    seen.add(pageId.toLowerCase());
    const beaconLabel = text(page.beaconLabel || page.visibleCueLabel || defaults?.beaconLabel, 180) || undefined;
    out.push({
      pageId,
      route: normalizeRoutePath(page.route),
      label: text(page.label, 180) || undefined,
      capabilityIds: uniqueStrings(page.capabilityIds, { max: 48, maxLen: 120 }),
      entityHints: uniqueStrings(page.entityHints, { max: 24, maxLen: 120 }),
      formHints: uniqueStrings(page.formHints, { max: 24, maxLen: 120 }),
      visibleCueLabel: beaconLabel,
      beaconLabel,
      discoveryMode: normalizeDiscoveryMode(page.discoveryMode, defaults?.mode || 'beacon'),
      hostSurface: normalizeHostSurface(page.hostSurface, defaults?.hostSurface || 'auto'),
      actionReveal: normalizeActionReveal(page.actionReveal, defaults?.actionReveal || 'click'),
      agentModeEntryHints: uniqueStrings(
        Array.isArray(page.agentModeEntryHints) && page.agentModeEntryHints.length
          ? page.agentModeEntryHints
          : defaults?.agentModeEntryHints,
        { max: 8, maxLen: 240 },
      ),
      capabilitySummary: uniqueStrings(page.capabilitySummary, { max: 12, maxLen: 180 }),
    });
  }
  return out;
}

function applyPageCapabilitySummary(
  page: RoverPageDefinition,
  capabilities: RoverCapabilityRecord[],
  defaults: ResolvedDiscoverySurfacePolicy,
): RoverPageDefinition {
  const capabilityIds = uniqueStrings(page.capabilityIds, { max: 48, maxLen: 120 });
  const capabilitySummary = uniqueStrings(
    Array.isArray(page.capabilitySummary) && page.capabilitySummary.length
      ? page.capabilitySummary
      : capabilityIds
          .map(capabilityId => capabilities.find(capability => capability.capabilityId === capabilityId)?.label)
          .filter((value): value is string => !!value),
    { max: 12, maxLen: 180 },
  );
  const beaconLabel = text(page.beaconLabel || page.visibleCueLabel || defaults.beaconLabel, 180) || undefined;
  const agentModeEntryHints = uniqueStrings(
    Array.isArray(page.agentModeEntryHints) && page.agentModeEntryHints.length
      ? page.agentModeEntryHints
      : defaults.agentModeEntryHints,
    { max: 8, maxLen: 240 },
  );
  return {
    ...page,
    capabilityIds,
    visibleCueLabel: beaconLabel,
    beaconLabel,
    discoveryMode: normalizeDiscoveryMode(page.discoveryMode, defaults.mode),
    hostSurface: normalizeHostSurface(page.hostSurface, defaults.hostSurface),
    actionReveal: normalizeActionReveal(page.actionReveal, defaults.actionReveal),
    agentModeEntryHints,
    capabilitySummary,
  };
}

function buildCapabilityFromSkill(
  skill: RoverPublicSkillDefinition,
  config: RoverAgentDiscoveryConfig,
): RoverCapabilityRecord {
  const preferredExecution = config.preferExecution || 'auto';
  return {
    capabilityId: skill.id,
    version: text(config.version, 80) || '1.0.0',
    label: skill.name,
    description: skill.description,
    inputSchema: normalizeSchema(skill.inputSchema),
    outputSchema: normalizeSchema(skill.outputSchema) || { ...DEFAULT_SKILL_OUTPUT_SCHEMA },
    sideEffect: skill.sideEffect,
    requiresConfirmation: skill.requiresConfirmation,
    preferredInterface: skill.preferredInterface,
    allowedExecutionModes: defaultAllowedExecutionModes(preferredExecution),
    resultModes: ['text', 'json', 'observation', 'artifacts'],
    pageScope: uniqueStrings(skill.rover?.shortcutId ? ['site', skill.rover.shortcutId] : ['site'], { max: 8, maxLen: 80 }),
    analyticsTags: uniqueStrings(skill.tags, { max: 24, maxLen: 64 }),
    rover: skill.rover ? { ...skill.rover } : undefined,
  };
}

function resolveCurrentPageDefinition(
  config: RoverAgentDiscoveryConfig,
  capabilities: RoverCapabilityRecord[],
  discoverySurface: ResolvedDiscoverySurfacePolicy,
): RoverPageDefinition {
  const siteUrl = normalizeSiteUrl(config.siteUrl);
  let pathname = '/';
  try {
    pathname = new URL(siteUrl).pathname || '/';
  } catch {
    pathname = '/';
  }
  const normalizedCurrent = normalizePageDefinition({
    pageId:
      config.pageContext?.pageId
      || pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9/_-]+/gi, '-').replace(/\//g, '__')
      || 'home',
    route: config.pageContext?.route || pathname,
    label: config.pageContext?.label,
    capabilityIds: config.pageContext?.capabilityIds,
    entityHints: config.pageContext?.entityHints,
    formHints: config.pageContext?.formHints,
    visibleCueLabel: config.pageContext?.visibleCueLabel,
    beaconLabel: config.pageContext?.beaconLabel,
    discoveryMode: config.pageContext?.discoveryMode,
    hostSurface: config.pageContext?.hostSurface,
    actionReveal: config.pageContext?.actionReveal,
    agentModeEntryHints: config.pageContext?.agentModeEntryHints,
    capabilitySummary: config.pageContext?.capabilitySummary,
  }, discoverySurface);
  return normalizedCurrent || {
    pageId: 'home',
    route: pathname,
    label: undefined,
    capabilityIds: capabilities.slice(0, 12).map(capability => capability.capabilityId),
    entityHints: [],
    formHints: [],
    visibleCueLabel: discoverySurface.beaconLabel,
    beaconLabel: discoverySurface.beaconLabel,
    discoveryMode: discoverySurface.mode,
    hostSurface: discoverySurface.hostSurface,
    actionReveal: discoverySurface.actionReveal,
    agentModeEntryHints: discoverySurface.agentModeEntryHints,
    capabilitySummary: capabilities.slice(0, 6).map(capability => capability.label),
  };
}

function buildCapabilityGraph(
  config: RoverAgentDiscoveryConfig,
  skills: RoverPublicSkillDefinition[],
  discoverySurface: ResolvedDiscoverySurfacePolicy,
): { capabilities: RoverCapabilityRecord[]; pages: RoverPageDefinition[]; currentPage: RoverPageDefinition } {
  const derivedCapabilities = skills.map(skill => buildCapabilityFromSkill(skill, config));
  const explicitCapabilities = (config.capabilities || [])
    .map(capability => normalizeCapabilityRecord(capability, {
      version: text(config.version, 80) || '1.0.0',
      allowedExecutionModes: defaultAllowedExecutionModes(config.preferExecution || 'auto'),
      resultModes: ['text', 'json', 'observation', 'artifacts'],
    }))
    .filter((capability): capability is RoverCapabilityRecord => !!capability);
  const capabilities = dedupeCapabilities([
    ...explicitCapabilities,
    ...derivedCapabilities,
  ]);
  const currentPage = resolveCurrentPageDefinition(config, capabilities, discoverySurface);
  const explicitPages = (config.pages || [])
    .map(page => normalizePageDefinition(page, discoverySurface))
    .filter((page): page is RoverPageDefinition => !!page);
  if (!currentPage.capabilityIds?.length) {
    currentPage.capabilityIds = capabilities.slice(0, 12).map(capability => capability.capabilityId);
  }
  const pages = dedupePages([
    ...explicitPages,
    currentPage,
  ], discoverySurface).map(page => applyPageCapabilitySummary(page, capabilities, discoverySurface));
  const resolvedCurrentPage = pages.find(page => page.pageId === currentPage.pageId)
    || applyPageCapabilitySummary(currentPage, capabilities, discoverySurface);
  return {
    capabilities,
    pages,
    currentPage: resolvedCurrentPage,
  };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeScriptJson(value: string): string {
  return value
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildInlineDataUrl(json: string): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
}

export function createRoverAgentCard(config: RoverAgentDiscoveryConfig): RoverAgentCard {
  const siteUrl = normalizeSiteUrl(config.siteUrl);
  const runEndpoint = buildRunEndpoint(config.apiBase);
  const workflowEndpoint = buildWorkflowEndpoint(config.apiBase);
  const serviceDescUrl = text(config.agentCardUrl) || DEFAULT_AGENT_CARD_PATH;
  const roverSiteUrl = text(config.roverSiteUrl) || DEFAULT_ROVER_SITE_PATH;
  const llmsUrl = text(config.llmsUrl);
  const launchAccess = resolveAiLaunchAccess(config.aiAccess);
  const publicRunEnabled = launchAccess.enabled;
  const cloudBrowserAllowed = config.aiAccess?.allowCloudBrowser !== false;
  const delegatedHandoffs = config.aiAccess?.allowDelegatedHandoffs === true;
  const shortcutSkills = (config.shortcuts || [])
    .map(shortcut => buildShortcutSkill(shortcut, config, runEndpoint))
    .filter((skill): skill is RoverPublicSkillDefinition => !!skill);
  const toolSkills = (config.tools || [])
    .map(tool => buildToolSkill(tool, 'client_tool'))
    .filter((skill): skill is RoverPublicSkillDefinition => !!skill);
  const webmcpSkills = (config.webmcpTools || [])
    .map(tool => buildToolSkill(tool, 'webmcp'))
    .filter((skill): skill is RoverPublicSkillDefinition => !!skill);
  const skills = dedupeSkills([
    ...shortcutSkills,
    ...(config.additionalSkills || []),
    ...toolSkills,
    ...webmcpSkills,
  ]);
  const discoverySurface = resolveDiscoverySurfacePolicy(config);
  const capabilityGraph = buildCapabilityGraph(config, skills, discoverySurface);
  const effectiveDiscoverySurface = {
    mode: normalizeDiscoveryMode(capabilityGraph.currentPage.discoveryMode, discoverySurface.mode),
    branding: discoverySurface.branding,
    hostSurface: normalizeHostSurface(capabilityGraph.currentPage.hostSurface, discoverySurface.hostSurface),
    actionReveal: normalizeActionReveal(capabilityGraph.currentPage.actionReveal, discoverySurface.actionReveal),
    beaconLabel: text(
      capabilityGraph.currentPage.beaconLabel
      || capabilityGraph.currentPage.visibleCueLabel
      || discoverySurface.beaconLabel,
      180,
    ) || undefined,
    agentModeEntryHints: uniqueStrings(
      capabilityGraph.currentPage.agentModeEntryHints?.length
        ? capabilityGraph.currentPage.agentModeEntryHints
        : discoverySurface.agentModeEntryHints,
      { max: 8, maxLen: 240 },
    ),
    compactActionMaxActions: ROVER_DISCOVERY_ACTION_SHEET_MAX_ACTIONS,
  };
  const siteName =
    text(config.siteName, 120)
    || (() => {
      try {
        return new URL(siteUrl).hostname;
      } catch {
        return 'Rover Site';
      }
    })();
  const description =
    text(config.description, 320)
    || `Structured Rover entrypoints for ${siteName}. Prefer the published shortcuts and explicit tools over raw DOM automation whenever they match the user's goal.`;
  return {
    name: siteName,
    description,
    url: runEndpoint,
    version: text(config.version, 80) || '1.0.0',
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    capabilities: {
      streaming: publicRunEnabled,
      a2wRuns: publicRunEnabled,
      stateTransitions: publicRunEnabled,
      delegatedHandoffs,
      webmcp: webmcpSkills.length > 0,
    },
    skills,
    interfaces: [
      {
        type: 'run',
        url: runEndpoint,
        description: 'Canonical Agent-to-Web Protocol (A2W) run creation endpoint.',
        available: publicRunEnabled,
      },
      {
        type: 'workflow',
        url: workflowEndpoint,
        description: 'Aggregated Rover workflow resource for delegated runs.',
        available: true,
      },
      {
        type: 'site',
        url: siteUrl,
        description: 'Human-visible website entrypoint.',
        available: true,
      },
      {
        type: 'deep_link',
        url: siteUrl,
        description: 'Browser-first Rover deep link surface using rover= or rover_shortcut= query params.',
        available: publicRunEnabled,
      },
      {
        type: 'webmcp',
        url: siteUrl,
        description: 'WebMCP tool surface when the browser host supports navigator.modelContext.',
        available: webmcpSkills.length > 0,
      },
    ],
    extensions: {
      rover: {
        siteId: text(config.siteId, 120) || undefined,
        siteUrl,
        runEndpoint,
        workflowEndpoint,
        serviceDescUrl,
        roverSiteUrl,
        ...(llmsUrl ? { llmsUrl } : {}),
        preferredExecution: config.preferExecution || 'auto',
        a2wRunsEnabled: publicRunEnabled,
        cloudBrowserAllowed,
        delegatedHandoffs,
        instructions: [
          'Prefer exact Rover shortcuts and explicit site tools over raw DOM automation when the user goal matches a published skill.',
          'Use POST /v1/a2w/runs when you need structured A2W progress, continuation input, or a stable final result channel.',
          'For browserless calls, send Prefer: execution=cloud, wait=10 and follow links.stream, links.ndjson, or links.poll until terminal or input_required.',
          'Fall back to generic DOM automation only when no matching Rover shortcut or explicit tool exists for the requested outcome.',
        ],
        capabilitiesGraph: capabilityGraph.capabilities,
        pages: capabilityGraph.pages,
        currentPage: capabilityGraph.currentPage,
        discoverySurface: effectiveDiscoverySurface,
        shortcuts: (config.shortcuts || [])
          .map(shortcut => normalizePublishedShortcut(shortcut))
          .filter((shortcut): shortcut is NonNullable<typeof shortcut> => !!shortcut),
        webmcp: {
          available: webmcpSkills.length > 0,
          tools: webmcpSkills.map(skill => skill.id),
        },
      },
    },
  };
}

export function createRoverSiteProfile(config: RoverAgentDiscoveryConfig): RoverSiteProfile {
  const card = createRoverAgentCard(config);
  const rover = card.extensions?.rover;
  return {
    identity: {
      siteId: rover?.siteId,
      name: card.name,
      description: card.description,
      siteUrl: rover?.siteUrl || normalizeSiteUrl(config.siteUrl),
      version: card.version,
    },
    actions: rover?.capabilitiesGraph || [],
    pages: rover?.pages || [],
    policies: {
      preferredExecution: rover?.preferredExecution || 'auto',
      a2wRunsEnabled: rover?.a2wRunsEnabled !== false,
      cloudBrowserAllowed: rover?.cloudBrowserAllowed !== false,
      delegatedHandoffs: rover?.delegatedHandoffs === true,
    },
    auth: {
      runEndpoint: rover?.runEndpoint || buildRunEndpoint(config.apiBase),
      workflowEndpoint: rover?.workflowEndpoint || buildWorkflowEndpoint(config.apiBase),
      acceptsHttpMessageSignatures: true,
      supportsUnsignedSelfReportedIdentity: true,
    },
    analytics: {
      layer: 'roverbook',
      runIdField: 'runId',
      workflowIdField: 'workflowId',
      capabilityIdField: 'capabilityId',
      pageIdField: 'pageId',
    },
    currentPage: rover?.currentPage,
    display: {
      mode: rover?.discoverySurface.mode || 'beacon',
      branding: rover?.discoverySurface.branding || 'site',
      hostSurface: rover?.discoverySurface.hostSurface || 'auto',
      actionReveal: rover?.discoverySurface.actionReveal || 'click',
      beaconLabel: rover?.discoverySurface.beaconLabel,
      agentModeEntryHints: rover?.discoverySurface.agentModeEntryHints || [],
      compactActionMaxActions: rover?.discoverySurface.compactActionMaxActions || ROVER_DISCOVERY_ACTION_SHEET_MAX_ACTIONS,
    },
    artifacts: {
      agentCardUrl: rover?.serviceDescUrl || text(config.agentCardUrl) || DEFAULT_AGENT_CARD_PATH,
      roverSiteUrl: rover?.roverSiteUrl || text(config.roverSiteUrl) || DEFAULT_ROVER_SITE_PATH,
      ...(rover?.llmsUrl ? { llmsUrl: rover.llmsUrl } : {}),
      siteUrl: rover?.siteUrl || normalizeSiteUrl(config.siteUrl),
    },
    interfaces: card.interfaces,
  };
}

export function buildRoverAgentDiscoveryPayloads(config: RoverAgentDiscoveryConfig): {
  card: RoverAgentCard;
  cardJson: string;
  serviceDescHref: string;
  roverSite: RoverSiteProfile;
  roverSiteJson: string;
  roverSiteHref: string;
  pageManifest: RoverPageDefinition;
  pageManifestJson: string;
  llmsUrl?: string;
  marker: {
    a2w?: string;
    run?: string;
    card: string;
    roverSite: string;
    site?: string;
    workflow?: string;
    page?: string;
    preferExecution?: RoverDiscoveryExecutionPreference;
    discoveryMode?: RoverDiscoverySurfaceMode;
    hostSurface?: RoverDiscoveryHostSurface;
    actionReveal?: RoverDiscoveryActionReveal;
    beaconLabel?: string;
    skills: Array<{ id: string; name: string }>;
    capabilities: Array<{ capabilityId: string; label: string }>;
  };
  markerJson: string;
} {
  const cardJson = createRoverAgentCardJson(config);
  const card = createRoverAgentCard(config);
  const roverSite = createRoverSiteProfile(config);
  const roverSiteJson = JSON.stringify(roverSite, null, 2);
  const inlineCardUrl = buildInlineDataUrl(cardJson);
  const serviceDescHref = text(config.agentCardUrl) || inlineCardUrl;
  const roverSiteHref = text(config.roverSiteUrl) || DEFAULT_ROVER_SITE_PATH;
  const pageManifest = card.extensions?.rover.currentPage || {
    pageId: 'home',
    route: '/',
    capabilityIds: [],
  };
  const pageManifestJson = JSON.stringify(pageManifest, null, 2);
  const marker = {
    a2w: card.extensions?.rover.runEndpoint,
    run: card.extensions?.rover.runEndpoint,
    card: serviceDescHref,
    roverSite: roverSiteHref,
    site: card.extensions?.rover.siteUrl,
    workflow: card.extensions?.rover.workflowEndpoint,
    page: pageManifest.pageId,
    preferExecution: card.extensions?.rover.preferredExecution,
    discoveryMode: card.extensions?.rover.discoverySurface.mode,
    hostSurface: card.extensions?.rover.discoverySurface.hostSurface,
    actionReveal: card.extensions?.rover.discoverySurface.actionReveal,
    beaconLabel: card.extensions?.rover.discoverySurface.beaconLabel,
    skills: card.skills.slice(0, 24).map(skill => ({
      id: skill.id,
      name: skill.name,
    })),
    capabilities: (card.extensions?.rover.capabilitiesGraph || []).slice(0, 24).map(capability => ({
      capabilityId: capability.capabilityId,
      label: capability.label,
    })),
  };
  return {
    card,
    cardJson,
    serviceDescHref,
    roverSite,
    roverSiteJson,
    roverSiteHref,
    pageManifest,
    pageManifestJson,
    llmsUrl: text(config.llmsUrl || card.extensions?.rover.llmsUrl) || undefined,
    marker,
    markerJson: escapeScriptJson(JSON.stringify(marker)),
  };
}

export function createRoverAgentCardJson(
  config: RoverAgentDiscoveryConfig,
  options?: { pretty?: boolean },
): string {
  return JSON.stringify(createRoverAgentCard(config), null, options?.pretty === false ? undefined : 2);
}

export function createRoverWellKnownAgentCard(
  config: RoverAgentDiscoveryConfig,
  options?: { pretty?: boolean },
): string {
  return createRoverAgentCardJson(config, options);
}

export function createRoverSiteProfileJson(
  config: RoverAgentDiscoveryConfig,
  options?: { pretty?: boolean },
): string {
  return JSON.stringify(createRoverSiteProfile(config), null, options?.pretty === false ? undefined : 2);
}

export function createRoverWellKnownSiteProfile(
  config: RoverAgentDiscoveryConfig,
  options?: { pretty?: boolean },
): string {
  return createRoverSiteProfileJson(config, options);
}

export function createRoverServiceDescLinkHeader(config: {
  agentCardUrl?: string;
  llmsUrl?: string;
}): string {
  const parts = [
    `<${text(config.agentCardUrl) || DEFAULT_AGENT_CARD_PATH}>; rel="service-desc"; type="application/json"`,
  ];
  const llmsUrl = text(config.llmsUrl);
  if (llmsUrl) {
    parts.push(`<${llmsUrl}>; rel="service-doc"; type="text/markdown"`);
  }
  return parts.join(', ');
}

export function createRoverAgentDiscoveryTags(config: RoverAgentDiscoveryConfig): string {
  const {
    cardJson,
    llmsUrl,
    markerJson,
    pageManifestJson,
    roverSiteJson,
    serviceDescHref,
  } = buildRoverAgentDiscoveryPayloads(config);
  const escapedCardJson = escapeScriptJson(cardJson);
  const escapedRoverSiteJson = escapeScriptJson(roverSiteJson);
  const escapedPageManifestJson = escapeScriptJson(pageManifestJson);
  const lines = [
    `<script type="application/agent+json" data-rover-agent-discovery="marker">${markerJson}</script>`,
    `<link rel="service-desc" href="${escapeHtmlAttr(serviceDescHref)}" type="application/json" data-rover-agent-discovery="service-desc" />`,
  ];
  if (llmsUrl) {
    lines.push(`<link rel="service-doc" href="${escapeHtmlAttr(llmsUrl)}" type="text/markdown" data-rover-agent-discovery="service-doc" />`);
  }
  lines.push(`<script type="application/rover-site+json" data-rover-agent-discovery="rover-site">${escapedRoverSiteJson}</script>`);
  lines.push(`<script type="application/rover-page+json" data-rover-agent-discovery="page">${escapedPageManifestJson}</script>`);
  lines.push(`<script type="application/agent-card+json" data-rover-agent-discovery="agent-card">${escapedCardJson}</script>`);
  return lines.join('\n');
}

export { createRoverAgentDiscoverySnapshot };
export type { RoverAgentDiscoverySnapshot };
