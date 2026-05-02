import { createRuntimeStateStore, type RuntimeStateStore } from './runtimeStorage.js';

const DEFAULT_EXTENSION_ROUTER_BASE = 'https://agent.rtrvr.ai';

export type RoverConversationStatus = 'running' | 'paused' | 'completed' | 'failed' | 'awaiting_user';

export type RoverConversationSummary = {
  conversationId: string;
  title: string;
  preview?: string;
  status?: RoverConversationStatus | string;
  createdAt?: number;
  updatedAt: number;
  revision?: number;
  deletedAt?: number;
};

export type RoverConversationPayload = {
  uiMessages?: unknown[];
  timeline?: unknown[];
  runtimeState?: unknown;
  taskRecord?: unknown;
  attachments?: unknown[];
  runMeta?: Record<string, unknown>;
};

export type LocalConversationRecord = {
  summary: RoverConversationSummary;
  payload?: RoverConversationPayload;
};

function normalizeBaseOrigin(apiBase?: string): string {
  const fallback = DEFAULT_EXTENSION_ROUTER_BASE;
  const base = String(apiBase || fallback).trim().replace(/\/+$/, '');
  if (!base) return fallback;
  if (base.endsWith('/extensionRouter/v2/rover')) return base.slice(0, -('/extensionRouter/v2/rover'.length));
  if (base.endsWith('/v2/rover')) return base.slice(0, -('/v2/rover'.length));
  return base;
}

function normalizeRoverV2Base(apiBase?: string): string {
  const raw = String(apiBase || '').trim().replace(/\/+$/, '');
  if (raw.endsWith('/v2/rover')) return raw;
  if (raw.endsWith('/extensionRouter/v2/rover')) return raw.replace('/extensionRouter/v2/rover', '/v2/rover');
  return `${normalizeBaseOrigin(apiBase)}/v2/rover`;
}

function createNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeScopePart(value: unknown, fallback: string): string {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_')
    .slice(0, 128) || fallback;
}

function normalizeConversationId(input: unknown): string {
  return String(input || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 128);
}

function truncateText(input: unknown, max: number): string {
  const value = String(input || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return value.slice(0, max);
}

export function buildConversationTitle(input: unknown, fallback = 'New chat'): string {
  return truncateText(input, 72) || fallback;
}

export function createConversationHistoryStore(params: {
  siteId?: string;
  visitorId?: string;
}): {
  list: () => Promise<RoverConversationSummary[]>;
  get: (conversationId: string) => Promise<LocalConversationRecord | null>;
  upsert: (record: LocalConversationRecord) => void;
  remove: (conversationId: string, tombstone?: { deletedAt?: number; revision?: number }) => void;
} {
  const store: RuntimeStateStore<any> = createRuntimeStateStore<any>();
  const scope = `${normalizeScopePart(params.siteId, 'unknown-site')}:${normalizeScopePart(params.visitorId, 'anonymous')}`;
  const indexKey = `rover:conversations:${scope}:index`;
  const recordKey = (id: string) => `rover:conversations:${scope}:record:${normalizeConversationId(id)}`;

  async function readIndex(): Promise<RoverConversationSummary[]> {
    const sync = store.readSync(indexKey);
    if (Array.isArray(sync)) return sync;
    const asyncValue = await store.readAsync(indexKey);
    return Array.isArray(asyncValue) ? asyncValue : [];
  }

  function writeIndex(index: RoverConversationSummary[]): void {
    store.write(indexKey, index
      .filter(item => !!normalizeConversationId(item.conversationId) && !item.deletedAt)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 100));
  }

  return {
    async list() {
      return readIndex();
    },
    async get(conversationId: string) {
      const id = normalizeConversationId(conversationId);
      if (!id) return null;
      return (store.readSync(recordKey(id)) || await store.readAsync(recordKey(id))) as LocalConversationRecord | null;
    },
    upsert(record: LocalConversationRecord) {
      const id = normalizeConversationId(record.summary.conversationId);
      if (!id) return;
      const existing = store.readSync(recordKey(id)) as LocalConversationRecord | null;
      const summary = {
        ...record.summary,
        conversationId: id,
        title: buildConversationTitle(record.summary.title),
        preview: truncateText(record.summary.preview, 180),
        updatedAt: Number(record.summary.updatedAt || Date.now()),
        createdAt: Number(record.summary.createdAt || record.summary.updatedAt || Date.now()),
      };
      const payload = record.payload ?? existing?.payload;
      if (payload) {
        store.write(recordKey(id), { summary, payload });
      }
      void readIndex().then(index => {
        writeIndex([summary, ...index.filter(item => item.conversationId !== id)]);
      });
    },
    remove(conversationId: string, tombstone?: { deletedAt?: number; revision?: number }) {
      const id = normalizeConversationId(conversationId);
      if (!id) return;
      store.remove(recordKey(id));
      void readIndex().then(index => {
        writeIndex(index
          .filter(item => item.conversationId !== id)
          .map(item => item.conversationId === id
            ? { ...item, deletedAt: tombstone?.deletedAt || Date.now(), revision: tombstone?.revision }
            : item));
      });
    },
  };
}

