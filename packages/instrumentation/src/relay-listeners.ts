// main-world-interactive-detector.ts in content-main
import {
  RTRVR_LISTENER_ATTRIBUTE,
  INTERACTIVE_SEMANTIC_ROLES,
  SemanticRoleMap,
  SemanticRole,
  RTRVR_ROLE_ATTRIBUTE,
  RTRVR_MAIN_WORLD_READY_ATTRIBUTE,
  CustomSemanticRole,
  getEventHandlerTypesForElement,
  CLICK_EQUIVALENTS,
  INPUT_EQUIVALENTS,
  DRAG_EQUIVALENTS,
  detectJavaScriptLink,
  STRUCTURAL_CONTAINER_ROLES,
  EventHandlerReverseMap,
  docOf,
  winOfDoc,
  winOf,
  isHTMLIFrameElementLike,
  isHTMLElementLike,
  isShadowRootLike,
  isElementLike,
  getDocumentElementFromTargetSafe,
  globalDocumentSafe,
} from '@rover/a11y-tree';
import { canUserEdit } from '@rover/a11y-tree';
import { EventHandlerMap, EventHandlerType } from '@rover/a11y-tree';
import { RTRVR_MAIN_WORLD_BUSY_ATTRIBUTE } from '@rover/a11y-tree';
import type { FrameworkName, ListenerSource } from '@rover/shared';

// Bit positions for ListenerSource + inferred; encoded as base-36 in attr
const enum ListenerSourceBit {
  Native = 1 << 0,
  Inline = 1 << 1,
  React = 1 << 2,
  Vue = 1 << 3,
  Angular = 1 << 4,
  Svelte = 1 << 5,
  JQuery = 1 << 6,
  Delegated = 1 << 7,
  Other = 1 << 8,
  Inferred = 1 << 9,
}

// Adjust keys to match your ListenerSource union from @rtrvr-ai/shared
const ListenerSourceBits: Partial<Record<ListenerSource, ListenerSourceBit>> = {
  native: ListenerSourceBit.Native,
  inline: ListenerSourceBit.Inline,
  react: ListenerSourceBit.React,
  vue: ListenerSourceBit.Vue,
  angular: ListenerSourceBit.Angular,
  svelte: ListenerSourceBit.Svelte,
  jquery: ListenerSourceBit.JQuery,
  delegated: ListenerSourceBit.Delegated,
  other: ListenerSourceBit.Other,
};

