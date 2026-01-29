import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNavigationMessageContext } from '../dist/navigationMessageContext.js';

test('navigation message context prefers pending run text', () => {
  const message = resolveNavigationMessageContext({
    pendingRunText: 'pending user request',
    activeRunText: 'active run text',
    rootWorkerInput: 'root worker input',
    lastUserInputText: 'last user input',
  });
  assert.equal(message, 'pending user request');
});

test('navigation message context falls back through active/root/last input', () => {
  assert.equal(
    resolveNavigationMessageContext({
      activeRunText: 'active run text',
      rootWorkerInput: 'root worker input',
      lastUserInputText: 'last user input',
    }),
    'active run text',
  );

  assert.equal(
    resolveNavigationMessageContext({
      rootWorkerInput: 'root worker input',
      lastUserInputText: 'last user input',
    }),
    'root worker input',
  );

  assert.equal(
    resolveNavigationMessageContext({
      lastUserInputText: 'last user input',
    }),
    'last user input',
  );
});
