import { DEFAULT_GEMINI_MODEL } from '@rover/shared/lib/utils/constants.js';
import { SUB_AGENTS } from '@rover/shared/lib/types/agent-types.js';
import type { LLMIntegration, UserProfile } from '@rover/shared/lib/types/index.js';
import type {
  ApiAdditionalToolName,
  ApiToolsConfig,
  ExternalWebConfig,
  RoverRuntimeContext,
  RoverRuntimeContextExternalTab,
} from './types.js';
import type { FunctionDeclaration } from './types.js';
import { TabularStore } from '../tabular-memory/tabular-store.js';
import { createRoverError, toRoverErrorEnvelope } from './errors.js';

export type BridgeRpc = (method: string, params?: any) => Promise<any>;

export type RoverAgentConfig = {
  apiBase?: string;
  apiKey?: string;
  authToken?: string;
  siteId?: string;
  allowedDomains?: string[];
  externalNavigationPolicy?: 'open_new_tab_notice' | 'block' | 'allow';
  llmIntegration?: Partial<LLMIntegration>;
  model?: string;
  googleAiStudioApiKey?: string;
  googleAiStudioApiKeys?: string[];
  userProfile?: UserProfile;
  userContext?: string;
  recordingContext?: string;
  allowActions?: boolean;
  apiMode?: boolean;
  apiToolsConfig?: ApiToolsConfig;
  tools?: {
    web?: ExternalWebConfig;
  };
  runtimeContext?: RoverRuntimeContext;
  signal?: AbortSignal;
};

export type AgentContext = {
  userTimestamp: string;
  siteId?: string;
  llmIntegration: LLMIntegration;
  userProfile?: UserProfile;
  getPageData: (tabId: number, options?: any) => Promise<any>;
  getExternalPageData: (url: string, options?: { tabId?: number; source?: 'google_search' | 'direct_url' }) => Promise<any>;
  callExtensionRouter: (action: string, data: any) => Promise<any>;
  apiMode: boolean;
  apiToolsConfig?: ApiToolsConfig;
  tabularStore: TabularStore;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
};

const DEFAULT_EXTENSION_ROUTER_BASE = 'https://extensionrouter.rtrvr.ai';

const CANONICAL_ADDITIONAL_TOOLS = new Set(['generate_sheets', 'generate_docs', 'generate_slides', 'generate_websites']);
const LEGACY_ADDITIONAL_TOOL_ALIASES: Record<string, string> = {
  generate_pdfs: 'generate_docs',
  pdf_filling: 'generate_docs',
  generate_web_pages: 'generate_websites',
};

const DEFAULT_EXTERNAL_WEB_CONFIG: Required<Pick<ExternalWebConfig, 'enableExternalWebContext' | 'scrapeMode'>> = {
  enableExternalWebContext: false,
  scrapeMode: 'off',
};

function normalizeApiToolsConfig(input?: ApiToolsConfig): ApiToolsConfig | undefined {
  if (!input) return undefined;
  const rawAdditional = Array.isArray(input.enableAdditionalTools) ? input.enableAdditionalTools : [];
  const normalizedAdditional = Array.from(
    new Set(
      rawAdditional
        .map(name => {
          const normalized = LEGACY_ADDITIONAL_TOOL_ALIASES[name] || name;
          if (!CANONICAL_ADDITIONAL_TOOLS.has(normalized)) return null;
          return normalized;
        })
        .filter((name): name is ApiAdditionalToolName => !!name),
    ),
  );

  return {
    mode: input.mode || 'none',
    userDefined: Array.isArray(input.userDefined) ? input.userDefined : [],
    enableAdditionalTools: normalizedAdditional,
  };
}

function normalizeDomainRules(input?: string[]): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const next = String(raw || '').trim().toLowerCase().replace(/^\./, '');
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function normalizeAgentName(input?: string): string | undefined {
  const normalized = String(input || '').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 64);
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function matchesDomainRule(host: string, rule: string): boolean {
  const clean = String(rule || '').trim().toLowerCase();
  if (!clean) return false;
  if (clean === '*') return true;
  if (clean.startsWith('*.')) {
    const base = clean.slice(2);
    return !!base && (host === base || host.endsWith(`.${base}`));
  }
  return host === clean || host.endsWith(`.${clean}`);
}

