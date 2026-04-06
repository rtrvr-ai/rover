import {
  extractPreviewLaunchParams,
  extractHelperConfigFragment,
  hasHelperConfigFragment,
  isHostAllowed,
  normalizeConfig,
  normalizeHost,
  serializeConfigForSeed,
  STORAGE_KEY_PREFIX,
  stripPreviewLaunchParams,
} from './shared.js';

const inMemoryState = new Map();
const pendingInjects = new Map();
const STATUS_KEY_PREFIX = 'rover-preview-helper:status:';

function storageKey(tabId) {
  return `${STORAGE_KEY_PREFIX}${tabId}`;
}

function statusKey(tabId) {
  return `${STATUS_KEY_PREFIX}${tabId}`;
}

async function getSessionValue(key) {
  return await chrome.storage.session.get(key);
}

async function setSessionValue(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

async function removeSessionValue(key) {
  await chrome.storage.session.remove(key);
}

async function readState(tabId) {
  const memory = inMemoryState.get(tabId);
  if (memory) return memory;
  const stored = await getSessionValue(storageKey(tabId));
  const value = stored[storageKey(tabId)];
  if (value) {
    inMemoryState.set(tabId, value);
    return value;
  }
  return null;
}

async function writeState(tabId, state) {
  inMemoryState.set(tabId, state);
  await setSessionValue(storageKey(tabId), state);
}

async function clearState(tabId) {
  inMemoryState.delete(tabId);
  await removeSessionValue(storageKey(tabId));
}

async function writeStatus(tabId, message) {
  await setSessionValue(statusKey(tabId), String(message || '').trim());
}

async function sanitizeTabUrl(tabId, url) {
  const cleanUrl = stripPreviewLaunchParams(url);
  if (!cleanUrl || cleanUrl === url) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      func: nextUrl => {
        try {
          if (window.location.href !== nextUrl) {
            window.history.replaceState(window.history.state, '', nextUrl);
          }
        } catch {
          // Ignore URL rewrite failures on locked-down pages.
        }
      },
      args: [cleanUrl],
    });
  } catch {
    // If this fails, the preview still works; the params just remain visible.
  }
}

