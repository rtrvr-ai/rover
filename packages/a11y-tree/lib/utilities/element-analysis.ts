/**
 * @fileoverview Element analysis utilities following W3C accessibility guidelines
 */

import { annotateSemanticNode, getAnnotationLabelForElement } from './annotation-manager.js';
import { analyzeElementContext, validateEventHandlerIndices } from './element-utilities.js';
import { getOrCreateSemanticNode, getOrCreateTextualNode } from './node-repository.js';
import { determineSemanticRole } from './semantic-role-analyzer.js';
import { extractRelevantStyles } from './style-extractor.js';
import {
  INTERACTIVE_SEMANTIC_ROLES,
  NAME_FROM_CONTENT_ROLES,
  FORM_ASSOCIATED_ELEMENTS,
  HEADING_ELEMENTS,
  HTML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  PreservedAttributeCheck,
  SvgPreservedAttribute,
  PropertyAttributeCheck,
  EXCLUDED_ELEMENT_TAGS,
  CODE_ELEMENT_TAG,
  PREFORMATTED_TAG,
  ANNOTATABLE_HANDLER_ENUMS,
  INTERACTIVE_LABEL_ATTR,
} from '../mappings/role-mappings.js';
import {
  SemanticRoleMap,
  AriaPropertyAttribute,
  AriaStateAttribute,
  PreservedAttribute,
  SvgStructureAttribute,
  DOMNodeCategory,
  ElementNamespace,
} from '../types/aria-types.js';
import type { SemanticNode, SemanticRole, ElementProcessingContext } from '../types/aria-types.js';
import {
  cssEscapeSafe,
  CURRENT_TREE_OPTS,
  docOf,
  getSignalProvider,
  getElementByIdSafe,
  getResourceLocator,
  globalDocumentSafe,
  isHTMLElementLike,
  isHTMLSlotElementX,
  isShadowRootLike,
  querySelectorAllSafe,
  querySelectorSafe,
  winOf,
} from './dom-utilities.js';
import { isRoverWidgetHost } from './dom-root-guards.js';

// Check visibility
// export function isInvisible(element: Element, role?: string | null) {
//   const computedStyle = window.getComputedStyle(element);

//   // Interactive elements are never hidden
//   if (role && INTERACTIVE_SEMANTIC_ROLES.has(role)) {
//     return false;
//   }

//   // Make aria-hidden elements visible
//   if (findClosestAncestor(element as HTMLElement, '[aria-hidden="true"]') !== null) {
//     // Not mutating or changing tree, will be captured in labeling if interactive
//     // element.removeAttribute('aria-hidden');
//     return false;
//   }

//   // Check visibility
//   if (computedStyle.visibility === 'hidden') {
//     return true;
//   }

//   return false;
// }

export function isInvisible(element: Element, role?: string | null): boolean {
  const win = winOf(element);
  if (!isHTMLElementLike(element, win)) return true;

  // Interactive elements are never hidden
  if (role && INTERACTIVE_SEMANTIC_ROLES.has(role)) {
    return false;
  }

  // IMPORTANT: aria-hidden should NOT force visible or invisible.
  // We only use CSS/layout signals here.

  // Cheap attribute-based hides
  if (element.hasAttribute('hidden')) return true;
  if (findClosestAncestor(element as HTMLElement, '[hidden]') !== null) return true;
  if (findClosestAncestor(element as HTMLElement, '[inert]') !== null) return true;

  const style = win.getComputedStyle(element);

  // Not rendered
  if (style.display === 'none') return true;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;

  // If the element does not produce any boxes, it's not visually present
  if (element.getClientRects().length === 0) return true;

  // Extreme offscreen parking-lot clones
  const rect = element.getBoundingClientRect();
  const FAR = 1_000_000;
  if (Math.abs(rect.left) > FAR || Math.abs(rect.top) > FAR) return true;

  return false;
}

export function isSpecialReportElement(node: Node) {
  return isElementNode(node) && node.classList.contains('jasmine_html-reporter');
}

function isPresentationalElement(element: HTMLElement) {
  const role = element.getAttribute('role');
  return role === 'presentation' || role === 'none';
}

type IdRef = string | Element;

function splitIdRefs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // ARIA IDREF list: whitespace separated, can include newlines/tabs
  return raw
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^#/, ''));
}

/**
 * Resolve an IDREF in the most correct scope:
 * 1) open shadow root scope (owner.getRootNode() is ShadowRoot) via querySelector(#id)
 * 2) ownerDocument.getElementById(id)
 */
