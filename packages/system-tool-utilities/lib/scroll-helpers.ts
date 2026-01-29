import { docOf, winOfDoc } from '@rover/a11y-tree';
import { ScrollDirectionEnum, ScrollPositionEnum } from './types.js';

export interface ScrollBridgeOptions {
  // Legacy main-world injection + postMessage bridge removed.
  cacheResults?: boolean;
  debugMode?: boolean;
}

export interface ScrollDetectionResult {
  element: HTMLElement | null;
  selector: string;
  score: number;
  type: string;
  metrics?: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    isAtTop: boolean;
    isAtBottom: boolean;
  };
}

export interface ScrollOperationResult {
  success: boolean;
  scrollTop?: number;
  scrollLeft?: number;
  isAtTop?: boolean;
  isAtBottom?: boolean;
  position?: string;
  error?: string;
}

export function normalizeScrollAlignment(position?: ScrollPositionEnum | string): ScrollPositionEnum {
  if (!position) return ScrollPositionEnum.CENTER;

  const normalizedKey = typeof position === 'string' ? position.toUpperCase() : String(position).toUpperCase();

  if (ScrollPositionEnum && normalizedKey in ScrollPositionEnum) {
    return ScrollPositionEnum[normalizedKey as keyof typeof ScrollPositionEnum];
  }

  return ScrollPositionEnum.CENTER;
}

function cssEscape(value: string): string {
  if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(value);
  }
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

/**
 * Get a reasonably specific CSS selector for an element.
 * Shared across worlds to keep selectors stable.
 */
