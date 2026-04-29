import { sanitizeText } from './config.js';
import { deriveActionCueText } from './dom-helpers.js';
import type { RoverTimelineEvent } from './types.js';

export type TimelineNarrationScheduler = {
  scheduleEvent: (event: RoverTimelineEvent) => void;
  cancel: () => void;
  dispose: () => void;
};

type FrameScheduler = (callback: FrameRequestCallback) => unknown;
type FrameCanceller = (handle: unknown) => void;

type TimelineNarrationSchedulerOptions = {
  isEnabled: () => boolean;
  speak: (text: string) => void;
  scheduleFrame?: FrameScheduler;
  cancelFrame?: FrameCanceller;
};

function normalizeNarrationText(input: unknown): string {
  return sanitizeText(String(input || '').replace(/\s+/g, ' ')).slice(0, 220).trim();
}

export function resolveTimelineNarrationText(event: RoverTimelineEvent): string {
  try {
    if (event.kind === 'tool_result') return '';
    const explicit = normalizeNarrationText(event.narration);
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
  let pending: { cancel: () => void } | null = null;
  let disposed = false;

  function cancelPending(): void {
    if (!pending) return;
    try { pending.cancel(); } catch { /* narration scheduling is best-effort */ }
    pending = null;
  }

  return {
    scheduleEvent(event: RoverTimelineEvent): void {
      try {
        if (disposed || event.kind === 'tool_result' || !opts.isEnabled()) return;
        const text = resolveTimelineNarrationText(event);
        if (!text) return;
        cancelPending();
        pending = scheduleNextFrame(
          () => {
            pending = null;
            if (disposed || !opts.isEnabled()) return;
            try { opts.speak(text); } catch { /* narration is best-effort */ }
          },
          opts.scheduleFrame,
          opts.cancelFrame,
        );
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