function resolveIdRefFromOwner(owner: Element, idRef: string): Element | null {
  const raw = (idRef || '').trim().replace(/^#/, '');
  if (!raw) return null;

  // 1) try within open shadow root
  try {
    const root = (owner as any).getRootNode?.();
    if (isShadowRootLike(root)) {
      const win = winOf(owner);
      const sel = `#${cssEscapeSafe(win, raw)}`;
      const inShadow = querySelectorSafe(root, sel);
      if (inShadow) return inShadow;
    }
  } catch {}

  // 2) fallback to ownerDocument
  const d = docOf(owner);
  return getElementByIdSafe(d as any, raw);
}

function flattenElementArray(args: any): Element[] {
  const CHUNK_SIZE = 8192;
  const result = [];

  for (let i = 0; i < arguments.length; i++) {
    const element = arguments[i];
    if (Array.isArray(element)) {
      for (let c = 0; c < element.length; c += CHUNK_SIZE) {
        const chunk = sliceArray(element, c, c + CHUNK_SIZE);
        const recurseResult = flattenElementArray.apply(null, chunk as any);
        for (let r = 0; r < recurseResult.length; r++) {
          result.push(recurseResult[r]);
        }
      }
    } else {
      result.push(element);
    }
  }
  return result;
}

function sliceArray(array: Array<Element>, start: number, end: number): Array<Element> {
  if (arguments.length <= 2) {
    return Array.prototype.slice.call(array, start);
  } else {
    return Array.prototype.slice.call(array, start, end);
  }
}

export function extractChildElements(element: Element, role?: string | null) {
  return extractNestedChildren(element, role).concat(extractOwnedChildren(element as HTMLElement));
}

function extractNestedChildren(element: Element, role?: string | null) {
  const children = flattenElementArray(
    getComposedChildNodes(element).map(child => {
      if (isObjectNode(child) && isElementNode(child)) {
        return findClosestDescendants(child, role);
      } else {
        return child;
      }
    }),
  );

  return children;
}

function findClosestDescendants(element: Element, role?: string | null): Element[] {
  if (!element || isInvisible(element, role)) {
    return [];
  }

  if (!isPresentationalElement(element as HTMLElement)) {
    return [element];
  }

  const children = Array.from(element.children);
  return flattenElementArray(children.map(child => findClosestDescendants(child, role)));
}

function extractOwnedElements(element: HTMLElement): HTMLElement[] {
  const ids = splitIdRefs(element.getAttribute('aria-owns'));
  if (!ids.length) return [];

  const out: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const resolved = resolveIdRefFromOwner(element, id);
    if (resolved && resolved !== element) out.push(resolved as HTMLElement);
  }
  return out;
}

function extractOwnedChildren(element: HTMLElement): HTMLElement[] {
  const children = extractOwnedElements(element);
  for (const child of children) {
    (child as any)['aria-owned-by'] = element;
  }
  return children;
}

export function isModalDialog(element: Element): boolean {
  const win = winOf(element);
  const doc = docOf(element);

  // Check role
  if (element.getAttribute('role') !== 'dialog' && element.getAttribute('role') !== 'alertdialog') {
    return false;
  }

  // Check aria-modal
  if (element.getAttribute('aria-modal') !== 'true') {
    return false;
  }

  // Check positioning
  const style = win.getComputedStyle(element);
  if (style?.position !== 'fixed' && style?.position !== 'absolute') {
    return false;
  }
  if (parseInt(style?.zIndex, 10) <= findHighestZIndex(element)) {
    return false;
  }

  // Check background overlay
  const overlay = findBackgroundOverlay(element);
  if (!overlay || !coversViewport(overlay)) {
    return false;
  }

  // Check sibling aria-hidden
  if (!areSiblingsHidden(element)) {
    return false;
  }

  // Check overlay role
  if (overlay.getAttribute('role') === 'dialog' || element.getAttribute('role') === 'dialog') return false;

  return hasFocusableContent(element);
}

function findBackgroundOverlay(modal: Element): Element | null {
  const candidates = [
    modal.previousElementSibling,
    modal.nextElementSibling,
    ...Array.from(modal.children),
    ...(modal.parentElement
      ? [modal.parentElement.previousElementSibling, modal.parentElement.nextElementSibling]
      : []),
  ].filter((el): el is Element => el !== null);

  return candidates.find(isPotentialOverlay) || null;
}

function isPotentialOverlay(element: Element): boolean {
  if (isInvisible(element)) return false;

  const win = winOf(element);
  const style = win.getComputedStyle(element);
  return (
    (style?.position === 'fixed' || style?.position === 'absolute') &&
    style?.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    style?.backgroundColor !== 'transparent' &&
    style?.pointerEvents !== 'none'
  );
}

function coversViewport(element: Element): boolean {
  const win = winOf(element);
  const rect = element.getBoundingClientRect();
  return rect.top <= 0 && rect.left <= 0 && rect.bottom >= win.innerHeight && rect.right >= win.innerWidth;
}

function findHighestZIndex(excludeElement: Element): number {
  const doc = docOf(excludeElement);
  const win = winOf(excludeElement);
  const getCS = (win as any)?.getComputedStyle;
  if (!getCS) return 0;

  const candidates = querySelectorAllSafe(doc, '*')
    .filter(el => el !== excludeElement && !isInvisible(el))
    .map(el => parseInt(getCS.call(win, el as Element)?.zIndex, 10))
    .filter(z => Number.isFinite(z) && !isNaN(z));

  if (!candidates.length) return 0;
  return Math.max(...candidates);
}

function hasFocusableContent(element: Element): boolean {
  const focusableElements = element.querySelectorAll(
    'a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])',
  );
  return focusableElements.length > 0;
}

function areSiblingsHidden(modal: Element): boolean {
  const parent = modal.parentElement;
  if (!parent) return false;

  for (const sibling of Array.from(parent.children)) {
    if (sibling !== modal && !isInvisible(sibling) && sibling.getAttribute('aria-hidden') !== 'true') {
      return false;
    }
  }
  return true;
}

function getModalSelector(): string {
  try {
    const d = globalDocumentSafe();
    const dialogModalTest = d?.querySelector?.('dialog:modal');
    return '[aria-modal="true"], dialog:modal';
  } catch {
    return '[aria-modal="true"]';
  }
}

export const MODAL_SELECTOR = getModalSelector();

export function isElementDisabled(el: Element): boolean {
  return el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
}

