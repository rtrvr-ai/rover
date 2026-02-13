/**
 * @fileoverview Element annotation for interactive elements
 * Following ARIA authoring practices
 */

import {
  isHTMLAnchorElementX,
  isHTMLCanvasElementX,
  isHTMLIFrameElementLike,
  isHTMLImageElementX,
  isHTMLInputElementX,
  isHTMLTextAreaElementX,
  isHTMLVideoElementX,
  winOf,
} from '../utilities/dom-utilities.js';
import { INTERACTIVE_LABEL_ATTR, ARIA_HIDDEN_ATTR, TARGET_ATTR } from '../mappings/role-mappings.js';
import { CURRENT_TREE_OPTS } from '../utilities/dom-utilities.js';

export const ANNOTATION_PATTERN = / ?\[[^\]]*?=[^\]]*?\] ?/g;

function sanitizeAnnoValue(raw: any): string {
  let s = String(raw ?? '')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Never allow bracket-breaking characters inside a [key=value] segment.
  // Use entities so the string remains readable and reversible if you ever want.
  s = s.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');

  return s;
}

/**
 * Annotates elements with interactive metadata
 * @param element Target element to annotate
 * @param elementID Unique identifier for the element
 * @param frameContextLabel Optional iframe context
 */
export function annotateInteractiveElement({
  element,
  elementID,
  frameContextLabel,
}: {
  element: Element;
  elementID: number;
  frameContextLabel?: string | null;
}): string {
  const allowDomMutation = !CURRENT_TREE_OPTS.disableDomAnnotations;
  // Build annotation components
  const annotationComponents: string[] = [`[id=${elementID}]`];
  const winEl = winOf(element);

  // Add iframe marker
  if (isHTMLIFrameElementLike(element)) {
    const frameIdentifier = sanitizeAnnoValue(element.id || element.getAttribute('name') || 'unnamed');
    annotationComponents.push(`[iframe=${frameIdentifier}]`);
  }

  // Add frame context if nested
  if (frameContextLabel) {
    const safe = sanitizeAnnoValue(frameContextLabel);
    annotationComponents.push(`[iframeRoot=${safe}]`);
  }

  // Add element-specific metadata

  // Image dimensions
  if (isHTMLImageElementX(element, winEl)) {
    annotationComponents.push(`[size=${element.clientWidth}x${element.clientHeight}]`);
  }

  // Media dimensions
  if (isHTMLVideoElementX(element, winEl) || isHTMLCanvasElementX(element, winEl)) {
    annotationComponents.push(`[size=${element.clientWidth}x${element.clientHeight}]`);
  }

  // Form input annotations
  if (isHTMLInputElementX(element, winEl) || isHTMLTextAreaElementX(element, winEl)) {
    const inputAnnotations = extractInputAnnotations(element);
    annotationComponents.push(...inputAnnotations);
  }

  // State annotations

  // Hidden state handling (NO MUTATION)
  const ariaHidden = element.getAttribute(ARIA_HIDDEN_ATTR);
  if (ariaHidden === 'true') {
    annotationComponents.push('[aria-hidden=true]');
  }

  // Disabled state
  if ((element as HTMLInputElement).disabled) {
    annotationComponents.push('[disabled]');
  }

  // Ensure links open in same tab
  if (allowDomMutation && isHTMLAnchorElementX(element, winEl)) {
    element.setAttribute(TARGET_ATTR, '_self');
  }

  // Behavioral modifications

  // Ensure links open in same tab - handled in content script without mutating here
  //Bhavani consider this in future
  //   if (element instanceof HTMLAnchorElement) {
  //   const t = element.getAttribute(TARGET_ATTR);
  //   if (t) annotationComponents.push(`[target=${t}]`);
  //   const rel = element.getAttribute('rel');
  //   if (rel) annotationComponents.push(`[rel=${rel.slice(0, 60)}]`);
  // }

  // Construct and set final annotation
  const finalAnnotation = annotationComponents.join(' ');
  if (allowDomMutation) {
    element.setAttribute(INTERACTIVE_LABEL_ATTR, finalAnnotation);
  }

  return finalAnnotation;
}

// Extract input-specific annotations
function extractInputAnnotations(element: HTMLInputElement | HTMLTextAreaElement): string[] {
  const annotations: string[] = [];
  const winEl = winOf(element);
  const isHtmlInputLike = isHTMLInputElementX(element, winEl);

  // ---- TYPE ----
  if (isHtmlInputLike && element.type && element.type !== 'text') {
    annotations.push(`[type=${element.type}]`);
  }

  // ---- NAME (useful for backend & LLM) ----
  if (element.name) {
    const processedName = sanitizeAnnoValue(element.name);
    if (processedName) annotations.push(`[name=${processedName}]`);
  }

  // ---- MULTIPLE (select-like / file inputs, etc) ----
  if (isHtmlInputLike && element.multiple) {
    annotations.push('[multiple]');
  }

  // ---- STATE ATTRIBUTES (existing logic) ----

  // Checkbox/Radio state
  if (isHtmlInputLike && (element.type === 'checkbox' || element.type === 'radio')) {
    annotations.push(`[checked=${element.checked}]`);
  }

  // File input metadata
  if (isHtmlInputLike && element.type === 'file' && element.files?.length) {
    annotations.push(`[files=${element.files.length}]`);
  }

  // Number input constraints
  if (isHtmlInputLike && element.type === 'number') {
    if (element.min !== '') annotations.push(`[min=${element.min}]`);
    if (element.max !== '') annotations.push(`[max=${element.max}]`);
    if (element.step !== '' && element.step !== '1') annotations.push(`[step=${element.step}]`);
  }

  // Range input metadata
  if (isHtmlInputLike && element.type === 'range') {
    annotations.push(`[min=${element.min || '0'}]`);
    annotations.push(`[max=${element.max || '100'}]`);
    annotations.push(`[value=${element.value}]`);
  }

  // Read-only state
  if (element.readOnly) {
    annotations.push('[readonly]');
  }

  // Required state
  if (element.required) {
    annotations.push('[required]');
  }

  // Length constraints
  if (element.maxLength && element.maxLength !== -1 && element.maxLength < 524288) {
    annotations.push(`[maxlength=${element.maxLength}]`);
  }

  // Pattern validation
  if (isHtmlInputLike && element.pattern) {
    annotations.push('[pattern]');
  }

  // Autocomplete hint
  if (element.autocomplete && element.autocomplete !== 'off') {
    annotations.push(`[autocomplete=${element.autocomplete}]`);
  }

  // ---- PLACEHOLDER (NOW ALWAYS INCLUDED IF PRESENT) ----
  if (element.placeholder) {
    const processedPlaceholder = sanitizeAnnoValue(element.placeholder).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (processedPlaceholder) annotations.push(`[placeholder="${processedPlaceholder}"]`);
  }

  // ---- CURRENT VALUE (masked for password) ----
  if (element.value) {
    let v = element.value;
    if (isHtmlInputLike && element.type === 'password') {
      v = '*'.repeat(Math.min(v.length, 10));
    }
    const processedValue = sanitizeAnnoValue(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    annotations.push(`[value="${processedValue}"]`);
  }

  return annotations;
}
