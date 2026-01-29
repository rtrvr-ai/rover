/**
 * @fileoverview ARIA role mappings based on W3C specifications
 * @see https://www.w3.org/TR/wai-aria-1.2/
 * @see https://www.w3.org/TR/html-aria/
 */

import { EventHandlerMap } from '../utilities/event-handler-mapper.js';

// Custom roles that we synthesize (e.g. from inferSemanticRole) but that are not
// part of ARIA or the implicit role map.
export const CUSTOM_SEMANTIC_ROLES = ['media'];
export const CUSTOM_SEMANTIC_ROLE_SET = new Set<string>(CUSTOM_SEMANTIC_ROLES);
export type CustomSemanticRole = (typeof CUSTOM_SEMANTIC_ROLES)[number];

// Pure ARIA roles without HTML equivalents
export const ARIA_ROLES_CATALOG = [
  'alert',
  'alertdialog',
  'application',
  'directory',
  'feed',
  'grid',
  'log',
  'marquee',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'note',
  'radiogroup',
  'scrollbar',
  'search',
  'switch',
  'tab',
  'tablist',
  'tabpanel',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
];

// Implicit semantic roles from HTML elements
export const IMPLICIT_SEMANTIC_ROLES = [
  'heading',
  'checkbox',
  'navigation',
  'row',
  'complementary',
  'table',
  'gridcell',
  'slider',
  'listitem',
  'contentinfo',
  'definition',
  'button',
  'status',
  'form',
  'article',
  'textbox',
  'radio',
  'columnheader',
  'list',
  'region',
  'document',
  'option',
  'separator',
  'link',
  'img',
  'main',
  'searchbox',
  'cell',
  'rowheader',
  'dialog',
  'listbox',
  'group',
  'term',
  'progressbar',
  'figure',
  'spinbutton',
  'math',
  'combobox',
  'banner',
  'rowgroup',
  'code', // Custom addition for code blocks
  'generic', // Generic interactive element
  'embedded_document', // for iframe
  'embedded_document_unavailable', // for iframe
];

// Combined set of all roles
export const ARIA_ROLES_SET = new Set(ARIA_ROLES_CATALOG);

// Interactive roles that typically accept user input
export const INTERACTIVE_SEMANTIC_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'figure',
  'img',
  'link',
  'listbox',
  'option',
  'radio',
  'scrollbar',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tabpanel',
  'textbox',
  'tooltip',
  'treeitem',
  'grid',
  'gridcell',
  'table',
  'cell',
  'columnheader',
  'rowheader',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tree',
  'treegrid',
  'radiogroup',
  'application',
  'dialog',
  'alertdialog',
  'alert',
  'status',
  'progressbar',
  'meter',
  'search',
  'code', // Custom interactive code elements
  'media', // ✅ synthesized audio/video controls
]);

// Structural container roles
export const STRUCTURAL_CONTAINER_ROLES = new Set([
  'group',
  'region',
  'section',
  'banner',
  'contentinfo',
  'main',
  'navigation',
  'complementary',
  'form',
  'article',
  'document',
  'presentation',
  'none',
]);

// Roles with presentational children
export const PRESENTATIONAL_CHILDREN_ROLES = [
  'button',
  'checkbox',
  'img',
  'math',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'progressbar',
  'radio',
  'scrollbar',
  'separator',
  'slider',
  'switch',
  'tab',
];

// Roles excluded from semantic tree
export const EXCLUDED_SEMANTIC_ROLES = ['none', 'presentation'];

// Mapping of HTML element conditions for implicit roles
export enum SemanticRoleCondition {
  ANCESTOR_ROLE_REQUIRED = 6,
  PROPERTY_VALUE_MATCH = 5,
  HAS_TABLE_ROW_DATA = 7,
  BOOLEAN_PROPERTY = 0,
  ATTRIBUTE_GREATER_THAN = 2,
  HAS_TABLE_COLUMN_DATA = 8,
  FORBIDDEN_ANCESTORS = 1,
  HAS_ACCESSIBLE_NAME = 4,
  ATTRIBUTE_LESS_THAN = 3,
}

