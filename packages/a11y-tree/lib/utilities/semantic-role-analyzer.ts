// utilities/semantic-role-analyzer.ts
/**
 * @fileoverview Semantic role determination following W3C ARIA specifications
 */

import { matchesSelector, findClosestAncestor } from './element-analysis.js';
import { getEventHandlerIdsForElement, getEventHandlerTypesForElement } from './event-handler-mapper.js';
import { inspectTableRow, inspectTableColumn } from './table-analyzer.js';
import {
  ARIA_ROLES_SET,
  HTML_ELEMENT_SEMANTIC_MAP,
  EXCLUDED_SEMANTIC_ROLES,
  SemanticRoleCondition,
  IMPLICIT_SEMANTIC_MAP,
  CODE_ELEMENT_TAG,
  PREFORMATTED_TAG,
  CustomSemanticRole,
  CUSTOM_SEMANTIC_ROLE_SET,
} from '../mappings/role-mappings.js';
import type { SemanticRole } from '../types/aria-types.js';
import { getMainWorldRole } from './element-utilities.js';
import {
  cssEscapeSafe,
  docOf,
  getElementByIdSafe,
  isShadowRootLike,
  querySelectorSafe,
  winOf,
} from './dom-utilities.js';

export function determineSemanticRole(element: Element): SemanticRole | null {
  const tagNameLower = element.tagName?.toLowerCase();

  // Special handling for code elements
  if (tagNameLower === 'code' || tagNameLower === 'pre') {
    const codeRole = analyzeCodeElement(element);
    if (codeRole) {
      return codeRole as SemanticRole;
    }
  }

  const computedRole = calculateRole(element as HTMLElement);

  // Handle special cases when computedRole is null
  if (computedRole === null) {
    if (tagNameLower === 'dl') {
      return 'list';
    }

    if (tagNameLower === 'form') {
      return 'form';
    }

    if (tagNameLower === 'header') {
      return 'banner';
    }

    if (tagNameLower === 'footer') {
      return 'contentinfo';
    }

    if (tagNameLower === 'option') {
      return 'option';
    }

    // Input handling
    if (tagNameLower === 'textarea') {
      return 'textbox';
    }

    if (tagNameLower === 'input') {
      const inputElement = element as HTMLInputElement;
      const inputType = inputElement.type.toLowerCase();

      switch (inputType) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'button':
        case 'submit':
        case 'reset':
        case 'image':
          return 'button';
        case 'number':
          return 'spinbutton';
        case 'range':
          return 'slider';
        case 'hidden':
          return null;
        default:
          return inputElement.hasAttribute('list') ? 'combobox' : 'textbox';
      }
    }

    if (tagNameLower === 'select') {
      const selectElement = element as HTMLSelectElement;
      return selectElement.multiple ? 'listbox' : 'combobox';
    }

    // SVG handling
    if (tagNameLower === 'svg') {
      if (element.getAttribute('aria-hidden') === 'true') {
        return null;
      }

      const hasTitle = element.querySelector('title');
      const hasDesc = element.querySelector('desc');
      const hasAriaLabel = element.hasAttribute('aria-label');
      const hasRole = element.hasAttribute('role');

      if (hasTitle || hasDesc || hasAriaLabel || hasRole) {
        return 'img';
      }

      const eventHandlerIds = getEventHandlerIdsForElement(element);
      if (eventHandlerIds.length > 0) return 'img';

      if (element.getAttribute('tabindex') !== null) return 'img';

      return null;
    }

    // Generic elements with listeners (new format -> enums)
    const eventHandlers = getEventHandlerIdsForElement(element);
    if (eventHandlers.length > 0) {
      const tagName = element.tagName.toLowerCase();
      if (['div', 'span', 'li', 'p', 'i', 'em', 'strong', 'b'].includes(tagName)) {
        return determineInteractiveRole(element as HTMLElement);
      }
    }
  }

  if (tagNameLower === 'td' && element.getAttribute('role') === null) {
    return 'cell';
  }

  if (computedRole !== null && tagNameLower === 'th') {
    const explicitRole = element.getAttribute('role');
    if (explicitRole && isValidSemanticRole(explicitRole)) {
      return explicitRole as SemanticRole;
    }

    const tableHeader = element as HTMLTableHeaderCellElement;
    if (tableHeader.scope === 'col' || tableHeader.hasAttribute('aria-sort')) {
      return 'columnheader';
    }

    if (tableHeader.scope === 'row') {
      return 'rowheader';
    }

    return 'cell';
  }

  return computedRole;
}

export function determineInteractiveRole(element: HTMLElement): SemanticRole | null {
  // Structural suppression is gone: we *want* roles for anything with listeners.
  const role = getMainWorldRole(element);
  return role ?? null;
}

function calculateRole(element: HTMLElement): SemanticRole | null {
  const explicitRole = element.getAttribute('role');
  if (explicitRole !== null) {
    if (EXCLUDED_SEMANTIC_ROLES.includes(explicitRole)) {
      return null;
    }
    if (!isValidSemanticRole(explicitRole)) {
      return null;
    }
    return explicitRole;
  }

  const tagName = element.tagName.toLowerCase();

  const potentialRoles: SemanticRole[] = (HTML_ELEMENT_SEMANTIC_MAP as any)[tagName] ?? [];
  return potentialRoles.find(role => matchesImplicitSemanticRole(element, role)) || null;
}

