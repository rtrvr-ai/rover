import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHostInNavigationScope,
  normalizeDomainPatternToken,
} from '../dist/navigationScope.js';

test('normalizeDomainPatternToken handles URL-like and wildcard entries', () => {
  assert.equal(normalizeDomainPatternToken('https://rtrvr.ai/path?q=1'), 'rtrvr.ai');
  assert.equal(normalizeDomainPatternToken('*.rtrvr.ai'), '*.rtrvr.ai');
  assert.equal(normalizeDomainPatternToken('=app.rtrvr.ai'), '=app.rtrvr.ai');
  assert.equal(normalizeDomainPatternToken('//app.rtrvr.ai:8080/login'), 'app.rtrvr.ai');
});

test('allowlist matching accepts URL-shaped domain entries', () => {
  assert.equal(
    isHostInNavigationScope({
      host: 'app.rtrvr.ai',
      allowedDomains: ['https://rtrvr.ai/path'],
      domainScopeMode: 'registrable_domain',
    }),
    true,
  );
});

test('exact and wildcard patterns apply correctly', () => {
  assert.equal(
    isHostInNavigationScope({
      host: 'app.rtrvr.ai',
      allowedDomains: ['=rtrvr.ai'],
      domainScopeMode: 'registrable_domain',
    }),
    false,
  );
  assert.equal(
    isHostInNavigationScope({
      host: 'app.rtrvr.ai',
      allowedDomains: ['*.rtrvr.ai'],
      domainScopeMode: 'registrable_domain',
    }),
    true,
  );
  assert.equal(
    isHostInNavigationScope({
      host: 'rtrvr.ai',
      allowedDomains: ['*.rtrvr.ai'],
      domainScopeMode: 'registrable_domain',
    }),
    false,
  );
});

test('host_only mode treats plain allowlist tokens as exact host matches', () => {
  assert.equal(
    isHostInNavigationScope({
      host: 'example.com',
      allowedDomains: ['example.com'],
      domainScopeMode: 'host_only',
    }),
    true,
  );
  assert.equal(
    isHostInNavigationScope({
      host: 'app.example.com',
      allowedDomains: ['example.com'],
      domainScopeMode: 'host_only',
    }),
    false,
  );
});

test('registrable_domain derivation respects private suffixes and IPv6 host normalization', () => {
  assert.equal(
    isHostInNavigationScope({
      host: 'beta.sphere-demo-nine.vercel.app',
      currentHost: 'sphere-demo-nine.vercel.app',
      domainScopeMode: 'registrable_domain',
    }),
    true,
  );
  assert.equal(
    isHostInNavigationScope({
      host: 'other-site.vercel.app',
      currentHost: 'sphere-demo-nine.vercel.app',
      domainScopeMode: 'registrable_domain',
    }),
    false,
  );
  assert.equal(normalizeDomainPatternToken('[::1]'), '::1');
  assert.equal(normalizeDomainPatternToken('http://[::1]:3000/path'), '::1');
});
