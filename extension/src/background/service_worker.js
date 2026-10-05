// VaultGuard Background Service Worker
//
// Tudo que envolve token, chaves ou senhas acontece aqui. O content script só
// recebe o mínimo (títulos/usuários da página atual e, ao preencher, o par
// usuário/senha da credencial escolhida) e o domínio vem sempre de sender.tab.
import {
  STORAGE_SERVER_URL, STORAGE_API_TOKEN, STORAGE_KEYRING, PENDING_SAVE_KEY, PENDING_SAVE_TTL_MS, IDLE_LOCK_MS,
  hostOf, urlMatches, pageOrigin, purgeLegacySecrets, makeApi, loadKeyring,
} from '../shared/security.js';

const STORAGE_AUTOFILL      = 'vaultguard_autofill';       // local: preencher ao abrir (padrão: sim)
const STORAGE_NEVER_SAVE    = 'vaultguard_never_save';     // local: hosts em que não perguntar
const STORAGE_LAST_FOLDER   = 'vaultguard_last_folder';    // local: última pasta escolhida
const STEP_USERNAME_KEY     = 'vaultguard_step_username';  // sessão: usuário digitado na 1ª etapa
const DISMISSED_CERTS_KEY   = 'vaultguard_dismissed_certs';// sessão: avisos de certificado fechados
const STEP_TTL_MS = 5 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => { purgeLegacySecrets(); });
chrome.runtime.onStartup.addListener(() => { purgeLegacySecrets(); });

// ─── Janela do VaultGuard ─────────────────────────────────────────────────────

// O service worker é suspenso pelo Chrome a qualquer momento: a janela já
// aberta é encontrada pela URL, não por uma variável em memória
async function openVaultWindow(hash = '') {
  const base = chrome.runtime.getURL('popup.html');
  const url = base + (hash ? `#${hash}` : '');
  // (padrões de URL do tabs.query não aceitam chrome-extension://: filtra a lista)
  const existing = (await chrome.tabs.query({}).catch(() => [])).find(t => t.url?.startsWith(base));
  if (existing) {
    if (hash) await chrome.tabs.update(existing.id, { url });
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
    return;
  }
  await chrome.windows.create({ url, type: 'popup', width: 400, height: 680, focused: true });
}

chrome.action.onClicked.addListener(() => { openVaultWindow(); });

// ─── Utilitários ──────────────────────────────────────────────────────────────

async function getApi() {
  const stored = await chrome.storage.local.get([STORAGE_SERVER_URL, STORAGE_API_TOKEN]);
  if (!stored[STORAGE_SERVER_URL] || !stored[STORAGE_API_TOKEN]) return null;
  return makeApi(stored[STORAGE_SERVER_URL], stored[STORAGE_API_TOKEN]);
}

// A própria interface do VaultGuard: a extensão não age nela (não captura a
// senha do cofre nem oferece salvá-la dentro dele)
async function isVaultGuardPage(url) {
  const server = (await chrome.storage.local.get(STORAGE_SERVER_URL))[STORAGE_SERVER_URL];
  return !!server && pageOrigin(url) === pageOrigin(server);
}

// Desbloqueado e dentro do tempo de inatividade (sem contar como uso).
// Expirou: apaga as chaves da memória na hora
async function isUnlocked() {
  const data = (await chrome.storage.session.get(STORAGE_KEYRING))[STORAGE_KEYRING];
  if (!data?.session) return false;
  if (!data.lastUsed || Date.now() - data.lastUsed > IDLE_LOCK_MS) {
    await chrome.storage.session.remove(STORAGE_KEYRING);
    return false;
  }
  return true;
}

async function getLocal(key, fallback) {
  const v = (await chrome.storage.local.get(key))[key];
  return v === undefined ? fallback : v;
}

async function getSession(key) {
  return (await chrome.storage.session.get(key))[key];
}

