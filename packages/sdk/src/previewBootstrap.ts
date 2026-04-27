export type RoverPreviewAttachLaunch = {
  requestId: string;
  attachToken: string;
};

export type RoverPreviewBootstrapVoiceConfig = {
  enabled?: boolean;
  language?: string;
  autoStopMs?: number;
};

export type RoverPreviewBootstrapExperienceConfig = {
  motion?: {
    actionSpotlight?: boolean;
  };
};

export type RoverPreviewBootstrapUiConfig = {
  voice?: RoverPreviewBootstrapVoiceConfig;
  experience?: RoverPreviewBootstrapExperienceConfig;
};

export type RoverPreviewBootstrapConfig = {
  scriptUrl?: string;
  siteId: string;
  publicKey?: string;
  sessionToken?: string;
  sessionId?: string;
  siteKeyId?: string;
  apiBase?: string;
  workerUrl?: string;
  allowedDomains?: string[];
  domainScopeMode?: 'host_only' | 'registrable_domain';
  cloudSandboxEnabled?: boolean;
  sessionScope?: 'shared_site' | 'tab';
  openOnInit?: boolean;
  mode?: 'safe' | 'full';
  allowActions?: boolean;
  pageConfig?: {
    disableAutoScroll?: boolean;
  };
  ui?: RoverPreviewBootstrapUiConfig;
  attachLaunch?: RoverPreviewAttachLaunch;
};

export type RoverScriptAttributeSource = Pick<HTMLScriptElement, 'getAttribute'>;

const DEFAULT_EMBED_SCRIPT_URL = 'https://rover.rtrvr.ai/embed.js';
const DEFAULT_AGENT_BASE = 'https://agent.rtrvr.ai';
const VOICE_AUTO_STOP_MIN_MS = 800;
const VOICE_AUTO_STOP_MAX_MS = 5000;

