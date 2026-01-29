/**
 * @fileoverview Semantic tree construction following W3C accessibility specifications
 * @see https://www.w3.org/TR/wai-aria-practices-1.2/
 */

import { EXCLUDED_ELEMENT_TAGS, CODE_ELEMENT_TAG, PREFORMATTED_TAG } from '../mappings/role-mappings.js';
// NEW
import { DOMNodeCategory, SemanticRoleReverseMap } from '../types/aria-types.js';
import { annotateSemanticNode, clearAnnotatedElementIndex } from '../utilities/annotation-manager.js';
import { semanticNodeIdGenerator } from '../utilities/id-generators.js';
import { clearAgentAnnotations } from '../utilities/dom-scanner.js';
import {
  isInvisible,
  isSpecialReportElement,
  extractChildElements,
  supportsNameFromContent,
  isModalDialog,
  MODAL_SELECTOR,
  requiresNodeCreation,
  isFrameElement,
  isElementNode,
  isTextualNode,
} from '../utilities/element-analysis.js';
import { analyzeElementContext } from '../utilities/element-utilities.js';
import {
  SEMANTIC_NODE_COLLECTION,
  getOrCreateSemanticNode,
  getOrCreateTextualNode,
  clearSemanticNodeCollection,
} from '../utilities/node-repository.js';
import { determineSemanticRole } from '../utilities/semantic-role-analyzer.js';
import type { ElementProcessingContext, SemanticNode, SemanticRole } from '../types/aria-types.js';
import {
  CURRENT_TREE_OPTS,
  docOf,
  getResourceLocator,
  setTreeExtractionContext,
  TreeExtractionOptions,
  winOf,
} from '../utilities/dom-utilities.js';

export function extractSemanticTree(
  rootElement: Element,
  opts: TreeExtractionOptions = {},
): {
  rootNodes: number[];
  semanticNodes: Record<number, SemanticNode>;
} {
  // Default options for backwards compatibility:
  // - includeFrameContents: true => old same-origin inline iframe traversal
  // - clearIframes: true => old behavior clears labels in nested same-origin iframes
  // - frameContextLabel: null => top frame
  setTreeExtractionContext(opts);

  // 1. Drop semantic node collection from previous run
  clearSemanticNodeCollection();

  // 2. Drop annotated elements in memory map
  clearAnnotatedElementIndex(); // NEW

  // 3. Remove all agent-added attributes in this subtree.
  //    In multi-frame mode we do NOT clear into iframes from the parent frame.
  clearAgentAnnotations(rootElement, { includeShadow: true, includeIframes: CURRENT_TREE_OPTS.clearIframes });

  // 4. Fresh counters – ID stability across runs is not required
  semanticNodeIdGenerator.initialize(CURRENT_TREE_OPTS.semanticIdStart);

  // 5. Build a brand new tree
  return {
    rootNodes: constructSemanticTree(rootElement),
    semanticNodes: SEMANTIC_NODE_COLLECTION,
  };
}

function constructSemanticTree(rootElement: Element): number[] {
  let treeRootIds: number[] = [];
  try {
    const documentRef = docOf(rootElement);

    // 1. Locate modal dialogs
    const modalCandidates = Array.from(documentRef.querySelectorAll(MODAL_SELECTOR));

    // 2. Filter for visible, correctly implemented modals
    const activeModals = modalCandidates.filter(modal => !isInvisible(modal) && isModalDialog(modal));

    if (activeModals.length === 0) {
      treeRootIds = processSemanticNodes({ targetElement: rootElement });
    } else if (activeModals.length === 1) {
      const primaryModal = activeModals[0];
      if (primaryModal.contains(rootElement)) {
        treeRootIds = processSemanticNodes({ targetElement: rootElement });
      } else if (rootElement.contains(primaryModal)) {
        treeRootIds = processSemanticNodes({ targetElement: primaryModal });
      } else {
        // Process root when modal and root are independent
        treeRootIds = processSemanticNodes({ targetElement: rootElement });
      }
    } else {
      // Multiple modals - process root ignoring modals
      treeRootIds = processSemanticNodes({ targetElement: rootElement });
    }
  } catch (error) {
    console.error(`Error constructing semantic tree`, error);
    throw error;
  }
  return treeRootIds;
}

