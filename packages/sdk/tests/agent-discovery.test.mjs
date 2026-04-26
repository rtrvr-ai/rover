import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoverAgentCard,
  createRoverAgentDiscoverySnapshot,
  createRoverAgentDiscoveryTags,
  createRoverServiceDescLinkHeader,
  createRoverWellKnownAgentCard,
  createRoverWellKnownSiteProfile,
  sanitizeRoverAgentDiscoveryRuntimeConfig,
} from '../dist/agentDiscovery.js';

test('agent card maps shortcuts and explicit tools into published skills', () => {
  const card = createRoverAgentCard({
    siteId: 'site_123',
    siteUrl: 'https://example.com/',
    apiBase: 'https://agent.rtrvr.ai',
    siteName: 'Example Store',
    description: 'Structured commerce entrypoints.',
    preferExecution: 'cloud',
    aiAccess: {
      enabled: true,
      allowCloudBrowser: true,
      allowDelegatedHandoffs: true,
    },
    shortcuts: [
      {
        id: 'start_checkout',
        label: 'Start Checkout',
        description: 'Launch the checkout flow directly.',
        prompt: 'start checkout',
        routing: 'act',
        tags: ['checkout', 'commerce'],
        examples: ['Start checkout for the current cart.'],
        sideEffect: 'transactional',
        requiresConfirmation: true,
      },
    ],
    tools: [
      {
        name: 'roverbook_leave_review',
        title: 'Leave RoverBook Review',
        description: 'Record structured site feedback.',
        parameters: {
          rating: { type: 'integer', description: 'Overall score from 1-5.' },
        },
        required: ['rating'],
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        annotations: {
          category: 'feedback',
          sideEffect: 'write',
          requiresConfirmation: true,
          preferredInterface: 'client_tool',
          whenToUse: 'Use this after a task when you need to leave explicit site feedback.',
        },
      },
    ],
    webmcpTools: [
      {
        name: 'rover_start_run',
        title: 'Start Rover Run',
        description: 'Start a structured A2W run on this site.',
        schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
        annotations: {
          category: 'primary',
          sideEffect: 'transactional',
          requiresConfirmation: true,
          preferredInterface: 'webmcp',
        },
      },
    ],
  });

  assert.equal(card.name, 'Example Store');
  assert.equal(card.url, 'https://agent.rtrvr.ai/v1/a2w/runs');
  assert.equal(card.capabilities.a2wRuns, true);
  assert.equal(card.capabilities.delegatedHandoffs, true);
  assert.equal(card.capabilities.webmcp, true);
  assert.equal(card.extensions.rover.preferredExecution, 'cloud');
  assert.equal(card.extensions.rover.discoverySurface.mode, 'beacon');
  assert.equal(card.extensions.rover.discoverySurface.branding, 'site');
  assert.equal(card.extensions.rover.discoverySurface.compactActionMaxActions, 3);
  assert.equal(card.skills.length, 3);

  const checkoutSkill = card.skills.find(skill => skill.id === 'start_checkout');
  assert.equal(checkoutSkill.category, 'primary');
  assert.equal(checkoutSkill.preferredInterface, 'shortcut');
  assert.equal(checkoutSkill.rover.run.endpoint, 'https://agent.rtrvr.ai/v1/a2w/runs');
  assert.equal(checkoutSkill.rover.run.payload.shortcut, 'start_checkout');

  const reviewTool = card.skills.find(skill => skill.id === 'roverbook_leave_review');
  assert.equal(reviewTool.category, 'secondary');
  assert.equal(reviewTool.preferredInterface, 'client_tool');
  assert.match(reviewTool.description, /When to use:/);

  const webmcpTool = card.skills.find(skill => skill.id === 'rover_start_run');
  assert.equal(webmcpTool.preferredInterface, 'webmcp');
});

test('agent discovery snapshot normalizes callable Rover surfaces from the published card', () => {
  const card = createRoverAgentCard({
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
    apiBase: 'https://agent.rtrvr.ai',
    roverSiteUrl: '/.well-known/rover-site.json',
    aiAccess: {
      enabled: true,
      allowCloudBrowser: true,
      allowDelegatedHandoffs: true,
    },
    shortcuts: [
      {
        id: 'checkout_flow',
        label: 'Checkout Flow',
        prompt: 'start checkout',
        routing: 'act',
      },
    ],
    webmcpTools: [
      {
        name: 'rover_start_run',
        title: 'Start Rover Run',
        description: 'Start a structured A2W run on this site.',
        schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
        annotations: {
          preferredInterface: 'webmcp',
        },
      },
    ],
    pages: [
      {
        pageId: 'checkout',
        route: '/checkout',
        label: 'Checkout',
        capabilityIds: ['checkout_flow'],
        visibleCueLabel: 'AI actions available',
      },
    ],
    pageContext: {
      pageId: 'checkout',
      route: '/checkout',
      capabilityIds: ['checkout_flow'],
      visibleCueLabel: 'AI actions available',
    },
  });

  const snapshot = createRoverAgentDiscoverySnapshot(card);
  assert.equal(snapshot.roverEnabled, true);
  assert.equal(snapshot.runEndpoint, 'https://agent.rtrvr.ai/v1/a2w/runs');
  assert.equal(snapshot.workflowEndpoint, 'https://agent.rtrvr.ai/v1/a2w/workflows');
  assert.equal(snapshot.webmcpAvailable, true);
  assert.equal(snapshot.roverSiteUrl, '/.well-known/rover-site.json');
  assert.equal(snapshot.discoverySurface?.mode, 'beacon');
  assert.equal(snapshot.page?.beaconLabel, 'AI actions available');
  assert.equal(snapshot.capabilities[0].capabilityId, 'checkout_flow');
  assert.equal(snapshot.page?.pageId, 'checkout');
  const checkoutSkill = snapshot.skills.find(skill => skill.id === 'checkout_flow');
  assert.equal(checkoutSkill?.runPayload.shortcut, 'checkout_flow');
});

