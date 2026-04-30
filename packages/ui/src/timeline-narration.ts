import { sanitizeText } from './config.js';
import { deriveActionCueText } from './dom-helpers.js';
import type { RoverTimelineEvent } from './types.js';
import type { RoverNarratorSpeakOptions } from './narrator.js';

export type TimelineNarrationScheduler = {
  scheduleEvent: (event: RoverTimelineEvent) => void;
  cancel: () => void;
  dispose: () => void;
};

type FrameScheduler = (callback: FrameRequestCallback) => unknown;
type FrameCanceller = (handle: unknown) => void;

type TimelineNarrationSchedulerOptions = {
  isEnabled: () => boolean;
  speak: (text: string, options?: RoverNarratorSpeakOptions) => void;
  scheduleFrame?: FrameScheduler;
  cancelFrame?: FrameCanceller;
};

type PendingNarration = {
  text: string;
  mode: 'append' | 'replace';
  key?: string;
  priority: 'low' | 'normal' | 'high';
  source?: 'action' | 'response' | 'status';
  catchUp?: boolean;
  estimatedMs: number;
};

const MAX_PENDING_ACTION_NARRATIONS = 4;
const MAX_PENDING_ACTION_SPEECH_MS = 7_000;
const CATCH_UP_NARRATION = 'Continuing through the form.';
const LOW_VALUE_KINDS = new Set(['hover', 'focus', 'wait', 'read', 'unknown']);

function normalizeNarrationText(input: unknown): string {
  return sanitizeText(String(input || '').replace(/\s+/g, ' ')).slice(0, 220).trim();
}

function estimateSpeechMs(text: string): number {
  return Math.max(900, Math.min(5_000, text.length * 55));
}

function getActionCueKind(event: RoverTimelineEvent): string {
  return String(event.actionCue?.kind || '').trim().toLowerCase() || 'unknown';
}

function getNarrationKey(event: RoverTimelineEvent, text: string): string {
  const cue = event.actionCue;
  const kind = getActionCueKind(event);
  const target =
    cue?.targetLabel ||
    (cue?.primaryElementId != null ? `element:${cue.primaryElementId}` : '') ||
    event.toolName ||
    event.title ||
    text;
  return `${kind}:${String(target).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)}`;
}

function getNarrationPriority(event: RoverTimelineEvent): PendingNarration['priority'] {
  const kind = getActionCueKind(event);
  if (LOW_VALUE_KINDS.has(kind)) return 'low';
  if (kind === 'scroll' && !event.actionCue?.primaryElementId) return 'low';
  if (kind === 'click' || kind === 'type' || kind === 'select' || kind === 'upload' || kind === 'navigate') return 'high';
  return 'normal';
}

function getResponseNarrationPriority(event: RoverTimelineEvent): PendingNarration['priority'] {
  if (event.responseKind === 'final' || event.responseKind === 'question' || event.responseKind === 'error') return 'high';
  return 'normal';
}

export function resolveTimelineNarrationText(event: RoverTimelineEvent): string {
  try {
    if (event.kind === 'tool_result') return '';
    const explicit = normalizeNarrationText(event.narration);
    if (event.kind === 'assistant_response') {
      return explicit || (event.narrationActive === true ? normalizeNarrationText(event.detail) : '');
    }
    const fallback = !explicit && event.kind === 'tool_start' && event.narrationActive === true
      ? normalizeNarrationText(deriveActionCueText(event))
      : '';
    return explicit || fallback;
  } catch {
    return '';
  }
}

function scheduleNextFrame(
  callback: FrameRequestCallback,
  scheduleFrame?: FrameScheduler,
  cancelFrame?: FrameCanceller,
): { cancel: () => void } {
  if (scheduleFrame && cancelFrame) {
    try {
      const handle = scheduleFrame(callback);
      return {
        cancel: () => cancelFrame(handle),
      };
    } catch {
      // Fall through to the browser/default scheduler.
    }
  }
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    try {
      const handle = requestAnimationFrame(callback);
      return {
        cancel: () => cancelAnimationFrame(handle),
      };
    } catch {
      // Fall through to setTimeout below.
    }
  }
  try {
    const timer = setTimeout(() => callback(Date.now()), 0);
    return {
      cancel: () => clearTimeout(timer),
    };
  } catch {
    return {
      cancel: () => {},
    };
  }
}

