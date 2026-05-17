// packages/ui/src/feedback-queue.ts
//
// Pure UI-side model for the visitor's steering-feedback queue. No DOM, no
// SDK calls — just the state machine + id generation. Owned by mount.ts and
// fed by both the steer dock (compressed state) and the composer steer mode
// (expanded state).
//
// Invariant: every item enters in state 'queued'. The worker emits
// feedback_applied or feedback_dropped events that flip it to a terminal
// state. After terminal, no further transitions are allowed.

import type {
  RoverFeedbackSource,
  RoverFeedbackDropReason,
} from '@rover/shared/lib/types/rover-feedback.js';

export type FeedbackStatus = 'queued' | 'applied' | 'dropped';

export interface FeedbackCard {
  id: string;
  text: string;
  source: RoverFeedbackSource;
  status: FeedbackStatus;
  submittedAt: number;
  /** Set when status flips to 'applied'. */
  appliedAtStepIndex?: number;
  /** Set when status flips to 'dropped'. */
  dropReason?: RoverFeedbackDropReason;
}

/**
 * Generate a sortable, hard-to-collide id without pulling in a ULID library.
 * Format: `fb-<ms-base36>-<random6>`. Lexically sortable by submission time
 * (good for ordered drains), low enough collision probability for a single
 * client widget.
 */
export function generateFeedbackId(now: number = Date.now()): string {
  const ts = Math.max(0, Math.floor(now)).toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `fb-${ts}-${rand}`;
}

export interface FeedbackQueueModel {
  /** Snapshot of all current cards in submission order. */
  list(): FeedbackCard[];
  /** Lookup a single card by id. Returns undefined if not found. */
  get(id: string): FeedbackCard | undefined;
  /** Enqueue a new card in 'queued' state. Returns the new card. */
  enqueue(input: { id?: string; text: string; source: RoverFeedbackSource }): FeedbackCard;
  /** Transition a card to 'applied'. No-op if id unknown or already terminal. */
  markApplied(id: string, atStepIndex: number): FeedbackCard | undefined;
  /** Transition a card to 'dropped'. No-op if id unknown or already terminal. */
  markDropped(id: string, reason: RoverFeedbackDropReason): FeedbackCard | undefined;
  /** Drop ALL still-queued cards with the given reason — used when the run ends. */
  dropAllQueued(reason: RoverFeedbackDropReason): FeedbackCard[];
  /** Forget every card. Used on transcript clear / new chat. */
  reset(): void;
}

export function createFeedbackQueueModel(): FeedbackQueueModel {
  const order: string[] = [];
  const byId = new Map<string, FeedbackCard>();

  function isTerminal(card: FeedbackCard | undefined): boolean {
    return !!card && (card.status === 'applied' || card.status === 'dropped');
  }

  return {
    list(): FeedbackCard[] {
      return order
        .map(id => byId.get(id))
        .filter((card): card is FeedbackCard => card !== undefined);
    },

    get(id: string): FeedbackCard | undefined {
      return byId.get(id);
    },

    enqueue(input): FeedbackCard {
      const id = (input.id && String(input.id).trim()) || generateFeedbackId();
      // De-dup if a card with the same id already exists — keep the original.
      const existing = byId.get(id);
      if (existing) return existing;
      const text = String(input.text || '').trim();
      const source: RoverFeedbackSource = input.source === 'voice' ? 'voice' : 'text';
      const card: FeedbackCard = {
        id,
        text,
        source,
        status: 'queued',
        submittedAt: Date.now(),
      };
      byId.set(id, card);
      order.push(id);
      return card;
    },

    markApplied(id, atStepIndex): FeedbackCard | undefined {
      const card = byId.get(id);
      if (!card || isTerminal(card)) return card;
      const next: FeedbackCard = {
        ...card,
        status: 'applied',
        appliedAtStepIndex: Math.max(0, Math.floor(atStepIndex)),
      };
      byId.set(id, next);
      return next;
    },

    markDropped(id, reason): FeedbackCard | undefined {
      const card = byId.get(id);
      if (!card || isTerminal(card)) return card;
      const next: FeedbackCard = { ...card, status: 'dropped', dropReason: reason };
      byId.set(id, next);
      return next;
    },

    dropAllQueued(reason): FeedbackCard[] {
      const flipped: FeedbackCard[] = [];
      for (const id of order) {
        const card = byId.get(id);
        if (!card || isTerminal(card)) continue;
        const next: FeedbackCard = { ...card, status: 'dropped', dropReason: reason };
        byId.set(id, next);
        flipped.push(next);
      }
      return flipped;
    },

    reset(): void {
      order.length = 0;
      byId.clear();
    },
  };
}

/** Human-readable summary of a card's status for UI rendering. */
export function describeFeedbackStatus(card: FeedbackCard): string {
  if (card.status === 'queued') return 'Queued — will apply at next step';
  if (card.status === 'applied') {
    return typeof card.appliedAtStepIndex === 'number'
      ? `Applied at step ${card.appliedAtStepIndex + 1}`
      : 'Applied';
  }
  switch (card.dropReason) {
    case 'run_ended': return 'Not applied — run ended';
    case 'run_canceled': return 'Not applied — run canceled';
    case 'run_id_mismatch': return 'Not applied — sent to a stale run';
    case 'queue_full': return 'Not applied — too many guidance items queued';
    case 'empty_text': return 'Not sent — text was empty';
    default: return 'Not applied';
  }
}
