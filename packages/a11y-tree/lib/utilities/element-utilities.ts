// utilities/element-utilities.ts
import { getEventHandlerIdsForElement } from './event-handler-mapper.js';
import {
  NODE_WORTHY_HANDLER_ENUMS,
  PRESENTATIONAL_CHILDREN_ROLES,
  RTRVR_ROLE_ATTRIBUTE,
  STRUCTURAL_CONTAINER_ROLES,
} from '../mappings/role-mappings.js';
import { SemanticRoleReverseMap, type ElementProcessingContext, type SemanticRole } from '../types/aria-types.js';
import { getSignalProvider, isHTMLInputElementX, isHTMLLIElementX, isHTMLTextAreaElementX, winOf } from './dom-utilities.js';

export function getMainWorldRole(element: Element): SemanticRole | null {
  const provider = getSignalProvider();
  if (provider?.getRoleHint) {
    try {
      const hinted = provider.getRoleHint(element);
      if (hinted) return hinted as SemanticRole;
    } catch {
      // ignore
    }
  }
  const raw = element.getAttribute(RTRVR_ROLE_ATTRIBUTE);
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // New: explicit "string role" marker
  if (trimmed.startsWith('s:')) {
    return trimmed.slice(2) as SemanticRole;
  }

  // New format: plain decimal enum index
  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed);
    if (Number.isFinite(idx)) {
      const role = SemanticRoleReverseMap[idx];
      if (role) return role;
    }
  }

  // Fallback: treat as a direct role string
  return trimmed as SemanticRole;
}

// Validate and clean event handler indices
export function validateEventHandlerIndices(indices: number[]): number[] {
  // Remove duplicates
  const uniqueIndices = Array.from(new Set(indices));

  // Filter invalid values if any
  return uniqueIndices;
}

// Merge event handler indices when updating nodes
export function mergeEventHandlerIndices(existing: number[] | undefined, newIndices: number[]): number[] {
  if (!existing || existing.length === 0) {
    return validateEventHandlerIndices(newIndices);
  }

  const merged = new Set([...existing, ...newIndices]);
  return validateEventHandlerIndices(Array.from(merged));
}

export function analyzeElementContext(element: Element, role: SemanticRole | null): ElementProcessingContext {
  const provider = getSignalProvider();
  const eventHandlerIndices =
    provider?.getEventHandlerIds?.(element) ?? getEventHandlerIdsForElement(element);

  const hasNodeWorthyHandlers =
    eventHandlerIndices.length > 0 && eventHandlerIndices.some(i => NODE_WORTHY_HANDLER_ENUMS.has(i));

  const isEditableRegion = canUserEdit(element);
  const structural = role ? STRUCTURAL_CONTAINER_ROLES.has(role) : false; // your existing heuristic

  return {
    element,
    semanticRole: role,
    eventHandlerIndices,
    isEditableRegion,
    hasNodeWorthyHandlers,
    isLikelyStructuralContainer: structural,
  };
}

export function presentationalChildrenExist(element: Element, computedRole: SemanticRole | null): boolean {
  if (!computedRole) return false;

  const winEl = winOf(element);
  if (isHTMLLIElementX(element, winEl)) {
    return false;
  }
  return PRESENTATIONAL_CHILDREN_ROLES.includes(computedRole);
}

const EDITABLE_TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'password',
  'email',
  'number',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
  'color',
]);

function isElementVisibleAndInteractable(el: Element): boolean {
  const win = winOf(el);
  const style = win.getComputedStyle(el);

  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.pointerEvents === 'none'
    // can programmatically edit even if opacity is 0
    // optionally keep this; comment it so the intent is explicit
    // || style.opacity === "0"
  ) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  return true;
}

function isTextEntryInput(el: Element): el is HTMLInputElement {
  const winEl = winOf(el);
  if (!isHTMLInputElementX(el, winEl)) return false;

  const type = (el.type || 'text').toLowerCase();
  if (!EDITABLE_TEXT_INPUT_TYPES.has(type)) return false;

  return !el.disabled && !el.readOnly;
}

function isEditableTextarea(el: Element): el is HTMLTextAreaElement {
  const winEl = winOf(el);
  return isHTMLTextAreaElementX(el, winEl) && !el.disabled && !el.readOnly;
}

function isEditableContentEditable(el: Element): el is HTMLElement {
  const he = el as HTMLElement;
  if (!he.isContentEditable) return false;

  if (he.getAttribute('aria-readonly') === 'true') return false;
  if (he.getAttribute('aria-disabled') === 'true') return false;

  return true;
}

export function canUserEdit(el: Element | null | undefined): boolean {
  if (!el) return false;
  if (!isElementVisibleAndInteractable(el)) return false;

  if (isTextEntryInput(el)) return true;
  if (isEditableTextarea(el)) return true;
  if (isEditableContentEditable(el)) return true;

  // If you want <select> to count as “editable”, add:
  // select value can be changed but can't be typed into
  // if (el instanceof HTMLSelectElement && !el.disabled) return true;

  return false;
}

/**
 * Extract the *element's own* [id=123] from rtrvr-label safely.
 * This avoids false matches when the label also embeds iframeRoot=[id=...].
 */
export function extractPrimaryInteractiveIdFromLabel(lbl: string): number | null {
  if (!lbl) return null;

  // Strong fast path: your annotateInteractiveElement SHOULD put the element id first.
  // If it does, this is perfect and O(1).
  const anchored = lbl.match(/^\s*\[id=(\d+)\]/);
  if (anchored?.[1]) {
    const n = parseInt(anchored[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  // Fallback: scan all [id=...] occurrences, prefer the first one that is NOT
  // part of "iframeRoot=[id=...]".
  const re = /\[id=(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lbl))) {
    const idx = m.index ?? 0;
    const before = lbl.slice(Math.max(0, idx - 30), idx);

    // Heuristic exclusion: if immediately preceded by iframeRoot=, skip it.
    // (Covers common formats: "iframeRoot=[id=...]" or "iframeRoot = [id=...]")
    if (/iframeRoot\s*=\s*$/.test(before) || before.includes('iframeRoot=')) continue;

    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return n;
  }

  // Last resort: keep old behavior if you have LABEL_ID_PATTERN.
  // NOTE: this may still be wrong if LABEL_ID_PATTERN can match iframeRoot ids first.
  try {
    // @ts-ignore - if LABEL_ID_PATTERN exists in this module
    const legacy = lbl.match(LABEL_ID_PATTERN);
    if (legacy?.[1]) {
      const n = parseInt(legacy[1], 10);
      return Number.isFinite(n) ? n : null;
    }
  } catch {
    // ignore
  }

  return null;
}