function normalizeExternalWebConfig(input?: ExternalWebConfig): Required<Pick<ExternalWebConfig, 'enableExternalWebContext' | 'scrapeMode'>> & {
  allowDomains: string[];
  denyDomains: string[];
} {
  return {
    enableExternalWebContext: input?.enableExternalWebContext ?? DEFAULT_EXTERNAL_WEB_CONFIG.enableExternalWebContext,
    scrapeMode: input?.scrapeMode === 'on_demand' ? 'on_demand' : DEFAULT_EXTERNAL_WEB_CONFIG.scrapeMode,
    allowDomains: normalizeDomainRules(input?.allowDomains),
    denyDomains: normalizeDomainRules(input?.denyDomains),
  };
}

function isAllowedByRules(url: string, rules: { allowDomains: string[]; denyDomains: string[] }): { allowed: boolean; reason?: string } {
  const host = hostFromUrl(url);
  if (!host) return { allowed: false, reason: 'invalid_url' };
  if (rules.denyDomains.some(rule => matchesDomainRule(host, rule))) {
    return { allowed: false, reason: `deny_rule:${host}` };
  }
  if (!rules.allowDomains.length) return { allowed: true };
  if (rules.allowDomains.some(rule => matchesDomainRule(host, rule))) return { allowed: true };
  return { allowed: false, reason: `not_in_allowlist:${host}` };
}

function normalizeRuntimeExternalTabs(input?: RoverRuntimeContextExternalTab[]): RoverRuntimeContextExternalTab[] {
  if (!Array.isArray(input)) return [];
  const deduped = new Map<number, RoverRuntimeContextExternalTab>();
  for (const tab of input) {
    const tabId = Number(tab?.tabId);
    if (!Number.isFinite(tabId)) continue;
    const accessMode = tab?.accessMode === 'external_scraped' ? 'external_scraped' : 'external_placeholder';
    const host = String(tab?.host || '').trim() || undefined;
    const title = String(tab?.title || '').trim() || undefined;
    const reason = String(tab?.reason || '').trim() || undefined;
    deduped.set(tabId, {
      tabId,
      accessMode,
      host,
      title,
      reason,
    });
  }
  return Array.from(deduped.values());
}

function resolveExtensionRouterEndpoint(apiBase?: string): string {
  const fallback = DEFAULT_EXTENSION_ROUTER_BASE;
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter')) return base;
  try {
    const parsed = new URL(base);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname && pathname !== '/') return base;
    if (parsed.hostname.toLowerCase() === 'extensionrouter.rtrvr.ai') return base;
  } catch {
    // no-op: fallback to legacy suffix behavior
  }
  return `${base}/extensionRouter`;
}

function buildRoverRuntimeContext(config: RoverAgentConfig): RoverRuntimeContext | undefined {
  const runtimeContext = config.runtimeContext;
  if (!runtimeContext || runtimeContext.mode !== 'rover_embed') return undefined;
  const compactExternalTabs = normalizeRuntimeExternalTabs(runtimeContext.externalTabs).slice(0, 8);

  return {
    mode: 'rover_embed',
    agentName: normalizeAgentName(runtimeContext.agentName) || 'Rover',
    externalNavigationPolicy: runtimeContext.externalNavigationPolicy || config.externalNavigationPolicy,
    tabIdContract: runtimeContext.tabIdContract || 'tree_index_mapped_by_tab_order',
    ...(compactExternalTabs.length ? { externalTabs: compactExternalTabs } : {}),
  };
}

