const DEEP_LINK_PROMPT_PARAM_DEFAULT = 'rover';
const DEEP_LINK_SHORTCUT_PARAM_DEFAULT = 'rover_shortcut';
const DEEP_LINK_PARAM_NAME_MAX_CHARS = 64;

export type DeepLinkConfigInput = {
  enabled?: boolean;
  promptParam?: string;
  shortcutParam?: string;
  consume?: boolean;
} | null | undefined;

export type ResolvedDeepLinkConfig = {
  enabled: boolean;
  promptParam: string;
  shortcutParam: string;
  consume: boolean;
};

export type RoverDeepLinkRequest =
  | {
      kind: 'prompt';
      paramName: string;
      value: string;
      signature: string;
    }
  | {
      kind: 'shortcut';
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

export function resolveDeepLinkConfig(raw?: DeepLinkConfigInput): ResolvedDeepLinkConfig {
  let promptParam = normalizeParamName(raw?.promptParam, DEEP_LINK_PROMPT_PARAM_DEFAULT);
  let shortcutParam = normalizeParamName(raw?.shortcutParam, DEEP_LINK_SHORTCUT_PARAM_DEFAULT);
  if (shortcutParam === promptParam) {
    shortcutParam = shortcutParam === DEEP_LINK_SHORTCUT_PARAM_DEFAULT
      ? `${DEEP_LINK_SHORTCUT_PARAM_DEFAULT}_id`
      : DEEP_LINK_SHORTCUT_PARAM_DEFAULT;
    if (shortcutParam === promptParam) {
      promptParam = DEEP_LINK_PROMPT_PARAM_DEFAULT;
    }
  }
  return {
    enabled: raw?.enabled === true,
    promptParam,
    shortcutParam,
    consume: raw?.consume !== false,
  };
}

export function parseDeepLinkRequest(
  input: string | URL,
  rawConfig?: DeepLinkConfigInput,
): RoverDeepLinkRequest | null {
  const config = resolveDeepLinkConfig(rawConfig);
  const url = coerceUrl(input);
  const shortcutValue = readLastNonEmptyParam(url.searchParams, config.shortcutParam);
  if (shortcutValue) {
    return {
      kind: 'shortcut',
      paramName: config.shortcutParam,
      value: shortcutValue,
      signature: `shortcut:${config.shortcutParam}:${shortcutValue}`,
    };
  }
  const promptValue = readLastNonEmptyParam(url.searchParams, config.promptParam);
  if (promptValue) {
    return {
      kind: 'prompt',
      paramName: config.promptParam,
      value: promptValue,
      signature: `prompt:${config.promptParam}:${promptValue}`,
    };
  }
  return null;
}

export function stripDeepLinkParams(input: string | URL, rawConfig?: DeepLinkConfigInput): string {
  const config = resolveDeepLinkConfig(rawConfig);
  const url = coerceUrl(input);
  url.searchParams.delete(config.promptParam);
  url.searchParams.delete(config.shortcutParam);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}
