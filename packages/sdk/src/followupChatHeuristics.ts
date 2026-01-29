import type { PersistedTaskState, TaskState } from './runtimeTypes.js';

export type FollowupChatEntry = {
  role: 'user' | 'model';
  message: string;
};

export type FollowupSourceMessage = {
  role: 'user' | 'assistant' | 'system';
  text?: string;
  ts?: number;
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

function buildTranscriptTurns(messages?: FollowupSourceMessage[]): Array<{ user: string; assistant?: string; ts: number }> {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const turns: Array<{ user: string; assistant?: string; ts: number }> = [];

  for (const raw of messages) {
    if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) continue;
    const text = normalizeMessage(raw.text);
    if (!text) continue;

    if (raw.role === 'user') {
      turns.push({
        user: text,
        ts: Number(raw.ts) || 0,
      });
      continue;
    }

    if (!turns.length) continue;
    const latest = turns[turns.length - 1];
    if (!latest.assistant) {
      latest.assistant = text;
      latest.ts = Math.max(latest.ts, Number(raw.ts) || 0);
    }
  }

  return turns;
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
  previousTaskMessages?: FollowupSourceMessage[];
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

  const transcriptTurns = buildTranscriptTurns(params.previousTaskMessages);
  const fallbackIntent = normalizeMessage(params.previousTaskUserInput);
  const fallbackOutput = normalizeMessage(params.previousTaskAssistantOutput);
  const turns = transcriptTurns.length
    ? transcriptTurns
    : (
      fallbackIntent && fallbackOutput
        ? [{ user: fallbackIntent, assistant: fallbackOutput, ts: Number(params.previousTaskCompletedAt) || 0 }]
        : []
    );

  if (!turns.some(turn => turn.user)) {
    return { reason: 'missing_previous_intent', overlap: 0 };
  }

  if (!turns.some(turn => turn.assistant)) {
    return { reason: 'missing_previous_output', overlap: 0 };
  }

  const completedAt = Math.max(0, Number(params.previousTaskCompletedAt) || 0);
  const now = Math.max(completedAt, Number(params.now) || Date.now());
  const ttlMs = Math.max(1_000, Number(params.ttlMs) || 0);
  if (!completedAt || now - completedAt > ttlMs) {
    return { reason: 'ttl_expired', overlap: 0 };
  }

  const minOverlap = Math.max(0, Math.min(1, Number(params.minLexicalOverlap) || 0));

  const scoredTurns = turns
    .map((turn, index) => {
      const overlap = computeNormalizedLexicalOverlap(turn.user, params.currentPrompt);
      const recencyBoost = turns.length > 1 ? (index / (turns.length - 1)) * 0.05 : 0.05;
      return {
        ...turn,
        overlap,
        score: overlap + recencyBoost,
        index,
      };
    })
    .filter(turn => !!turn.assistant);

  if (!scoredTurns.length) {
    return { reason: 'missing_previous_output', overlap: 0 };
  }

  const attachedTurns = scoredTurns
    .filter(turn => turn.overlap >= minOverlap)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    })
    .slice(0, 2)
    .sort((a, b) => a.index - b.index);

  const bestOverlap = scoredTurns.reduce((max, turn) => Math.max(max, turn.overlap), 0);
  if (!attachedTurns.length) {
    return { reason: 'low_lexical_overlap', overlap: bestOverlap };
  }

  return {
    reason: 'attached',
    overlap: bestOverlap,
    chatLog: attachedTurns.flatMap(turn => [
      { role: 'user' as const, message: turn.user },
      { role: 'model' as const, message: turn.assistant || '' },
    ]),
  };
}
