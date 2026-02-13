// packages/shared/lib/types/shortcut-types.ts

import type { StoredFunctionCall, TabExecutionMode } from './workflow-types.js';

export interface WorkflowShortcut {
  id: string;
  name: string; // e.g., "extract-text" (without the /)
  displayName: string; // e.g., "/extract-text"
  description?: string;
  storedFunctionCall: StoredFunctionCall;
  tabExecutionMode?: TabExecutionMode; // How to handle tabs when executing
  createdAt: number;
  lastUsed?: number;
  useCount: number;
  isPredefined?: boolean; // Mark predefined shortcuts
}

export interface ShortcutSuggestion {
  shortcut: WorkflowShortcut;
  matchIndex: number;
}

// Special handler types for predefined shortcuts
export enum PredefinedShortcutHandler {
  CONFIGURE_GEMINI_KEY = 'configure_gemini_key',
}
