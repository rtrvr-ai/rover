import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeHelperConfigFragment,
  extractHelperConfigFragment,
  hasHelperConfigFragment,
  isHostAllowed,
  normalizeConfig,
  stripPreviewLaunchParams,
} from './shared.js';

test('normalizeConfig keeps Workspace publicKey config fields', () => {
  const config = normalizeConfig({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    siteKeyId: 'key_123',
    apiBase: 'https://agent.rtrvr.ai',
    allowedDomains: ['example.com'],
    domainScopeMode: 'host_only',
    externalNavigationPolicy: 'allow',
    mode: 'full',
    allowActions: true,
  });

  assert.equal(config.siteId, 'site_123');
  assert.equal(config.publicKey, 'pk_site_123');
  assert.equal(config.siteKeyId, 'key_123');
  assert.equal(config.apiBase, 'https://agent.rtrvr.ai');
  assert.deepEqual(config.allowedDomains, ['example.com']);
  assert.equal(config.domainScopeMode, 'host_only');
  assert.equal(config.externalNavigationPolicy, 'allow');
  assert.equal(config.mode, 'full');
  assert.equal(config.allowActions, true);
});

test('isHostAllowed respects host_only and registrable domain rules', () => {
  assert.equal(isHostAllowed('example.com', ['example.com'], 'host_only'), true);
  assert.equal(isHostAllowed('shop.example.com', ['example.com'], 'host_only'), false);
  assert.equal(isHostAllowed('shop.example.com', ['example.com'], 'registrable_domain'), true);
  assert.equal(isHostAllowed('example.com', ['*.example.com'], 'registrable_domain'), false);
  assert.equal(isHostAllowed('shop.example.com', ['*.example.com'], 'registrable_domain'), true);
  assert.equal(isHostAllowed('app.example.com', ['=app.example.com'], 'registrable_domain'), true);
  assert.equal(isHostAllowed('shop.example.com', ['=app.example.com'], 'registrable_domain'), false);
});

test('helper fragment handoff round-trips generic publicKey config and strips itself from the URL', () => {
  const fragment = encodeHelperConfigFragment({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
  });
  const url = `https://www.example.com/products#${fragment}`;

  assert.equal(hasHelperConfigFragment(url), true);
  assert.deepEqual(extractHelperConfigFragment(url), {
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
  });
  assert.equal(stripPreviewLaunchParams(url), 'https://www.example.com/products');
});

test('invalid helper fragments throw a clear error', () => {
  assert.throws(
    () => extractHelperConfigFragment('https://www.example.com/#rover_helper_config=not-valid-base64'),
    /Invalid Rover helper handoff:/,
  );
});
