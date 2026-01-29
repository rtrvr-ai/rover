import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUrlAllowedByDomains,
  normalizeAllowedDomains,
  normalizeDomainPatternToken,
} from '../dist/navigationScope.js';

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
