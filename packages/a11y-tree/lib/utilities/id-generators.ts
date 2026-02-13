// utilities/id-generators.ts
import { SemanticNodeIdGenerator } from '../types/aria-types.js';

export const semanticNodeIdGenerator = new SemanticNodeIdGenerator();

let elementIdMap: WeakMap<Element, number> = new WeakMap();

export function resetElementIdMap() {
  elementIdMap = new WeakMap();
}

export function getOrAssignNodeId(el: Element): number {
  const existing = elementIdMap.get(el);
  if (existing) return existing;
  const id = semanticNodeIdGenerator.generateId(); // single generator
  elementIdMap.set(el, id);
  return id;
}
