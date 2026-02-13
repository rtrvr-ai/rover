import {
  docOf,
  isHTMLElementLike,
  isHTMLInputElementX,
  isHTMLLabelElementX,
  isHTMLTextAreaElementX,
  isShadowRootLike,
  winOf,
  winOfDoc,
} from './dom-utilities.js';

export type EditableResolved =
  | { kind: 'input'; el: HTMLInputElement | HTMLTextAreaElement; via: string }
  | { kind: 'contenteditable'; el: HTMLElement; via: string }
  | { kind: 'none'; el: null; via: string };

export function getActiveElementDeep(doc: Document): Element | null {
  let a: any = doc.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a as Element | null;
}

export function isFocusedDeep(el: HTMLElement, doc: Document): boolean {
  const docEl = docOf(el, doc);
  return getActiveElementDeep(docEl) === el;
}

function bestPoint(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function focusDeep(el: HTMLElement, doc: Document, win: Window): boolean {
  const docEl = docOf(el, doc);
  const view = winOfDoc(docEl, win);

  try {
    el.focus?.({ preventScroll: true } as any);
  } catch {}
  if (getActiveElementDeep(docEl) === el) return true;

  try {
    const { x, y } = bestPoint(el);
    const PointerEvt = (view as any).PointerEvent || PointerEvent;
    const MouseEvt = (view as any).MouseEvent || MouseEvent;
    el.dispatchEvent(
      new PointerEvt('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        buttons: 1,
        button: 0,
        pointerType: 'mouse',
      }),
    );
    el.dispatchEvent(
      new MouseEvt('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        buttons: 1,
        button: 0,
      }),
    );
    el.dispatchEvent(
      new MouseEvt('mouseup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        buttons: 0,
        button: 0,
      }),
    );
    el.dispatchEvent(
      new PointerEvt('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        buttons: 0,
        button: 0,
        pointerType: 'mouse',
      }),
    );

    // ✅ add click for editable targets only
    const isEditable =
      (el as any).isContentEditable ||
      isHTMLInputElementX(el, view) ||
      isHTMLTextAreaElementX(el, view) ||
      el.getAttribute('contenteditable') === 'true';

    if (isEditable) {
      el.dispatchEvent(
        new MouseEvt('click', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 }),
      );
    }
  } catch {}

  try {
    el.focus?.({ preventScroll: true } as any);
  } catch {}
  return getActiveElementDeep(docEl) === el;
}

export function setValueNative(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // Realm-correct prototypes (important inside iframes / different Window realms)
  const w = winOf(input);
  const proto = isHTMLTextAreaElementX(input, w)
    ? (w as any).HTMLTextAreaElement.prototype
    : (w as any).HTMLInputElement.prototype;

  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) desc.set.call(input, value);
  else input.value = value;
}

export function dispatchTextEvents(target: HTMLElement, text: string, inputType: string = 'insertText') {
  const winEl = winOf(target);
  const InputEvt = (winEl as any).InputEvent || (typeof InputEvent !== 'undefined' ? InputEvent : null);
  const Evt = (winEl as any).Event || Event;

  // beforeinput (cancelable)
  try {
    if (InputEvt) {
      target.dispatchEvent(
        new InputEvt('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: String(text ?? ''),
          inputType: inputType as any,
        }),
      );
    } else {
      target.dispatchEvent(new Evt('beforeinput', { bubbles: true, cancelable: true, composed: true }));
    }
  } catch {
    try {
      target.dispatchEvent(new Evt('beforeinput', { bubbles: true, cancelable: true, composed: true }));
    } catch {}
  }

  // input (NOT cancelable in native flows; keep inputType consistent)
  try {
    if (InputEvt) {
      target.dispatchEvent(
        new InputEvt('input', {
          bubbles: true,
          cancelable: false,
          composed: true,
          data: String(text ?? ''),
          inputType: inputType as any,
        }),
      );
    } else {
      target.dispatchEvent(new Evt('input', { bubbles: true, cancelable: false, composed: true }));
    }
  } catch {
    try {
      target.dispatchEvent(new Evt('input', { bubbles: true, cancelable: false, composed: true }));
    } catch {}
  }

  // change (cancelable ok)
  try {
    target.dispatchEvent(new Evt('change', { bubbles: true, cancelable: true, composed: true }));
  } catch {}
}