function buildExternalPlaceholderPageData(params: {
  tabId?: number;
  url?: string;
  title?: string;
  agentName?: string;
  reason?: string;
}): Record<string, any> {
  const agentName = normalizeAgentName(params.agentName) || 'Rover';
  const reason = params.reason || 'external_domain_inaccessible';
  const title = params.title || 'External Tab (Inaccessible)';
  const url = params.url || '';
  const reasonLine = reason ? ` Reason: ${reason}.` : '';
  return {
    url,
    title,
    contentType: 'text/html',
    content: `${agentName} is running in virtual external-tab mode. Live DOM control and accessibility-tree access are unavailable here.${reasonLine}`,
    metadata: {
      inaccessible: true,
      external: true,
      accessMode: 'external_placeholder',
      reason,
      logicalTabId: params.tabId,
    },
  };
}

export function getUserFriendlyTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = String(hours).padStart(2, '0');
  return `${year}/${month}/${day} ${hoursStr}:${minutes} ${ampm}`;
}

export function createAgentContext(
  config: RoverAgentConfig,
  bridgeRpc: BridgeRpc,
  tabularStore?: TabularStore,
): AgentContext {
  const userTimestamp = getUserFriendlyTimestamp();
  const apiMode = typeof config.apiMode === 'boolean' ? config.apiMode : !!config.apiKey;

  const llmIntegration: LLMIntegration = {
    model: (config.llmIntegration?.model as any) || (config.model as any) || DEFAULT_GEMINI_MODEL,
  };

  const apiKeys = config.googleAiStudioApiKeys || config.llmIntegration?.apiKeys;
  const apiKey = config.googleAiStudioApiKey || config.llmIntegration?.apiKey;

  if (apiKeys && apiKeys.length > 0) {
    llmIntegration.enableGoogleAiStudioApiKey = true;
    llmIntegration.apiKeys = apiKeys;
  } else if (apiKey) {
    llmIntegration.enableGoogleAiStudioApiKey = true;
    llmIntegration.apiKey = apiKey;
  } else if (config.llmIntegration?.enableGoogleAiStudioApiKey) {
    llmIntegration.enableGoogleAiStudioApiKey = true;
  }

  const endpoint = resolveExtensionRouterEndpoint(config.apiBase);
  const runtimeContext = buildRoverRuntimeContext(config);
  const externalWebConfig = normalizeExternalWebConfig(config.tools?.web);
  const externalPageDataCache = new Map<string, { data: any; ts: number }>();
  const externalPageDataErrorCache = new Map<string, { message: string; ts: number }>();
  let externalPageDataDisabledReason: string | undefined;
  let cachedActiveTabId = 0;
  let cachedActiveTabTs = 0;

  const RETRY_DELAYS = [1_000, 3_000];
  const MAX_RETRIES = RETRY_DELAYS.length;
  const ACTIVE_TAB_CACHE_TTL_MS = 250;
  const EXTERNAL_PAGE_CACHE_TTL_MS = 45_000;

  const callExtensionRouter = async (action: string, data: any): Promise<any> => {
    const token = config.authToken || config.apiKey;
    if (!token) {
      throw createRoverError({
        code: 'MISSING_API_KEY',
        message: 'Rover API key is required to call extensionRouter.',
        requires_api_key: true,
        next_action: 'Provide apiKey in rover.boot(...) or an Authorization Bearer token.',
        retryable: false,
      });
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          data:
            data && typeof data === 'object'
              ? {
                  ...data,
                  ...(!(data as any).runtimeContext && runtimeContext ? { runtimeContext } : {}),
                }
              : data,
        }),
        signal: config.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('Retry-After')) || 0;
          const err = createRoverError({
            code: 'RATE_LIMITED',
            message: 'Rate limited by backend',
            retryable: true,
            details: { status: 429, retryAfter },
          });
          if (attempt < MAX_RETRIES) {
            lastError = err;
            continue;
          }
          throw err;
        }

        let errorPayload: any = undefined;
        try {
          errorPayload = await response.json();
        } catch {
          const text = await response.text().catch(() => '');
          if (text) errorPayload = { error: text };
        }
        const envelope = toRoverErrorEnvelope(errorPayload, `HTTP ${response.status}`);
        throw createRoverError({
          ...envelope,
          details: {
            status: response.status,
            endpoint,
            action,
            response: errorPayload,
          },
        });
      }

      const payload = await response.json();
      if (payload?.success === false) {
        const envelope = toRoverErrorEnvelope(payload, payload?.error || 'extensionRouter returned success=false');
        throw createRoverError({
          ...envelope,
          details: {
            endpoint,
            action,
            response: payload,
          },
        });
      }
      return payload;
    }

    throw lastError || new Error('callExtensionRouter: unexpected retry exhaustion');
  };

  const getExternalPageData = async (
    url: string,
    options?: { tabId?: number; source?: 'google_search' | 'direct_url' },
  ): Promise<any> => {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) throw new Error('external page data requires url');
    const cacheTabId = Number(options?.tabId) || 0;
    const cacheKey = `${cacheTabId}:${normalizedUrl}`;
    const nowMs = Date.now();
    const cachedData = externalPageDataCache.get(cacheKey);
    if (cachedData && nowMs - cachedData.ts <= EXTERNAL_PAGE_CACHE_TTL_MS) {
      return cachedData.data;
    }
    externalPageDataCache.delete(cacheKey);
    const cachedError = externalPageDataErrorCache.get(cacheKey);
    if (cachedError && nowMs - cachedError.ts <= EXTERNAL_PAGE_CACHE_TTL_MS) {
      throw new Error(cachedError.message || 'external page data fetch failed');
    }
    externalPageDataErrorCache.delete(cacheKey);
    if (externalPageDataDisabledReason) {
      throw new Error(externalPageDataDisabledReason);
    }

    const source = options?.source || 'direct_url';
    const payload = {
      url: normalizedUrl,
      source,
      siteId: config.siteId,
      roverPolicy: {
        allowDomains: externalWebConfig.allowDomains,
        denyDomains: externalWebConfig.denyDomains,
      },
    };
    try {
      const response = await callExtensionRouter(SUB_AGENTS.roverExternalPageData, payload);
      const pageData = response?.data || response;
      externalPageDataCache.set(cacheKey, { data: pageData, ts: nowMs });
      return pageData;
    } catch (error: any) {
      const envelope = toRoverErrorEnvelope(error, 'external page data fetch failed');
      const normalizedMessage = envelope?.message || 'external page data fetch failed';
      externalPageDataErrorCache.set(cacheKey, { message: normalizedMessage, ts: nowMs });

      if (
        envelope.code === 'PERMISSION_DENIED'
        || envelope.code === 'MISSING_API_KEY'
        || envelope.code === 'INVALID_API_KEY'
      ) {
        externalPageDataDisabledReason = `${envelope.code}: ${normalizedMessage}`;
      }

      throw error;
    }
  };

  const getActiveLogicalTabId = async (): Promise<number | undefined> => {
    const nowMs = Date.now();
    if (cachedActiveTabId > 0 && nowMs - cachedActiveTabTs <= ACTIVE_TAB_CACHE_TTL_MS) {
      return cachedActiveTabId;
    }
    try {
      const context = await bridgeRpc('getTabContext');
      const active = Number(context?.activeLogicalTabId || context?.logicalTabId || context?.id);
      if (Number.isFinite(active) && active > 0) {
        cachedActiveTabId = active;
        cachedActiveTabTs = nowMs;
        return active;
      }
    } catch {
      // ignore
    }
    return undefined;
  };

  const getPageData = async (tabId: number, options?: any) => {
    const numericTabId = Number(tabId);
    const rawOptions = options && typeof options === 'object' ? options : undefined;
    const allowExternalFetch = rawOptions?.__roverAllowExternalFetch === true;
    const pageConfig =
      rawOptions && typeof rawOptions === 'object'
        ? Object.fromEntries(
            Object.entries(rawOptions).filter(([key]) => key !== '__roverAllowExternalFetch'),
          )
        : undefined;
    const hasPageConfig = !!pageConfig && Object.keys(pageConfig).length > 0;
    const localPageData = rawOptions
      ? await bridgeRpc('getPageData', hasPageConfig ? { pageConfig, tabId: numericTabId } : { tabId: numericTabId })
      : await bridgeRpc('getPageData', { tabId: numericTabId });

    const metadata = localPageData?.metadata || {};
    const isExternal =
      !!metadata?.external
      || metadata?.accessMode === 'external_placeholder'
      || metadata?.accessMode === 'external_scraped';

    if (!isExternal) {
      return localPageData;
    }

    const pageUrl = typeof localPageData?.url === 'string' ? localPageData.url.trim() : '';
    if (!externalWebConfig.enableExternalWebContext || externalWebConfig.scrapeMode === 'off' || !pageUrl) {
      return localPageData;
    }

    if (externalPageDataDisabledReason) {
      return buildExternalPlaceholderPageData({
        tabId: numericTabId,
        url: pageUrl,
        title: localPageData?.title,
        agentName: runtimeContext?.agentName,
        reason: `cloud_fetch_disabled:${externalPageDataDisabledReason}`,
      });
    }

    const ruleCheck = isAllowedByRules(pageUrl, {
      allowDomains: externalWebConfig.allowDomains,
      denyDomains: externalWebConfig.denyDomains,
    });
    if (!ruleCheck.allowed) {
      return buildExternalPlaceholderPageData({
        tabId: numericTabId,
        url: pageUrl,
        title: localPageData?.title,
        agentName: runtimeContext?.agentName,
        reason: `policy_blocked:${ruleCheck.reason || 'blocked'}`,
      });
    }

    // In on-demand mode, fetch cloud context only for the active external tab.
    // Background external tabs stay as placeholders to avoid noisy repeated scrape calls.
    const activeTabId = await getActiveLogicalTabId();
    const shouldFetchExternalContext = allowExternalFetch || (activeTabId ? activeTabId === numericTabId : false);
    if (!shouldFetchExternalContext) {
      return localPageData;
    }

    try {
      const cloudData = await getExternalPageData(pageUrl, {
        tabId: numericTabId,
        source: pageUrl.includes('google.com/search') ? 'google_search' : 'direct_url',
      });
      if (cloudData && typeof cloudData === 'object') {
        return {
          ...cloudData,
          metadata: {
            ...(cloudData.metadata || {}),
            external: true,
            accessMode: 'external_scraped',
            logicalTabId: numericTabId,
          },
        };
      }
      return localPageData;
    } catch (error: any) {
      const envelope = toRoverErrorEnvelope(error, 'external page data fetch failed');
      return buildExternalPlaceholderPageData({
        tabId: numericTabId,
        url: pageUrl,
        title: localPageData?.title,
        agentName: runtimeContext?.agentName,
        reason: `cloud_fetch_failed:${envelope?.code || 'unknown'}`,
      });
    }
  };

  const userProfile: UserProfile | undefined = config.userProfile || (config.userContext ? { userContext: config.userContext } : undefined);

  const defaultApiToolsConfig: ApiToolsConfig | undefined = apiMode
    ? {
        enableAdditionalTools: ['generate_sheets', 'generate_docs', 'generate_slides', 'generate_websites'],
        mode: 'none',
      }
    : undefined;

  return {
    userTimestamp,
    siteId: config.siteId,
    llmIntegration,
    userProfile,
    getPageData,
    getExternalPageData,
    callExtensionRouter,
    apiMode,
    apiToolsConfig: normalizeApiToolsConfig(config.apiToolsConfig ?? defaultApiToolsConfig),
    tabularStore: tabularStore ?? new TabularStore(`rover-${userTimestamp}`),
    signal: config.signal,
  };
}

export function buildFunctionDeclarationsForRequest(functionDeclarations: FunctionDeclaration[] | undefined) {
  return functionDeclarations && functionDeclarations.length > 0 ? functionDeclarations : undefined;
}