async function fetchPreviewConfig(params, tabUrl) {
  const apiBase = String(params.apiBase || 'https://agent.rtrvr.ai').replace(/\/+$/, '');
  const response = await fetch(
    `${apiBase}/v2/rover/previews/${encodeURIComponent(params.previewId)}?previewToken=${encodeURIComponent(params.previewToken)}`,
    {
      credentials: 'omit',
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Preview fetch failed (${response.status}).`);
  }

  const payload = await response.json().catch(() => ({}));
  const data = payload?.data || payload || {};
  const fetchedAt = Date.now();
  const helperConfig = normalizeConfig({
    previewId: params.previewId,
    previewToken: params.previewToken,
    ...(data.helperConfig || {}),
    siteId: data.helperConfig?.siteId || data.siteId,
    sessionToken: data.helperConfig?.sessionToken || data.runtimeSessionToken,
    sessionTokenExpiresAt: data.runtimeSessionTokenExpiresAt || data.helperConfig?.sessionTokenExpiresAt,
    targetUrl: data.helperConfig?.targetUrl || data.targetUrl || tabUrl,
    embedScriptUrl: data.helperConfig?.embedScriptUrl || 'https://rover.rtrvr.ai/embed.js',
    apiBase,
    requestId: data.helperConfig?.requestId || data.activeLaunch?.requestId,
    attachToken: data.helperConfig?.attachToken || data.activeLaunch?.attachToken,
    launchUrl: data.helperConfig?.launchUrl || '',
    previewLabel: data.helperConfig?.previewLabel || `Rover Preview · ${data.host || normalizeHost(tabUrl) || 'site'}`,
    allowedDomains:
      data.helperConfig?.allowedDomains
      || (data.host ? [data.host] : []),
    domainScopeMode: data.helperConfig?.domainScopeMode || 'host_only',
    openOnInit: data.helperConfig?.openOnInit !== false,
    configRefreshedAt: fetchedAt,
  });

  if (!helperConfig.siteId || !helperConfig.sessionToken) {
    throw new Error('Preview response is missing siteId or runtime session token.');
  }

  return helperConfig;
}

function shouldRefreshState(state, nowMs = Date.now()) {
  if (!state?.previewId || !state?.previewToken) return false;
  const refreshedAt = Number(state.configRefreshedAt || 0);
  const sessionTokenExpiresAt = Number(state.sessionTokenExpiresAt || 0);
  if (!refreshedAt) return true;
  if (!sessionTokenExpiresAt) return nowMs - refreshedAt > 15_000;
  if (sessionTokenExpiresAt - nowMs < 60_000) return true;
  return nowMs - refreshedAt > 15_000;
}

async function refreshStateFromBackend(tabId, state, tabUrl, options = {}) {
  if (!state) return null;
  if (!state.previewId || !state.previewToken) return state;
  if (!options.force && !shouldRefreshState(state)) {
    return state;
  }

  const refreshed = await fetchPreviewConfig({
    previewId: state.previewId,
    previewToken: state.previewToken,
    apiBase: state.apiBase,
  }, tabUrl || state.targetUrl || '');
  const targetHost = buildTargetHost(tabUrl || refreshed.targetUrl || state.targetUrl, refreshed) || state.targetHost;
  const shouldLockTargetHost = Boolean(refreshed.previewId && refreshed.previewToken);
  const nextState = normalizeConfig({
    ...state,
    ...refreshed,
    targetHost: shouldLockTargetHost ? targetHost : '',
    configRefreshedAt: Date.now(),
  });
  const persistedState = {
    ...nextState,
    targetHost: shouldLockTargetHost ? targetHost : '',
  };
  await writeState(tabId, persistedState);
  return persistedState;
}

async function maybeHydratePreviewFromUrl(tabId, tabUrl) {
  const params = extractPreviewLaunchParams(tabUrl);
  if (!params) return null;
  const config = await fetchPreviewConfig(params, tabUrl);
  await sanitizeTabUrl(tabId, tabUrl);
  return await injectFromTab(tabId, config);
}

async function maybeHydrateGenericConfigFromUrl(tabId, tabUrl) {
  if (!hasHelperConfigFragment(tabUrl)) return null;
  const rawConfig = extractHelperConfigFragment(tabUrl);
  if (!rawConfig) return null;
  const config = normalizeConfig(rawConfig);
  await sanitizeTabUrl(tabId, tabUrl);
  if (config.previewId && config.previewToken) {
    const previewConfig = await fetchPreviewConfig({
      previewId: config.previewId,
      previewToken: config.previewToken,
      apiBase: config.apiBase,
    }, tabUrl);
    return await injectFromTab(tabId, {
      ...config,
      ...previewConfig,
    });
  }
  return await injectFromTab(tabId, config);
}

function buildTargetHost(tabUrl, fallbackState) {
  const fromTab = normalizeHost(tabUrl);
  if (fromTab) return fromTab;
  return String(fallbackState?.targetHost || '').toLowerCase();
}

function shouldLockStateToTargetHost(state) {
  return Boolean(state?.previewId && state?.previewToken);
}

function canReinjectStateOnUrl(state, url) {
  const host = normalizeHost(url);
  if (!host) return false;
  if (shouldLockStateToTargetHost(state)) {
    return !state.targetHost || state.targetHost === host;
  }
  return isHostAllowed(host, state.allowedDomains, state.domainScopeMode);
}

async function injectMainWorldState(tabId, state) {
  if (!state) return false;
  const signature = `${state.siteId}:${state.publicKey || ''}:${state.sessionToken || ''}:${state.launchUrl || state.requestId || ''}:${state.attachToken || ''}`;
  const existing = pendingInjects.get(tabId);
  if (existing === signature) return true;
  pendingInjects.set(tabId, signature);

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      func: previewState => {
        window.__ROVER_PREVIEW_HELPER_STATE__ = previewState;
      },
      args: [serializeConfigForSeed({
        ...state,
        bootstrapId: signature,
      })],
    });

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      files: ['src/main-world-bootstrap.js'],
    });

    return true;
  } finally {
    pendingInjects.delete(tabId);
  }
}

async function injectFromTab(tabId, config) {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = String(tab.url || '');
  const currentHost = normalizeHost(currentUrl);
  const targetHost = buildTargetHost(currentUrl, config);
  const shouldLockTargetHost = shouldLockStateToTargetHost(config);

  if (!targetHost) {
    throw new Error('Target host is required to inject Rover.');
  }
  if (shouldLockTargetHost && currentHost && targetHost && currentHost !== targetHost) {
    throw new Error(`Tab host mismatch. Expected ${targetHost}, got ${currentHost}.`);
  }
  const normalized = normalizeConfig({
    ...config,
    targetHost: shouldLockTargetHost ? targetHost : '',
  });
  if (!normalized.siteId || (!normalized.publicKey && !normalized.sessionToken)) {
    throw new Error('siteId and either publicKey or sessionToken are required.');
  }
  if (!isHostAllowed(targetHost, normalized.allowedDomains, normalized.domainScopeMode)) {
    throw new Error(`This tab host (${targetHost}) is outside allowedDomains. Update your Workspace config or open a matching host.`);
  }
  const launchUrl = normalized.launchUrl || '';
  const state = {
    ...normalized,
    targetHost: shouldLockTargetHost ? targetHost : '',
    launchUrl,
    bootstrapId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };

  await writeState(tabId, state);
  await injectMainWorldState(tabId, state);
  await writeStatus(tabId, `Rover injected for ${targetHost}.`);

  return state;
}

async function reconnectTab(tabId) {
  const state = await readState(tabId);
  if (!state) throw new Error('No saved preview state for this tab.');
  let refreshed = state;
  try {
    refreshed = await refreshStateFromBackend(tabId, state, state.targetUrl || '', { force: true }) || state;
  } catch {
    refreshed = state;
  }
  return await injectMainWorldState(tabId, refreshed);
}

function getTabIdFromSender(sender) {
  return Number.isFinite(sender?.tab?.id) ? sender.tab.id : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ROVER_PREVIEW_HELPER_PAGE_READY') {
    const tabId = getTabIdFromSender(sender);
    if (tabId === null) return;
    void (async () => {
      const pageUrl = String(message.url || sender?.tab?.url || '');
      if (pageUrl) {
        try {
          const hydrated = await maybeHydratePreviewFromUrl(tabId, pageUrl);
          if (hydrated) return;
        } catch {
          // Fall through to stored-state reconnect.
        }
        try {
          const hydrated = await maybeHydrateGenericConfigFromUrl(tabId, pageUrl);
          if (hydrated) return;
        } catch (error) {
          await sanitizeTabUrl(tabId, pageUrl).catch(() => {});
          await writeStatus(tabId, String(error?.message || error || 'Invalid Rover helper handoff.'));
        }
      }
      const state = await readState(tabId);
      if (!state) return;
      if (pageUrl && !canReinjectStateOnUrl(state, pageUrl)) return;
      try {
        const refreshed = await refreshStateFromBackend(tabId, state, pageUrl).catch(() => state);
        await injectMainWorldState(tabId, refreshed || state);
        await writeStatus(tabId, `Rover reconnected for ${buildTargetHost(pageUrl, refreshed || state) || 'this tab'}.`);
      } catch {
        // Ignore readiness races; tab navigation hooks will retry.
      }
    })();
    return;
  }

  if (message.type === 'ROVER_PREVIEW_HELPER_SET_CONFIG') {
    const tabId = Number(message.tabId);
    const config = normalizeConfig(message.config || {});
    void (async () => {
      const state = await injectFromTab(tabId, config);
      sendResponse({ ok: true, state });
    })().catch(error => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === 'ROVER_PREVIEW_HELPER_INJECT') {
    const tabId = Number(message.tabId);
    const config = normalizeConfig(message.config || {});
    void (async () => {
      const state = await injectFromTab(tabId, config);
      sendResponse({ ok: true, state });
    })().catch(error => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === 'ROVER_PREVIEW_HELPER_RECONNECT') {
    const tabId = Number(message.tabId);
    void (async () => {
      await reconnectTab(tabId);
      sendResponse({ ok: true });
    })().catch(error => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  void clearState(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = String(changeInfo.url || tab.url || '');
  if (!url) return;

  void (async () => {
    try {
      const hydrated = await maybeHydratePreviewFromUrl(tabId, url);
      if (hydrated) return;
    } catch {
      // If hydration fails, fall back to any saved preview state.
    }
    const state = await readState(tabId);
    if (!state) return;
    if (!canReinjectStateOnUrl(state, url)) return;
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
      const refreshed = await refreshStateFromBackend(tabId, state, url).catch(() => state);
      await injectMainWorldState(tabId, refreshed || state);
    }
  })();
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId !== 0) return;
  void (async () => {
    try {
      const hydrated = await maybeHydratePreviewFromUrl(details.tabId, details.url || '');
      if (hydrated) return;
    } catch {
      // Ignore and keep reconnect behavior.
    }
    const state = await readState(details.tabId);
    if (!state) return;
    if (!canReinjectStateOnUrl(state, details.url || '')) return;
    const refreshed = await refreshStateFromBackend(details.tabId, state, details.url || '').catch(() => state);
    await injectMainWorldState(details.tabId, refreshed || state);
  })();
});

chrome.webNavigation.onCompleted.addListener(details => {
  if (details.frameId !== 0) return;
  void (async () => {
    try {
      const hydrated = await maybeHydratePreviewFromUrl(details.tabId, details.url || '');
      if (hydrated) return;
    } catch {
      // Ignore and keep reconnect behavior.
    }
    const state = await readState(details.tabId);
    if (!state) return;
    if (!canReinjectStateOnUrl(state, details.url || '')) return;
    const refreshed = await refreshStateFromBackend(details.tabId, state, details.url || '').catch(() => state);
    await injectMainWorldState(details.tabId, refreshed || state);
  })();
});