function toStringValue(value: unknown): string {
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
  return value
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function parseBooleanAttr(value: string | null): boolean | undefined {
  const normalized = toStringValue(value).toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseCsvList(value: string | null): string[] | undefined {
  const items = toStringValue(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!items.length) return undefined;
  return Array.from(new Set(items));
}

function parseIntegerAttr(value: string | null): number | undefined {
  const parsed = Number(toStringValue(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function normalizeVoiceConfig(value: RoverPreviewBootstrapVoiceConfig | undefined): RoverPreviewBootstrapVoiceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const voice: RoverPreviewBootstrapVoiceConfig = {};
  if (typeof value.enabled === 'boolean') voice.enabled = value.enabled;
  const language = toStringValue(value.language).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48);
  if (language) voice.language = language;
  const autoStopMs = Number(value.autoStopMs);
  if (Number.isFinite(autoStopMs)) {
    voice.autoStopMs = Math.max(VOICE_AUTO_STOP_MIN_MS, Math.min(VOICE_AUTO_STOP_MAX_MS, Math.trunc(autoStopMs)));
  }
  return Object.keys(voice).length ? voice : undefined;
}

function normalizeExperienceConfig(value: RoverPreviewBootstrapExperienceConfig | undefined): RoverPreviewBootstrapExperienceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const experience: RoverPreviewBootstrapExperienceConfig = {};
  if (value.motion && typeof value.motion === 'object') {
    const motion: NonNullable<RoverPreviewBootstrapExperienceConfig['motion']> = {};
    if (typeof value.motion.actionSpotlight === 'boolean') {
      motion.actionSpotlight = value.motion.actionSpotlight;
    }
    if (Object.keys(motion).length) experience.motion = motion;
  }
  return Object.keys(experience).length ? experience : undefined;
}

function normalizeUiConfig(value: RoverPreviewBootstrapUiConfig | undefined): RoverPreviewBootstrapUiConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const ui: RoverPreviewBootstrapUiConfig = {};
  const voice = normalizeVoiceConfig(value.voice);
  if (voice) ui.voice = voice;
  const experience = normalizeExperienceConfig(value.experience);
  if (experience) ui.experience = experience;
  return Object.keys(ui).length ? ui : undefined;
}

function normalizeBootstrapConfig(config: RoverPreviewBootstrapConfig): Required<Pick<RoverPreviewBootstrapConfig, 'scriptUrl'>> & RoverPreviewBootstrapConfig {
  const next: Required<Pick<RoverPreviewBootstrapConfig, 'scriptUrl'>> & RoverPreviewBootstrapConfig = {
    ...config,
    scriptUrl: toStringValue(config.scriptUrl) || DEFAULT_EMBED_SCRIPT_URL,
  };
  const ui = normalizeUiConfig(config.ui);
  if (ui) next.ui = ui;
  else delete next.ui;
  return next;
}

function buildBootstrapPayload(config: RoverPreviewBootstrapConfig): Record<string, unknown> {
  const normalized = normalizeBootstrapConfig(config);
  const payload: Record<string, unknown> = {
    siteId: normalized.siteId,
  };
  if (normalized.publicKey) payload.publicKey = normalized.publicKey;
  if (normalized.sessionToken) payload.sessionToken = normalized.sessionToken;
  if (normalized.sessionId) payload.sessionId = normalized.sessionId;
  if (normalized.siteKeyId) payload.siteKeyId = normalized.siteKeyId;
  if (normalized.apiBase) payload.apiBase = normalized.apiBase;
  if (normalized.workerUrl) payload.workerUrl = normalized.workerUrl;
  if (normalized.allowedDomains?.length) payload.allowedDomains = normalized.allowedDomains;
  if (normalized.domainScopeMode) payload.domainScopeMode = normalized.domainScopeMode;
  if (typeof normalized.cloudSandboxEnabled === 'boolean') payload.cloudSandboxEnabled = normalized.cloudSandboxEnabled;
  if (normalized.sessionScope) payload.sessionScope = normalized.sessionScope;
  if (typeof normalized.openOnInit === 'boolean') payload.openOnInit = normalized.openOnInit;
  if (normalized.mode) payload.mode = normalized.mode;
  if (typeof normalized.allowActions === 'boolean') payload.allowActions = normalized.allowActions;
  if (normalized.pageConfig?.disableAutoScroll === true) payload.pageConfig = { disableAutoScroll: true };
  if (normalized.ui) payload.ui = normalized.ui;
  return payload;
}

function buildQueueStub(): string {
  return [
    '(function(){',
    '  var r = window.rover = window.rover || function(){',
    '    (r.q = r.q || []).push(arguments);',
    '  };',
    '  r.l = +new Date();',
    '})();',
  ].join('\n');
}

function buildCompactQueueStub(): string {
  return '(function(){var r=window.rover=window.rover||function(){(r.q=r.q||[]).push(arguments)};r.l=+new Date()})();';
}

function buildConsoleScript(config: RoverPreviewBootstrapConfig, compact = false): string {
  const normalized = normalizeBootstrapConfig(config);
  const payloadJson = compact
    ? JSON.stringify(buildBootstrapPayload(normalized))
    : JSON.stringify(buildBootstrapPayload(normalized), null, 2);
  const attachJson = normalized.attachLaunch
    ? (compact ? JSON.stringify(normalized.attachLaunch) : JSON.stringify(normalized.attachLaunch, null, 2))
    : '';
  const scriptUrl = JSON.stringify(normalized.scriptUrl);

  if (compact) {
    const parts = [
      buildCompactQueueStub(),
      `rover('boot', ${payloadJson});`,
      normalized.attachLaunch ? `rover('attachLaunch', ${attachJson});` : '',
      `(function(){var s=document.createElement('script');s.src=${scriptUrl};s.async=true;(document.head||document.documentElement).appendChild(s)})();`,
    ];
    return parts.filter(Boolean).join('');
  }

  const lines = [
    buildQueueStub(),
    '',
    `rover('boot', ${payloadJson});`,
  ];
  if (normalized.attachLaunch) {
    lines.push(`rover('attachLaunch', ${attachJson});`);
  }
  lines.push(
    '',
    '(function(){',
    '  var s = document.createElement("script");',
    `  s.src = ${scriptUrl};`,
    '  s.async = true;',
    '  (document.head || document.documentElement).appendChild(s);',
    '})();',
  );
  return lines.join('\n');
}

export function createRoverConsoleSnippet(config: RoverPreviewBootstrapConfig): string {
  return buildConsoleScript(config, false);
}

export function createRoverBookmarklet(config: RoverPreviewBootstrapConfig): string {
  return `javascript:${buildConsoleScript(config, true)}`;
}

export function createRoverScriptTagSnippet(config: RoverPreviewBootstrapConfig): string {
  const normalized = normalizeBootstrapConfig(config);
  const attrs: string[] = [
    `src="${escapeHtmlAttr(normalized.scriptUrl)}"`,
    `data-site-id="${escapeHtmlAttr(normalized.siteId)}"`,
  ];
  if (normalized.publicKey) attrs.push(`data-public-key="${escapeHtmlAttr(normalized.publicKey)}"`);
  if (normalized.sessionToken) attrs.push(`data-session-token="${escapeHtmlAttr(normalized.sessionToken)}"`);
  if (normalized.sessionId) attrs.push(`data-session-id="${escapeHtmlAttr(normalized.sessionId)}"`);
  if (normalized.siteKeyId) attrs.push(`data-site-key-id="${escapeHtmlAttr(normalized.siteKeyId)}"`);
  if (normalized.apiBase) attrs.push(`data-api-base="${escapeHtmlAttr(normalized.apiBase)}"`);
  if (normalized.workerUrl) attrs.push(`data-worker-url="${escapeHtmlAttr(normalized.workerUrl)}"`);
  if (normalized.allowedDomains?.length) attrs.push(`data-allowed-domains="${escapeHtmlAttr(normalized.allowedDomains.join(','))}"`);
  if (normalized.domainScopeMode) attrs.push(`data-domain-scope-mode="${escapeHtmlAttr(normalized.domainScopeMode)}"`);
  if (typeof normalized.cloudSandboxEnabled === 'boolean') attrs.push(`data-cloud-sandbox-enabled="${escapeHtmlAttr(String(normalized.cloudSandboxEnabled))}"`);
  if (normalized.sessionScope) attrs.push(`data-session-scope="${escapeHtmlAttr(normalized.sessionScope)}"`);
  if (typeof normalized.openOnInit === 'boolean') attrs.push(`data-open-on-init="${escapeHtmlAttr(String(normalized.openOnInit))}"`);
  if (normalized.mode) attrs.push(`data-mode="${escapeHtmlAttr(normalized.mode)}"`);
  if (typeof normalized.allowActions === 'boolean') attrs.push(`data-allow-actions="${escapeHtmlAttr(String(normalized.allowActions))}"`);
  if (normalized.pageConfig?.disableAutoScroll === true) attrs.push('data-disable-auto-scroll="true"');
  if (typeof normalized.ui?.voice?.enabled === 'boolean') attrs.push(`data-voice-enabled="${escapeHtmlAttr(String(normalized.ui.voice.enabled))}"`);
  if (normalized.ui?.voice?.language) attrs.push(`data-voice-language="${escapeHtmlAttr(normalized.ui.voice.language)}"`);
  if (typeof normalized.ui?.voice?.autoStopMs === 'number') attrs.push(`data-voice-auto-stop-ms="${escapeHtmlAttr(String(normalized.ui.voice.autoStopMs))}"`);
  if (typeof normalized.ui?.experience?.motion?.actionSpotlight === 'boolean') {
    attrs.push(`data-action-spotlight="${escapeHtmlAttr(String(normalized.ui.experience.motion.actionSpotlight))}"`);
  }
  const runEndpoint = `${toStringValue(normalized.apiBase) || DEFAULT_AGENT_BASE}/v1/a2w/runs`;
  const markerJson = escapeScriptJson(JSON.stringify({ a2w: runEndpoint, run: runEndpoint }));
  return [
    `<script type="application/agent+json" data-rover-agent-discovery="marker">${markerJson}</script>`,
    '<link rel="service-desc" href="/.well-known/agent-card.json" type="application/json" data-rover-agent-discovery="service-desc" />',
    '<link rel="service-doc" href="/llms.txt" type="text/markdown" data-rover-agent-discovery="service-doc" />',
    `<script ${attrs.join(' ')}></script>`,
  ].join('\n');
}

export function readRoverScriptDataAttributes(
  scriptEl: RoverScriptAttributeSource,
): RoverPreviewBootstrapConfig | null {
  const siteId = toStringValue(scriptEl.getAttribute('data-site-id'));
  const publicKey = toStringValue(scriptEl.getAttribute('data-public-key'));
  const sessionToken = toStringValue(scriptEl.getAttribute('data-session-token'));
  if (!siteId || (!publicKey && !sessionToken)) return null;

  const config: RoverPreviewBootstrapConfig = {
    siteId,
  };
  if (publicKey) config.publicKey = publicKey;
  if (sessionToken) config.sessionToken = sessionToken;

  const sessionId = toStringValue(scriptEl.getAttribute('data-session-id'));
  if (sessionId) config.sessionId = sessionId;

  const siteKeyId = toStringValue(scriptEl.getAttribute('data-site-key-id'));
  if (siteKeyId) config.siteKeyId = siteKeyId;

  const apiBase = toStringValue(scriptEl.getAttribute('data-api-base'));
  if (apiBase) config.apiBase = apiBase;

  const workerUrl = toStringValue(scriptEl.getAttribute('data-worker-url'));
  if (workerUrl) config.workerUrl = workerUrl;

  const allowedDomains = parseCsvList(scriptEl.getAttribute('data-allowed-domains'));
  if (allowedDomains) config.allowedDomains = allowedDomains;

  const domainScopeMode = toStringValue(scriptEl.getAttribute('data-domain-scope-mode'));
  if (domainScopeMode === 'host_only' || domainScopeMode === 'registrable_domain') {
    config.domainScopeMode = domainScopeMode;
  }

  const cloudSandboxEnabled = parseBooleanAttr(scriptEl.getAttribute('data-cloud-sandbox-enabled'));
  if (typeof cloudSandboxEnabled === 'boolean') config.cloudSandboxEnabled = cloudSandboxEnabled;

  const sessionScope = toStringValue(scriptEl.getAttribute('data-session-scope'));
  if (sessionScope === 'shared_site' || sessionScope === 'tab') {
    config.sessionScope = sessionScope;
  }

  const openOnInit = parseBooleanAttr(scriptEl.getAttribute('data-open-on-init'));
  if (typeof openOnInit === 'boolean') config.openOnInit = openOnInit;

  const mode = toStringValue(scriptEl.getAttribute('data-mode'));
  if (mode === 'safe' || mode === 'full') {
    config.mode = mode;
  }

  const allowActions = parseBooleanAttr(scriptEl.getAttribute('data-allow-actions'));
  if (typeof allowActions === 'boolean') config.allowActions = allowActions;

  const disableAutoScroll = parseBooleanAttr(scriptEl.getAttribute('data-disable-auto-scroll'));
  if (disableAutoScroll === true) config.pageConfig = { disableAutoScroll: true };

  const voiceEnabled = parseBooleanAttr(scriptEl.getAttribute('data-voice-enabled'));
  const voiceLanguage = toStringValue(scriptEl.getAttribute('data-voice-language'));
  const voiceAutoStopMs = parseIntegerAttr(scriptEl.getAttribute('data-voice-auto-stop-ms'));
  const actionSpotlight = parseBooleanAttr(scriptEl.getAttribute('data-action-spotlight'));
  const voice = normalizeVoiceConfig({
    ...(typeof voiceEnabled === 'boolean' ? { enabled: voiceEnabled } : {}),
    ...(voiceLanguage ? { language: voiceLanguage } : {}),
    ...(typeof voiceAutoStopMs === 'number' ? { autoStopMs: voiceAutoStopMs } : {}),
  });
  const experience = normalizeExperienceConfig({
    ...(typeof actionSpotlight === 'boolean' ? { motion: { actionSpotlight } } : {}),
  });
  if (voice || experience) {
    config.ui = {
      ...(voice ? { voice } : {}),
      ...(experience ? { experience } : {}),
    };
  }

  return config;
}
