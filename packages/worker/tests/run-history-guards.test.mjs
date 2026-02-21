import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldBuildResumeCueChatLog, shouldClearHistoryForRun } from '../dist/runHistoryGuards.js';

test('same-window follow-up preserveHistory keeps run history', () => {
  assert.equal(shouldClearHistoryForRun({ resume: false, preserveHistory: true }), false);
  assert.equal(
    shouldBuildResumeCueChatLog({
      resume: false,
      preserveHistory: true,
      resumeFollowupMode: 'deterministic_cues',
    }),
    true,
  );
});

test('explicit new task path clears history when not resume and not preserveHistory', () => {
  assert.equal(shouldClearHistoryForRun({ resume: false, preserveHistory: false }), true);
  assert.equal(
    shouldBuildResumeCueChatLog({
      resume: false,
      preserveHistory: false,
      resumeFollowupMode: 'deterministic_cues',
    }),
    false,
  );
});

test('resume path preserves history and chat cues', () => {
  assert.equal(shouldClearHistoryForRun({ resume: true, preserveHistory: false }), false);
  assert.equal(
    shouldBuildResumeCueChatLog({
      resume: true,
      preserveHistory: false,
      resumeFollowupMode: 'deterministic_cues',
    }),
    true,
  );
});
