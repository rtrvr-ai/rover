import { SystemToolNames } from '@rover/shared/lib/system-tools/tools.js';

import { isUrlAllowedByDomains } from './navigationScope.js';

type ExternalNavigationPolicy = 'open_new_tab_notice' | 'block' | 'allow';

export const NON_ACTION_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.describe_images,
  SystemToolNames.wait_action,
  SystemToolNames.wait_for_element,
  SystemToolNames.answer_task,
  SystemToolNames.solve_captcha,
  SystemToolNames.network_run_recipe,
]);

export const SCOPE_SAFE_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.goto_url,
  SystemToolNames.google_search,
  SystemToolNames.go_back,
  SystemToolNames.go_forward,
  SystemToolNames.refresh_page,
  SystemToolNames.open_new_tab,
  SystemToolNames.switch_tab,
  SystemToolNames.close_tab,
]);

function normalizeScopeToolName(name: string | undefined): string {
  if (name === 'open_url_new_tab') return SystemToolNames.open_new_tab;
  return String(name || '').trim();
}

function normalizeExternalNavigationPolicy(policy?: ExternalNavigationPolicy): ExternalNavigationPolicy {
  if (policy === 'allow' || policy === 'block' || policy === 'open_new_tab_notice') {
    return policy;
  }
  return 'open_new_tab_notice';
}

export function shouldBlockToolForOutOfScopeContext(params: {
  toolName: SystemToolNames | string;
  currentUrl: string;
  allowedDomains: string[];
  externalNavigationPolicy?: ExternalNavigationPolicy;
}): boolean {
  const toolName = normalizeScopeToolName(String(params.toolName || '')) as SystemToolNames;
  if (!toolName) return false;
  if (normalizeExternalNavigationPolicy(params.externalNavigationPolicy) === 'allow') return false;
  if (NON_ACTION_TOOLS.has(toolName) || SCOPE_SAFE_TOOLS.has(toolName)) return false;
  return !isUrlAllowedByDomains(params.currentUrl, params.allowedDomains);
}
