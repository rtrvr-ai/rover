import type { RoverShortcut } from '@rover/ui';
import { toBaseUrl } from './serverRuntime.js';
import { createRoverAgentDiscoverySnapshot } from '@rover/shared/lib/agent-discovery.js';
import type { RoverAgentDiscoverySnapshot } from '@rover/shared/lib/types/index.js';

export const DEFAULT_AGENT_CARD_PATH = '/.well-known/agent-card.json';
export const DEFAULT_LLMS_PATH = '/llms.txt';
export const ROVER_WEBMCP_DISCOVERY_GLOBAL = '__ROVER_WEBMCP_TOOL_DEFS__';

type JsonSchema = Record<string, any>;

export type RoverDiscoveryExecutionPreference = 'auto' | 'browser' | 'cloud';
export type RoverSkillSideEffect = 'none' | 'read' | 'write' | 'transactional';
export type RoverSkillInterface = 'task' | 'shortcut' | 'client_tool' | 'webmcp';

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
    toolName?: string;
    task?: {
      endpoint: string;
      payload: Record<string, unknown>;
      preferExecution: RoverDiscoveryExecutionPreference;
    };
    deepLink?: string;
    source?: 'shortcut' | 'client_tool' | 'webmcp' | 'additional';
  };
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
    publicTasks: boolean;
    stateTransitions: boolean;
    delegatedHandoffs: boolean;
    webmcp: boolean;
  };
  skills: RoverPublicSkillDefinition[];
  interfaces?: Array<{
    type: 'task' | 'workflow' | 'site' | 'deep_link' | 'webmcp';
    url: string;
    description?: string;
    available?: boolean;
  }>;
  extensions?: {
    rover: {
      siteId?: string;
      siteUrl: string;
      taskEndpoint: string;
      workflowEndpoint: string;
      serviceDescUrl: string;
      llmsUrl?: string;
      preferredExecution: RoverDiscoveryExecutionPreference;
      promptLaunchEnabled: boolean;
      shortcutLaunchEnabled: boolean;
      cloudBrowserAllowed: boolean;
      delegatedHandoffs: boolean;
      instructions: string[];
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
  siteUrl: string;
  siteId?: string;
  apiBase?: string;
  siteName?: string;
  description?: string;
  version?: string;
  agentCardUrl?: string;
  llmsUrl?: string;
  visibleCue?: boolean;
  preferExecution?: RoverDiscoveryExecutionPreference;
  shortcuts?: RoverShortcut[];
  tools?: RoverAgentDiscoveryToolDefinition[];
  webmcpTools?: RoverAgentDiscoveryToolDefinition[];
  additionalSkills?: RoverPublicSkillDefinition[];
  aiAccess?: {
    enabled?: boolean;
    allowPromptLaunch?: boolean;
    allowShortcutLaunch?: boolean;
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
      description: 'Task status returned by Rover.',
    },
    summary: {
      type: 'string',
      description: 'High-level summary of what Rover completed or observed.',
    },
    task: {
      type: 'string',
      description: 'Canonical Rover task URL.',
    },
    workflow: {
      type: 'string',
      description: 'Canonical Rover workflow URL when delegation occurs.',
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

function buildTaskEndpoint(apiBase?: string): string {
  return `${toBaseUrl(apiBase)}/v1/tasks`;
}

function buildWorkflowEndpoint(apiBase?: string): string {
  return `${toBaseUrl(apiBase)}/v1/workflows`;
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
      annotations.preferredInterface === 'task'
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

function buildShortcutSkill(
  shortcut: RoverShortcut,
  config: RoverAgentDiscoveryConfig,
  taskEndpoint: string,
): RoverPublicSkillDefinition | null {
  const id = text(shortcut.id, 80);
  const label = text(shortcut.label, 120);
  const prompt = text(shortcut.prompt, 700);
  if (!id || !label || !prompt || shortcut.enabled === false) return null;

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
          || 'Rover shortcuts are explicit site-owned entrypoints with structured task progress and cleaner recovery than generic DOM automation.',
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
      deepLink: buildDeepLink(config.siteUrl, id),
      task: {
        endpoint: taskEndpoint,
        payload: {
          url: normalizeSiteUrl(config.siteUrl),
          shortcut: id,
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
  const taskEndpoint = buildTaskEndpoint(config.apiBase);
  const workflowEndpoint = buildWorkflowEndpoint(config.apiBase);
  const serviceDescUrl = text(config.agentCardUrl) || DEFAULT_AGENT_CARD_PATH;
  const llmsUrl = text(config.llmsUrl);
  const promptLaunchEnabled = config.aiAccess?.enabled !== false && config.aiAccess?.allowPromptLaunch !== false;
  const shortcutLaunchEnabled = config.aiAccess?.enabled !== false && config.aiAccess?.allowShortcutLaunch !== false;
  const cloudBrowserAllowed = config.aiAccess?.allowCloudBrowser !== false;
  const delegatedHandoffs = config.aiAccess?.allowDelegatedHandoffs === true;
  const shortcutSkills = (config.shortcuts || [])
    .map(shortcut => buildShortcutSkill(shortcut, config, taskEndpoint))
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
    url: taskEndpoint,
    version: text(config.version, 80) || '1.0.0',
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    capabilities: {
      streaming: promptLaunchEnabled || shortcutLaunchEnabled,
      publicTasks: promptLaunchEnabled || shortcutLaunchEnabled,
      stateTransitions: promptLaunchEnabled || shortcutLaunchEnabled,
      delegatedHandoffs,
      webmcp: webmcpSkills.length > 0,
    },
    skills,
    interfaces: [
      {
        type: 'task',
        url: taskEndpoint,
        description: 'Canonical Rover ATP task creation endpoint.',
        available: promptLaunchEnabled,
      },
      {
        type: 'workflow',
        url: workflowEndpoint,
        description: 'Aggregated Rover workflow resource for delegated tasks.',
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
        available: shortcutLaunchEnabled || promptLaunchEnabled,
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
        taskEndpoint,
        workflowEndpoint,
        serviceDescUrl,
        ...(llmsUrl ? { llmsUrl } : {}),
        preferredExecution: config.preferExecution || 'auto',
        promptLaunchEnabled,
        shortcutLaunchEnabled,
        cloudBrowserAllowed,
        delegatedHandoffs,
        instructions: [
          'Prefer exact Rover shortcuts and explicit site tools over raw DOM automation when the user goal matches a published skill.',
          'Use POST /v1/tasks when you need structured progress, continuation input, or a stable final result channel.',
          'Fall back to generic DOM automation only when no matching Rover shortcut or explicit tool exists for the requested outcome.',
        ],
        shortcuts: (config.shortcuts || [])
          .filter(shortcut => shortcut.enabled !== false)
          .map(shortcut => ({
            id: shortcut.id,
            label: shortcut.label,
            ...(shortcut.description ? { description: shortcut.description } : {}),
            prompt: shortcut.prompt,
            ...(shortcut.routing ? { routing: shortcut.routing } : {}),
          })),
        webmcp: {
          available: webmcpSkills.length > 0,
          tools: webmcpSkills.map(skill => skill.id),
        },
      },
    },
  };
}

export function buildRoverAgentDiscoveryPayloads(config: RoverAgentDiscoveryConfig): {
  card: RoverAgentCard;
  cardJson: string;
  serviceDescHref: string;
  llmsUrl?: string;
  marker: {
    task?: string;
    card: string;
    site?: string;
    workflow?: string;
    preferExecution?: RoverDiscoveryExecutionPreference;
    skills: Array<{ id: string; name: string }>;
  };
  markerJson: string;
} {
  const cardJson = createRoverAgentCardJson(config);
  const card = createRoverAgentCard(config);
  const inlineCardUrl = buildInlineDataUrl(cardJson);
  const serviceDescHref = text(config.agentCardUrl) || inlineCardUrl;
  const marker = {
    task: card.extensions?.rover.taskEndpoint,
    card: serviceDescHref,
    site: card.extensions?.rover.siteUrl,
    workflow: card.extensions?.rover.workflowEndpoint,
    preferExecution: card.extensions?.rover.preferredExecution,
    skills: card.skills.slice(0, 24).map(skill => ({
      id: skill.id,
      name: skill.name,
    })),
  };
  return {
    card,
    cardJson,
    serviceDescHref,
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
  const { cardJson, llmsUrl, markerJson, serviceDescHref } = buildRoverAgentDiscoveryPayloads(config);
  const escapedCardJson = escapeScriptJson(cardJson);
  const lines = [
    `<script type="application/agent+json">${markerJson}</script>`,
    `<link rel="service-desc" href="${escapeHtmlAttr(serviceDescHref)}" type="application/json" />`,
  ];
  if (llmsUrl) {
    lines.push(`<link rel="service-doc" href="${escapeHtmlAttr(llmsUrl)}" type="text/markdown" />`);
  }
  lines.push(`<script type="application/agent-card+json">${escapedCardJson}</script>`);
  return lines.join('\n');
}

export { createRoverAgentDiscoverySnapshot };
export type { RoverAgentDiscoverySnapshot };
