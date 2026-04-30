/**
 * @fileoverview Centralized semantic node repository
 * Manages the collection of semantic nodes during tree construction
 */

import { buildSemanticNodeFromElement, isFrameElement } from './element-analysis.js';
import { getOrAssignNodeId, resetElementIdMap, semanticNodeIdGenerator } from './id-generators.js';
import type { ElementProcessingContext, FrameRealmTuple, SemanticNode, SemanticRole } from '../types/aria-types.js';
import { mergeEventHandlerIndices, validateEventHandlerIndices } from './element-utilities.js';
import { indexAnnotatedElement } from './annotation-manager.js';

// Global semantic node collection
export let SEMANTIC_NODE_COLLECTION: Record<number, SemanticNode> = {};
// NEW: cache for Text nodes
let textNodeIdMap = new WeakMap<Text, number>();
// NEW: track elements currently being built to avoid recursion
let buildingElements = new WeakSet<HTMLElement>();

// Clear the collection for new tree construction
export function clearSemanticNodeCollection(): void {
  SEMANTIC_NODE_COLLECTION = {};
  // REMOVE elementNodeIdMap reset entirely
  textNodeIdMap = new WeakMap<Text, number>();
  buildingElements = new WeakSet<HTMLElement>();

  // ✅ critical: reset element→id map every run (you explicitly said stability not required)
  resetElementIdMap();
}

export function getOrCreateSemanticNode({
  targetElement,
  parentDisabled,
  semanticRole,
  excludeLabels,
  isFrameNode,
  frameContentNodes,
  frameRealm,
  originatedFromParent,
  elementContext,
}: {
  targetElement: HTMLElement;
  parentDisabled?: boolean;
  semanticRole?: SemanticRole | null;
  excludeLabels?: boolean;
  isFrameNode?: boolean;
  frameContentNodes?: number[];
  frameRealm?: FrameRealmTuple;
  originatedFromParent?: boolean;
  elementContext?: ElementProcessingContext;
}): number {
  // 0. Get / assign stable ID for this element
  const nodeIdentifier = getOrAssignNodeId(targetElement); // ✅ single ID source

  // ✅ Critical: make every semantic node id resolvable back to a live Element,
  // even if we decide not to annotate this node with rtrvr-label.
  // (This prevents “backend emitted id that content-script can’t resolve”.)
  indexAnnotatedElement(nodeIdentifier, targetElement);

  const existingNode = SEMANTIC_NODE_COLLECTION[nodeIdentifier];

  if (!originatedFromParent) {
    // 🔒 NEW: if we already have a real node, merge any "frame" metadata instead of ignoring it
    if (existingNode && !existingNode.provisionalFromParent) {
      if (isFrameNode || isFrameElement(targetElement)) {
        existingNode.isFrameElement = true;

        if (frameContentNodes && frameContentNodes.length > 0) {
          existingNode.frameContent = frameContentNodes;
        }
        if (frameRealm) {
          existingNode.frameRealm = frameRealm;
        }
      }

      // OPTIONAL: merge richer runtime context if provided
      if (elementContext) {
        const { eventHandlerIndices, isEditableRegion } = elementContext;

        if (eventHandlerIndices && eventHandlerIndices.length > 0) {
          const validated = validateEventHandlerIndices(eventHandlerIndices);
          if (validated.length > 0) {
            existingNode.eventHandlers = mergeEventHandlerIndices(existingNode.eventHandlers, validated);
          }
        }

        if (isEditableRegion) {
          // Once editable, always editable
          existingNode.isEditable = true;
        }
      }

      // You could also optionally merge extra eventHandlers here if you ever
      // call getOrCreateSemanticNode with a richer elementContext later.
      return nodeIdentifier;
    }

    // Existing cycle-breaker
    if (buildingElements.has(targetElement)) {
      // Optional: same merge trick here if you really want
      // to make sure frameContent isn't dropped when re-entering.
      return nodeIdentifier;
    }

    // 3) Mark as "being built" to break cycles like A ↔ B via aria-labelledby/owns/etc.
    buildingElements.add(targetElement);
    try {
      SEMANTIC_NODE_COLLECTION[nodeIdentifier] = buildSemanticNodeFromElement({
        targetElement,
        parentDisabled,
        semanticRole,
        excludeLabels,
        isFrameNode,
        frameContentNodes,
        frameRealm,
        elementContext,
      });
    } finally {
      buildingElements.delete(targetElement);
    }
  } else {
    // --- PARENT placeholder path (unchanged semantics) ---

    if (!existingNode) {
      const placeholderNode: SemanticNode = {
        nodeCategory: targetElement.nodeType,
        provisionalFromParent: true,
      };

      const nodeName = targetElement.nodeName;
      if (nodeName && nodeName.trim()) {
        placeholderNode.elementName = nodeName;
      }

      // Preserve role attribute if present
      const roleAttribute = targetElement.getAttribute('role');
      if (roleAttribute) {
        placeholderNode.preservedAttributes = { 1: roleAttribute };
      }

      // Preserve tag name
      const tagName = targetElement.tagName;
      if (tagName) {
        placeholderNode.elementTag = tagName;
      }

      SEMANTIC_NODE_COLLECTION[nodeIdentifier] = placeholderNode;
    }
  }

  return nodeIdentifier;
}

// Create text nodes
export function getOrCreateTextualNode(textNode: Text): number {
  // Reuse existing node if we’ve already seen this Text
  const existingId = textNodeIdMap.get(textNode);
  if (existingId !== undefined) {
    return existingId;
  }

  const rawTextContent = textNode.textContent || '';
  const normalizedContent = rawTextContent.replace(/\s+/g, ' ').trim();
  const nodeData = textNode.data?.replace(/\s+/g, ' ').trim();

  // Skip empty text
  if (!normalizedContent && !nodeData) {
    return 0;
  }

  const identifier = semanticNodeIdGenerator.generateId();

  const textSemanticNode: SemanticNode = {
    textContent: normalizedContent,
    nodeCategory: textNode.nodeType,
  };

  if (nodeData && nodeData !== normalizedContent) {
    textSemanticNode.rawData = nodeData;
  }

  SEMANTIC_NODE_COLLECTION[identifier] = textSemanticNode;

  // Remember mapping for this Text node
  textNodeIdMap.set(textNode, identifier);

  return identifier;
}