// HTML tag to implicit role mapping
export const HTML_ELEMENT_SEMANTIC_MAP = {
  a: ['link'],
  area: ['link'],
  article: ['article'],
  aside: ['complementary'],
  body: ['document'],
  button: ['button'],
  datalist: ['listbox'],
  dd: ['definition'],
  details: ['group'],
  dfn: ['term'],
  dialog: ['dialog'],
  dt: ['term'],
  fieldset: ['group'],
  figure: ['figure'],
  footer: ['contentinfo'],
  form: ['form'],
  h1: ['heading'],
  h2: ['heading'],
  h3: ['heading'],
  h4: ['heading'],
  h5: ['heading'],
  h6: ['heading'],
  header: ['banner'],
  hr: ['separator'],
  img: ['img'],
  input: ['button', 'checkbox', 'combobox', 'radio', 'searchbox', 'slider', 'spinbutton', 'textbox'],
  li: ['listitem'],
  link: ['link'],
  main: ['main'],
  math: ['math'],
  menu: ['list'],
  nav: ['navigation'],
  ol: ['list'],
  optgroup: ['group'],
  option: ['option'],
  output: ['status'],
  progress: ['progressbar'],
  section: ['region'],
  select: ['combobox', 'listbox'],
  summary: ['button'],
  table: ['table'],
  tbody: ['rowgroup'],
  td: ['cell', 'gridcell'],
  textarea: ['textbox'],
  tfoot: ['rowgroup'],
  th: ['cell', 'columnheader', 'gridcell', 'rowheader'],
  thead: ['rowgroup'],
  tr: ['row'],
  ul: ['list'],
  // Custom additions
  code: ['code'],
  pre: ['code'],
};