// Credenciais que valem para a página (o servidor só recebe a origem).
// Cache curto por origem: badge e página pedem a mesma coisa ao carregar
const CREDS_CACHE_MS = 5 * 1000;
const credsCache = new Map(); // origin -> { at, list }

async function credentialsFor(url, api) {
  const origin = pageOrigin(url);
  if (!origin || !api) return [];
  let entry = credsCache.get(origin);
  if (!entry || Date.now() - entry.at > CREDS_CACHE_MS) {
    const list = await api.get(`/credentials/search/by-url?url=${encodeURIComponent(origin)}`);
    entry = { at: Date.now(), list: list || [] };
    credsCache.set(origin, entry);
    if (credsCache.size > 200) credsCache.delete(credsCache.keys().next().value);
  }
  return entry.list.filter(c => urlMatches(c.url, url));
}

const invalidateCreds = (url) => credsCache.delete(pageOrigin(url));

async function writableFolders(api) {
  try { return await api.get('/folders/writable'); } catch { return []; }
}

async function getPending(tabUrl) {
  const pending = await getSession(PENDING_SAVE_KEY);
  if (!pending) return null;
  if (Date.now() - pending.savedAt > PENDING_SAVE_TTL_MS) {
    await chrome.storage.session.remove(PENDING_SAVE_KEY);
    return null;
  }
  if (tabUrl && hostOf(pending.url) !== hostOf(tabUrl)) return null;
  return pending;
}

