(() => {
  const payload = {
    type: 'ROVER_PREVIEW_HELPER_PAGE_READY',
    url: location.href,
    host: location.hostname,
  };

  try {
    chrome.runtime.sendMessage(payload);
  } catch {
    // Background may not be ready yet. The navigation hooks will catch up.
  }
})();
