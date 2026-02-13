// utilities/style-extractor.ts
import { ComputedStyleProperty } from '../types/aria-types.js';
import { isHTMLElementLike, winOf } from './dom-utilities.js';

const STYLE_PSEUDO_MAP: { [key: number]: [before: number, after: number] } = {
  [ComputedStyleProperty.display]: [ComputedStyleProperty.beforeDisplay, ComputedStyleProperty.afterDisplay],
  [ComputedStyleProperty.content]: [ComputedStyleProperty.beforeContent, ComputedStyleProperty.afterContent],
};

const CSS_PROPERTY_CACHE = new Map<number, string>();

const PROPERTY_NAME_MAP: Record<string, string> = {
  minWidth: 'min-width',
  minHeight: 'min-height',
  backgroundColor: 'background-color',
  borderWidth: 'border-width',
  borderStyle: 'border-style',
  boxShadow: 'box-shadow',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  marginTop: 'margin-top',
  marginRight: 'margin-right',
  marginBottom: 'margin-bottom',
  marginLeft: 'margin-left',
  overflowX: 'overflow-x',
  overflowY: 'overflow-y',
};

function getCssPropertyName(enumVal: number, key: string): string {
  if (!CSS_PROPERTY_CACHE.has(enumVal)) {
    const prop = PROPERTY_NAME_MAP[key] || key.replace(/([A-Z])/g, '-$1').toLowerCase();
    CSS_PROPERTY_CACHE.set(enumVal, prop);
  }
  return CSS_PROPERTY_CACHE.get(enumVal)!;
}

const CAPTURE_CONDITIONS: Record<string, (value: string, element?: HTMLElement) => boolean> = {
  display: v => v !== 'block' && v !== 'inline' && v !== '',
  visibility: v => v !== 'visible',
  opacity: v => parseFloat(v) < 1,
  position: v => v !== 'static',
  cursor: v => v !== 'auto' && v !== 'default' && v !== 'text',
  width: v => v !== 'auto' && v !== '',
  height: v => v !== 'auto' && v !== '',
  minWidth: v => v !== '0px' && v !== '',
  minHeight: v => v !== '0px' && v !== '',
  paddingTop: v => parseFloat(v) > 0,
  paddingRight: v => parseFloat(v) > 0,
  paddingBottom: v => parseFloat(v) > 0,
  paddingLeft: v => parseFloat(v) > 0,
  marginTop: v => Math.abs(parseFloat(v)) > 5,
  marginRight: v => Math.abs(parseFloat(v)) > 5,
  marginBottom: v => Math.abs(parseFloat(v)) > 5,
  marginLeft: v => Math.abs(parseFloat(v)) > 5,
  overflowX: v => v !== 'visible',
  overflowY: v => v !== 'visible',
  backgroundColor: v => v !== 'transparent' && v !== 'rgba(0, 0, 0, 0)' && v !== 'initial',
  color: v => v !== 'initial' && v !== 'inherit' && v !== '',
  borderWidth: v => v !== '0px' && parseFloat(v) > 0,
  borderStyle: v => v !== 'none' && v !== 'initial',
  boxShadow: v => v !== 'none' && v !== '',
  outline: v => v !== 'none' && v !== '' && !v.includes('0px'),
};

function shouldCaptureStyle(key: string, value: string, element?: HTMLElement): boolean {
  const condition = CAPTURE_CONDITIONS[key];
  if (!condition) {
    return value.trim() !== '' && !['initial', 'inherit', 'unset'].includes(value);
  }
  return condition(value, element);
}

export function extractRelevantStyles(element: Element): Record<number, string> {
  const relevantStyles: Record<number, string> = {};
  const win = winOf(element);

  if (!isHTMLElementLike(element, win)) return relevantStyles;

  const mainStyle = win.getComputedStyle(element);
  const pseudoCache = new Map<number, CSSStyleDeclaration>([
    [ComputedStyleProperty.beforeDisplay, win.getComputedStyle(element, '::before')],
    [ComputedStyleProperty.afterDisplay, win.getComputedStyle(element, '::after')],
    [ComputedStyleProperty.beforeContent, win.getComputedStyle(element, '::before')],
    [ComputedStyleProperty.afterContent, win.getComputedStyle(element, '::after')],
  ]);

  for (const key in ComputedStyleProperty) {
    if (isNaN(Number(key))) {
      const enumVal = ComputedStyleProperty[key as keyof typeof ComputedStyleProperty];
      const cssProp = getCssPropertyName(enumVal, key);

      const pseudoKeys = STYLE_PSEUDO_MAP[enumVal];
      if (pseudoKeys) {
        if (enumVal === ComputedStyleProperty.display || enumVal === ComputedStyleProperty.content) {
          processStyle(mainStyle, cssProp, enumVal, key, relevantStyles, element);
        }
        processPseudo(pseudoCache.get(pseudoKeys[0]), cssProp, pseudoKeys[0], 'beforeContent', relevantStyles);
        processPseudo(pseudoCache.get(pseudoKeys[1]), cssProp, pseudoKeys[1], 'afterContent', relevantStyles);
      } else {
        processStyle(mainStyle, cssProp, enumVal, key, relevantStyles, element);
      }
    }
  }

  return relevantStyles;
}

function processStyle(
  style: CSSStyleDeclaration | undefined,
  prop: string,
  key: number,
  keyName: string,
  relevantStyles: Record<number, string>,
  element?: HTMLElement,
) {
  if (style) {
    const value = style.getPropertyValue(prop);
    if (value && shouldCaptureStyle(keyName, value, element)) {
      relevantStyles[key] = value;
    }
  }
}

function processPseudo(
  pseudoStyle: CSSStyleDeclaration | undefined,
  prop: string,
  targetKey: number,
  keyName: string,
  relevantStyles: Record<number, string>,
) {
  if (pseudoStyle) {
    const value = pseudoStyle.getPropertyValue(prop);
    if (prop === 'content' && value && value !== 'none' && value !== '""' && value !== "''") {
      relevantStyles[targetKey] = value;
    } else if (value && shouldCaptureStyle(keyName, value)) {
      relevantStyles[targetKey] = value;
    }
  }
}
