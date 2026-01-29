export { extractSemanticTree } from './lib/core/semantic-tree-constructor.js';
export {
    INTERACTIVE_LABEL_ATTR, RTRVR_LISTENER_ATTRIBUTE,
    RTRVR_ROLE_ATTRIBUTE, RTRVR_MAIN_WORLD_READY_ATTRIBUTE,
    RTRVR_MAIN_WORLD_ACTIONS_READY_ATTRIBUTE, RTRVR_MAIN_WORLD_BUSY_ATTRIBUTE, INTERACTIVE_SEMANTIC_ROLES,
    CLICK_EQUIVALENTS, DRAG_EQUIVALENTS, INPUT_EQUIVALENTS, STRUCTURAL_CONTAINER_ROLES
} from './lib/mappings/role-mappings.js';
export type { CustomSemanticRole } from './lib/mappings/role-mappings.js';
export { LABEL_ID_PATTERN } from './lib/mappings/role-mappings.js';
export type { SemanticNode, SemanticRole } from './lib/types/aria-types.js';
export { PreservedAttribute, SemanticRoleMap } from './lib/types/aria-types.js';
export * from './lib/utilities/semantic-role-analyzer.js';
export { canUserEdit, getMainWorldRole, extractPrimaryInteractiveIdFromLabel } from './lib/utilities/element-utilities.js';
export * from './lib/utilities/id-generators.js';
export * from './lib/utilities/edit-utilities.js';
export { detectJavaScriptLink, isElementNode } from './lib/utilities/element-analysis.js';
export * from './lib/utilities/event-handler-mapper.js';
export { getIndexedAnnotatedElement, annotateSemanticNode } from './lib/utilities/annotation-manager.js';
export * from './lib/utilities/dom-utilities.js';
export { getOrCreateSemanticNode, SEMANTIC_NODE_COLLECTION } from './lib/utilities/node-repository.js';
export { clearAgentAnnotations } from './lib/utilities/dom-scanner.js';
export { constructSemanticSubtree } from './lib/core/semantic-tree-constructor.js';
