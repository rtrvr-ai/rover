import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHeuristicFollowupChatLog,
  computeNormalizedLexicalOverlap,
} from '../dist/followupChatHeuristics.js';

test('overlap scoring is normalized and positive for related prompts', () => {
  const overlap = computeNormalizedLexicalOverlap(
    'extract pricing and plans from this page',
    'can you extract the pricing table from the plans page',
  );
  assert.ok(overlap > 0);
  assert.ok(overlap <= 1);
});

test('followup chat attaches only when status/ttl/overlap are eligible', () => {
  const decision = buildHeuristicFollowupChatLog({
    mode: 'heuristic_same_window',
    previousTaskStatus: 'completed',
    previousTaskUserInput: 'summarize the pricing tiers',
    previousTaskAssistantOutput: 'I summarized Basic, Pro, and Enterprise tiers.',
    previousTaskCompletedAt: 10_000,
    currentPrompt: 'now compare those pricing tiers by monthly cost',
    ttlMs: 120_000,
    minLexicalOverlap: 0.1,
    now: 20_000,
  });

  assert.equal(decision.reason, 'attached');
  assert.equal(Array.isArray(decision.chatLog), true);
  assert.equal(decision.chatLog?.length, 2);
});

test('followup chat is skipped when ttl expires', () => {
  const decision = buildHeuristicFollowupChatLog({
    mode: 'heuristic_same_window',
    previousTaskStatus: 'completed',
    previousTaskUserInput: 'summarize release notes',
    previousTaskAssistantOutput: 'I summarized the release notes.',
    previousTaskCompletedAt: 10_000,
    currentPrompt: 'what changed in release notes for API section',
    ttlMs: 5_000,
    minLexicalOverlap: 0.05,
    now: 20_500,
  });

  assert.equal(decision.reason, 'ttl_expired');
  assert.equal(decision.chatLog, undefined);
});

test('followup chat is skipped when lexical overlap is low', () => {
  const decision = buildHeuristicFollowupChatLog({
    mode: 'heuristic_same_window',
    previousTaskStatus: 'ended',
    previousTaskUserInput: 'book a flight from SFO to JFK',
    previousTaskAssistantOutput: 'I found a few flight options.',
    previousTaskCompletedAt: 10_000,
    currentPrompt: 'summarize quarterly hiring trends for engineering',
    ttlMs: 120_000,
    minLexicalOverlap: 0.2,
    now: 20_000,
  });

  assert.equal(decision.reason, 'low_lexical_overlap');
  assert.equal(decision.chatLog, undefined);
});

test('followup chat prefers relevant transcript turns and ignores system chatter', () => {
  const decision = buildHeuristicFollowupChatLog({
    mode: 'heuristic_same_window',
    previousTaskStatus: 'completed',
    previousTaskMessages: [
      { role: 'user', text: 'book a flight from SFO to JFK', ts: 1_000 },
      { role: 'assistant', text: 'I found a few flight options.', ts: 1_500 },
      { role: 'system', text: 'Analyzing request...', ts: 1_600 },
      { role: 'user', text: 'summarize pricing plans by monthly cost', ts: 2_000 },
      { role: 'assistant', text: 'Basic is $10 and Pro is $30.', ts: 2_500 },
    ],
    previousTaskCompletedAt: 3_000,
    currentPrompt: 'compare the monthly cost of those pricing plans',
    ttlMs: 120_000,
    minLexicalOverlap: 0.1,
    now: 4_000,
  });

  assert.equal(decision.reason, 'attached');
  assert.deepEqual(decision.chatLog, [
    { role: 'user', message: 'summarize pricing plans by monthly cost' },
    { role: 'model', message: 'Basic is $10 and Pro is $30.' },
  ]);
});