export function getElementSelector(element: HTMLElement | null, doc: Document): string {
  if (!element) return '';
  const docEl = docOf(element, doc);
  if (element === docEl.documentElement) return 'html';
  if (element === docEl.body) return 'body';

  if (element.id) return `#${cssEscape(element.id)}`;

  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== docEl.body && current !== docEl.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${cssEscape(current.id)}`;
      path.unshift(selector);
      break;
    }

    const rawClasses =
      current.classList && current.classList.length
        ? Array.from(current.classList)
        : (current.className || '').toString().split(/\s+/).filter(Boolean);

    const stableClasses = rawClasses
      .filter(c => c && c.length <= 48)
      .sort((a, b) => a.length - b.length)
      .slice(0, 3)
      .map(cssEscape);

    if (stableClasses.length) {
      selector += '.' + stableClasses.join('.');
    } else {
      const parent = current.parentElement;
      if (parent) {
        const sameType = Array.from(parent.children).filter(ch => (ch as HTMLElement).tagName === current!.tagName);
        if (sameType.length > 1) {
          const index = sameType.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Direct scroll by amount (fallback)
 */
export function directScrollBy(
  element: HTMLElement,
  doc: Document,
  win: Window,
  direction: ScrollDirectionEnum,
  amount?: number,
): ScrollOperationResult {
  const docEl = docOf(element, doc);
  const winEl = winOfDoc(docEl, win);

  const scrollingElement =
    (docEl.scrollingElement as HTMLElement | null) ||
    (docEl.documentElement as HTMLElement) ||
    (docEl.body as HTMLElement);

  const isRoot = element === docEl.documentElement || element === docEl.body || element === scrollingElement;

  const target = isRoot ? scrollingElement : element;

  const viewportHeight = isRoot ? winEl.innerHeight : target.clientHeight;
  const viewportWidth = isRoot ? winEl.innerWidth : target.clientWidth;
  const scrollAmount = amount ?? viewportHeight * 0.8;

  switch (direction) {
    case ScrollDirectionEnum.DOWN: {
      target.scrollTop += scrollAmount;
      break;
    }
    case ScrollDirectionEnum.UP: {
      target.scrollTop = Math.max(0, target.scrollTop - scrollAmount);
      break;
    }
    case ScrollDirectionEnum.LEFT: {
      target.scrollLeft = Math.max(0, target.scrollLeft - (amount ?? viewportWidth * 0.8));
      return { success: true, scrollLeft: target.scrollLeft };
    }
    case ScrollDirectionEnum.RIGHT: {
      target.scrollLeft += amount ?? viewportWidth * 0.8;
      return { success: true, scrollLeft: target.scrollLeft };
    }
    default: {
      return { success: false, error: `Unsupported scroll direction: ${String(direction)}` };
    }
  }

  const scrollHeight = target.scrollHeight;
  const clientHeight = isRoot ? winEl.innerHeight : target.clientHeight;
  const maxScroll = scrollHeight - clientHeight;

  return {
    success: true,
    scrollTop: target.scrollTop,
    isAtTop: target.scrollTop <= 5,
    isAtBottom: target.scrollTop >= maxScroll - 5,
  };
}

export function getRootScroller(doc: Document): HTMLElement {
  return (
    (doc.scrollingElement as HTMLElement | null) || (doc.documentElement as HTMLElement) || (doc.body as HTMLElement)
  );
}

/**
 * Find the nearest scrollable ancestor for an element, or root scroll.
 */
export function findScrollableParentElement(element: HTMLElement, doc: Document, win: Window): HTMLElement {
  const docEl = docOf(element, doc);
  const winEl = winOfDoc(docEl, win);

  const scrollingElement = getRootScroller(docEl);
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

export function checkIfElementAtTop(element: HTMLElement): boolean {
  return element.scrollTop <= 5;
}

export function checkIfElementAtBottom(element: HTMLElement, doc: Document, win: Window): boolean {
  const docEl = docOf(element, doc);
  const winEl = winOfDoc(docEl, win);
  const scrollingElement = getRootScroller(docEl);
  const isRoot = element === docEl.documentElement || element === docEl.body || element === scrollingElement;

  const target = isRoot ? scrollingElement : element;
  const scrollHeight = target.scrollHeight;
  const clientHeight = isRoot ? winEl.innerHeight : target.clientHeight;
  const maxScroll = scrollHeight - clientHeight;

  return target.scrollTop >= maxScroll - 5;
}

/**
 * Direct scroll-to-element fallback when main-world script is unavailable.
 */
export function directScrollElementIntoView(
  element: HTMLElement,
  doc: Document,
  win: Window,
  position: ScrollPositionEnum,
): ScrollOperationResult {
  const docEl = docOf(element, doc);
  const winEl = winOfDoc(docEl, win);
  const scrollingElement = getRootScroller(docEl);

  const scrollContainer = findScrollableParentElement(element, docEl, winEl);
  const isRoot =
    scrollContainer === docEl.documentElement || scrollContainer === docEl.body || scrollContainer === scrollingElement;

  const target = isRoot ? scrollingElement : scrollContainer;

  const elementRect = element.getBoundingClientRect();
  const containerRect = isRoot
    ? new (((winEl as any).DOMRect || DOMRect) as typeof DOMRect)(0, 0, winEl.innerWidth, winEl.innerHeight)
    : scrollContainer.getBoundingClientRect();

  const viewportHeight = isRoot ? winEl.innerHeight : scrollContainer.clientHeight;
  const padding = 24;

  const elementTopInContainer = elementRect.top - containerRect.top;
  const absoluteElementTop = target.scrollTop + elementTopInContainer;

  let targetScrollTop: number;

  switch (position) {
    case ScrollPositionEnum.START:
      targetScrollTop = absoluteElementTop - padding;
      break;
    case ScrollPositionEnum.END:
      targetScrollTop = absoluteElementTop + elementRect.height - viewportHeight + padding;
      break;
    case ScrollPositionEnum.NEAREST: {
      const isVisible = elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;

      if (isVisible) {
        return {
          success: true,
          scrollTop: target.scrollTop,
          isAtTop: target.scrollTop <= 5,
          isAtBottom: checkIfElementAtBottom(target, docEl, winEl),
        };
      }

      if (elementRect.top < containerRect.top) {
        targetScrollTop = absoluteElementTop - padding;
      } else {
        targetScrollTop = absoluteElementTop + elementRect.height - viewportHeight + padding;
      }
      break;
    }
    case ScrollPositionEnum.CENTER:
    default:
      targetScrollTop = absoluteElementTop - viewportHeight / 2 + elementRect.height / 2;
      break;
  }

  const maxScroll = target.scrollHeight - viewportHeight;
  targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

  target.scrollTop = targetScrollTop;

  return {
    success: true,
    scrollTop: target.scrollTop,
    isAtTop: target.scrollTop <= 5,
    isAtBottom: target.scrollTop >= maxScroll - 5,
  };
}