export function dispatchEnter(target: HTMLElement) {
  const winEl = winOf(target);
  const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;

  const enter: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  target.dispatchEvent(new KeyboardEvt('keydown', enter));
  target.dispatchEvent(new KeyboardEvt('keypress', enter));
  target.dispatchEvent(new KeyboardEvt('keyup', enter));
}

function dispatchEnterSequence(target: HTMLElement): { canceled: boolean } {
  const winEl = winOf(target);
  const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;
  const enter: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const okDown = target.dispatchEvent(new KeyboardEvt('keydown', enter));
  const okPress = target.dispatchEvent(new KeyboardEvt('keypress', enter));
  const okUp = target.dispatchEvent(new KeyboardEvt('keyup', enter));
  return { canceled: !(okDown && okPress && okUp) };
}

function isEditableInput(el: any): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const winEl = winOf(el);
  if (isHTMLTextAreaElementX(el, winEl)) return !el.disabled && !el.readOnly;
  if (isHTMLInputElementX(el, winEl)) {
    const t = (el.type || 'text').toLowerCase();
    const okType =
      t === 'text' ||
      t === 'search' ||
      t === 'email' ||
      t === 'url' ||
      t === 'tel' ||
      t === 'password' ||
      t === 'number';
    return okType && !el.disabled && !el.readOnly;
  }
  return false;
}

function isContentEditableLike(el: any): el is HTMLElement {
  const winEl = winOf(el);
  if (!el || !isHTMLElementLike(el, winEl)) return false;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute('contenteditable');
  if (ce && ce !== 'false') return true;
  const role = el.getAttribute('role');
  if (role === 'textbox' && !('value' in el)) return true;
  return false;
}

function getRootScope(el: HTMLElement, doc: Document): ParentNode {
  const root = el.getRootNode() as Document | ShadowRoot;
  return isShadowRootLike(root) ? root : (docOf(el) ?? doc);
}

function getByIds(scope: ParentNode, ids: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const id of ids.split(/\s+/).filter(Boolean)) {
    const n = (scope as any).getElementById?.(id) || (scope as any).querySelector?.(`#${CSS.escape(id)}`);
    const winEl = winOf(n);
    if (isHTMLElementLike(n, winEl)) out.push(n);
  }
  return out;
}

/**
 * No brittle classnames: only semantic relationships (label/aria/descendants/open shadow/roles).
 */
