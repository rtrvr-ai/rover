/*
  Website-level Rover config (script-tag style).
  In a real site, owners would set this once in their HTML template.
*/
window.__ROVER_WEBSITE_CONFIG__ = {
  // Paste your RTRVR API key here for demo usage.
  apiKey: 'rtrvr_drCfCgfsaNkES8ydNbmub62gfZCMIi79JyaM9vH0atQ',

  // Change if you want to point to another backend.
  apiBase: 'https://us-central1-rtrvr-extension-functions.cloudfunctions.net', //'http://127.0.0.1:5002/rtrvr-extension-functions/us-central1'

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
    // mascot: {
    //   disabled: false,
    //   mp4Url: 'https://your-cdn.com/mascot.mp4',
    //   webmUrl: 'https://your-cdn.com/mascot.webm',
    // },
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
