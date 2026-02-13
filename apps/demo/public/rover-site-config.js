/*
  Website-level Rover config (script-tag style).
  In a real site, owners would set this once in their HTML template.
*/
window.__ROVER_WEBSITE_CONFIG__ = {
  // Paste your RTRVR API key here for demo usage.
  apiKey: 'rtrvr_OFhU4O5BolgyFPRAUQ9MNv-sJ0MFXLvpZS7cWshNEFc',

  // Change if you want to point to another backend.
  apiBase: 'https://us-central1-rtrvr-extension-functions.cloudfunctions.net',

  // Stable visitor identity for cross-subdomain checkpoint restore.
  // In production this should come from your own session/user identity.
  visitorId: 'demo-visitor-001',
};
