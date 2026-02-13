import type { SharedSessionState } from './sessionCoordinator.js';
import type { PersistedRuntimeState } from './runtimeTypes.js';

const DEFAULT_CLOUD_FUNCTIONS_BASE = 'https://us-central1-rtrvr-cloud-backend.cloudfunctions.net';

export type RoverCloudCheckpointPayload = {
  version: number;
  siteId: string;
  visitorId: string;
  sessionId: string;
  updatedAt: number;
  sharedState?: SharedSessionState;
  runtimeState?: PersistedRuntimeState;
};

type CheckpointSource = 'pull' | 'push_stale';

export type RoverCloudCheckpointClientOptions = {
  apiBase?: string;
  apiKey?: string;
  authToken?: string;
  siteId: string;
  visitorId: string;
  ttlHours?: number;
  flushIntervalMs?: number;
  pullIntervalMs?: number;
  minFlushIntervalMs?: number;
  shouldWrite?: () => boolean;
  buildCheckpoint: () => RoverCloudCheckpointPayload | null;
  onCheckpoint: (checkpoint: RoverCloudCheckpointPayload, source: CheckpointSource) => void;
  onError?: (error: unknown) => void;
};

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function truncateText(value: unknown, max = 8_000): string {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function buildRevisionKey(payload: RoverCloudCheckpointPayload): string {
  const seq = Number(payload.sharedState?.seq || 0);
  const sharedCount = Array.isArray(payload.sharedState?.uiMessages) ? payload.sharedState.uiMessages.length : 0;
  const runtimeUpdated = Number(payload.runtimeState?.updatedAt || 0);
  const runtimeCount = Array.isArray(payload.runtimeState?.uiMessages) ? payload.runtimeState.uiMessages.length : 0;
  return [
    payload.sessionId,
    toFiniteNumber(payload.updatedAt, 0),
    seq,
    sharedCount,
    runtimeUpdated,
    runtimeCount,
  ].join(':');
}

function normalizeRouterEndpoint(apiBase?: string): string {
  const base = (apiBase || DEFAULT_CLOUD_FUNCTIONS_BASE).replace(/\/$/, '');
  return base.endsWith('/extensionRouter') ? base : `${base}/extensionRouter`;
}

function toError(message: string, details?: any): Error {
  const error = new Error(message);
  (error as any).details = details;
  return error;
}

export class RoverCloudCheckpointClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly siteId: string;
  private readonly visitorId: string;
  private readonly ttlHours: number;
  private readonly flushIntervalMs: number;
  private readonly pullIntervalMs: number;
  private readonly minFlushIntervalMs: number;
  private readonly shouldWrite: () => boolean;
  private readonly buildCheckpoint: RoverCloudCheckpointClientOptions['buildCheckpoint'];
  private readonly onCheckpoint: RoverCloudCheckpointClientOptions['onCheckpoint'];
  private readonly onError?: RoverCloudCheckpointClientOptions['onError'];

  private started = false;
  private dirty = false;
  private flushTimer: number | null = null;
  private pullTimer: number | null = null;
  private lastFlushAt = 0;
  private lastPullAt = 0;
  private lastUploadedRevision = '';
  private lastAppliedRemoteUpdatedAt = 0;
  private pushInFlight = false;
  private pullInFlight = false;

  constructor(options: RoverCloudCheckpointClientOptions) {
    const token = String(options.apiKey || options.authToken || '').trim();
    if (!token) {
      throw toError('Rover cloud checkpoint requires apiKey or authToken.');
    }

    this.endpoint = normalizeRouterEndpoint(options.apiBase);
    this.token = token;
    this.siteId = options.siteId;
    this.visitorId = options.visitorId;
    this.ttlHours = Math.max(1, Math.min(24 * 7, Math.floor(toFiniteNumber(options.ttlHours, 1))));
    this.flushIntervalMs = Math.max(2_000, Math.floor(toFiniteNumber(options.flushIntervalMs, 8_000)));
    this.pullIntervalMs = Math.max(2_000, Math.floor(toFiniteNumber(options.pullIntervalMs, 9_000)));
    this.minFlushIntervalMs = Math.max(1_000, Math.floor(toFiniteNumber(options.minFlushIntervalMs, 2_500)));
    this.shouldWrite = options.shouldWrite || (() => true);
    this.buildCheckpoint = options.buildCheckpoint;
    this.onCheckpoint = options.onCheckpoint;
    this.onError = options.onError;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.flushTimer = window.setInterval(() => {
      void this.flush(false);
    }, this.flushIntervalMs);

    this.pullTimer = window.setInterval(() => {
      void this.pull(false);
    }, this.pullIntervalMs);

    void this.pull(true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.flushTimer != null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pullTimer != null) {
      window.clearInterval(this.pullTimer);
      this.pullTimer = null;
    }

    void this.flush(true);
  }

  markDirty(): void {
    this.dirty = true;
  }

  syncNow(): void {
    void this.flush(true);
    void this.pull(true);
  }

  private async flush(force: boolean): Promise<void> {
    if (this.pushInFlight) return;
    if (!this.dirty && !force) return;
    if (!this.shouldWrite()) return;
    if (!force && Date.now() - this.lastFlushAt < this.minFlushIntervalMs) return;

    const payload = this.buildCheckpoint();
    if (!payload) return;

    const revision = buildRevisionKey(payload);
    if (!force && revision === this.lastUploadedRevision) {
      this.dirty = false;
      return;
    }

    this.pushInFlight = true;
    try {
      const response = await this.callExtensionRouter('roverSessionCheckpointUpsert', {
        siteId: this.siteId,
        visitorId: this.visitorId,
        sessionId: payload.sessionId,
        ttlHours: this.ttlHours,
        updatedAt: payload.updatedAt,
        checkpoint: payload,
      });

      this.lastFlushAt = Date.now();
      if (response?.saved) {
        this.dirty = false;
        this.lastUploadedRevision = revision;
      }

      if (response?.stale && response?.checkpoint && typeof response.checkpoint === 'object') {
        this.applyRemoteCheckpoint(response.checkpoint as RoverCloudCheckpointPayload, 'push_stale');
        this.dirty = false;
      }
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.pushInFlight = false;
    }
  }

  private async pull(force: boolean): Promise<void> {
    if (this.pullInFlight) return;
    if (!force && Date.now() - this.lastPullAt < this.pullIntervalMs) return;

    this.pullInFlight = true;
    try {
      const response = await this.callExtensionRouter('roverSessionCheckpointGet', {
        siteId: this.siteId,
        visitorId: this.visitorId,
      });

      this.lastPullAt = Date.now();
      if (!response?.found || !response?.checkpoint || typeof response.checkpoint !== 'object') return;
      this.applyRemoteCheckpoint(response.checkpoint as RoverCloudCheckpointPayload, 'pull');
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.pullInFlight = false;
    }
  }

  private applyRemoteCheckpoint(checkpoint: RoverCloudCheckpointPayload, source: CheckpointSource): void {
    const updatedAt = Math.max(0, Math.floor(toFiniteNumber(checkpoint?.updatedAt, 0)));
    if (updatedAt <= this.lastAppliedRemoteUpdatedAt) return;
    this.lastAppliedRemoteUpdatedAt = updatedAt;
    this.onCheckpoint(checkpoint, source);
  }

  private async callExtensionRouter(action: string, data: any): Promise<any> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
    });

    if (!response.ok) {
      let payload: any = undefined;
      try {
        payload = await response.json();
      } catch {
        const text = await response.text().catch(() => '');
        payload = text ? { error: truncateText(text, 2_000) } : undefined;
      }
      throw toError(`Checkpoint HTTP ${response.status}`, payload);
    }

    const payload = await response.json();
    if (payload?.success === false) {
      throw toError('Checkpoint extensionRouter returned success=false', payload);
    }

    return payload?.data;
  }
}
