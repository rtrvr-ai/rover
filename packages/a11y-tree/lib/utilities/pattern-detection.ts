// // utilities/pattern-detection.ts

// import { INTERACTIVE_SEMANTIC_ROLES } from '../mappings/role-mappings.js';
// import { getEventHandlerIdsForElement } from '../utilities/event-handler-mapper.js';

// const LAYOUT_TAGS = new Set([
//   'div',
//   'section',
//   'article',
//   'aside',
//   'header',
//   'footer',
//   'main',
//   'nav',
// ]);

// const INTERACTIVE_TAGS = new Set(['input', 'textarea', 'select', 'button', 'a', 'details', 'summary', 'dialog']);

// const POTENTIALLY_INTERACTIVE_TAGS = new Set([
//   'img',
//   'video',
//   'audio',
//   'canvas',
//   'iframe',
//   'meter',
//   'progress',
//   'output',
//   'option',
// ]);

// const NON_INTERACTIVE_TAGS = new Set([
//   'script',
//   'style',
//   'meta',
//   'title',
//   'head',
//   'noscript',
//   'link',
//   'base',
//   'br',
//   'hr',
//   'wbr',
//   'html',
//   'body',
//   'template',
//   'slot',
//   'col',
//   'colgroup',
//   'tbody',
//   'thead',
//   'tfoot',
//   'dd',
//   'dt',
//   'source',
//   'track',
//   'param',
//   'area',
//   'defs',
//   'pattern',
//   'mask',
//   'clipPath',
// ]);

// export function isLikelyStructuralContainer(element: HTMLElement): boolean {
//   const tagName = element.tagName.toLowerCase();

//   // Things that are almost never "layout wrappers" in the sense we care about
//   if (NON_INTERACTIVE_TAGS.has(tagName)) return false;

//   // Limit to layout-y tags; we don't want to ever classify, say, <button> as structural
//   if (!LAYOUT_TAGS.has(tagName)) return false;

//   // If author explicitly marked an interactive role, respect it – not structural
//   const explicitRole = (element.getAttribute('role') || '').toLowerCase().trim();
//   if (explicitRole && INTERACTIVE_SEMANTIC_ROLES.has(explicitRole)) {
//     return false;
//   }

//   // Tree goal: if the element itself is interactive, don't treat it as structural.
//   // This is the *big* change: event handlers on self => not structural.
//   const eventHandlers = getEventHandlerIdsForElement(element);
//   if (eventHandlers.length > 0) {
//     return false;
//   }

//   const tabindex = element.getAttribute('tabindex');
//   if (tabindex !== null && !Number.isNaN(parseInt(tabindex, 10)) && parseInt(tabindex, 10) >= 0) {
//     return false;
//   }

//   if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
//     return false;
//   }

//   // At this point, it's a layout-ish tag with no listeners or focusability.
//   // Require some "bulk" to bother calling it structural.
//   const children = Array.from(element.children) as HTMLElement[];
//   if (children.length < 3) return false;

//   // If it groups multiple interactive descendants, it's almost certainly a structural container.
//   let interactiveDescendantCount = 0;
//   const elements = element.querySelectorAll<HTMLElement>('button,a,input,select,textarea,[role]');
//   const elementsArray = elements ? Array.from(elements) : [];
//   for (const child of elementsArray) {
//     const role = (child.getAttribute('role') || '').toLowerCase().trim();
//     const t = child.tagName.toLowerCase();
//     if (
//       INTERACTIVE_TAGS.has(t) ||
//       POTENTIALLY_INTERACTIVE_TAGS.has(t) ||
//       (role && INTERACTIVE_SEMANTIC_ROLES.has(role))
//     ) {
//       interactiveDescendantCount += 1;
//       if (interactiveDescendantCount >= 2) {
//         return true;
//       }
//     }
//   }

//   return false;
// }

// export { INTERACTIVE_TAGS, POTENTIALLY_INTERACTIVE_TAGS, NON_INTERACTIVE_TAGS };