// Implicit role definitions with conditions
export const IMPLICIT_SEMANTIC_MAP = {
  heading: {
    selector: 'h6,h1,h3,h2,h5,h4',
  },
  checkbox: {
    conditionalSelectors: [
      {
        selector: 'input',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['checkbox'],
          },
        ],
      },
    ],
  },
  navigation: {
    selector: 'nav',
  },
  row: {
    selector: 'tr',
  },
  complementary: {
    selector: 'aside',
  },
  table: {
    selector: 'table',
  },
  gridcell: {
    conditionalSelectors: [
      {
        selector: 'td',
        conditions: [
          {
            type: SemanticRoleCondition.ANCESTOR_ROLE_REQUIRED,
            tag: 'table',
            role: 'grid',
          },
        ],
      },
      {
        selector: 'td',
        conditions: [
          {
            type: SemanticRoleCondition.ANCESTOR_ROLE_REQUIRED,
            tag: 'table',
            role: 'treegrid',
          },
        ],
      },
      {
        selector: 'th:not([scope="rowgroup"]):not([scope="row"]):not([scope="colgroup"]):not([scope="col"])',
        conditions: [
          {
            type: SemanticRoleCondition.ANCESTOR_ROLE_REQUIRED,
            tag: 'table',
            role: 'treegrid',
          },
          {
            type: SemanticRoleCondition.HAS_TABLE_COLUMN_DATA,
            hasData: true,
          },
          {
            type: SemanticRoleCondition.HAS_TABLE_ROW_DATA,
            hasData: true,
          },
        ],
      },
    ],
  },
  slider: {
    conditionalSelectors: [
      {
        selector: 'input',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['range'],
          },
        ],
      },
    ],
  },
  listitem: {
    selector: 'li',
  },
  contentinfo: {
    conditionalSelectors: [
      {
        selector: 'footer',
        conditions: [
          {
            type: SemanticRoleCondition.FORBIDDEN_ANCESTORS,
            selector:
              'section,nav,main,aside,article,[role="region"],[role="navigation"],[role="main"],[role="complementary"],[role="article"]',
          },
        ],
      },
    ],
  },
  definition: {
    selector: 'dd',
  },
  button: {
    selector: 'summary,button',
    conditionalSelectors: [
      {
        selector: 'input',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['submit', 'reset', 'image', 'button'],
          },
        ],
      },
    ],
  },
  status: {
    selector: 'output',
  },
  form: {
    conditionalSelectors: [
      {
        selector: 'form',
        conditions: [
          {
            type: SemanticRoleCondition.HAS_ACCESSIBLE_NAME,
          },
        ],
      },
    ],
  },
  article: {
    selector: 'article',
  },
  textbox: {
    selector: 'textarea',
    conditionalSelectors: [
      {
        selector: 'input:not([list])',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['url', 'text', 'tel', 'email'],
          },
        ],
      },
    ],
  },
  radio: {
    conditionalSelectors: [
      {
        selector: 'input',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['radio'],
          },
        ],
      },
    ],
  },
  columnheader: {
    selector: 'th[scope="colgroup"],th[scope="col"]',
    conditionalSelectors: [
      {
        selector: 'th:not([scope="rowgroup"]):not([scope="row"]):not([scope="colgroup"]):not([scope="col"])',
        conditions: [
          {
            type: SemanticRoleCondition.HAS_TABLE_ROW_DATA,
            hasData: false,
          },
        ],
      },
    ],
  },
  list: {
    selector: 'ul,ol,menu',
  },
  region: {
    conditionalSelectors: [
      {
        selector: 'section',
        conditions: [
          {
            type: SemanticRoleCondition.HAS_ACCESSIBLE_NAME,
          },
        ],
      },
    ],
  },
  document: {
    selector: 'body',
  },
  option: {
    selector: 'select > option,select > optgroup > option,datalist > option',
  },
  separator: {
    selector: 'hr',
  },
  link: {
    selector: 'area[href],a[href],link[href]',
  },
  img: {
    selector: 'img[alt],img:not([alt])',
  },
  main: {
    selector: 'main',
  },
  searchbox: {
    conditionalSelectors: [
      {
        selector: 'input:not([list])',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['search'],
          },
        ],
      },
    ],
  },
  cell: {
    conditionalSelectors: [
      {
        selector: 'td',
        conditions: [
          {
            type: SemanticRoleCondition.ANCESTOR_ROLE_REQUIRED,
            tag: 'table',
            role: 'table',
          },
        ],
      },
      {
        selector: 'th:not([scope="rowgroup"]):not([scope="row"]):not([scope="colgroup"]):not([scope="col"])',
        conditions: [
          {
            type: SemanticRoleCondition.ANCESTOR_ROLE_REQUIRED,
            tag: 'table',
            role: 'table',
          },
          {
            type: SemanticRoleCondition.HAS_TABLE_COLUMN_DATA,
            hasData: true,
          },
          {
            type: SemanticRoleCondition.HAS_TABLE_ROW_DATA,
            hasData: true,
          },
        ],
      },
    ],
  },
  rowheader: {
    selector: 'th[scope="rowgroup"],th[scope="row"]',
    conditionalSelectors: [
      {
        selector: 'th:not([scope="rowgroup"]):not([scope="row"]):not([scope="colgroup"]):not([scope="col"])',
        conditions: [
          {
            type: SemanticRoleCondition.HAS_TABLE_COLUMN_DATA,
            hasData: false,
          },
          {
            type: SemanticRoleCondition.HAS_TABLE_ROW_DATA,
            hasData: true,
          },
        ],
      },
    ],
  },
  dialog: {
    selector: 'dialog',
  },
  listbox: {
    selector: 'select[multiple],datalist',
    conditionalSelectors: [
      {
        selector: 'select',
        conditions: [
          {
            type: SemanticRoleCondition.ATTRIBUTE_GREATER_THAN,
            attribute: 'size',
            value: 1,
          },
        ],
      },
    ],
  },
  group: {
    selector: 'optgroup,fieldset,details',
  },
  term: {
    selector: 'dt,dfn',
  },
  progressbar: {
    selector: 'progress',
  },
  figure: {
    selector: 'figure',
  },
  spinbutton: {
    conditionalSelectors: [
      {
        selector: 'input',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['number'],
          },
        ],
      },
    ],
  },
  math: {
    selector: 'math',
  },
  combobox: {
    selector: 'select:not([size]):not([multiple])',
    conditionalSelectors: [
      {
        selector: 'select:not([multiple])',
        conditions: [
          {
            type: SemanticRoleCondition.ATTRIBUTE_LESS_THAN,
            attribute: 'size',
            value: 2,
          },
        ],
      },
      {
        selector: 'input[list]',
        conditions: [
          {
            type: SemanticRoleCondition.PROPERTY_VALUE_MATCH,
            property: 'type',
            values: ['url', 'text', 'tel', 'search', 'email'],
          },
        ],
      },
    ],
  },
  banner: {
    conditionalSelectors: [
      {
        selector: 'header',
        conditions: [
          {
            type: SemanticRoleCondition.FORBIDDEN_ANCESTORS,
            selector:
              '[role="region"],[role="navigation"],[role="main"],[role="complementary"],[role="article"],section,nav,main,aside,article',
          },
        ],
      },
    ],
  },
  rowgroup: {
    selector: 'thead,tfoot,tbody',
  },
  code: {
    selector: 'code,pre',
  },
};

