import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveActLoopUserInput } from '../dist/agent/taskInput.js';

test('act loop keeps the original task request when root input exists', () => {
  assert.equal(
    resolveActLoopUserInput(
      'sign_in_confirmation: signed in',
      'Help me run a workflow on rtrvr Cloud. First check if I am signed in.',
    ),
    'Help me run a workflow on rtrvr Cloud. First check if I am signed in.',
  );
});

test('act loop falls back to the current prompt when no root input exists', () => {
  assert.equal(
    resolveActLoopUserInput('sign_in_confirmation: signed in', ''),
    'sign_in_confirmation: signed in',
  );
});
