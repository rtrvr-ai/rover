/*
  Website-level Rover config (script-tag style).
  In a real site, owners would set this once in their HTML template.

  To get your own keys, sign up at https://rtrvr.ai
*/
window.__ROVER_WEBSITE_CONFIG__ = {
  siteId: 'localhost-04-27-cquU3w',
  publicKey: 'pk_site_9sZgZAWV6ptzNVN5rtxufW-w_LXjPLC_ffj5P-2AR8c',
  siteKeyId: '75eb48c2-fbb6-4d1f-a1a5-fbb51200dcdb',

  // Change if you want to point to another backend.
  apiBase: 'https://agent.rtrvr.ai',

  // Stable visitor identity for cross-subdomain checkpoint restore.
  // In production this should come from your own session/user identity.
  visitorId: 'demo-visitor-001',

  // Scope policy: Rover uses built-in smart tab behavior for navigation.
  allowedDomains: ['localhost'],
  domainScopeMode: 'registrable_domain',
  cloudSandboxEnabled: true,

  // Optional branding config for embedded widget.
  ui: {
    agent: {
      name: 'Rover',
    },
    experience: {
      motion: {
        actionSpotlight: true,
      },
    },
  },

  pageConfig: {
    disableAutoScroll: true,
  },

  // Enable external page-data fetch via cloud scrape (best-effort).
  tools: {
    web: {
      enableExternalWebContext: true,
      scrapeMode: 'on_demand',
    },
  },

  // Runtime-injected discovery surfaces stay on the A2W contract.
  agentDiscovery: {
    enabled: true,
    siteUrl: 'https://localhost/',
    siteName: 'Rover Production',
    description: 'Structured Rover entrypoints for Rover Production. Prefer the published shortcuts and explicit tools over raw DOM automation whenever they match the user goal.',
    agentCardUrl: '/.well-known/agent-card.json',
    roverSiteUrl: '/.well-known/rover-site.json',
    llmsUrl: '/llms.txt',
    preferExecution: 'auto',
    aiAccess: {
      enabled: true,
      allowCloudBrowser: true,
      allowDelegatedHandoffs: false,
    },
    discoverySurface: {
      mode: 'beacon',
      branding: 'site',
      hostSurface: 'auto',
      actionReveal: 'click',
      beaconLabel: 'Do it with Rover',
      agentModeEntryHints: [
        'Use the page beacon or A2W run endpoint before attempting generic DOM automation.',
        'When Rover is already active, prefer the current-page actions over screenshot loops.',
      ],
    },
  },
};
