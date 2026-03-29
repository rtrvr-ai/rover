import { normalizeConfig } from './shared.js';

const configEl = document.getElementById('config');
const statusEl = document.getElementById('status');
const injectBtn = document.getElementById('inject');
const reconnectBtn = document.getElementById('reconnect');

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff9a76' : '';
}

async function loadSavedConfig(tabId) {
  const key = `rover-preview-helper:tab:${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const value = stored[key];
  if (value) {
    configEl.value = JSON.stringify(value, null, 2);
    setStatus('Loaded saved Rover or preview config for this tab.');
  }
}

injectBtn.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('No active tab found.');
    const raw = JSON.parse(String(configEl.value || '{}'));
    const config = normalizeConfig(raw);
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_PREVIEW_HELPER_INJECT',
      tabId: tab.id,
      config,
    });
    if (!response?.ok) throw new Error(response?.error || 'Injection failed.');
    configEl.value = JSON.stringify(response.state, null, 2);
    setStatus('Rover injected and preview state saved.');
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
});

reconnectBtn.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('No active tab found.');
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_PREVIEW_HELPER_RECONNECT',
      tabId: tab.id,
    });
    if (!response?.ok) throw new Error(response?.error || 'Reconnect failed.');
    setStatus('Rover reconnect requested.');
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
});

(async () => {
  try {
    const tab = await getActiveTab();
    if (tab?.id) {
      await loadSavedConfig(tab.id);
    }
  } catch {
    // Ignore initial load failures.
  }
})();
