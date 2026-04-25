import type { RoverPageCaptureConfig } from '@rover/shared/lib/types/index.js';
import type { RoverShortcut, RoverVoiceConfig } from '@rover/ui';
import {
  DEFAULT_AGENT_CARD_PATH,
  DEFAULT_ROVER_SITE_PATH,
  createRoverAgentCard,
  createRoverAgentCardJson,
  createRoverSiteProfile,
  createRoverSiteProfileJson,
  createRoverServiceDescLinkHeader,
  type RoverAgentCard,
  type RoverAgentDiscoveryConfig,
  type RoverAgentDiscoveryRuntimeConfig,
  type RoverSiteProfile,
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
  cloudSandboxEnabled?: boolean;
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
      imageUrl?: string;
      mp4Url?: string;
      webmUrl?: string;
      soundEnabled?: boolean;
    };
    shortcuts?: RoverShortcut[];
    greeting?: {
      text?: string;
      delay?: number;
      duration?: number;
      disabled?: boolean;
    };
    voice?: RoverVoiceConfig | JsonRecord | null;
    experience?: JsonRecord | null;
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
  agentDiscovery?: RoverAgentDiscoveryRuntimeConfig;
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
  publishedRoverSiteUrl?: string;
  publishedLlmsUrl?: string;
  serviceDescLinkTag?: string;
  serviceDocLinkTag?: string;
  markerJson?: string;
  markerScript?: string;
  inlineAgentCardScript?: string;
  roverSiteJson?: string;
  inlineRoverSiteScript?: string;
  pageManifestJson?: string;
  pageManifestScript?: string;
};

