(() => {
  const availabilityMessage = {
    type: 'ROVER_PREVIEW_HELPER_AVAILABLE',
    source: 'rover-preview-helper',
    version: chrome.runtime.getManifest?.().version || '',
  };

  const announceAvailability = () => {
    try {
      window.postMessage(availabilityMessage, '*');
    } catch {
      // Ignore page messaging failures on locked-down pages.
    }
  };

  const payload = {
    type: 'ROVER_PREVIEW_HELPER_PAGE_READY',
    url: location.href,
    host: location.hostname,
  };

  announceAvailability();

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (String(event.data?.type || '') !== 'ROVER_PREVIEW_HELPER_PING') return;
    announceAvailability();
  });

  try {
    chrome.runtime.sendMessage(payload);
  } catch {
    // Background may not be ready yet. The navigation hooks will catch up.
  }
})();
