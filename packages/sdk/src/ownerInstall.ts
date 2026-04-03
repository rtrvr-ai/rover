import type { RoverPageCaptureConfig } from '@rover/shared/lib/types/index.js';
import type { RoverShortcut, RoverVoiceConfig } from '@rover/ui';
import {
  DEFAULT_AGENT_CARD_PATH,
  createRoverAgentCard,
  createRoverAgentCardJson,
  createRoverServiceDescLinkHeader,
  type RoverAgentCard,
  type RoverAgentDiscoveryConfig,
} from './agentDiscovery.js';

const DEFAULT_EMBED_SCRIPT_URL = 'https://rover.rtrvr.ai/embed.js';
const DEFAULT_ROVERBOOK_SCRIPT_URL = 'https://rover.rtrvr.ai/roverbook.js';

type JsonRecord = Record<string, unknown>;

export type RoverOwnerInstallBootConfig = {
  siteId: string;
  publicKey?: string;
  sessionToken?: string;
  sessionId?: string;
  siteKeyId?: string;
  apiBase?: string;
  visitorId?: string;
  workerUrl?: string;
  allowedDomains?: string[];
  domainScopeMode?: 'host_only' | 'registrable_domain';
  externalNavigationPolicy?: 'open_new_tab_notice' | 'block' | 'allow';
  sessionScope?: 'shared_site' | 'tab';
  openOnInit?: boolean;
  mode?: 'safe' | 'full';
  allowActions?: boolean;
  deepLink?: {
    enabled?: boolean;
    promptParam?: string;
    shortcutParam?: string;
    consume?: boolean;
  };
  pageConfig?: RoverPageCaptureConfig | null;
  navigation?: {
    crossHostPolicy?: 'open_new_tab' | 'same_tab';
  };
  tabPolicy?: {
    observerByDefault?: boolean;
    actionLeaseMs?: number;
  };
  taskRouting?: {
    mode?: 'auto' | 'act' | 'planner';
    actHeuristicThreshold?: number;
    plannerOnActError?: boolean;
  };
  taskContext?: {
    resetMode?: 'auto' | 'ask' | 'off';
    inactivityMs?: number;
    suggestReset?: boolean;
    semanticSimilarityThreshold?: number;
  };
  checkpointing?: {
    enabled?: boolean;
    autoVisitorId?: boolean;
    flushIntervalMs?: number;
    pullIntervalMs?: number;
    minFlushIntervalMs?: number;
    ttlHours?: number;
  };
  apiMode?: boolean;
  apiToolsConfig?: {
    mode?: 'allowlist' | 'profile' | 'none';
    enableAdditionalTools?: string[];
    userDefined?: string[];
  };
  telemetry?: {
    enabled?: boolean;
    sampleRate?: number;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    includePayloads?: boolean;
  };
  ui?: {
    agent?: {
      name?: string;
    };
    mascot?: {
      disabled?: boolean;
      mp4Url?: string;
      webmUrl?: string;
    };
    shortcuts?: RoverShortcut[];
    greeting?: {
      text?: string;
      delay?: number;
      duration?: number;
      disabled?: boolean;
    };
    voice?: RoverVoiceConfig | JsonRecord | null;
    muted?: boolean;
    thoughtStyle?: 'concise_cards' | 'minimal';
    panel?: {
      resizable?: boolean;
    };
    showTaskControls?: boolean;
  };
  tools?: {
    web?: {
      enableExternalWebContext?: boolean;
      allowDomains?: string[];
      denyDomains?: string[];
      scrapeMode?: 'off' | 'on_demand';
    };
  };
  siteMode?: 'agent' | 'analytics_only' | string;
};

export type RoverOwnerInstallRoverBookConfig = {
  enabled?: boolean;
  scriptUrl?: string;
  config?: JsonRecord | null;
  attachPollIntervalMs?: number;
  attachMaxAttempts?: number;
};

export type RoverOwnerInstallBundleInput = {
  bootConfig: RoverOwnerInstallBootConfig;
  discovery?: RoverAgentDiscoveryConfig | null;
  embedScriptUrl?: string;
  roverBook?: RoverOwnerInstallRoverBookConfig | null;
  emitLlmsTxt?: boolean;
  llmsTxt?: string;
};

export type RoverOwnerInstallBundleMetadata = {
  discoveryEnabled: boolean;
  llmsPublished: boolean;
  embedScriptUrl: string;
  roverBookEnabled: boolean;
  roverBookScriptUrl?: string;
  publishedAgentCardUrl?: string;
  publishedLlmsUrl?: string;
  serviceDescLinkTag?: string;
  serviceDocLinkTag?: string;
  markerJson?: string;
  markerScript?: string;
  inlineAgentCardScript?: string;
};