export function resolveEditableTarget(rootEl: HTMLElement, doc: Document): EditableResolved {
  if (!rootEl) return { kind: 'none', el: null, via: 'no-root' };

  if (isEditableInput(rootEl)) return { kind: 'input', el: rootEl, via: 'self-input' };
  if (isContentEditableLike(rootEl)) return { kind: 'contenteditable', el: rootEl, via: 'self-contenteditable' };

  const docEl = docOf(rootEl) ?? doc;
  const winEl = winOfDoc(docEl);
  const scope = getRootScope(rootEl, docEl);

  // label -> control
  if (isHTMLLabelElementX(rootEl, winEl)) {
    const c = (rootEl as any).control as any;
    if (isEditableInput(c)) return { kind: 'input', el: c, via: 'label.control' };
    const htmlFor = (rootEl as any).htmlFor;
    if (htmlFor) {
      const n = (scope as any).getElementById?.(htmlFor) || (scope as any).querySelector?.(`#${CSS.escape(htmlFor)}`);
      if (isEditableInput(n)) return { kind: 'input', el: n, via: 'label.for' };
    }
  }

  // aria-controls / aria-owns
  const ariaControls = (rootEl as any).getAttribute('aria-controls') || (rootEl as any).getAttribute('aria-owns');
  if (ariaControls) {
    for (const n of getByIds(scope, ariaControls)) {
      if (isEditableInput(n)) return { kind: 'input', el: n, via: 'aria-controls/owns' };
      if (isContentEditableLike(n)) return { kind: 'contenteditable', el: n, via: 'aria-controls/owns' };

      const inner = (n as any).querySelector?.('input,textarea') as any;
      if (isEditableInput(inner)) return { kind: 'input', el: inner, via: 'aria-controls->desc' };
    }
  }

  // descendant
  const desc = (rootEl as any).querySelector?.('input,textarea') as any;
  if (isEditableInput(desc)) return { kind: 'input', el: desc, via: 'descendant' };

  // open shadow only
  const sr: ShadowRoot | null = (rootEl as any).shadowRoot || null;
  if (sr) {
    const sInp = sr.querySelector?.('input,textarea') as any;
    if (isEditableInput(sInp)) return { kind: 'input', el: sInp, via: 'open-shadow-input' };

    const sCE = sr.querySelector?.('[contenteditable="true"],[contenteditable=""],[role="textbox"]') as any;
    if (isContentEditableLike(sCE)) return { kind: 'contenteditable', el: sCE, via: 'open-shadow-contenteditable' };
  }

  // role=textbox fallback
  if ((rootEl as any).getAttribute('role') === 'textbox' && !('value' in (rootEl as any))) {
    return { kind: 'contenteditable', el: rootEl, via: 'role=textbox' };
  }

  return { kind: 'none', el: null, via: 'not-found' };
}