export function detectJavaScriptLink(element: HTMLElement): boolean {
  // Safe: getAttribute will not trigger custom element getters
  let elementUrl =
    element.getAttribute('href') ||
    element.getAttribute('src') ||
    element.getAttribute('data') ||
    element.getAttribute('action');

  // Optional fallback: only read properties for *built-in* tags (custom elements contain a dash)
  if (!elementUrl && !element.tagName.includes('-')) {
    try {
      const anyEl = element as any;
      elementUrl = anyEl.href || anyEl.src || anyEl.data || anyEl.action || null;
    } catch {
      return false;
    }
  }

  if (!elementUrl) return false;

  try {
    const doc = docOf(element);
    const url = new URL(elementUrl, doc.baseURI);

    return (
      url.protocol === 'javascript:' &&
      (url.pathname.trim() !== '' || url.search.trim() !== '' || url.hash.trim() !== '')
    );
  } catch {
    return false;
  }
}

export function supportsNameFromContent(role: string): boolean {
  return NAME_FROM_CONTENT_ROLES.has(role);
}

// Get parent element reference
function retrieveParentElement(element: HTMLElement): number | undefined {
  const parent = element.parentElement;
  const doc = docOf(element);
  if (!parent || parent === doc.body || parent === doc.documentElement) {
    return undefined;
  }

  return getOrCreateSemanticNode({
    targetElement: parent,
    originatedFromParent: true,
  });
}

