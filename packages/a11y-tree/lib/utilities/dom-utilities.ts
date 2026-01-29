export interface ElementSignalProvider {
  getEventHandlerIds: (el: Element) => number[];
  getRoleHint?: (el: Element) => string | null;
  getShadowRoot?: (el: Element) => ShadowRoot | null;
}

export type TreeExtractionOptions = {
  semanticIdStart?: number;
  interactiveIdStart?: number;
  includeFrameContents?: boolean; // inline traverse same-origin iframe DOM
  clearIframes?: boolean; // clear labels inside nested same-origin iframes
  frameContextLabel?: string | null; // used to stamp iframeRoot in per-frame builds
  signalProvider?: ElementSignalProvider | null;
  disableDomAnnotations?: boolean;
};

const DEFAULT_TREE_OPTS: Required<TreeExtractionOptions> = {
  semanticIdStart: 1,
  interactiveIdStart: 1,
  includeFrameContents: true,
  clearIframes: true,
  frameContextLabel: null,
  signalProvider: null,
  disableDomAnnotations: false,
};

export let CURRENT_TREE_OPTS: Required<TreeExtractionOptions> = { ...DEFAULT_TREE_OPTS };

const G: any = globalThis as any;

export function setTreeExtractionContext(opts: TreeExtractionOptions): void {
  CURRENT_TREE_OPTS = { ...DEFAULT_TREE_OPTS, ...(opts || {}) };
}

export function getSignalProvider(): ElementSignalProvider | null {
  return CURRENT_TREE_OPTS.signalProvider ?? null;
}

export function globalDocumentSafe(): Document | null {
  try {
    return typeof G.document !== 'undefined' ? (G.document as Document) : null;
  } catch {
    return null;
  }
}

export function globalWindowSafe(): Window | null {
  try {
    return typeof G.window !== 'undefined' ? (G.window as Window) : null;
  } catch {
    return null;
  }
}

/**
 * Realm/bg safe: accepts *unknown* and never assumes DOM globals exist.
 * Returns a "best effort" Document-like object (may be a stub in bg).
 */
export function docOf(el: unknown, defaultValue?: Document | null): Document {
  // Fast path for real Elements
  if (el && typeof el === 'object') {
    const d = (el as any).ownerDocument;
    if (d) return d as Document;
    // Some objects (Document itself) have nodeType === 9
    if ((el as any).nodeType === 9) return el as Document;
  }
  return defaultValue ?? globalDocumentSafe() ?? ({} as any as Document);
}

export function winOf(el: unknown, defaultValue?: Window | null): Window {
  const d = docOf(el, defaultValue ? (defaultValue as any).document : null);
  const w = (d as any)?.defaultView;
  return w ?? defaultValue ?? globalWindowSafe() ?? ({} as any as Window);
}

export function winOfDoc(doc: Document | null | undefined, defaultValue?: Window | null): Window {
  const w = (doc as any)?.defaultView;
  return w ?? defaultValue ?? globalWindowSafe() ?? ({} as any as Window);
}

export function getElementByIdSafe(doc: any, id: string): Element | null {
  try {
    return doc?.getElementById?.(id) ?? null;
  } catch {
    return null;
  }
}

export function querySelectorSafe(scope: any, sel: string): Element | null {
  try {
    return scope?.querySelector?.(sel) ?? null;
  } catch {
    return null;
  }
}

export function querySelectorAllSafe(scope: any, sel: string): Element[] {
  try {
    return Array.from(scope?.querySelectorAll?.(sel) ?? []);
  } catch {
    return [];
  }
}

export function iframeDoc(el: HTMLIFrameElement): Document | null {
  try {
    return el.contentDocument || (el.contentWindow?.document ?? null);
  } catch {
    // Cross-origin iframe access -> SecurityError
    return null;
  }
}

export function cssEscapeSafe(win: Window, s: string): string {
  const esc = (win as any).CSS?.escape;
  if (typeof esc === 'function') return esc(s);
  // basic fallback (not perfect but avoids selector breaks)
  return s.replace(/([^\w-])/g, '\\$1');
}

