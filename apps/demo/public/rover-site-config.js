/*
  Website-level Rover config (script-tag style).
  In a real site, owners would set this once in their HTML template.
*/
window.__ROVER_WEBSITE_CONFIG__ = {
  publicKey: 'pk_site_rDrv_-RJYW94TifVQhm6FAg0s137riGTjGa-tJMTuSo',
  siteKeyId: '4832cb5f-90e3-404d-914e-9d77d60a50fa',

  // Change if you want to point to another backend.
  apiBase: 'https://extensionrouter.rtrvr.ai', //'http://127.0.0.1:5002/rtrvr-extension-functions/us-central1'

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
