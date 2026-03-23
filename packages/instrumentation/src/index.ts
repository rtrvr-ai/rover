import { startRelayListeners } from './relay-listeners.js';

import type { ElementSignalProvider } from '@rover/a11y-tree';
import {
  EventHandlerReverseMap,
  RTRVR_LISTENER_ATTRIBUTE,
  RTRVR_ROLE_ATTRIBUTE,
  parseNumericListenerAttribute,
} from '@rover/a11y-tree';
import type { FrameworkElementMetadata, FrameworkName, ListenerSource } from '@rover/shared';
import { decodeListenerSourceMask } from '@rover/shared/lib/system-tools/wire.js';

export type InstrumentationOptions = {
  includeIframes?: boolean;
  scanInlineHandlers?: boolean;
  observeInlineMutations?: boolean;
};

export type InstrumentationController = {
  signalProvider: ElementSignalProvider;
  getFrameworkMetadata: (el: Element) => FrameworkElementMetadata;
  getListenerEncoding: (el: Element) => string | null;
  dispose: () => void;
};

let controller: InstrumentationController | null = null;
let started = false;

function getListenerEncoding(el: Element): string | null {
  try {
    return el.getAttribute(RTRVR_LISTENER_ATTRIBUTE);
  } catch {
    return null;
  }
}

function parseListenerEntries(el: Element): Array<{ id: number; mask: number }> {
  const raw = getListenerEncoding(el);
  const parsed = parseNumericListenerAttribute(raw);
  return parsed?.entries ?? [];
}

function getRoleHint(el: Element): string | null {
  try {
    const raw = el.getAttribute(RTRVR_ROLE_ATTRIBUTE);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

function getShadowRoot(el: Element): ShadowRoot | null {
  const win = (el as any)?.ownerDocument?.defaultView as any;
  const internalKey = win?.__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
  const internal = win?.[internalKey];
  const getter = internal?.shadow?.getRoot;
  if (typeof getter === 'function') {
    try {
      return getter(el) || null;
    } catch {
      // ignore
    }
  }
  return (el as any).shadowRoot || null;
}

function detectFrameworksFromMask(entries: Array<{ id: number; mask: number }>): Set<FrameworkName> {
  const out = new Set<FrameworkName>();
  for (const entry of entries) {
    const sources = decodeListenerSourceMask(entry.mask);
    for (const source of sources) {
      if (source === 'react' || source === 'vue' || source === 'angular' || source === 'svelte' || source === 'jquery') {
        out.add(source);
      }
    }
  }
  return out;
}

function detectFrameworksFromElement(el: Element): Set<FrameworkName> {
  const out = new Set<FrameworkName>();
  const anyEl = el as any;
  if (anyEl.__reactFiber || anyEl.__reactProps || anyEl.__reactInternalInstance || anyEl.__reactRootContainer) out.add('react');
  if (anyEl.__vue__ || anyEl.__vueParentComponent || anyEl.__vnode || anyEl.__vue_app__) out.add('vue');
  if (anyEl.__ngContext__) out.add('angular');
  if (anyEl.__svelte || anyEl.__svelte_meta) out.add('svelte');
  if (anyEl.__jquery || anyEl.jQuery) out.add('jquery');
  return out;
}

function getFrameworkMetadata(el: Element): FrameworkElementMetadata {
  const entries = parseListenerEntries(el);
  const frameworks = detectFrameworksFromMask(entries);
  const fallback = detectFrameworksFromElement(el);
  for (const fw of fallback) frameworks.add(fw);

  return {
    frameworks: [...frameworks],
    listenersRaw: getListenerEncoding(el) || '',
    role: getRoleHint(el) ?? (el.getAttribute?.('role') || null),
  };
}

function buildSignalProvider(): ElementSignalProvider {
  return {
    getEventHandlerIds: (el: Element) => parseListenerEntries(el).map(entry => entry.id),
    getRoleHint,
    getShadowRoot,
  };
}

export function installInstrumentation(_opts: InstrumentationOptions = {}): InstrumentationController {
  if (controller) return controller;

  controller = {
    signalProvider: buildSignalProvider(),
    getFrameworkMetadata,
    getListenerEncoding,
    dispose: () => {
      // relay listeners manages its own observers; nothing to tear down here.
    },
  };

  return controller;
}

export function startInstrumentation(): void {
  if (started) return;
  startRelayListeners();
  started = true;
}

export function getActiveInstrumentation(): InstrumentationController | null {
  return controller;
}

export function getListenerSourcesByType(el: Element): Map<string, Set<ListenerSource>> {
  const out = new Map<string, Set<ListenerSource>>();
  for (const entry of parseListenerEntries(el)) {
    const type = EventHandlerReverseMap[entry.id];
    if (!type) continue;
    const sources = decodeListenerSourceMask(entry.mask);
    if (!sources.length) continue;
    out.set(type, new Set(sources));
  }
  return out;
}