// ---------------- Realm-safe helpers ----------------
export type AnyWin = Window & typeof globalThis;
function ctor<T = any>(win: Window, name: string): T | undefined {
  try {
    return (win as any)[name] as T;
  } catch {
    return undefined;
  }
}
export function isTag(el: any, tag: string): boolean {
  return !!el && String(el.tagName || '').toUpperCase() === tag.toUpperCase();
}
export function isHTMLAnchorElementX(el: any, win: Window): el is HTMLAnchorElement {
  const C = ctor<any>(win, 'HTMLAnchorElement');
  return C ? el instanceof C : isTag(el, 'A');
}
export function isHTMLInputElementX(el: any, win: Window): el is HTMLInputElement {
  const C = ctor<any>(win, 'HTMLInputElement');
  return C ? el instanceof C : isTag(el, 'INPUT');
}
export function isHTMLTextAreaElementX(el: any, win: Window): el is HTMLTextAreaElement {
  const C = ctor<any>(win, 'HTMLTextAreaElement');
  return C ? el instanceof C : isTag(el, 'TEXTAREA');
}
export function isHTMLLabelElementX(el: any, win: Window): el is HTMLLabelElement {
  const C = ctor<any>(win, 'HTMLLabelElement');
  return C ? el instanceof C : isTag(el, 'LABEL');
}
export function isHTMLSelectElementX(el: any, win: Window): el is HTMLSelectElement {
  const C = ctor<any>(win, 'HTMLSelectElement');
  return C ? el instanceof C : isTag(el, 'SELECT');
}
export function isHTMLLIElementX(el: any, win: Window): el is HTMLLIElement {
  const C = ctor<any>(win, 'HTMLLIElement');
  return C ? el instanceof C : isTag(el, 'LI');
}
export function isHTMLSlotElementX(el: any, win: Window): el is HTMLSlotElement {
  const C = ctor<any>(win, 'HTMLSlotElement');
  return C ? el instanceof C : isTag(el, 'SLOT');
}
export function isHTMLButtonElementX(el: any, win: Window): el is HTMLButtonElement {
  const C = ctor<any>(win, 'HTMLButtonElement');
  return C ? el instanceof C : isTag(el, 'BUTTON');
}
export function isHTMLImageElementX(el: any, win: Window): el is HTMLImageElement {
  const C = ctor<any>(win, 'HTMLImageElement');
  return C ? el instanceof C : isTag(el, 'IMG');
}
export function isHTMLVideoElementX(el: any, win: Window): el is HTMLVideoElement {
  const C = ctor<any>(win, 'HTMLVideoElement');
  return C ? el instanceof C : isTag(el, 'VIDEO');
}
export function isHTMLCanvasElementX(el: any, win: Window): el is HTMLCanvasElement {
  const C = ctor<any>(win, 'HTMLCanvasElement');
  return C ? el instanceof C : isTag(el, 'CANVAS');
}
export function isHTMLElementLike(el: any, win: Window): el is HTMLElement {
  if (!el || el.nodeType !== 1) return false;
  const C = ctor<any>(win, 'HTMLElement');
  return C ? el instanceof C : typeof el.tagName === 'string';
}

// ---------------- Realm-safe helpers (iframe/shadow cross-realm) ----------------

export function isShadowRootLike(n: any): n is ShadowRoot {
  // Cross-realm safe: do NOT rely on instanceof ShadowRoot.
  // ShadowRoot is a DocumentFragment (nodeType 11) with .host and .mode
  return !!n && n.nodeType === 11 && typeof n.host === 'object' && typeof n.mode === 'string';
}

export function isElementLike(el: any): el is HTMLElement {
  if (!el || el.nodeType !== 1) return false;
  const doc = docOf(el);
  const w = winOfDoc(doc);
  const C = (w as any).Element;
  return C ? el instanceof C : typeof el.tagName === 'string';
}

export function isHTMLIFrameElementLike(el: any): el is HTMLIFrameElement {
  if (!el || el.nodeType !== 1) return false;
  const doc = docOf(el);
  const w = winOfDoc(doc);
  const C = (w as any).HTMLIFrameElement;
  if (C && el instanceof C) return true;
  return String(el.tagName || '').toUpperCase() === 'IFRAME';
}

export function isDocumentX(t: any, win: Window): t is Document {
  if (!t) return false;

  // Fast structural check (works cross-realm)
  if ((t as any).nodeType === 9) return true;

  // Cross-realm instanceof via the right realm constructor
  const C = ctor<any>(win, 'Document');
  return C ? t instanceof C : false;
}

export function isWindowX(t: any, win: Window): t is Window {
  if (!t) return false;

  const C = ctor<any>(win, 'Window');
  if (C) return t instanceof C;

  // Fallback: window.window === window (guarded)
  try {
    return (t as any).window === t;
  } catch {
    return false;
  }
}

export function getDocumentFromWindowSafe(w: Window): Document | null {
  try {
    return w.document;
  } catch {
    // Cross-origin WindowProxy -> SecurityError
    return null;
  }
}

