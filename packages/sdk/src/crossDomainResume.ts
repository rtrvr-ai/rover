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

export interface CrossDomainResumeData {
  sessionId: string;
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
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) return hostname;
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function cookieName(siteId: string): string {
  // Use a short hash-like suffix to avoid collisions for multi-site embeds
  return `${COOKIE_PREFIX}${siteId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
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
      `domain=.${domain}`,
      `max-age=${MAX_COOKIE_AGE_S}`,
      'SameSite=Lax',
    ];
    if (isSecure) parts.push('Secure');
    document.cookie = parts.join('; ');
  } catch {
    // Ignore cookie write failures
  }
}

export function readCrossDomainResumeCookie(siteId: string): CrossDomainResumeData | null {
  try {
    const name = cookieName(siteId);
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [key, ...rest] = cookie.trim().split('=');
      if (key === name) {
        const value = rest.join('=');
        const data = JSON.parse(decodeURIComponent(value)) as CrossDomainResumeData;
        // Only use if reasonably recent
        if (data.timestamp && Date.now() - data.timestamp < MAX_COOKIE_AGE_S * 1000) {
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
      `domain=.${domain}`,
      'max-age=0',
      'SameSite=Lax',
    ];
    if (isSecure) parts.push('Secure');
    document.cookie = parts.join('; ');
  } catch {
    // Ignore
  }
}
