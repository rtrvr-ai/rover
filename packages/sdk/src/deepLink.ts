const DEEP_LINK_PROMPT_PARAM_DEFAULT = 'rover';
const DEEP_LINK_SHORTCUT_PARAM_DEFAULT = 'rover_shortcut';
const DEEP_LINK_GUIDE_PARAM_DEFAULT = 'rover_guide';
const DEEP_LINK_PARAM_NAME_MAX_CHARS = 64;

export type DeepLinkConfigInput = {
  enabled?: boolean;
  promptParam?: string;
  shortcutParam?: string;
  guideParam?: string;
  consume?: boolean;
} | null | undefined;

export type NormalizedDeepLinkConfig = {
  enabled?: boolean;
  promptParam: string;
  shortcutParam: string;
  guideParam: string;
  consume: boolean;
};

export type ResolvedDeepLinkConfig = {
  enabled: boolean;
  promptParam: string;
  shortcutParam: string;
  guideParam: string;
  consume: boolean;
};

export type DeepLinkAiAccessInput = {
  enabled?: boolean;
} | null | undefined;

export type ResolvedRuntimeDeepLinkConfig = ResolvedDeepLinkConfig;

export type ResolvedAiLaunchAccess = {
  enabled: boolean;
};

export type RoverDeepLinkRequest =
  | {
      kind: 'prompt';
      paramName: string;
      value: string;
      signature: string;
      /** True when `?rover_guide=1` (or the configured guide param) is also present. */
      guideOverride?: boolean;
    }
  | {
      kind: 'shortcut';
      paramName: string;
      value: string;
      signature: string;
      /** True when `?rover_guide=1` (or the configured guide param) is also present. */
      guideOverride?: boolean;
    }
  | {
      kind: 'guide-flag';
      paramName: string;
      value: string;
      signature: string;
    };

