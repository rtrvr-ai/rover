export const STORAGE_KEY_PREFIX = 'rover-preview-helper:tab:';
export const PREVIEW_ID_PARAM = 'rover_preview_id';
export const PREVIEW_TOKEN_PARAM = 'rover_preview_token';
export const PREVIEW_API_PARAM = 'rover_preview_api';
const DEFAULT_EMBED_SCRIPT_URL = 'https://rover.rtrvr.ai/embed.js';

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

export function normalizeConfig(input = {}) {
  const previewId = String(input.previewId || '').trim();
  const previewToken = String(input.previewToken || '').trim();
  const siteId = String(input.siteId || '').trim();
  const sessionToken = String(input.sessionToken || '').trim();
  const sessionTokenExpiresAt = Number(input.sessionTokenExpiresAt);
  const embedScriptUrl = String(input.embedScriptUrl || DEFAULT_EMBED_SCRIPT_URL).trim() || DEFAULT_EMBED_SCRIPT_URL;
  const launchUrl = String(input.launchUrl || '').trim();
  const requestId = String(input.requestId || '').trim();
  const attachToken = String(input.attachToken || '').trim();
  const targetUrl = String(input.targetUrl || '').trim();
  const apiBase = String(input.apiBase || 'https://agent.rtrvr.ai').trim() || 'https://agent.rtrvr.ai';
  const domainScopeMode = input.domainScopeMode === 'host_only' ? 'host_only' : 'registrable_domain';
  const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
  const openOnInit = input.openOnInit !== false;
  const previewLabel = String(input.previewLabel || 'Rover Preview').trim();
  const configRefreshedAt = Number(input.configRefreshedAt);

  return {
    previewId,
    previewToken,
    siteId,
    sessionToken,
    sessionTokenExpiresAt: Number.isFinite(sessionTokenExpiresAt) ? sessionTokenExpiresAt : 0,
    embedScriptUrl,
    launchUrl,
    requestId,
    attachToken,
    targetUrl,
    apiBase,
    allowedDomains,
    domainScopeMode,
    openOnInit,
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

export function stripPreviewLaunchParams(urlString) {
  try {
    const url = new URL(urlString);
    url.searchParams.delete(PREVIEW_ID_PARAM);
    url.searchParams.delete(PREVIEW_TOKEN_PARAM);
    url.searchParams.delete(PREVIEW_API_PARAM);
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
    sessionToken: config.sessionToken,
    sessionTokenExpiresAt: config.sessionTokenExpiresAt,
    embedScriptUrl: config.embedScriptUrl,
    launchUrl: config.launchUrl,
    requestId: config.requestId,
    attachToken: config.attachToken,
    targetUrl: config.targetUrl,
    apiBase: config.apiBase,
    allowedDomains: config.allowedDomains,
    domainScopeMode: config.domainScopeMode,
    openOnInit: config.openOnInit,
    previewLabel: config.previewLabel,
    targetHost: config.targetHost,
    bootstrapId: config.bootstrapId,
    configRefreshedAt: config.configRefreshedAt,
  };
}
