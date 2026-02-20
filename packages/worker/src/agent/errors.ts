export type RoverErrorCode =
  | 'MISSING_AUTH'
  | 'MISSING_AUTH_TOKEN'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'STALE_SEQ'
  | 'STALE_EPOCH'
  | 'SESSION_TOKEN_EXPIRED'
  | 'SESSION_TOKEN_INVALID'
  | 'BOOTSTRAP_REQUIRED'
  | 'NAVIGATION_HANDOFF_PENDING'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INSUFFICIENT_CREDITS'
  | 'CAPABILITY_UNAVAILABLE'
  | 'TOOL_UNSUPPORTED'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR';

export type RoverErrorEnvelope = {
  code: RoverErrorCode;
  message: string;
  requires_api_key?: boolean;
  missing?: string[];
  next_action?: string;
  retryable?: boolean;
  degraded?: boolean;
  details?: any;
};

type ErrorWithRoverEnvelope = Error & { roverError?: RoverErrorEnvelope };

function inferErrorCode(message: string): RoverErrorCode {
  const text = String(message || '').toLowerCase();
  if (text.includes('stale_seq') || text.includes('stale seq')) return 'STALE_SEQ';
  if (text.includes('stale_epoch') || text.includes('stale epoch')) return 'STALE_EPOCH';
  if (text.includes('session token') && text.includes('expired')) return 'SESSION_TOKEN_EXPIRED';
  if (text.includes('session token') && text.includes('invalid')) return 'SESSION_TOKEN_INVALID';
  if (text.includes('bootstrap') && text.includes('required')) return 'BOOTSTRAP_REQUIRED';
  if (text.includes('navigation handoff')) return 'NAVIGATION_HANDOFF_PENDING';
  if ((text.includes('auth token') || text.includes('authentication token')) && (text.includes('missing') || text.includes('required'))) {
    return 'MISSING_AUTH_TOKEN';
  }
  if (text.includes('missing auth') || text.includes('requires auth') || text.includes('requires authentication')) return 'MISSING_AUTH';
  if (text.includes('api key') && (text.includes('missing') || text.includes('required'))) return 'MISSING_API_KEY';
  if (text.includes('invalid') && text.includes('api key')) return 'INVALID_API_KEY';
  if (text.includes('unauthenticated') || text.includes('authentication')) return 'UNAUTHENTICATED';
  if (text.includes('permission')) return 'PERMISSION_DENIED';
  if (text.includes('insufficient credits') || text.includes('credits')) return 'INSUFFICIENT_CREDITS';
  if (text.includes('not supported') || text.includes('unsupported')) return 'TOOL_UNSUPPORTED';
  if (text.includes('network') || text.includes('fetch')) return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
}

function defaultNextActionForCode(code: RoverErrorCode): string | undefined {
  if (code === 'MISSING_AUTH' || code === 'MISSING_AUTH_TOKEN') {
    return 'Provide a valid rvrsess_* sessionToken from /v1/rover/session/start in rover.boot(...).';
  }
  if (code === 'MISSING_API_KEY') {
    return 'Use a Rover session token (rvrsess_*) from /v1/rover/session/start.';
  }
  if (code === 'INVALID_API_KEY') {
    return 'Use a valid active Rover session token or rotate your site public key.';
  }
  if (code === 'STALE_SEQ') {
    return 'Sync session projection and retry with latest seq.';
  }
  if (code === 'STALE_EPOCH') {
    return 'Refresh session token/projection and retry with latest epoch.';
  }
  if (code === 'SESSION_TOKEN_EXPIRED') {
    return 'Refresh session via /v1/rover/session/start using bootstrap public key (pk_site_*), then retry.';
  }
  if (code === 'SESSION_TOKEN_INVALID') {
    return 'Initialize a fresh session token via /v1/rover/session/start and retry.';
  }
  if (code === 'BOOTSTRAP_REQUIRED') {
    return 'Provide a valid pk_site_* key in bootstrapToken/publicKey and retry session start.';
  }
  if (code === 'NAVIGATION_HANDOFF_PENDING') {
    return 'Wait for post-navigation hydration/projection sync and retry.';
  }
  return undefined;
}