(() => {
  interface RtrvrListenerMeta {
    type: string;
    source: ListenerSource;
    capture?: boolean;
    passive?: boolean;
    once?: boolean;
    inferred?: boolean;
  }

  interface RtrvrElementInfo {
    frameworks: Set<FrameworkName>;
    listeners: Map<string, RtrvrListenerMeta[]>;
    role?: string | null;

    // Compact encoding: EventHandlerMap id -> ListenerSourceBit mask (per-type)
    listenerTypeMasks?: Map<number, number>;

    lastListenersSerialized?: string;
    lastRoleSerialized?: string;
  }

  interface RtrvrPageFrameworkInfo {
    frameworks: Set<FrameworkName>;
    // WeakSets avoid SPA leaks
    reactRoots: WeakSet<Element>;
    vueRoots: WeakSet<Element>;
    angularRoots: WeakSet<Element>;
    svelteRoots: WeakSet<Element>;
    jqueryRoots: WeakSet<Element>;
  }

  interface ExtendedWindow extends Window {
    __RTRVR_MAIN_WORLD_INITIALIZED__?: boolean;
    rtrvrAIMarkInteractiveElements?: () => boolean;
    jQuery?: any;
    ng?: { getComponent?: (element: Element) => any };
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: any;
    React?: any;
    Vue?: any;
  }

  interface FrameworkEnhancedElement extends Element {
    __reactInternalInstance?: any;
    __reactRootContainer?: any;
    __vue__?: any;
    __vue_app__?: any;
    _vnode?: any;
    __ngContext__?: any;
    __svelte__?: any;
  }

  type InferredRole = SemanticRole | CustomSemanticRole | null;

  const win = window as ExtendedWindow;

  const MAIN_WORLD_FLAG = '__RTRVR_MAIN_WORLD_INITIALIZED__';

  const elementInfoMap = new WeakMap<Element, RtrvrElementInfo>();

  const pageFrameworkInfo: RtrvrPageFrameworkInfo = {
    frameworks: new Set(),
    reactRoots: new WeakSet(),
    vueRoots: new WeakSet(),
    angularRoots: new WeakSet(),
    svelteRoots: new WeakSet(),
    jqueryRoots: new WeakSet(),
  };

  const eventTargetSummary = new WeakMap<
    EventTarget,
    Map<string, { count: number; capture?: boolean; passive?: boolean }>
  >();

  const jqueryDelegatedRegistry = new WeakMap<Element, { type: string; selector: string }[]>();

  const pendingAttributeUpdate = new Set<Element>();

  // Avoid exploding on pathological pages with thousands of closed roots / iframe docs.
  // Still generous enough to cover real apps.
  const MAX_OBSERVED_SHADOW_ROOTS = 500;
  const MAX_OBSERVED_IFRAME_DOCS = 200;
  let observedShadowRootCount = 0;
  let observedIframeDocCount = 0;

  // ---- per-realm hook installation (same-origin iframes) ----
  const hookedWindows = new WeakSet<Window>();
  const ET_HOOK_FLAG = '__RTRVR_ET_HOOKED__';
  const AS_HOOK_FLAG = '__RTRVR_ATTACH_SHADOW_HOOKED__';

  function installRealmHooksInWindow(w: Window | null | undefined): void {
    if (!w) return;
    if (hookedWindows.has(w)) return;
    hookedWindows.add(w);
    try {
      installEventTargetHooksInWindow(w);
    } catch {}
    try {
      installAttachShadowHookInWindow(w);
    } catch {}
  }

  function installEventTargetHooksInWindow(w: Window): void {
    try {
      const ET = (w as any).EventTarget;
      if (!ET?.prototype) return;
      if ((ET.prototype as any)[ET_HOOK_FLAG]) return;
      (ET.prototype as any)[ET_HOOK_FLAG] = true;

      const nativeAdd = ET.prototype.addEventListener;
      const nativeRemove = ET.prototype.removeEventListener;

      ET.prototype.addEventListener = function (type: string, listener: any, options?: any) {
        try {
          if (!isInternalListener(listener)) recordEventTargetListener(this, type, options);
        } catch {}
        return nativeAdd.call(this, type, listener, options);
      };

      ET.prototype.removeEventListener = function (type: string, listener: any, options?: any) {
        try {
          recordEventTargetRemove(this, type, options);
        } catch {}
        return nativeRemove.call(this, type, listener, options);
      };

      // Mask toString to reduce native-check breakage
      try {
        const nativeToString = Function.prototype.toString;
        (ET.prototype.addEventListener as any).toString = () => nativeToString.call(nativeAdd);
        (ET.prototype.removeEventListener as any).toString = () => nativeToString.call(nativeRemove);
      } catch {}
    } catch {}
  }

  function installAttachShadowHookInWindow(w: Window): void {
    try {
      const Elem = (w as any).Element;
      if (!Elem?.prototype?.attachShadow) return;
      if ((Elem.prototype as any)[AS_HOOK_FLAG]) return;
      (Elem.prototype as any)[AS_HOOK_FLAG] = true;

      const nativeAttach = Elem.prototype.attachShadow;
      Elem.prototype.attachShadow = function (init: ShadowRootInit) {
        const root = nativeAttach.call(this, init);
        try {
          capturedShadowRoots.set(this as any, root);
        } catch {}
        try {
          observeShadowRoot(root);
        } catch {}
        return root;
      };

      try {
        const nativeToString = Function.prototype.toString;
        (Elem.prototype.attachShadow as any).toString = () => nativeToString.call(nativeAttach);
      } catch {}
    } catch {}
  }

  function getEventTypesFast(el: Element): string[] {
    // Prefer internal info (captures newly discovered listeners before attrs are written)
    const info = elementInfoMap.get(el);
    const m = info?.listenerTypeMasks;
    if (m && m.size) {
      const out: string[] = [];
      for (const id of m.keys()) {
        const t = EventHandlerReverseMap[id];
        if (t) out.push(t);
      }
      return out;
    }
    // Fallback to attribute-based decoding
    return getEventHandlerTypesForElement(el);
  }

  const OBSERVED_ATTRS = [
    'onclick',
    'ondblclick',
    'ondoubleclick',
    'onmousedown',
    'onmouseup',
    'role',
    'contenteditable',
    'draggable',
    'tabindex',
    'disabled',
    'type',
    'aria-haspopup',
    'aria-expanded',
    'data-click',
    'data-action',
    'data-handler',
    'data-toggle',
    'data-target',
    // 'class' handled conditionally (see below)
  ] as const;

  // top-level in main-world
  let pendingScanCount = 0;
  const pendingElementScan = new Set<Element>();

  const MAX_RUNTIME_PATH_NODES = 6;

  const RUNTIME_TIER1 = [
    'click',
    'input',
    'change',
    'keydown',
    'keyup',
    'pointerdown',
    'pointerup',
    'submit',
    'focus',
    'blur',
  ];
  const RUNTIME_TIER2 = [
    'mouseenter',
    'mouseleave',
    'mouseover',
    'mouseout',
    'mousedown',
    'mouseup',
    'wheel',
    'scroll',
    'dragstart',
    'drop',
    'touchstart',
    'touchend',
  ];

  if (win[MAIN_WORLD_FLAG]) {
    if (typeof win.rtrvrAIMarkInteractiveElements === 'function') {
      win.rtrvrAIMarkInteractiveElements();
    }
    return;
  }
  win[MAIN_WORLD_FLAG] = true;

  const eventPropertyToListenerTypeMap: Record<string, string> = {
    onclick: 'click',
    ondblclick: 'dblclick',
    ondoubleclick: 'doubleclick',
    onmousedown: 'mousedown',
    onmouseup: 'mouseup',
    onmouseenter: 'mouseenter',
    onmouseleave: 'mouseleave',
    onmousemove: 'mousemove',
    onmouseover: 'mouseover',
    onmouseout: 'mouseout',
    oncontextmenu: 'contextmenu',
    onauxclick: 'auxclick',

    onkeydown: 'keydown',
    onkeyup: 'keyup',
    onkeypress: 'keypress',

    oninput: 'input',
    onchange: 'change',
    onsubmit: 'submit',
    onreset: 'reset',
    onselect: 'select',
    onsearch: 'search',
    oninvalid: 'invalid',
    onbeforeinput: 'beforeinput',

    onfocus: 'focus',
    onblur: 'blur',
    onfocusin: 'focusin',
    onfocusout: 'focusout',

    ontouchstart: 'touchstart',
    ontouchend: 'touchend',
    ontouchmove: 'touchmove',
    ontouchcancel: 'touchcancel',

    onpointerdown: 'pointerdown',
    onpointerup: 'pointerup',
    onpointermove: 'pointermove',
    onpointerenter: 'pointerenter',
    onpointerleave: 'pointerleave',
    onpointercancel: 'pointercancel',
    onpointerover: 'pointerover',

    ondragstart: 'dragstart',
    ondragend: 'dragend',
    ondrag: 'drag',
    ondragenter: 'dragenter',
    ondragleave: 'dragleave',
    ondragover: 'dragover',
    ondrop: 'drop',

    oncopy: 'copy',
    oncut: 'cut',
    onpaste: 'paste',

    onscroll: 'scroll',
    onwheel: 'wheel',

    onplay: 'play',
    onpause: 'pause',
    onended: 'ended',
    onvolumechange: 'volumechange',
    onseeking: 'seeking',
    onseeked: 'seeked',

    onanimationstart: 'animationstart',
    onanimationend: 'animationend',
    ontransitionend: 'transitionend',
    ontransitionstart: 'transitionstart',

    onresize: 'resize',
    ontoggle: 'toggle',
    onfullscreenchange: 'fullscreenchange',

    onload: 'load',
    onerror: 'error',
    onabort: 'abort',
    onbeforeunload: 'beforeunload',
    onunload: 'unload',
    onhashchange: 'hashchange',
    onpopstate: 'popstate',
    onstorage: 'storage',
    onmessage: 'message',
  };

  function normalizeEventType(type: string): string {
    if (!type) return '';
    // jQuery namespaces: "click.foo"
    const base = String(type).split('.')[0];
    return base.toLowerCase();
  }

  // heuristic hints you had in old code
  const INTERACTIVE_DATA_ATTRIBUTES = [
    'data-click',
    'data-action',
    'data-event',
    'data-handler',
    'data-on-click',
    'data-onclick',
    'data-tap',
    'data-press',
    'data-toggle',
    'data-target',
  ];

  type FlushScanMode = 'priority' | 'full';

  interface FlushScanOptions {
    mode?: FlushScanMode;
    includeShadow?: boolean;
    includeSameOriginIframes?: boolean;
    budgetMs?: number; // time slice for this invocation
    /**
     * Hard wall-clock deadline (epoch ms). If present, we MUST NOT exceed it.
     * IMPORTANT: on deadline exhaustion, we return partial progress (never throw).
     * This is used by the extension to enforce overall page-data budgets.
     */
    deadlineEpochMs?: number;
  }

  interface FlushScanResult {
    revision: number;
    scanned: number;
    durationMs: number;
    done: boolean;
    remaining: number;
  }

  let flushRevision = 0;
  let flushInFlight: Promise<FlushScanResult> | null = null;

  // Yield primitive that is NOT a timer
  const yieldChan = new MessageChannel();
  let yieldResolvers: Array<() => void> = [];
  yieldChan.port1.onmessage = () => {
    const r = yieldResolvers.shift();
    if (r) r();
  };

  // ---- wall-clock helpers (bg-safe, timer-independent) ----
  function nowEpochMs(): number {
    return Date.now();
  }
  function timeLeftMs(deadlineEpochMs?: number): number {
    if (!deadlineEpochMs || !Number.isFinite(deadlineEpochMs)) return Number.POSITIVE_INFINITY;
    return Math.max(0, deadlineEpochMs - nowEpochMs());
  }

  // ------------------ scheduler: no timers ------------------
  const WORK_CHUNK_BUDGET_MS = 8; // keep UI responsive in active tabs; still runs in bg tabs
  const workChan = new MessageChannel();
  let workScheduled = false;

  function scheduleWorkFlush(): void {
    if (workScheduled) return;
    workScheduled = true;
    try {
      workChan.port2.postMessage(0);
    } catch {
      // If MessageChannel fails, do nothing (never break host page).
      // Flush will still happen during explicit flushScan barrier.
    }
  }

  function takeOne<T>(set: Set<T>): T | null {
    const it = set.values().next();
    if (it.done) return null;
    const v = it.value;
    set.delete(v);
    return v;
  }

  function yieldToEventLoop(): Promise<void> {
    return new Promise<void>(resolve => {
      yieldResolvers.push(resolve);
      yieldChan.port2.postMessage(0);
    });
  }

  let jqInstalled = false;

  function maybeInstallJQueryHooks(): void {
    if (jqInstalled) return;
    try {
      const $ = win.jQuery;
      if ($ && $.fn) {
        installJQueryHooks($);
        jqInstalled = true;
        setPageFrameworkFlag('jquery');
      }
    } catch {
      // never break host
    }
  }

  function pushElementChildrenReverse(stack: Array<Element | ShadowRoot>, el: Element): void {
    // Light DOM children
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) {
      stack.push(c);
    }
  }

  function tryPushOpenShadow(stack: Array<Element | ShadowRoot>, el: Element, includeShadow: boolean): void {
    if (!includeShadow) return;
    try {
      const sr = getAnyShadowRoot(el);
      if (sr) stack.push(sr);
    } catch {}
  }

  function tryPushIframeDoc(stack: Array<Element | ShadowRoot>, el: Element, includeIframes: boolean): void {
    if (!includeIframes) return;
    if (!isHTMLIFrameElementLike(el)) return;
    try {
      const cw = el.contentWindow || null;
      if (cw) installRealmHooksInWindow(cw);
      const docEl = cw?.document?.documentElement;
      if (docEl) stack.push(docEl);
    } catch {
      // cross-origin
    }
  }

  const INTERNAL_LISTENERS = new WeakSet<object>();
  function markInternalListener(l: any) {
    if (!l) return;
    if (typeof l === 'function') INTERNAL_LISTENERS.add(l);
    else if (typeof l === 'object') INTERNAL_LISTENERS.add(l);
  }
  function isInternalListener(l: any): boolean {
    return !!l && (typeof l === 'function' || typeof l === 'object') && INTERNAL_LISTENERS.has(l);
  }

  workChan.port1.onmessage = () => {
    workScheduled = false;
    pruneDisconnected(500);

    const start = performance.now();

    // 1) element scans
    while (pendingElementScan.size && performance.now() - start < WORK_CHUNK_BUDGET_MS) {
      const node = takeOne(pendingElementScan);
      if (!node) break;

      try {
        scanElementInteractiveData(node);
      } catch {
        // never break host page
      } finally {
        pendingScanCount = Math.max(0, pendingScanCount - 1);
      }
    }

    // 2) attribute updates
    while (pendingAttributeUpdate.size && performance.now() - start < WORK_CHUNK_BUDGET_MS) {
      const el = takeOne(pendingAttributeUpdate);
      if (!el) break;

      try {
        updateElementAttributesFromInfo(el);
      } catch {}
    }

    setBusyFlag();

    if (pendingElementScan.size || pendingAttributeUpdate.size) {
      scheduleWorkFlush();
    }
  };

  function setBusyFlag() {
    try {
      const html = globalDocumentSafe()?.documentElement;
      if (!html) return;
      html.setAttribute(RTRVR_MAIN_WORLD_BUSY_ATTRIBUTE, String(pendingScanCount));
    } catch {
      // never break host page
    }
  }

  function getOrCreateElementInfo(el: Element): RtrvrElementInfo {
    let info = elementInfoMap.get(el);
    if (!info) {
      info = { frameworks: new Set(), listeners: new Map() };
      elementInfoMap.set(el, info);
    }
    return info;
  }

  function scheduleAttributeUpdate(el: Element): void {
    pendingAttributeUpdate.add(el);
    scheduleWorkFlush();
  }

  function scheduleElementScan(el: Element): void {
    if (pendingElementScan.has(el)) return; // ✅ de-dupe
    pendingElementScan.add(el);
    pendingScanCount++;
    setBusyFlag();
    scheduleWorkFlush();

    // Prevent unbounded retention on virtualized feeds
    if (pendingElementScan.size > 8000) pruneDisconnected(3000);
  }

  function pruneDisconnected(limit = 2000) {
    let n = 0;
    for (const el of pendingElementScan) {
      if (n > limit) break;
      if (!el.isConnected) {
        pendingElementScan.delete(el);
        pendingScanCount = Math.max(0, pendingScanCount - 1);
      }
    }
    n = 0;
    for (const el of pendingAttributeUpdate) {
      if (n > limit) break;
      if (!el.isConnected) pendingAttributeUpdate.delete(el);
    }
    setBusyFlag();
  }

  type NodeLike = Element | ShadowRoot;

  type FlushState = {
    optsKey: string;
    stack: NodeLike[];
    scannedTotal: number;
  };

  let flushState: FlushState | null = null;

  function makeOptsKey(mode: FlushScanMode, includeShadow: boolean, includeIframes: boolean): string {
    return `${mode}|${includeShadow ? 1 : 0}|${includeIframes ? 1 : 0}`;
  }

  function isCandidate(el: Element): boolean {
    const tag = el.tagName;
    if (
      tag === 'A' ||
      tag === 'BUTTON' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      tag === 'SUMMARY'
    )
      return true;

    if (el.hasAttribute('role') || el.hasAttribute('tabindex') || el.hasAttribute('contenteditable')) return true;
    if (el.hasAttribute('onclick') || el.getAttributeNames().some(n => n.startsWith('on'))) return true;

    // your heuristic attrs
    for (const a of INTERACTIVE_DATA_ATTRIBUTES) if (el.hasAttribute(a)) return true;

    if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded')) return true;

    return false;
  }

  function isFrameworkHint(el: Element): boolean {
    const winEl = winOf(el);
    if (!isHTMLElementLike(el, winEl)) return false;
    const tag = el.tagName;
    if (tag !== 'DIV' && tag !== 'SPAN' && tag !== 'LI' && tag !== 'SECTION' && tag !== 'ARTICLE' && tag !== 'P')
      return false;

    const e = el as any;
    if (e.__ngContext__ || e.__svelte__ || e.__vue__ || e._vnode) return true;

    // React: cheap probes first
    if (e.__reactFiber$ || e.__reactProps$) return true;

    // Fallback: bounded key scan
    let seen = 0;
    for (const k in e) {
      if (++seen > 30) break;
      if (k.startsWith('__react') || k.includes('reactFiber') || k.includes('reactProps')) return true;
    }
    return false;
  }

  function pageHasFrameworkNow(): boolean {
    const html = globalDocumentSafe()?.documentElement;
    if (!html) return false;
    return (
      pageFrameworkInfo.frameworks.size > 0 ||
      html.hasAttribute('rtrvr-react') ||
      html.hasAttribute('rtrvr-vue') ||
      html.hasAttribute('rtrvr-angular') ||
      html.hasAttribute('rtrvr-svelte') ||
      html.hasAttribute('rtrvr-jquery')
    );
  }

  function drainQueuesFor(ms: number): void {
    const start = performance.now();
    while (pendingElementScan.size && performance.now() - start < ms) {
      const n = takeOne(pendingElementScan);
      if (!n) break;
      try {
        scanElementInteractiveData(n);
      } catch {
      } finally {
        pendingScanCount = Math.max(0, pendingScanCount - 1);
      }
    }
    while (pendingAttributeUpdate.size && performance.now() - start < ms) {
      const e = takeOne(pendingAttributeUpdate);
      if (!e) break;
      try {
        updateElementAttributesFromInfo(e);
      } catch {}
    }
  }

  async function doFlushScan(opts: FlushScanOptions = {}): Promise<FlushScanResult> {
    pruneDisconnected(3000);
    maybeInstallJQueryHooks();
    detectFrameworksFromGlobals();

    const mode: FlushScanMode = opts.mode ?? 'full';
    const includeShadow = opts.includeShadow ?? true;
    const includeIframes = opts.includeSameOriginIframes ?? true;
    const hardBudgetMs = Math.max(50, Math.min(opts.budgetMs ?? 2500, 15000));
    const deadlineEpochMs = opts.deadlineEpochMs;
    const budgetMs = Math.max(0, Math.min(hardBudgetMs, timeLeftMs(deadlineEpochMs)));
    const key = makeOptsKey(mode, includeShadow, includeIframes);

    // If caller budget is already exhausted, do NOT throw. Return a “partial/unchanged” result.
    if (budgetMs <= 0) {
      const remaining = (flushState?.stack?.length ?? 0) + pendingElementScan.size + pendingAttributeUpdate.size;
      return {
        revision: ++flushRevision,
        scanned: 0,
        durationMs: 0,
        done: remaining === 0,
        remaining,
      };
    }

    // Only run the secondary framework sweep when we’re about to start a new traversal.
    // (Running it every pass adds overhead during multi-pass flushScan.)
    const startingNewTraversal = !flushState || flushState.optsKey !== key;
    if (startingNewTraversal) {
      // Deadline-aware: if we don't have time for a sweep, skip it (never fail the scan).
      if (timeLeftMs(deadlineEpochMs) > 30) {
        await secondaryScanIfNeeded({ budgetMs: 18, deadlineEpochMs });
      }
    }

    if (mode === 'priority') {
      const start = performance.now();
      let scanned = 0;

      // Drain pending scans first (bounded by budget)
      while (pendingElementScan.size && performance.now() - start <= budgetMs) {
        if (deadlineEpochMs && timeLeftMs(deadlineEpochMs) <= 0) break;
        const node = takeOne(pendingElementScan);
        if (!node) break;
        try {
          scanElementInteractiveData(node);
        } catch {}
        scanned++;
        pendingScanCount = Math.max(0, pendingScanCount - 1);
      }

      // Drain attribute updates (bounded)
      while (pendingAttributeUpdate.size && performance.now() - start <= budgetMs) {
        if (deadlineEpochMs && timeLeftMs(deadlineEpochMs) <= 0) break;
        const e = takeOne(pendingAttributeUpdate);
        if (!e) break;
        try {
          updateElementAttributesFromInfo(e);
        } catch {}
      }

      setBusyFlag();

      return {
        revision: ++flushRevision,
        scanned,
        durationMs: performance.now() - start,
        done: pendingElementScan.size === 0 && pendingAttributeUpdate.size === 0,
        remaining: pendingElementScan.size + pendingAttributeUpdate.size,
      };
    }

    if (!flushState || flushState.optsKey !== key) {
      const root = globalDocumentSafe()?.documentElement;
      flushState = { optsKey: key, stack: root ? [root] : [], scannedTotal: 0 };
    }

    const start = performance.now();
    let scannedThisPass = 0;

    pendingScanCount++;
    setBusyFlag();

    while (flushState.stack.length) {
      if (deadlineEpochMs && timeLeftMs(deadlineEpochMs) <= 0) break;

      const node = flushState.stack.pop()!;

      if (isShadowRootLike(node)) {
        const kids = (node as ShadowRoot).children;
        for (let i = kids.length - 1; i >= 0; i--) flushState.stack.push(kids[i]);
        continue;
      }

      const el = node as Element;
      if (!el || el.nodeType !== 1) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META' || el.tagName === 'NOSCRIPT')
        continue;

      try {
        if (mode === 'full') {
          // Only do candidate work, no full traversal cost
          if (isCandidate(el) || (pageHasFrameworkNow() && isFrameworkHint(el))) {
            scanElementInteractiveData(el);
          }
        } else {
          // full traversal, but only expensive work on candidates (plus framework hints)
          if (isCandidate(el) || (pageHasFrameworkNow() && isFrameworkHint(el))) {
            scanElementInteractiveData(el);
          }
        }
      } catch {
        /* never break host */
      }

      // Barrier semantics: write attrs now for anything we touched
      try {
        updateElementAttributesFromInfo(el);
      } catch {}

      // If this element was queued from mutations, scanning it here makes the queue entry redundant.
      if (pendingElementScan.delete(el)) {
        pendingScanCount = Math.max(0, pendingScanCount - 1);
      }
      pendingAttributeUpdate.delete(el);

      scannedThisPass++;
      flushState.scannedTotal++;

      // descend
      if (includeShadow) {
        try {
          const sr = getAnyShadowRoot(el);
          if (sr) {
            observeShadowRoot(sr);
            flushState.stack.push(sr);
          }
        } catch {}
      }

      if (includeIframes && isHTMLIFrameElementLike(el)) {
        try {
          const cw = el.contentWindow || null;
          if (cw) installRealmHooksInWindow(cw);
          const doc = cw?.document;
          const docEl = doc?.documentElement;
          if (doc && docEl) {
            observeFrameDocument(doc);
            flushState.stack.push(docEl);
          }
        } catch {}
      }

      for (let c = el.lastElementChild; c; c = c.previousElementSibling) flushState.stack.push(c);

      // Yield is great for responsiveness, but when we're near deadline, we skip it.
      if (scannedThisPass % 800 === 0 && timeLeftMs(deadlineEpochMs) > 20) {
        await yieldToEventLoop();
      }
    }

    // deterministically drain queues (optional)
    const remainingBudget = Math.max(0, budgetMs - (performance.now() - start));
    const remainingDeadline = timeLeftMs(deadlineEpochMs);
    drainQueuesFor(Math.min(250, remainingBudget, remainingDeadline));

    pendingScanCount = Math.max(0, pendingScanCount - 1);
    setBusyFlag();

    const done = flushState.stack.length === 0;
    const remaining = flushState.stack.length;

    if (done) flushState = null;

    return {
      revision: ++flushRevision,
      scanned: scannedThisPass,
      durationMs: performance.now() - start,
      done,
      remaining,
    };
  }

  async function flushScan(opts: FlushScanOptions = {}): Promise<FlushScanResult> {
    // serialize concurrent callers
    if (flushInFlight) return flushInFlight;
    flushInFlight = doFlushScan(opts).finally(() => {
      flushInFlight = null;
    });
    return flushInFlight;
  }

  // Expose for internal debugging if you want
  (win as any).rtrvrAIFlushScan = flushScan;

  const INTERNAL_KEY = '__RTRVR_INTERNAL__';
  // expose key name so background can probe consistently
  (Object(window) as any).__RTRVR_INTERNAL_KEY__ = INTERNAL_KEY;

  const existing = (win as any)[INTERNAL_KEY];
  const internal = existing && typeof existing === 'object' ? existing : {};
  if (!existing) {
    try {
      Object.defineProperty(win, INTERNAL_KEY, {
        value: internal,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch {}
  }

  try {
    Object.defineProperty(internal, 'flushScan', {
      value: flushScan,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {}

  function addListenerMeta(el: Element, meta: RtrvrListenerMeta): void {
    const info = getOrCreateElementInfo(el);
    const type = normalizeEventType(meta.type);
    if (!type) return;

    let changed = false;

    // ---- detailed map (for debugging / future) ----
    let metas = info.listeners.get(type);
    if (!metas) {
      metas = [];
      info.listeners.set(type, metas);
      changed = true;
    }

    const exists = metas.find(m => m.source === meta.source && !!m.inferred === !!meta.inferred);
    if (exists) {
      const prevCapture = !!exists.capture;
      const prevPassive = !!exists.passive;
      const prevOnce = !!exists.once;
      exists.capture = exists.capture || meta.capture;
      exists.passive = exists.passive || meta.passive;
      exists.once = exists.once || meta.once;
      if (prevCapture !== !!exists.capture || prevPassive !== !!exists.passive || prevOnce !== !!exists.once) {
        changed = true;
      }
    } else {
      metas.push({ ...meta, type });
      changed = true;
    }

    // ---- compact encoding bookkeeping (per-type masks) ----
    const id = EventHandlerMap[type as EventHandlerType];
    if (id !== undefined) {
      if (!info.listenerTypeMasks) info.listenerTypeMasks = new Map<number, number>();

      let mask = 0;
      const srcBit = ListenerSourceBits[meta.source];
      mask |= srcBit !== undefined ? srcBit : ListenerSourceBit.Other;
      if (meta.inferred) mask |= ListenerSourceBit.Inferred;

      const prev = info.listenerTypeMasks.get(id) || 0;
      const next = prev | mask;
      if (next !== prev) {
        info.listenerTypeMasks.set(id, next);
        changed = true;
      }
    }

    // listener changes can change inferred role
    if (changed) {
      info.role = undefined;
      scheduleAttributeUpdate(el);
    }
  }

  function serializeListenerInfo(info: RtrvrElementInfo): string | null {
    const m = info.listenerTypeMasks;
    if (!m || m.size === 0) return null;
    const entries = [...m.entries()].sort((a, b) => a[0] - b[0]);
    return entries.map(([id, mask]) => `${id}~${(mask || 0).toString(36)}`).join(',');
  }

  function markElementFramework(el: Element, fw: FrameworkName): void {
    const info = getOrCreateElementInfo(el);
    if (!info.frameworks.has(fw)) {
      info.frameworks.add(fw);
      scheduleAttributeUpdate(el);
    }
  }

  function setPageFrameworkFlag(fw: FrameworkName): void {
    if (!pageFrameworkInfo.frameworks.has(fw)) {
      pageFrameworkInfo.frameworks.add(fw);
      globalDocumentSafe()?.documentElement?.setAttribute(`rtrvr-${fw}`, '1');
    }
  }

  function updateElementAttributesFromInfo(el: Element) {
    const info = elementInfoMap.get(el);
    if (!info) return;

    // If this update was queued, consider it done now.
    pendingAttributeUpdate.delete(el);

    // ---- listeners: compact encoded string ----
    const encoded = serializeListenerInfo(info);
    if (encoded) {
      if (encoded !== info.lastListenersSerialized) {
        el.setAttribute(RTRVR_LISTENER_ATTRIBUTE, encoded);
        info.lastListenersSerialized = encoded;
      }
    } else if (info.lastListenersSerialized) {
      el.removeAttribute(RTRVR_LISTENER_ATTRIBUTE);
      info.lastListenersSerialized = undefined;
    }

    // ---- frameworks no need to set the attr on tree ----

    // ---- semantic role (unchanged) ----
    const winEl = winOf(el);
    if (isHTMLElementLike(el, winEl)) {
      if (info.role === undefined) info.role = inferSemanticRole(el);
      if (info.role) {
        const idx = SemanticRoleMap[info.role as SemanticRole];
        const roleEncoded = typeof idx === 'number' ? String(idx) : `s:${info.role}`;

        if (roleEncoded !== info.lastRoleSerialized) {
          el.setAttribute(RTRVR_ROLE_ATTRIBUTE, roleEncoded);
          info.lastRoleSerialized = roleEncoded;
        }
      } else {
        // ✅ remove stale role
        if (info.lastRoleSerialized || el.hasAttribute(RTRVR_ROLE_ATTRIBUTE)) {
          el.removeAttribute(RTRVR_ROLE_ATTRIBUTE);
          info.lastRoleSerialized = undefined;
        }
      }
    }
  }

  function buildFallbackPath(target: EventTarget | null): EventTarget[] {
    const path: EventTarget[] = [];
    let node: any = target;
    while (node) {
      path.push(node);
      node = node.parentNode || node.host;
    }
    return path;
  }

  function isSemanticallyInteractive(el: HTMLElement): boolean {
    // DO NOT exclude aria-hidden; we represent it as state but keep coverage.

    const tag = el.tagName.toLowerCase();
    const roleAttr = el.getAttribute('role');
    const ariaRole = roleAttr ? roleAttr.toLowerCase().trim() : '';

    // 1. Explicit interactive ARIA role
    if (ariaRole && INTERACTIVE_SEMANTIC_ROLES.has(ariaRole as any)) {
      return true;
    }

    // 2. Native controls
    if (tag === 'button') return true;
    if ((tag === 'a' || tag === 'area') && el.hasAttribute('href')) return true;

    if (tag === 'input') {
      const typeAttr = (el as HTMLInputElement).type?.toLowerCase();
      if (typeAttr === 'hidden') return false;
      return true; // any visible input is interactive from agent PoV
    }

    if (tag === 'select' || tag === 'textarea') return true;

    // custom "media" widgets with controls
    if ((tag === 'video' || tag === 'audio') && el.hasAttribute('controls')) {
      return true;
    }

    // 3. Editable regions
    if (el.isContentEditable || el.hasAttribute('contenteditable')) {
      return true;
    }

    // 4. Focusable + click handlers (custom widgets)
    const tabindexAttr = el.getAttribute('tabindex');
    const tabbable = tabindexAttr !== null && !Number.isNaN(Number.parseInt(tabindexAttr, 10));

    if (tabbable) {
      const eventTypes = getEventTypesFast(el);
      if (eventTypes.some(t => CLICK_EQUIVALENTS.has(t))) {
        return true;
      }

      // inline handlers as a last resort
      if (el.getAttributeNames().some(n => n.startsWith('on'))) {
        return true;
      }
    }

    return false;
  }

  function hasInteractiveDescendant(root: HTMLElement, maxDepth = 10, maxNodes = 600): boolean {
    // seed with children, not the root itself
    const stack: Array<{ node: HTMLElement; depth: number }> = [];
    for (let i = 0; i < root.children.length; i++) {
      stack.push({ node: root.children[i] as HTMLElement, depth: 1 });
    }

    let visited = 0;

    while (stack.length) {
      const { node, depth } = stack.pop()!;

      if (++visited > maxNodes) {
        // Conservative: assume there *is* an interactive descendant to avoid wrong promotion
        return true;
      }

      // Skip aria-hidden subtrees
      // We represent aria-hidden so we consider it
      // if (node.getAttribute('aria-hidden') === 'true') {
      //   continue;
      // }

      if (isSemanticallyInteractive(node)) {
        return true;
      }

      if (depth >= maxDepth) {
        continue;
      }

      // DFS into children
      for (let i = 0; i < node.children.length; i++) {
        stack.push({ node: node.children[i] as HTMLElement, depth: depth + 1 });
      }
    }

    return false;
  }

  /**
   * Best-effort interactive role inference from main world.
   *
   * Contract:
   *   - Only returns roles from the SemanticRole universe (incl. custom 'media', 'code').
   *   - Returns null instead of "generic"/"other"/"focusable".
   *   - Favors explicit ARIA and native HTML semantics over heuristics.
   */
  function inferSemanticRole(el: HTMLElement): InferredRole {
    const tag = el.tagName.toLowerCase();
    const roleAttr = el.getAttribute('role');
    const ariaRole = roleAttr ? roleAttr.toLowerCase().trim() : '';
    const typeAttr = (el as HTMLInputElement).type?.toLowerCase();

    // 1. Explicit interactive ARIA roles win
    if (ariaRole && INTERACTIVE_SEMANTIC_ROLES.has(ariaRole as any)) {
      return ariaRole as SemanticRole;
    }

    // Explicit structural landmark? Don't override into a widget.
    if (ariaRole && STRUCTURAL_CONTAINER_ROLES.has(ariaRole)) {
      return null;
    }

    // 2. Deterministic native semantics
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';

    if (tag === 'input') {
      if (typeAttr === 'hidden') return null;
      if (typeAttr === 'checkbox') return 'checkbox';
      if (typeAttr === 'radio') return 'radio';
      if (typeAttr === 'range') return 'slider';
      if (typeAttr === 'number') return 'spinbutton';
      if (typeAttr === 'search') return 'searchbox';
      if (['button', 'submit', 'reset', 'image', 'file'].includes(typeAttr)) return 'button';
      if (el.hasAttribute('list')) return 'combobox';
      return 'textbox';
    }

    if (tag === 'textarea') return 'textbox';

    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      return select.multiple || (select.size && select.size > 1) ? 'listbox' : 'combobox';
    }

    if (tag === 'option') return 'option';
    if (tag === 'form') return 'form';

    if (tag === 'video' || tag === 'audio') {
      const handlers = getEventHandlerTypesForElement(el);
      if (el.hasAttribute('controls') || handlers.length > 0) return 'media';
      return null;
    }

    if (el.isContentEditable || el.hasAttribute('contenteditable')) {
      return 'textbox';
    }

    // 3. Listener-based heuristics for generic elements
    const eventTypes = getEventTypesFast(el);
    if (!eventTypes.length) {
      return null;
    }

    let hasClick = false;
    let hasInput = false;
    let hasDrag = false;

    for (let i = 0; i < eventTypes.length; i++) {
      const t = eventTypes[i];
      if (!hasClick && CLICK_EQUIVALENTS.has(t)) hasClick = true;
      if (!hasInput && INPUT_EQUIVALENTS.has(t)) hasInput = true;
      if (!hasDrag && DRAG_EQUIVALENTS.has(t)) hasDrag = true;
    }

    if (!hasClick && !hasInput && !hasDrag) {
      return null;
    }

    const tabindexAttr = el.getAttribute('tabindex');
    const tabbable = tabindexAttr !== null && !Number.isNaN(Number.parseInt(tabindexAttr, 10));

    // 3a. JS-link style controls
    if (hasClick && (detectJavaScriptLink(el) || el.getAttribute('href') || el.closest('a[href]'))) {
      return 'link';
    }

    // 3b. Input-like generics
    if (hasInput) {
      if (el.isContentEditable || el.hasAttribute('contenteditable')) {
        return 'textbox';
      }

      if (ariaRole === 'textbox' || ariaRole === 'searchbox' || ariaRole === 'combobox' || ariaRole === 'spinbutton') {
        return ariaRole as SemanticRole;
      }

      if (!hasClick && tabbable) {
        return 'textbox';
      }

      // Otherwise: ambiguous → let it just be a node with actions, no forced role.
    }

    // 3c. Click-driven generics → button *unless* there's a more specific descendant
    if (hasClick) {
      const ariaChecked = el.getAttribute('aria-checked');
      const ariaPressed = el.getAttribute('aria-pressed');

      if (ariaChecked !== null || ariaPressed !== null) {
        if (ariaRole === 'radio') return 'radio';
        if (ariaRole === 'menuitemradio') return 'menuitemradio';
        if (ariaRole === 'menuitemcheckbox') return 'menuitemcheckbox';
        if (ariaPressed !== null) return 'button';
        if (ariaChecked !== null) return 'checkbox';
      }

      const isExplicitButton = ariaRole === 'button';

      // NEW: only promote generic containers that are actually focusable or explicitly role=button
      const canPromoteToButton = tabbable || isExplicitButton;

      if (canPromoteToButton && !hasInteractiveDescendant(el)) {
        return 'button';
      }
    }

    // 3d. Drag-heavy surfaces
    if (hasDrag) {
      return 'application';
    }

    return null;
  }

  // ---------- addEventListener instrumentation ----------
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;

  function parseOptions(options?: boolean | AddEventListenerOptions) {
    let capture = false;
    let passive: boolean | undefined;
    let once: boolean | undefined;

    if (typeof options === 'boolean') capture = options;
    else if (options && typeof options === 'object') {
      capture = !!options.capture;
      passive = options.passive;
      once = options.once;
    }
    return { capture, passive, once };
  }

  function getDocumentForGlobalTarget(target: EventTarget): Document | null {
    try {
      const anyT: any = target as any;
      // Document
      if (anyT?.nodeType === 9 && anyT?.documentElement) return anyT as Document;
      // Window-like
      const doc = anyT?.document;
      if (doc && doc.nodeType === 9 && doc.documentElement) return doc as Document;
    } catch {}
    return null;
  }

  function recordEventTargetListener(
    target: EventTarget,
    type: string,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const normType = normalizeEventType(type);
    if (!normType) return;
    const { capture, passive, once } = parseOptions(options);

    let map = eventTargetSummary.get(target);
    if (!map) {
      map = new Map();
      eventTargetSummary.set(target, map);
    }
    const existing = map.get(normType);
    if (existing) {
      existing.count += 1;
      existing.capture = existing.capture || capture;
      existing.passive = existing.passive || passive;
    } else {
      map.set(normType, { count: 1, capture, passive });
    }

    // Element-level: real DOM listener => 'native'
    if (isElementLike(target)) {
      try {
        addListenerMeta(target, {
          type: normType,
          source: 'native',
          capture,
          passive,
          once,
        });
      } catch {
        // never break host page
      }
    }

    // Global delegation signals (doc-correct across realms)
    const d = getDocumentForGlobalTarget(target);
    if (d && (normType === 'click' || normType === 'input' || normType === 'keydown')) {
      try {
        d.documentElement?.setAttribute(`rtrvr-gl-${normType}`, '1');
      } catch {}
    }
  }

  function recordEventTargetRemove(
    target: EventTarget,
    type: string,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const normType = normalizeEventType(type);
    if (!normType) return;
    const map = eventTargetSummary.get(target);
    if (!map) return;
    const existing = map.get(normType);
    if (!existing) return;
    existing.count -= 1;
    if (existing.count <= 0) map.delete(normType);
    if (map.size === 0) eventTargetSummary.delete(target);
    // NOTE: intentionally do not clear html flags (too risky & expensive)
  }

  // Install hooks in *this* realm (and reuse same installer for iframe realms)
  installRealmHooksInWindow(window);

  // ---------- jQuery hooks ----------
  function installJQueryHooks($: any): void {
    if (!$ || !$.fn) return;
    const originalOn = $.fn.on;
    const originalOff = $.fn.off;

    function normalizeJqTypes(events: any): string[] {
      if (!events) return [];
      if (typeof events === 'string') {
        return events
          .split(/\s/)
          .map((t: string) => normalizeEventType(t))
          .filter(Boolean);
      }
      // Object form: .on({ click: fn, mouseenter: fn }, selector)
      if (typeof events === 'object') {
        try {
          return Object.keys(events)
            .map(k => normalizeEventType(k))
            .filter(Boolean);
        } catch {
          return [];
        }
      }
      return [];
    }

    function toContainerElement(target: any): Element | null {
      try {
        if (!target) return null;
        if (isElementLike(target)) return target;
        const winEl = winOf(target);
        return getDocumentElementFromTargetSafe(target, winEl) || null;
      } catch {}
      return null;
    }

    $.fn.on = function (events: any, selector?: any): any {
      const types = normalizeJqTypes(events);
      const hasSelector = typeof selector === 'string' && !!selector;

      this.each(function (this: any) {
        const containerEl = toContainerElement(this);
        if (!containerEl) return;

        if (hasSelector) {
          let list = jqueryDelegatedRegistry.get(containerEl);
          if (!list) {
            list = [];
            jqueryDelegatedRegistry.set(containerEl, list);
          }
          for (const type of types) {
            const key = `${type}::${selector}`;
            if (!list.some(x => `${x.type}::${x.selector}` === key)) {
              list.push({ type, selector });
              if (list.length > 400) list.shift(); // keep bounded but generous
            }
          }
        } else {
          for (const type of types) addListenerMeta(containerEl, { type, source: 'jquery' });
        }

        markElementFramework(containerEl, 'jquery');
        setPageFrameworkFlag('jquery');
        pageFrameworkInfo.jqueryRoots.add(containerEl);
      });

      return originalOn.apply(this, arguments as any);
    };

    $.fn.off = function (): any {
      return originalOff.apply(this, arguments as any);
    };

    setPageFrameworkFlag('jquery');
  }

  // ---------- inline + heuristic detection ----------
  function detectHeuristicInteractivity(el: HTMLElement) {
    // const cls = el.className?.toString() || '';
    // const hasInteractiveClass = INTERACTIVE_CLASS_RE.test(cls);

    const hasInteractiveDataAttr = INTERACTIVE_DATA_ATTRIBUTES.some(a => el.hasAttribute(a));
    if (hasInteractiveDataAttr) {
      addListenerMeta(el, { type: 'click', source: 'other', inferred: true });
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        addListenerMeta(el, { type: 'input', source: 'other', inferred: true });
        addListenerMeta(el, { type: 'change', source: 'other', inferred: true });
      }
    }
  }

  function detectInlineHandlers(el: Element) {
    const winEl = winOf(el);
    const isHtml = isHTMLElementLike(el, winEl);

    const hasOnAttr = el.getAttributeNames().some(n => n.startsWith('on'));
    const isPriorityTag = /^(button|a|input|select|textarea|summary)$/i.test(el.tagName);
    const anyEl = el as any;
    const isEditable = isHtml && (canUserEdit(el) || !!anyEl.isContentEditable || el.hasAttribute('contenteditable'));
    const isDraggable = isHtml && !!(anyEl as HTMLElement).draggable;

    if (!hasOnAttr && !isPriorityTag && !isEditable && !isDraggable) {
      // still allow heuristic interactivity:
      detectHeuristicInteractivity(el as any);
      return;
    }

    for (const [propName, eventType] of Object.entries(eventPropertyToListenerTypeMap)) {
      const handler = (el as any)[propName];
      if (typeof handler === 'function') {
        addListenerMeta(el, { type: eventType, source: 'inline' });
      }
    }

    if (isEditable) {
      addListenerMeta(el, { type: 'input', source: 'other', inferred: true });
      addListenerMeta(el, { type: 'keydown', source: 'other', inferred: true });
      addListenerMeta(el, { type: 'keyup', source: 'other', inferred: true });
      addListenerMeta(el, { type: 'paste', source: 'other', inferred: true });
    }

    if (isDraggable) {
      addListenerMeta(el, { type: 'dragstart', source: 'other', inferred: true });
      addListenerMeta(el, { type: 'dragend', source: 'other', inferred: true });
    }

    detectHeuristicInteractivity(el as any);
  }

  function normalizeReactEventProp(propKey: string): { type: string; capture: boolean } | null {
    if (!propKey.startsWith('on') || propKey.length <= 2) return null;

    if (propKey.endsWith('Capture')) {
      const base = propKey.substring(2, propKey.length - 'Capture'.length);
      if (!base) return null;
      return { type: base.toLowerCase(), capture: true }; // ✅ base type
    }

    const base = propKey.substring(2);
    if (!base) return null;

    return { type: base.toLowerCase(), capture: false };
  }

  // ---------- framework detection (your versions + WeakSets) ----------
  function detectReactOnElement(el: Element): void {
    let keyFound: string | null = null;
    if (!el) return;

    for (const key in el as any) {
      if (
        key.startsWith('__react') ||
        key.startsWith('_react') ||
        key.includes('reactFiber') ||
        key.includes('reactProps') ||
        key.includes('reactInternalInstance')
      ) {
        keyFound = key;
        break;
      }
    }
    if (!keyFound) return;

    try {
      const fiber = (el as any)[keyFound];
      const props = fiber?.memoizedProps || fiber?.pendingProps;

      if (props && typeof props === 'object') {
        for (const propKey in props) {
          const handler = props[propKey];
          if (typeof handler !== 'function') continue;

          const norm = normalizeReactEventProp(propKey);
          if (!norm) continue;

          addListenerMeta(el, {
            type: norm.type,
            source: 'react',
            capture: norm.capture,
          });
        }

        if (isElementLike(fiber?.stateNode)) {
          pageFrameworkInfo.reactRoots.add(fiber.stateNode);
        }

        markElementFramework(el, 'react');
        setPageFrameworkFlag('react');
      }
    } catch {}
  }

  function detectVueOnElement(el: Element): void {
    const e = el as FrameworkEnhancedElement;
    let found = false;

    if (e.__vue__) {
      found = true;
      const vm = e.__vue__;
      if (vm.$listeners) Object.keys(vm.$listeners).forEach(t => addListenerMeta(el, { type: t, source: 'vue' }));
      if (vm._events) Object.keys(vm._events).forEach(t => addListenerMeta(el, { type: t, source: 'vue' }));
      if (vm.$options?._parentListeners)
        Object.keys(vm.$options._parentListeners).forEach(t => addListenerMeta(el, { type: t, source: 'vue' }));
      pageFrameworkInfo.vueRoots.add(el);
    }

    if (e._vnode?.props) {
      found = true;
      const props = e._vnode.props;
      Object.keys(props).forEach(propKey => {
        if (propKey.startsWith('on') && propKey.length > 2) {
          addListenerMeta(el, { type: propKey.substring(2).toLowerCase(), source: 'vue' });
        }
      });
      pageFrameworkInfo.vueRoots.add(el);
    }

    if (found) {
      markElementFramework(el, 'vue');
      setPageFrameworkFlag('vue');
    }
  }

  function detectAngularOnElement(el: Element): void {
    const e = el as FrameworkEnhancedElement;
    let found = false;

    if (e.__ngContext__ || el.hasAttribute('_ngcontent') || el.hasAttribute('ng-version')) {
      found = true;

      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('(') && attr.name.endsWith(')')) {
          const base = attr.name.slice(1, -1).split('.')[0];
          if (base) addListenerMeta(el, { type: base, source: 'angular' });
        }
        if (attr.name.startsWith('on-')) {
          const base = attr.name.substring(3);
          if (base) addListenerMeta(el, { type: base, source: 'angular' });
        }
        if (attr.name.includes('.')) {
          const match = attr.name.match(/\(([^.)]+)/);
          if (match?.[1]) addListenerMeta(el, { type: match[1], source: 'angular' });
        }
      });

      try {
        if (win.ng?.getComponent) {
          const cmp = win.ng.getComponent(el);
          if (cmp) {
            Object.keys(cmp).forEach(key => {
              if (key.endsWith('Output') || key.endsWith('Emitter')) {
                addListenerMeta(el, { type: key.replace(/(Output|Emitter)$/, '').toLowerCase(), source: 'angular' });
              }
            });
          }
        }
      } catch {}
    }

    if (found) {
      markElementFramework(el, 'angular');
      setPageFrameworkFlag('angular');
      pageFrameworkInfo.angularRoots.add(el);
    }
  }

  function detectSvelteOnElement(el: Element): void {
    const e = el as FrameworkEnhancedElement;
    let found = false;

    if (e.__svelte__) {
      found = true;

      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on:')) {
          const type = attr.name.substring(3);
          if (type) addListenerMeta(el, { type, source: 'svelte' });
        }
      });

      try {
        const callbacks = e.__svelte__?.$$?.callbacks;
        if (callbacks && typeof callbacks === 'object') {
          Object.keys(callbacks).forEach(t => addListenerMeta(el, { type: t, source: 'svelte' }));
        }
      } catch {}
      pageFrameworkInfo.svelteRoots.add(el);
    }

    if (found) {
      markElementFramework(el, 'svelte');
      setPageFrameworkFlag('svelte');
    }
  }

  // ---------- delegation inference ----------

  function hasDelegation(target: EventTarget | null, type: string): boolean {
    if (!target) return false;
    const m = eventTargetSummary.get(target);
    return !!m?.has(type);
  }

  function hasDelegatedAncestor(el: Element, type: string, maxSteps = 96): boolean {
    const t = normalizeEventType(type);
    if (!t) return false;

    // IMPORTANT: use the element's document/window realm, not the injector realm.
    const doc = docOf(el);
    const w = winOfDoc(doc);
    if (hasDelegation(doc, t) || hasDelegation(w, t)) return true;

    // Walk across shadow boundaries (parentElement breaks at ShadowRoot)
    let steps = 0;
    let cur: Element | null = el;

    while (cur && steps < maxSteps) {
      // move upward first (do NOT treat the element itself as a delegation container)
      if (cur.parentElement) {
        cur = cur.parentElement;
      } else {
        const root = cur.getRootNode?.();
        if (isShadowRootLike(root)) {
          if (hasDelegation(root, t) || hasDelegation(root.host, t)) return true;
          cur = root.host;
        } else {
          break;
        }
      }

      if (cur && hasDelegation(cur, t)) return true;
    }
    return false;
  }

  function forEachAncestorAcrossShadow(el: Element, fn: (ancestor: Element) => void, maxSteps = 128): void {
    let steps = 0;
    let cur: Element | null = el;
    while (cur && steps < maxSteps) {
      fn(cur);
      if (cur.parentElement) {
        cur = cur.parentElement;
        continue;
      }
      const root = cur.getRootNode?.();
      if (isShadowRootLike(root)) {
        cur = root.host;
        continue;
      }
      break;
    }
  }

  function inferDelegatedListeners(el: Element): void {
    const winEl = winOf(el);
    if (!isHTMLElementLike(el, winEl)) return;

    const info = getOrCreateElementInfo(el);
    info.role = info.role || inferSemanticRole(el);

    const hasClickDelegation = hasDelegatedAncestor(el, 'click');
    const hasInputDelegation = hasDelegatedAncestor(el, 'input');
    const hasKeydownDelegation = hasDelegatedAncestor(el, 'keydown');

    const doc = docOf(el);
    const html = doc.documentElement;
    const pageHasFramework =
      pageFrameworkInfo.frameworks.size > 0 ||
      html.hasAttribute('rtrvr-react') ||
      html.hasAttribute('rtrvr-vue') ||
      html.hasAttribute('rtrvr-angular') ||
      html.hasAttribute('rtrvr-svelte') ||
      html.hasAttribute('rtrvr-jquery');

    // Enable role-based delegation inference when we have *any* credible delegation signal:
    // - known framework presence OR
    // - actual observed delegation listener somewhere above
    if (pageHasFramework || hasClickDelegation || hasInputDelegation || hasKeydownDelegation) {
      const role = info.role || 'other';

      // --- CLICK --- //
      if (hasClickDelegation) {
        let treatAsClickTarget = [
          'button',
          'link',
          'checkbox',
          'radio',
          'switch',
          'menuitem',
          'menuitemcheckbox',
          'menuitemradio',
          'tab',
          'option',
          'treeitem',
          'gridcell',
          'cell',
          'img',
          'figure',
        ].includes(role);

        if (treatAsClickTarget) {
          addListenerMeta(el, { type: 'click', source: 'delegated', inferred: true });
        }
      }

      if (['textbox', 'searchbox', 'spinbutton', 'code'].includes(role)) {
        if (hasInputDelegation) {
          addListenerMeta(el, { type: 'input', source: 'delegated', inferred: true });
          addListenerMeta(el, { type: 'change', source: 'delegated', inferred: true });
        }
        if (hasKeydownDelegation) addListenerMeta(el, { type: 'keydown', source: 'delegated', inferred: true });
      }

      if (['combobox', 'listbox'].includes(role)) {
        if (hasClickDelegation) addListenerMeta(el, { type: 'click', source: 'delegated', inferred: true });
        if (hasInputDelegation) addListenerMeta(el, { type: 'change', source: 'delegated', inferred: true });
      }

      if (['slider', 'scrollbar', 'progressbar', 'meter'].includes(role)) {
        if (hasInputDelegation) addListenerMeta(el, { type: 'input', source: 'delegated', inferred: true });
      }
    }

    // jQuery delegated selectors (walk across shadow boundaries too)
    forEachAncestorAcrossShadow(el, ancestor => {
      const delegated = jqueryDelegatedRegistry.get(ancestor);
      if (!delegated?.length) return;
      for (const { type, selector } of delegated) {
        try {
          if (el.matches(selector)) {
            addListenerMeta(el, { type, source: 'jquery', inferred: true });
            markElementFramework(el, 'jquery');
            setPageFrameworkFlag('jquery');
          }
        } catch {}
      }
    });
  }

  // ---------- runtime observation ----------
  function addRuntimeObserver(type: string): void {
    const handler = (evt: Event) => {
      const anyEvt = evt as any;
      const path: EventTarget[] =
        (anyEvt.composedPath && anyEvt.composedPath()) || buildFallbackPath(evt.target as EventTarget | null);

      const highFreq = type === 'mousemove' || type === 'pointermove' || type === 'scroll' || type === 'wheel';
      const limit = highFreq ? 1 : Math.min(path.length, MAX_RUNTIME_PATH_NODES);
      for (let i = 0; i < limit; i++) {
        const node = path[i];
        if (isElementLike(node)) {
          addListenerMeta(node, { type, source: 'delegated', inferred: true });
        }
      }
    };

    markInternalListener(handler);

    // ✅ bypass patched addEventListener so it doesn't set rtrvr-gl-*
    try {
      nativeAddEventListener.call(document, type, handler as any, { capture: true, passive: true });
    } catch {}
  }

  let tier2Enabled = false;
  function installRuntimeObserversAdaptive(): void {
    RUNTIME_TIER1.forEach(addRuntimeObserver);

    const html = globalDocumentSafe()?.documentElement;
    if (!html) return;

    const maybeEnableTier2 = () => {
      if (tier2Enabled) return;

      const hasFramework =
        html.hasAttribute('rtrvr-react') ||
        html.hasAttribute('rtrvr-vue') ||
        html.hasAttribute('rtrvr-angular') ||
        html.hasAttribute('rtrvr-svelte');

      const hasDelegationSignals =
        html.hasAttribute('rtrvr-gl-click') ||
        html.hasAttribute('rtrvr-gl-input') ||
        html.hasAttribute('rtrvr-gl-keydown');

      if (hasFramework || hasDelegationSignals) {
        tier2Enabled = true;
        RUNTIME_TIER2.forEach(addRuntimeObserver);
      }
    };

    maybeEnableTier2();

    try {
      const mo = new MutationObserver(() => maybeEnableTier2());
      mo.observe(html, {
        attributes: true,
        attributeFilter: [
          'rtrvr-react',
          'rtrvr-vue',
          'rtrvr-angular',
          'rtrvr-svelte',
          'rtrvr-gl-click',
          'rtrvr-gl-input',
          'rtrvr-gl-keydown',
        ],
      });
    } catch {}
  }

  // ---------- scanning ----------
  function scanElementInteractiveData(el: Element): void {
    if (el.nodeType !== 1) return;

    // ✅ role may change across mutations; clear before re-infer/serialize
    const winEl = winOf(el);
    if (isHTMLElementLike(el, winEl)) {
      const info = getOrCreateElementInfo(el);
      info.role = undefined;
    }

    detectInlineHandlers(el);
    detectReactOnElement(el);
    detectVueOnElement(el);
    detectAngularOnElement(el);
    detectSvelteOnElement(el);

    inferDelegatedListeners(el);
    scheduleAttributeUpdate(el);
  }

  function initialPriorityScan(): void {
    const prioritySelectors = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      'summary',
      'details > summary',
      ...Array.from(INTERACTIVE_SEMANTIC_ROLES).map(r => `[role="${r}"]`),
      '[onclick]',
      '[ondblclick]',
      '[ondoubleclick]',
      '[onmousedown]',
      '[tabindex]',
      '[contenteditable]',
      '[draggable="true"]',
      '[aria-haspopup]',
      '[aria-expanded]',
      '[data-click]',
      '[data-action]',
      '[data-handler]',
      '[data-toggle]',
      '[data-target]',
      '.clickable',
      '.interactive',
      '.btn',
      '.button',
    ];

    pendingScanCount++;
    setBusyFlag();
    try {
      const combined = prioritySelectors.join(',');
      globalDocumentSafe()
        ?.querySelectorAll(combined)
        .forEach(el => {
          try {
            scanElementInteractiveData(el);
          } catch {
            // never break host page
          }
        });
    } finally {
      pendingScanCount = Math.max(0, pendingScanCount - 1);
      setBusyFlag();
    }
  }

  function handleMutations(records: MutationRecord[]): void {
    for (const record of records) {
      for (const added of Array.from(record.addedNodes)) {
        if (added.nodeType !== 1) continue;
        const el = added as Element;
        scheduleElementScan(el);
        el.querySelectorAll?.(
          'a,button,input,select,textarea,summary,[role],[onclick],[ondblclick],[ondoubleclick],[contenteditable],[draggable="true"],[tabindex]',
        ).forEach(scheduleElementScan);
      }

      if (record.type === 'attributes' && record.target.nodeType === 1) {
        const el = record.target as Element;
        if (record.attributeName === 'class') {
          // avoid hot-looping on animation class churn
          if (pageHasFrameworkNow() || isCandidate(el)) scheduleElementScan(el);
        } else {
          scheduleElementScan(el);
        }
      }
    }
  }

  async function secondaryScanIfNeeded(opts: { budgetMs?: number; deadlineEpochMs?: number } = {}): Promise<void> {
    const doc = globalDocumentSafe();
    const html = doc?.documentElement;
    if (!html) return;

    const hasFramework =
      html.hasAttribute('rtrvr-react') ||
      html.hasAttribute('rtrvr-vue') ||
      html.hasAttribute('rtrvr-angular') ||
      html.hasAttribute('rtrvr-svelte');

    if (!hasFramework) return;

    const deadlineEpochMs = opts.deadlineEpochMs as number | undefined;
    const hardBudgetMs = Math.max(5, Math.min(opts.budgetMs ?? 12, 50));
    const budgetMs = Math.max(0, Math.min(hardBudgetMs, timeLeftMs(deadlineEpochMs)));
    if (budgetMs <= 0) return;
    const start = performance.now();

    pendingScanCount++;
    setBusyFlag();
    try {
      let scanned = 0;
      const SCAN_CAP = 4000; // higher, but budget stops it
      const secondaryTags = ['div', 'span', 'li', 'section', 'article', 'p'];

      for (const tag of secondaryTags) {
        const nodes = doc.getElementsByTagName(tag) ?? [];
        for (let i = 0; i < nodes.length; i++) {
          if (scanned++ >= SCAN_CAP) return;
          if (deadlineEpochMs && timeLeftMs(deadlineEpochMs) <= 0) return;

          const node = nodes[i] as Element;
          const e = node as FrameworkEnhancedElement;

          const maybeFramework =
            !!e.__ngContext__ || !!e.__svelte__ || !!e.__vue__ || !!e._vnode || isFrameworkHint(node);

          if (maybeFramework) scanElementInteractiveData(node);

          if (scanned % 250 === 0 && timeLeftMs(deadlineEpochMs) > 20) await yieldToEventLoop();
        }
      }
    } finally {
      pendingScanCount = Math.max(0, pendingScanCount - 1);
      setBusyFlag();
    }
  }

  const mutationObserver = new MutationObserver(handleMutations);

  const shadowObserverMap = new WeakMap<ShadowRoot, MutationObserver>();
  function observeShadowRoot(sr: ShadowRoot): void {
    if (shadowObserverMap.has(sr)) return;
    if (observedShadowRootCount >= MAX_OBSERVED_SHADOW_ROOTS) return;
    try {
      const MO = (winOfDoc(sr.ownerDocument) as any).MutationObserver || MutationObserver;
      const mo = new MO(handleMutations);
      shadowObserverMap.set(sr, mo);
      observedShadowRootCount++;
      mo.observe(sr, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...OBSERVED_ATTRS, 'class'],
      });
    } catch {}
  }

  const iframeDocObserverMap = new WeakMap<Document, MutationObserver>();
  function observeFrameDocument(doc: Document): void {
    if (iframeDocObserverMap.has(doc)) return;
    if (observedIframeDocCount >= MAX_OBSERVED_IFRAME_DOCS) return;
    try {
      // Ensure realm hooks exist for this iframe window
      installRealmHooksInWindow(doc.defaultView || null);
      const root = doc.documentElement;
      if (!root) return;
      const MO = (winOfDoc(doc) as any).MutationObserver || MutationObserver;
      const mo = new MO(handleMutations);
      iframeDocObserverMap.set(doc, mo);
      observedIframeDocCount++;
      mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...OBSERVED_ATTRS, 'class'],
      });
    } catch {}
  }

  function initMutationObserver(): void {
    const root = globalDocumentSafe()?.documentElement;
    if (!root) return;
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...OBSERVED_ATTRS, 'class'],
    });
  }

  const capturedShadowRoots = new WeakMap<Element, ShadowRoot>();
  // NOTE: attachShadow hook is installed via installRealmHooksInWindow(window)

  function getAnyShadowRoot(el: Element): ShadowRoot | null {
    return (el as any).shadowRoot || capturedShadowRoots.get(el) || null;
  }

  // Allow other injected main-world modules (scroll detector) to traverse closed roots too.
  try {
    Object.defineProperty(internal, 'shadow', {
      value: Object.freeze({
        getRoot: (el: Element) => getAnyShadowRoot(el),
      }),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {}

  function detectFrameworksFromGlobals(): void {
    try {
      if (win.React || win.__REACT_DEVTOOLS_GLOBAL_HOOK__) setPageFrameworkFlag('react');
      if (win.Vue) setPageFrameworkFlag('vue');
      if (win.ng) setPageFrameworkFlag('angular');
      if (win.jQuery) setPageFrameworkFlag('jquery');
      maybeInstallJQueryHooks();
    } catch {}
  }

  win.rtrvrAIMarkInteractiveElements = function (): boolean {
    if (!globalDocumentSafe()?.body) return false;
    initialPriorityScan();
    return true;
  };

  function bootstrap(): void {
    const doc = globalDocumentSafe();
    maybeInstallJQueryHooks();
    detectFrameworksFromGlobals();
    installRuntimeObserversAdaptive();

    const onReady = () => {
      maybeInstallJQueryHooks();
      detectFrameworksFromGlobals(); // catch late globals on DOM ready
      initMutationObserver();
      win.rtrvrAIMarkInteractiveElements?.();
      // run secondary sweep once we actually know framework flags
      void secondaryScanIfNeeded({ budgetMs: 20 }); // see next patch section

      doc?.documentElement.setAttribute(RTRVR_MAIN_WORLD_READY_ATTRIBUTE, '1');
    };

    if (doc?.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }

  bootstrap();
})();
