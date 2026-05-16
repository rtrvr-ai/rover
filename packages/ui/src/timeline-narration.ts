import { sanitizeText } from './config.js';
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
  // Permissive gate: returns false only when narration is hard-blocked locally
  // (visitor explicitly turned narration off, or no narrator support). Used to drop
  // pending narrations on flush if the visitor flips OFF mid-batch.
  isEnabled: () => boolean;
  // Event-aware precedence gate (visitor explicit > presentation event > site default).
  // When provided, scheduleEvent uses this in place of isEnabled so explicit
  // user-facing narration text can be spoken only when allowed. Defaults to isEnabled.
  shouldSpeakEvent?: (event: RoverTimelineEvent) => boolean;
  speak: (text: string, options?: RoverNarratorSpeakOptions) => void;
  scheduleFrame?: FrameScheduler;
  cancelFrame?: FrameCanceller;
};

type PendingPresentation = {
  text: string;
  mode: 'append' | 'replace';
  key?: string;
  priority: 'low' | 'normal' | 'high';
  source?: 'action' | 'response' | 'status';
  catchUp?: boolean;
  estimatedMs: number;
};

const MAX_PENDING_TOOL_PRESENTATIONS = 6;
const MAX_PENDING_PRESENTATION_SPEECH_MS = 10_500;
const CATCH_UP_PRESENTATION = 'Continuing through the form.';
const LOW_VALUE_KINDS = new Set(['hover', 'focus', 'wait', 'read', 'unknown']);

const NARRATION_TEXT_CAP = 360;

function normalizeNarrationText(input: unknown): string {
  const collapsed = sanitizeText(String(input || '').replace(/\s+/g, ' ')).trim();
  if (collapsed.length <= NARRATION_TEXT_CAP) return collapsed;
  let cut = collapsed.slice(0, NARRATION_TEXT_CAP);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > NARRATION_TEXT_CAP * 0.6) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[,;:\-\s]+$/, '').trim();
  return /[.!?]$/.test(cut) ? cut : `${cut}…`;
}

function estimateSpeechMs(text: string): number {
  return Math.max(900, Math.min(5_000, text.length * 55));
}

function getActionCueKind(event: RoverTimelineEvent): string {
  return String(event.actionCue?.kind || '').trim().toLowerCase() || 'unknown';
}

