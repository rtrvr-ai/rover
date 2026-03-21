import { cloneJson, defaultPageUrl, sleep, toErrorMessage } from './helpers.js';
import type { RoverBookConfig, RoverBookEvent, RoverVisit } from './types.js';
import { RoverBookAPI } from './api.js';

type PendingEnvelope = {
  batchId: string;
  visit: RoverVisit;
  events: RoverBookEvent[];
  createdAt: number;
};

type CollectorOptions = {
  debug?: boolean;
};

function storageKey(siteId: string): string {
  return `roverbook:pending-batches:${siteId}`;
}

export class EventCollector {
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxBufferedEvents: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxAttempts: number;
  private readonly pendingEvents = new Map<string, RoverBookEvent[]>();
  private readonly visitSnapshots = new Map<string, RoverVisit>();
  private recoveredQueue: PendingEnvelope[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private readonly pagehideHandler: () => void;
  private readonly visibilityHandler: () => void;
  private disposed = false;

  constructor(
    private readonly api: RoverBookAPI,
    private readonly config: RoverBookConfig,
    options: CollectorOptions = {},
  ) {
    this.flushIntervalMs = Math.max(1000, config.flushIntervalMs || 5000);
    this.maxBatchSize = Math.max(1, config.maxBatchSize || 25);
    this.maxBufferedEvents = Math.max(this.maxBatchSize, config.maxBufferedEvents || 100);
    this.retryBaseDelayMs = Math.max(250, config.retryBaseDelayMs || 750);
    this.retryMaxAttempts = Math.max(1, config.retryMaxAttempts || 4);
    this.debug = options.debug === true;
    this.recoveredQueue = this.loadPersistedQueue();
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.pagehideHandler = () => {
      void this.flush({ keepalive: true });
    };
    this.visibilityHandler = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        void this.flush({ keepalive: true });
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.pagehideHandler);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private readonly debug: boolean;

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[RoverBook]', ...args);
    }
  }

  record(event: RoverBookEvent, visit?: RoverVisit): void {
    if (visit) this.updateVisit(visit);
    const queue = this.pendingEvents.get(event.visitId) || [];
    queue.push(cloneJson(event));
    this.pendingEvents.set(event.visitId, queue);
    if (this.pendingEventCount() >= this.maxBufferedEvents || queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  updateVisit(visit: RoverVisit): void {
    this.visitSnapshots.set(visit.visitId, cloneJson(visit));
  }

  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this.flushInternal(options).finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pagehideHandler);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    await this.flush({ keepalive: true });
  }

  private pendingEventCount(): number {
    let count = 0;
    for (const value of this.pendingEvents.values()) {
      count += value.length;
    }
    return count;
  }

  private buildEnvelopes(): PendingEnvelope[] {
    const envelopes: PendingEnvelope[] = [];
    for (const [visitId, events] of this.pendingEvents.entries()) {
      const snapshot = this.visitSnapshots.get(visitId);
      if (!snapshot || events.length === 0) continue;
      let index = 0;
      while (index < events.length) {
        envelopes.push({
          batchId: `${visitId}:${index}`,
          visit: cloneJson(snapshot),
          events: cloneJson(events.slice(index, index + this.maxBatchSize)),
          createdAt: Date.now(),
        });
        index += this.maxBatchSize;
      }
    }
    this.pendingEvents.clear();
    return envelopes;
  }

  private async flushInternal(options: { keepalive?: boolean }): Promise<void> {
    const pending = [...this.recoveredQueue, ...this.buildEnvelopes()];
    this.recoveredQueue = [];
    if (!pending.length) return;

    const failed: PendingEnvelope[] = [];
    for (const envelope of pending) {
      const ok = await this.sendEnvelope(envelope, options);
      if (!ok) failed.push(envelope);
    }
    this.recoveredQueue = failed;
    this.persistQueue(failed);
  }

  private async sendEnvelope(
    envelope: PendingEnvelope,
    options: { keepalive?: boolean },
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt += 1) {
      const keepalive = options.keepalive === true && attempt === 1;
      const ok = await this.api.ingestEvents(envelope.visit, envelope.events, { keepalive });
      if (ok) return true;
      if (attempt < this.retryMaxAttempts) {
        await sleep(this.retryBaseDelayMs * attempt);
      }
    }
    this.log('failed to flush envelope', envelope.batchId, envelope.visit.visitId);
    return false;
  }

  private loadPersistedQueue(): PendingEnvelope[] {
    if (typeof sessionStorage === 'undefined') return [];
    try {
      const raw = sessionStorage.getItem(storageKey(this.config.siteId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as PendingEnvelope[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.log('failed to read persisted queue', toErrorMessage(error));
      return [];
    }
  }

  private persistQueue(queue: PendingEnvelope[]): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      if (!queue.length) {
        sessionStorage.removeItem(storageKey(this.config.siteId));
        return;
      }
      sessionStorage.setItem(storageKey(this.config.siteId), JSON.stringify(queue.slice(-20)));
    } catch (error) {
      this.log('failed to persist queue', toErrorMessage(error));
    }
  }
}