export function getDocumentElementFromTargetSafe(target: any, win: Window): HTMLElement | null {
  if (isDocumentX(target, win)) {
    try {
      return target.documentElement;
    } catch {
      return null;
    }
  }

  if (isWindowX(target, win)) {
    const doc = getDocumentFromWindowSafe(target);
    if (!doc) return null;

    try {
      return doc.documentElement;
    } catch {
      return null;
    }
  }

  return null;
}

function coerceUrlLike(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;

  // SVGAnimatedString: { baseVal: string }
  if (typeof v === 'object' && typeof v.baseVal === 'string') return v.baseVal;

  try {
    return String(v);
  } catch {
    return null;
  }
}

function safeResolveUrl(raw: string, el: Element, doc?: Document): string {
  try {
    const docEl = docOf(el, doc);
    return new URL(raw, docEl.baseURI).href;
  } catch {
    // If it's not a valid URL, keep original
    return raw;
  }
}

export function getResourceLocator(el: Element, doc?: Document): string | null {
  // For custom elements, avoid property access entirely
  const isCustomEl = el.tagName.includes('-');

  // Attribute-first (safe, doesn't invoke custom getters)
  const attr =
    el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data') || el.getAttribute('action');

  if (attr) {
    const resolved = safeResolveUrl(attr, el, doc);
    // Optional: skip javascript: locators
    if (resolved.trim().toLowerCase().startsWith('javascript:')) return null;
    return resolved;
  }

  if (isCustomEl) return null;

  // Property fallback for built-in elements only (guarded)
  try {
    const anyEl = el as any;
    const prop =
      coerceUrlLike(anyEl.href) || coerceUrlLike(anyEl.src) || coerceUrlLike(anyEl.data) || coerceUrlLike(anyEl.action);

    if (!prop) return null;

    const resolved = safeResolveUrl(prop, el, doc);
    return resolved;
  } catch {
    return null;
  }
}

export function safeDocUrl(doc: Document): string | null {
  try {
    return doc.location?.href || doc.URL || null;
  } catch {
    return doc.URL || null;
  }
}

function isProbablyBadUrl(u: string): boolean {
  const s = u.trim().toLowerCase();
  return (
    s === '' ||
    s.startsWith('javascript:') ||
    s.startsWith('mailto:') ||
    s.startsWith('tel:') ||
    s.startsWith('about:') ||
    s.startsWith('chrome:') ||
    s.startsWith('edge:') ||
    s.startsWith('file:') // usually not fetchable safely
  );
}

function toAbsoluteUrl(urlLike: string, doc: Document): string | null {
  try {
    if (isProbablyBadUrl(urlLike)) return null;
    return new URL(urlLike, doc.baseURI || doc.URL).href;
  } catch {
    return null;
  }
}

// Pull first url(...) from a background-image string.
function extractFirstCssUrl(bgImage: string): string | null {
  // Examples: url("..."), url(...), multiple urls, gradients
  const m = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(bgImage || '');
  if (!m?.[2]) return null;
  return m[2].trim();
}

/**
 * Returns either:
 * - { kind:'url', srcUrl:absoluteUrl }
 * - { kind:'inline', data, mimeType, method, srcUrl? }  // for data:/blob:
 */
