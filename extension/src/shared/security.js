import { Keyring } from '../../../frontend/src/utils/keyring.js';

// Utilitários compartilhados entre service worker e popup

export const STORAGE_SERVER_URL = 'vaultguard_server_url';
export const STORAGE_API_TOKEN  = 'vaultguard_api_token';
// Chaves desbloqueadas e senha pendente ficam em chrome.storage.session: só em
// memória, somem ao fechar o navegador e não são acessíveis por content scripts
export const STORAGE_KEYRING    = 'vaultguard_keyring';
export const PENDING_SAVE_KEY   = 'vaultguard_pending_save';
// Versões antigas guardavam a chave mestra em disco
const LEGACY_MASTER_KEY = 'vaultguard_master_key';
export const PENDING_SAVE_TTL_MS = 5 * 60 * 1000;
// Cofre desbloqueado bloqueia sozinho após este tempo sem uso
export const IDLE_LOCK_MS = 30 * 60 * 1000;
// Senha copiada é apagada da área de transferência depois disto
export const CLIPBOARD_CLEAR_MS = 30 * 1000;

export function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

export function hostOf(url) {
  try {
    return normalizeHost(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname);
  } catch {
    return '';
  }
}

// Mesmo hostname, ou um é subdomínio do outro (nunca substring solta)
export function hostMatches(credUrl, siteHost) {
  const credHost = hostOf(credUrl || '');
  const site = normalizeHost(siteHost);
  if (!credHost || !site) return false;
  return credHost === site || site.endsWith('.' + credHost) || credHost.endsWith('.' + site);
}

// Credencial salva para https nunca é preenchida numa página http do mesmo
// site (rede hostil poderia servir a versão sem TLS e capturar a senha)
export function schemeOk(credUrl, pageUrl) {
  const credHttps = /^https:\/\//i.test(String(credUrl || '').trim());
  const pageHttp = /^http:\/\//i.test(String(pageUrl || ''));
  return !(credHttps && pageHttp);
}

function explicitPort(url) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return u.port || null;
  } catch { return null; }
}

/**
 * A credencial vale para esta página? Domínio (ou subdomínio), sem rebaixar
 * https para http e, se a credencial fixa uma porta, a mesma porta.
 */
export function urlMatches(credUrl, pageUrl) {
  if (!hostMatches(credUrl, hostOf(pageUrl))) return false;
  if (!schemeOk(credUrl, pageUrl)) return false;
  const credPort = explicitPort(credUrl);
  return !credPort || credPort === explicitPort(pageUrl);
}

/** Só esquema + host + porta: caminho e query podem ter tokens e não saem daqui. */
export function pageOrigin(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch { return ''; }
}

/** Servidor em http fora da própria máquina: o token trafegaria sem criptografia. */
export function isInsecureServer(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(u.hostname);
  } catch { return false; }
}

// Remove segredos que versões antigas gravavam em disco (chrome.storage.local)
export async function purgeLegacySecrets() {
  await chrome.storage.local.remove([LEGACY_MASTER_KEY, PENDING_SAVE_KEY]);
  await chrome.storage.session.remove(LEGACY_MASTER_KEY);
}

// ─── Keyring (mesmo código do cofre web) ────────────────────────────────────

export function makeApi(serverUrl, apiToken) {
  const call = async (method, path, body) => {
    const res = await fetch(`${serverUrl}/api${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${apiToken}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* */ }
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return res.json();
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
  };
}

/**
 * Keyring desbloqueado a partir da sessão em memória (ou bloqueado, se não
 * houver ou se passou do tempo sem uso). Cada carregamento conta como uso.
 */
export async function loadKeyring(api) {
  const keyring = new Keyring(api);
  const data = (await chrome.storage.session.get(STORAGE_KEYRING))[STORAGE_KEYRING];
  if (!data?.session) return keyring;
  if (!data.lastUsed || Date.now() - data.lastUsed > IDLE_LOCK_MS) {
    await clearKeyring();
    return keyring;
  }
  try {
    await keyring.importSession(data.session);
    await chrome.storage.session.set({ [STORAGE_KEYRING]: { ...data, lastUsed: Date.now() } });
  } catch { keyring.lock(); }
  return keyring;
}

export async function saveKeyring(keyring) {
  await chrome.storage.session.set({ [STORAGE_KEYRING]: { session: await keyring.exportSession(), lastUsed: Date.now() } });
}

export async function clearKeyring() {
  await chrome.storage.session.remove(STORAGE_KEYRING);
}
