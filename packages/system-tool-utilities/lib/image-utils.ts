const DESCRIBE_IMAGES_FETCH_TIMEOUT_MS = 15_000;
const DESCRIBE_IMAGES_MAX_BYTES = 10 * 1024 * 1024; // 10MB safeguard
const DESCRIBE_IMAGES_CONCURRENCY = 4;

function parseContentType(ct: string | null): string {
  if (!ct) return 'application/octet-stream';
  return ct.split(';')[0].trim() || 'application/octet-stream';
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

export async function fetchToBase64FromBackground(
  url: string,
  referrer: string | null,
): Promise<{ data: string; mimeType: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DESCRIBE_IMAGES_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'include', // try to carry cookies where allowed
      referrer: referrer ?? undefined,
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const lenHdr = res.headers.get('content-length');
    if (lenHdr) {
      const n = Number(lenHdr);
      if (Number.isFinite(n) && n > DESCRIBE_IMAGES_MAX_BYTES) {
        throw new Error(`Too large (${n} bytes)`);
      }
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > DESCRIBE_IMAGES_MAX_BYTES) {
      throw new Error(`Too large (${buf.byteLength} bytes)`);
    }

    const mimeType = parseContentType(res.headers.get('content-type'));
    const data = arrayBufferToBase64(buf);
    return { data, mimeType };
  } finally {
    clearTimeout(t);
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = DESCRIBE_IMAGES_CONCURRENCY,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return out;
}
