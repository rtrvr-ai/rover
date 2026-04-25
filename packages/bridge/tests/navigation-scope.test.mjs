import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUrlAllowedByDomains,
  normalizeAllowedDomains,
  normalizeDomainPatternToken,
} from '../dist/navigationScope.js';
import { shouldBlockToolForOutOfScopeContext } from '../dist/toolScopePolicy.js';

test('normalizeDomainPatternToken canonicalizes URL-like, wildcard, and exact tokens', () => {
  assert.equal(normalizeDomainPatternToken('https://rtrvr.ai/path?q=1'), 'rtrvr.ai');
  assert.equal(normalizeDomainPatternToken('*.rtrvr.ai'), '*.rtrvr.ai');
  assert.equal(normalizeDomainPatternToken('=app.rtrvr.ai'), '=app.rtrvr.ai');
  assert.equal(normalizeDomainPatternToken('//app.rtrvr.ai:8080/login'), 'app.rtrvr.ai');
});

test('normalizeAllowedDomains accepts URL-shaped entries', () => {
  const domains = normalizeAllowedDomains(
    ['https://rtrvr.ai/path', '*.rtrvr.ai', '=app.rtrvr.ai'],
    'rtrvr.ai',
    'registrable_domain',
  );
  assert.deepEqual(domains, ['rtrvr.ai', '*.rtrvr.ai', '=app.rtrvr.ai']);
});

test('isUrlAllowedByDomains matches exact and wildcard behavior correctly', () => {
  assert.equal(
    isUrlAllowedByDomains('https://app.rtrvr.ai/dashboard', ['=rtrvr.ai']),
    false,
  );
  assert.equal(
    isUrlAllowedByDomains('https://app.rtrvr.ai/dashboard', ['*.rtrvr.ai']),
    true,
  );
  assert.equal(
    isUrlAllowedByDomains('https://rtrvr.ai/help', ['*.rtrvr.ai']),
    false,
  );
  assert.equal(
    isUrlAllowedByDomains('https://rtrvr.ai/help', ['https://rtrvr.ai/path']),
    true,
  );
});

test('host_only mode treats plain allowlist tokens as exact host matches', () => {
  const domains = normalizeAllowedDomains(
    ['example.com'],
    'app.example.com',
    'host_only',
  );

  assert.deepEqual(domains, ['=example.com']);
  assert.equal(isUrlAllowedByDomains('https://example.com/pricing', domains), true);
  assert.equal(isUrlAllowedByDomains('https://app.example.com/pricing', domains), false);
});

test('current-context scope guard blocks action tools outside allowed scope', () => {
  assert.equal(
    shouldBlockToolForOutOfScopeContext({
      toolName: 'click_element',
      currentUrl: 'https://outside.example.com/dashboard',
      allowedDomains: ['sphere-demo-nine.vercel.app'],
    }),
    true,
  );
});

test('registrable_domain allowlist accepts the deployed sphere demo host', () => {
  const domains = normalizeAllowedDomains(
    ['sphere-demo-nine.vercel.app'],
    'sphere-demo-nine.vercel.app',
    'registrable_domain',
  );

  assert.equal(
    isUrlAllowedByDomains('https://sphere-demo-nine.vercel.app/contact', domains),
    true,
  );
});

test('localhost allowlist does not match the deployed sphere demo host or 127.0.0.1', () => {
  const domains = normalizeAllowedDomains(
    ['localhost'],
    'localhost',
    'registrable_domain',
  );

  assert.deepEqual(domains, ['localhost']);
  assert.equal(
    isUrlAllowedByDomains('https://sphere-demo-nine.vercel.app/contact', domains),
    false,
  );
  assert.equal(
    isUrlAllowedByDomains('http://127.0.0.1:3000/contact', domains),
    false,
  );
});

test('normalizeDomainPatternToken preserves IPv6 hosts without mangling', () => {
  assert.equal(normalizeDomainPatternToken('[::1]'), '::1');
  assert.equal(normalizeDomainPatternToken('http://[::1]:3000/path'), '::1');
});
