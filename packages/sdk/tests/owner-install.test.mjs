import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoverOwnerInstallBundle } from '../dist/ownerInstall.js';

const STALE_A2W_PROTOCOL_PATTERN = new RegExp([
  '"tas' + 'k":',
  'task' + 'Endpoint',
  'public' + 'Tasks',
  'Agent ' + 'Task Protocol',
  '\\bA' + 'TP\\b',
  '\\/v1\\/' + 'tasks',
  '\\/v1\\/' + 'workflows',
].join('|'));

test('owner install bundle splits body runtime HTML from head discovery HTML', () => {
  const bundle = createRoverOwnerInstallBundle({
    bootConfig: {
      siteId: 'site_123',
      publicKey: 'pk_site_123',
      siteKeyId: 'key_123',
      allowedDomains: ['example.com'],
      domainScopeMode: 'registrable_domain',
      agentDiscovery: {
        enabled: true,
        roverSiteUrl: '/.well-known/rover-site.json',
        discoverySurface: {
          mode: 'integrated',
          hostSurface: 'existing-assistant',
          actionReveal: 'agent-handshake',
          beaconLabel: 'Use AI',
        },
      },
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
  assert.doesNotMatch(bundle.bodyInstallHtml, STALE_A2W_PROTOCOL_PATTERN);
  assert.match(bundle.bodyInstallHtml, /application\/agent-card\+json/);
  assert.match(bundle.bodyInstallHtml, /application\/rover-site\+json/);
  assert.match(bundle.bodyInstallHtml, /application\/rover-page\+json/);
  assert.doesNotMatch(bundle.bodyInstallHtml, /rel="service-desc"/);
  assert.match(bundle.bodyInstallHtml, /embed\.js\?v=key_123/);
  assert.match(bundle.bodyInstallHtml, /roverbook\.js\?v=key_123/);
  assert.match(bundle.bodyInstallHtml, /enableRoverBook/);
  assert.match(bundle.bodyInstallHtml, /"agentDiscovery"/);
  assert.match(bundle.bodyInstallHtml, /"mode": "integrated"/);

  assert.match(bundle.headDiscoveryHtml, /rel="service-desc"/);
  assert.match(bundle.headDiscoveryHtml, /rel="service-doc"/);
  assert.equal(
    bundle.serviceDescLinkHeader,
    '</.well-known/agent-card.json>; rel="service-desc"; type="application/json", </llms.txt>; rel="service-doc"; type="text/markdown"',
  );
  assert.match(bundle.llmsTxt || '', /book_demo: Book Demo/);
  assert.equal(bundle.agentCard?.name, 'Example Store');
  assert.equal(bundle.agentCard?.extensions?.rover?.discoverySurface?.mode, 'beacon');
  assert.equal(bundle.roverSite?.identity.siteId, 'site_123');
  assert.equal(bundle.roverSite?.display?.mode, 'beacon');
  assert.equal(bundle.roverSite?.display?.compactActionMaxActions, 3);
  assert.equal(bundle.roverSite?.artifacts.roverSiteUrl, '/.well-known/rover-site.json');
  assert.match(bundle.roverSiteJson || '', /"siteId": "site_123"/);
});

test('owner install bundle advertises generated llms.txt with the default service-doc URL', () => {
  const bundle = createRoverOwnerInstallBundle({
    bootConfig: {
      siteId: 'site_llms',
      publicKey: 'pk_site_llms',
    },
    discovery: {
      siteId: 'site_llms',
      siteUrl: 'https://example.com/',
      siteName: 'LLMS Store',
      aiAccess: {
        enabled: true,
      },
    },
    emitLlmsTxt: true,
  });

  assert.match(bundle.headDiscoveryHtml, /href="\/llms\.txt"/);
  assert.equal(
    bundle.serviceDescLinkHeader,
    '</.well-known/agent-card.json>; rel="service-desc"; type="application/json", </llms.txt>; rel="service-doc"; type="text/markdown"',
  );
  assert.equal(bundle.agentCard?.extensions?.rover?.llmsUrl, '/llms.txt');
  assert.equal(bundle.roverSite?.artifacts?.llmsUrl, '/llms.txt');
  assert.match(bundle.llmsTxt || '', /Primary A2W run endpoint/);
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

test('owner install bundle respects explicit discovery disable even when ai access is enabled', () => {
  const bundle = createRoverOwnerInstallBundle({
    bootConfig: {
      siteId: 'site_789',
      publicKey: 'pk_site_789',
    },
    discovery: {
      enabled: false,
      siteId: 'site_789',
      siteUrl: 'https://example.com/',
      siteName: 'Example Store',
      aiAccess: {
        enabled: true,
      },
    },
  });

  assert.doesNotMatch(bundle.bodyInstallHtml, /application\/agent\+json/);
  assert.equal(bundle.agentCardJson, undefined);
  assert.equal(bundle.roverSiteJson, undefined);
});

test('owner install bundle materializes cloud sandbox owner config into tools.web', () => {
  const bundle = createRoverOwnerInstallBundle({
    bootConfig: {
      siteId: 'site_cloud',
      publicKey: 'pk_site_cloud',
      cloudSandboxEnabled: true,
    },
  });

  assert.match(bundle.bodyInstallHtml, /"cloudSandboxEnabled": true/);
  assert.match(bundle.bodyInstallHtml, /"enableExternalWebContext": true/);
  assert.match(bundle.bodyInstallHtml, /"scrapeMode": "on_demand"/);
});
