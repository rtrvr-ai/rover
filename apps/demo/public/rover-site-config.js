/*
  Website-level Rover config (script-tag style).
  In a real site, owners would set this once in their HTML template.

  To get your own keys, sign up at https://rtrvr.ai
*/
window.__ROVER_WEBSITE_CONFIG__ = {
  publicKey: 'pk_site_YOUR_PUBLIC_KEY_HERE',
  siteKeyId: 'YOUR_SITE_KEY_ID_HERE',

  // Change if you want to point to another backend.
  apiBase: 'https://agent.rtrvr.ai',

  // Stable visitor identity for cross-subdomain checkpoint restore.
  // In production this should come from your own session/user identity.
  visitorId: 'demo-visitor-001',

  // Demo policy: keep same-tab scope guardrails active.
  domainScopeMode: 'registrable_domain',
  externalNavigationPolicy: 'open_new_tab_notice',

  // Optional branding config for embedded widget.
  ui: {
    agent: {
      name: 'Rover',
    },
  },

  // Enable external page-data fetch via cloud scrape (best-effort).
  tools: {
    web: {
      enableExternalWebContext: true,
      scrapeMode: 'on_demand',
      allowDomains: ['*'],
      denyDomains: [],
    },
  },
};