export function getFetchLocatorForElement(
  el: HTMLElement,
  doc: Document,
):
  | { kind: 'url'; srcUrl: string }
  | { kind: 'inline'; data: string; mimeType: string; method: 'data_url' | 'blob_inline'; srcUrl?: string }
  | null {
  const docEl = docOf(el, doc);
  const winEl = winOfDoc(docEl);
  const tag = String((el as any).tagName || '').toUpperCase();

  // 1) IMG: prefer currentSrc (handles srcset)
  if (tag === 'IMG') {
    const img = el as any;
    const raw =
      (typeof img.currentSrc === 'string' && img.currentSrc) ||
      (typeof img.src === 'string' && img.src) ||
      el.getAttribute('src') ||
      // common lazy attrs
      el.getAttribute('data-src') ||
      el.getAttribute('data-lazy-src') ||
      el.getAttribute('data-original');

    if (!raw) return null;

    if (raw.startsWith('data:')) {
      const parsed = parseDataUrl(raw);
      if (!parsed) return null;
      return { kind: 'inline', ...parsed, method: 'data_url', srcUrl: raw };
    }
    if (raw.startsWith('blob:')) {
      // Background can't fetch page blob: reliably; inline it here.
      return inlineBlobUrl(raw);
    }

    const abs = toAbsoluteUrl(raw, docEl);
    return abs ? { kind: 'url', srcUrl: abs } : null;
  }

  // 2) VIDEO: poster is typically what you want; otherwise currentSrc/src
  if (tag === 'VIDEO') {
    const raw = el.getAttribute('poster') || (el as any).currentSrc || (el as any).src || null;
    if (!raw) return null;

    if (raw.startsWith('data:')) {
      const parsed = parseDataUrl(raw);
      if (!parsed) return null;
      return { kind: 'inline', ...parsed, method: 'data_url', srcUrl: raw };
    }
    if (raw.startsWith('blob:')) return inlineBlobUrl(raw);

    const abs = toAbsoluteUrl(raw, docEl);
    return abs ? { kind: 'url', srcUrl: abs } : null;
  }

  // 3) SVG <image> tag: href/xlink:href
  if (tag === 'IMAGE') {
    const raw = el.getAttribute('href') || el.getAttribute('xlink:href') || null;
    if (!raw) return null;

    if (raw.startsWith('data:')) {
      const parsed = parseDataUrl(raw);
      if (!parsed) return null;
      return { kind: 'inline', ...parsed, method: 'data_url', srcUrl: raw };
    }
    if (raw.startsWith('blob:')) return inlineBlobUrl(raw);

    const abs = toAbsoluteUrl(raw, docEl);
    return abs ? { kind: 'url', srcUrl: abs } : null;
  }

  // 4) CSS background-image on any element
  try {
    const cs = winEl?.getComputedStyle?.(el);
    const bg = cs?.backgroundImage || '';
    if (bg && bg !== 'none') {
      const raw = extractFirstCssUrl(bg);
      if (!raw) return null;

      if (raw.startsWith('data:')) {
        const parsed = parseDataUrl(raw);
        if (!parsed) return null;
        return { kind: 'inline', ...parsed, method: 'data_url', srcUrl: raw };
      }
      if (raw.startsWith('blob:')) return inlineBlobUrl(raw);

      const abs = toAbsoluteUrl(raw, docEl);
      return abs ? { kind: 'url', srcUrl: abs } : null;
    }
  } catch {
    // ignore
  }

  // 5) Generic fallback: your existing logic (if it returns something)
  const rawFallback = getResourceLocator(el, docEl);
  if (!rawFallback) return null;

  if (rawFallback.startsWith('data:')) {
    const parsed = parseDataUrl(rawFallback);
    if (!parsed) return null;
    return { kind: 'inline', ...parsed, method: 'data_url', srcUrl: rawFallback };
  }
  if (rawFallback.startsWith('blob:')) return inlineBlobUrl(rawFallback);

  const abs = toAbsoluteUrl(rawFallback, docEl);
  return abs ? { kind: 'url', srcUrl: abs } : null;
}

function parseDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
  // data:[<mime>][;base64],<payload>
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  const mimeType = (m[1] || 'application/octet-stream').trim();
  const isB64 = !!m[2];
  const payload = m[3] || '';
  if (!isB64) {
    // percent-encoded text -> base64 it
    try {
      const decoded = decodeURIComponent(payload);
      const b64 = btoa(unescape(encodeURIComponent(decoded)));
      return { data: b64, mimeType };
    } catch {
      return null;
    }
  }
  return { data: payload, mimeType };
}

function inlineBlobUrl(
  blobUrl: string,
): { kind: 'inline'; data: string; mimeType: string; method: 'blob_inline'; srcUrl?: string } | null {
  // Fetching blob: from the content script should work (same document context),
  // and we inline it so background doesn't have to.
  // Note: This is the only "fetch" we keep in content script, and it's blob:-scoped.
  return {
    kind: 'inline',
    data: '', // filled by async wrapper below
    mimeType: 'application/octet-stream',
    method: 'blob_inline',
    srcUrl: blobUrl,
  };
}

// If you want blob: to be truly inlined, make inlineBlobUrl async:
export async function inlineBlobUrlAsync(
  blobUrl: string,
): Promise<{ kind: 'inline'; data: string; mimeType: string; method: 'blob_inline'; srcUrl?: string } | null> {
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    const mimeType = blob.type || 'application/octet-stream';
    const data = await blobToBase64(blob);
    return { kind: 'inline', data, mimeType, method: 'blob_inline', srcUrl: blobUrl };
  } catch {
    return null;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const s = String(reader.result || '');
      // result is data:<mime>;base64,<payload>
      const idx = s.indexOf('base64,');
      resolve(idx >= 0 ? s.slice(idx + 'base64,'.length) : '');
    };
    reader.readAsDataURL(blob);
  });
}