export class RoverConversationHistoryClient {
  private readonly base: string;
  private readonly getSessionToken?: () => string | undefined;
  private readonly siteId: string;
  private readonly visitorId: string;

  constructor(options: {
    apiBase?: string;
    getSessionToken?: () => string | undefined;
    siteId: string;
    visitorId: string;
  }) {
    this.base = normalizeRoverV2Base(options.apiBase);
    this.getSessionToken = options.getSessionToken;
    this.siteId = options.siteId;
    this.visitorId = options.visitorId;
  }

  private async request(path: string, init?: RequestInit & { json?: Record<string, unknown> }): Promise<any> {
    const token = this.getSessionToken?.();
    if (!token) throw new Error('Rover session token unavailable.');
    const method = init?.method || 'GET';
    const url = new URL(`${this.base}${path}`);
    if (method === 'GET') {
      url.searchParams.set('sessionToken', token);
      url.searchParams.set('siteId', this.siteId);
      url.searchParams.set('visitorId', this.visitorId);
    }
    const body = method === 'GET'
      ? undefined
      : JSON.stringify({
          ...(init?.json || {}),
          sessionToken: token,
          siteId: this.siteId,
          visitorId: this.visitorId,
          requestNonce: createNonce(),
        });
    const response = await fetch(url.toString(), {
      method,
      headers: method === 'GET' ? undefined : { 'content-type': 'text/plain;charset=UTF-8' },
      body,
      credentials: 'omit',
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) {
      throw new Error(String(json?.error || json?.message || `conversation request failed (${response.status})`));
    }
    return json.data || json;
  }

  async list(): Promise<{ conversations: RoverConversationSummary[]; tombstones: Array<{ conversationId: string; deletedAt?: number; revision?: number }> }> {
    const data = await this.request('/conversations');
    const conversations = Array.isArray(data.conversations)
      ? data.conversations.map((item: any) => ({
          conversationId: normalizeConversationId(item.conversationId),
          title: buildConversationTitle(item.title),
          preview: truncateText(item.preview, 180),
          status: item.status,
          createdAt: Number(item.createdAt || 0) || undefined,
          updatedAt: Number(item.updatedAt || 0) || Date.now(),
          revision: Number(item.revision || 0) || undefined,
        })).filter((item: RoverConversationSummary) => !!item.conversationId)
      : [];
    const tombstones = Array.isArray(data.tombstones) ? data.tombstones : [];
    return { conversations, tombstones };
  }

  async get(conversationId: string): Promise<LocalConversationRecord | null> {
    const id = normalizeConversationId(conversationId);
    if (!id) return null;
    const data = await this.request(`/conversations/${encodeURIComponent(id)}`);
    const conversation = data.conversation || {};
    return {
      summary: {
        conversationId: id,
        title: buildConversationTitle(conversation.title),
        preview: truncateText(conversation.preview, 180),
        status: conversation.status,
        createdAt: Number(conversation.createdAt || 0) || undefined,
        updatedAt: Number(conversation.updatedAt || 0) || Date.now(),
        revision: Number(conversation.revision || 0) || undefined,
      },
      payload: (data.payload?.payload || data.payload) as RoverConversationPayload,
    };
  }

  async upsert(record: LocalConversationRecord): Promise<RoverConversationSummary | null> {
    const id = normalizeConversationId(record.summary.conversationId);
    if (!id) return null;
    const data = await this.request(`/conversations/${encodeURIComponent(id)}`, {
      method: 'POST',
      json: {
        title: buildConversationTitle(record.summary.title),
        preview: truncateText(record.summary.preview, 180),
        status: record.summary.status || 'completed',
        payload: record.payload || {},
      },
    });
    const conversation = data.conversation || {};
    return {
      conversationId: id,
      title: buildConversationTitle(conversation.title || record.summary.title),
      preview: truncateText(conversation.preview || record.summary.preview, 180),
      status: conversation.status || record.summary.status,
      createdAt: Number(conversation.createdAt || record.summary.createdAt || 0) || undefined,
      updatedAt: Number(conversation.updatedAt || Date.now()),
      revision: Number(conversation.revision || 0) || undefined,
    };
  }

  async delete(conversationId: string): Promise<{ conversationId: string; deletedAt?: number; revision?: number }> {
    const id = normalizeConversationId(conversationId);
    const data = await this.request(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', json: {} });
    return {
      conversationId: id,
      deletedAt: Number(data.deletedAt || Date.now()),
      revision: Number(data.revision || 0) || undefined,
    };
  }
}
