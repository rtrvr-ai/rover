import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInaccessibleTabPageData,
  buildTabAccessToolError,
} from '../dist/tabAccessFallbacks.js';

test('missing target tab fallback stays non-external for page data', () => {
  const result = buildInaccessibleTabPageData(
    { logicalTabId: 19, external: false },
    'target_tab_missing',
  );

  assert.equal(result?.metadata?.external, false);
  assert.equal(result?.metadata?.accessMode, 'inactive_tab');
  assert.equal(result?.metadata?.reason, 'target_tab_missing');
});

test('missing target tab fallback stays non-external for tool errors', () => {
  const result = buildTabAccessToolError(
    { externalNavigationPolicy: 'open_new_tab_notice' },
    { logicalTabId: 19, external: false },
    'target_tab_missing',
  );

  assert.equal(result?.output?.error?.code, 'TAB_NOT_ACCESSIBLE');
  assert.equal(result?.output?.external, false);
  assert.equal(result?.output?.policy_action, undefined);
});

test('external tab fallback retains external semantics', () => {
  const result = buildTabAccessToolError(
    { externalNavigationPolicy: 'open_new_tab_notice' },
    { logicalTabId: 22, external: true, url: 'https://external.example' },
    'external_tab_action_blocked',
  );

  assert.equal(result?.output?.error?.code, 'DOMAIN_SCOPE_BLOCKED');
  assert.equal(result?.output?.external, true);
  assert.equal(result?.output?.policy_action, 'open_new_tab_notice');
});