export function selectContentsWithin(el: HTMLElement, doc: Document, win: Window, collapseToEnd = false): boolean {
  const docEl = docOf(el, doc);
  const view = winOfDoc(docEl, win);
  const sel = view.getSelection?.();
  if (!sel) return false;

  try {
    const range = docEl.createRange();
    range.selectNodeContents(el);
    if (collapseToEnd) range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

export function getEditableTextSnapshot(el: HTMLElement): string {
  // innerText can be expensive; use textContent first, fall back to innerText
  const t = (el.textContent ?? '').replace(/\u00A0/g, ' ');
  return t.trim();
}

// ---- shared typing primitives (sync) ----

export type ApplyTextResult = {
  success: boolean;
  method: string;
  details: string;
  allowFallback?: boolean;
};

const norm = (s: string) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export type ApplyTextOptions = {
  /**
   * How many "frames" to wait before verifying controlled inputs didn't revert.
   * Default: hidden ? 1 : 2
   */
  settleFrames?: number;
  /**
   * If true, dispatch per-character key events after setting value + input events.
   * Useful for delegated/framework handlers (React/Vue/etc) or shadow-hosted inputs.
   */
  useKeyFallback?: boolean;
  /**
   * Cap per-character key dispatch for performance/safety.
   */
  keyFallbackMaxLen?: number;
};

// ---- bg-safe "frame" settling in module scope (not IIFE) ----
const __applyWaitChan = new MessageChannel();
const __applyWaitResolvers: Array<() => void> = [];
__applyWaitChan.port1.onmessage = () => {
  const r = __applyWaitResolvers.shift();
  if (r) r();
};
function yieldOnceApply(): Promise<void> {
  return new Promise<void>(resolve => {
    __applyWaitResolvers.push(resolve);
    __applyWaitChan.port2.postMessage(0);
  });
}
async function settleApply(docEl: Document, winEl: Window, frames: number) {
  await Promise.resolve(); // always let microtasks flush
  const n = Math.max(0, Math.min(4, Number(frames) || 0));
  for (let i = 0; i < n; i++) {
    if (docEl.hidden) {
      await yieldOnceApply(); // rAF is often throttled to near-zero in bg tabs
    } else {
      await new Promise<void>(resolve => {
        try {
          winEl.requestAnimationFrame(() => resolve());
        } catch {
          yieldOnceApply().then(resolve);
        }
      });
    }
  }
}

function keyCodeForChar(ch: string): { code: string; which: number } {
  const s = String(ch ?? '');
  if (s === ' ') return { code: 'Space', which: 32 };
  if (/^[a-z]$/i.test(s)) return { code: `Key${s.toUpperCase()}`, which: s.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(s)) return { code: `Digit${s}`, which: s.charCodeAt(0) };
  // fallback: no reliable code, still emit key
  return { code: '', which: s.length === 1 ? s.charCodeAt(0) : 0 };
}

function dispatchKeySequenceApply(target: HTMLElement, doc: Document, win: Window, text: string) {
  const docEl = docOf(target, doc);
  const winEl = winOfDoc(docEl, win);
  const KeyboardEvt = (winEl as any).KeyboardEvent || KeyboardEvent;
  const s = String(text ?? '');
  for (const ch of s) {
    const { code, which } = keyCodeForChar(ch);
    const init: KeyboardEventInit = {
      key: ch,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      keyCode: which as any,
      which: which as any,
    };
    target.dispatchEvent(new KeyboardEvt('keydown', init));
    target.dispatchEvent(new KeyboardEvt('keypress', init));
    target.dispatchEvent(new KeyboardEvt('keyup', init));
  }
}

/** Input/Textarea: focusDeep + native setter + composed beforeinput/input/change + robust verify */
export async function applyTextToInputLike(
  input: HTMLInputElement | HTMLTextAreaElement,
  doc: Document,
  win: Window,
  textRaw: any,
  opts?: ApplyTextOptions,
): Promise<ApplyTextResult> {
  const text = String(textRaw ?? '');

  if ((input as any).disabled || (input as any).readOnly) {
    return { success: false, method: 'type-native-setter', details: 'disabled_or_readonly', allowFallback: true };
  }

  const beforeVal = String((input as any).value ?? '');
  const docEl = docOf(input, doc);
  const winEl = winOfDoc(docEl, win);
  const okFocus = focusDeep(input, docEl, winEl);

  const settleFrames = Number.isFinite(Number(opts?.settleFrames))
    ? Math.max(0, Math.min(4, Number(opts?.settleFrames)))
    : docEl.hidden
      ? 1
      : 2;

  const useKeyFallback = !!opts?.useKeyFallback;
  const maxKeys = Number.isFinite(Number(opts?.keyFallbackMaxLen)) ? Number(opts?.keyFallbackMaxLen) : 140;
  const canKeys = useKeyFallback && text.length > 0 && text.length <= maxKeys;

  // --- attempt #1: native setter + beforeinput/input/change ---
  setValueNative(input, text);
  dispatchTextEvents(input as any, text, 'insertReplacementText');
  if (canKeys) dispatchKeySequenceApply(input as any, docEl, winEl, text);

  await settleApply(docEl, winEl, settleFrames);
  let afterVal = String((input as any).value ?? '');

  // Accept masking/sanitization + whitespace normalization
  const beforeNorm = norm(beforeVal);
  const afterNorm = norm(afterVal);
  const textNorm = norm(text);

  const alreadyCorrect = beforeNorm === textNorm;
  const nowCorrect = afterNorm === textNorm;
  const changed = afterVal !== beforeVal;

  let reverted = text.length > 0 && !alreadyCorrect && afterVal === beforeVal;
  let attempt = 1;

  // If controlled frameworks reverted value, try stronger sequences.
  if (!alreadyCorrect && !nowCorrect && !changed) {
    attempt = 2;
    try {
      // Focus + select tends to help execCommand paths and some handlers.
      (input as any).focus?.({ preventScroll: true } as any);
      (input as any).select?.();
    } catch {}

    // --- attempt #2: execCommand insertText (best-effort) ---
    let execOk = false;
    try {
      // selectAll + insertText often routes through editor/native-ish paths.
      docEl.execCommand?.('selectAll', false, undefined);
      execOk = !!docEl.execCommand?.('insertText', false, text);
    } catch {
      execOk = false;
    }

    if (!execOk) {
      // --- attempt #2 fallback: re-apply setter + events ---
      try {
        setValueNative(input, text);
      } catch {}
    }
    try {
      dispatchTextEvents(input as any, text, 'insertReplacementText');
    } catch {}
    if (canKeys) dispatchKeySequenceApply(input as any, docEl, winEl, text);

    await settleApply(docEl, winEl, settleFrames);
    afterVal = String((input as any).value ?? '');
  }

  const afterNorm2 = norm(afterVal);
  const nowCorrect2 = afterNorm2 === textNorm;
  const changed2 = afterVal !== beforeVal;
  reverted = text.length > 0 && !alreadyCorrect && afterVal === beforeVal;

  // Success conditions:
  // - already correct, OR
  // - now matches normalized, OR
  // - value changed (even if sanitized/masked/truncated)
  const success = alreadyCorrect || nowCorrect2 || changed2;

  return {
    success,
    method: 'type-native-setter',
    details: `focus=${okFocus};attempts=${attempt};settleFrames=${settleFrames};beforeLen=${beforeVal.length};afterLen=${afterVal.length};changed=${changed2};alreadyCorrect=${alreadyCorrect};nowCorrect=${nowCorrect2};reverted=${reverted};keyFallback=${canKeys}`,
    allowFallback: success ? undefined : true,
  };
}

/** Contenteditable-ish: selection scoped to element + execCommand insertText + range fallback + verify */
function dispatchBeforeInput(target: HTMLElement, text: string, inputType: string) {
  const winEl = winOf(target);
  const InputEvt = (winEl as any).InputEvent || InputEvent;
  const e = new InputEvt('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: text,
    inputType: inputType as any,
  });
  const ok = target.dispatchEvent(e);
  return { ok, defaultPrevented: e.defaultPrevented };
}

export function applyTextToContentEditableLike(
  el: HTMLElement,
  textRaw: any,
  doc: Document,
  win: Window,
): ApplyTextResult {
  const docEl = docOf(el, doc);
  const view = winOfDoc(docEl, win);
  const InputEvt = (view as any).InputEvent || InputEvent;
  const Evt = (view as any).Event || Event;
  const text = String(textRaw ?? '');
  const before = getEditableTextSnapshot(el);
  const okFocus = focusDeep(el, docEl, view);

  // Put caret inside editor (append by default)
  const selected = selectContentsWithin(el, docEl, view, /*collapseToEnd*/ true);

  const bi = dispatchBeforeInput(el, text, 'insertText');
  let inserted = false;
  let via = 'execCommand';
  let sawInput = false;
  const onInput = () => {
    sawInput = true;
  };
  try {
    el.addEventListener('input', onInput as any, { capture: true });
  } catch {}

  if (bi.ok && !bi.defaultPrevented) {
    try {
      // execCommand tends to follow native-ish pathways for editors
      inserted = !!docEl.execCommand?.('insertText', false, text);
    } catch {}
  }

  if (!inserted) {
    // fallback range insert
    try {
      const sel = view.getSelection?.();
      let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range || !el.contains(range.commonAncestorContainer)) {
        selectContentsWithin(el, docEl, view, true);
        const sel2 = view.getSelection?.();
        range = sel2 && sel2.rangeCount ? sel2.getRangeAt(0) : null;
      }
      if (range) {
        range.insertNode(docEl.createTextNode(text));
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
        inserted = true;
        via = 'range';
      }
    } catch {}
  }

  // ✅ Always ensure the app sees an input/change when we inserted text.
  // execCommand is not reliable across browsers/editors for firing input.
  if (inserted && !sawInput) {
    try {
      el.dispatchEvent(
        new InputEvt('input', {
          bubbles: true,
          cancelable: false,
          composed: true,
          data: text,
          inputType: 'insertText',
        }),
      );
    } catch {
      try {
        el.dispatchEvent(new Evt('input', { bubbles: true, cancelable: false, composed: true }));
      } catch {}
    }
    try {
      el.dispatchEvent(new Evt('change', { bubbles: true, cancelable: true, composed: true }));
    } catch {}
  }
  try {
    el.removeEventListener('input', onInput as any, { capture: true } as any);
  } catch {}

  const after = getEditableTextSnapshot(el);
  const success = after !== before || (!!text && after.includes(text));

  return {
    success,
    method: `type-contenteditable-${via}`,
    details: `focus=${okFocus};selectedWithin=${selected};inserted=${inserted}`,
  };
}

