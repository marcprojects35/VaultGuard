// VaultGuard Background Service Worker
const API_BASE_KEY = 'vaultguard_server_url';
const API_TOKEN_KEY = 'vaultguard_api_token';

// Escuta mensagens de content scripts e popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SERVER_CONFIG') {
    chrome.storage.local.get([API_BASE_KEY, API_TOKEN_KEY], (data) => {
      sendResponse({ serverUrl: data[API_BASE_KEY], apiToken: data[API_TOKEN_KEY] });
    });
    return true; // async response
  }

  if (message.type === 'FETCH_CREDS_FOR_URL') {
    handleFetchCredsForUrl(message.url).then(sendResponse).catch(() => sendResponse([]));
    return true;
  }
});

async function handleFetchCredsForUrl(url) {
  const { [API_BASE_KEY]: serverUrl, [API_TOKEN_KEY]: apiToken } = await chrome.storage.local.get([API_BASE_KEY, API_TOKEN_KEY]);
  if (!serverUrl || !apiToken) return [];
  try {
    const res = await fetch(`${serverUrl}/api/credentials/search/by-url?url=${encodeURIComponent(url)}`, {
      headers: { 'X-API-Token': apiToken }
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
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch { /* silently fail */ }
}
