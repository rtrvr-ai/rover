(() => {
  const state = window.__ROVER_PREVIEW_HELPER_STATE__;
  if (!state || window.__ROVER_PREVIEW_HELPER_BOOTSTRAPPED__) return;
  window.__ROVER_PREVIEW_HELPER_BOOTSTRAPPED__ = true;

  const currentHost = String(location.hostname || '').toLowerCase();
  const allowed = Array.isArray(state.allowedDomains) ? state.allowedDomains : [];
  const explicitHost = String(state.targetHost || '').toLowerCase();
  if (explicitHost && explicitHost !== currentHost) {
    return;
  }

  const launchUrl = String(state.launchUrl || '').trim();
  if (launchUrl) {
    try {
      const next = new URL(launchUrl, location.href);
      history.replaceState(history.state, '', next.toString());
    } catch {
      // Ignore URL normalization failures and keep current location.
    }
  } else if (state.requestId && state.attachToken) {
    const next = new URL(location.href);
    next.searchParams.set('rover_launch', state.requestId);
    next.searchParams.set('rover_attach', state.attachToken);
    history.replaceState(history.state, '', next.toString());
  }

  const apiBase = String(state.apiBase || 'https://agent.rtrvr.ai').trim() || 'https://agent.rtrvr.ai';
  const embedUrl = String(state.embedScriptUrl || 'https://rover.rtrvr.ai/embed.js').trim() || 'https://rover.rtrvr.ai/embed.js';
  const siteId = String(state.siteId || '').trim();
  const publicKey = String(state.publicKey || '').trim();
  const sessionToken = String(state.sessionToken || '').trim();
  const siteKeyId = String(state.siteKeyId || '').trim();
  const workerUrl = String(state.workerUrl || '').trim();
  const domainScopeMode = state.domainScopeMode === 'host_only' ? 'host_only' : 'registrable_domain';
  const allowedDomains = allowed.length ? allowed : [location.hostname];

  const rover = window.rover = window.rover || function () {
    (rover.q = rover.q || []).push(arguments);
  };
  rover.l = +new Date();

  const bootConfig = {
    siteId,
    apiBase,
    allowedDomains,
    domainScopeMode,
    openOnInit: state.openOnInit !== false,
    ui: {
      muted: true,
    },
  };
  if (publicKey) bootConfig.publicKey = publicKey;
  if (sessionToken) bootConfig.sessionToken = sessionToken;
  if (siteKeyId) bootConfig.siteKeyId = siteKeyId;
  if (workerUrl) bootConfig.workerUrl = workerUrl;
  if (state.externalNavigationPolicy) bootConfig.externalNavigationPolicy = state.externalNavigationPolicy;
  if (state.mode) bootConfig.mode = state.mode;
  if (typeof state.allowActions === 'boolean') bootConfig.allowActions = state.allowActions;

  rover('boot', bootConfig);

  if (!document.querySelector(`script[data-rover-preview-helper="${state.bootstrapId || '1'}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = embedUrl;
    script.dataset.roverPreviewHelper = String(state.bootstrapId || '1');
    script.crossOrigin = 'anonymous';
    document.documentElement.appendChild(script);
  }

  delete window.__ROVER_PREVIEW_HELPER_STATE__;
})();
