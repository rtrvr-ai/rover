import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldContinueTaskForPrompt,
  shouldStartFreshTaskForPrompt,
} from '../dist/promptDispatchGuards.js';

test('all normal sends start a fresh task by default', () => {
  assert.equal(
    shouldStartFreshTaskForPrompt({
      taskStatus: 'running',
      pendingAskUserQuestionCount: 0,
      hasAskUserAnswers: false,
    }),
    true,
  );
  assert.equal(
    shouldStartFreshTaskForPrompt({
      taskStatus: 'completed',
      pendingAskUserQuestionCount: 2,
      hasAskUserAnswers: false,
    }),
    true,
  );
});

test('ask_user answers continue the same task when boundary and status are valid', () => {
  assert.equal(
    shouldContinueTaskForPrompt({
      taskStatus: 'running',
      pendingAskUserQuestionCount: 2,
      hasAskUserAnswers: true,
      pendingAskUserBoundaryId: 'boundary-1',
      currentTaskBoundaryId: 'boundary-1',
    }),
    true,
  );
  assert.equal(
    shouldStartFreshTaskForPrompt({
      taskStatus: 'running',
      pendingAskUserQuestionCount: 2,
      hasAskUserAnswers: true,
      pendingAskUserBoundaryId: 'boundary-1',
      currentTaskBoundaryId: 'boundary-1',
    }),
    false,
  );
});

test('ask_user continuation is rejected when boundary mismatches', () => {
  assert.equal(
    shouldStartFreshTaskForPrompt({
      taskStatus: 'running',
      pendingAskUserQuestionCount: 1,
      hasAskUserAnswers: true,
      pendingAskUserBoundaryId: 'boundary-old',
      currentTaskBoundaryId: 'boundary-new',
    }),
    true,
  );
});

test('ask_user answers still continue the same task when pending prompt state has not hydrated yet', () => {
  assert.equal(
    shouldContinueTaskForPrompt({
      taskStatus: 'running',
      pendingAskUserQuestionCount: 0,
      hasAskUserAnswers: true,
      currentTaskBoundaryId: 'boundary-1',
    }),
    true,
  );
  assert.equal(
    shouldStartFreshTaskForPrompt({
      taskStatus: 'running',
      pendingAskUserQuestionCount: 0,
      hasAskUserAnswers: true,
      currentTaskBoundaryId: 'boundary-1',
    }),
    false,
  );
});

test('explicit startNewTask override always forces a new boundary', () => {
  assert.equal(
    shouldStartFreshTaskForPrompt({
      startNewTask: true,
      taskStatus: 'running',
      pendingAskUserQuestionCount: 3,
      hasAskUserAnswers: true,
    }),
    true,
  );
});