/** Shared enter-commit: submit nearest form if possible, else dispatch Enter sequence */
export function commitEnter(target: HTMLElement) {
  // ✅ Dispatch Enter key events FIRST (many apps bind to keydown/keyup and don't want native submit).
  const { canceled } = dispatchEnterSequence(target);
  if (canceled) return { submitted: false, method: 'enter-handled' };

  // If not handled, submit nearest form if present.
  const form = (target as any).form || (target.closest?.('form') as HTMLFormElement | null);
  if (form) {
    (form as any).requestSubmit?.() ?? form.submit?.();
    return { submitted: true, method: 'enter->form-submit' };
  }
  return { submitted: false, method: 'enter-dispatched' };
}

export function applyClearToInputLike(
  input: HTMLInputElement | HTMLTextAreaElement,
  doc: Document,
  win: Window,
): ApplyTextResult {
  if ((input as any).disabled || (input as any).readOnly) {
    return { success: false, method: 'clear-native-setter', details: 'disabled_or_readonly', allowFallback: true };
  }
  const docEl = docOf(input, doc);
  const winEl = winOfDoc(docEl, win);
  const beforeVal = String((input as any).value ?? '');
  const okFocus = focusDeep(input, docEl, winEl);

  setValueNative(input, '');
  // for clearing, a delete-ish inputType is more semantically correct
  dispatchTextEvents(input, '', 'deleteByCut');

  const afterVal = String((input as any).value ?? '');
  const changed = afterVal !== beforeVal;
  const success = changed || afterVal.length === 0;

  return {
    success,
    method: 'clear-native-setter',
    details: `focus=${okFocus};beforeLen=${beforeVal.length};afterLen=${afterVal.length};changed=${changed}`,
  };
}