export function toRoverErrorEnvelope(err: any, fallbackMessage = 'Operation failed'): RoverErrorEnvelope {
  const rawErrorCode = String(err?.error || '').trim().toLowerCase();
  if (
    rawErrorCode === 'stale_seq'
    || rawErrorCode === 'stale_epoch'
    || rawErrorCode === 'session_token_expired'
    || rawErrorCode === 'session_token_invalid'
    || rawErrorCode === 'bootstrap_required'
  ) {
    const code: RoverErrorCode =
      rawErrorCode === 'stale_epoch' ? 'STALE_EPOCH'
      : rawErrorCode === 'session_token_expired' ? 'SESSION_TOKEN_EXPIRED'
      : rawErrorCode === 'session_token_invalid' ? 'SESSION_TOKEN_INVALID'
      : rawErrorCode === 'bootstrap_required' ? 'BOOTSTRAP_REQUIRED'
      : 'STALE_SEQ';
    const data = err?.data && typeof err.data === 'object' ? err.data : {};
    const message =
      typeof data?.reason === 'string'
        ? data.reason
        : rawErrorCode === 'stale_epoch'
          ? 'Session epoch is stale.'
          : rawErrorCode === 'session_token_expired'
            ? 'Session token expired.'
            : rawErrorCode === 'session_token_invalid'
              ? 'Session token invalid.'
              : rawErrorCode === 'bootstrap_required'
                ? 'Bootstrap token required.'
          : 'Run sequence is stale.';
    return {
      code,
      message,
      next_action: defaultNextActionForCode(code),
      retryable: code === 'STALE_SEQ' || code === 'STALE_EPOCH' || code === 'SESSION_TOKEN_EXPIRED',
      details: err,
    };
  }

  const directCandidate =
    err && typeof err === 'object' && typeof err.code === 'string' && typeof err.message === 'string'
      ? err
      : undefined;
  const candidate =
    err?.roverError ||
    err?.errorDetails ||
    (typeof err?.error === 'object' ? err.error : undefined) ||
    directCandidate;

  if (candidate && typeof candidate === 'object' && candidate.code && candidate.message) {
    const candidateCodeRaw = String(candidate.code || '').trim();
    const normalizedCandidateCode =
      candidateCodeRaw === 'stale_seq' ? 'STALE_SEQ'
      : candidateCodeRaw === 'stale_epoch' ? 'STALE_EPOCH'
      : candidateCodeRaw === 'session_token_expired' ? 'SESSION_TOKEN_EXPIRED'
      : candidateCodeRaw === 'session_token_invalid' ? 'SESSION_TOKEN_INVALID'
      : candidateCodeRaw === 'bootstrap_required' ? 'BOOTSTRAP_REQUIRED'
      : candidateCodeRaw === 'navigation_handoff_pending' ? 'NAVIGATION_HANDOFF_PENDING'
      : candidateCodeRaw;
    const normalizedCode = (normalizedCandidateCode as RoverErrorCode);
    const retryable =
      typeof candidate.retryable === 'boolean'
        ? candidate.retryable
        : (
          normalizedCode === 'STALE_SEQ'
          || normalizedCode === 'STALE_EPOCH'
          || normalizedCode === 'SESSION_TOKEN_EXPIRED'
          || normalizedCode === 'NAVIGATION_HANDOFF_PENDING'
        );
    return {
      code: normalizedCode,
      message: candidate.message,
      requires_api_key: !!candidate.requires_api_key,
      missing: Array.isArray(candidate.missing) ? candidate.missing : undefined,
      next_action: candidate.next_action || defaultNextActionForCode(normalizedCode),
      retryable,
      degraded: candidate.degraded,
      details: candidate.details,
    };
  }

  // Handle plain string errors — preserve the original message for proper code inference
  if (typeof err === 'string') {
    const message = err || fallbackMessage;
    const code = inferErrorCode(message);
    return {
      code,
      message,
      requires_api_key: code === 'MISSING_API_KEY' || code === 'INVALID_API_KEY',
      missing: code === 'MISSING_AUTH' || code === 'MISSING_AUTH_TOKEN' ? ['authToken'] : undefined,
      next_action: defaultNextActionForCode(code),
      retryable:
        code === 'NETWORK_ERROR'
        || code === 'STALE_SEQ'
        || code === 'STALE_EPOCH'
        || code === 'SESSION_TOKEN_EXPIRED'
        || code === 'NAVIGATION_HANDOFF_PENDING',
    };
  }

  const message = String(err?.message || err?.error || fallbackMessage);
  const code = inferErrorCode(message);
  const requiresApiKey = code === 'MISSING_API_KEY' || code === 'INVALID_API_KEY';
  return {
    code,
    message,
    requires_api_key: requiresApiKey,
    missing: requiresApiKey ? ['publicKey'] : code === 'MISSING_AUTH' || code === 'MISSING_AUTH_TOKEN' ? ['authToken'] : undefined,
    next_action: defaultNextActionForCode(code),
    retryable:
      code === 'NETWORK_ERROR'
      || code === 'STALE_SEQ'
      || code === 'STALE_EPOCH'
      || code === 'SESSION_TOKEN_EXPIRED'
      || code === 'NAVIGATION_HANDOFF_PENDING',
    details: err,
  };
}

export function createRoverError(envelope: RoverErrorEnvelope): ErrorWithRoverEnvelope {
  const error = new Error(envelope.message) as ErrorWithRoverEnvelope;
  error.roverError = envelope;
  return error;
}

export function isApiKeyRequiredError(err: any): boolean {
  const envelope = toRoverErrorEnvelope(err);
  return !!envelope.requires_api_key || envelope.code === 'MISSING_API_KEY' || envelope.code === 'INVALID_API_KEY';
}