// Listener attribute name (preserved from original)
//<id>~<mask36>,<id>~<mask36>,...
export const RTRVR_LISTENER_ATTRIBUTE = 'rtrvr-ls';
export const RTRVR_ROLE_ATTRIBUTE = 'rtrvr-ro';
export const RTRVR_MAIN_WORLD_READY_ATTRIBUTE = 'rtrvr-mw-ready';
export const RTRVR_MAIN_WORLD_BUSY_ATTRIBUTE = 'rtrvr-mw-busy';
export const RTRVR_MAIN_WORLD_ACTIONS_READY_ATTRIBUTE = 'rtrvr-mwa-ready';

// Roles that support name from content
export const NAME_FROM_CONTENT_ROLES = new Set([
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'gridcell',
  'heading',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'row',
  'rowgroup',
  'rowheader',
  'switch',
  'tab',
  'tooltip',
  'tree',
  'treeitem',
  'sectionhead',
  'definition',
  'term',
  'deletion',
  'insertion',
]);

// Form-associated element tags
export const FORM_ASSOCIATED_ELEMENTS = ['BUTTON', 'INPUT', 'METER', 'OUTPUT', 'PROGRESS', 'SELECT', 'TEXTAREA'];

// HTML heading elements
export const HEADING_ELEMENTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

// Standard namespaces
export const HTML_NAMESPACE_URI = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE_URI = 'http://www.w3.org/2000/svg';

// Interactive label attribute (preserved from original)
export const INTERACTIVE_LABEL_ATTR = 'rtrvr-label';

// Label ID extraction pattern
export const LABEL_ID_PATTERN = /\[id=(\d+)\]/;

// Selectors for exclusion
export const EXCLUDED_ELEMENT_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'META']);
export const CODE_ELEMENT_TAG = 'CODE';
export const PREFORMATTED_TAG = 'PRE';

// Attribute names
export const ARIA_HIDDEN_ATTR = 'aria-hidden';
export const TARGET_ATTR = 'target';

// Processing limits
export const MAX_TRAVERSAL_DEPTH = 10;

// Preserved attribute checking
export enum PreservedAttributeCheck {
  'value',
  'alt',
  'list',
  'title',
}

export enum SvgPreservedAttribute {
  'data-icon' = 13,
  'data-name' = 14,
  'data-tooltip' = 15,
  'data-label' = 16,
}

export enum PropertyAttributeCheck {
  VALUENOW,
  VALUETEXT,
}

// handlers that justify *node creation* even without a semantic role
export const NODE_WORTHY_HANDLER_ENUMS = new Set<number>([
  // primary click-ish gestures
  EventHandlerMap.click,
  EventHandlerMap.dblclick,
  EventHandlerMap.doubleclick,
  EventHandlerMap.contextmenu,
  EventHandlerMap.auxclick,

  EventHandlerMap.pointerdown,
  EventHandlerMap.pointerup,
  EventHandlerMap.mousedown,
  EventHandlerMap.mouseup,
  EventHandlerMap.touchstart,
  EventHandlerMap.touchend,

  // keyboard + text entry
  EventHandlerMap.keydown,
  EventHandlerMap.keyup,
  EventHandlerMap.input,
  EventHandlerMap.beforeinput,
  EventHandlerMap.change,
  EventHandlerMap.submit,
  EventHandlerMap.reset,
  EventHandlerMap.paste,

  // explicit drag gestures
  EventHandlerMap.dragstart,
  EventHandlerMap.dragend,
  EventHandlerMap.drop,
]);

// handlers that still get an interactive annotation id
// (useful for hover tooling, scroll inspection, etc)
export const ANNOTATABLE_HANDLER_ENUMS = new Set<number>([
  ...NODE_WORTHY_HANDLER_ENUMS,

  // "weak" signals – don’t create nodes just for these
  EventHandlerMap.scroll,
  EventHandlerMap.wheel,
  EventHandlerMap.mouseenter,
  EventHandlerMap.mouseover,
  EventHandlerMap.focus,
  EventHandlerMap.blur,
  EventHandlerMap.focusin,
  EventHandlerMap.focusout,
]);

export const CLICK_EQUIVALENTS = new Set<string>([
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
]);

export const INPUT_EQUIVALENTS = new Set<string>([
  'input',
  'change',
  'beforeinput',
  'keydown',
  'keyup',
  'keypress',
  'paste',
  'compositionstart',
  'compositionend',
]);

export const DRAG_EQUIVALENTS = new Set<string>([
  'drag',
  'dragstart',
  'dragend',
  'dragenter',
  'dragleave',
  'dragover',
  'drop',
]);
