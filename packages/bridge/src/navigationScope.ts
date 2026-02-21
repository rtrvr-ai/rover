export type DomainScopeMode = 'host_only' | 'registrable_domain';

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

export function normalizeAllowedDomains(
  input: string | string[] | undefined,
  currentHost: string,
  scopeMode: DomainScopeMode,
): string[] {
  const candidates = Array.isArray(input) ? input : typeof input === 'string' && input.trim() ? [input] : [];
  const out = new Set<string>();

  for (const raw of candidates) {
    const cleaned = normalizeDomainPatternToken(String(raw || ''));
    if (cleaned) out.add(cleaned);
  }

  if (!out.size) {
    const inferred = inferDefaultAllowedDomain(currentHost, scopeMode);
    if (inferred) out.add(inferred);
  }

  return Array.from(out);
}

export function normalizeHostToken(input: string): string {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    if (raw.includes('://')) {
      return new URL(raw).hostname.toLowerCase();
    }
    if (raw.startsWith('//')) {
      return new URL(`https:${raw}`).hostname.toLowerCase();
    }
  } catch {
    // Fall through to manual normalization.
  }
  return raw
    .replace(/:\d+$/, '')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
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

export function inferDefaultAllowedDomain(host: string, scopeMode: DomainScopeMode): string {
  const clean = String(host || '').trim().toLowerCase();
  if (!clean) return '';
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return `=${clean}`;
  if (scopeMode === 'host_only') return `=${clean}`;
  const parts = clean.split('.').filter(Boolean);
  if (parts.length < 2) return clean;
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (parts.length >= 3 && MULTI_LABEL_TLDS.has(tail2)) {
    return `${parts[parts.length - 3]}.${tail2}`;
  }
  return tail2;
}

export function isUrlAllowedByDomains(url: string, allowedDomains: string[]): boolean {
  const host = extractHostname(url);
  if (!host) return false;
  if (!allowedDomains.length) return true;

  for (const pattern of allowedDomains) {
    if (matchesDomainPattern(host, pattern)) return true;
  }

  return false;
}

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function matchesDomainPattern(host: string, pattern: string): boolean {
  const clean = normalizeDomainPatternToken(pattern);
  if (!clean) return false;
  if (clean === '*') return true;
  if (clean.startsWith('=')) {
    const exact = clean.slice(1);
    return !!exact && host === exact;
  }
  if (clean.startsWith('*.')) {
    const base = clean.slice(2);
    if (!base) return false;
    return host === base || host.endsWith(`.${base}`);
  }
  if (host === clean) return true;
  return host.endsWith(`.${clean}`);
}
