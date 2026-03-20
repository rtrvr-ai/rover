import { getDomain, parse as parseDomain } from 'tldts';

export type DomainScopeMode = 'host_only' | 'registrable_domain';

function stripIpv6Brackets(host: string): string {
  const trimmed = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLikelyBareIpv6Host(input: string): boolean {
  const value = String(input || '').trim().toLowerCase();
  if (!value || value.includes('://') || value.startsWith('//')) return false;
  const hostPortless = value.split(/[/?#]/)[0]?.trim() || '';
  if (!hostPortless || hostPortless.startsWith('[')) return false;
  const colonCount = (hostPortless.match(/:/g) || []).length;
  return colonCount >= 2;
}

function toUrlCandidate(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (isLikelyBareIpv6Host(trimmed)) return `https://[${trimmed}]`;
  return `https://${trimmed}`;
}

function parseHostCandidate(input: string): string {
  const candidate = toUrlCandidate(input);
  if (!candidate) return '';
  try {
    return stripIpv6Brackets(new URL(candidate).hostname);
  } catch {
    return '';
  }
}

function isValidIpv4Host(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return host.split('.').every(part => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isValidIpv6Host(host: string): boolean {
  if (!host.includes(':')) return false;
  try {
    return stripIpv6Brackets(new URL(`https://[${host}]`).hostname) === host;
  } catch {
    return false;
  }
}

function isIpHost(host: string): boolean {
  const normalized = stripIpv6Brackets(host);
  return parseDomain(normalized).isIp === true || isValidIpv4Host(normalized) || isValidIpv6Host(normalized);
}

export function isIpHostToken(host: string): boolean {
  const normalized = normalizeHostToken(host);
  return !!normalized && isIpHost(normalized);
}

export function normalizeHostToken(input: string): string {
  return parseHostCandidate(String(input || '').trim().toLowerCase());
}

export function normalizeDomainPatternToken(pattern: string): string {
  const raw = String(pattern || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === '*') return '*';
  const exact = raw.startsWith('=');
  const wildcard = !exact && raw.startsWith('*.');
  const core = exact ? raw.slice(1) : (wildcard ? raw.slice(2) : raw);
  const host = normalizeHostToken(core);
  if (!host) return '';
  if (exact) return `=${host}`;
  if (wildcard) return `*.${host}`;
  return host;
}

export function normalizeScopeAwareDomainPattern(
  pattern: string,
  scopeMode: DomainScopeMode,
): string {
  if (!pattern) return '';
  if (scopeMode !== 'host_only') return pattern;
  if (pattern === '*' || pattern.startsWith('=') || pattern.startsWith('*.')) return pattern;
  return `=${pattern}`;
}

export function deriveRegistrableDomain(host: string): string {
  const clean = normalizeHostToken(host);
  if (!clean) return '';
  if (clean === 'localhost' || isIpHost(clean)) return clean;
  return getDomain(clean, { allowPrivateDomains: true }) || clean;
}

export function inferDefaultAllowedDomain(host: string, scopeMode: DomainScopeMode): string {
  const clean = normalizeHostToken(host);
  if (!clean) return '';
  if (clean === 'localhost' || isIpHost(clean)) return `=${clean}`;
  if (scopeMode === 'host_only') return `=${clean}`;
  return deriveRegistrableDomain(clean);
}

export function normalizeAllowedDomains(
  input: string | string[] | undefined,
  currentHost: string,
  scopeMode: DomainScopeMode,
): string[] {
  const candidates = Array.isArray(input) ? input : typeof input === 'string' && input.trim() ? [input] : [];
  const out = new Set<string>();

  for (const raw of candidates) {
    const cleaned = normalizeScopeAwareDomainPattern(
      normalizeDomainPatternToken(String(raw || '')),
      scopeMode,
    );
    if (cleaned) out.add(cleaned);
  }

  if (!out.size) {
    const inferred = inferDefaultAllowedDomain(currentHost, scopeMode);
    if (inferred) out.add(inferred);
  }

  return Array.from(out);
}

export function matchesDomainPattern(host: string, pattern: string): boolean {
  const normalizedHost = normalizeHostToken(host);
  const clean = normalizeDomainPatternToken(pattern);
  if (!normalizedHost || !clean) return false;
  if (clean === '*') return true;
  if (clean.startsWith('=')) {
    const exact = clean.slice(1);
    return !!exact && normalizedHost === exact;
  }
  if (clean.startsWith('*.')) {
    const base = clean.slice(2);
    if (!base || normalizedHost === base) return false;
    return normalizedHost.endsWith(`.${base}`);
  }
  if (normalizedHost === clean) return true;
  return normalizedHost.endsWith(`.${clean}`);
}

export function extractHostname(url: string): string | null {
  const host = normalizeHostToken(url);
  return host || null;
}

export function isUrlAllowedByDomains(url: string, allowedDomains: string[]): boolean {
  const host = extractHostname(url);
  if (!host) return false;
  if (!allowedDomains.length) return true;
  return allowedDomains.some(pattern => matchesDomainPattern(host, pattern));
}

export function isHostInNavigationScope(params: {
  host?: string;
  currentHost?: string;
  allowedDomains?: string[];
  domainScopeMode?: DomainScopeMode;
}): boolean {
  const host = normalizeHostToken(params.host || '');
  if (!host) return false;
  const scopeMode = params.domainScopeMode === 'host_only' ? 'host_only' : 'registrable_domain';
  const allowedDomains = Array.isArray(params.allowedDomains)
    ? params.allowedDomains
      .map(token => normalizeDomainPatternToken(token))
      .map(token => normalizeScopeAwareDomainPattern(token, scopeMode))
      .filter(Boolean)
    : [];
  if (allowedDomains.length > 0) {
    return allowedDomains.some(pattern => matchesDomainPattern(host, pattern));
  }
  const currentHost = normalizeHostToken(params.currentHost || '');
  if (!currentHost) return true;
  if (scopeMode === 'host_only') {
    return host === currentHost;
  }
  return deriveRegistrableDomain(host) === deriveRegistrableDomain(currentHost);
}
