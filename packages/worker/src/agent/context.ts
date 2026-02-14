import { DEFAULT_GEMINI_MODEL } from '@rover/shared/lib/utils/constants.js';
import type { LLMIntegration, UserProfile } from '@rover/shared/lib/types/index.js';
import type { ApiAdditionalToolName, ApiToolsConfig } from './types.js';
import type { FunctionDeclaration } from './types.js';
import { TabularStore } from '../tabular-memory/tabular-store.js';
import { createRoverError, toRoverErrorEnvelope } from './errors.js';

export type BridgeRpc = (method: string, params?: any) => Promise<any>;

export type RoverAgentConfig = {
  apiBase?: string;
  apiKey?: string;
  authToken?: string;
  siteId?: string;
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
};

export type AgentContext = {
  userTimestamp: string;
  siteId?: string;
  llmIntegration: LLMIntegration;
  userProfile?: UserProfile;
  getPageData: (tabId: number, options?: any) => Promise<any>;
  callExtensionRouter: (action: string, data: any) => Promise<any>;
  apiMode: boolean;
  apiToolsConfig?: ApiToolsConfig;
  tabularStore: TabularStore;
  isCancelled?: () => boolean;
};

const DEFAULT_CLOUD_FUNCTIONS_BASE = 'https://us-central1-rtrvr-extension-functions.cloudfunctions.net';

const CANONICAL_ADDITIONAL_TOOLS = new Set(['generate_sheets', 'generate_docs', 'generate_slides', 'generate_websites']);
const LEGACY_ADDITIONAL_TOOL_ALIASES: Record<string, string> = {
  generate_pdfs: 'generate_docs',
  pdf_filling: 'generate_docs',
  generate_web_pages: 'generate_websites',
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

  const base = (config.apiBase || DEFAULT_CLOUD_FUNCTIONS_BASE).replace(/\/$/, '');
  const endpoint = base.endsWith('/extensionRouter') ? base : `${base}/extensionRouter`;

  const RETRY_DELAYS = [1_000, 3_000];
  const MAX_RETRIES = RETRY_DELAYS.length;

  const callExtensionRouter = async (action: string, data: any): Promise<any> => {
    const token = config.apiKey || config.authToken;
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
        body: JSON.stringify({ action, data }),
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

  const getPageData = async (tabId: number, options?: any) => {
    if (options) {
      return bridgeRpc('getPageData', { pageConfig: options, tabId });
    }
    return bridgeRpc('getPageData', { tabId });
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
    callExtensionRouter,
    apiMode,
    apiToolsConfig: normalizeApiToolsConfig(config.apiToolsConfig ?? defaultApiToolsConfig),
    tabularStore: tabularStore ?? new TabularStore(`rover-${userTimestamp}`),
  };
}

export function buildFunctionDeclarationsForRequest(functionDeclarations: FunctionDeclaration[] | undefined) {
  return functionDeclarations && functionDeclarations.length > 0 ? functionDeclarations : undefined;
}