// Build semantic node from element
export function buildSemanticNodeFromElement({
  targetElement,
  parentDisabled,
  semanticRole,
  excludeLabels,
  isFrameNode,
  frameContentNodes,
  elementContext,
}: {
  targetElement: HTMLElement;
  parentDisabled?: boolean;
  semanticRole?: SemanticRole | null;
  excludeLabels?: boolean;
  isFrameNode?: boolean;
  frameContentNodes?: number[];
  elementContext?: ElementProcessingContext; // NEW
}): SemanticNode {
  const semanticNode: SemanticNode = {
    nodeCategory: targetElement.nodeType,
  };

  const currentNodeDisabled = parentDisabled || isElementDisabled(targetElement);
  const parentRef = retrieveParentElement(targetElement);
  if (parentRef) {
    semanticNode.parent = parentRef;
  }

  // Semantic role: enum index if known, otherwise string
  if (semanticRole) {
    const idx = SemanticRoleMap[semanticRole];
    if (typeof idx === 'number') {
      semanticNode.semanticRole = idx;
    } else {
      semanticNode.semanticRole = semanticRole; // preserve raw role text
    }
  }

  if (currentNodeDisabled) {
    semanticNode.isDisabled = true;
  }

  // --- NEW: attach runtime interaction hints in numeric form ---
  if (elementContext) {
    const { eventHandlerIndices, isEditableRegion } = elementContext;

    const validatedHandlers = validateEventHandlerIndices(eventHandlerIndices);
    if (validatedHandlers.length > 0) {
      semanticNode.eventHandlers = validatedHandlers;
    }

    if (isEditableRegion) {
      semanticNode.isEditable = true;
    }
  }

  const propertyAttrs = extractPropertyAttributes(targetElement);
  if (propertyAttrs && Object.keys(propertyAttrs).length > 0) {
    semanticNode.ariaProperties = propertyAttrs;
  }

  const stateAttrs = extractStateAttributes(targetElement);
  if (stateAttrs && Object.keys(stateAttrs).length > 0) {
    semanticNode.ariaStates = stateAttrs;
  }

  const nodeName = targetElement.nodeName;
  if (nodeName && nodeName.trim()) {
    semanticNode.elementName = nodeName;
  }

  const styleData = extractRelevantStyles(targetElement);
  if (styleData && Object.keys(styleData).length > 0) {
    semanticNode.computedStyles = styleData;
  }

  if (isInvisible(targetElement)) {
    semanticNode.isInvisible = true;
  }

  // Get preserved attributes
  // Also includes rtrvr-listeners string
  const preservedAttrs = extractPreservedAttributes(targetElement, semanticRole);
  if (preservedAttrs && Object.keys(preservedAttrs).length > 0) {
    semanticNode.preservedAttributes = preservedAttrs;
  }

  // Additional properties
  if ((targetElement as HTMLElement).draggable) {
    semanticNode.isDraggable = true;
  }

  // Swipe detection
  if (targetElement.scrollWidth && targetElement.clientWidth && targetElement.scrollWidth > targetElement.clientWidth) {
    semanticNode.supportsHorizontalSwipe = true;
  }
  if (
    targetElement.scrollHeight &&
    targetElement.clientHeight &&
    targetElement.scrollHeight > targetElement.clientHeight
  ) {
    semanticNode.supportsVerticalSwipe = true;
  }

  // Class-based enhancements
  const classAttr = targetElement.getAttribute('class');
  if (classAttr?.trim()) {
    if (classAttr.includes('handle')) {
      semanticNode.isDragHandle = true;
    }

    if (!semanticNode.supportsHorizontalSwipe) {
      if (classAttr.includes('horizontal') || classAttr.includes('carousel')) {
        semanticNode.supportsHorizontalSwipe = true;
      }
    }
    if (!semanticNode.supportsVerticalSwipe) {
      if (classAttr.includes('vertical') || classAttr.includes('feed')) {
        semanticNode.supportsVerticalSwipe = true;
      }
    }
    if (classAttr.includes('dismissible')) {
      semanticNode.supportsDismissSwipe = true;
    }

    if (classAttr.includes('long-press') || classAttr.includes('hold') || classAttr.includes('press-hold')) {
      semanticNode.supportsLongPress = true;
    }

    // Button type inference
    const buttonType = semanticNode.inputType || semanticNode.preservedAttributes?.[PreservedAttribute['type']];
    if (!(buttonType === 'submit' || buttonType === 'reset' || buttonType === 'clear')) {
      if (classAttr.includes('submit')) {
        semanticNode.preservedAttributes = {
          ...(semanticNode.preservedAttributes || {}),
          ...{ [PreservedAttribute['type']]: 'submit' },
        };
      }
      if (classAttr.includes('clear')) {
        semanticNode.preservedAttributes = {
          ...(semanticNode.preservedAttributes || {}),
          ...{ [PreservedAttribute['type']]: 'clear' },
        };
      }
      if (classAttr.includes('reset')) {
        semanticNode.preservedAttributes = {
          ...(semanticNode.preservedAttributes || {}),
          ...{ [PreservedAttribute['type']]: 'reset' },
        };
      }
    }
  }

  // Referenced elements
  const labelledByRefs = extractLabelledByReferences({ element: targetElement as HTMLElement });
  if (labelledByRefs && labelledByRefs.length > 0) {
    semanticNode.labelReferences = labelledByRefs;
  }

  const elTagName = targetElement.tagName;
  if (elTagName) {
    semanticNode.elementTag = elTagName;
  }

  if (checkIfFocused(targetElement)) {
    semanticNode.hasFocus = true;
  }

  // Process children if not iframe
  if (!isFrameNode) {
    const childNodes = buildChildNodes({
      element: targetElement as HTMLElement,
      semanticRole,
      parentDisabled: currentNodeDisabled,
      excludeLabels,
    });
    if (childNodes && childNodes.length > 0) {
      semanticNode.childElements = childNodes;
    }
  }

  const ariaOwnedChildren = extractAriaOwnedChildren({ element: targetElement });
  if (ariaOwnedChildren && ariaOwnedChildren.length > 0) {
    semanticNode.ownedElements = ariaOwnedChildren;
  }

  // URLs and resources
  const locator = getResourceLocator(targetElement);
  if (locator) {
    semanticNode.resourceLocator = locator;
  }

  if (isFrameNode || isFrameElement(targetElement)) {
    semanticNode.isFrameElement = true;
  }
  if (frameContentNodes && frameContentNodes.length > 0) {
    semanticNode.frameContent = frameContentNodes;
  }

  // Input-specific properties
  const type = (targetElement as HTMLInputElement).type;
  if (type && typeof type === 'string' && type.trim()) {
    semanticNode.inputType = type;
  }
  const placeholder = (targetElement as HTMLInputElement).placeholder;
  if (placeholder && typeof placeholder === 'string' && placeholder.trim()) {
    semanticNode.placeholderText = placeholder;
  }
  const value = (targetElement as HTMLInputElement).value;
  if (value && typeof value === 'string' && value.trim()) {
    semanticNode.elementValue = value;
  }

  // Select element options
  const selectOptions = extractSelectOptions({ element: targetElement as HTMLElement, parentDisabled, semanticRole });
  if (selectOptions && selectOptions.length > 0) {
    semanticNode.selectedOptions = selectOptions;
  }

  const nearestSelectList = !!findClosestAncestor(targetElement as HTMLElement, 'select,datalist');
  if (nearestSelectList) {
    semanticNode.nearestSelectList = true;
  }

  // Namespace detection
  if (isHTMLNode(targetElement)) {
    semanticNode.elementNamespace = ElementNamespace.HTML;
  } else if (isSVGNode(targetElement)) {
    semanticNode.elementNamespace = ElementNamespace.SVG;
    semanticNode.svgStructure = extractSVGStructure(targetElement);
    const svgAttrs = extractSVGAttributes(targetElement);
    if (svgAttrs && Object.keys(svgAttrs).length > 0) {
      if (semanticNode.preservedAttributes) {
        semanticNode.preservedAttributes = { ...semanticNode.preservedAttributes, ...svgAttrs };
      } else {
        semanticNode.preservedAttributes = svgAttrs;
      }
    }
  }

  // Label elements
  const labelElements = !excludeLabels ? extractLabelElements({ element: targetElement as HTMLElement }) : undefined;
  if (labelElements && labelElements.length > 0) {
    semanticNode.associatedLabels = labelElements;
  }

  // Table-specific
  const scope = (targetElement as HTMLTableHeaderCellElement).scope;
  if (scope && typeof scope === 'string' && scope.trim()) {
    semanticNode.tableScope = scope;
  }

  const captionElement = extractTableCaption({ element: targetElement as HTMLElement });
  if (captionElement) {
    semanticNode.tableCaption = captionElement;
  }

  const figureCaptionElement = extractFigureCaption({ element: targetElement as HTMLElement });
  if (figureCaptionElement) {
    semanticNode.figureCaption = figureCaptionElement;
  }

  const legendElement = extractFieldsetLegend({ element: targetElement as HTMLElement });
  if (legendElement) {
    semanticNode.fieldsetLegend = legendElement;
  }

  const nearestTable = !!findClosestAncestor(targetElement as HTMLElement, 'table');
  if (nearestTable) {
    semanticNode.nearestTable = true;
  }

  return semanticNode;
}

