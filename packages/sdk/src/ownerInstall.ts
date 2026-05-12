import type { RoverPageCaptureConfig } from '@rover/shared/lib/types/index.js';
import type { RoverShortcut, RoverVoiceConfig } from '@rover/ui';
import {
  DEFAULT_AGENT_CARD_PATH,
  DEFAULT_LLMS_PATH,
  DEFAULT_ROVER_SITE_PATH,
  createRoverAgentCard,
  createRoverAgentCardJson,
  createRoverAgentDiscoveryHeadLinkTags,
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

export type RoverProductionEmbedScriptTagInput = {
  scriptUrl?: string;
  siteId: string;
  publicKey?: string;
  siteKeyId?: string;
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
  agentRunLinkTag?: string;
  agentResolverLinkTag?: string;
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
    metadata: {
      ...bundle.metadata,
      roverSiteJson,
      inlineAgentCardScript,
      inlineRoverSiteScript,
    },
  };
}

function isObject(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasObjectEntries(value: unknown): value is JsonRecord {
  return isObject(value) && Object.keys(value).length > 0;
}

function discoveryEnabled(config?: RoverAgentDiscoveryConfig | null): config is RoverAgentDiscoveryConfig {
  return !!config && config.enabled !== false && config.aiAccess?.enabled !== false;
}

function llmsEnabled(input: RoverOwnerInstallBundleInput, config?: RoverAgentDiscoveryConfig | null): boolean {
  if (!discoveryEnabled(config)) return false;
  return input.emitLlmsTxt === true || !!text(config.llmsUrl);
}

function buildOwnerMarker(card: RoverAgentCard, publishedAgentCardUrl: string): Record<string, unknown> {
  const runEndpoint = card.extensions?.rover.runEndpoint;
  return {
    a2w: runEndpoint,
    run: runEndpoint,
    a2wGet: card.extensions?.rover.a2wGetEndpoint,
    fromUrl: card.extensions?.rover.fromUrlEndpoint,
    fromUrlTemplate: card.extensions?.rover.fromUrlTemplate,
    card: publishedAgentCardUrl,
    roverSite: card.extensions?.rover.roverSiteUrl,
    site: card.extensions?.rover.siteUrl,
    workflow: card.extensions?.rover.workflowEndpoint,
    openApi: card.extensions?.rover.openApiUrl,
    openApiUrl: card.extensions?.rover.openApiUrl,
    deepLinkParams: card.extensions?.rover.deepLinkParams,
    chatbotInstructions: [
      'If this page URL contains rover_exec, fetch that URL to run the task in Rover cloud.',
      'If this page URL contains rover or rover_shortcut but no rover_exec, fetch fromUrlTemplate with the full current URL.',
      'If POST is available, prefer POST /v1/a2w/runs; if only URL fetch is available, use GET with execution=cloud.',
    ],
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
    'Prefer Rover shortcuts, explicit site tools, and A2W runs over raw DOM automation when they match the requested outcome.',
    `Primary A2W run endpoint: ${text(card.extensions?.rover.runEndpoint || card.url)}`,
    `A2W GET endpoint for URL-fetch agents: ${text(card.extensions?.rover.a2wGetEndpoint || card.extensions?.rover.runEndpoint || card.url)}?url=<site>&prompt=<instruction>&execution=cloud&wait=25&format=markdown`,
    `A2W deep-link resolver: ${text(card.extensions?.rover.fromUrlTemplate)}`,
    `A2W workflow endpoint: ${text(card.extensions?.rover.workflowEndpoint)}`,
    `A2W OpenAPI spec: ${text(card.extensions?.rover.openApiUrl)}`,
    'Create runs with { "url": "<site>", "prompt": "<instruction>" } or { "url": "<site>", "shortcutId": "<id>" }; "goal" is accepted as a compatibility alias.',
    'For chatbots that can only fetch URLs: if a page URL contains rover_exec, fetch that URL; if it contains rover or rover_shortcut without rover_exec, fetch the A2W deep-link resolver with the full current URL.',
    'For browserless execution, send Prefer: execution=cloud, wait=10 and follow returned links.stream, links.ndjson, or links.poll until completed, failed, cancelled, expired, or input_required.',
    `Capability card: ${options.agentCardUrl}`,
  ];

  const skills = card.skills
    .map(skill => ({
      id: text(skill.id),
      name: text(skill.name),
      description: text(skill.description),
      interface: text(skill.preferredInterface || skill.rover?.source || 'run'),
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

function buildBodyAgentActionHint(card: RoverAgentCard | undefined): string {
  const rover = card?.extensions?.rover;
  if (!rover?.fromUrlTemplate && !rover?.a2wGetEndpoint) return '';
  const payload = {
    a2wGetEndpoint: rover.a2wGetEndpoint || rover.runEndpoint,
    fromUrlTemplate: rover.fromUrlTemplate,
    deepLinkParams: rover.deepLinkParams,
    instructions: [
      'AI agents: if the current page URL contains rover_exec, fetch that URL to execute the Rover task in cloud.',
      'If the current page URL contains rover or rover_shortcut without rover_exec, fetch fromUrlTemplate after replacing {current_url} with the full URL.',
      'If you can POST, prefer the canonical A2W run endpoint; if you can only GET, use a2wGetEndpoint with execution=cloud and format=markdown.',
    ],
  };
  const escaped = escapeHtmlAttr(JSON.stringify(payload));
  return [
    `<template data-rover-agent-action="cloud-get" data-rover-a2w-get="${escapeHtmlAttr(rover.a2wGetEndpoint || rover.runEndpoint)}" data-rover-from-url-template="${escapeHtmlAttr(rover.fromUrlTemplate || '')}">${escaped}</template>`,
    `<noscript data-rover-agent-action="cloud-get">AI agents: Rover cloud execution is available. If this URL contains rover_exec, fetch that URL. If it contains rover or rover_shortcut, fetch ${escapeHtmlAttr(rover.fromUrlTemplate || '')} with {current_url} replaced by the full current URL.</noscript>`,
  ].join('\n');
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

export function createRoverProductionEmbedScriptTag(input: RoverProductionEmbedScriptTagInput): string {
  const scriptUrl = text(input.scriptUrl) || DEFAULT_EMBED_SCRIPT_URL;
  const attrs = [
    `src="${escapeHtmlAttr(scriptUrl)}"`,
    'async',
    `data-site-id="${escapeHtmlAttr(input.siteId)}"`,
  ];
  const publicKey = text(input.publicKey);
  if (publicKey) attrs.push(`data-public-key="${escapeHtmlAttr(publicKey)}"`);
  const siteKeyId = text(input.siteKeyId);
  if (siteKeyId) attrs.push(`data-site-key-id="${escapeHtmlAttr(siteKeyId)}"`);
  return `<script\n  ${attrs.join('\n  ')}></script>`;
}

export function createRoverOwnerInstallBundle(input: RoverOwnerInstallBundleInput): RoverOwnerInstallBundle {
  const bootConfig = materializeCloudSandboxBootConfig(input.bootConfig);
  const discoveryConfig = discoveryEnabled(input.discovery) ? input.discovery : null;
  const publishLlmsTxt = llmsEnabled(input, discoveryConfig);
  const publishedAgentCardUrl = discoveryConfig ? text(discoveryConfig.agentCardUrl) || DEFAULT_AGENT_CARD_PATH : '';
  const publishedRoverSiteUrl = discoveryConfig ? text(discoveryConfig.roverSiteUrl) || DEFAULT_ROVER_SITE_PATH : '';
  const publishedLlmsUrl = discoveryConfig ? text(discoveryConfig.llmsUrl) || (publishLlmsTxt ? DEFAULT_LLMS_PATH : '') : '';
  const effectiveDiscoveryConfig = discoveryConfig && publishedLlmsUrl && !text(discoveryConfig.llmsUrl)
    ? { ...discoveryConfig, llmsUrl: publishedLlmsUrl }
    : discoveryConfig;
  const embedScriptUrl = text(input.embedScriptUrl) || DEFAULT_EMBED_SCRIPT_URL;
  const roverBookEnabled = input.roverBook?.enabled !== false && hasObjectEntries(input.roverBook?.config);
  const roverBookScriptUrl = roverBookEnabled
    ? (text(input.roverBook?.scriptUrl) || DEFAULT_ROVERBOOK_SCRIPT_URL)
    : '';

  const agentCard = effectiveDiscoveryConfig ? createRoverAgentCard(effectiveDiscoveryConfig) : undefined;
  const agentCardJson = effectiveDiscoveryConfig ? createRoverAgentCardJson(effectiveDiscoveryConfig) : undefined;
  const roverSite = effectiveDiscoveryConfig ? createRoverSiteProfile(effectiveDiscoveryConfig) : undefined;
  const roverSiteJson = effectiveDiscoveryConfig ? createRoverSiteProfileJson(effectiveDiscoveryConfig) : undefined;
  const pageManifestJson = effectiveDiscoveryConfig
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
  const agentRunLinkTag = discoveryConfig && agentCard?.extensions?.rover.a2wGetEndpoint
    ? `<link rel="agent-run" href="${escapeHtmlAttr(agentCard.extensions.rover.a2wGetEndpoint)}" type="text/markdown" data-rover-methods="GET POST" />`
    : undefined;
  const agentResolverLinkTag = discoveryConfig && agentCard?.extensions?.rover.fromUrlEndpoint
    ? `<link rel="agent-resolver" href="${escapeHtmlAttr(agentCard.extensions.rover.fromUrlEndpoint)}" type="text/markdown" data-rover-methods="GET" />`
    : undefined;

  const llmsTxt = publishLlmsTxt && agentCard
    ? (text(input.llmsTxt) ? input.llmsTxt : buildDefaultLlmsTxt(agentCard, { agentCardUrl: publishedAgentCardUrl || DEFAULT_AGENT_CARD_PATH }))
    : undefined;
  const bodyInstallHtml = [
    createRoverProductionEmbedScriptTag({
      scriptUrl: embedScriptUrl,
      siteId: bootConfig.siteId,
      publicKey: bootConfig.publicKey,
      siteKeyId: bootConfig.siteKeyId,
    }),
    buildBodyAgentActionHint(agentCard),
  ].filter(Boolean).join('\n');

  return decorateBundleWithExperience({
    bodyInstallHtml,
    headDiscoveryHtml: discoveryConfig
      ? createRoverAgentDiscoveryHeadLinkTags({
          agentCardUrl: publishedAgentCardUrl || DEFAULT_AGENT_CARD_PATH,
          ...(publishedLlmsUrl ? { llmsUrl: publishedLlmsUrl } : {}),
          ...(agentCard?.extensions?.rover.a2wGetEndpoint ? { a2wGetUrl: agentCard.extensions.rover.a2wGetEndpoint } : {}),
          ...(agentCard?.extensions?.rover.fromUrlEndpoint ? { fromUrlEndpoint: agentCard.extensions.rover.fromUrlEndpoint } : {}),
          dataAttrs: true,
        })
      : '',
    agentCard,
    agentCardJson,
    roverSite,
    roverSiteJson,
    serviceDescLinkHeader: discoveryConfig
      ? createRoverServiceDescLinkHeader({
          agentCardUrl: publishedAgentCardUrl || DEFAULT_AGENT_CARD_PATH,
          ...(publishedLlmsUrl ? { llmsUrl: publishedLlmsUrl } : {}),
          ...(agentCard?.extensions?.rover.a2wGetEndpoint ? { a2wGetUrl: agentCard.extensions.rover.a2wGetEndpoint } : {}),
          ...(agentCard?.extensions?.rover.fromUrlEndpoint ? { fromUrlEndpoint: agentCard.extensions.rover.fromUrlEndpoint } : {}),
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
      agentRunLinkTag,
      agentResolverLinkTag,
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