function getPresentationKey(event: RoverTimelineEvent, text: string): string {
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

function extractKindFromKey(key: string | undefined): string {
  if (!key) return '';
  const colon = key.indexOf(':');
  return colon >= 0 ? key.slice(0, colon) : key;
}

function getToolPresentationPriority(event: RoverTimelineEvent): PendingPresentation['priority'] {
  const kind = getActionCueKind(event);
  if (LOW_VALUE_KINDS.has(kind)) return 'low';
  if (kind === 'scroll' && !event.actionCue?.primaryElementId) return 'low';
  if (kind === 'click' || kind === 'type' || kind === 'select' || kind === 'upload' || kind === 'navigate') return 'high';
  return 'normal';
}

function getResponseNarrationPriority(event: RoverTimelineEvent): PendingPresentation['priority'] {
  if (event.responseKind === 'final' || event.responseKind === 'question' || event.responseKind === 'error') return 'high';
  return 'normal';
}

export function resolveTimelineNarrationText(event: RoverTimelineEvent): string {
  try {
    const presentationText = event.presentation?.shouldNarrate === true
      ? normalizeNarrationText(event.presentation.speechText || event.presentation.displayText)
      : '';
    const explicit = normalizeNarrationText(event.narration) || presentationText;
    if (event.kind === 'tool_result') {
      // Speak the visitor-visible tool-output summary the worker derived from
      // `deriveResponseNarrationFromOutput` in actionUx.afterTool(). The
      // scheduler's gate still decides whether to actually speak it, based on
      // voiceStarted / presentationIntent / visitor toggle.
      return explicit;
    }
    if (event.kind === 'assistant_response') {
      return explicit || (event.narrationActive === true ? normalizeNarrationText(event.detail) : '');
    }
    return explicit;
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
  let pendingPresentations: PendingPresentation[] = [];
  let disposed = false;

  function cancelPendingPresentationFrame(): void {
    if (!pendingFrame) return;
    try { pendingFrame.cancel(); } catch { /* narration scheduling is best-effort */ }
    pendingFrame = null;
  }

  function cancelPendingPresentation(): void {
    cancelPendingPresentationFrame();
    pendingPresentations = [];
  }

  function estimatePendingMs(): number {
    return pendingPresentations.reduce((sum, item) => sum + item.estimatedMs, 0);
  }

  function enforcePresentationBudget(): void {
    let dropped = false;
    let droppedAnyHigh = false;
    while (
      pendingPresentations.length > MAX_PENDING_TOOL_PRESENTATIONS ||
      estimatePendingMs() > MAX_PENDING_PRESENTATION_SPEECH_MS
    ) {
      const lowPriorityIndex = pendingPresentations.findIndex(item => item.priority === 'low' && !item.catchUp);
      const normalPriorityIndex = pendingPresentations.findIndex(item => item.priority === 'normal' && !item.catchUp);
      const nonHighPriorityIndex = pendingPresentations.findIndex(item => item.priority !== 'high' && !item.catchUp);
      // When everything in the queue is 'high', drop the OLDEST high so we keep
      // describing the freshest action the visitor is currently watching.
      const oldestHighIndex = pendingPresentations.findIndex(item => item.priority === 'high' && !item.catchUp);
      const dropIndex = lowPriorityIndex >= 0
        ? lowPriorityIndex
        : normalPriorityIndex >= 0
          ? normalPriorityIndex
          : nonHighPriorityIndex >= 0
            ? nonHighPriorityIndex
            : oldestHighIndex >= 0
              ? oldestHighIndex
              : pendingPresentations.findIndex(item => !item.catchUp);
      if (dropIndex < 0) break;
      const removed = pendingPresentations.splice(dropIndex, 1)[0];
      if (removed?.priority === 'high') droppedAnyHigh = true;
      dropped = true;
    }
    // Only insert the catch-up "Continuing through the form" when we dropped
    // something the visitor would have noticed — i.e. at least one 'high'-
    // priority action narration. Dropping planner-level 'normal' lines is
    // invisible to the visitor (the ACT narration carries the same action) so
    // a robotic catch-up after every fast sequence would feel like a bug.
    if (dropped && droppedAnyHigh && !pendingPresentations.some(item => item.catchUp)) {
      pendingPresentations = [
        {
          text: CATCH_UP_PRESENTATION,
          mode: 'append',
          key: 'catch-up',
          priority: 'normal',
          source: 'action',
          catchUp: true,
          estimatedMs: estimateSpeechMs(CATCH_UP_PRESENTATION),
        },
        ...pendingPresentations.slice(-(MAX_PENDING_TOOL_PRESENTATIONS - 1)),
      ];
    }
    while (pendingPresentations.length > MAX_PENDING_TOOL_PRESENTATIONS) {
      pendingPresentations.splice(pendingPresentations.length - 1, 1);
    }
  }

  function scheduleFlush(): void {
    if (pendingFrame) return;
    pendingFrame = scheduleNextFrame(
      () => {
        pendingFrame = null;
        if (disposed || !opts.isEnabled()) {
          pendingPresentations = [];
          return;
        }
        const narrations = pendingPresentations;
        pendingPresentations = [];
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

  function appendToolPresentation(event: RoverTimelineEvent, text: string): void {
    const key = getPresentationKey(event, text);
    const priority = getToolPresentationPriority(event);
    const duplicateIndex = pendingPresentations.findIndex(item => item.key === key);
    if (duplicateIndex >= 0) {
      pendingPresentations[duplicateIndex] = {
        ...pendingPresentations[duplicateIndex],
        text,
        priority,
        estimatedMs: estimateSpeechMs(text),
      };
      enforcePresentationBudget();
      scheduleFlush();
      return;
    }
    // Same-kind collapse: when consecutive action narrations of the same kind
    // are queued (e.g., two clicks on different buttons within ~1 frame), keep
    // only the newest. The visitor can't usefully follow two clicks in
    // 800 ms anyway; the latter narration is the one tied to the action they
    // currently see. Applies only to 'action' source — final/response
    // narrations stay distinct.
    const incomingKind = extractKindFromKey(key);
    const sameKindIndex = incomingKind
      ? pendingPresentations.findIndex(item =>
          item.source === 'action'
          && !item.catchUp
          && extractKindFromKey(item.key) === incomingKind,
        )
      : -1;
    if (sameKindIndex >= 0) {
      pendingPresentations[sameKindIndex] = {
        ...pendingPresentations[sameKindIndex],
        text,
        key,
        priority,
        estimatedMs: estimateSpeechMs(text),
      };
      enforcePresentationBudget();
      scheduleFlush();
      return;
    }
    pendingPresentations.push({
      text,
      mode: 'append',
      key,
      priority,
      source: 'action',
      estimatedMs: estimateSpeechMs(text),
    });
    enforcePresentationBudget();
    scheduleFlush();
  }

  function appendResponseNarration(event: RoverTimelineEvent, text: string): void {
    const responseKind = event.responseKind || 'checkpoint';
    const priority = getResponseNarrationPriority(event);
    if (priority === 'high') {
      pendingPresentations = pendingPresentations.filter(item => item.priority !== 'low' && !item.catchUp);
    }
    const key = `response:${responseKind}:${text.toLowerCase().slice(0, 140)}`;
    const duplicateIndex = pendingPresentations.findIndex(item => item.key === key);
    if (duplicateIndex >= 0) {
      pendingPresentations[duplicateIndex] = {
        ...pendingPresentations[duplicateIndex],
        text,
        priority,
        estimatedMs: estimateSpeechMs(text),
      };
      enforcePresentationBudget();
      scheduleFlush();
      return;
    }
    pendingPresentations.push({
      text,
      mode: 'append',
      key,
      priority,
      source: 'response',
      estimatedMs: estimateSpeechMs(text),
    });
    enforcePresentationBudget();
    scheduleFlush();
  }

  const eventGate = (event: RoverTimelineEvent): boolean => (
    opts.shouldSpeakEvent ? opts.shouldSpeakEvent(event) : opts.isEnabled()
  );

  return {
    scheduleEvent(event: RoverTimelineEvent): void {
      try {
        if (disposed || !eventGate(event)) return;
        const text = resolveTimelineNarrationText(event);
        if (!text) return;
        if (event.kind === 'tool_start') {
          appendToolPresentation(event, text);
          return;
        }
        if (event.kind === 'tool_result') {
          // Tool-result narrations (visitor-visible result summaries derived by
          // the worker in actionUx.afterTool) route through the same tool-
          // presentation queue as tool_start so same-kind collapse, budget
          // caps, and catch-up logic apply uniformly.
          appendToolPresentation(event, text);
          return;
        }
        if (event.kind === 'assistant_response') {
          appendResponseNarration(event, text);
          return;
        }
        if (pendingPresentations.some(item => item.mode === 'append')) return;
        cancelPendingPresentation();
        pendingPresentations = [{
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
      cancelPendingPresentation();
    },
    dispose(): void {
      disposed = true;
      cancelPendingPresentation();
    },
  };
}
