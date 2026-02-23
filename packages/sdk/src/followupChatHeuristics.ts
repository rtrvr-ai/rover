import type { PersistedTaskState, TaskState } from './runtimeTypes.js';

export type FollowupChatEntry = {
  role: 'user' | 'model';
  message: string;
};

export type FollowupChatDecision = {
  chatLog?: FollowupChatEntry[];
  reason:
    | 'attached'
    | 'mode_disabled'
    | 'status_ineligible'
    | 'missing_previous_intent'
    | 'missing_previous_output'
    | 'ttl_expired'
    | 'low_lexical_overlap';
  overlap: number;
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'who',
  'why',
  'with',
  'you',
  'your',
]);

function normalizeMessage(input: string | undefined): string {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function lexicalTokens(input: string): Set<string> {
  const tokens = String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !STOPWORDS.has(token));
  return new Set(tokens);
}

export function computeNormalizedLexicalOverlap(previousIntent: string, currentPrompt: string): number {
  const a = lexicalTokens(previousIntent);
  const b = lexicalTokens(currentPrompt);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

export function buildHeuristicFollowupChatLog(params: {
  mode?: 'heuristic_same_window';
  previousTaskStatus?: PersistedTaskState['status'] | TaskState;
  previousTaskUserInput?: string;
  previousTaskAssistantOutput?: string;
  previousTaskCompletedAt?: number;
  currentPrompt: string;
  ttlMs: number;
  minLexicalOverlap: number;
  now?: number;
}): FollowupChatDecision {
  if (params.mode !== 'heuristic_same_window') {
    return { reason: 'mode_disabled', overlap: 0 };
  }

  const status = params.previousTaskStatus;
  // Accept both legacy 'ended' and new 'cancelled' (ended maps to cancelled in v2)
  if (status !== 'completed' && status !== 'ended' && status !== 'cancelled') {
    return { reason: 'status_ineligible', overlap: 0 };
  }

  const previousIntent = normalizeMessage(params.previousTaskUserInput);
  if (!previousIntent) {
    return { reason: 'missing_previous_intent', overlap: 0 };
  }

  const previousOutput = normalizeMessage(params.previousTaskAssistantOutput);
  if (!previousOutput) {
    return { reason: 'missing_previous_output', overlap: 0 };
  }

  const completedAt = Math.max(0, Number(params.previousTaskCompletedAt) || 0);
  const now = Math.max(completedAt, Number(params.now) || Date.now());
  const ttlMs = Math.max(1_000, Number(params.ttlMs) || 0);
  if (!completedAt || now - completedAt > ttlMs) {
    return { reason: 'ttl_expired', overlap: 0 };
  }

  const overlap = computeNormalizedLexicalOverlap(previousIntent, params.currentPrompt);
  const minOverlap = Math.max(0, Math.min(1, Number(params.minLexicalOverlap) || 0));
  if (overlap < minOverlap) {
    return { reason: 'low_lexical_overlap', overlap };
  }

  return {
    reason: 'attached',
    overlap,
    chatLog: [
      { role: 'user', message: previousIntent },
      { role: 'model', message: previousOutput },
    ],
  };
}