// Helper functions for attribute extraction
function extractPreservedAttributes(element: Element, role?: SemanticRole | null): Record<number, string | null> {
  const preserved: Record<number, string | null> = {};

  // Special handling for preserved attributes
  const PRESERVED_SET = new Set(Object.values(PreservedAttribute).filter(v => typeof v === 'string'));
  const PRESERVE_EMPTY_SET = new Set(Object.keys(PreservedAttributeCheck).filter(k => isNaN(Number(k))));
  const WILDCARD_ATTRS = new Set(['_ngcontent', 'ng-reflect-*', 'data-v-*']);

  const attrs = element?.attributes ? Array.from(element.attributes) : [];
  for (const attr of attrs) {
    const attrName = attr.name;
    const attrValue = attr.value;

    // Skip ID unless interactive
    if (attrName === 'id' && (!role || !INTERACTIVE_SEMANTIC_ROLES.has(role))) {
      continue;
    }

    let enumKey: string | undefined;

    if (PRESERVED_SET.has(attrName)) {
      enumKey = attrName;
    } else if (attrName.startsWith('data-v-')) {
      enumKey = 'data-v-*';
    } else if (attrName.startsWith('ng-reflect-')) {
      enumKey = 'ng-reflect-*';
    } else if (attrName.startsWith('_ngcontent')) {
      enumKey = '_ngcontent';
    }

    if (enumKey) {
      const hasValidValue = attrValue.trim() !== '';
      const preserveEmpty = PRESERVE_EMPTY_SET.has(enumKey);

      if (hasValidValue || preserveEmpty) {
        const enumValue = PreservedAttribute[enumKey as keyof typeof PreservedAttribute];
        const valueToStore = WILDCARD_ATTRS.has(enumKey) ? 'true' : attrValue;
        preserved[enumValue] = valueToStore;
      }
    }
  }

  // If we didn't mutate the DOM, the label may only exist in memory.
  if (!preserved[PreservedAttribute[INTERACTIVE_LABEL_ATTR]]) {
    const label = getAnnotationLabelForElement(element);
    if (label) {
      preserved[PreservedAttribute[INTERACTIVE_LABEL_ATTR]] = label;
    }
  }

  return preserved;
}

function extractPropertyAttributes(element: Element): Record<AriaPropertyAttribute, string | null> {
  return extractAttributes(
    element,
    AriaPropertyAttribute as unknown as Record<string, AriaPropertyAttribute>,
    PropertyAttributeCheck,
  );
}

function extractStateAttributes(element: Element): Record<AriaStateAttribute, string | null> {
  return extractAttributes(element, AriaStateAttribute as unknown as Record<string, AriaStateAttribute>, null);
}

function extractAttributes<
  T extends AriaStateAttribute | AriaPropertyAttribute,
  CheckPresenceEnum extends Record<string, unknown> | null,
>(element: Element, attributeEnum: Record<string, T>, checkPresenceEnum: CheckPresenceEnum): Record<T, string | null> {
  const result = {} as Record<T, string | null>;

  for (const key in attributeEnum) {
    if (isNaN(Number(key))) {
      const enumKey = attributeEnum[key];
      const attributeString = key.toLowerCase().replace(/_/g, '-');
      const ariaAttribute = `aria-${attributeString}`;
      const attrValue = element.getAttribute(ariaAttribute);

      let shouldCheckPresence = false;
      if (checkPresenceEnum !== null) {
        const presenceValues = Object.values(checkPresenceEnum).filter((v): v is T => typeof v === 'number');
        shouldCheckPresence = presenceValues.includes(enumKey);
      }
      if (element.hasAttribute(ariaAttribute) && shouldCheckPresence) {
        result[enumKey] = attrValue;
      } else if (attrValue?.trim()) {
        result[enumKey] = attrValue;
      } else if (ariaAttribute === 'aria-level' && HEADING_ELEMENTS.includes(element.tagName.toLowerCase()?.trim())) {
        result[enumKey] = element.tagName.substring(1);
      }
    }
  }
  return result;
}

// Utility functions
export function isElementNode(node: Node): node is Element {
  return isObjectNode(node) && node.nodeType === DOMNodeCategory.ELEMENT;
}

export function isTextualNode(node: Node): boolean {
  return node.nodeType === DOMNodeCategory.TEXT;
}

export function isObjectNode(input: Node): boolean {
  const type = typeof input;
  return (type == 'object' && input != null) || type == 'function';
}

export function isHTMLNode(node: Node): node is HTMLElement {
  return isElementNode(node) && (!node.namespaceURI || node.namespaceURI === HTML_NAMESPACE_URI);
}

export function isSVGNode(node: Node): node is SVGElement {
  return isElementNode(node) && node.namespaceURI === SVG_NAMESPACE_URI;
}

export function isFrameElement(el: Element): boolean {
  return el.tagName === 'IFRAME';
}

export function hasElementTag(el: SemanticNode | Element, name: string): boolean {
  if ('tagName' in el) {
    return el.tagName?.toLowerCase() === name;
  }
  return el.elementTag?.toLowerCase() === name;
}

export function findClosestAncestor(element: HTMLElement, selector: string): HTMLElement | null {
  if (element.closest) {
    return element.closest(selector);
  }
  while (!matchesSelector(element, selector)) {
    if (element.parentElement === null) {
      return null;
    }
    element = element.parentElement;
  }
  return element;
}

export function matchesSelector(element: Element, selector: string): boolean {
  return (
    element.matches?.(selector) ??
    (element as any).msMatchesSelector?.(selector) ??
    element.webkitMatchesSelector(selector)
  );
}

