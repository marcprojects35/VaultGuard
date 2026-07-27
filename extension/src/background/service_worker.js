// VaultGuard Background Service Worker
const STORAGE_SERVER_URL = 'vaultguard_server_url';
const STORAGE_API_TOKEN  = 'vaultguard_api_token';

// Abrir side panel ao clicar no ícone da extensão
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SERVER_CONFIG') {
    chrome.storage.local.get([STORAGE_SERVER_URL, STORAGE_API_TOKEN], (data) => {
      sendResponse({ serverUrl: data[STORAGE_SERVER_URL], apiToken: data[STORAGE_API_TOKEN] });
    });
    return true;
  }

  if (message.type === 'FETCH_CREDS_FOR_URL') {
    handleFetchCredsForUrl(message.url).then(sendResponse).catch(() => sendResponse([]));
    return true;
  }

  if (message.type === 'OPEN_SIDE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return true;
  }
});

async function handleFetchCredsForUrl(url) {
  const stored = await chrome.storage.local.get([STORAGE_SERVER_URL, STORAGE_API_TOKEN]);
  const serverUrl = stored[STORAGE_SERVER_URL];
  const apiToken  = stored[STORAGE_API_TOKEN];
  if (!serverUrl || !apiToken) return [];
  try {
    const res = await fetch(`${serverUrl}/api/credentials/search/by-url?url=${encodeURIComponent(url)}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// Badge com contagem de credenciais para o site ativo
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  updateBadge(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadge(tabId, tab.url);
  }
});

async function updateBadge(tabId, url) {
  try {
    const creds = await handleFetchCredsForUrl(url);
    const count = creds.length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#C78C00', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch { /* silently fail */ }
}
