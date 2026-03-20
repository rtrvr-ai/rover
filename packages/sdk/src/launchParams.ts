const ROVER_LAUNCH_PARAM_DEFAULT = 'rover_launch';
const ROVER_ATTACH_PARAM_DEFAULT = 'rover_attach';

export type RoverLaunchRequest = {
  requestId: string;
  attachToken: string;
  signature: string;
};

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

export function parseLaunchRequest(input: string | URL): RoverLaunchRequest | null {
  const url = coerceUrl(input);
  const requestId = readLastNonEmptyParam(url.searchParams, ROVER_LAUNCH_PARAM_DEFAULT);
  const attachToken = readLastNonEmptyParam(url.searchParams, ROVER_ATTACH_PARAM_DEFAULT);
  if (!requestId || !attachToken) return null;
  return {
    requestId,
    attachToken,
    signature: `${ROVER_LAUNCH_PARAM_DEFAULT}:${requestId}:${attachToken}`,
  };
}

export function stripLaunchParams(input: string | URL): string {
  const url = coerceUrl(input);
  url.searchParams.delete(ROVER_LAUNCH_PARAM_DEFAULT);
  url.searchParams.delete(ROVER_ATTACH_PARAM_DEFAULT);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}
