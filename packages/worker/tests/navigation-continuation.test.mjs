import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyNavigationContinuation } from '../dist/navigationContinuation.js';

test('same_host_navigated maps to loop_continue', () => {
  const result = classifyNavigationContinuation({
    navigationOutcome: 'same_host_navigated',
  });

  assert.equal(result.isNavigationProgress, true);
  assert.equal(result.isSameTabHandoff, false);
  assert.equal(result.continuationReason, 'loop_continue');
});

test('subdomain_navigated maps to loop_continue', () => {
  const result = classifyNavigationContinuation({
    navigationOutcome: 'subdomain_navigated',
  });

  assert.equal(result.isNavigationProgress, true);
  assert.equal(result.isSameTabHandoff, false);
  assert.equal(result.continuationReason, 'loop_continue');
});

test('same_tab_scheduled maps to same_tab_navigation_handoff', () => {
  const result = classifyNavigationContinuation({
    navigationOutcome: 'same_tab_scheduled',
  });

  assert.equal(result.isNavigationProgress, true);
  assert.equal(result.isSameTabHandoff, true);
  assert.equal(result.continuationReason, 'same_tab_navigation_handoff');
});

test('pending same_tab with no explicit outcome maps to same_tab_navigation_handoff', () => {
  const result = classifyNavigationContinuation({
    navigationPending: true,
    navigationMode: 'same_tab',
  });

  assert.equal(result.isNavigationProgress, true);
  assert.equal(result.isSameTabHandoff, true);
  assert.equal(result.continuationReason, 'same_tab_navigation_handoff');
});

test('same_tab mode alone does not imply navigation progress', () => {
  const result = classifyNavigationContinuation({
    navigationMode: 'same_tab',
  });

  assert.equal(result.isNavigationProgress, false);
  assert.equal(result.isSameTabHandoff, false);
  assert.equal(result.continuationReason, null);
});
