// utilities/annotation-manager.ts
// NEW
import { extractPrimaryInteractiveIdFromLabel } from './element-utilities.js';
import { annotateInteractiveElement } from '../core/element-annotation.js';
import { INTERACTIVE_LABEL_ATTR } from '../mappings/role-mappings.js';
import { CURRENT_TREE_OPTS, globalDocumentSafe } from './dom-utilities.js';
import { getOrAssignNodeId } from './id-generators.js';

const annotatedIndex = new Map<number, WeakRef<Element> | Element>();
let annotationLabelMap = new WeakMap<Element, string>();

export function clearAnnotatedElementIndex(): void {
  annotatedIndex.clear();
  annotationLabelMap = new WeakMap();
}

export function indexAnnotatedElement(id: number, el: Element): void {
  try {
    if (typeof WeakRef !== 'undefined') annotatedIndex.set(id, new WeakRef(el));
    else annotatedIndex.set(id, el);
  } catch {
    // ignore
  }
}

export function getIndexedAnnotatedElement(id: number): Element | null {
  const v = annotatedIndex.get(id);
  if (!v) return null;
  const el = v instanceof WeakRef ? v.deref() : v;
  if (!el) return null;
  // @ts-ignore
  if (el.isConnected === false) return null;
  return el;
}

export function annotateSemanticNode(element: Element): string | undefined {
  let frameContextLabel: string | null = null;
  const nodeId = getOrAssignNodeId(element);
  // Per-frame mode: parent passes the embedding iframe label to the child frame,
  // so we never need to touch window.frameElement (which is null cross-origin).
  if (CURRENT_TREE_OPTS.frameContextLabel) {
    frameContextLabel = CURRENT_TREE_OPTS.frameContextLabel;
  } else {
    const globalDoc = globalDocumentSafe();
    if (globalDoc && element.ownerDocument !== globalDoc) {
      // Backward-compatible same-origin inline traversal path
      try {
        // Same-origin inline traversal fallback:
        const frameRoot = element.ownerDocument?.defaultView?.frameElement as Element | null;
        const lbl = frameRoot?.getAttribute(INTERACTIVE_LABEL_ATTR) || '';
        const rootId = lbl ? extractPrimaryInteractiveIdFromLabel(lbl) : null;
        frameContextLabel = rootId ? String(rootId) : null;
      } catch {
        frameContextLabel = '';
      }
    }
  }

  const newAnnotation = annotateInteractiveElement({
    element,
    elementID: nodeId, // ✅ id is semantic node id
    frameContextLabel,
  });
  indexAnnotatedElement(nodeId, element);
  if (newAnnotation) {
    try {
      annotationLabelMap.set(element, newAnnotation);
    } catch {
      // ignore
    }
  }

  return newAnnotation;
}

export function getAnnotationLabelForElement(element: Element): string | null {
  return annotationLabelMap.get(element) ?? null;
}
