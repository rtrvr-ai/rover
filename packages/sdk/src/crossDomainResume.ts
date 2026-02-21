/**
 * Cross-domain resume via registrable-domain-scoped cookies.
 *
 * When Rover navigates from one subdomain to another (e.g. rtrvr.ai → rover.rtrvr.ai),
 * all per-origin storage (sessionStorage, localStorage, IndexedDB) is inaccessible on
 * the new origin. This module bridges the gap by writing a small resume token as a
 * cookie scoped to the registrable domain (e.g. .rtrvr.ai) so the new page can pick up
 * the in-flight task.
 */

const COOKIE_PREFIX = 'rover_xdr_';
const MAX_COOKIE_AGE_S = 120; // 2 minutes — cookie is short-lived
const MULTI_LABEL_TLDS = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'com.br',
  'com.mx',
  'com.sg',
  'co.in',
]);

export interface CrossDomainResumeData {
  sessionId: string;
  sessionToken?: string;
  sessionTokenExpiresAt?: number;
  targetUrl?: string;
  sourceHost?: string;
  handoffId?: string;
  pendingRun?: {
    id: string;
    text: string;
    startedAt: number;
    attempts: number;
    taskBoundaryId?: string;
  };
  activeTask?: {
    taskId: string;
    status: string;
  };
  handoff?: {
    handoffId: string;
    sourceLogicalTabId?: number;
    runId?: string;
    targetUrl: string;
    createdAt: number;
  };
  taskEpoch?: number;
  timestamp: number;
}

/**
 * Extract the registrable domain from a hostname.
 * e.g. "rover.rtrvr.ai" → "rtrvr.ai", "app.foo.co.uk" → "co.uk" (simplified).
 */
function getRegistrableDomain(hostname: string): string {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return '';
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return host;
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (parts.length >= 3 && MULTI_LABEL_TLDS.has(tail2)) {
    return `${parts[parts.length - 3]}.${tail2}`;
  }
  return tail2;
}

function cookieName(siteId: string): string {
  // Use a short hash-like suffix to avoid collisions for multi-site embeds
  return `${COOKIE_PREFIX}${siteId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
}

function normalizeUrlForMatch(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.href);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return raw;
  }
}

function normalizePathname(pathname: string): string {
  const value = String(pathname || '').trim();
  if (!value || value === '/') return '/';
  return value.replace(/\/+$/, '') || '/';
}

function hasQuerySubset(target: URLSearchParams, current: URLSearchParams): boolean {
  const targetKeys = new Set<string>();
  for (const [key] of target.entries()) targetKeys.add(key);
  for (const key of targetKeys) {
    const expectedValues = target.getAll(key);
    if (!expectedValues.length) continue;
    const actualValues = current.getAll(key);
    if (!actualValues.length) return false;
    const counts = new Map<string, number>();
    for (const value of actualValues) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    for (const expected of expectedValues) {
      const available = counts.get(expected) || 0;
      if (available <= 0) return false;
      counts.set(expected, available - 1);
    }
  }
  return true;
}

function matchesTargetUrl(targetUrl: string, currentUrl: string): boolean {
  const normalizedTarget = normalizeUrlForMatch(targetUrl);
  const normalizedCurrent = normalizeUrlForMatch(currentUrl);
  if (!normalizedTarget || !normalizedCurrent) return false;
  try {
    const target = new URL(normalizedTarget, window.location.href);
    const current = new URL(normalizedCurrent, window.location.href);
    if (target.origin.toLowerCase() !== current.origin.toLowerCase()) return false;
    if (normalizePathname(target.pathname) !== normalizePathname(current.pathname)) return false;
    return hasQuerySubset(target.searchParams, current.searchParams);
  } catch {
    return normalizedTarget === normalizedCurrent;
  }
}

export function writeCrossDomainResumeCookie(
  siteId: string,
  data: CrossDomainResumeData,
): void {
  try {
    const name = cookieName(siteId);
    const domain = getRegistrableDomain(window.location.hostname);
    const value = encodeURIComponent(JSON.stringify(data));
    // Set cookie on the registrable domain so all subdomains can read it
    const isSecure = window.location.protocol === 'https:';
    const parts = [
      `${name}=${value}`,
      'path=/',
      `max-age=${MAX_COOKIE_AGE_S}`,
      'SameSite=Lax',
    ];
    if (domain && domain !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(domain)) {
      parts.push(`domain=.${domain}`);
    }
    if (isSecure) parts.push('Secure');
    document.cookie = parts.join('; ');
  } catch {
    // Ignore cookie write failures
  }
}

export function readCrossDomainResumeCookie(
  siteId: string,
  options?: {
    currentUrl?: string;
    currentHost?: string;
    expectedHandoffId?: string;
    requireTargetMatch?: boolean;
    maxAgeMs?: number;
  },
): CrossDomainResumeData | null {
  try {
    const name = cookieName(siteId);
    const cookies = document.cookie.split(';');
    const maxAgeMs = Math.max(1_000, Number(options?.maxAgeMs) || MAX_COOKIE_AGE_S * 1000);
    const currentUrl = normalizeUrlForMatch(options?.currentUrl || window.location.href);
    const currentHost = String(options?.currentHost || window.location.hostname || '').trim().toLowerCase();
    const expectedHandoffId = String(options?.expectedHandoffId || '').trim();
    const requireTargetMatch = options?.requireTargetMatch !== false;

    for (const cookie of cookies) {
      const [key, ...rest] = cookie.trim().split('=');
      if (key === name) {
        const value = rest.join('=');
        const data = JSON.parse(decodeURIComponent(value)) as CrossDomainResumeData;
        // Only use if reasonably recent
        if (!data.timestamp || Date.now() - data.timestamp >= maxAgeMs) {
          continue;
        }

        const handoffId = String(data.handoffId || data.handoff?.handoffId || '').trim();
        if (!handoffId) {
          continue;
        }
        if (expectedHandoffId && handoffId !== expectedHandoffId) {
          continue;
        }

        if (requireTargetMatch) {
          const targetUrl = normalizeUrlForMatch(data.targetUrl || data.handoff?.targetUrl || '');
          if (!targetUrl || !currentUrl || !matchesTargetUrl(targetUrl, currentUrl)) {
            continue;
          }
        }

        if (data.sourceHost) {
          const sourceHost = String(data.sourceHost || '').trim().toLowerCase();
          if (sourceHost && currentHost && sourceHost === currentHost) {
            continue;
          }
        }

        if (data.sessionId && typeof data.sessionId === 'string') {
          return data;
        }
      }
    }
  } catch {
    // Ignore parse failures
  }
  return null;
}

export function clearCrossDomainResumeCookie(siteId: string): void {
  try {
    const name = cookieName(siteId);
    const domain = getRegistrableDomain(window.location.hostname);
    const isSecure = window.location.protocol === 'https:';
    const parts = [
      `${name}=`,
      'path=/',
      'max-age=0',
      'SameSite=Lax',
    ];
    if (domain && domain !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(domain)) {
      parts.push(`domain=.${domain}`);
    }
    if (isSecure) parts.push('Secure');
    document.cookie = parts.join('; ');
  } catch {
    // Ignore
  }
}
