/**
 * @fileoverview Core ARIA types following W3C ARIA specification
 * @see https://www.w3.org/TR/wai-aria-1.2/
 */

import {
  ARIA_ROLES_CATALOG,
  CUSTOM_SEMANTIC_ROLES,
  CustomSemanticRole,
  IMPLICIT_SEMANTIC_MAP,
} from '../mappings/role-mappings.js';

// Node type enumeration following W3C DOM specification
export enum DOMNodeCategory {
  ELEMENT = 1,
  ATTRIBUTE = 2,
  TEXT = 3,
  CDATA_SECTION = 4,
  ENTITY_REFERENCE = 5,
  ENTITY = 6,
  PROCESSING_INSTRUCTION = 7,
  COMMENT = 8,
  DOCUMENT = 9,
  DOCUMENT_TYPE = 10,
  DOCUMENT_FRAGMENT = 11,
  NOTATION = 12,
}

// Namespace enumeration for element types
export enum ElementNamespace {
  HTML = 0,
  SVG = 1,
}

// Property attributes from ARIA specification
export enum AriaPropertyAttribute {
  VALUENOW,
  VALUETEXT,
  ATOMIC,
  AUTOCOMPLETE,
  COLCOUNT,
  COLINDEX,
  COLSPAN,
  ERRORMESSAGE,
  HASPOPUP,
  LEVEL,
  LIVE,
  MULTILINE,
  MULTISELECTABLE,
  ORIENTATION,
  PLACEHOLDER,
  POSINSET,
  READONLY,
  RELEVANT,
  REQUIRED,
  ROWCOUNT,
  ROWINDEX,
  ROWSPAN,
  SETSIZE,
  SORT,
  VALUEMAX,
  VALUEMIN,
  KEYSHORTCUTS,
  ROLEDESCRIPTION,
}

// State attributes from ARIA specification
export enum AriaStateAttribute {
  BUSY,
  CHECKED,
  CURRENT,
  EXPANDED,
  INVALID,
  PRESSED,
  SELECTED,
}

// Preserved HTML/ARIA attributes for semantic analysis
export enum PreservedAttribute {
  'rtrvr-label',
  'role',
  'value',
  'alt',
  'list',
  'title',
  'aria-label',
  'aria-labelledby',
  'aria-description',
  'aria-describedby',
  'disabled',
  'href',
  'placeholder',
  'type',
  'tabindex',
  'id',
  '_ngcontent',
  'ng-reflect-*',
  'data-reactroot',
  'data-v-*',
  'required',
  'contenteditable',
  'accept', //for input type file or so
}

// Computed style properties to preserve
export enum ComputedStyleProperty {
  display = 0,
  content = 1,
  beforeDisplay = 2,
  afterDisplay = 3,
  beforeContent = 4,
  afterContent = 5,
  width = 6,
  height = 7,
  minWidth = 8,
  minHeight = 9,
  position = 10,
  top = 11,
  left = 12,
  right = 13,
  bottom = 14,
  paddingTop = 15,
  paddingRight = 16,
  paddingBottom = 17,
  paddingLeft = 18,
  marginTop = 19,
  marginRight = 20,
  marginBottom = 21,
  marginLeft = 22,
  cursor = 23,
  opacity = 24,
  visibility = 25,
  overflowX = 26,
  overflowY = 27,
  backgroundColor = 28,
  color = 29,
  borderWidth = 30,
  borderStyle = 31,
  boxShadow = 32,
  outline = 33,
}

// SVG structure attributes for semantic representation
export enum SvgStructureAttribute {
  'text',
  'elText',
  'viewBox',
  'paths',
  'pathData',
  'circles',
  'rects',
  'lines',
  'polygons',
  'polylines',
  'ellipses',
}

// Processing context for elements
export interface ElementProcessingContext {
  element: Element;
  semanticRole: SemanticRole | null;
  eventHandlerIndices: number[];
  isEditableRegion: boolean;

  // NEW: runtime hints
  hasNodeWorthyHandlers?: boolean; // any NODE_WORTHY_HANDLER_ENUMS
  isLikelyStructuralContainer?: boolean;
}

// Semantic node structure
export interface SemanticNode {
  parent?: number;
  provisionalFromParent?: boolean; // Temporary flag for parent creation
  childElements?: number[];
  semanticChildren?: number[];
  ownedElements?: number[];
  eventHandlers?: number[]; // sanitized, deduped event IDs
  textContent?: string;
  rawData?: string;
  resourceLocator?: string;
  semanticRole?: number | string; // Numeric role index OR raw role string;
  computedName?: string;
  isDisabled?: boolean;
  hasFocus?: boolean;
  isDraggable?: boolean;
  isDragHandle?: boolean;
  supportsHorizontalSwipe?: boolean;
  supportsVerticalSwipe?: boolean;
  supportsDismissSwipe?: boolean;
  supportsLongPress?: boolean;
  ariaProperties?: Record<AriaPropertyAttribute, string | null>;
  ariaStates?: Record<AriaStateAttribute, string | null>;
  computedDescription?: string;
  isFrameElement?: boolean;
  frameContent?: number[];
  nodeCategory: DOMNodeCategory;
  elementName?: string;
  elementNamespace?: ElementNamespace;
  computedStyles?: Record<number, string>;
  isInvisible?: boolean;
  isEditable?: boolean;
  preservedAttributes?: Record<number, string | null>;
  labelReferences?: number[];
  elementTag?: string;
  inputType?: string;
  placeholderText?: string;
  elementValue?: string;
  tableScope?: string;
  selectedOptions?: number[];
  svgStructure?: Record<SvgStructureAttribute, any>;
  associatedLabels?: number[];
  tableCaption?: number;
  figureCaption?: number;
  fieldsetLegend?: number;
  nearestTable?: boolean;
  nearestSelectList?: boolean;
  /**
   * If true, renderer must not merge this text node with adjacent text nodes.
   * Used for embedded-document content injection (no truncation, chunked for readability).
   */
  preventTextMerge?: boolean;

  /**
   * Optional marker for debugging / downstream logic.
   */
  syntheticKind?: 'embedded_content_text' | 'embedded_unavailable_text' | 'embedded_container';
}

// Role type definitions
export type ImplicitSemanticRole = keyof typeof IMPLICIT_SEMANTIC_MAP;
// The full semantic role universe that can be indexed
export type SemanticRole = (typeof ARIA_ROLES_CATALOG)[number] | ImplicitSemanticRole | CustomSemanticRole;
export type SemanticRoleIndex = number;

// Create runtime role mappings
const allSemanticRoles = [...ARIA_ROLES_CATALOG, ...Object.keys(IMPLICIT_SEMANTIC_MAP), ...CUSTOM_SEMANTIC_ROLES];
const uniqueSemanticRoles = [...new Set(allSemanticRoles)] as readonly string[];

export const SemanticRoleMap: { [key in SemanticRole]?: number } = {};
uniqueSemanticRoles.forEach((role, index) => {
  SemanticRoleMap[role as SemanticRole] = index;
});

export const SemanticRoleReverseMap: { [key: number]: SemanticRole } = {};
uniqueSemanticRoles.forEach((role, index) => {
  SemanticRoleReverseMap[index] = role as SemanticRole;
});

// Counter utilities for ID generation
export class SemanticNodeIdGenerator {
  private currentId: number;

  constructor(initialValue: number = 1) {
    this.currentId = initialValue;
  }

  public generateId(): number {
    const id = this.currentId;
    this.currentId++;
    return id;
  }

  public initialize(value: number = 1): void {
    this.currentId = value;
  }

  public getCurrentValue(): number {
    return this.currentId;
  }
}
