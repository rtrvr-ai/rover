import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoverAgentCard,
  createRoverAgentDiscoveryTags,
  createRoverServiceDescLinkHeader,
  createRoverWellKnownAgentCard,
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
      allowPromptLaunch: true,
      allowShortcutLaunch: true,
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
        name: 'rover_run_task',
        title: 'Run Rover Task',
        description: 'Run a structured Rover task on this site.',
        schema: {
          type: 'object',
          properties: {
            task: { type: 'string' },
          },
          required: ['task'],
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
  assert.equal(card.url, 'https://agent.rtrvr.ai/v1/tasks');
  assert.equal(card.capabilities.publicTasks, true);
  assert.equal(card.capabilities.delegatedHandoffs, true);
  assert.equal(card.capabilities.webmcp, true);
  assert.equal(card.extensions.rover.preferredExecution, 'cloud');
  assert.equal(card.skills.length, 3);

  const checkoutSkill = card.skills.find(skill => skill.id === 'start_checkout');
  assert.equal(checkoutSkill.category, 'primary');
  assert.equal(checkoutSkill.preferredInterface, 'shortcut');
  assert.equal(checkoutSkill.rover.task.endpoint, 'https://agent.rtrvr.ai/v1/tasks');
  assert.equal(checkoutSkill.rover.task.payload.shortcut, 'start_checkout');

  const reviewTool = card.skills.find(skill => skill.id === 'roverbook_leave_review');
  assert.equal(reviewTool.category, 'secondary');
  assert.equal(reviewTool.preferredInterface, 'client_tool');
  assert.match(reviewTool.description, /When to use:/);

  const webmcpTool = card.skills.find(skill => skill.id === 'rover_run_task');
  assert.equal(webmcpTool.preferredInterface, 'webmcp');
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