test('agent card disables public A2W capability when ai access is off', () => {
  const card = createRoverAgentCard({
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
    aiAccess: {
      enabled: false,
    },
  });

  assert.equal(card.capabilities.a2wRuns, false);
  assert.equal(card.capabilities.stateTransitions, false);
  assert.equal(card.interfaces.find(entry => entry.type === 'run')?.available, false);
});

test('agent card keeps longer shortcut prompts while still bounding them', () => {
  const acceptedPrompt = 'A'.repeat(2000);
  const trimmedPrompt = 'B'.repeat(2005);
  const card = createRoverAgentCard({
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
    shortcuts: [
      {
        id: 'accepted',
        label: 'Accepted',
        prompt: acceptedPrompt,
      },
      {
        id: 'trimmed',
        label: 'Trimmed',
        prompt: trimmedPrompt,
      },
    ],
  });

  assert.equal(card.extensions.rover.shortcuts[0].prompt.length, 2000);
  assert.equal(card.extensions.rover.shortcuts[1].prompt.length, 2000);
});

test('agent card exposes A2W runs from aiAccess.enabled only', () => {
  const card = createRoverAgentCard({
    siteUrl: 'https://example.com/',
    siteName: 'A2W Store',
    aiAccess: {
      enabled: true,
    },
  });

  assert.equal(card.capabilities.a2wRuns, true);
  assert.equal(card.interfaces.find(entry => entry.type === 'run')?.available, true);
  assert.equal(card.interfaces.find(entry => entry.type === 'deep_link')?.available, true);
  assert.equal(card.extensions.rover.a2wRunsEnabled, true);
});

test('agent discovery runtime config sanitizer preserves supported beacon-first fields', () => {
  const config = sanitizeRoverAgentDiscoveryRuntimeConfig({
    enabled: false,
    roverSiteUrl: '/.well-known/rover-site.json',
    hostSurfaceSelector: '[data-assistant]',
    discoverySurface: {
      mode: 'integrated',
      branding: 'site',
      hostSurface: 'existing-assistant',
      actionReveal: 'agent-handshake',
      visibleCueLabel: 'Use AI',
      agentModeEntryHints: ['Open the assistant first.', 'Open the assistant first.', 'Then use Rover actions.'],
    },
  });

  assert.deepEqual(config, {
    enabled: false,
    roverSiteUrl: '/.well-known/rover-site.json',
    hostSurfaceSelector: '[data-assistant]',
    discoverySurface: {
      mode: 'integrated',
      branding: 'site',
      hostSurface: 'existing-assistant',
      actionReveal: 'agent-handshake',
      beaconLabel: 'Use AI',
      agentModeEntryHints: ['Open the assistant first.', 'Then use Rover actions.'],
    },
  });
});

test('discovery tags include marker, service description, and inline agent card', () => {
  const html = createRoverAgentDiscoveryTags({
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
    shortcuts: [
      {
        id: 'checkout_flow',
        label: 'Checkout Flow',
        prompt: 'start checkout',
      },
    ],
  });

  assert.match(html, /application\/agent\+json/);
  assert.match(html, /rel="service-desc"/);
  assert.match(html, /application\/agent-card\+json/);
  assert.match(html, /application\/rover-site\+json/);
  assert.match(html, /application\/rover-page\+json/);
  assert.match(html, /checkout_flow/);
});

test('well-known card helper and Link header helper produce deployable outputs', () => {
  const json = createRoverWellKnownAgentCard({
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
  });
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, 'Example Store');

  const linkHeader = createRoverServiceDescLinkHeader({
    agentCardUrl: '/.well-known/agent-card.json',
    llmsUrl: '/llms.txt',
  });
  assert.equal(
    linkHeader,
    '</.well-known/agent-card.json>; rel="service-desc"; type="application/json", </llms.txt>; rel="service-doc"; type="text/markdown"',
  );
});

test('well-known rover-site profile compiles the capability graph and page inventory', () => {
  const json = createRoverWellKnownSiteProfile({
    siteId: 'site_123',
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
    apiBase: 'https://agent.rtrvr.ai',
    shortcuts: [
      {
        id: 'checkout_flow',
        label: 'Checkout Flow',
        prompt: 'start checkout',
      },
    ],
    pages: [
      {
        pageId: 'checkout',
        route: '/checkout',
        capabilityIds: ['checkout_flow'],
      },
    ],
  });
  const parsed = JSON.parse(json);

  assert.equal(parsed.identity.siteId, 'site_123');
  assert.equal(parsed.actions[0].capabilityId, 'checkout_flow');
  assert.equal(parsed.pages[0].pageId, 'checkout');
  assert.equal(parsed.display.mode, 'beacon');
  assert.equal(parsed.currentPage.pageId, 'home');
  assert.equal(parsed.artifacts.roverSiteUrl, '/.well-known/rover-site.json');
});
