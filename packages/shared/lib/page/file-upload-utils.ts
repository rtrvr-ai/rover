import { sleepBgSafe } from './time-utils.js';

export const UPLOAD_FILE_FETCH_TIMEOUT_MS = 30_000;

export type UploadFilePayload = {
  kind: 'upload_file';
  inlineB64?: string;
  token?: string;
  byteLength: number;
  mimeType: string;
  fileName?: string;
  durable?: boolean;
};

export function safeBasename(name: string): string {
  const s = String(name ?? '').replace(/\\/g, '/');
  const base = s.split('/').pop() || 'upload';
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'upload';
}

export class FetchFileError extends Error {
  url: string;
  status?: number;
  statusText?: string;
  bodySnippet?: string;

  constructor(message: string, opts: { url: string; status?: number; statusText?: string; bodySnippet?: string }) {
    super(message);
    this.name = 'FetchFileError';
    this.url = opts.url;
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.bodySnippet = opts.bodySnippet;
  }
}

export function parseContentType(ct: string | null): string {
  if (!ct) return 'application/octet-stream';
  return ct.split(';')[0].trim() || 'application/octet-stream';
}

export function parseContentDispositionFilename(cd: string | null): string | undefined {
  if (!cd) return undefined;
  const mStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (mStar?.[1]) {
    try {
      return decodeURIComponent(mStar[1].trim().replace(/^\"(.*)\"$/, '$1'));
    } catch {
      // ignore
    }
  }
  const m = /filename\s*=\s*(\"?)([^\";]+)\1/i.exec(cd);
  if (m?.[2]) return m[2].trim();
  return undefined;
}

export function extractFirebaseFileName(fileUrl: string, win?: Window): string | undefined {
  try {
    const winEl = win ?? window;
    const URLClass = ((winEl as any).URL || URL) as typeof URL;
    const url = new URLClass(fileUrl);
    const pathMatch = url.pathname.match(/\/o\/(.+?)(\?|$)/);
    if (pathMatch?.[1]) {
      const decodedPath = decodeURIComponent(pathMatch[1]);
      const parts = decodedPath.split('/');
      const last = parts[parts.length - 1];
      return last.replace(/^\d+-/, '');
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function guardedFetchFileBytes(
  fileUrl: string,
  init: RequestInit = {},
  docForBgSafe?: Document,
  fetchFn: typeof fetch = fetch,
): Promise<{ bytes: ArrayBuffer; mimeType: string; fileName?: string }> {
  const controller = new AbortController();
  const timeoutMs = UPLOAD_FILE_FETCH_TIMEOUT_MS;

  let aborted = false;
  let cancelTimer = () => {};

  if (docForBgSafe) {
    let canceled = false;
    cancelTimer = () => {
      canceled = true;
    };

    (async () => {
      try {
        await sleepBgSafe(timeoutMs, docForBgSafe);
        if (canceled) return;
        aborted = true;
        controller.abort();
      } catch {
        // ignore
      }
    })().catch(() => {});
  } else {
    const t = setTimeout(() => {
      aborted = true;
      controller.abort();
    }, timeoutMs);
    cancelTimer = () => clearTimeout(t);
  }

  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has('Accept')) headers.set('Accept', '*/*');

  try {
    const res = await fetchFn(fileUrl, {
      method: 'GET',
      redirect: init.redirect ?? 'follow',
      cache: init.cache ?? 'no-store',
      mode: init.mode ?? 'cors',
      credentials: init.credentials ?? 'include',
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodySnippet = await res.text().catch(() => '');
      throw new FetchFileError(`Fetch failed (${res.status})`, {
        url: fileUrl,
        status: res.status,
        statusText: res.statusText,
        bodySnippet: bodySnippet.slice(0, 256),
      });
    }

    const buf = await res.arrayBuffer();
    const contentType = parseContentType(res.headers.get('content-type'));
    const fileName = parseContentDispositionFilename(res.headers.get('content-disposition')) || extractFirebaseFileName(fileUrl);
    return { bytes: buf, mimeType: contentType, fileName };
  } finally {
    cancelTimer();
    if (aborted) {
      // noop - guard against unused lint
    }
  }
}

export async function fetchFileForUploadSmart(
  _tabId: number,
  fileUrl: string,
  referrer: string | null,
): Promise<{ bytes: ArrayBuffer; mimeType: string; fileName?: string }> {
  return await guardedFetchFileBytes(fileUrl, {
    referrer: referrer ?? undefined,
    referrerPolicy: 'strict-origin-when-cross-origin',
  });
}
