import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNavigationDecision } from '../dist/navigationPreflightPolicy.js';

test('cross-registrable preflight outage falls back to local decision', () => {
  const result = resolveNavigationDecision({
    crossRegistrableDomain: true,
    fallbackDecision: 'open_new_tab',
    serverAvailable: false,
  });

  assert.equal(result.decision, 'open_new_tab');
  assert.equal(result.failSafeBlocked, false);
  assert.equal(result.decisionReason, 'preflight_unavailable_fallback');
});

test('cross-registrable preflight outage respects local block policy', () => {
  const result = resolveNavigationDecision({
    crossRegistrableDomain: true,
    fallbackDecision: 'block',
    serverAvailable: false,
  });

  assert.equal(result.decision, 'block');
  assert.equal(result.failSafeBlocked, false);
  assert.equal(result.decisionReason, 'preflight_unavailable_fallback');
});

test('in-scope preflight outage keeps same-tab fallback', () => {
  const result = resolveNavigationDecision({
    crossRegistrableDomain: false,
    fallbackDecision: 'allow_same_tab',
    serverAvailable: false,
  });

  assert.equal(result.decision, 'allow_same_tab');
  assert.equal(result.failSafeBlocked, false);
});

test('stale_run server decision falls back to local policy', () => {
  const result = resolveNavigationDecision({
    crossRegistrableDomain: false,
    fallbackDecision: 'allow_same_tab',
    serverDecision: 'stale_run',
    serverAvailable: true,
  });

  assert.equal(result.decision, 'allow_same_tab');
  assert.equal(result.failSafeBlocked, false);
});

test('server allow/block/open decisions are honored when available', () => {
  const blocked = resolveNavigationDecision({
    crossRegistrableDomain: false,
    fallbackDecision: 'allow_same_tab',
    serverDecision: 'block',
    serverAvailable: true,
  });
  assert.equal(blocked.decision, 'block');

  const opened = resolveNavigationDecision({
    crossRegistrableDomain: false,
    fallbackDecision: 'allow_same_tab',
    serverDecision: 'open_new_tab',
    serverAvailable: true,
  });
  assert.equal(opened.decision, 'open_new_tab');
});