// Versão do pedido de salvar que vai para a página: sem a senha
function promptForPage(pending) {
  const { password, ...rest } = pending;
  return rest;
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

// Captura em andamento por aba: se o site navega logo após o envio, a página
// nova pergunta pelo pedido antes de a captura terminar e precisa esperá-la
const inflightCapture = new Map();

const handlers = {
  // Estado da página ao carregar: credenciais, certificados, preferências
  async PAGE_INFO(_msg, tabUrl) {
    const api = await getApi();
    if (!api || !pageOrigin(tabUrl) || await isVaultGuardPage(tabUrl)) return { configured: false };
    const creds = await credentialsFor(tabUrl, api).catch(() => []);
    const step = await getSession(STEP_USERNAME_KEY);
    const dismissed = (await getSession(DISMISSED_CERTS_KEY)) || [];
    const pick = (c) => ({ id: c.id, title: c.title, username: c.username || '', expiresAt: c.expiresAt || null });
    return {
      configured: true,
      unlocked: await isUnlocked(),
      autofill: await getLocal(STORAGE_AUTOFILL, true),
      logins: creds.filter(c => c.kind !== 'certificate').map(pick),
      certs: dismissed.includes(hostOf(tabUrl)) ? [] : creds.filter(c => c.kind === 'certificate').map(pick),
      stepUsername: step && step.host === hostOf(tabUrl) && Date.now() - step.at < STEP_TTL_MS ? step.username : '',
    };
  },

  // Preencher uma credencial escolhida (ou automática)
  async FILL_CREDENTIAL(msg, tabUrl) {
    const api = await getApi();
    if (!api) return { error: 'not_configured' };
    if (!(await isUnlocked())) {
      if (msg.interactive) openVaultWindow();
      return { error: 'locked' };
    }
    const detail = await api.get(`/credentials/${encodeURIComponent(msg.credId)}?context=${msg.interactive ? 'view' : 'autofill'}`);
    if (!urlMatches(detail.url, tabUrl)) return { error: 'domain_mismatch' };
    if (!(await isUnlocked())) {
      if (msg.interactive) openVaultWindow();
      return { error: 'locked' };
    }
    const keyring = await loadKeyring(api);
    try {
      const password = await keyring.decryptValue(detail, detail.encryptedPass);
      return { username: detail.username || '', password: msg.usernameOnly ? '' : password };
    } catch {
      return { error: 'decrypt_failed' };
    }
  },

  // 1ª etapa de login em duas telas (só o usuário): guarda para a 2ª
  async REMEMBER_USERNAME(msg, tabUrl) {
    const username = String(msg.username || '').slice(0, 256);
    if (!username || !pageOrigin(tabUrl)) return null;
    await chrome.storage.session.set({ [STEP_USERNAME_KEY]: { host: hostOf(tabUrl), username, at: Date.now() } });
    return null;
  },

  // Login enviado: decide entre salvar, atualizar ou não perguntar nada
  async CAPTURE_LOGIN(msg, tabUrl) {
    const api = await getApi();
    const password = String(msg.password || '');
    if (!api || !pageOrigin(tabUrl) || !password || password.length > 1024) return null;
    if (await isVaultGuardPage(tabUrl)) return null;
    const never = await getLocal(STORAGE_NEVER_SAVE, []);
    if (never.includes(hostOf(tabUrl))) return null;

    let username = String(msg.username || '').slice(0, 256);
    const step = await getSession(STEP_USERNAME_KEY);
    if (!username && step && step.host === hostOf(tabUrl) && Date.now() - step.at < STEP_TTL_MS) username = step.username;

    const creds = (await credentialsFor(tabUrl, api).catch(() => [])).filter(c => c.kind !== 'certificate');
    const sameUser = creds.filter(c => (c.username || '').toLowerCase() === username.toLowerCase());
    const unlocked = await isUnlocked();

    let type = 'save';
    let target = null;
    if (unlocked) {
      const keyring = await loadKeyring(api);
      for (const c of (username ? sameUser : creds)) {
        try {
          const detail = await api.get(`/credentials/${c.id}?context=compare`);
          if ((await keyring.decryptValue(detail, detail.encryptedPass)) === password) return null; // já salva
        } catch { /* sem acesso: segue */ }
      }
      if (username && sameUser.length) { type = 'update'; target = sameUser[0]; }
      // Troca de senha sem campo de usuário na tela: se o site tem uma única
      // credencial, é ela que mudou (não cria uma duplicada)
      else if (!username && creds.length === 1) { type = 'update'; target = creds[0]; username = creds[0].username || ''; }
    } else if (sameUser.length) {
      // Bloqueado não dá para comparar: não incomoda quem já tem a credencial
      return null;
    }

    const pending = {
      type,
      username,
      password,
      url: tabUrl,
      host: hostOf(tabUrl),
      // Nome do site (como o Chrome), não o título da página ("Entrar | Loja")
      title: hostOf(tabUrl),
      credId: target?.id || null,
      credTitle: target?.title || null,
      locked: !unlocked,
      folders: type === 'save' ? await writableFolders(api) : [],
      lastFolderId: await getLocal(STORAGE_LAST_FOLDER, null),
      savedAt: Date.now(),
    };
    await chrome.storage.session.set({ [PENDING_SAVE_KEY]: pending });
    return promptForPage(pending);
  },

  // Página nova depois do envio (navegação): mostra o pedido pendente
  async GET_PROMPT(_msg, tabUrl, tabId) {
    const inflight = inflightCapture.get(tabId);
    if (inflight) await Promise.race([inflight, new Promise(r => setTimeout(r, 8000))]);
    const pending = await getPending(tabUrl);
    return pending ? promptForPage(pending) : null;
  },

  async SAVE_PENDING(msg, tabUrl) {
    const pending = await getPending(tabUrl);
    if (!pending) return { error: 'expired' };
    const api = await getApi();
    if (!api) return { error: 'not_configured' };
    if (!(await isUnlocked())) {
      // A janela do VaultGuard abre o mesmo pedido depois do desbloqueio
      openVaultWindow();
      return { needsUnlock: true };
    }
    const folderId = String(msg.folderId || '');
    const allowed = await writableFolders(api);
    if (!allowed.some(f => f.id === folderId)) return { error: 'Escolha uma pasta em que você pode salvar' };
    try {
      const keyring = await loadKeyring(api);
      const { payload } = await keyring.buildCredentialPayload({ folderId, password: pending.password, customFields: [] });
      await api.post('/credentials', {
        title: pending.title, username: pending.username, url: pageOrigin(pending.url), folderId, ...payload,
      });
      await chrome.storage.local.set({ [STORAGE_LAST_FOLDER]: folderId });
      await chrome.storage.session.remove([PENDING_SAVE_KEY, STEP_USERNAME_KEY]);
      invalidateCreds(pending.url);
      return { ok: true };
    } catch (e) {
      return { error: e.code ? e.message : 'Não foi possível salvar' };
    }
  },

  async UPDATE_PENDING(_msg, tabUrl) {
    const pending = await getPending(tabUrl);
    if (!pending?.credId) return { error: 'expired' };
    const api = await getApi();
    if (!api) return { error: 'not_configured' };
    if (!(await isUnlocked())) { openVaultWindow(); return { needsUnlock: true }; }
    try {
      const keyring = await loadKeyring(api);
      const detail = await api.get(`/credentials/${pending.credId}?context=compare`);
      if (!urlMatches(detail.url, tabUrl)) return { error: 'domain_mismatch' };
      const { payload } = await keyring.buildCredentialPayload({ existing: detail, password: pending.password, customFields: detail.customFields || [] });
      await api.put(`/credentials/${pending.credId}`, payload);
      await chrome.storage.session.remove([PENDING_SAVE_KEY, STEP_USERNAME_KEY]);
      invalidateCreds(pending.url);
      return { ok: true };
    } catch (e) {
      return { error: e.status === 403 ? 'Você não tem permissão para editar esta credencial' : (e.code ? e.message : 'Não foi possível atualizar') };
    }
  },

  async DISMISS_PROMPT() {
    await chrome.storage.session.remove(PENDING_SAVE_KEY);
    return null;
  },

  async NEVER_SAVE(_msg, tabUrl) {
    const host = hostOf(tabUrl);
    const never = await getLocal(STORAGE_NEVER_SAVE, []);
    if (host && !never.includes(host)) await chrome.storage.local.set({ [STORAGE_NEVER_SAVE]: [...never, host].slice(-500) });
    await chrome.storage.session.remove(PENDING_SAVE_KEY);
    return null;
  },

  async DISMISS_CERT(_msg, tabUrl) {
    const list = (await getSession(DISMISSED_CERTS_KEY)) || [];
    const host = hostOf(tabUrl);
    if (host && !list.includes(host)) await chrome.storage.session.set({ [DISMISSED_CERTS_KEY]: [...list, host] });
    return null;
  },

  async OPEN_POPUP(msg) {
    const view = msg.view === 'certs' ? `certs${msg.credId ? `:${encodeURIComponent(msg.credId)}` : ''}` : '';
    await openVaultWindow(view);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Só aceita mensagens de content scripts em abas (o popup fala direto com a API)
  if (!sender.tab || sender.id !== chrome.runtime.id) return;
  const handler = handlers[message?.type];
  if (!handler) return;
  const tabId = sender.tab.id;
  const run = handler(message, sender.tab.url || '', tabId);
  if (message.type === 'CAPTURE_LOGIN') {
    const p = run.catch(() => null).finally(() => { if (inflightCapture.get(tabId) === p) inflightCapture.delete(tabId); });
    inflightCapture.set(tabId, p);
  }
  run.then(sendResponse).catch(() => sendResponse(null));
  return true;
});

// ─── Badge ────────────────────────────────────────────────────────────────────

async function updateBadge(tabId, url) {
  try {
    if (!pageOrigin(url) || await isVaultGuardPage(url)) { chrome.action.setBadgeText({ text: '', tabId }); return; }
    const creds = await credentialsFor(url, await getApi());
    chrome.action.setBadgeText({ text: creds.length ? String(creds.length) : '', tabId });
    if (creds.length) chrome.action.setBadgeBackgroundColor({ color: '#C78C00', tabId });
  } catch { /* silencioso */ }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) updateBadge(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) updateBadge(tabId, tab.url);
});
