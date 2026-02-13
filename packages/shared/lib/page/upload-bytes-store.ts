// packages/shared/lib/upload-bytes-store.ts

export const UPLOAD_BYTES_TTL_MS = 10 * 60_000; // 10 min
export const UPLOAD_BYTES_CHUNK_SIZE = 512 * 1024; // 512KB
export const UPLOAD_FILE_MAX_BYTES = 25 * 1024 * 1024; // 25MB

type Stored = {
  token: string;
  createdAt: number;
  byteLength: number;
  // Fast in-memory path (preferred if present)
  bytes?: Uint8Array;
  // Durable path loaded from IDB (read-through cache)
  blob?: Blob;
};

type PutResult = { token: string; byteLength: number; durable: boolean };

const GLOBAL_KEY = '__RTRVR_UPLOAD_BYTES_STORE__';
const g: any = globalThis as any;

function getGlobalStore(): Map<string, Stored> {
  if (!g[GLOBAL_KEY]) {
    const m = new Map<string, Stored>();
    try {
      Object.defineProperty(g, GLOBAL_KEY, { value: m, enumerable: false, configurable: false });
    } catch {
      g[GLOBAL_KEY] = m;
    }
  }
  return g[GLOBAL_KEY] as Map<string, Stored>;
}

function randomToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---- base64 helpers ----
let _latin1Decoder: TextDecoder | null = null;
function getLatin1Decoder(): TextDecoder | null {
  try {
    return (_latin1Decoder ??= new TextDecoder('iso-8859-1'));
  } catch {
    try {
      return (_latin1Decoder ??= new TextDecoder('latin1' as any));
    } catch {
      return null;
    }
  }
}

function uint8ToBase64(u8: Uint8Array): string {
  const dec = getLatin1Decoder();
  if (dec) return btoa(dec.decode(u8));
  // Fallback chunked
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) bin += String.fromCharCode(...u8.subarray(i, i + step));
  return btoa(bin);
}

// ---- IndexedDB backing ----
const DB_NAME = 'rtrvr_upload_bytes_v1';
const DB_VERSION = 1;
const STORE_NAME = 'uploads';

type UploadRec = { token: string; createdAt: number; byteLength: number; blob: Blob };

let _dbP: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('idb_unavailable'));
  }

  if (_dbP) return _dbP;

  _dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'token' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb_open_failed'));
  });

  return _dbP;
}

async function idbPut(rec: UploadRec): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb_put_failed'));
    tx.objectStore(STORE_NAME).put(rec);
  });
}

async function idbGet(token: string): Promise<UploadRec | undefined> {
  const db = await openDb();
  return await new Promise<UploadRec | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(token);
    req.onsuccess = () => resolve(req.result as UploadRec | undefined);
    req.onerror = () => reject(req.error || new Error('idb_get_failed'));
  });
}

async function idbDelete(token: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb_delete_failed'));
    tx.objectStore(STORE_NAME).delete(token);
  });
}

let _lastIdbPruneAt = 0;
async function idbPrune(now: number): Promise<void> {
  // Opportunistic prune at most once per minute
  if (now - _lastIdbPruneAt < 60_000) return;
  _lastIdbPruneAt = now;

  const cutoff = now - UPLOAD_BYTES_TTL_MS;
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();

    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const v = cur.value as UploadRec;
      if (v?.createdAt && v.createdAt < cutoff) cur.delete();
      cur.continue();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb_prune_failed'));
  });
}

// ---- pruning in-memory ----
function pruneMem(store: Map<string, Stored>) {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > UPLOAD_BYTES_TTL_MS) store.delete(k);
  }
}

// ---- API ----
export async function putUploadBytes(bytes: ArrayBuffer, mimeType?: string): Promise<PutResult> {
  const store = getGlobalStore();
  pruneMem(store);

  const u8 = new Uint8Array(bytes);
  if (u8.byteLength > UPLOAD_FILE_MAX_BYTES) {
    throw new Error(`putUploadBytes: too large (${u8.byteLength} > ${UPLOAD_FILE_MAX_BYTES})`);
  }

  const token = randomToken();
  const createdAt = Date.now();

  // Always store in-memory (fast path)
  store.set(token, { token, createdAt, byteLength: u8.byteLength, bytes: u8 });

  // Best-effort durable store
  let durable = false;
  try {
    const blob = new Blob([u8], { type: (mimeType || 'application/octet-stream').split(';')[0].trim() });
    await idbPut({ token, createdAt, byteLength: u8.byteLength, blob });
    durable = true;
    // Opportunistic prune
    await idbPrune(createdAt);
  } catch (e: any) {
    // Quota full or IDB blocked: continue with in-memory only
    durable = false;
  }

  return { token, byteLength: u8.byteLength, durable };
}

export async function getUploadBytesChunkB64(token: string, offset: number, length: number) {
  const store = getGlobalStore();
  pruneMem(store);

  let entry = store.get(token);

  if (!entry) {
    // SW may have restarted; load from IDB
    try {
      const rec = await idbGet(token);
      if (rec) {
        entry = { token: rec.token, createdAt: rec.createdAt, byteLength: rec.byteLength, blob: rec.blob };
        store.set(token, entry);
      }
    } catch {
      // ignore; handled below
    }
  }

  if (!entry) {
    return { ok: false as const, error: 'token_not_found_or_expired' as const };
  }

  const safeLen = Math.max(1, Math.min(Number(length) || UPLOAD_BYTES_CHUNK_SIZE, UPLOAD_BYTES_CHUNK_SIZE));
  const start = Math.max(0, Math.min(Number(offset) || 0, entry.byteLength));
  const end = Math.max(start, Math.min(start + safeLen, entry.byteLength));

  let sliceU8: Uint8Array;

  if (entry.bytes) {
    sliceU8 = entry.bytes.subarray(start, end);
  } else if (entry.blob) {
    const ab = await entry.blob.slice(start, end).arrayBuffer();
    sliceU8 = new Uint8Array(ab);
  } else {
    return { ok: false as const, error: 'token_corrupt' as const };
  }

  const chunkB64 = uint8ToBase64(sliceU8);

  return {
    ok: true as const,
    chunkB64,
    start,
    end,
    total: entry.byteLength,
    done: end >= entry.byteLength,
  };
}

export async function releaseUploadBytes(token: string) {
  const store = getGlobalStore();
  store.delete(token);
  try {
    await idbDelete(token);
  } catch {
    // ignore
  }
}