// Additional helper functions
function checkIfFocused(element: Element): boolean {
  const ownerDocument = element.ownerDocument;
  let currentFocus: Element | null = ownerDocument?.hasFocus() ? ownerDocument.activeElement : null;
  if (currentFocus) {
    const activeId = currentFocus.getAttribute('aria-activedescendant');
    if (activeId) {
      currentFocus = ownerDocument.getElementById(activeId) || currentFocus;
    }
  }
  return element === currentFocus;
}

function extractSVGStructure(svg: SVGElement): SemanticNode['svgStructure'] {
  const svgStructure: Record<SvgStructureAttribute, any> = {} as Record<SvgStructureAttribute, any>;

  // Get text content
  const textKey = SvgStructureAttribute['text'];
  const elTextKey = SvgStructureAttribute['elText'];

  if (svg.textContent?.trim()) {
    svgStructure[textKey] = svg.textContent;
  }

  // Check SVG title element
  const svgTitleEl = svg.querySelector('title');
  const svgImgEl = svg.querySelector('img');
  if (svgTitleEl?.textContent?.trim()) {
    svgStructure[elTextKey] = svgTitleEl.textContent;
  } else if (svgImgEl?.alt?.trim()) {
    svgStructure[elTextKey] = svgImgEl.alt;
  }

  // Get viewBox
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) svgStructure[SvgStructureAttribute['viewBox']] = viewBox;

  // Count path elements
  const paths = svg.querySelectorAll('path');
  if (paths.length > 0) {
    svgStructure[SvgStructureAttribute['paths']] = paths.length;
    svgStructure[SvgStructureAttribute['pathData']] = Array.from(paths)
      .slice(0, 3)
      .map(p => p.getAttribute('d'))
      .filter(Boolean)
      .map(d => d!.substring(0, 100));
  }

  // Count shape elements
  const shapes = {
    circles: svg.querySelectorAll('circle').length,
    rects: svg.querySelectorAll('rect').length,
    lines: svg.querySelectorAll('line').length,
    polygons: svg.querySelectorAll('polygon').length,
    polylines: svg.querySelectorAll('polyline').length,
    ellipses: svg.querySelectorAll('ellipse').length,
  };

  type ShapeKey = keyof typeof shapes;

  Object.entries(shapes).forEach(([key, count]) => {
    if (count > 0) {
      const enumKey = SvgStructureAttribute[key as ShapeKey];
      svgStructure[enumKey] = count;
    }
  });

  return Object.keys(svgStructure).length > 0 ? svgStructure : undefined;
}

function extractSVGAttributes(svg: SVGElement): Record<number, string | null> {
  const svgPreservedAttributes: Record<number, string | null> = {};

  if (!svg?.hasAttributes()) return svgPreservedAttributes;

  for (const attributeEnumValue of Object.values(SvgPreservedAttribute).filter(v => typeof v === 'number')) {
    const attributeEnumKey = SvgPreservedAttribute[attributeEnumValue as number];
    if (attributeEnumKey) {
      const attrName = attributeEnumKey;

      if (SvgPreservedAttribute.hasOwnProperty(attrName) && svg.hasAttribute(attrName)) {
        const attrValue = svg.getAttribute(attrName);

        if (attrValue?.trim()) {
          svgPreservedAttributes[attributeEnumValue as number] = attrValue;
        }
      }
    }
  }

  return svgPreservedAttributes;
}

// NEW: build semantic subtree for iframe contents without calling extractSemanticTree
function buildFrameContentNodes({
  frameElement,
  parentDisabled,
  excludeLabels,
}: {
  frameElement: HTMLIFrameElement;
  parentDisabled?: boolean;
  excludeLabels?: boolean;
}): number[] {
  if (!CURRENT_TREE_OPTS.includeFrameContents) return [];

  let frameBody: HTMLElement | null | undefined = null;

  try {
    // Same-origin only; cross-origin will throw
    frameBody = frameElement.contentWindow?.document?.body || null;
  } catch {
    // Cross-origin iframe – we can't inspect its DOM
    return [];
  }

  if (!frameBody) {
    return [];
  }

  const nodes: number[] = [];

  for (const child of getComposedChildNodes(frameBody)) {
    if (isSpecialReportElement(child) || shouldExcludeElement(child)) {
      continue;
    }

    if (isElementNode(child)) {
      const childElement = child as HTMLElement;
      const childRole = determineSemanticRole(childElement);
      const context = analyzeElementContext(childElement, childRole);

      const { shouldCreate, shouldAnnotate } = requiresNodeCreation(context);

      if (shouldCreate) {
        if (shouldAnnotate) {
          annotateSemanticNode(childElement);
        }

        const nodeId = getOrCreateSemanticNode({
          targetElement: childElement,
          parentDisabled,
          semanticRole: childRole ?? undefined,
          excludeLabels,
          elementContext: context,
        });

        if (nodeId) {
          nodes.push(nodeId);
        }
      } else {
        // Still walk through structural containers so nothing is skipped
        const grandchildren = buildChildNodes({
          element: childElement,
          semanticRole: childRole ?? undefined,
          parentDisabled,
          excludeLabels,
        });
        nodes.push(...grandchildren);
      }
    } else if (isTextualNode(child as ChildNode)) {
      const textId = getOrCreateTextualNode(child as Text);
      if (textId) {
        nodes.push(textId);
      }
    }
  }

  return nodes;
}

