import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNavigationTabDisposition } from '../dist/navigationTabDisposition.js';

test('external navigation defaults to opening a new tab', () => {
  const decision = resolveNavigationTabDisposition({
    currentUrl: 'https://www.example.com/products',
    targetUrl: 'https://docs.other-site.com/',
    currentHost: 'www.example.com',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
  });

  assert.equal(decision, 'open_new_tab');
});

test('explicit new-tab intent opens in a new tab for in-scope cross-host navigation', () => {
  const decision = resolveNavigationTabDisposition({
    currentUrl: 'https://www.example.com/products',
    targetUrl: 'https://app.example.com/checkout',
    currentHost: 'www.example.com',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    preferredDisposition: 'new_tab',
  });

  assert.equal(decision, 'open_new_tab');
});

test('existing target tab is preserved by opening or switching tabs instead of same-tab handoff', () => {
  const decision = resolveNavigationTabDisposition({
    currentUrl: 'https://www.example.com/products',
    targetUrl: 'https://app.example.com/checkout',
    currentHost: 'www.example.com',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    sourceLogicalTabId: 1,
    knownTabs: [
      { logicalTabId: 1, url: 'https://www.example.com/products' },
      { logicalTabId: 2, url: 'https://app.example.com/checkout' },
    ],
  });

  assert.equal(decision, 'open_new_tab');
});

test('multi-tab task scope preserves the source tab for future context', () => {
  const decision = resolveNavigationTabDisposition({
    currentUrl: 'https://www.example.com/products',
    targetUrl: 'https://app.example.com/checkout',
    currentHost: 'www.example.com',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    sourceLogicalTabId: 1,
    taskScopedTabIds: [1, 7],
  });

  assert.equal(decision, 'open_new_tab');
});

test('simple in-scope cross-host navigation can still use same-tab handoff', () => {
  const decision = resolveNavigationTabDisposition({
    currentUrl: 'https://www.example.com/products',
    targetUrl: 'https://app.example.com/checkout',
    currentHost: 'www.example.com',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    sourceLogicalTabId: 1,
    taskScopedTabIds: [1],
  });

  assert.equal(decision, 'allow_same_tab');
});