export type RoverOwnerInstallBundle = {
  bodyInstallHtml: string;
  headDiscoveryHtml: string;
  agentCard?: RoverAgentCard;
  agentCardJson?: string;
  serviceDescLinkHeader?: string;
  llmsTxt?: string;
  metadata: RoverOwnerInstallBundleMetadata;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function escapeHtmlAttr(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeScriptJson(value: string): string {
  return String(value || '')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function indentJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
}

function isObject(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasObjectEntries(value: unknown): value is JsonRecord {
  return isObject(value) && Object.keys(value).length > 0;
}

function normalizeAttachPollIntervalMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10) return 50;
  return Math.round(parsed);
}

function normalizeAttachMaxAttempts(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 300;
  return Math.round(parsed);
}

function discoveryEnabled(config?: RoverAgentDiscoveryConfig | null): config is RoverAgentDiscoveryConfig {
  return !!config && config.aiAccess?.enabled !== false;
}

function llmsEnabled(input: RoverOwnerInstallBundleInput, config?: RoverAgentDiscoveryConfig | null): boolean {
  if (!discoveryEnabled(config)) return false;
  return input.emitLlmsTxt === true || !!text(config.llmsUrl);
}

function buildOwnerMarker(card: RoverAgentCard, publishedAgentCardUrl: string): Record<string, unknown> {
  return {
    task: card.extensions?.rover.taskEndpoint,
    card: publishedAgentCardUrl,
    site: card.extensions?.rover.siteUrl,
    workflow: card.extensions?.rover.workflowEndpoint,
    preferExecution: card.extensions?.rover.preferredExecution,
    skills: card.skills.slice(0, 24).map(skill => ({
      id: skill.id,
      name: skill.name,
    })),
  };
}

function buildDefaultLlmsTxt(card: RoverAgentCard, options: { agentCardUrl: string }): string {
  const lines = [
    `# ${card.name}`,
    '',
    card.description,
    '',
    'Prefer Rover shortcuts, explicit site tools, and public task flows over raw DOM automation when they match the requested outcome.',
    `Primary task endpoint: ${text(card.extensions?.rover.taskEndpoint || card.url)}`,
    `Workflow endpoint: ${text(card.extensions?.rover.workflowEndpoint)}`,
    `Capability card: ${options.agentCardUrl}`,
  ];

  const skills = card.skills
    .map(skill => ({
      id: text(skill.id),
      name: text(skill.name),
      description: text(skill.description),
      interface: text(skill.preferredInterface || skill.rover?.source || 'task'),
    }))
    .filter(skill => skill.id && skill.name);

  if (skills.length > 0) {
    lines.push('', 'Published skills:');
    for (const skill of skills) {
      const description = skill.description ? ` - ${skill.description}` : '';
      lines.push(`- ${skill.id}: ${skill.name} [${skill.interface}]${description}`);
    }
  }

  const shortcuts = (card.extensions?.rover.shortcuts || [])
    .map(shortcut => `${text(shortcut.id)}: ${text(shortcut.label)}`)
    .filter(Boolean);
  if (shortcuts.length > 0) {
    lines.push('', 'Shortcut IDs:');
    for (const shortcut of shortcuts) {
      lines.push(`- ${shortcut}`);
    }
  }

  return lines.join('\n');
}

function buildQueueStubLines(): string[] {
  return [
    '(function(){ var r = window.rover = window.rover || function(){ (r.q = r.q || []).push(arguments); }; r.l = +new Date(); })();',
  ];
}

function buildBootScript(bootConfig: RoverOwnerInstallBootConfig): string {
  const lines = [
    '<script>',
    ...buildQueueStubLines().map(line => `  ${line}`),
    `  rover('boot', ${indentJson(bootConfig)});`,
    '</script>',
  ];
  return lines.join('\n');
}

function buildRoverBookAttachScript(config: JsonRecord, options?: { pollIntervalMs?: number; maxAttempts?: number }): string {
  const pollIntervalMs = normalizeAttachPollIntervalMs(options?.pollIntervalMs);
  const maxAttempts = normalizeAttachMaxAttempts(options?.maxAttempts);
  return [
    '<script>',
    '  (function(){',
    `    var roverBookConfig = ${indentJson(config)};`,
    '    function attachRoverBook(){',
    '      if (window.__ROVERBOOK_INSTANCE__) return true;',
    '      var roverApi = window.rover;',
    '      var roverBook = window.RoverBook;',
    "      if (!roverApi || typeof roverApi.on !== 'function' || typeof roverApi.requestSigned !== 'function') return false;",
    "      if (!roverBook || typeof roverBook.enableRoverBook !== 'function') return false;",
    '      window.__ROVERBOOK_INSTANCE__ = roverBook.enableRoverBook(roverApi, roverBookConfig);',
    '      return true;',
    '    }',
    '    if (attachRoverBook()) return;',
    '    var attempts = 0;',
    '    var timer = setInterval(function(){',
    '      attempts += 1;',
    `      if (attachRoverBook() || attempts >= ${maxAttempts}) clearInterval(timer);`,
    `    }, ${pollIntervalMs});`,
    '  })();',
    '</script>',
  ].join('\n');
}

export function createRoverOwnerInstallBundle(input: RoverOwnerInstallBundleInput): RoverOwnerInstallBundle {
  const bootConfig = input.bootConfig;
  const discoveryConfig = discoveryEnabled(input.discovery) ? input.discovery : null;
  const publishedAgentCardUrl = discoveryConfig ? text(discoveryConfig.agentCardUrl) || DEFAULT_AGENT_CARD_PATH : '';
  const publishLlmsTxt = llmsEnabled(input, discoveryConfig);
  const publishedLlmsUrl = discoveryConfig ? text(discoveryConfig.llmsUrl) : '';
  const embedScriptUrl = text(input.embedScriptUrl) || DEFAULT_EMBED_SCRIPT_URL;
  const roverBookEnabled = input.roverBook?.enabled !== false && hasObjectEntries(input.roverBook?.config);
  const roverBookScriptUrl = roverBookEnabled
    ? (text(input.roverBook?.scriptUrl) || DEFAULT_ROVERBOOK_SCRIPT_URL)
    : '';

  const agentCard = discoveryConfig ? createRoverAgentCard(discoveryConfig) : undefined;
  const agentCardJson = discoveryConfig ? createRoverAgentCardJson(discoveryConfig) : undefined;
  const marker = agentCard && publishedAgentCardUrl
    ? buildOwnerMarker(agentCard, publishedAgentCardUrl)
    : undefined;
  const markerJson = marker ? escapeScriptJson(JSON.stringify(marker)) : undefined;
  const escapedAgentCardJson = agentCardJson ? escapeScriptJson(agentCardJson) : undefined;
  const serviceDescLinkTag = discoveryConfig && publishedAgentCardUrl
    ? `<link rel="service-desc" href="${escapeHtmlAttr(publishedAgentCardUrl)}" type="application/json" />`
    : undefined;
  const serviceDocLinkTag = discoveryConfig && publishedLlmsUrl
    ? `<link rel="service-doc" href="${escapeHtmlAttr(publishedLlmsUrl)}" type="text/markdown" />`
    : undefined;

  const bodyLines: string[] = [];
  if (markerJson) {
    bodyLines.push(`<script type="application/agent+json" data-rover-agent-discovery="marker">${markerJson}</script>`);
  }
  if (escapedAgentCardJson) {
    bodyLines.push(`<script type="application/agent-card+json" data-rover-agent-discovery="agent-card">${escapedAgentCardJson}</script>`);
  }
  bodyLines.push(buildBootScript(bootConfig));
  bodyLines.push(`<script src="${escapeHtmlAttr(embedScriptUrl)}" async></script>`);
  if (roverBookEnabled && roverBookScriptUrl) {
    bodyLines.push(`<script src="${escapeHtmlAttr(roverBookScriptUrl)}" async></script>`);
    bodyLines.push(
      buildRoverBookAttachScript(input.roverBook?.config || {}, {
        pollIntervalMs: input.roverBook?.attachPollIntervalMs,
        maxAttempts: input.roverBook?.attachMaxAttempts,
      }),
    );
  }

  const llmsTxt = publishLlmsTxt && agentCard
    ? (text(input.llmsTxt) ? input.llmsTxt : buildDefaultLlmsTxt(agentCard, { agentCardUrl: publishedAgentCardUrl || DEFAULT_AGENT_CARD_PATH }))
    : undefined;

  return {
    bodyInstallHtml: bodyLines.join('\n'),
    headDiscoveryHtml: [serviceDescLinkTag, serviceDocLinkTag].filter(Boolean).join('\n'),
    agentCard,
    agentCardJson,
    serviceDescLinkHeader: discoveryConfig
      ? createRoverServiceDescLinkHeader({
          agentCardUrl: publishedAgentCardUrl || DEFAULT_AGENT_CARD_PATH,
          ...(publishedLlmsUrl ? { llmsUrl: publishedLlmsUrl } : {}),
        })
      : undefined,
    llmsTxt,
    metadata: {
      discoveryEnabled: !!discoveryConfig,
      llmsPublished: !!serviceDocLinkTag,
      embedScriptUrl,
      roverBookEnabled,
      roverBookScriptUrl: roverBookScriptUrl || undefined,
      publishedAgentCardUrl: publishedAgentCardUrl || undefined,
      publishedLlmsUrl: publishedLlmsUrl || undefined,
      serviceDescLinkTag,
      serviceDocLinkTag,
      markerJson,
      markerScript: markerJson
        ? `<script type="application/agent+json" data-rover-agent-discovery="marker">${markerJson}</script>`
        : undefined,
      inlineAgentCardScript: escapedAgentCardJson
        ? `<script type="application/agent-card+json" data-rover-agent-discovery="agent-card">${escapedAgentCardJson}</script>`
        : undefined,
    },
  };
}