function getComposedChildNodes(element: Element): ChildNode[] {
  if (isRoverWidgetHost(element)) {
    return [];
  }

  // Slot: traverse assigned nodes (composed tree)
  const winEl = winOf(element);
  if (isHTMLSlotElementX(element, winEl)) {
    try {
      const assigned = element.assignedNodes({ flatten: true });
      if (assigned && assigned.length) return assigned as ChildNode[];
    } catch {}
    return Array.from(element.childNodes);
  }

  // Host with open shadow root: traverse shadow root + unassigned light DOM
  try {
    const sr =
      ((element as any).shadowRoot as ShadowRoot | null) ||
      getSignalProvider()?.getShadowRoot?.(element) ||
      null;
    if (sr) {
      const shadowKids = Array.from(sr.childNodes);
      const lightUnassigned = Array.from(element.childNodes).filter(n => !(n as any).assignedSlot);
      return shadowKids.concat(lightUnassigned);
    }
  } catch {}

  return Array.from(element.childNodes);
}

// Child node processing
export function buildChildNodes({
  element,
  semanticRole,
  parentDisabled,
  excludeLabels,
}: {
  element: HTMLElement;
  semanticRole?: SemanticRole | null;
  parentDisabled?: boolean;
  excludeLabels?: boolean;
}): number[] {
  const children: number[] = [];

  for (const child of getComposedChildNodes(element)) {
    if (isSpecialReportElement(child) || shouldExcludeElement(child)) {
      continue;
    } else if (isElementNode(child)) {
      const childElement = child as HTMLElement;
      // Get element context
      const childRole = determineSemanticRole(childElement);
      const context = analyzeElementContext(childElement, childRole);

      // NEW: handle iframe children similar to the main run
      if (isFrameElement(childElement)) {
        // First annotate the iframe itself so elements inside can see frame context
        annotateSemanticNode(childElement);

        // Build a subtree for the iframe's document body, if accessible
        const frameContentNodes = buildFrameContentNodes({
          frameElement: childElement as HTMLIFrameElement,
          parentDisabled,
          excludeLabels,
        });

        // For frames we *always* create a node, independent of requiresNodeCreation,
        // matching the behavior in processSemanticNodes / processFrameNode.
        const nodeId = getOrCreateSemanticNode({
          targetElement: childElement,
          parentDisabled,
          semanticRole: childRole ?? undefined,
          excludeLabels,
          isFrameNode: true,
          frameContentNodes,
          elementContext: context,
        });

        if (nodeId) {
          children.push(nodeId);
        }

        // We handled this child completely, move on
        continue;
      }

      // Determine if node should be created
      const { shouldCreate, shouldAnnotate } = requiresNodeCreation(context);

      if (shouldCreate) {
        if (shouldAnnotate) annotateSemanticNode(childElement);

        const nodeId = getOrCreateSemanticNode({
          targetElement: childElement,
          parentDisabled,
          semanticRole: childRole ?? undefined,
          excludeLabels,
          elementContext: context,
        });

        if (nodeId) children.push(nodeId);
      } else {
        // Keep grandchildren consistent with extractChildElements flattening.
        const grandchildren = buildChildNodes({
          element: childElement,
          semanticRole: childRole ?? undefined,
          parentDisabled,
          excludeLabels,
        });
        children.push(...grandchildren);
      }
    } else if (isTextualNode(child as ChildNode)) {
      const textNodeId = getOrCreateTextualNode(child as Text);
      if (textNodeId) children.push(textNodeId);
    }
  }

  return children;
}

// Reference extraction functions
function extractLabelledByReferences({ element }: { element: HTMLElement }): number[] {
  const idrefs = splitIdRefs(element.getAttribute('aria-labelledby'));
  const validElems = new Set<number>();

  for (const id of idrefs) {
    const matchedElem = resolveIdRefFromOwner(element, id) as HTMLElement | null;
    if (!matchedElem || matchedElem === element) continue;

    if (matchedElem) {
      const semanticRole = determineSemanticRole(matchedElem)!;
      const nodeId = getOrCreateSemanticNode({
        targetElement: matchedElem,
        semanticRole,
        // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
        elementContext: analyzeElementContext(matchedElem, semanticRole),
      });
      validElems.add(nodeId);
    }
  }
  return Array.from(validElems);
}

function extractSelectOptions({
  element,
  parentDisabled,
  semanticRole,
}: {
  element: HTMLElement;
  parentDisabled?: boolean;
  semanticRole?: SemanticRole | null;
}): number[] {
  let selectedOptions: number[] = [];
  if (!element) return selectedOptions;

  if (semanticRole && semanticRole === 'listbox') {
    selectedOptions = Array.from(element.querySelectorAll('[role="option"][aria-selected="true"]')).map(option =>
      getOrCreateSemanticNode({
        targetElement: option as HTMLElement,
        parentDisabled,
        semanticRole: 'option',
        // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
        elementContext: analyzeElementContext(option, 'option'),
      }),
    );
  } else if (hasElementTag(element, 'select')) {
    selectedOptions = Array.from((element as HTMLSelectElement).selectedOptions).map(option =>
      getOrCreateSemanticNode({
        targetElement: option,
        parentDisabled,
        semanticRole: 'option',
        // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
        elementContext: analyzeElementContext(option, 'option'),
      }),
    );
  }
  return selectedOptions;
}

