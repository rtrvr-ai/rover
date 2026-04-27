export const STORAGE_KEY_PREFIX = 'rover-preview-helper:tab:';
export const PREVIEW_ID_PARAM = 'rover_preview_id';
export const PREVIEW_TOKEN_PARAM = 'rover_preview_token';
export const PREVIEW_API_PARAM = 'rover_preview_api';
export const HELPER_PAYLOAD_FRAGMENT_PARAM = 'rover_helper_payload';
const DEFAULT_EMBED_SCRIPT_URL = 'https://rover.rtrvr.ai/embed.js';
const DEFAULT_API_BASE = 'https://agent.rtrvr.ai';
const VOICE_AUTO_STOP_MIN_MS = 800;
const VOICE_AUTO_STOP_MAX_MS = 5000;

export function readCurrentTabId(tabId) {
  const value = Number(tabId);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

export function normalizeHost(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeAllowedDomains(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeVoiceConfig(value) {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value;
  const voice = {};
  if (typeof raw.enabled === 'boolean') {
    voice.enabled = raw.enabled;
  }
  const language = String(raw.language || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 48);
  if (language) {
    voice.language = language;
  }
  const autoStopMs = Number(raw.autoStopMs);
  if (Number.isFinite(autoStopMs)) {
    voice.autoStopMs = Math.max(VOICE_AUTO_STOP_MIN_MS, Math.min(VOICE_AUTO_STOP_MAX_MS, Math.trunc(autoStopMs)));
  }
  return Object.keys(voice).length ? voice : undefined;
}

function normalizeUiConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const ui = {};
  const voice = normalizeVoiceConfig(raw.voice);
  if (voice) {
    ui.voice = voice;
  }
  const actionSpotlight = raw.experience?.motion?.actionSpotlight;
  ui.experience = {
    motion: {
      actionSpotlight: actionSpotlight !== false,
    },
  };
  return Object.keys(ui).length ? ui : undefined;
}

function normalizePageConfig(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.disableAutoScroll === 'boolean') {
    return { disableAutoScroll: value.disableAutoScroll };
  }
  return undefined;
}

function encodeBase64Url(bytes) {
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64')
    : btoa(String.fromCharCode(...bytes));

  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (!normalized) throw new Error('Missing helper config payload.');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const base64 = `${normalized}${padding}`;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeDomainPattern(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  return raw
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .trim();
}

export function isHostAllowed(host, allowedDomains, domainScopeMode = 'registrable_domain') {
  const normalizedHost = String(host || '').trim().toLowerCase();
  if (!normalizedHost) return false;
  const patterns = normalizeAllowedDomains(allowedDomains).map(normalizeDomainPattern).filter(Boolean);
  if (!patterns.length) return true;

  return patterns.some(pattern => {
    if (pattern === '*') return true;
    if (pattern.startsWith('=')) {
      return normalizedHost === pattern.slice(1);
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return normalizedHost.length > suffix.length && normalizedHost.endsWith(`.${suffix}`);
    }
    if (domainScopeMode === 'host_only') {
      return normalizedHost === pattern;
    }
    return normalizedHost === pattern || normalizedHost.endsWith(`.${pattern}`);
  });
}

export function normalizeConfig(input = {}) {
  const previewId = String(input.previewId || '').trim();
  const previewToken = String(input.previewToken || '').trim();
  const siteId = String(input.siteId || '').trim();
  const publicKey = String(input.publicKey || '').trim();
  const sessionToken = String(input.sessionToken || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const siteKeyId = String(input.siteKeyId || input.keyId || '').trim();
  const sessionTokenExpiresAt = Number(input.sessionTokenExpiresAt);
  const embedScriptUrl = String(input.embedScriptUrl || DEFAULT_EMBED_SCRIPT_URL).trim() || DEFAULT_EMBED_SCRIPT_URL;
  const launchUrl = String(input.launchUrl || '').trim();
  const requestId = String(input.requestId || '').trim();
  const attachToken = String(input.attachToken || '').trim();
  const targetUrl = String(input.targetUrl || '').trim();
  const apiBase = String(input.apiBase || DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
  const workerUrl = String(input.workerUrl || '').trim();
  const domainScopeMode = input.domainScopeMode === 'host_only' ? 'host_only' : 'registrable_domain';
  const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
  const sessionScope = ['shared_site', 'tab'].includes(String(input.sessionScope || '').trim())
    ? String(input.sessionScope).trim()
    : '';
  const openOnInit = input.openOnInit !== false;
  const mode = ['safe', 'full'].includes(String(input.mode || '').trim()) ? String(input.mode).trim() : '';
  const allowActions = typeof input.allowActions === 'boolean' ? input.allowActions : undefined;
  const cloudSandboxEnabled = typeof input.cloudSandboxEnabled === 'boolean' ? input.cloudSandboxEnabled : undefined;
  const pageConfig = normalizePageConfig(input.pageConfig);
  const previewLabel = String(input.previewLabel || 'Rover Preview').trim();
  const configRefreshedAt = Number(input.configRefreshedAt);
  const ui = normalizeUiConfig(input.ui);

  return {
    previewId,
    previewToken,
    siteId,
    publicKey,
    sessionToken,
    sessionId,
    siteKeyId,
    sessionTokenExpiresAt: Number.isFinite(sessionTokenExpiresAt) ? sessionTokenExpiresAt : 0,
    embedScriptUrl,
    launchUrl,
    requestId,
    attachToken,
    targetUrl,
    apiBase,
    workerUrl,
    allowedDomains,
    domainScopeMode,
    sessionScope,
    openOnInit,
    mode,
    allowActions,
    cloudSandboxEnabled,
    pageConfig,
    ui,
    previewLabel,
    configRefreshedAt: Number.isFinite(configRefreshedAt) ? configRefreshedAt : 0,
  };
}

export function extractPreviewLaunchParams(urlString) {
  try {
    const url = new URL(urlString);
    const previewId = String(url.searchParams.get(PREVIEW_ID_PARAM) || '').trim();
    const previewToken = String(url.searchParams.get(PREVIEW_TOKEN_PARAM) || '').trim();
    const apiBase = String(url.searchParams.get(PREVIEW_API_PARAM) || '').trim();
    if (!previewId || !previewToken) return null;
    return {
      previewId,
      previewToken,
      apiBase,
    };
  } catch {
    return null;
  }
}

function getHelperFragmentValue(rawHash) {
  if (!rawHash || !rawHash.includes('=')) return '';
  const params = new URLSearchParams(rawHash);
  return String(
    params.get(HELPER_PAYLOAD_FRAGMENT_PARAM) || '',
  ).trim();
}

export function hasHelperConfigFragment(urlString) {
  try {
    const url = new URL(urlString);
    const rawHash = String(url.hash || '').replace(/^#/, '').trim();
    return Boolean(getHelperFragmentValue(rawHash));
  } catch {
    return false;
  }
}

export function extractHelperConfigFragment(urlString) {
  try {
    const url = new URL(urlString);
    const rawHash = String(url.hash || '').replace(/^#/, '').trim();
    const encoded = getHelperFragmentValue(rawHash);
    if (!encoded) return null;
    const decoded = decodeBase64Url(encoded);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    const message = String(error?.message || error || 'Invalid helper handoff payload.');
    throw new Error(`Invalid Rover helper handoff: ${message}`);
  }
}

export function stripPreviewLaunchParams(urlString) {
  try {
    const url = new URL(urlString);
    url.searchParams.delete(PREVIEW_ID_PARAM);
    url.searchParams.delete(PREVIEW_TOKEN_PARAM);
    url.searchParams.delete(PREVIEW_API_PARAM);
    const rawHash = String(url.hash || '').replace(/^#/, '').trim();
    if (rawHash && rawHash.includes('=')) {
      const params = new URLSearchParams(rawHash);
      params.delete(HELPER_PAYLOAD_FRAGMENT_PARAM);
      const nextHash = params.toString();
      url.hash = nextHash ? nextHash : '';
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

export function buildLaunchUrl(currentUrl, config) {
  if (config.launchUrl) return config.launchUrl;
  if (!config.requestId || !config.attachToken) return '';
  const url = new URL(currentUrl);
  url.searchParams.set('rover_launch', config.requestId);
  url.searchParams.set('rover_attach', config.attachToken);
  return url.toString();
}

export function serializeConfigForSeed(config) {
  return {
    previewId: config.previewId,
    previewToken: config.previewToken,
    siteId: config.siteId,
    publicKey: config.publicKey,
    sessionToken: config.sessionToken,
    sessionId: config.sessionId,
    siteKeyId: config.siteKeyId,
    sessionTokenExpiresAt: config.sessionTokenExpiresAt,
    embedScriptUrl: config.embedScriptUrl,
    launchUrl: config.launchUrl,
    requestId: config.requestId,
    attachToken: config.attachToken,
    targetUrl: config.targetUrl,
    apiBase: config.apiBase,
    workerUrl: config.workerUrl,
    allowedDomains: config.allowedDomains,
    domainScopeMode: config.domainScopeMode,
    sessionScope: config.sessionScope,
    openOnInit: config.openOnInit,
    mode: config.mode,
    allowActions: config.allowActions,
    cloudSandboxEnabled: config.cloudSandboxEnabled,
    pageConfig: config.pageConfig,
    ui: config.ui,
    previewLabel: config.previewLabel,
    targetHost: config.targetHost,
    bootstrapId: config.bootstrapId,
    configRefreshedAt: config.configRefreshedAt,
  };
}

export function encodeHelperConfigFragment(config) {
  const json = JSON.stringify(config || {});
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(json)
    : Uint8Array.from(Buffer.from(json, 'utf8'));
  return `${HELPER_PAYLOAD_FRAGMENT_PARAM}=${encodeBase64Url(bytes)}`;
}
