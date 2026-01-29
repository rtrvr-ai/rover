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

export function deriveRegistrableDomain(host: string): string {
  const clean = String(host || '').trim().toLowerCase();
  if (!clean) return '';
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return clean;
  const parts = clean.split('.').filter(Boolean);
  if (parts.length < 2) return clean;
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (parts.length >= 3 && MULTI_LABEL_TLDS.has(tail2)) {
    return `${parts[parts.length - 3]}.${tail2}`;
  }
  return tail2;
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

function normalizeScopeAwareDomainPattern(
  pattern: string,
  scopeMode?: 'host_only' | 'registrable_domain',
): string {
  if (!pattern) return '';
  if (scopeMode !== 'host_only') return pattern;
  if (pattern === '*' || pattern.startsWith('=') || pattern.startsWith('*.')) return pattern;
  return `=${pattern}`;
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

export function isHostInNavigationScope(params: {
  host?: string;
  currentHost?: string;
  allowedDomains?: string[];
  domainScopeMode?: 'host_only' | 'registrable_domain';
}): boolean {
  const host = normalizeHostToken(params.host || '');
  if (!host) return false;
  const allowedDomains = Array.isArray(params.allowedDomains)
    ? params.allowedDomains
      .map(token => normalizeDomainPatternToken(token))
      .map(token => normalizeScopeAwareDomainPattern(token, params.domainScopeMode))
      .filter(Boolean)
    : [];
  if (allowedDomains.length > 0) {
    return allowedDomains.some(pattern => matchesDomainPattern(host, pattern));
  }
  const currentHost = normalizeHostToken(params.currentHost || '');
  if (!currentHost) return true;
  if (params.domainScopeMode === 'host_only') {
    return host === currentHost;
  }
  return deriveRegistrableDomain(host) === deriveRegistrableDomain(currentHost);
}