function extractLabelElements({ element }: { element: HTMLElement }): number[] | undefined {
  if (FORM_ASSOCIATED_ELEMENTS.includes(element.tagName)) {
    const doc = docOf(element);
    const allLabelElems = querySelectorAllSafe(doc, 'label') as HTMLLabelElement[];

    const validElems = new Set<number>();

    Array.from(allLabelElems)
      .filter(label => label !== element && isControlLabelledBy(label, element))
      .map(labelElement => {
        const semanticRole = determineSemanticRole(labelElement)!;
        const nodeId = getOrCreateSemanticNode({
          targetElement: labelElement,
          semanticRole,
          excludeLabels: true,
          // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
          elementContext: analyzeElementContext(labelElement, semanticRole),
        });
        validElems.add(nodeId);
      });

    return Array.from(validElems);
  }
  return undefined;
}

function isControlLabelledBy(label: HTMLLabelElement, control: HTMLElement): boolean {
  const labelControl = label.control;
  if (labelControl !== undefined) {
    return labelControl === control;
  } else {
    if (label.htmlFor !== '' && label.htmlFor === control.id) {
      return true;
    } else if (label.htmlFor === '' && label.contains(control)) {
      return true;
    } else {
      return false;
    }
  }
}

function extractTableCaption({ element }: { element: HTMLElement }): number | undefined {
  if (hasElementTag(element, 'table')) {
    const captionElement = element.querySelector('caption');
    if (captionElement && captionElement !== element) {
      const semanticRole = determineSemanticRole(captionElement)!;
      return getOrCreateSemanticNode({
        targetElement: captionElement,
        semanticRole,
        // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
        elementContext: analyzeElementContext(captionElement, semanticRole),
      });
    }
  }
  return undefined;
}

function extractFigureCaption({ element }: { element: HTMLElement }): number | undefined {
  if (hasElementTag(element, 'figure')) {
    const figCaptionElement = element.querySelector('figcaption');
    if (figCaptionElement && figCaptionElement !== element) {
      const semanticRole = determineSemanticRole(figCaptionElement)!;
      return getOrCreateSemanticNode({
        targetElement: figCaptionElement,
        semanticRole,
        // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
        elementContext: analyzeElementContext(figCaptionElement, semanticRole),
      });
    }
  }
  return undefined;
}

function extractFieldsetLegend({ element }: { element: HTMLElement }): number | undefined {
  if (hasElementTag(element, 'fieldset')) {
    const legendElement = element.querySelector('legend');
    if (legendElement && legendElement !== element) {
      const semanticRole = determineSemanticRole(legendElement)!;
      return getOrCreateSemanticNode({
        targetElement: legendElement,
        semanticRole,
        // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
        elementContext: analyzeElementContext(legendElement, semanticRole),
      });
    }
  }
  return undefined;
}

function extractAriaOwnedChildren({ element }: { element: HTMLElement }): number[] {
  const ariaOwnedElements = new Set<number>();
  const ownedElements = extractOwnedElements(element);

  for (const refNode of ownedElements) {
    const semanticRole = determineSemanticRole(refNode)!;
    const nodeId = getOrCreateSemanticNode({
      targetElement: refNode,
      semanticRole,
      // Build rich context (includes eventHandlerIndices + mainWorldRole etc)
      elementContext: analyzeElementContext(refNode, semanticRole),
    });
    ariaOwnedElements.add(nodeId);
  }
  return Array.from(ariaOwnedElements);
}

// Determine if node should be created
export function requiresNodeCreation(context: ElementProcessingContext): {
  shouldCreate: boolean;
  shouldAnnotate: boolean;
} {
  const { semanticRole, eventHandlerIndices, isEditableRegion, hasNodeWorthyHandlers, isLikelyStructuralContainer } =
    context;

  const hasAnnotatableHandlers =
    eventHandlerIndices.length > 0 && eventHandlerIndices.some(i => ANNOTATABLE_HANDLER_ENUMS.has(i));

  const hasAnyRuntimeSignal = hasNodeWorthyHandlers || isEditableRegion;

  // rule of thumb:
  // - semantic role? always allowed
  // - otherwise, don't create nodes for structural containers that just happen to have handlers
  const shouldCreate = !!semanticRole || (!isLikelyStructuralContainer && hasAnyRuntimeSignal);

  const isInteractiveSemanticRole = !!semanticRole && INTERACTIVE_SEMANTIC_ROLES.has(semanticRole);

  const shouldAnnotate = shouldCreate && (isInteractiveSemanticRole || isEditableRegion || hasAnnotatableHandlers);

  return { shouldCreate, shouldAnnotate };
}

function shouldExcludeElement(node: Node): boolean {
  if (!isElementNode(node)) {
    return false;
  }

  const element = node as Element;
  if (isRoverWidgetHost(element)) {
    return true;
  }
  const tagName = element.tagName;

  if (EXCLUDED_ELEMENT_TAGS.has(tagName)) {
    return true;
  }

  if (tagName === CODE_ELEMENT_TAG || tagName === PREFORMATTED_TAG) {
    return isCompletelyHidden(element);
  }

  return false;
}

function isCompletelyHidden(element: Element): boolean {
  const win = winOf(element);
  const getCS = (win as any)?.getComputedStyle;
  if (!getCS) return true;
  const style = getCS.call(win, element);

  if (style.display === 'none') {
    return true;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const hasClosest = typeof (element as any).closest === 'function';
    if (!(hasClosest && (element as any).closest('pre'))) {
      return true;
    }
  }

  if (rect.right < -1000 || rect.left > win.innerWidth + 1000) {
    return true;
  }

  return false;
}