// NEW: allow building a subtree into the current node collection without resetting.
// Used for same-origin fallback when an iframe has no content script (about:blank/srcdoc).
export function constructSemanticSubtree(rootElement: Element): number[] {
  return constructSemanticTree(rootElement);
}

function processSemanticNodes({
  targetElement,
  parentNode,
}: {
  targetElement: Element;
  parentNode?: SemanticNode;
}): number[] {
  // Skip excluded elements
  if (isSpecialReportElement(targetElement) || shouldExcludeElement(targetElement)) {
    return [];
  }

  // Determine semantic role purely via analyzer:
  const semanticRole = determineSemanticRole(targetElement);
  // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
  const elementContext = analyzeElementContext(targetElement, semanticRole);

  // Handle iframe elements specially
  if (isFrameElement(targetElement)) {
    const frameNodeId = processFrameNode({
      frameElement: targetElement as HTMLIFrameElement,
      role: semanticRole,
      parentNode,
      elementContext,
    });
    return [frameNodeId];
  }

  let currentNodeId: number = 0;

  // Determine if node creation and annotation is needed
  const { shouldCreate, shouldAnnotate } = requiresNodeCreation(elementContext);

  if (shouldCreate) {
    // Annotate interactive elements
    if (shouldAnnotate) {
      annotateSemanticNode(targetElement);
    }

    // Create semantic node
    currentNodeId = getOrCreateSemanticNode({
      targetElement: targetElement as HTMLElement,
      parentDisabled: parentNode?.isDisabled,
      semanticRole: semanticRole!,
      elementContext, // NEW
    });

    // Skip children for presentational roles
    /** Bhavani TO_DO: Check If you truly want no trimming / no stopping,
     * comment that logic out so we still walk the subtree under presentational containers. */
    // Bhavani TO_DO: Check if doing this adds noise
    // For now removed since background handles structural containers and we don't wanna miss any iframes inside a container
    // if (semanticRole && presentationalChildrenExist(targetElement, semanticRole)) {
    //   return [currentNodeId];
    // }
  }

  // Process child elements
  const currentNode = SEMANTIC_NODE_COLLECTION[currentNodeId];

  const childNodeIds = processChildElements(targetElement, semanticRole, currentNodeId ? currentNode : parentNode);

  // Update node with children
  if (currentNodeId && childNodeIds.length > 0) {
    currentNode!.semanticChildren = childNodeIds;
  }

  return currentNodeId ? [currentNodeId] : childNodeIds;
}

// Process children with text node merging
function processChildElements(targetElement: Element, parentRole: string | null, parentNode?: SemanticNode): number[] {
  const childIds: number[] = [];
  const rawChildren = extractChildElements(targetElement, parentRole);

  for (const child of rawChildren) {
    if (isSpecialReportElement(child) || shouldExcludeElement(child)) {
      continue;
    }

    if (isElementNode(child)) {
      const nodeIds = processSemanticNodes({
        targetElement: child,
        parentNode,
      });
      childIds.push(...nodeIds);
    } else if (isTextualNode(child as ChildNode) && isValidTextualNode(child as Text, parentNode)) {
      const textNodeId = getOrCreateTextualNode(child as Text);
      if (textNodeId) childIds.push(textNodeId);
    }
  }

  return childIds;
}

function processFrameNode({
  frameElement,
  role,
  parentNode,
  elementContext,
}: {
  frameElement: HTMLIFrameElement;
  role: SemanticRole | null;
  parentNode?: SemanticNode;
  elementContext?: ElementProcessingContext;
}): number {
  annotateSemanticNode(frameElement);
  const frameContentNodes: number[] = processFrameContent(frameElement);

  return getOrCreateSemanticNode({
    targetElement: frameElement as HTMLElement,
    parentDisabled: parentNode?.isDisabled,
    semanticRole: role,
    isFrameNode: true,
    frameContentNodes,
    elementContext,
  });
}

/** Process elements inside an iframe if accessible */
function processFrameContent(frameElement: HTMLIFrameElement): number[] {
  if (!CURRENT_TREE_OPTS.includeFrameContents) return [];
  const frameContentRoot = resolveFrameContentRoot(frameElement);
  if (frameContentRoot.kind === 'content') {
    return constructSemanticTree(frameContentRoot.rootElement);
  }

  return buildUnavailableFrameSubtree(frameElement, frameContentRoot.reason);
}

