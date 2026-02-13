//content-runtime/actions.iffe.js
import type {
  ExtensionLLMFunction,
  FrameworkElementMetadata,
  FrameworkElementMetadataWire,
  FrameworkName,
  IframePath,
  ListenerSource,
  MainWorldToolRequest,
  MainWorldToolResponse,
  UploadFilePayload,
} from '@rover/shared';
import {
  base64ToUint8Array,
  decodeListenerSourceMask,
  extractFirebaseFileName,
  FrameworkCodeToName,
  getDocumentContext,
  resolveInteractiveElementById,
  safeBasename,
  sleepBgSafe,
  SystemToolNames,
  ToolOpcodeToName,
  withBgSafeTimeout,
} from '@rover/shared';
import {
  applyClearToContentEditableLike,
  applyClearToInputLike,
  applyTextToContentEditableLike,
  applyTextToInputLike,
  commitEnter,
  containsInComposedTree,
  dispatchTextEvents,
  docOf,
  EventHandlerReverseMap,
  focusDeep,
  getActiveElementDeep,
  getDocumentFromWindowSafe,
  getEditableTextSnapshot,
  getMainWorldRole,
  globalWindowSafe,
  INTERACTIVE_LABEL_ATTR,
  isHTMLButtonElementX,
  isHTMLElementLike,
  isHTMLInputElementX,
  isHTMLSelectElementX,
  isHTMLTextAreaElementX,
  parseNumericListenerAttribute,
  resolveEditableTarget,
  RTRVR_MAIN_WORLD_ACTIONS_READY_ATTRIBUTE,
  selectContentsWithin,
  setValueNative,
  winOfDoc,
} from '@rover/a11y-tree';
import {
  directScrollBy,
  directScrollElementIntoView,
  getElementSelector,
  getRootScroller,
  normalizeScrollAlignment,
  ScrollDirectionEnum,
} from '../scroll/scroll-helpers.js';
type FunctionCall = { name?: string; args?: Record<string, any> };

// content-runtime/actions.iffe.js
interface SystemToolActionResult {
  success: boolean;
  method: string;
  details?: string;
  allowFallback?: boolean;
}

interface ExtendedWindow extends Window {
  ng?: any;
  jQuery?: any;
  __RTRVR_INTERNAL_KEY__?: string;
}
declare const window: ExtendedWindow;

const MAIN_PROMOTABLE_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.click_element,
  SystemToolNames.type_into_element,
  SystemToolNames.type_and_enter,
  SystemToolNames.hover_element,
  SystemToolNames.right_click_element,
  SystemToolNames.double_click_element,
  SystemToolNames.press_key,
  SystemToolNames.scroll_page,
  SystemToolNames.scroll_to_element,
  SystemToolNames.mouse_wheel,
  SystemToolNames.drag_element,
  SystemToolNames.drag_and_drop,
  SystemToolNames.swipe_element,
  SystemToolNames.long_press_element,
  SystemToolNames.adjust_slider,
  SystemToolNames.select_dropdown_value,
  SystemToolNames.clear_element,
  SystemToolNames.focus_element,
  SystemToolNames.check_field_validity,
  SystemToolNames.select_text,
  SystemToolNames.copy_text,
  SystemToolNames.paste_text,
  SystemToolNames.pinch_zoom,
  SystemToolNames.upload_file,
]);

