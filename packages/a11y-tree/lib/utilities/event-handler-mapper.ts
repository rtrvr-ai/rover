// utilities/event-handler-mapper.ts

import { RTRVR_LISTENER_ATTRIBUTE } from '../mappings/role-mappings.js';
import { getSignalProvider } from './dom-utilities.js';

// Shared helper for numeric listener encoding (v2 only):
//   "id~mask36,id~mask36,..."

export type ParsedNumericListenerAttribute = {
  entries: Array<{ id: number; mask: number }>;
};

export const EventHandlerTypes = [
  'click',
  'dblclick',
  'doubleclick',
  'mousedown',
  'mouseup',
  'mouseenter',
  'mouseleave',
  'mousemove',
  'mouseover',
  'mouseout',
  'contextmenu',
  'auxclick',
  'keydown',
  'keyup',
  'keypress',
  'input',
  'change',
  'submit',
  'reset',
  'select',
  'search',
  'invalid',
  'beforeinput',
  'focus',
  'blur',
  'focusin',
  'focusout',
  'touchstart',
  'touchend',
  'touchmove',
  'touchcancel',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointercancel',
  'pointerover',
  'dragstart',
  'dragend',
  'drag',
  'dragenter',
  'dragleave',
  'dragover',
  'drop',
  'copy',
  'cut',
  'paste',
  'scroll',
  'wheel',
  'play',
  'pause',
  'ended',
  'volumechange',
  'seeking',
  'seeked',
  'animationstart',
  'animationend',
  'transitionend',
  'transitionstart',
  'resize',
  'toggle',
  'fullscreenchange',
  'load',
  'error',
  'abort',
  'beforeunload',
  'unload',
  'hashchange',
  'popstate',
  'storage',
  'message',
];

export type EventHandlerType = (typeof EventHandlerTypes)[number];

export const EventHandlerMap: Record<EventHandlerType, number> = {} as Record<EventHandlerType, number>;
EventHandlerTypes.forEach((type, index) => {
  EventHandlerMap[type] = index;
});

export const EventHandlerReverseMap: Record<number, EventHandlerType> = {};
EventHandlerTypes.forEach((type, index) => {
  EventHandlerReverseMap[index] = type;
});

/**
 * Parse compact numeric listener encoding (v2 only):
 * "id~mask36,id~mask36"
 */
export function parseNumericListenerAttribute(raw?: string | null): ParsedNumericListenerAttribute | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // v2 MUST contain "~" pairs
  if (!s.includes('~')) return null;

  const entries: Array<{ id: number; mask: number }> = [];
  for (const tok of s.split(',')) {
    if (!tok) continue;
    const [idS, maskS] = tok.split('~');
    const id = Number(idS);
    if (!Number.isFinite(id)) continue;
    const mask = maskS ? parseInt(maskS, 36) || 0 : 0;
    entries.push({ id, mask });
  }
  return entries.length ? { entries } : null;
}

export function decodeListenerAttribute(listenerAttr: string | null | undefined): number[] {
  const numeric = parseNumericListenerAttribute(listenerAttr);
  if (numeric) {
    // ids only (used for pattern inference)
    const out = new Set<number>();
    for (const { id } of numeric.entries) out.add(id);
    return [...out];
  }

  return [];
}

export function getEventHandlerTypesForElement(el: Element): string[] {
  const ids = getEventHandlerIdsForElement(el);

  return ids.map(num => EventHandlerReverseMap[num]).filter((t): t is EventHandlerType => !!t);
}

export function getEventHandlerIdsForElement(el: Element): number[] {
  const provider = getSignalProvider();
  if (provider?.getEventHandlerIds) {
    try {
      const ids = provider.getEventHandlerIds(el);
      if (ids && ids.length) return ids;
    } catch {
      // fall through to attr-based fallback
    }
  }
  const rawAttr = el.getAttribute(RTRVR_LISTENER_ATTRIBUTE);
  const ids = decodeListenerAttribute(rawAttr as string | null);

  if (!ids || ids.length === 0) return [];

  return ids;
}