export type RoverOwnerInstallBundle = {
  bodyInstallHtml: string;
  headDiscoveryHtml: string;
  agentCard?: RoverAgentCard;
  agentCardJson?: string;
  roverSite?: RoverSiteProfile;
  roverSiteJson?: string;
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

function replaceInlineDiscoveryScript(
  html: string,
  marker: 'agent-card' | 'rover-site',
  script?: string,
): string {
  if (!script) return html;
  const pattern = new RegExp(`<script[^>]+data-rover-agent-discovery="${marker}"[^>]*>[\\s\\S]*?<\\/script>`);
  if (pattern.test(html)) {
    return html.replace(pattern, script);
  }
  return [html, script].filter(Boolean).join('\n');
}

function decorateBundleWithExperience(
  bundle: RoverOwnerInstallBundle,
  bootConfig: RoverOwnerInstallBootConfig,
): RoverOwnerInstallBundle {
  const experience = isObject(bootConfig.ui?.experience) ? bootConfig.ui?.experience : null;
  if (!experience) return bundle;

  const presence = isObject(experience.presence) ? experience.presence : {};
  const inputs = isObject(experience.inputs) ? experience.inputs : {};
  const shell = isObject(experience.shell) ? experience.shell : {};
  const stream = isObject(experience.stream) ? experience.stream : {};
  const ctaText = text(presence.ctaText) || `Do it with ${text(bootConfig.ui?.agent?.name) || 'Rover'}`;
  const assistantName = text(presence.assistantName) || text(bootConfig.ui?.agent?.name) || 'Rover';

  const agentCard = bundle.agentCard ? JSON.parse(JSON.stringify(bundle.agentCard)) as any : undefined;
  if (agentCard?.extensions?.rover) {
    agentCard.extensions.rover.discoverySurface = {
      ...(agentCard.extensions.rover.discoverySurface || {}),
      mode: 'beacon',
      hostSurface: 'floating-corner',
      actionReveal: 'click',
      beaconLabel: ctaText,
    };
    agentCard.extensions.rover.presence = {
      assistantName,
      ctaText,
      draggable: presence.draggable !== false,
    };
    agentCard.extensions.rover.experience = experience;
    agentCard.extensions.rover.inputs = {
      filesEnabled: inputs.files !== false,
      acceptedMimeGroups: Array.isArray(inputs.acceptedMimeGroups) ? inputs.acceptedMimeGroups : ['images', 'pdfs', 'office', 'text'],
      allowMultipleFiles: inputs.allowMultipleFiles !== false,
    };
  }

  const roverSite = bundle.roverSite ? JSON.parse(JSON.stringify(bundle.roverSite)) as any : undefined;
  if (roverSite) {
    roverSite.display = {
      ...(roverSite.display || {}),
      mode: 'beacon',
      hostSurface: 'floating-corner',
      actionReveal: 'click',
      beaconLabel: ctaText,
      presence: 'draggable_pill',
      openMode: text(shell.openMode) || 'center_stage',
      mobileMode: text(shell.mobileMode) || 'fullscreen_sheet',
      streamMode: text(stream.layout) || 'single_column',
      focusView: 'focus_stream',
    };
    roverSite.experience = experience;
    roverSite.inputs = {
      ...(roverSite.inputs || {}),
      filesEnabled: inputs.files !== false,
      acceptedMimeGroups: Array.isArray(inputs.acceptedMimeGroups) ? inputs.acceptedMimeGroups : ['images', 'pdfs', 'office', 'text'],
      allowMultipleFiles: inputs.allowMultipleFiles !== false,
    };
  }

  const agentCardJson = agentCard ? JSON.stringify(agentCard, null, 2) : bundle.agentCardJson;
  const roverSiteJson = roverSite ? JSON.stringify(roverSite, null, 2) : bundle.roverSiteJson;
  const inlineAgentCardScript = agentCardJson
    ? `<script type="application/agent-card+json" data-rover-agent-discovery="agent-card">${escapeScriptJson(agentCardJson)}</script>`
    : bundle.metadata.inlineAgentCardScript;
  const inlineRoverSiteScript = roverSiteJson
    ? `<script type="application/rover-site+json" data-rover-agent-discovery="rover-site">${escapeScriptJson(roverSiteJson)}</script>`
    : bundle.metadata.inlineRoverSiteScript;

  return {
    ...bundle,
    agentCard,
    agentCardJson,
    roverSite,
    roverSiteJson,
    bodyInstallHtml: replaceInlineDiscoveryScript(
      replaceInlineDiscoveryScript(bundle.bodyInstallHtml, 'agent-card', inlineAgentCardScript),
      'rover-site',
      inlineRoverSiteScript,
    ),
    metadata: {
      ...bundle.metadata,
      roverSiteJson,
      inlineAgentCardScript,
      inlineRoverSiteScript,
    },
  };
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
  return !!config && config.enabled !== false && config.aiAccess?.enabled !== false;
}

function llmsEnabled(input: RoverOwnerInstallBundleInput, config?: RoverAgentDiscoveryConfig | null): boolean {
  if (!discoveryEnabled(config)) return false;
  return input.emitLlmsTxt === true || !!text(config.llmsUrl);
}

function buildOwnerMarker(card: RoverAgentCard, publishedAgentCardUrl: string): Record<string, unknown> {
  return {
    task: card.extensions?.rover.taskEndpoint,
    card: publishedAgentCardUrl,
    roverSite: card.extensions?.rover.roverSiteUrl,
    site: card.extensions?.rover.siteUrl,
    workflow: card.extensions?.rover.workflowEndpoint,
    page: card.extensions?.rover.currentPage?.pageId,
    preferExecution: card.extensions?.rover.preferredExecution,
    display: card.extensions?.rover.discoverySurface
      ? {
          mode: card.extensions.rover.discoverySurface.mode,
          hostSurface: card.extensions.rover.discoverySurface.hostSurface,
          actionReveal: card.extensions.rover.discoverySurface.actionReveal,
          beaconLabel: card.extensions.rover.discoverySurface.beaconLabel,
        }
      : undefined,
    skills: card.skills.slice(0, 24).map(skill => ({
      id: skill.id,
      name: skill.name,
    })),
    capabilities: (card.extensions?.rover.capabilitiesGraph || []).slice(0, 24).map(capability => ({
      capabilityId: capability.capabilityId,
      label: capability.label,
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

function materializeCloudSandboxBootConfig(bootConfig: RoverOwnerInstallBootConfig): RoverOwnerInstallBootConfig {
  if (bootConfig.cloudSandboxEnabled !== true) {
    return bootConfig;
  }
  return {
    ...bootConfig,
    tools: {
      ...(bootConfig.tools || {}),
      web: {
        ...(bootConfig.tools?.web || {}),
        enableExternalWebContext: true,
        scrapeMode: 'on_demand',
      },
    },
  };
}

function buildBootScript(bootConfig: RoverOwnerInstallBootConfig): string {
  const normalizedBootConfig = materializeCloudSandboxBootConfig(bootConfig);
  const lines = [
    '<script>',
    ...buildQueueStubLines().map(line => `  ${line}`),
    `  rover('boot', ${indentJson(normalizedBootConfig)});`,
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
  const bootConfig = materializeCloudSandboxBootConfig(input.bootConfig);
  const discoveryConfig = discoveryEnabled(input.discovery) ? input.discovery : null;
  const publishedAgentCardUrl = discoveryConfig ? text(discoveryConfig.agentCardUrl) || DEFAULT_AGENT_CARD_PATH : '';
  const publishedRoverSiteUrl = discoveryConfig ? text(discoveryConfig.roverSiteUrl) || DEFAULT_ROVER_SITE_PATH : '';
  const publishLlmsTxt = llmsEnabled(input, discoveryConfig);
  const publishedLlmsUrl = discoveryConfig ? text(discoveryConfig.llmsUrl) : '';
  const embedScriptUrl = text(input.embedScriptUrl) || DEFAULT_EMBED_SCRIPT_URL;
  const roverBookEnabled = input.roverBook?.enabled !== false && hasObjectEntries(input.roverBook?.config);
  const roverBookScriptUrl = roverBookEnabled
    ? (text(input.roverBook?.scriptUrl) || DEFAULT_ROVERBOOK_SCRIPT_URL)
    : '';

  const agentCard = discoveryConfig ? createRoverAgentCard(discoveryConfig) : undefined;
  const agentCardJson = discoveryConfig ? createRoverAgentCardJson(discoveryConfig) : undefined;
  const roverSite = discoveryConfig ? createRoverSiteProfile(discoveryConfig) : undefined;
  const roverSiteJson = discoveryConfig ? createRoverSiteProfileJson(discoveryConfig) : undefined;
  const pageManifestJson = discoveryConfig
    ? JSON.stringify(agentCard?.extensions?.rover.currentPage || null, null, 2)
    : undefined;
  const marker = agentCard && publishedAgentCardUrl
    ? buildOwnerMarker(agentCard, publishedAgentCardUrl)
    : undefined;
  const markerJson = marker ? escapeScriptJson(JSON.stringify(marker)) : undefined;
  const escapedAgentCardJson = agentCardJson ? escapeScriptJson(agentCardJson) : undefined;
  const escapedRoverSiteJson = roverSiteJson ? escapeScriptJson(roverSiteJson) : undefined;
  const escapedPageManifestJson = pageManifestJson ? escapeScriptJson(pageManifestJson) : undefined;
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
  if (escapedRoverSiteJson) {
    bodyLines.push(`<script type="application/rover-site+json" data-rover-agent-discovery="rover-site">${escapedRoverSiteJson}</script>`);
  }
  if (escapedPageManifestJson) {
    bodyLines.push(`<script type="application/rover-page+json" data-rover-agent-discovery="page">${escapedPageManifestJson}</script>`);
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

  return decorateBundleWithExperience({
    bodyInstallHtml: bodyLines.join('\n'),
    headDiscoveryHtml: [serviceDescLinkTag, serviceDocLinkTag].filter(Boolean).join('\n'),
    agentCard,
    agentCardJson,
    roverSite,
    roverSiteJson,
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
      publishedRoverSiteUrl: publishedRoverSiteUrl || undefined,
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
      roverSiteJson,
      inlineRoverSiteScript: escapedRoverSiteJson
        ? `<script type="application/rover-site+json" data-rover-agent-discovery="rover-site">${escapedRoverSiteJson}</script>`
        : undefined,
      pageManifestJson,
      pageManifestScript: escapedPageManifestJson
        ? `<script type="application/rover-page+json" data-rover-agent-discovery="page">${escapedPageManifestJson}</script>`
        : undefined,
    },
  }, input.bootConfig);
}
