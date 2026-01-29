// utilities/dom-scanner.ts
import { CURRENT_TREE_OPTS, getDocumentElementFromTargetSafe, iframeDoc, isElementLike, winOf, winOfDoc } from './dom-utilities.js';
import { INTERACTIVE_LABEL_ATTR } from '../mappings/role-mappings.js';

function clearLabelsInRoot(root: ParentNode, opts: { includeShadow: boolean; includeIframes: boolean }): void {
  // clear in this root
  try {
    const annotated = (root as any).querySelectorAll?.(`[${INTERACTIVE_LABEL_ATTR}]`);
    annotated?.forEach((el: Element) => el.removeAttribute(INTERACTIVE_LABEL_ATTR));
  } catch {}

  // recurse into open shadow roots
  if (opts.includeShadow) {
    try {
      const all = (root as any).querySelectorAll?.('*') as NodeListOf<Element> | undefined;
      if (all) {
        for (const el of Array.from(all)) {
          try {
            const sr = (el as any).shadowRoot as ShadowRoot | null;
            if (sr) clearLabelsInRoot(sr, opts);
          } catch {}
        }
      }
    } catch {}
  }

  // recurse into same-origin iframes
  if (opts.includeIframes) {
    try {
      const iframes = (root as any).querySelectorAll?.('iframe') as NodeListOf<HTMLIFrameElement> | undefined;
      if (iframes) {
        for (const frame of Array.from(iframes)) {
          try {
            const d = iframeDoc(frame);
            if (d?.body) clearLabelsInRoot(d.body, opts);
          } catch {}
        }
      }
    } catch {}
  }
}

/**
 * Remove all agent-specific attributes from a root subtree.
 * - INTERACTIVE_LABEL_ATTR  (e.g. rtrvr-label)
 *
 * Recurses into same-origin iframes as well.
 */
export function clearAgentAnnotations(
  root: Element | Document,
  opts: { includeShadow?: boolean; includeIframes?: boolean } = {},
): void {
  if (CURRENT_TREE_OPTS.disableDomAnnotations) return;
  const winEl = isElementLike(root) ? winOf(root) : (winOfDoc(root as Document) ?? window);
  const rootElement = getDocumentElementFromTargetSafe(root, winEl) ?? root;
  if (!rootElement) return;

  // Remove from root itself (if it’s an Element)
  try {
    (rootElement as Element).removeAttribute?.(INTERACTIVE_LABEL_ATTR);
  } catch {}

  clearLabelsInRoot(rootElement, {
    includeShadow: opts.includeShadow ?? true,
    includeIframes: opts.includeIframes ?? true,
  });
}
