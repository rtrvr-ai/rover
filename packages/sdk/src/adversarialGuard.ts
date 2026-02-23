/**
 * Client-side adversarial detection guard.
 *
 * Ports server-side adversarial scoring patterns to the client.
 * Checks URLs before sending tab events. Blocks at score >= 3.
 */

const ADVERSARIAL_THRESHOLD = 3;

/** Known phishing/credential-harvesting patterns. */
const SUSPICIOUS_PATH_PATTERNS = [
  /\/login/i,
  /\/signin/i,
  /\/auth/i,
  /\/oauth/i,
  /\/password/i,
  /\/reset/i,
  /\/verify/i,
  /\/confirm/i,
  /\/account/i,
  /\/security/i,
  /\/2fa/i,
  /\/mfa/i,
];

/** Known data-exfiltration patterns in URLs. */
const EXFILTRATION_PATTERNS = [
  /data:/i,
  /javascript:/i,
  /vbscript:/i,
  /blob:/i,
];

/** Suspicious query parameter patterns. */
const SUSPICIOUS_PARAMS = [
  /token/i,
  /secret/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /access_token/i,
  /refresh_token/i,
  /session/i,
  /cookie/i,
  /credential/i,
];

/** IP address patterns (accessing raw IPs is suspicious). */
const IP_HOST_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Excessive subdomain depth (potential DNS exfiltration). */
const MAX_SAFE_SUBDOMAIN_DEPTH = 4;

export type AdversarialResult = {
  score: number;
  blocked: boolean;
  reasons: string[];
};

/**
 * Compute adversarial score for a target URL.
 * Score >= 3 means the request should be blocked.
 */
export function computeAdversarialScore(targetUrl: string, currentHost: string): AdversarialResult {
  let score = 0;
  const reasons: string[] = [];

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { score: 1, blocked: false, reasons: ['invalid_url'] };
  }

  // Check for data/javascript/blob URIs
  for (const pattern of EXFILTRATION_PATTERNS) {
    if (pattern.test(targetUrl)) {
      score += 3;
      reasons.push('exfiltration_scheme');
      break;
    }
  }

  // Check for IP address hosts
  if (IP_HOST_PATTERN.test(parsed.hostname)) {
    score += 2;
    reasons.push('ip_address_host');
  }

  // Check for excessive subdomain depth
  const subdomainParts = parsed.hostname.split('.');
  if (subdomainParts.length > MAX_SAFE_SUBDOMAIN_DEPTH) {
    score += 1;
    reasons.push('excessive_subdomains');
  }

  // Check for suspicious paths (credential harvesting)
  const suspiciousPathCount = SUSPICIOUS_PATH_PATTERNS.filter(p => p.test(parsed.pathname)).length;
  if (suspiciousPathCount >= 2) {
    score += 2;
    reasons.push('multiple_credential_paths');
  } else if (suspiciousPathCount === 1) {
    score += 1;
    reasons.push('credential_path');
  }

  // Check for sensitive data in query params
  const paramKeys = Array.from(parsed.searchParams.keys());
  const suspiciousParamCount = paramKeys.filter(key =>
    SUSPICIOUS_PARAMS.some(p => p.test(key)),
  ).length;
  if (suspiciousParamCount > 0) {
    score += Math.min(2, suspiciousParamCount);
    reasons.push('sensitive_query_params');
  }

  // Check for very long URLs (potential data exfiltration)
  if (targetUrl.length > 2000) {
    score += 1;
    reasons.push('excessive_url_length');
  }

  // Check for encoded payloads in URL
  const encodedChunks = (targetUrl.match(/%[0-9A-Fa-f]{2}/g) || []).length;
  if (encodedChunks > 20) {
    score += 1;
    reasons.push('excessive_encoding');
  }

  // Non-standard ports
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    score += 1;
    reasons.push('non_standard_port');
  }

  return {
    score,
    blocked: score >= ADVERSARIAL_THRESHOLD,
    reasons,
  };
}

/**
 * Quick check: should this URL be blocked before sending a tab event?
 */
export function shouldBlockNavigation(targetUrl: string, currentHost: string): boolean {
  return computeAdversarialScore(targetUrl, currentHost).blocked;
}