function matchesImplicitSemanticRole(element: HTMLElement, role: SemanticRole): boolean {
  const implicitDefinition = (IMPLICIT_SEMANTIC_MAP as any)[role];
  const directSelector = (implicitDefinition as any)?.selector;

  if (directSelector) {
    if (matchesSelector(element, directSelector)) {
      return true;
    }
  }

  const conditionalSelectors = (implicitDefinition as any)?.conditionalSelectors;
  if (conditionalSelectors) {
    const result = (conditionalSelectors as any[]).some(selector => {
      const match =
        matchesSelector(element, selector.selector) &&
        (selector.conditions as any[]).every(condition => {
          const conditionResult = evaluateCondition(element, condition);
          return conditionResult;
        });
      return match;
    });
    return result;
  } else {
    return false;
  }
}

function resolveIdRefForAccessibleName(owner: Element, idRef: string): Element | null {
  const raw = (idRef || '').trim().replace(/^#/, '');
  if (!raw) return null;
  try {
    const root = (owner as any).getRootNode?.();
    if (isShadowRootLike(root)) {
      const win = winOf(owner);
      const sel = `#${cssEscapeSafe(win, raw)}`;
      const inShadow = querySelectorSafe(root, sel);
      if (inShadow) return inShadow;
    }
  } catch {}
  return getElementByIdSafe(docOf(owner) as any, raw);
}

function evaluateCondition(element: HTMLElement, condition: any): boolean {
  switch (condition.type) {
    case SemanticRoleCondition.ATTRIBUTE_GREATER_THAN: {
      const value = element.getAttribute(condition.attribute);
      return value !== null && Number(value) > condition.value;
    }

    case SemanticRoleCondition.ATTRIBUTE_LESS_THAN: {
      const value = element.getAttribute(condition.attribute);
      return value !== null && Number(value) < condition.value;
    }

    case SemanticRoleCondition.HAS_ACCESSIBLE_NAME: {
      if (element.hasAttribute('aria-label')) return true;
      const refs = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      return refs.some(id => resolveIdRefForAccessibleName(element, id) != null);
    }

    case SemanticRoleCondition.FORBIDDEN_ANCESTORS:
      return findClosestAncestor(element, condition.selector) === null;

    case SemanticRoleCondition.BOOLEAN_PROPERTY:
      return element[condition.property as keyof HTMLElement] === condition.value;

    case SemanticRoleCondition.PROPERTY_VALUE_MATCH: {
      return (condition.values as string[]).some(value => value === element[condition.property as keyof HTMLElement]);
    }

    case SemanticRoleCondition.ANCESTOR_ROLE_REQUIRED: {
      const parent = element.parentElement;
      if (parent === null) {
        return false;
      }
      const closestElement = findClosestAncestor(parent, condition.tag);
      return closestElement !== null && calculateRole(closestElement) === condition.role;
    }

    case SemanticRoleCondition.HAS_TABLE_COLUMN_DATA: {
      const table = findClosestAncestor(element, 'table');
      if (table === null) {
        return false;
      }
      return condition.hasData === inspectTableColumn(table as HTMLTableElement, element as HTMLTableCellElement);
    }

    case SemanticRoleCondition.HAS_TABLE_ROW_DATA: {
      const table = findClosestAncestor(element, 'table');
      if (table === null) {
        return false;
      }
      return condition.hasData === inspectTableRow(table as HTMLTableElement, element as HTMLTableCellElement);
    }

    default:
      verifyExhaustive(condition as never);
      return false;
  }
}

function verifyExhaustive(value: never) {
  throw new Error(`unexpected value ${value}!`);
}

function isValidSemanticRole(role: string): role is SemanticRole {
  return isAriaOnlyRole(role) || isImplicitRole(role) || isCustomSemanticRole(role);
}

/** true for ARIA roles, implicit roles, and our custom synthesized roles */
function isCustomSemanticRole(role: string): role is CustomSemanticRole {
  return CUSTOM_SEMANTIC_ROLE_SET.has(role);
}

function isAriaOnlyRole(role: string): role is SemanticRole {
  return ARIA_ROLES_SET.has(role as any);
}

function isImplicitRole(role: string): role is SemanticRole {
  return IMPLICIT_SEMANTIC_MAP.hasOwnProperty(role);
}

export function analyzeCodeElement(element: Element): string | null {
  if (element.tagName !== CODE_ELEMENT_TAG && element.tagName !== PREFORMATTED_TAG) {
    return null;
  }

  const eventHandlerTypes = getEventHandlerTypesForElement(element);
  if (eventHandlerTypes.some(t => t === 'click' || t === 'copy')) {
    return 'button';
  }

  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) >= 0) {
    return 'button';
  }

  if (element.tagName === PREFORMATTED_TAG || (element.tagName === CODE_ELEMENT_TAG && element.closest('pre'))) {
    return 'code';
  }

  return null;
}