export function applyClearToContentEditableLike(el: HTMLElement, doc: Document, win: Window): ApplyTextResult {
  const docEl = docOf(el, doc);
  const view = winOfDoc(docEl, win);
  const before = getEditableTextSnapshot(el);
  const okFocus = focusDeep(el, docEl, view);

  const selected = selectContentsWithin(el, docEl, view, /*collapseToEnd*/ false);

  let cleared = false;
  let via = 'execCommand';

  try {
    cleared = !!docEl.execCommand?.('delete', false, undefined);
  } catch {
    cleared = false;
  }

  // Range fallback
  if (!cleared) {
    try {
      const sel = view.getSelection?.();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;

      if (!range || !el.contains(range.commonAncestorContainer)) {
        selectContentsWithin(el, docEl, view, false);
      }
      const sel2 = view.getSelection?.();
      const r2 = sel2 && sel2.rangeCount ? sel2.getRangeAt(0) : null;

      if (r2) {
        r2.deleteContents();
        r2.collapse(false);
        sel2?.removeAllRanges();
        sel2?.addRange(r2);
        cleared = true;
        via = 'range';
      }
    } catch {}
  }

  // Last resort
  if (!cleared) {
    try {
      el.textContent = '';
      cleared = true;
      via = 'textContent';
    } catch {}
  }

  dispatchTextEvents(el, '', 'deleteByCut');

  const after = getEditableTextSnapshot(el);
  const changed = after !== before;
  const success = cleared || changed || after.length === 0;

  return {
    success,
    method: `clear-contenteditable-${via}`,
    details: `focus=${okFocus};selectedWithin=${selected};cleared=${cleared};changed=${changed}`,
  };
}

export function containsInComposedTree(container: HTMLElement, node: Element): boolean {
  if (container === node) return true;
  if (container.contains(node)) return true;

  // Walk up via shadow hosts
  let cur: Node | null = node;
  while (cur) {
    const root: any = (cur as any).getRootNode?.();
    if (isShadowRootLike(root)) {
      const host = root.host;
      if (host === container) return true;
      if (container.contains(host)) return true;
      cur = host;
      continue;
    }
    cur = (cur as any).parentNode || null;
  }
  return false;
}
