const RECEIPT_PARAM_DEFAULT = 'rover_receipt';
const RECEIPT_ANCHOR_PARAM_DEFAULT = 'rover_anchor';

export type RoverBrowserReceiptRequest = {
  receipt: string;
  anchor?: string;
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

function readHashParams(url: URL): URLSearchParams {
  return new URLSearchParams(String(url.hash || '').replace(/^#\??/, ''));
}

export function parseBrowserReceiptRequest(input: string | URL): RoverBrowserReceiptRequest | null {
  const url = coerceUrl(input);
  const hashParams = readHashParams(url);
  const receipt = readLastNonEmptyParam(hashParams, RECEIPT_PARAM_DEFAULT);
  if (!receipt) return null;
  const anchor = readLastNonEmptyParam(hashParams, RECEIPT_ANCHOR_PARAM_DEFAULT) || undefined;
  return {
    receipt,
    anchor,
    signature: `${RECEIPT_PARAM_DEFAULT}:${receipt}`,
  };
}

export function stripBrowserReceiptParams(input: string | URL): string {
  const url = coerceUrl(input);
  const hashParams = readHashParams(url);
  const anchor = readLastNonEmptyParam(hashParams, RECEIPT_ANCHOR_PARAM_DEFAULT);
  hashParams.delete(RECEIPT_PARAM_DEFAULT);
  hashParams.delete(RECEIPT_ANCHOR_PARAM_DEFAULT);
  const remaining = hashParams.toString();
  const search = url.searchParams.toString();
  const nextHash = anchor
    ? `#${anchor}${remaining ? `&${remaining}` : ''}`
    : remaining
      ? `#${remaining}`
      : '';
  return `${url.pathname}${search ? `?${search}` : ''}${nextHash}`;
}