function normalizeParamName(raw: unknown, fallback: string): string {
  const value = String(raw || '')
    .trim()
    .replace(/^[?#&]+/, '')
    .slice(0, DEEP_LINK_PARAM_NAME_MAX_CHARS);
  return value || fallback;
}

function coerceUrl(input: string | URL): URL {
  if (input instanceof URL) return new URL(input.toString());
  return new URL(String(input || ''), 'https://rover.local');
}

function readLastNonEmptyParam(searchParams: URLSearchParams, name: string): string {
  const values = searchParams.getAll(name);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const candidate = String(values[index] || '').trim();
    if (candidate) return candidate;
  }
  return '';
}

export function normalizeDeepLinkConfig(raw?: DeepLinkConfigInput): NormalizedDeepLinkConfig {
  let promptParam = normalizeParamName(raw?.promptParam, DEEP_LINK_PROMPT_PARAM_DEFAULT);
  let shortcutParam = normalizeParamName(raw?.shortcutParam, DEEP_LINK_SHORTCUT_PARAM_DEFAULT);
  let guideParam = normalizeParamName(raw?.guideParam, DEEP_LINK_GUIDE_PARAM_DEFAULT);
  if (shortcutParam === promptParam) {
    shortcutParam = shortcutParam === DEEP_LINK_SHORTCUT_PARAM_DEFAULT
      ? `${DEEP_LINK_SHORTCUT_PARAM_DEFAULT}_id`
      : DEEP_LINK_SHORTCUT_PARAM_DEFAULT;
    if (shortcutParam === promptParam) {
      promptParam = DEEP_LINK_PROMPT_PARAM_DEFAULT;
    }
  }
  if (guideParam === promptParam || guideParam === shortcutParam) {
    guideParam = DEEP_LINK_GUIDE_PARAM_DEFAULT;
    if (guideParam === promptParam || guideParam === shortcutParam) {
      guideParam = `${DEEP_LINK_GUIDE_PARAM_DEFAULT}_mode`;
    }
  }
  return {
    ...(typeof raw?.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    promptParam,
    shortcutParam,
    guideParam,
    consume: raw?.consume !== false,
  };
}

export function resolveDeepLinkConfig(raw?: DeepLinkConfigInput): ResolvedDeepLinkConfig {
  const normalized = normalizeDeepLinkConfig(raw);
  return {
    enabled: normalized.enabled === true,
    promptParam: normalized.promptParam,
    shortcutParam: normalized.shortcutParam,
    guideParam: normalized.guideParam,
    consume: normalized.consume,
  };
}

export function resolveAiLaunchAccess(aiAccess?: DeepLinkAiAccessInput): ResolvedAiLaunchAccess {
  const enabled = aiAccess?.enabled === true;

  return {
    enabled,
  };
}

export function resolveRuntimeDeepLinkConfig(
  rawConfig?: DeepLinkConfigInput,
  aiAccess?: DeepLinkAiAccessInput,
): ResolvedRuntimeDeepLinkConfig {
  const normalized = normalizeDeepLinkConfig(rawConfig);
  const hasExplicitEnabled = typeof normalized.enabled === 'boolean';
  const launchAccess = resolveAiLaunchAccess(aiAccess);
  const enabled = hasExplicitEnabled
    ? normalized.enabled === true
    : launchAccess.enabled;
  return {
    enabled,
    promptParam: normalized.promptParam,
    shortcutParam: normalized.shortcutParam,
    guideParam: normalized.guideParam,
    consume: normalized.consume,
  };
}

function readGuideFlag(searchParams: URLSearchParams, name: string): { active: boolean; value: string } {
  if (!searchParams.has(name)) return { active: false, value: '' };
  // Use the last occurrence to match readLastNonEmptyParam semantics, but allow empty values
  // (bare `?rover_guide` with no value still counts as "active").
  const values = searchParams.getAll(name);
  const raw = String(values[values.length - 1] ?? '').trim();
  const lowered = raw.toLowerCase();
  // Explicit falsy values disable. Empty / truthy / present-without-value activate.
  if (lowered === 'false' || lowered === '0' || lowered === 'off' || lowered === 'no') {
    return { active: false, value: '' };
  }
  return { active: true, value: raw || '1' };
}

export function parseDeepLinkRequest(
  input: string | URL,
  rawConfig?: DeepLinkConfigInput,
): RoverDeepLinkRequest | null {
  const config = resolveDeepLinkConfig(rawConfig);
  const url = coerceUrl(input);
  const guideFlag = readGuideFlag(url.searchParams, config.guideParam);
  const guideOverride = guideFlag.active;

  const shortcutValue = readLastNonEmptyParam(url.searchParams, config.shortcutParam);
  if (shortcutValue) {
    return {
      kind: 'shortcut',
      paramName: config.shortcutParam,
      value: shortcutValue,
      signature: `shortcut:${config.shortcutParam}:${shortcutValue}${guideOverride ? ':guide' : ''}`,
      ...(guideOverride ? { guideOverride: true } : {}),
    };
  }
  const promptValue = readLastNonEmptyParam(url.searchParams, config.promptParam);
  if (promptValue) {
    return {
      kind: 'prompt',
      paramName: config.promptParam,
      value: promptValue,
      signature: `prompt:${config.promptParam}:${promptValue}${guideOverride ? ':guide' : ''}`,
      ...(guideOverride ? { guideOverride: true } : {}),
    };
  }
  if (guideOverride) {
    return {
      kind: 'guide-flag',
      paramName: config.guideParam,
      value: guideFlag.value,
      signature: `guide-flag:${config.guideParam}:${guideFlag.value}`,
    };
  }
  return null;
}

export function stripDeepLinkParams(input: string | URL, rawConfig?: DeepLinkConfigInput): string {
  const config = resolveDeepLinkConfig(rawConfig);
  const url = coerceUrl(input);
  url.searchParams.delete(config.promptParam);
  url.searchParams.delete(config.shortcutParam);
  url.searchParams.delete(config.guideParam);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}