type FrameContentUnavailableReason = 'cross_origin_blocked' | 'iframe_not_ready_or_empty';

function resolveFrameContentRoot(
  frameElement: HTMLIFrameElement,
):
  | { kind: 'content'; rootElement: Element }
  | { kind: 'unavailable'; reason: FrameContentUnavailableReason } {
  let frameDocument: Document | null = null;

  try {
    frameDocument = frameElement.contentDocument || frameElement.contentWindow?.document || null;
  } catch {
    return { kind: 'unavailable', reason: 'cross_origin_blocked' };
  }

  const rootElement = frameDocument?.body || frameDocument?.documentElement || null;
  if (!rootElement) {
    return { kind: 'unavailable', reason: 'iframe_not_ready_or_empty' };
  }

  return { kind: 'content', rootElement };
}

function buildUnavailableFrameSubtree(
  frameElement: HTMLIFrameElement,
  reason: FrameContentUnavailableReason,
): number[] {
  const containerNodeId = semanticNodeIdGenerator.generateId();
  const textNodeId = semanticNodeIdGenerator.generateId();

  const computedName =
    frameElement.getAttribute('title')?.trim() ||
    frameElement.getAttribute('name')?.trim() ||
    frameElement.id?.trim() ||
    'Embedded frame';

  const resourceLocator = getResourceLocator(frameElement) || undefined;
  const reasonText =
    reason === 'cross_origin_blocked'
      ? 'Iframe content is not accessible from this origin (cross-origin).'
      : 'Iframe content is not ready yet or has no readable DOM.';

  SEMANTIC_NODE_COLLECTION[containerNodeId] = {
    nodeCategory: DOMNodeCategory.ELEMENT,
    semanticRole: 'embedded_document_unavailable',
    computedName,
    syntheticKind: 'embedded_container',
    frameContent: [textNodeId],
    ...(resourceLocator ? { resourceLocator } : {}),
  };

  SEMANTIC_NODE_COLLECTION[textNodeId] = {
    nodeCategory: DOMNodeCategory.TEXT,
    parent: containerNodeId,
    textContent: reasonText,
    preventTextMerge: true,
    syntheticKind: 'embedded_unavailable_text',
  };

  return [containerNodeId];
}

function isValidTextualNode(textNode: Text, parentNode?: SemanticNode): boolean {
  // Check if text has content
  const normalizedText = textNode.data.trim();
  if (!normalizedText || normalizedText === '') {
    return false;
  }

  // Skip if parent role supports name from content
  if (parentNode?.semanticRole !== undefined && parentNode?.semanticRole !== null) {
    const parentRole =
      typeof parentNode.semanticRole === 'number'
        ? SemanticRoleReverseMap[parentNode.semanticRole]
        : parentNode.semanticRole;
    if (supportsNameFromContent(parentRole)) return false;
  }

  return true;
}

function shouldExcludeElement(node: Node): boolean {
  if (!isElementNode(node)) {
    return false;
  }

  const element = node as Element;
  const tagName = element.tagName;

  // Always exclude meta elements
  if (EXCLUDED_ELEMENT_TAGS.has(tagName)) {
    return true;
  }

  // More permissive for code elements
  if (tagName === CODE_ELEMENT_TAG || tagName === PREFORMATTED_TAG) {
    return isCompletelyHidden(element);
  }

  return false;
}

function isCompletelyHidden(element: Element): boolean {
  // Only check element itself
  const win = winOf(element);
  const computedStyle = win.getComputedStyle(element);

  // Explicitly hidden
  if (computedStyle.display === 'none') {
    return true;
  }

  // Check dimensions and position
  const boundingRect = element.getBoundingClientRect();
  if (boundingRect.width === 0 && boundingRect.height === 0) {
    // Exception for code in pre tags
    if (!element.closest('pre')) {
      return true;
    }
  }

  // Far off screen
  if (boundingRect.right < -1000 || boundingRect.left > win.innerWidth + 1000) {
    return true;
  }

  return false;
}