export function createTimelineNarrationScheduler(
  opts: TimelineNarrationSchedulerOptions,
): TimelineNarrationScheduler {
  let pendingFrame: { cancel: () => void } | null = null;
  let pendingNarrations: PendingNarration[] = [];
  let disposed = false;

  function cancelPendingFrame(): void {
    if (!pendingFrame) return;
    try { pendingFrame.cancel(); } catch { /* narration scheduling is best-effort */ }
    pendingFrame = null;
  }

  function cancelPending(): void {
    cancelPendingFrame();
    pendingNarrations = [];
  }

  function estimatePendingMs(): number {
    return pendingNarrations.reduce((sum, item) => sum + item.estimatedMs, 0);
  }

  function enforcePendingBudget(): void {
    let dropped = false;
    while (
      pendingNarrations.length > MAX_PENDING_ACTION_NARRATIONS ||
      estimatePendingMs() > MAX_PENDING_ACTION_SPEECH_MS
    ) {
      const lowPriorityIndex = pendingNarrations.findIndex(item => item.priority === 'low' && !item.catchUp);
      const normalPriorityIndex = pendingNarrations.findIndex(item => item.priority === 'normal' && !item.catchUp);
      const nonHighPriorityIndex = pendingNarrations.findIndex(item => item.priority !== 'high' && !item.catchUp);
      const dropIndex = lowPriorityIndex >= 0
        ? lowPriorityIndex
        : normalPriorityIndex >= 0
          ? normalPriorityIndex
          : nonHighPriorityIndex >= 0
            ? nonHighPriorityIndex
            : pendingNarrations.findIndex(item => !item.catchUp);
      if (dropIndex < 0) break;
      pendingNarrations.splice(dropIndex, 1);
      dropped = true;
    }
    if (dropped && !pendingNarrations.some(item => item.catchUp)) {
      pendingNarrations = [
        {
          text: CATCH_UP_NARRATION,
          mode: 'append',
          key: 'catch-up',
          priority: 'normal',
          source: 'action',
          catchUp: true,
          estimatedMs: estimateSpeechMs(CATCH_UP_NARRATION),
        },
        ...pendingNarrations.slice(-(MAX_PENDING_ACTION_NARRATIONS - 1)),
      ];
    }
    while (pendingNarrations.length > MAX_PENDING_ACTION_NARRATIONS) {
      pendingNarrations.splice(pendingNarrations.length - 1, 1);
    }
  }

  function scheduleFlush(): void {
    if (pendingFrame) return;
    pendingFrame = scheduleNextFrame(
      () => {
        pendingFrame = null;
        if (disposed || !opts.isEnabled()) {
          pendingNarrations = [];
          return;
        }
        const narrations = pendingNarrations;
        pendingNarrations = [];
        for (const item of narrations) {
          try {
            opts.speak(item.text, {
              mode: item.mode,
              key: item.key,
              priority: item.priority,
            });
          } catch {
            // Narration is best-effort.
          }
        }
      },
      opts.scheduleFrame,
      opts.cancelFrame,
    );
  }

  function appendActionNarration(event: RoverTimelineEvent, text: string): void {
    const key = getNarrationKey(event, text);
    const priority = getNarrationPriority(event);
    const duplicateIndex = pendingNarrations.findIndex(item => item.key === key);
    if (duplicateIndex >= 0) {
      pendingNarrations[duplicateIndex] = {
        ...pendingNarrations[duplicateIndex],
        text,
        priority,
        estimatedMs: estimateSpeechMs(text),
      };
      enforcePendingBudget();
      scheduleFlush();
      return;
    }
    pendingNarrations.push({
      text,
      mode: 'append',
      key,
      priority,
      source: 'action',
      estimatedMs: estimateSpeechMs(text),
    });
    enforcePendingBudget();
    scheduleFlush();
  }

  function appendResponseNarration(event: RoverTimelineEvent, text: string): void {
    const responseKind = event.responseKind || 'checkpoint';
    const priority = getResponseNarrationPriority(event);
    if (priority === 'high') {
      pendingNarrations = pendingNarrations.filter(item => item.priority !== 'low' && !item.catchUp);
    }
    const key = `response:${responseKind}:${text.toLowerCase().slice(0, 140)}`;
    const duplicateIndex = pendingNarrations.findIndex(item => item.key === key);
    if (duplicateIndex >= 0) {
      pendingNarrations[duplicateIndex] = {
        ...pendingNarrations[duplicateIndex],
        text,
        priority,
        estimatedMs: estimateSpeechMs(text),
      };
      enforcePendingBudget();
      scheduleFlush();
      return;
    }
    pendingNarrations.push({
      text,
      mode: 'append',
      key,
      priority,
      source: 'response',
      estimatedMs: estimateSpeechMs(text),
    });
    enforcePendingBudget();
    scheduleFlush();
  }

  return {
    scheduleEvent(event: RoverTimelineEvent): void {
      try {
        if (disposed || event.kind === 'tool_result' || !opts.isEnabled()) return;
        const text = resolveTimelineNarrationText(event);
        if (!text) return;
        if (event.kind === 'tool_start') {
          appendActionNarration(event, text);
          return;
        }
        if (event.kind === 'assistant_response') {
          appendResponseNarration(event, text);
          return;
        }
        if (pendingNarrations.some(item => item.mode === 'append')) return;
        cancelPending();
        pendingNarrations = [{
          text,
          mode: 'replace',
          key: `status:${event.kind}:${event.title}`,
          priority: 'normal',
          source: 'status',
          estimatedMs: estimateSpeechMs(text),
        }];
        scheduleFlush();
      } catch {
        // Narration is best-effort and must not interrupt timeline handling.
      }
    },
    cancel(): void {
      cancelPending();
    },
    dispose(): void {
      disposed = true;
      cancelPending();
    },
  };
}
