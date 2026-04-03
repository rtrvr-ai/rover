import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoverOwnerInstallBundle } from '../dist/ownerInstall.js';

test('owner install bundle splits body runtime HTML from head discovery HTML', () => {
  const bundle = createRoverOwnerInstallBundle({
    bootConfig: {
      siteId: 'site_123',
      publicKey: 'pk_site_123',
      siteKeyId: 'key_123',
      allowedDomains: ['example.com'],
      domainScopeMode: 'registrable_domain',
    },
    embedScriptUrl: 'https://rover.rtrvr.ai/embed.js?v=key_123',
    roverBook: {
      enabled: true,
      scriptUrl: 'https://rover.rtrvr.ai/roverbook.js?v=key_123',
      config: {
        siteId: 'site_123',
        apiBase: 'https://roverbook.rtrvr.ai',
      },
    },
    discovery: {
      siteId: 'site_123',
      siteUrl: 'https://example.com/',
      siteName: 'Example Store',
      agentCardUrl: '/.well-known/agent-card.json',
      llmsUrl: '/llms.txt',
      shortcuts: [
        {
          id: 'book_demo',
          label: 'Book Demo',
          prompt: 'Help me book a demo.',
        },
      ],
      aiAccess: {
        enabled: true,
        allowDelegatedHandoffs: true,
      },
    },
    emitLlmsTxt: true,
  });

  assert.match(bundle.bodyInstallHtml, /application\/agent\+json/);
  assert.match(bundle.bodyInstallHtml, /application\/agent-card\+json/);
  assert.doesNotMatch(bundle.bodyInstallHtml, /rel="service-desc"/);
  assert.match(bundle.bodyInstallHtml, /embed\.js\?v=key_123/);
  assert.match(bundle.bodyInstallHtml, /roverbook\.js\?v=key_123/);
  assert.match(bundle.bodyInstallHtml, /enableRoverBook/);

  assert.match(bundle.headDiscoveryHtml, /rel="service-desc"/);
  assert.match(bundle.headDiscoveryHtml, /rel="service-doc"/);
  assert.equal(
    bundle.serviceDescLinkHeader,
    '</.well-known/agent-card.json>; rel="service-desc"; type="application/json", </llms.txt>; rel="service-doc"; type="text/markdown"',
  );
  assert.match(bundle.llmsTxt || '', /book_demo: Book Demo/);
  assert.equal(bundle.agentCard?.name, 'Example Store');
});

test('owner install bundle keeps runtime install valid when public discovery is disabled', () => {
  const bundle = createRoverOwnerInstallBundle({
    bootConfig: {
      siteId: 'site_456',
      publicKey: 'pk_site_456',
    },
    discovery: {
      siteId: 'site_456',
      siteUrl: 'https://example.com/',
      siteName: 'Example Store',
      aiAccess: {
        enabled: false,
      },
    },
  });

  assert.doesNotMatch(bundle.bodyInstallHtml, /application\/agent\+json/);
  assert.doesNotMatch(bundle.bodyInstallHtml, /application\/agent-card\+json/);
  assert.equal(bundle.headDiscoveryHtml, '');
  assert.equal(bundle.agentCardJson, undefined);
  assert.equal(bundle.serviceDescLinkHeader, undefined);
  assert.equal(bundle.llmsTxt, undefined);
  assert.match(bundle.bodyInstallHtml, /rover\('boot'/);
});
