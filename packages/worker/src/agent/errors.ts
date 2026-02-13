export type RoverErrorCode =
  | 'MISSING_AUTH'
  | 'MISSING_AUTH_TOKEN'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INSUFFICIENT_CREDITS'
  | 'CAPABILITY_UNAVAILABLE'
  | 'TOOL_UNSUPPORTED'
  | 'NETWORK_ERROR'
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
    return 'Provide the required auth token in tool input or rover.boot(...).';
  }
  if (code === 'MISSING_API_KEY') {
    return 'Provide apiKey in rover.boot(...) or an Authorization Bearer token.';
  }
  if (code === 'INVALID_API_KEY') {
    return 'Use a valid active rtrvr_ API key.';
  }
  return undefined;
}

export function toRoverErrorEnvelope(err: any, fallbackMessage = 'Operation failed'): RoverErrorEnvelope {
  const candidate =
    err?.roverError ||
    err?.errorDetails ||
    (typeof err?.error === 'object' ? err.error : undefined);

  if (candidate && typeof candidate === 'object' && candidate.code && candidate.message) {
    return {
      code: candidate.code,
      message: candidate.message,
      requires_api_key: !!candidate.requires_api_key,
      missing: Array.isArray(candidate.missing) ? candidate.missing : undefined,
      next_action: candidate.next_action,
      retryable: candidate.retryable,
      degraded: candidate.degraded,
      details: candidate.details,
    };
  }

  const message = String(err?.message || err?.error || fallbackMessage);
  const code = inferErrorCode(message);
  const requiresApiKey = code === 'MISSING_API_KEY' || code === 'INVALID_API_KEY';
  return {
    code,
    message,
    requires_api_key: requiresApiKey,
    missing: requiresApiKey ? ['apiKey'] : code === 'MISSING_AUTH' || code === 'MISSING_AUTH_TOKEN' ? ['authToken'] : undefined,
    next_action: defaultNextActionForCode(code),
    retryable: code === 'NETWORK_ERROR',
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