(() => {
  const EXECUTOR_FLAG = '__RTRVR_ACTION_EXECUTOR__';
  const DEFAULT_TOOL_BUDGET_MS = 12000;

  if ((window as any)[EXECUTOR_FLAG]) return;
  (window as any)[EXECUTOR_FLAG] = true;

  // mark ready (for analyzers / diagnostics)
  try {
    document.documentElement?.setAttribute(RTRVR_MAIN_WORLD_ACTIONS_READY_ATTRIBUTE, '1');
  } catch {}

  // ---------------- INTERNAL API EXPOSURE (NO postMessage) ----------------
  const INTERNAL_KEY = '__RTRVR_INTERNAL__';
  try {
    (window as any).__RTRVR_INTERNAL_KEY__ = (window as any).__RTRVR_INTERNAL_KEY__ || INTERNAL_KEY;
  } catch {
    // ignore
  }

  const key = (window as any).__RTRVR_INTERNAL_KEY__ || INTERNAL_KEY;
  const existing = (window as any)[key];
  const internal = existing && typeof existing === 'object' ? existing : {};

  if (!existing) {
    try {
      Object.defineProperty(window, key, {
        value: internal,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch {
      // fallback (non-fatal)
      (window as any)[key] = internal;
    }
  }

  async function execute(request: MainWorldToolRequest): Promise<MainWorldToolResponse> {
    let result: MainWorldToolResponse = {} as MainWorldToolResponse;

    try {
      const toolName = ToolOpcodeToName[request.opcode];
      if (!toolName) throw new Error(`Unknown tool opcode: ${request.opcode}`);

      const fixedCall: FunctionCall = {
        ...(request.call as any),
        name: toolName as any,
      };

      const responses = await executeSystemToolMainWorld({
        tabIndex: request.tabIndex,
        call: fixedCall,
        elementData: wireToFrameworkElementMetadata(request.elementData),
        payload: request.payload,
      });

      const first = responses[0];
      result = first?.response ?? { success: false, error: 'Empty tool response', allowFallback: true };
    } catch (e: any) {
      result = {
        success: false,
        error: e?.message || String(e),
        allowFallback: true,
      };
    }

    return result as MainWorldToolResponse;
  }

  try {
    Object.defineProperty(internal, 'actions', {
      value: Object.freeze({ execute }),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {
    // ignore
  }

  // ---------------------------------------------------------------------------
  // Upload-bytes bridge (MAIN <-> isolated) using ONE window message listener
  // ---------------------------------------------------------------------------
  const UPLOAD_BYTES_REQ = '__RTRVR_UPLOAD_BYTES_REQ__';
  const UPLOAD_BYTES_RES = '__RTRVR_UPLOAD_BYTES_RES__';

  type UploadBytesPending = {
    resolve: (buf: ArrayBuffer) => void;
    reject: (err: Error) => void;
    cancelTimeout: () => void; // ✅ replace timeoutId
    expectedByteLength: number;
  };

  // Store per-window so if this script runs in multiple frames, each frame is isolated.
  const UPLOAD_BYTES_BRIDGE_KEY = '__RTRVR_UPLOAD_BYTES_BRIDGE__';
  const WINDOW_MSG_MUX_KEY = '__RTRVR_WINDOW_MESSAGE_MUX__';

  function getOrCreateWindowMux(winEl: Window): { handlers: Set<(ev: MessageEvent) => void>; installed: boolean } {
    const w: any = winEl as any;
    let mux: any = w[WINDOW_MSG_MUX_KEY];
    if (!mux || typeof mux !== 'object') {
      mux = { handlers: new Set<(ev: MessageEvent) => void>(), installed: false };
      try {
        Object.defineProperty(w, WINDOW_MSG_MUX_KEY, { value: mux, enumerable: false, configurable: false });
      } catch {
        w[WINDOW_MSG_MUX_KEY] = mux;
      }
    }

    if (!mux.installed) {
      mux.installed = true;

      // ✅ SINGLE global window 'message' listener (capture to run early)
      winEl.addEventListener(
        'message',
        (ev: MessageEvent) => {
          // Only same-window messages; ignore postMessages from other windows
          if (ev.source !== winEl) return;

          for (const h of Array.from(mux.handlers)) {
            try {
              (h as any)(ev);
            } catch {
              // ignore handler errors so other handlers still run
            }
          }
        },
        true,
      );

      // ✅ On pagehide, reject all pending requests to avoid leaks/hangs
      try {
        winEl.addEventListener(
          'pagehide',
          () => {
            const bridge = (winEl as any)[UPLOAD_BYTES_BRIDGE_KEY];
            const pending: Map<string, UploadBytesPending> | undefined = bridge?.pending;
            if (!pending) return;
            // In pagehide handler:
            for (const [id, p] of pending) {
              try {
                p.cancelTimeout();
              } catch {}
              p.reject(new Error('pagehide: upload bytes request canceled'));
              pending.delete(id);
            }
          },
          true,
        );
      } catch {}
    }

    return mux;
  }

  function getOrCreateUploadBytesBridge(winEl: Window): { pending: Map<string, UploadBytesPending> } {
    const w: any = winEl as any;
    let bridge = w[UPLOAD_BYTES_BRIDGE_KEY];
    if (!bridge || typeof bridge !== 'object') {
      bridge = { pending: new Map<string, UploadBytesPending>() };
      try {
        Object.defineProperty(w, UPLOAD_BYTES_BRIDGE_KEY, { value: bridge, enumerable: false, configurable: false });
      } catch {
        w[UPLOAD_BYTES_BRIDGE_KEY] = bridge;
      }

      const mux = getOrCreateWindowMux(winEl);
      mux.handlers.add((ev: MessageEvent) => {
        const d: any = ev?.data;

        if (!d || typeof d !== 'object') return;
        if (d.type !== UPLOAD_BYTES_RES) return;

        const requestId = String(d.requestId || '');
        if (!requestId) return;

        const pending = bridge.pending.get(requestId);
        if (!pending) return;

        bridge.pending.delete(requestId);
        try {
          pending.cancelTimeout();
        } catch {}

        if (!d.ok) {
          pending.reject(new Error(d.error || 'Failed to get bytes'));
          return;
        }

        const bytes = d.bytes;
        // ✅ Validate ArrayBuffer and expected size
        if (!(bytes instanceof ArrayBuffer)) {
          pending.reject(new Error('Invalid bytes payload (expected ArrayBuffer)'));
          return;
        }
        if (typeof pending.expectedByteLength === 'number' && bytes.byteLength !== pending.expectedByteLength) {
          pending.reject(
            new Error(`Byte length mismatch: got=${bytes.byteLength}, expected=${pending.expectedByteLength}`),
          );
          return;
        }

        pending.resolve(bytes);
      });
    }

    return bridge;
  }

  function requestBytesFromIsolatedInWindow(
    winEl: Window,
    token: string,
    byteLength: number,
    timeoutMs = 90_000,
  ): Promise<ArrayBuffer> {
    const directProvider =
      (winEl as any).__ROVER_UPLOAD_BYTES__ || (winEl as any).rover?.uploadBytes || (winEl as any).rtrvr?.uploadBytes;
    if (typeof directProvider === 'function') {
      return Promise.resolve()
        .then(() => directProvider({ token, byteLength, timeoutMs }))
        .then((res: any) => {
          if (res instanceof ArrayBuffer) return res;
          if (res && res.buffer instanceof ArrayBuffer) return res.buffer;
          throw new Error('Upload bytes provider returned invalid buffer');
        });
    }

    const bridge = getOrCreateUploadBytesBridge(winEl);

    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const safeTimeout = Math.max(1_000, Math.min(Number(timeoutMs) || 90_000, 180_000));
    const docForTimeout = getDocumentFromWindowSafe(winEl) || document;

    return new Promise((resolve, reject) => {
      let done = false;
      let canceled = false;

      const cancelTimeout = () => {
        canceled = true;
      };

      (async () => {
        await sleepBgSafe(safeTimeout, docForTimeout);
        if (canceled || done) return;
        bridge.pending.delete(requestId);
        done = true;
        reject(new Error('Timed out waiting for upload bytes'));
      })().catch(() => {});

      bridge.pending.set(requestId, {
        cancelTimeout,
        expectedByteLength: byteLength,
        resolve: buf => {
          if (done) return;
          done = true;
          cancelTimeout();
          resolve(buf);
        },
        reject: err => {
          if (done) return;
          done = true;
          cancelTimeout();
          reject(err);
        },
      });

      winEl.postMessage({ type: UPLOAD_BYTES_REQ, requestId, token, byteLength }, '*');
    });
  }

  // ---------------- conversions / executor ----------------

  function wireToFrameworkElementMetadata(wire?: FrameworkElementMetadataWire): FrameworkElementMetadata | undefined {
    if (!wire) return undefined;

    return {
      frameworks: wire.frameworks
        ? (wire.frameworks.map(code => FrameworkCodeToName[code]).filter(fw => fw && fw !== 'unknown') as any)
        : [],
      listenersRaw: wire.listenersRaw ?? '',
      role: wire.role ?? undefined,
      pattern: wire.pattern ?? undefined,
      value: wire.value ?? undefined,
    };
  }

  async function executeSystemToolMainWorld({
    tabIndex,
    call,
    elementData,
    payload,
  }: {
    tabIndex: number;
    call: FunctionCall;
    elementData?: FrameworkElementMetadata;
    payload?: UploadFilePayload;
  }): Promise<ExtensionLLMFunction[]> {
    // SAFETY: window.top.document may throw in cross-origin iframes
    const docRoot = (() => {
      try {
        return globalWindowSafe()?.top?.document || document;
      } catch {
        return document;
      }
    })();

    const args = call.args as any;
    let targetDocument: Document;
    let targetWindow: Window;
    let unresolvedPath: IframePath;

    try {
      ({ doc: targetDocument, win: targetWindow, unresolvedPath } = getDocumentContext(docRoot, args.iframe_id));
    } catch {
      targetDocument = document;
      targetWindow = winOfDoc(targetDocument);
    }

    const toolName = call.name as SystemToolNames;

    const targetElement = args.element_id ? resolveInteractiveElementById(targetDocument, args.element_id) : null;

    const targetElOwnerDoc = targetElement?.ownerDocument ?? null;

    let response: ExtensionLLMFunction['response'];

    if (!MAIN_PROMOTABLE_TOOLS.has(toolName)) {
      response = {
        success: false,
        error: `Tool not promotable to main: ${toolName}`,
        allowFallback: true,
      };
    } else {
      const finalDoc = targetElOwnerDoc ?? targetDocument;
      const finalWindow = winOfDoc(finalDoc, targetWindow);
      response = await runTool(toolName, targetElement, args, elementData, finalDoc, finalWindow, payload);
    }

    return [
      {
        name: call.name!,
        args: call.args!,
        response,
      },
    ];
  }

  // MAIN-WORLD LOCAL BRIDGE TO SCROLL DETECTOR (NO postMessage)
  async function sendScrollCommandInWindow(
    targetWin: Window,
    command: any,
    opts?: { doc?: Document; timeoutMs?: number },
  ): Promise<any> {
    try {
      const k = (targetWin as any).__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
      const i = (targetWin as any)[k];
      const exec = i?.scroll?.execute;
      if (typeof exec !== 'function') throw new Error('main-world scroll detector not available');
      const docForTimeout = opts?.doc || getDocumentFromWindowSafe(targetWin) || document;
      // Be more patient: don't "give up" quickly on detector responses.
      const timeoutMs = Math.max(250, Math.min(Number(opts?.timeoutMs ?? 3500), 8000));

      const raced = await withBgSafeTimeout(
        Promise.resolve().then(() => exec(command)),
        timeoutMs,
        docForTimeout,
      );
      if (!raced.ok) throw new Error('scroll detector timeout');
      return raced.value;
    } catch (e: any) {
      throw new Error(e?.message || 'main-world scroll detector not available');
    }
  }

  async function runTool(
    tool: SystemToolNames,
    el: HTMLElement | null,
    args: any,
    md: FrameworkElementMetadata | undefined,
    doc: Document,
    win: Window,
    payload?: UploadFilePayload,
  ): Promise<ExtensionLLMFunction['response']> {
    const toResponse = (r: SystemToolActionResult): ExtensionLLMFunction['response'] => ({
      success: r.success,
      error: r.success ? undefined : r.details || 'Action failed',
      allowFallback: r.success ? undefined : (r.allowFallback ?? true),
    });

    const canRunWithoutEl =
      tool === SystemToolNames.press_key ||
      tool === SystemToolNames.scroll_page ||
      tool === SystemToolNames.drag_and_drop ||
      tool === SystemToolNames.pinch_zoom;

    if (!el && !canRunWithoutEl) {
      return toResponse({
        success: false,
        method: 'missing-element-race',
        details: 'Target element missing',
        allowFallback: true,
      });
    }
    const needsEditable = new Set<SystemToolNames>([
      SystemToolNames.type_into_element,
      SystemToolNames.type_and_enter,
      SystemToolNames.clear_element,
      SystemToolNames.focus_element,
      SystemToolNames.select_text,
      SystemToolNames.check_field_validity,
    ]);

    let effectiveEl = el;
    const docEl = docOf(effectiveEl, doc);

    if (effectiveEl && needsEditable.has(tool)) {
      const resolved = resolveEditableTarget(effectiveEl, docEl);
      if (resolved.kind === 'input') effectiveEl = resolved.el;
      else if (resolved.kind === 'contenteditable') effectiveEl = resolved.el;
    }

    try {
      switch (tool) {
        case SystemToolNames.click_element:
          return toResponse(smartClick(el!, doc, win, md));

        case SystemToolNames.double_click_element:
          return toResponse(smartDoubleClick(el!, doc, win));

        case SystemToolNames.right_click_element:
          return toResponse(smartRightClick(el!, doc, win));

        case SystemToolNames.hover_element:
          return toResponse(await smartHover(el!, doc, win, md, args.duration));

        case SystemToolNames.type_into_element:
          return toResponse(await smartType(effectiveEl!, doc, win, args.text, md));

        case SystemToolNames.type_and_enter:
          return toResponse(await smartTypeAndEnter(effectiveEl!, doc, win, args.text, md));

        case SystemToolNames.clear_element:
          return toResponse(await smartClear(effectiveEl!, doc, win, md));

        case SystemToolNames.focus_element:
          return toResponse(smartFocus(effectiveEl!, doc, win));

        case SystemToolNames.select_dropdown_value:
          return toResponse(smartSelect(el as HTMLSelectElement, doc, win, args.value, md));

        case SystemToolNames.adjust_slider:
          return toResponse(smartSlider(el as HTMLInputElement, doc, win, md?.value ?? args.value, md));

        case SystemToolNames.check_field_validity:
          return toResponse(checkValidity(effectiveEl as any, doc, win));

        case SystemToolNames.select_text:
          return toResponse(selectText(effectiveEl!, doc, win, args.start_offset, args.end_offset));

        case SystemToolNames.scroll_page:
          return toResponse(await smartScrollMainWorld(el, doc, win, args));

        case SystemToolNames.scroll_to_element:
          return toResponse(await smartScrollToElementMainWorld(el!, doc, win, args));

        case SystemToolNames.mouse_wheel:
          return toResponse(smartWheel(el!, doc, win, args.delta_x, args.delta_y));

        case SystemToolNames.drag_element:
          return toResponse(await smartDrag(el!, doc, win, args, md));

        case SystemToolNames.drag_and_drop:
          return toResponse(await smartDragDrop(args, el, doc, win));

        case SystemToolNames.swipe_element:
          return toResponse(await smartSwipe(el!, doc, win, args));

        case SystemToolNames.long_press_element:
          return toResponse(await longPress(el!, doc, win, args.duration));

        case SystemToolNames.pinch_zoom:
          return toResponse(await pinchZoom(el, doc, win, args));

        case SystemToolNames.press_key:
          return toResponse(pressKey(args.key, args.modifiers, el, doc, win));

        case SystemToolNames.copy_text:
          return toResponse(await copyText(el!, doc, win));

        case SystemToolNames.paste_text:
          return toResponse(await pasteText(el!, doc, win, md));

        case SystemToolNames.upload_file:
          return toResponse(await uploadFile(args, doc, win, payload, el, md));

        default:
          return toResponse({ success: false, method: 'unhandled', details: `Unhandled ${tool}`, allowFallback: true });
      }
    } catch (e: any) {
      return toResponse({
        success: false,
        method: 'exception',
        details: e?.message || 'exception',
        allowFallback: true,
      });
    }
  }

  // ---------------- listener parsing / signals ----------------

  function parseListenersRaw(raw?: string): Map<string, Set<ListenerSource>> {
    const map = new Map<string, Set<ListenerSource>>();
    if (!raw) return map;

    const trimmed = raw.trim();
    if (!trimmed) return map;

    const numeric = parseNumericListenerAttribute(trimmed);
    if (numeric) {
      for (const { id, mask } of numeric.entries) {
        const typeName = EventHandlerReverseMap[id];
        if (!typeName) continue;
        const srcSet = new Set<ListenerSource>(decodeListenerSourceMask(mask));
        const existing = map.get(typeName);
        if (existing) {
          for (const s of srcSet) existing.add(s);
        } else {
          map.set(typeName, srcSet);
        }
      }
      return map;
    }

    // v2 is the only supported encoding
    return map;
  }

  function hasSrc(set: Set<ListenerSource> | undefined, ...needles: ListenerSource[]) {
    if (!set) return false;
    return needles.some(n => set.has(n));
  }

  function signals(el: HTMLElement, md?: FrameworkElementMetadata) {
    const sourcesByType = parseListenersRaw(md?.listenersRaw);

    const fws = new Set<FrameworkName>();
    for (const [, sources] of sourcesByType) {
      for (const src of sources) {
        if (src === 'react' || src === 'vue' || src === 'angular' || src === 'svelte' || src === 'jquery') {
          fws.add(src as FrameworkName);
        }
      }
    }

    const activation = new Set<ListenerSource>();
    for (const [t, s] of sourcesByType) {
      if (
        [
          'click',
          'input',
          'change',
          'keydown',
          'keyup',
          'pointerdown',
          'pointerup',
          'mousedown',
          'mouseup',
          'submit',
          'dragstart',
          'drop',
          'wheel',
          'scroll',
        ].includes(t)
      ) {
        for (const src of s) activation.add(src);
      }
    }

    const isFrameworkElement =
      fws.size > 0 || [...activation].some(s => ['react', 'vue', 'angular', 'svelte', 'jquery'].includes(s));

    const delegatedClick = hasSrc(sourcesByType.get('click'), 'delegated');
    const delegatedInput =
      hasSrc(sourcesByType.get('input'), 'delegated') ||
      hasSrc(sourcesByType.get('change'), 'delegated') ||
      hasSrc(sourcesByType.get('keydown'), 'delegated');

    const role = md?.role || getMainWorldRole(el) || el.getAttribute('role');
    return { sourcesByType, fws, isFrameworkElement, delegatedClick, delegatedInput, role };
  }

  // // ---------------- CLICK ----------------
  function smartClick(
    el: HTMLElement,
    doc: Document,
    win: Window,
    md?: FrameworkElementMetadata,
  ): SystemToolActionResult {
    const sig = signals(el, md);
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    scrollIntoView(el, docEl, winEl);

    if (md?.pattern === 'hover-activate') void smartHover(el, docEl, winEl, md, 120);

    const wantsReact = sig.fws.has('react') || hasSrc(sig.sourcesByType.get('click'), 'react');
    const wantsVue = sig.fws.has('vue') || hasSrc(sig.sourcesByType.get('click'), 'vue');
    const wantsAngular = sig.fws.has('angular') || hasSrc(sig.sourcesByType.get('click'), 'angular');
    const wantsSvelte = sig.fws.has('svelte') || hasSrc(sig.sourcesByType.get('click'), 'svelte');
    const wantsJQ = sig.fws.has('jquery') || hasSrc(sig.sourcesByType.get('click'), 'jquery');

    return tryStrategies(
      () => pointerMouseClick(el, docEl, winEl),
      () => nativeClick(el, docEl, winEl),
      () => (wantsReact ? reactClick(el, docEl, winEl) : null),
      () => (wantsVue ? vueClick(el, docEl, winEl) : null),
      () => (wantsAngular ? angularClick(el, docEl, winEl) : null),
      () => (wantsSvelte ? svelteClick(el, docEl, winEl) : null),
      () => (wantsJQ ? jqueryClick(el, docEl, winEl) : null),
    );
  }

  function pointerMouseClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;

    const { x, y } = bestClickablePoint(el, docEl, winEl);
    const common: PointerEventInit & MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: winEl,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    };

    el.focus?.({ preventScroll: true } as any);

    const seq: Event[] = [
      new PointerEvt('pointerover', common),
      new PointerEvt('pointerenter', { ...common, bubbles: false }),
      new MouseEvt('mouseover', common),
      new MouseEvt('mouseenter', { ...common, bubbles: false }),
      new PointerEvt('pointerdown', common),
      new MouseEvt('mousedown', common),
      new PointerEvt('pointerup', { ...common, buttons: 0 }),
      new MouseEvt('mouseup', { ...common, buttons: 0 }),
      new MouseEvt('click', { ...common, buttons: 0 }),
    ];

    seq.forEach(e => el.dispatchEvent(e));

    return { success: true, method: 'pointer-mouse-click' };
  }

  function nativeClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    try {
      if (el instanceof HTMLAnchorElement) {
        const prev = el.getAttribute('target');
        try {
          el.setAttribute('target', '_self');
          el.click();
        } finally {
          if (prev === null) el.removeAttribute('target');
          else el.setAttribute('target', prev);
        }
      } else {
        el.click?.();
      }
      return { success: true, method: 'native-click' };
    } catch {
      return { success: false, method: 'native-click' };
    }
  }

  type ClickPoint = { x: number; y: number; hit: Element | null; ok: boolean };

  function bestClickablePoint(el: HTMLElement, doc: Document, win: Window): ClickPoint {
    const docEl = docOf(el, doc);
    const r = el.getBoundingClientRect();

    const points = [
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { x: r.left + 4, y: r.top + 4 },
      { x: r.right - 4, y: r.top + 4 },
      { x: r.left + 4, y: r.bottom - 4 },
      { x: r.right - 4, y: r.bottom - 4 },
    ];

    let centerHit: Element | null = null;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const hit = docEl.elementFromPoint(p.x, p.y);
      if (i === 0) centerHit = hit;
      if (hit && containsInComposedTree(el, hit)) return { ...p, hit, ok: true };
    }

    // No point truly hits the element -> likely overlay or offscreen layout issue
    return { ...points[0], hit: centerHit, ok: false };
  }

  function reactClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    try {
      const fiber = detectReactFiber(el);
      if (!fiber) return { success: false, method: 'react-no-fiber' };
      const h = extractReactHandlers(fiber);
      const onClick = h.onClick || h.onClickCapture;
      if (!onClick) return { success: false, method: 'react-no-onClick' };
      onClick(synthReactEvent('click', el, docEl, winEl));
      return { success: true, method: 'react-fiber-onClick' };
    } catch {
      return { success: false, method: 'react-fiber-onClick' };
    }
  }

  function vueClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
    try {
      const inst = detectVueInstance(el);
      if (!inst) return { success: false, method: 'vue-none' };
      const h = extractVueHandlers(inst);
      if (h.click) {
        h.click(new MouseEvt('click', { bubbles: true }));
        return { success: true, method: 'vue-handler' };
      }
      if (inst.$emit) {
        inst.$emit('click');
        return { success: true, method: 'vue-emit' };
      }
      return { success: false, method: 'vue-no-click' };
    } catch {
      return { success: false, method: 'vue-handler' };
    }
  }

  function angularClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
    try {
      const zone = (winEl as any).ng?.getZone?.() || null;
      if (zone?.run) {
        zone.run(() => el.dispatchEvent(new MouseEvt('click', { bubbles: true, cancelable: true })));
        return { success: true, method: 'angular-zone-click' };
      }
      el.dispatchEvent(new MouseEvt('click', { bubbles: true, cancelable: true }));
      el.click?.();
      return { success: true, method: 'angular-click' };
    } catch {
      return { success: false, method: 'angular-click', allowFallback: true };
    }
  }

  function svelteClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
    try {
      const r = el.getBoundingClientRect();
      const opt = {
        bubbles: true,
        cancelable: true,
        view: el.ownerDocument?.defaultView || window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      };
      el.dispatchEvent(new MouseEvt('mousedown', opt));
      el.dispatchEvent(new MouseEvt('mouseup', opt));
      el.dispatchEvent(new MouseEvt('click', opt));
      return { success: true, method: 'svelte-click' };
    } catch {
      return { success: false, method: 'svelte-click' };
    }
  }

  function jqueryClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    try {
      (winEl as any).jQuery?.(el)?.trigger?.('click');
      return { success: true, method: 'jquery-trigger' };
    } catch {
      return { success: false, method: 'jquery-trigger' };
    }
  }

  // ---------------- HOVER ----------------

  async function smartHover(
    el: HTMLElement,
    doc: Document,
    win: Window,
    md?: FrameworkElementMetadata,
    duration = 500,
  ): Promise<SystemToolActionResult> {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const sig = signals(el, md);
    scrollIntoView(el, docEl, winEl);
    const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2,
      y = r.top + r.height / 2;

    if (sig.fws.has('react')) {
      const fiber = detectReactFiber(el);
      const h = fiber ? extractReactHandlers(fiber) : {};
      h.onMouseEnter?.(synthReactEvent('mouseenter', el, docEl, winEl));
      h.onPointerEnter?.(synthReactEvent('pointerenter', el, docEl, winEl));
    } else if (sig.fws.has('vue')) {
      const inst = detectVueInstance(el);
      const h = inst ? extractVueHandlers(inst) : {};
      h.mouseenter?.(new MouseEvt('mouseenter', { bubbles: true }));
      h.mouseover?.(new MouseEvt('mouseover', { bubbles: true }));
    }

    const common: PointerEventInit & MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: winEl,
      clientX: x,
      clientY: y,
    };

    const seq: Event[] = [
      new PointerEvt('pointerover', common),
      new PointerEvt('pointerenter', { ...common, bubbles: false }),
      new MouseEvt('mouseover', common),
      new MouseEvt('mouseenter', { ...common, bubbles: false }),
    ];
    seq.forEach(e => el.dispatchEvent(e));

    await sleepBgSafe(duration, docEl);
    return { success: true, method: 'hover-seq' };
  }

  // ---------------- typing stability helpers ----------------
  async function yieldFrameLike(docEl: Document, winEl: Window, frames = 1): Promise<void> {
    // Always allow microtasks to flush first.
    await Promise.resolve();
    for (let i = 0; i < frames; i++) {
      if (docEl.hidden) {
        // rAF is heavily throttled when hidden; MessageChannel keeps moving.
        await yieldOnce();
      } else {
        // rAF is the best signal for "framework rendered".
        await new Promise<void>(resolve => {
          try {
            winEl.requestAnimationFrame(() => resolve());
          } catch {
            // fallback
            yieldOnce().then(resolve);
          }
        });
      }
    }
  }

  const normWS = (s: any) =>
    String(s ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  function readInputValue(el: HTMLElement): string {
    try {
      if ('value' in (el as any)) return String((el as any).value ?? '');
    } catch {}
    return '';
  }

  function readEditableSnapshot(el: HTMLElement): string {
    try {
      // Prefer your snapshot helper when available
      return typeof (getEditableTextSnapshot as any) === 'function'
        ? getEditableTextSnapshot(el)
        : normWS(el.textContent);
    } catch {
      return '';
    }
  }

  function shouldSendKeySequence(text: string, sig: ReturnType<typeof signals>) {
    // Key-per-char is expensive; only do it when it likely matters.
    if (!(sig.isFrameworkElement || sig.delegatedInput)) return false;
    const n = String(text ?? '').length;
    return n > 0 && n <= 140;
  }

  // ---------------- TYPE / CLEAR / FOCUS / SELECT / SLIDER ----------------
  async function smartType(
    el: HTMLElement,
    doc: Document,
    win: Window,
    text: string,
    md?: FrameworkElementMetadata,
  ): Promise<SystemToolActionResult> {
    const sig = signals(el, md);
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    scrollIntoView(el, docEl, winEl);

    // 1) input/textarea fast path
    if (isHTMLInputElementX(el, winEl) || isHTMLTextAreaElementX(el, winEl)) {
      const wantKeys = shouldSendKeySequence(String(text ?? ''), sig);
      const r = await applyTextToInputLike(el as any, docEl, winEl, text, {
        settleFrames: docEl.hidden ? 1 : 2,
        useKeyFallback: wantKeys, // drives delegated/framework handlers when needed
        keyFallbackMaxLen: 140,
      });
      return { success: r.success, method: r.method, details: r.details, allowFallback: !r.success };
    }

    // 2) contenteditable-ish path
    const isRichEditable =
      (el as any).isContentEditable === true || (sig.role === 'textbox' && !('value' in (el as any)));

    if (isRichEditable) {
      const before0 = readEditableSnapshot(el);
      const r0 = applyTextToContentEditableLike(el, text, docEl, winEl);

      // Let editors/observers settle and ensure app saw input.
      await yieldFrameLike(docEl, winEl, docEl.hidden ? 1 : 2);
      const after1 = readEditableSnapshot(el);

      let usedFallback = false;
      if (String(text ?? '').length > 0 && after1 === before0) {
        // Rare: insertion happened in DOM but snapshot didn't change or editor reverted.
        // Force a second insertion attempt via execCommand without gating on beforeinput,
        // then ensure input events.
        usedFallback = true;
        try {
          focusDeep(el, docEl, winEl);
          selectContentsWithin(el, docEl, winEl, true);
          try {
            docEl.execCommand?.('insertText', false, String(text ?? ''));
          } catch {}
          // Always follow with input/change to satisfy frameworks that don’t observe execCommand reliably.
          dispatchTextEvents(el, String(text ?? ''), 'insertText');
        } catch {}
        await yieldFrameLike(docEl, winEl, docEl.hidden ? 1 : 2);
      }

      const after2 = readEditableSnapshot(el);
      const success = after2 !== before0 || (!!String(text ?? '') && after2.includes(String(text ?? '')));

      return {
        success,
        method: r0.method,
        details: `${r0.details};beforeLen=${before0.length};afterLen=${after2.length};reverted=${after1 === before0};fallback=${usedFallback}`,
        allowFallback: success ? undefined : true,
      };
    }

    return { success: false, method: 'type', details: 'target not editable', allowFallback: true };
  }

  async function smartTypeAndEnter(
    el: HTMLElement,
    doc: Document,
    win: Window,
    text: string,
    md?: FrameworkElementMetadata,
  ): Promise<SystemToolActionResult> {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const r = await smartType(el, docEl, winEl, text, md);
    if (!r.success) return r;

    const enter = commitEnter(el);
    return { success: true, method: 'type+enter', details: `${r.details};enter=${enter.method}` };
  }

  // function smartType(
  //   el: HTMLElement,
  //   doc: Document,
  //   win: Window,
  //   text: string,
  //   md?: FrameworkElementMetadata,
  // ): SystemToolActionResult {
  //   const sig = signals(el, md);
  //   const docEl = docOf(el, doc);
  //   const winEl = winOfDoc(docEl, win);
  //   const InputEvt = (winEl as any).Event || Event;

  //   scrollIntoView(el, docEl, winEl);
  //   el.focus?.({ preventScroll: true } as any);

  //   const isContentEditable = canUserEdit(el) || (sig.role === 'textbox' && !('value' in (el as any)));
  //   if (isContentEditable) {
  //     try {
  //       docEl.execCommand?.('selectAll', false, undefined);
  //       docEl.execCommand?.('insertText', false, text);
  //     } catch {
  //       // ignore
  //     }
  //     el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
  //     return { success: true, method: 'type-contenteditable' };
  //   }

  //   const input = el as HTMLInputElement | HTMLTextAreaElement;
  //   const proto = Object.getPrototypeOf(input);
  //   const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  //   if (desc?.set) desc.set.call(input, text);
  //   else input.value = text;

  //   input.dispatchEvent(new InputEvt('input', { bubbles: true, composed: true }));
  //   input.dispatchEvent(new InputEvt('change', { bubbles: true, composed: true }));

  //   if (sig.isFrameworkElement || sig.delegatedInput) dispatchKeySequence(input, docEl, winEl, text);

  //   return { success: true, method: 'type-native-setter' };
  // }

  // function smartTypeAndEnter(
  //   el: HTMLElement,
  //   doc: Document,
  //   win: Window,
  //   text: string,
  //   md?: FrameworkElementMetadata,
  // ): SystemToolActionResult {
  //   const docEl = docOf(el, doc);
  //   const winEl = winOfDoc(docEl, win);
  //   const r = smartType(el, docEl, winEl, text, md);

  //   if (!r.success) return r;
  //   pressEnter(el, docEl, winEl);
  //   return { success: true, method: 'type+enter' };
  // }

  async function smartClear(
    el: HTMLElement,
    doc: Document,
    win: Window,
    md?: FrameworkElementMetadata,
  ): Promise<SystemToolActionResult> {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const Evt = (winEl as any).Event || Event;
    scrollIntoView(el, docEl, winEl);

    // Inputs/Textareas
    if (isHTMLInputElementX(el, winEl) || isHTMLTextAreaElementX(el, winEl)) {
      const before0 = readInputValue(el);
      const r = applyClearToInputLike(el, docEl, winEl);
      await yieldFrameLike(docEl, winEl, docEl.hidden ? 1 : 2);
      const after0 = readInputValue(el);
      const reverted = after0 === before0 && before0.length > 0;
      if (reverted) {
        // controlled revert: try again with a stronger event sequence
        try {
          setValueNative(el as any, '');
          dispatchTextEvents(el, '', 'deleteByCut');
        } catch {}
        await yieldFrameLike(docEl, winEl, docEl.hidden ? 1 : 2);
      }
      const after1 = readInputValue(el);
      const success = after1.length === 0 || after1 !== before0;
      return { success: r.success, method: r.method, details: r.details, allowFallback: !r.success };
    }

    // Contenteditable-ish
    const isRichEditable =
      (el as any).isContentEditable === true || (signals(el, md).role === 'textbox' && !('value' in (el as any)));

    if (isRichEditable) {
      const r = applyClearToContentEditableLike(el, docEl, winEl);
      await yieldFrameLike(docEl, winEl, docEl.hidden ? 1 : 2);
      return { success: r.success, method: r.method, details: r.details, allowFallback: !r.success };
    }

    // Generic value fallback
    if ('value' in (el as any)) {
      try {
        (el as any).value = '';
      } catch {}
      el.dispatchEvent(new Evt('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Evt('change', { bubbles: true, composed: true }));
      return { success: true, method: 'clear-generic-value' };
    }

    return { success: false, method: 'clear', details: 'target not clearable', allowFallback: true };
  }

  function smartFocus(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const FocusEvt = (winEl as any).FocusEvent || FocusEvent;
      scrollIntoView(el, docEl, winEl);
      el.focus?.({ preventScroll: true } as any);
      el.dispatchEvent(new FocusEvt('focus', { bubbles: true }));
      el.dispatchEvent(new FocusEvt('focusin', { bubbles: true }));
      return { success: true, method: 'focus' };
    } catch (e: any) {
      return { success: false, method: 'focus', details: e.message, allowFallback: true };
    }
  }

  function smartSelect(
    el: HTMLSelectElement,
    doc: Document,
    win: Window,
    value: string,
    md?: FrameworkElementMetadata,
  ): SystemToolActionResult {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const Evt = (winEl as any).Event || Event;
      if (!isHTMLSelectElementX(el, winEl)) {
        return { success: false, method: 'select', details: 'target not select', allowFallback: true };
      }

      scrollIntoView(el, docEl, winEl);
      el.focus?.({ preventScroll: true } as any);

      const opt = Array.from(el.options).find(o => o.value === value || o.text.trim() === value.trim());
      if (!opt) return { success: false, method: 'select', details: `Option not found: ${value}`, allowFallback: true };

      opt.selected = true;

      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, opt.value);
      else el.value = opt.value;

      el.dispatchEvent(new Evt('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Evt('change', { bubbles: true, composed: true }));

      const sig = signals(el, md);
      if (sig.fws.has('react')) {
        const fiber = detectReactFiber(el);
        if (fiber) {
          const h = extractReactHandlers(fiber);
          if (h.onChange) {
            const evt = synthReactEvent('change', el, docEl, winEl);
            (evt.target as any).value = opt.value;
            h.onChange(evt);
          }
        }
      }

      return { success: true, method: 'select' };
    } catch (e: any) {
      return { success: false, method: 'select', details: e.message, allowFallback: true };
    }
  }

  function smartSlider(
    el: HTMLInputElement,
    doc: Document,
    win: Window,
    value: number,
    md?: FrameworkElementMetadata,
  ): SystemToolActionResult {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const Evt = (winEl as any).Event || Event;
      if (!isHTMLInputElementX(el, winEl)) {
        return { success: false, method: 'slider', details: 'target not input', allowFallback: true };
      }

      scrollIntoView(el, docEl, winEl);
      el.focus?.({ preventScroll: true } as any);

      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, String(value));
      else el.value = String(value);

      el.dispatchEvent(new Evt('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Evt('change', { bubbles: true, composed: true }));

      const sig = signals(el, md);
      if (sig.fws.has('react')) {
        const fiber = detectReactFiber(el);
        if (fiber) {
          const h = extractReactHandlers(fiber);
          if (h.onChange) {
            const evt = synthReactEvent('change', el, docEl, winEl);
            (evt.target as any).value = String(value);
            h.onChange(evt);
          }
        }
      }

      return { success: true, method: 'slider' };
    } catch (e: any) {
      return { success: false, method: 'slider', details: e.message, allowFallback: true };
    }
  }

  function checkValidity(
    el: HTMLInputElement | HTMLTextAreaElement,
    doc: Document,
    win: Window,
  ): SystemToolActionResult {
    try {
      const ok = el.checkValidity?.() ?? true;
      if (!ok) el.reportValidity?.();
      return { success: ok, method: 'check-validity', details: ok ? undefined : el.validationMessage };
    } catch (e: any) {
      return { success: false, method: 'check-validity', details: e.message, allowFallback: true };
    }
  }

  function selectText(
    el: HTMLElement,
    doc: Document,
    win: Window,
    start?: number,
    end?: number,
  ): SystemToolActionResult {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);

      if ('setSelectionRange' in (el as any)) {
        const inp = el as HTMLInputElement;
        inp.focus?.();
        const len = inp.value?.length ?? 0;
        inp.setSelectionRange(start ?? 0, end ?? len);
        return { success: true, method: 'select-range' };
      }
      const sel = winEl.getSelection();
      if (!sel) return { success: false, method: 'select-range', allowFallback: true };
      const range = docEl.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return { success: true, method: 'select-range-node' };
    } catch (e: any) {
      return { success: false, method: 'select-range', details: e.message, allowFallback: true };
    }
  }

  // ---------------- SCROLL / WHEEL ----------------

  function directScrollFallback(
    container: HTMLElement | null,
    doc: Document,
    win: Window,
    direction: ScrollDirectionEnum,
    amount?: number,
  ) {
    const root = getRootScroller((container && docOf(container)) ?? doc);
    const target = container || root;

    const docEl = docOf(target, doc);
    const winEl = winOfDoc(docEl, win);

    const isRoot = target === docEl.documentElement || target === docEl.body || target === root;

    if (direction === ScrollDirectionEnum.TOP || direction === ScrollDirectionEnum.BOTTOM) {
      const scrollHeight = target.scrollHeight;
      const clientHeight = isRoot ? winEl.innerHeight : target.clientHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);
      target.scrollTop = direction === ScrollDirectionEnum.TOP ? 0 : maxScroll;
      return { success: true, scrollTop: target.scrollTop };
    }

    return directScrollBy(target, docEl, winEl, direction, amount);
  }

  async function smartScrollMainWorld(
    element: HTMLElement | null,
    doc: Document,
    win: Window,
    args: any,
  ): Promise<SystemToolActionResult> {
    const direction = args.direction as ScrollDirectionEnum;
    const amount = args.amount as number | undefined;
    const docEl = docOf(element, doc);
    const winEl = winOfDoc(docEl, win);

    const isTabActive = !docEl.hidden;
    const behavior: ScrollBehavior = isTabActive ? 'smooth' : 'auto';

    try {
      if (element) {
        const container = findScrollableParentElement(element, docEl, winEl);
        const direct = directScrollFallback(container, docEl, winEl, direction, amount);
        return direct?.success
          ? { success: true, method: 'direct-element-scroll', details: JSON.stringify(direct) }
          : {
              success: false,
              method: 'direct-element-scroll',
              details: (direct as any)?.error || 'direct scroll failed',
              allowFallback: true,
            };
      }

      if (direction === ScrollDirectionEnum.TOP || direction === ScrollDirectionEnum.BOTTOM) {
        const result = await sendScrollCommandInWindow(
          winEl,
          {
            action: 'scrollTo',
            direction,
            options: { behavior, isTabActive },
          },
          { doc: docEl, timeoutMs: docEl.hidden ? 5200 : 2800 },
        );
        return { success: true, method: 'detector-scrollTo', details: JSON.stringify(result) };
      }

      const result = await sendScrollCommandInWindow(
        winEl,
        {
          action: 'scrollBy',
          direction,
          options: { amount, behavior, isTabActive },
        },
        { doc: docEl, timeoutMs: docEl.hidden ? 5200 : 2800 },
      );
      return { success: true, method: 'detector-scrollBy', details: JSON.stringify(result) };
    } catch (e: any) {
      const direct = docEl ? directScrollFallback(getRootScroller(docEl), docEl, winEl, direction, amount) : undefined;
      return direct?.success
        ? { success: true, method: 'direct-primary-scroll-fallback', details: JSON.stringify(direct) }
        : {
            success: false,
            method: 'scroll-page-failed',
            details: e?.message || (direct as any)?.error || 'scroll_page failed',
            allowFallback: true,
          };
    }
  }

  async function smartScrollToElementMainWorld(
    element: HTMLElement,
    doc: Document,
    win: Window,
    args: any,
  ): Promise<SystemToolActionResult> {
    const docEl = docOf(element, doc);
    const winEl = winOfDoc(docEl, win);
    const isTabActive = !docEl.hidden;
    const behavior: ScrollBehavior = isTabActive ? 'smooth' : 'auto';
    const position = normalizeScrollAlignment(args.position);

    const selector = getElementSelector(element, docEl);

    if (!selector) {
      const direct = directScrollElementIntoView(element, docEl, winEl, position);
      return {
        success: direct.success,
        method: 'direct-scrollElement-no-selector',
        details: (direct as any).error,
        allowFallback: !direct.success,
      };
    }

    try {
      const result = await sendScrollCommandInWindow(
        winEl,
        {
          action: 'scrollElement',
          selector,
          position,
          options: { behavior, isTabActive },
        },
        { doc: docEl, timeoutMs: docEl.hidden ? 5600 : 3000 },
      );
      return { success: true, method: 'detector-scrollElement', details: JSON.stringify(result) };
    } catch (e: any) {
      const direct = directScrollElementIntoView(element, docEl, winEl, position);
      return direct.success
        ? { success: true, method: 'direct-scrollElement-fallback', details: JSON.stringify(direct) }
        : {
            success: false,
            method: 'scroll-to-element-failed',
            details: e?.message || (direct as any).error || 'scroll_to_element failed',
            allowFallback: true,
          };
    }
  }

  function smartWheel(el: HTMLElement, doc: Document, win: Window, dx: number, dy: number): SystemToolActionResult {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const WheelEvt = (winEl as any).WheelEvent || WheelEvent;

      scrollIntoView(el, docEl, winEl);

      const scrollNode = findScrollableParentElement(el, docEl, winEl);
      scrollNode.dispatchEvent(
        new WheelEvt('wheel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: winEl,
          deltaX: dx || 0,
          deltaY: dy || 0,
          deltaMode: WheelEvt.DOM_DELTA_PIXEL,
        }),
      );
      scrollNode.scrollBy({ left: dx || 0, top: dy || 0, behavior: 'auto' });
      return { success: true, method: 'wheel' };
    } catch (e: any) {
      return { success: false, method: 'wheel', details: e.message, allowFallback: true };
    }
  }

  function findScrollableParentElement(element: HTMLElement, doc: Document, win: Window): HTMLElement {
    const docEl = docOf(element, doc);
    const winEl = winOfDoc(docEl, win);

    const scrollingElement =
      (docEl.scrollingElement as HTMLElement | null) || docEl.documentElement || (docEl.body as HTMLElement);

    let current: HTMLElement | null = element;
    while (current && current !== docEl.body && current !== docEl.documentElement) {
      const style = winEl.getComputedStyle(current);
      const overflowY = style.overflowY;
      const canScrollY =
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        current.scrollHeight > current.clientHeight + 5;
      if (canScrollY) return current;
      current = current.parentElement;
    }
    return scrollingElement;
  }

  // ---------------- DRAG / DROP ----------------
  async function smartDrag(
    el: HTMLElement,
    doc: Document,
    win: Window,
    args: any,
    md?: FrameworkElementMetadata,
  ): Promise<SystemToolActionResult> {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
      const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
      const DragEvt = (winEl as any).DragEvent || DragEvent;
      const WinDataTransfer = (winEl as any).DataTransfer || DataTransfer;

      scrollIntoView(el, docEl, winEl);

      const pt = bestClickablePoint(el, docEl, winEl);
      const startHit = (isHTMLElementLike(pt.hit, winEl) ? pt.hit : el) as HTMLElement;
      const r = el.getBoundingClientRect();
      const dist = Number.isFinite(Number(args?.distance)) ? Number(args.distance) : 160;

      let dx = 0,
        dy = 0;
      switch (String(args?.direction || '').toUpperCase()) {
        case 'UP':
          dy = -dist;
          break;
        case 'DOWN':
          dy = dist;
          break;
        case 'LEFT':
          dx = -dist;
          break;
        case 'RIGHT':
          dx = dist;
          break;
        default:
          dx = Number(args?.delta_x) || 0;
          dy = Number(args?.delta_y) || 0;
      }

      const clamp = (x: number, y: number) => ({
        x: Math.max(2, Math.min(x, winEl.innerWidth - 3)),
        y: Math.max(2, Math.min(y, winEl.innerHeight - 3)),
      });
      const start = clamp(pt.x, pt.y);
      const end = clamp(pt.x + dx, pt.y + dy);

      const pointerId = 500 + (Date.now() % 10000);
      const steps = Math.max(12, Math.min(36, Number(args?.steps) || 18));

      const mkBase = (x: number, y: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        view: winEl,
        clientX: x,
        clientY: y,
        pageX: x + (winEl.scrollX || 0),
        pageY: y + (winEl.scrollY || 0),
      });
      const mkPtr = (x: number, y: number, buttons: number): PointerEventInit => ({
        ...mkBase(x, y),
        pointerId,
        pointerType: 'mouse',
        isPrimary: true,
        width: 1,
        height: 1,
        pressure: buttons ? 0.5 : 0,
        buttons,
        button: 0,
      });
      const mkMouse = (x: number, y: number, buttons: number): MouseEventInit => ({
        ...mkBase(x, y),
        buttons,
        button: 0,
      });

      // down
      startHit.dispatchEvent(new PointerEvt('pointerdown', mkPtr(start.x, start.y, 1)));
      startHit.dispatchEvent(new MouseEvt('mousedown', mkMouse(start.x, start.y, 1)));
      try {
        (startHit as any).setPointerCapture?.(pointerId);
      } catch {}

      // Optional HTML5 drag sequence if draggable-ish
      let dt: DataTransfer | null = null;
      try {
        if (el.draggable || signals(el, md).sourcesByType.has('dragstart')) dt = new WinDataTransfer();
      } catch {
        dt = null;
      }
      if (dt) {
        try {
          el.dispatchEvent(
            new DragEvt('dragstart', {
              bubbles: true,
              cancelable: true,
              clientX: start.x,
              clientY: start.y,
              dataTransfer: dt,
            }),
          );
        } catch {}
      }

      let lastOver: HTMLElement | null = null;
      for (let i = 1; i <= steps; i++) {
        const x = start.x + ((end.x - start.x) * i) / steps;
        const y = start.y + ((end.y - start.y) * i) / steps;
        const hit = (docEl.elementFromPoint(x, y) as HTMLElement) || el;

        // pointer/mouse moves should target the hit node (bubbles to doc)
        hit.dispatchEvent(new PointerEvt('pointermove', mkPtr(x, y, 1)));
        hit.dispatchEvent(new MouseEvt('mousemove', mkMouse(x, y, 1)));

        if (dt) {
          try {
            if (lastOver && lastOver !== hit) {
              lastOver.dispatchEvent(
                new DragEvt('dragleave', {
                  bubbles: true,
                  cancelable: true,
                  clientX: x,
                  clientY: y,
                  dataTransfer: dt,
                }),
              );
            }
            hit.dispatchEvent(
              new DragEvt('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
            );
            lastOver = hit;
          } catch {}
        }

        if (i % 3 === 0) await yieldOnce(); // no timers; bg-safe
      }

      const endHit = (docEl.elementFromPoint(end.x, end.y) as HTMLElement) || el;
      endHit.dispatchEvent(new PointerEvt('pointerup', mkPtr(end.x, end.y, 0)));
      endHit.dispatchEvent(new MouseEvt('mouseup', mkMouse(end.x, end.y, 0)));

      if (dt) {
        try {
          el.dispatchEvent(
            new DragEvt('dragend', {
              bubbles: true,
              cancelable: true,
              clientX: end.x,
              clientY: end.y,
              dataTransfer: dt,
            }),
          );
        } catch {}
      }

      return { success: true, method: 'drag', details: `dx=${dx};dy=${dy};steps=${steps};hitOk=${pt.ok}` };
    } catch (e: any) {
      return { success: false, method: 'drag', details: e?.message || 'drag failed', allowFallback: true };
    }
  }

  async function smartDragDrop(
    args: any,
    el: HTMLElement | null | undefined,
    doc: Document,
    win: Window,
  ): Promise<SystemToolActionResult> {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
      const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
      const DragEvt = (winEl as any).DragEvent || DragEvent;
      const WinDataTransfer = (winEl as any).DataTransfer || DataTransfer;

      const sourceId = args?.source_element_id ?? args?.element_id;
      const source = (sourceId ? resolveInteractiveElementById(docEl, String(sourceId)) : null) || el;
      if (!source) return { success: false, method: 'drag-drop', details: 'source missing', allowFallback: true };

      let target: HTMLElement | null = null;
      let tx = Number(args?.target_x);
      let ty = Number(args?.target_y);

      if (args?.target_element_id) {
        target = resolveInteractiveElementById(docEl, String(args.target_element_id));
        if (!target) return { success: false, method: 'drag-drop', details: 'target missing', allowFallback: true };
        const tr = target.getBoundingClientRect();
        tx = tr.left + tr.width / 2;
        ty = tr.top + tr.height / 2;
      }

      if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
        if (!target)
          return { success: false, method: 'drag-drop', details: 'missing target coords', allowFallback: true };
      }

      scrollIntoView(source, docEl, winEl);
      if (target) scrollIntoView(target, docEl, winEl);

      const clamp = (x: number, y: number) => ({
        x: Math.max(2, Math.min(x, winEl.innerWidth - 3)),
        y: Math.max(2, Math.min(y, winEl.innerHeight - 3)),
      });

      const sr = source.getBoundingClientRect();
      const start = clamp(sr.left + sr.width / 2, sr.top + sr.height / 2);
      const end = clamp(Number(tx), Number(ty));

      const pointerId = 600 + (Date.now() % 10000);
      const steps = Math.max(14, Math.min(42, Number(args?.steps) || 22));

      const mkBase = (x: number, y: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        view: winEl,
        clientX: x,
        clientY: y,
        pageX: x + (winEl.scrollX || 0),
        pageY: y + (winEl.scrollY || 0),
      });
      const mkPtr = (x: number, y: number, buttons: number): PointerEventInit => ({
        ...mkBase(x, y),
        pointerId,
        pointerType: 'mouse',
        isPrimary: true,
        width: 1,
        height: 1,
        pressure: buttons ? 0.5 : 0,
        buttons,
        button: 0,
      });
      const mkMouse = (x: number, y: number, buttons: number): MouseEventInit => ({
        ...mkBase(x, y),
        buttons,
        button: 0,
      });

      let dt: DataTransfer | null = null;
      try {
        dt = new WinDataTransfer();
      } catch {
        dt = null;
      }

      source.dispatchEvent(new PointerEvt('pointerdown', mkPtr(start.x, start.y, 1)));
      source.dispatchEvent(new MouseEvt('mousedown', mkMouse(start.x, start.y, 1)));
      try {
        (source as any).setPointerCapture?.(pointerId);
      } catch {}

      if (dt) {
        try {
          source.dispatchEvent(
            new DragEvt('dragstart', {
              bubbles: true,
              cancelable: true,
              clientX: start.x,
              clientY: start.y,
              dataTransfer: dt,
            }),
          );
        } catch {}
      }

      let lastOver: HTMLElement | null = null;
      for (let i = 1; i <= steps; i++) {
        const x = start.x + ((end.x - start.x) * i) / steps;
        const y = start.y + ((end.y - start.y) * i) / steps;
        const hit = (docEl.elementFromPoint(x, y) as HTMLElement) || target || docEl.body;

        hit.dispatchEvent(new PointerEvt('pointermove', mkPtr(x, y, 1)));
        hit.dispatchEvent(new MouseEvt('mousemove', mkMouse(x, y, 1)));

        if (dt) {
          try {
            if (lastOver && lastOver !== hit) {
              lastOver.dispatchEvent(
                new DragEvt('dragleave', {
                  bubbles: true,
                  cancelable: true,
                  clientX: x,
                  clientY: y,
                  dataTransfer: dt,
                }),
              );
            }
            hit.dispatchEvent(
              new DragEvt('dragenter', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
            );
            hit.dispatchEvent(
              new DragEvt('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
            );
            lastOver = hit;
          } catch {}
        }

        if (i % 3 === 0) await yieldOnce();
      }

      const dropTarget = target || (docEl.elementFromPoint(end.x, end.y) as HTMLElement) || docEl.body;
      if (dt) {
        try {
          dropTarget.dispatchEvent(
            new DragEvt('drop', {
              bubbles: true,
              cancelable: true,
              clientX: end.x,
              clientY: end.y,
              dataTransfer: dt,
            }),
          );
        } catch {}
      }

      dropTarget.dispatchEvent(new PointerEvt('pointerup', mkPtr(end.x, end.y, 0)));
      dropTarget.dispatchEvent(new MouseEvt('mouseup', mkMouse(end.x, end.y, 0)));
      if (dt) {
        try {
          source.dispatchEvent(
            new DragEvt('dragend', {
              bubbles: true,
              cancelable: true,
              clientX: end.x,
              clientY: end.y,
              dataTransfer: dt,
            }),
          );
        } catch {}
      }

      return { success: true, method: 'html5+pointer-dragdrop', details: `steps=${steps};source=${String(sourceId)}` };
    } catch (e: any) {
      return { success: false, method: 'drag-drop', details: e?.message || 'drag-drop failed', allowFallback: true };
    }
  }

  // ---------------- SWIPE / LONG PRESS / PINCH ----------------
  async function smartSwipe(el: HTMLElement, doc: Document, win: Window, args: any): Promise<SystemToolActionResult> {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
      const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
      scrollIntoView(el, docEl, winEl);

      const pt = bestClickablePoint(el, docEl, winEl);
      const start = { x: pt.x, y: pt.y };
      const r = el.getBoundingClientRect();
      const dist = Number.isFinite(Number(args?.distance))
        ? Number(args.distance)
        : Math.min(Math.max(80, Math.min(r.width, r.height)), 220);

      const dir = String(args?.direction || 'RIGHT').toUpperCase();
      let ex = start.x,
        ey = start.y;
      if (dir === 'LEFT') ex -= dist;
      if (dir === 'RIGHT') ex += dist;
      if (dir === 'UP') ey -= dist;
      if (dir === 'DOWN') ey += dist;

      const clamp = (x: number, y: number) => ({
        x: Math.max(2, Math.min(x, winEl.innerWidth - 3)),
        y: Math.max(2, Math.min(y, winEl.innerHeight - 3)),
      });
      const s = clamp(start.x, start.y);
      const e = clamp(ex, ey);

      const pointerId = 700 + (Date.now() % 10000);
      const steps = Math.max(10, Math.min(28, Number(args?.steps) || 16));

      const mkBase = (x: number, y: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        view: winEl,
        clientX: x,
        clientY: y,
        pageX: x + (winEl.scrollX || 0),
        pageY: y + (winEl.scrollY || 0),
      });
      const mkPtr = (x: number, y: number, buttons: number): PointerEventInit => ({
        ...mkBase(x, y),
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        width: 1,
        height: 1,
        pressure: buttons ? 0.5 : 0,
        buttons,
        button: 0,
      });
      const mkMouse = (x: number, y: number, buttons: number): MouseEventInit => ({
        ...mkBase(x, y),
        buttons,
        button: 0,
      });

      const startHit = (docEl.elementFromPoint(s.x, s.y) as HTMLElement) || el;
      startHit.dispatchEvent(new PointerEvt('pointerdown', mkPtr(s.x, s.y, 1)));
      startHit.dispatchEvent(new MouseEvt('mousedown', mkMouse(s.x, s.y, 1)));

      // TouchEvents if constructible (best-effort)
      const TouchCtor: any = (winEl as any).Touch;
      const TouchEventCtor: any = (winEl as any).TouchEvent;
      const canTouch = !!TouchCtor && !!TouchEventCtor;
      if (canTouch) {
        try {
          const t = new TouchCtor({
            identifier: pointerId,
            target: startHit,
            clientX: s.x,
            clientY: s.y,
            pageX: s.x,
            pageY: s.y,
            screenX: s.x,
            screenY: s.y,
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 1,
          });
          startHit.dispatchEvent(
            new TouchEventCtor('touchstart', {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [t],
              targetTouches: [t],
              changedTouches: [t],
            }),
          );
        } catch {}
      }

      for (let i = 1; i <= steps; i++) {
        const x = s.x + ((e.x - s.x) * i) / steps;
        const y = s.y + ((e.y - s.y) * i) / steps;
        const hit = (docEl.elementFromPoint(x, y) as HTMLElement) || el;

        hit.dispatchEvent(new PointerEvt('pointermove', mkPtr(x, y, 1)));
        hit.dispatchEvent(new MouseEvt('mousemove', mkMouse(x, y, 1)));

        if (canTouch) {
          try {
            const t = new TouchCtor({
              identifier: pointerId,
              target: hit,
              clientX: x,
              clientY: y,
              pageX: x,
              pageY: y,
              screenX: x,
              screenY: y,
              radiusX: 1,
              radiusY: 1,
              rotationAngle: 0,
              force: 1,
            });
            hit.dispatchEvent(
              new TouchEventCtor('touchmove', {
                bubbles: true,
                cancelable: true,
                composed: true,
                touches: [t],
                targetTouches: [t],
                changedTouches: [t],
              }),
            );
          } catch {}
        }

        if (i % 3 === 0) await yieldOnce();
      }

      const endHit = (docEl.elementFromPoint(e.x, e.y) as HTMLElement) || el;
      endHit.dispatchEvent(new PointerEvt('pointerup', mkPtr(e.x, e.y, 0)));
      endHit.dispatchEvent(new MouseEvt('mouseup', mkMouse(e.x, e.y, 0)));

      if (canTouch) {
        try {
          const t = new TouchCtor({
            identifier: pointerId,
            target: endHit,
            clientX: e.x,
            clientY: e.y,
            pageX: e.x,
            pageY: e.y,
            screenX: e.x,
            screenY: e.y,
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 0,
          });
          endHit.dispatchEvent(
            new TouchEventCtor('touchend', {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [],
              targetTouches: [],
              changedTouches: [t],
            }),
          );
        } catch {}
      }

      return { success: true, method: 'swipe', details: `dir=${dir};dist=${dist};steps=${steps};hitOk=${pt.ok}` };
    } catch (e: any) {
      return { success: false, method: 'swipe', details: e?.message || 'swipe failed', allowFallback: true };
    }
  }

  async function pinchZoom(
    target: HTMLElement | null,
    doc: Document,
    win: Window,
    args: any,
  ): Promise<SystemToolActionResult> {
    try {
      const el = target || doc.body;
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
      const WheelEvt = (winEl as any).WheelEvent || WheelEvent;
      scrollIntoView(el, docEl, winEl);

      const scale = Number.isFinite(Number(args?.scale)) ? Number(args.scale) : 1.2;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const startGap = 24;
      const endGap = Math.max(6, Math.min(200, startGap * scale));
      const steps = Math.max(6, Math.min(18, Number(args?.steps) || 10));

      // TouchEvent pinch if constructible
      const TouchCtor: any = (winEl as any).Touch;
      const TouchEventCtor: any = (winEl as any).TouchEvent;
      const canTouch = !!TouchCtor && !!TouchEventCtor;
      if (canTouch) {
        try {
          const id1 = 911,
            id2 = 912;
          const mkTouch = (identifier: number, x: number) =>
            new TouchCtor({
              identifier,
              target: el,
              clientX: x,
              clientY: cy,
              pageX: x,
              pageY: cy,
              screenX: x,
              screenY: cy,
              radiusX: 1,
              radiusY: 1,
              rotationAngle: 0,
              force: 1,
            });

          const t1s = mkTouch(id1, cx - startGap);
          const t2s = mkTouch(id2, cx + startGap);
          el.dispatchEvent(
            new TouchEventCtor('touchstart', {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [t1s, t2s],
              targetTouches: [t1s, t2s],
              changedTouches: [t1s, t2s],
            }),
          );

          for (let i = 1; i <= steps; i++) {
            const gap = startGap + ((endGap - startGap) * i) / steps;
            const t1m = mkTouch(id1, cx - gap);
            const t2m = mkTouch(id2, cx + gap);
            el.dispatchEvent(
              new TouchEventCtor('touchmove', {
                bubbles: true,
                cancelable: true,
                composed: true,
                touches: [t1m, t2m],
                targetTouches: [t1m, t2m],
                changedTouches: [t1m, t2m],
              }),
            );
            if (i % 2 === 0) await yieldOnce();
          }

          const t1e = mkTouch(id1, cx - endGap);
          const t2e = mkTouch(id2, cx + endGap);
          el.dispatchEvent(
            new TouchEventCtor('touchend', {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [],
              targetTouches: [],
              changedTouches: [t1e, t2e],
            }),
          );
        } catch {
          /* ignore; still do pointerwheel below */
        }
      }

      // Pointer multi-touch pinch
      try {
        const pid1 = 821,
          pid2 = 822;
        const mkPtr = (pointerId: number, x: number, buttons: number): PointerEventInit => ({
          bubbles: true,
          cancelable: true,
          composed: true,
          view: winEl,
          clientX: x,
          clientY: cy,
          pointerId,
          pointerType: 'touch',
          isPrimary: pointerId === pid1,
          width: 1,
          height: 1,
          pressure: buttons ? 0.5 : 0,
          buttons,
          button: 0,
        });
        el.dispatchEvent(new PointerEvt('pointerdown', mkPtr(pid1, cx - startGap, 1)));
        el.dispatchEvent(new PointerEvt('pointerdown', mkPtr(pid2, cx + startGap, 1)));
        for (let i = 1; i <= steps; i++) {
          const gap = startGap + ((endGap - startGap) * i) / steps;
          el.dispatchEvent(new PointerEvt('pointermove', mkPtr(pid1, cx - gap, 1)));
          el.dispatchEvent(new PointerEvt('pointermove', mkPtr(pid2, cx + gap, 1)));
          if (i % 2 === 0) await yieldOnce();
        }
        el.dispatchEvent(new PointerEvt('pointerup', mkPtr(pid1, cx - endGap, 0)));
        el.dispatchEvent(new PointerEvt('pointerup', mkPtr(pid2, cx + endGap, 0)));
      } catch {}

      // Desktop ctrlwheel fallback (very important for maps/canvas apps)
      try {
        const dy = scale >= 1 ? -120 : 120;
        el.dispatchEvent(
          new WheelEvt('wheel', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: winEl,
            clientX: cx,
            clientY: cy,
            ctrlKey: true,
            deltaY: dy,
            deltaMode: WheelEvt.DOM_DELTA_PIXEL,
          }),
        );
      } catch {}

      return { success: true, method: 'pinch-zoom', details: `scale=${scale};steps=${steps}` };
    } catch (e: any) {
      return { success: false, method: 'pinch-zoom', details: e?.message || 'pinch-zoom failed', allowFallback: true };
    }
  }

  async function longPress(
    el: HTMLElement,
    doc: Document,
    win: Window,
    duration = 800,
  ): Promise<SystemToolActionResult> {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
      const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
      const FocusEvt = (winEl as any).FocusEvent || FocusEvent;
      scrollIntoView(el, docEl, winEl);

      // Use the same hit-testing logic as click to avoid overlays / covered centers
      const pt = bestClickablePoint(el, docEl, winEl); // {x,y,hit,ok}
      let target: HTMLElement = el;
      if (!pt.ok && isHTMLElementLike(pt.hit, winEl)) {
        target =
          (pt.hit.closest?.(
            'a,button,input,select,textarea,summary,[role="button"],[role="link"],[onclick]',
          ) as HTMLElement) || pt.hit;
      } else if (isHTMLElementLike(pt.hit, winEl)) {
        target = pt.hit;
      }

      const before = snapClickState(target, docEl, winEl); // reuse your robust snapshot

      const x = pt.x;
      const y = pt.y;
      const pointerId = 1 + (Date.now() % 10000);

      const baseMouse: MouseEventInit & any = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: winEl,
        clientX: x,
        clientY: y,
        pageX: x + (winEl.scrollX || 0),
        pageY: y + (winEl.scrollY || 0),
        screenX: x + ((winEl as any).screenX || 0),
        screenY: y + ((winEl as any).screenY || 0),
      };

      const basePtr: PointerEventInit = {
        ...baseMouse,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        width: 1,
        height: 1,
        pressure: 0,
        buttons: 0,
        button: 0,
      };

      // enter/over (helps menus/tooltips that gate on hover-like state)
      try {
        target.dispatchEvent(new PointerEvt('pointerover', basePtr));
        target.dispatchEvent(new PointerEvt('pointerenter', { ...basePtr, bubbles: false }));
      } catch {}
      try {
        target.dispatchEvent(new MouseEvt('mouseover', baseMouse));
        target.dispatchEvent(new MouseEvt('mouseenter', { ...baseMouse, bubbles: false }));
      } catch {}

      // focus (many “press to open” widgets require focus)
      try {
        target.focus?.({ preventScroll: true } as any);
        target.dispatchEvent(new FocusEvt('focus', { bubbles: true, composed: true }));
        target.dispatchEvent(new FocusEvt('focusin', { bubbles: true, composed: true }));
      } catch {}

      // down
      try {
        target.dispatchEvent(new PointerEvt('pointerdown', { ...basePtr, buttons: 1, pressure: 0.5 }));
      } catch {}
      try {
        target.dispatchEvent(new MouseEvt('mousedown', { ...baseMouse, buttons: 1, button: 0 }));
      } catch {}

      // touchstart (some libs require real touch events)
      try {
        const TouchCtor: any = (winEl as any).Touch;
        const TouchEventCtor: any = (winEl as any).TouchEvent;
        if (typeof TouchCtor !== 'undefined' && typeof TouchEventCtor !== 'undefined') {
          const t = new TouchCtor({
            identifier: pointerId,
            target,
            clientX: x,
            clientY: y,
            pageX: x + (winEl.scrollX || 0),
            pageY: y + (winEl.scrollY || 0),
            screenX: x + ((winEl as any).screenX || 0),
            screenY: y + ((winEl as any).screenY || 0),
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 1,
          });
          target.dispatchEvent(
            new TouchEventCtor('touchstart', {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [t],
              targetTouches: [t],
              changedTouches: [t],
            }),
          );
        }
      } catch {}

      // Background tabs clamp page-side timers (many long-press implementations use setTimeout internally),
      // so hold longer when hidden to ensure the page’s timer-based threshold can elapse.
      const requested = Number(duration);
      const d = Number.isFinite(requested) && requested > 0 ? requested : 800;
      const holdMs = docEl.hidden ? Math.max(d, 1200) : d;

      await sleepBgSafe(holdMs, docEl);

      // contextmenu at end of hold (common long-press hook)
      try {
        target.dispatchEvent(new MouseEvt('contextmenu', { ...baseMouse, button: 2, buttons: 2 }));
      } catch {}

      // up
      try {
        target.dispatchEvent(new PointerEvt('pointerup', { ...basePtr, buttons: 0, pressure: 0 }));
      } catch {}
      try {
        target.dispatchEvent(new MouseEvt('mouseup', { ...baseMouse, buttons: 0, button: 0 }));
      } catch {}

      // touchend
      try {
        const TouchCtor: any = (winEl as any).Touch;
        const TouchEventCtor: any = (winEl as any).TouchEvent;
        if (typeof TouchCtor !== 'undefined' && typeof TouchEventCtor !== 'undefined') {
          const t = new TouchCtor({
            identifier: pointerId,
            target,
            clientX: x,
            clientY: y,
            pageX: x + (winEl.scrollX || 0),
            pageY: y + (winEl.scrollY || 0),
            screenX: x + ((winEl as any).screenX || 0),
            screenY: y + ((winEl as any).screenY || 0),
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 0,
          });
          target.dispatchEvent(
            new TouchEventCtor('touchend', {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [],
              targetTouches: [],
              changedTouches: [t],
            }),
          );
        }
      } catch {}

      const verified = await verifyClick(target, docEl, winEl, before);

      return {
        success: true,
        method: 'long-press',
        details: `holdMs=${holdMs};verified=${verified};hitOk=${pt.ok};target=${target.tagName.toLowerCase()}`,
      };
    } catch (e: any) {
      return { success: false, method: 'long-press', details: e?.message || 'long-press failed', allowFallback: true };
    }
  }

  // ---------------- KEY / CLIPBOARD / UPLOAD ----------------

  function pressKey(
    key: string,
    modifiers: string[] | undefined,
    el: HTMLElement | null | undefined,
    doc: Document,
    win: Window,
  ): SystemToolActionResult {
    try {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;
      const target =
        el || (docEl.activeElement as HTMLElement) || (docEl.body as any) || (docEl.documentElement as any);
      target.focus?.();

      const init: KeyboardEventInit = {
        key,
        code: keyToCode(key),
        bubbles: true,
        cancelable: true,
        ctrlKey: modifiers?.includes('CTRL'),
        altKey: modifiers?.includes('ALT'),
        shiftKey: modifiers?.includes('SHIFT'),
        metaKey: modifiers?.includes('META'),
      };

      const okDown = target.dispatchEvent(new KeyboardEvt('keydown', init));
      const okPress = target.dispatchEvent(new KeyboardEvt('keypress', init));
      const okUp = target.dispatchEvent(new KeyboardEvt('keyup', init));
      const canceled = !(okDown && okPress && okUp);

      // Only submit if not handled/canceled by app code.
      if (key === 'Enter' && !canceled) {
        const form = (target as any).form || (target.closest?.('form') as HTMLFormElement | null);
        if (form?.requestSubmit) form.requestSubmit();
        else form?.submit?.();
      }

      return { success: true, method: 'press-key' };
    } catch (e: any) {
      return { success: false, method: 'press-key', details: e.message, allowFallback: true };
    }
  }

  async function copyText(el: HTMLElement, doc: Document, win: Window): Promise<SystemToolActionResult> {
    try {
      const text = el.innerText || (el as any).value || '';
      if (!text) return { success: false, method: 'copy', details: 'nothing to copy', allowFallback: true };

      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      if (winEl.navigator?.clipboard?.writeText) {
        await winEl.navigator.clipboard.writeText(text);
        return { success: true, method: 'clipboard-copy' };
      }

      const range = docEl.createRange();
      range.selectNodeContents(el);
      const sel = winEl.getSelection?.() || (docEl.defaultView || window).getSelection?.();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const ok = docEl.execCommand?.('copy') ?? false;
      sel?.removeAllRanges();

      return { success: !!ok, method: 'execCommand-copy', allowFallback: !ok };
    } catch (e: any) {
      return { success: false, method: 'clipboard-copy', details: e.message, allowFallback: true };
    }
  }

  async function pasteText(
    el: HTMLElement,
    doc: Document,
    win: Window,
    md: FrameworkElementMetadata | undefined,
  ): Promise<SystemToolActionResult> {
    try {
      el.focus?.();
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      if (winEl.navigator?.clipboard?.readText) {
        const text = await winEl.navigator.clipboard.readText();
        if (text) return await smartType(el, docEl, winEl, text, md);
      }

      const ok = docEl.execCommand?.('paste') ?? false;
      return ok
        ? { success: true, method: 'execCommand-paste' }
        : { success: false, method: 'paste', details: 'clipboard empty or denied', allowFallback: true };
    } catch (e: any) {
      return { success: false, method: 'paste', details: e.message, allowFallback: true };
    }
  }

  function formatKB(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  function findNearestFileInput(preferredEl: HTMLElement, doc: Document): HTMLInputElement | null {
    // 1) If it's already an <input type=file>, done
    if (preferredEl instanceof (doc.defaultView as any).HTMLInputElement) {
      const inp = preferredEl as HTMLInputElement;
      if ((inp.type || '').toLowerCase() === 'file') return inp;
    }

    // 2) If it's a <label for="..."> or inside label, resolve to input#id
    const label = preferredEl.closest?.('label') as HTMLLabelElement | null;
    const htmlFor = (label?.htmlFor || (preferredEl as any).htmlFor || '') as string;
    if (htmlFor) {
      const byId = doc.getElementById(htmlFor) as HTMLInputElement | null;
      if (byId && (byId.type || '').toLowerCase() === 'file') return byId;
    }

    // 3) If label wraps an input
    if (label) {
      const wrapped = label.querySelector?.('input[type="file"]') as HTMLInputElement | null;
      if (wrapped) return wrapped;
    }

    // 4) Same form fallback
    const form = preferredEl.closest?.('form');
    if (form) {
      const inForm = form.querySelector?.('input[type="file"]') as HTMLInputElement | null;
      if (inForm) return inForm;
    }

    // 5) Nearby container fallback
    const container = preferredEl.closest?.('div,section,main,article') || preferredEl.parentElement;
    if (container) {
      const near = container.querySelector?.('input[type="file"]') as HTMLInputElement | null;
      if (near) return near;
    }

    return null;
  }

  function setInputFilesSafely(fileInput: HTMLInputElement, files: FileList, winEl: Window): boolean {
    try {
      // Prefer native setter on HTMLInputElement.prototype if present
      const proto = (winEl as any).HTMLInputElement?.prototype;
      let setter: any = proto ? Object.getOwnPropertyDescriptor(proto, 'files')?.set : undefined;

      // Fallback: walk prototype chain
      if (!setter) {
        let p: any = Object.getPrototypeOf(fileInput);
        while (p && !setter) {
          setter = Object.getOwnPropertyDescriptor(p, 'files')?.set;
          p = Object.getPrototypeOf(p);
        }
      }

      if (setter) {
        setter.call(fileInput, files);
        return true;
      }

      (fileInput as any).files = files;
      return true;
    } catch {
      try {
        (fileInput as any).files = files;
        return true;
      } catch {
        return false;
      }
    }
  }

  // MAIN world content script
  async function uploadFile(
    args: any,
    doc: Document,
    win: Window,
    payload: UploadFilePayload | undefined,
    preferredEl?: HTMLElement | null,
    md?: FrameworkElementMetadata,
  ): Promise<SystemToolActionResult> {
    try {
      const { file_url, element_id, file_name } = args;

      // ----------------------------
      // Locate file input (robust)
      // ----------------------------
      let fileInput: HTMLInputElement | null = null;

      // Prefer the resolved element or nearest input first
      if (preferredEl) {
        fileInput = findNearestFileInput(preferredEl, doc);
      }

      // If element_id was provided, only try it if we still don't have an input
      if (!fileInput && element_id !== undefined) {
        fileInput = doc.querySelector<HTMLInputElement>(
          `input[type="file"][${INTERACTIVE_LABEL_ATTR}*="[id=${element_id}]"]`,
        );
      }

      // Otherwise pick first visible enabled file input
      if (!fileInput) {
        const inputs = doc.querySelectorAll<HTMLInputElement>('input[type="file"]');
        for (const input of inputs) {
          if (input.disabled) continue;
          const rect = input.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;
          if (!isVisible) continue;
          fileInput = input;
          break;
        }
      }

      if (!fileInput)
        return { success: false, method: 'upload-file', details: 'No file input found', allowFallback: true };
      if (fileInput.disabled)
        return { success: false, method: 'upload-file', details: 'File input is disabled', allowFallback: true };

      const docEl = docOf(fileInput, doc);
      const winEl = winOfDoc(docEl, win);

      // ----------------------------
      // Token-only payload required
      // ----------------------------
      const okPayload =
        payload?.kind === 'upload_file' &&
        typeof payload.byteLength === 'number' &&
        payload.byteLength >= 0 &&
        typeof payload.mimeType === 'string' &&
        (typeof payload.inlineB64 === 'string' || typeof payload.token === 'string');

      if (!okPayload) {
        return {
          success: false,
          method: 'upload-file',
          details: 'Missing upload payload (need inlineB64 or token)',
          allowFallback: true,
        };
      }

      const byteLength = Number(payload!.byteLength);
      const contentType =
        (payload!.mimeType || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';

      let bytesBuf: ArrayBuffer;

      // ✅ inline path (no token, no isolated bridge, no SW keepalive)
      if (payload!.inlineB64 && typeof payload!.inlineB64 === 'string') {
        const u8 = base64ToUint8Array(payload!.inlineB64);
        if (u8.byteLength !== byteLength) {
          return {
            success: false,
            method: 'upload-file',
            details: `Inline bytes length mismatch: got=${u8.byteLength} expected=${byteLength}`,
            allowFallback: true,
          };
        }
        bytesBuf = u8.buffer as ArrayBuffer;
      } else {
        // ✅ token path (uses isolated bridge)
        const token = String(payload!.token);
        bytesBuf = await requestBytesFromIsolatedInWindow(winEl, token, byteLength, 90_000);
      }

      const BlobCtor = ((winEl as any).Blob || Blob) as typeof Blob;
      const blob = new BlobCtor([bytesBuf], { type: contentType });

      // ----------------------------
      // File name (safe)
      // ----------------------------
      let fileName: string | undefined = file_name || payload?.fileName;
      if (!fileName && file_url && typeof file_url === 'string') fileName = extractFirebaseFileName(file_url, winEl);
      fileName = safeBasename(fileName || 'upload');

      const WinFile = (winEl as any).File || File;
      const file = new WinFile([blob], fileName, {
        type: contentType,
        lastModified: Date.now(),
      });

      const Evt = (winEl as any).Event || Event;
      const WinDataTransfer = (winEl as any).DataTransfer || DataTransfer;

      if (!WinDataTransfer) {
        return {
          success: false,
          method: 'upload-file',
          details: 'DataTransfer unavailable in this context',
          allowFallback: true,
        };
      }

      const dt = new WinDataTransfer();
      dt.items.add(file);

      // ✅ set files using robust setter
      const setOk = setInputFilesSafely(fileInput, dt.files, winEl);
      if (!setOk) {
        return { success: false, method: 'upload-file', details: 'Failed to set input.files', allowFallback: true };
      }

      // Dispatch events (composed helps shadow-dom)
      fileInput.dispatchEvent(new Evt('input', { bubbles: true, composed: true, cancelable: true }));
      fileInput.dispatchEvent(new Evt('change', { bubbles: true, composed: true, cancelable: true }));

      // React (keep your existing path)
      const fiber = detectReactFiber(fileInput);
      if (fiber) {
        const handlers = extractReactHandlers(fiber);
        if (handlers.onChange) {
          const evt = synthReactEvent('change', fileInput, docEl, winEl);
          (evt as any).target.files = dt.files;
          handlers.onChange(evt);
        }
      }

      // Vue (keep your existing path)
      const vueInst = detectVueInstance(fileInput);
      if (vueInst) {
        const handlers = extractVueHandlers(vueInst);
        if (handlers.change) {
          const evt = new Evt('change', { bubbles: true });
          (evt as any).target = fileInput;
          (evt.target as any).files = dt.files;
          handlers.change(evt);
        }
      }

      // jQuery delegated handlers (harmless if absent)
      try {
        const jq = (winEl as any).jQuery || (winEl as any).$;
        if (jq && typeof jq === 'function') jq(fileInput).triggerHandler?.('change');
      } catch {}

      fileInput.focus?.({ preventScroll: true } as any);

      // Give frameworks time to react (2 frames)
      await yieldFrameLike(docEl, winEl, 2);

      return {
        success: true,
        method: 'upload-file',
        details: `Uploaded ${fileName} (${formatKB(blob.size)}) [token]`,
      };
    } catch (e: any) {
      return { success: false, method: 'upload-file', details: e?.message || 'Upload failed', allowFallback: true };
    }
  }

  // ---------------- Double / Right Click ----------------

  function smartDoubleClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
    scrollIntoView(el, docEl, winEl);
    pointerMouseClick(el, docEl, winEl);
    pointerMouseClick(el, docEl, winEl);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvt('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        detail: 2,
        view: winEl,
      }),
    );
    return { success: true, method: 'dblclick' };
  }

  function smartRightClick(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const PointerEvt = (winEl as any).PointerEvent || PointerEvent;
    const MouseEvt = (winEl as any).MouseEvent || MouseEvent;
    scrollIntoView(el, docEl, winEl);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2,
      y = r.top + r.height / 2;

    const common: MouseEventInit & PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: winEl,
      clientX: x,
      clientY: y,
      button: 2,
      buttons: 2,
    };
    el.dispatchEvent(new PointerEvt('pointerdown', common));
    el.dispatchEvent(new MouseEvt('mousedown', common));
    el.dispatchEvent(new PointerEvt('pointerup', { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvt('mouseup', { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvt('contextmenu', common));
    return { success: true, method: 'contextmenu' };
  }

  // ---------------- helpers ----------------
  type ClickSnapshot = {
    href: string;
    hash: string;
    ariaExpanded: string | null;
    ariaPressed: string | null;
    ariaDisabled: string | null;
    disabled: boolean;
    open: any;
    checked: any;
    value: any;
    active: Element | null; // deep active
    rect: { w: number; h: number }; // layout expand/collapse
  };

  function snapClickState(el: HTMLElement, doc: Document, win: Window): ClickSnapshot {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const anyEl: any = el;
    const r = el.getBoundingClientRect();

    return {
      href: String(winEl.location.href),
      hash: String(winEl.location.hash),
      ariaExpanded: el.getAttribute('aria-expanded'),
      ariaPressed: el.getAttribute('aria-pressed'),
      ariaDisabled: el.getAttribute('aria-disabled'),
      disabled: !!anyEl.disabled,
      open: typeof anyEl.open !== 'undefined' ? anyEl.open : undefined,
      checked: typeof anyEl.checked !== 'undefined' ? anyEl.checked : undefined,
      value: typeof anyEl.value !== 'undefined' ? anyEl.value : undefined,
      active: getActiveElementDeep(docEl), // <-- use your helper
      rect: { w: r.width, h: r.height },
    };
  }

  function changed(a: ClickSnapshot, b: ClickSnapshot) {
    const rectChanged = Math.abs(a.rect.w - b.rect.w) > 2 || Math.abs(a.rect.h - b.rect.h) > 2;
    return (
      a.href !== b.href ||
      a.hash !== b.hash ||
      a.ariaExpanded !== b.ariaExpanded ||
      a.ariaPressed !== b.ariaPressed ||
      a.ariaDisabled !== b.ariaDisabled ||
      a.disabled !== b.disabled ||
      a.open !== b.open ||
      a.checked !== b.checked ||
      a.value !== b.value ||
      a.active !== b.active || // <-- focus change counts
      rectChanged // <-- “expand editor” counts
    );
  }

  async function verifyClick(el: HTMLElement, doc: Document, win: Window, before: ClickSnapshot): Promise<boolean> {
    await Promise.resolve(); // microtask: works in bg tabs
    // Optional: only if active tab, yield one macrotask (still cheap)
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    if (!doc.hidden) await yieldOnce();
    const after = snapClickState(el, docEl, winEl);
    return changed(before, after);
  }

  function keyboardActivate(el: HTMLElement, doc: Document, win: Window): SystemToolActionResult {
    el.focus?.({ preventScroll: true } as any);
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);

    const role = el.getAttribute('role');
    const isButtonLike = role === 'button' || isHTMLButtonElementX(el, winEl) || el.tagName.toLowerCase() === 'button';

    const keys = isButtonLike ? [' ', 'Enter'] : ['Enter'];
    const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;

    for (const key of keys) {
      const init: KeyboardEventInit = {
        key,
        code: key === ' ' ? 'Space' : 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true, // ✅ important for shadow DOM
      };
      el.dispatchEvent(new KeyboardEvt('keydown', init));
      el.dispatchEvent(new KeyboardEvt('keypress', init));
      el.dispatchEvent(new KeyboardEvt('keyup', init));
    }

    return { success: true, method: 'keyboard-activate' };
  }

  async function tryStrategiesVerified(
    el: HTMLElement,
    doc: Document,
    win: Window,
    ...fns: Array<() => SystemToolActionResult | null | undefined>
  ): Promise<SystemToolActionResult> {
    let lastSuccess: SystemToolActionResult | null = null;
    for (const fn of fns) {
      const docEl = docOf(el, doc);
      const winEl = winOfDoc(docEl, win);
      const before = snapClickState(el, docEl, winEl);
      const r = fn();
      if (!r || !r.success) continue;

      // IMPORTANT: defaultPrevented is NOT success by itself.

      const ok = await verifyClick(el, docEl, winEl, before);
      if (ok) return { ...r, details: (r.details ? r.details + ';' : '') + 'verified=true' };

      // Unverified => keep trying, but remember the attempt.
      lastSuccess = r;
    }
    // If nothing verified but we did run something successfully, do NOT fail-fast.
    if (lastSuccess) {
      return {
        ...lastSuccess,
        details: (lastSuccess.details ? lastSuccess.details + ';' : '') + 'verified=false',
      };
    }
    return { success: false, method: 'all-strategies-unverified', details: 'no verified effect', allowFallback: true };
  }

  function tryStrategies(...fns: Array<() => SystemToolActionResult | null | undefined>): SystemToolActionResult {
    for (const fn of fns) {
      try {
        const r = fn();
        if (r && r.success) return r;
      } catch {}
    }
    return { success: false, method: 'all-strategies-failed', allowFallback: true };
  }

  function scrollIntoView(el: HTMLElement, doc: Document, win: Window) {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const r = el.getBoundingClientRect();
    const visible = r.top >= 0 && r.left >= 0 && r.bottom <= winEl.innerHeight && r.right <= winEl.innerWidth;
    if (!visible) {
      el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      void el.offsetHeight;
    }
  }

  function dispatchKeySequence(el: HTMLElement, doc: Document, win: Window, text: string) {
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;
    for (const ch of text) {
      const s = String(ch ?? '');
      let code = '';
      if (/^[a-z]$/i.test(s)) code = `Key${s.toUpperCase()}`;
      else if (/^[0-9]$/.test(s)) code = `Digit${s}`;
      else if (s === ' ') code = 'Space';
      const which = s.length === 1 ? s.charCodeAt(0) : 0;
      const init: KeyboardEventInit = {
        key: s,
        code,
        bubbles: true,
        cancelable: true,
        composed: true,
        keyCode: which as any,
        which: which as any,
      };
      el.dispatchEvent(new KeyboardEvt('keydown', init));
      el.dispatchEvent(new KeyboardEvt('keypress', init));
      el.dispatchEvent(new KeyboardEvt('keyup', init));
    }
  }

  function pressEnter(el: HTMLElement, doc: Document, win: Window) {
    // Keep helper aligned with new commitEnter semantics: dispatch first; submit only if not canceled.
    const docEl = docOf(el, doc);
    const winEl = winOfDoc(docEl, win);
    const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;
    const opt: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const okDown = el.dispatchEvent(new KeyboardEvt('keydown', opt));
    const okPress = el.dispatchEvent(new KeyboardEvt('keypress', opt));
    const okUp = el.dispatchEvent(new KeyboardEvt('keyup', opt));
    const canceled = !(okDown && okPress && okUp);
    if (!canceled) {
      const form = (el as any).form || (el.closest?.('form') as HTMLFormElement | null);
      form?.requestSubmit?.() ?? form?.submit?.();
    }
  }

  function keyToCode(key: string) {
    const m: Record<string, string> = {
      Enter: 'Enter',
      Tab: 'Tab',
      Escape: 'Escape',
      Space: 'Space',
      ' ': 'Space',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      F1: 'F1',
      F2: 'F2',
      F3: 'F3',
      F4: 'F4',
      F5: 'F5',
      F6: 'F6',
      F7: 'F7',
      F8: 'F8',
      F9: 'F9',
      F10: 'F10',
      F11: 'F11',
      F12: 'F12',
    };
    return m[key] || `Key${key.toUpperCase()}`;
  }

  const waitChan = new MessageChannel();
  const waitResolvers: Array<() => void> = [];
  waitChan.port1.onmessage = () => {
    const r = waitResolvers.shift();
    if (r) r();
  };

  function yieldOnce(): Promise<void> {
    return new Promise<void>(resolve => {
      waitResolvers.push(resolve);
      waitChan.port2.postMessage(0);
    });
  }

  // ---------------- React internals ----------------

  function detectReactFiber(el: HTMLElement): any {
    const tryNode = (node: any): any => {
      if (!node) return null;
      const keys = Object.keys(node);
      for (const k of keys) {
        if (
          k.startsWith('__reactFiber') ||
          k.startsWith('__reactInternalInstance') ||
          k.includes('reactFiber') ||
          k.includes('reactProps') ||
          k.includes('reactEventHandlers') ||
          /^__r\d+/.test(k)
        )
          return node[k];
      }
      return null;
    };

    let cur: HTMLElement | null = el;
    for (let i = 0; i < 4 && cur; i++) {
      const f = tryNode(cur);
      if (f) return f;
      cur = cur.parentElement;
    }
    return null;
  }

  function extractReactHandlers(fiber: any): Record<string, Function> {
    const out: Record<string, Function> = {};
    let f = fiber,
      depth = 0;
    while (f && depth++ < 10) {
      const propSources = [
        f.memoizedProps,
        f.pendingProps,
        f.stateNode?.props,
        f._memoizedProps,
        f._pendingProps,
        f.alternate?.memoizedProps,
      ].filter(Boolean);

      for (const props of propSources) {
        if (!props || typeof props !== 'object') continue;
        for (const k in props) {
          if (k.startsWith('on') && typeof props[k] === 'function') out[k] = props[k];
        }
      }
      if (Object.keys(out).length) break;
      f = f.return || f.alternate;
    }
    return out;
  }

  function locateReactRootContainer(el: HTMLElement, doc: Document): HTMLElement | null {
    let cur: HTMLElement | null = el;
    while (cur) {
      if (
        (cur as any)._reactRootContainer ||
        (cur as any).__reactContainer ||
        cur.hasAttribute('data-reactroot') ||
        cur.hasAttribute('data-react-root') ||
        ['root', 'app', '__next'].includes(cur.id)
      )
        return cur;
      cur = cur.parentElement;
    }
    const docEl = docOf(el, doc);
    return docEl.querySelector<HTMLElement>('#root,#app,#__next,[data-reactroot],[data-react-root]');
  }

  function synthReactEvent(type: string, target: HTMLElement, doc: Document, win: Window) {
    const docEl = docOf(target, doc);
    const view = winOfDoc(docEl, win);
    const MouseEvt = (view as any).MouseEvent || MouseEvent;

    const r = target.getBoundingClientRect();
    const native = new MouseEvt(type, {
      bubbles: true,
      cancelable: true,
      view,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    });
    return {
      type,
      target,
      currentTarget: target,
      bubbles: true,
      cancelable: true,
      nativeEvent: native,
      isTrusted: true,
      preventDefault() {
        native.preventDefault();
      },
      stopPropagation() {
        native.stopPropagation();
      },
    };
  }

  // ---------------- Vue internals ----------------

  function detectVueInstance(el: HTMLElement): any {
    const anyEl = el as any;
    if (anyEl.__vue__) return anyEl.__vue__;
    if (anyEl.__vueParentComponent) return anyEl.__vueParentComponent;
    if (anyEl._vnode) return anyEl._vnode;

    let cur: HTMLElement | null = el.parentElement;
    for (let i = 0; i < 3 && cur; i++) {
      const a = cur as any;
      if (a.__vue__ || a.__vueParentComponent || a._vnode) return a.__vue__ || a.__vueParentComponent || a._vnode;
      cur = cur.parentElement;
    }
    return null;
  }

  function extractVueHandlers(inst: any): Record<string, Function> {
    const out: Record<string, Function> = {};
    if (inst?.$listeners) Object.assign(out, inst.$listeners);
    if (inst?._events)
      for (const k in inst._events) {
        const v = inst._events[k];
        out[k] = Array.isArray(v) ? v[0] : v;
      }
    if (inst?.props)
      for (const k in inst.props) {
        if (k.startsWith('on') && typeof inst.props[k] === 'function')
          out[k.substring(2).toLowerCase()] = inst.props[k];
      }
    if (inst?.vnode?.props)
      for (const k in inst.vnode.props) {
        if (k.startsWith('on') && typeof inst.vnode.props[k] === 'function')
          out[k.substring(2).toLowerCase()] = inst.vnode.props[k];
      }
    return out;
  }
})();
