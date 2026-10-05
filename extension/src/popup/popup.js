// VaultGuard Extension Popup

// ─── Storage keys ──────────────────────────────────────────────────────────
import {
  STORAGE_SERVER_URL, STORAGE_API_TOKEN, PENDING_SAVE_KEY, PENDING_SAVE_TTL_MS,
  purgeLegacySecrets, makeApi, loadKeyring, saveKeyring, clearKeyring,
  hostOf, urlMatches, schemeOk, pageOrigin, isInsecureServer, CLIPBOARD_CLEAR_MS, IDLE_LOCK_MS, STORAGE_KEYRING,
} from '../shared/security.js';
import { Keyring } from '../../../frontend/src/utils/keyring.js';

// ─── State ─────────────────────────────────────────────────────────────────
let state = {
  view: 'loading',       // loading | setup | vault | save-form
  serverUrl: '',
  apiToken: '',
  keyring: null,          // Keyring desbloqueado (chaves só em chrome.storage.session)
  unlocking: false,
  unlockAction: null,
  credentials: [],       // todas as credenciais carregadas
  siteMatches: [],       // credenciais que correspondem ao site atual
  filteredCreds: [],     // lista exibida (após search/filtro)
  showingSiteFilter: false, // true = filtrando por site atual
  currentUrl: '',
  error: null,
  loading: false,
  copied: null,
  saveForm: null,
  tab: 'logins',         // logins | certs
  highlightId: null,     // certificado aberto a partir do aviso na página
  autofill: true,
};

const STORAGE_AUTOFILL    = 'vaultguard_autofill';
const STORAGE_LAST_FOLDER = 'vaultguard_last_folder';
const isCert = (c) => c.kind === 'certificate';

// ─── Utils ─────────────────────────────────────────────────────────────────
function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Inicial do título no lugar de um favicon remoto (que revelaria ao serviço
// de ícones todos os domínios do cofre)
function avatar(c) {
  const letter = escapeHtml((c.title || hostOf(c.url) || '?').trim().charAt(0).toUpperCase() || '?');
  return `<div class="cred-avatar">${letter}</div>`;
}

// O popup roda numa janela própria: a aba do site é a ativa da última janela
// normal focada, não a da janela atual (que é o próprio popup)
const isSitePage = (t) => /^https?:\/\//i.test(t?.url || '');

async function getSiteTab() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (isSitePage(tab)) return tab;
  } catch { /* sem janela normal */ }
  // Aba ativa não é um site (ex.: o próprio VaultGuard aberto numa aba):
  // usa o site acessado mais recentemente
  const tabs = (await chrome.tabs.query({})).filter(isSitePage);
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0] || null;
}

// Preenche a aba do site conferindo se a credencial é dele
async function fillSiteTab(detail, password) {
  const tab = await getSiteTab();
  if (!tab?.id) { showToast('Nenhuma aba de site aberta'); return false; }
  if (!schemeOk(detail.url, tab.url)) {
    showToast('Bloqueado: credencial https em página sem https');
    return false;
  }
  if (!urlMatches(detail.url, tab.url) &&
      !window.confirm(`Esta credencial é de "${hostOf(detail.url) || 'sem site'}", mas a aba aberta é "${hostOf(tab.url)}".\n\nPreencher mesmo assim?`)) {
    return false;
  }
  await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', username: detail.username || '', password });
  return true;
}

function isUnlocked() {
  return !!state.keyring?.isUnlocked;
}

// Relê as chaves da sessão antes de usá-las: aplica o bloqueio por
// inatividade mesmo com a janela aberta há horas (e conta como uso)
async function refreshKeyring() {
  if (!state.serverUrl || !state.apiToken) return false;
  state.keyring = await loadKeyring(makeApi(state.serverUrl, state.apiToken));
  return state.keyring.isUnlocked;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${state.serverUrl}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.apiToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* */ }
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return res.json();
}

// ─── Render ─────────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('root');
  if (state.view === 'loading')   { root.innerHTML = renderLoading(); }
  else if (state.view === 'setup') { root.innerHTML = renderSetup(); }
  else if (state.view === 'save-form') { root.innerHTML = renderSaveForm(); }
  else {
    root.innerHTML = renderVault();
    if (state.unlocking) root.insertAdjacentHTML('beforeend', renderUnlock());
  }
  bindEvents();
}

function renderLoading() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;height:200px;flex-direction:column;gap:12px">
      <div class="spinner"></div>
      <p style="color:#64748b;font-size:13px">Conectando...</p>
    </div>
    <style>
      .spinner{width:24px;height:24px;border:3px solid #1e293b;border-top:3px solid #C78C00;border-radius:50%;animation:spin .7s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style>
  `;
}

function renderSetup() {
  return `
    <div style="padding:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
        <img src="icons/icon48.png" width="32" height="32" style="border-radius:8px;object-fit:contain" />
        <div>
          <h1 style="font-size:16px;font-weight:700;color:#f1f5f9">VaultGuard</h1>
          <p style="font-size:11px;color:#64748b">Configuração inicial</p>
        </div>
      </div>

      ${state.error ? `<div style="background:#fee2e220;border:1px solid #fca5a5;color:#f87171;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:12px">${escapeHtml(state.error)}</div>` : ''}

      <div id="insecureWarn" style="display:${isInsecureServer(state.serverUrl) ? 'block' : 'none'};background:#f59e0b15;border:1px solid #f59e0b44;color:#f59e0b;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:12px">
        ⚠ Servidor sem HTTPS: o token e os dados trafegam sem criptografia na rede. Use https:// fora da própria máquina.
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">URL do Servidor</label>
        <input id="serverUrl" type="text" value="${escapeHtml(state.serverUrl)}" placeholder="https://vault.suaempresa.com"
          style="width:100%;background:#1a1d2e;border:1px solid #1e293b;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box" />
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Token de API</label>
        <input id="apiToken" type="password" value="${escapeHtml(state.apiToken)}" placeholder="vg_xxxxxxxxxxxxxxxx"
          style="width:100%;background:#1a1d2e;border:1px solid #1e293b;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;font-family:monospace;box-sizing:border-box" />
        <p style="font-size:11px;color:#475569;margin-top:4px">Gere em: VaultGuard → Tokens de API</p>
      </div>
      <button id="btnConnect"
        style="width:100%;background:linear-gradient(135deg,#C78C00,#AD7B04);color:white;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;opacity:${state.loading ? '0.7' : '1'}">
        ${state.loading ? 'Conectando...' : 'Conectar'}
      </button>
    </div>
  `;
}

function renderUnlock() {
  return `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px">
      <div style="background:#111111;border:1px solid #252525;border-radius:12px;padding:20px;width:100%;max-width:320px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <svg width="18" height="18" fill="none" stroke="#C78C00" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span style="font-size:14px;font-weight:600;color:#f1f5f9">Desbloquear Cofre</span>
        </div>
        <p style="font-size:12px;color:#64748b;margin-bottom:12px">Digite sua senha do VaultGuard. O cofre bloqueia sozinho após 30 minutos sem uso e ao fechar o navegador.</p>
        ${state.error ? `<div style="background:#fee2e220;border:1px solid #fca5a5;color:#f87171;padding:7px 10px;border-radius:8px;font-size:12px;margin-bottom:10px">${escapeHtml(state.error)}</div>` : ''}
        <input id="unlockPassword" type="password" autofocus placeholder="Senha do VaultGuard"
          style="width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:12px" />
        <div style="display:flex;gap:8px">
          <button id="btnUnlockCancel"
            style="flex:1;background:none;border:1px solid #2A2A2A;border-radius:8px;padding:8px;color:#94a3b8;font-size:13px;cursor:pointer">
            Cancelar
          </button>
          <button id="btnUnlockConfirm"
            style="flex:2;background:linear-gradient(135deg,#C78C00,#AD7B04);border:none;border-radius:8px;padding:8px;color:white;font-size:13px;font-weight:600;cursor:pointer;opacity:${state.loading ? '0.7' : '1'}">
            ${state.loading ? 'Verificando...' : 'Desbloquear'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderVault() {
  const creds  = state.filteredCreds;
  const domain = extractDomain(state.currentUrl);
  const showDomain = domain && !domain.startsWith('chrome') && !domain.startsWith('about') && !state.currentUrl.startsWith('chrome');

  return `
    <div style="display:flex;flex-direction:column;height:100%">
      <!-- Header -->
      <div style="background:#111111;padding:12px 14px;border-bottom:1px solid #1E1E1E;display:flex;align-items:center;gap:8px">
        <img src="icons/icon48.png" width="24" height="24" style="border-radius:6px;object-fit:contain;flex-shrink:0" />
        <span style="font-size:13px;font-weight:700;background:linear-gradient(90deg,#F5F5F3,#C78C00);-webkit-background-clip:text;-webkit-text-fill-color:transparent;flex:1">VaultGuard</span>
        <button id="btnSave" title="Salvar senha da página atual"
          class="icon-btn">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>
        <button id="btnLock" title="Bloquear cofre" class="icon-btn" style="display:${isUnlocked() ? 'flex' : 'none'}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </button>
        <button id="btnSettings" title="Reconfigurar"
          class="icon-btn">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      <!-- Abas -->
      <div style="display:flex;background:#111111;border-bottom:1px solid #1E1E1E">
        <button class="tab-btn ${state.tab === 'logins' ? 'active' : ''}" data-tab="logins">🔑 Logins</button>
        <button class="tab-btn ${state.tab === 'certs' ? 'active' : ''}" data-tab="certs">🔐 Certificados (${state.credentials.filter(isCert).length})</button>
      </div>

      <!-- Search -->
      <div style="padding:10px 14px;border-bottom:1px solid #1E1E1E;background:#111111">
        <div style="position:relative">
          <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#475569" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="searchInput" type="text" placeholder="Buscar em todas as credenciais..."
            style="width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:7px 10px 7px 30px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box" />
        </div>
        ${state.tab === 'logins' && showDomain && state.siteMatches.length > 0 ? `
          <div style="margin-top:8px;display:flex;gap:6px">
            <button id="btnFilterSite"
              style="flex:1;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;border:1px solid ${state.showingSiteFilter ? '#C78C00' : '#2A2A2A'};background:${state.showingSiteFilter ? '#C78C0022' : 'transparent'};color:${state.showingSiteFilter ? '#E7A300' : '#64748b'}">
              🌐 Este site (${state.siteMatches.length})
            </button>
            <button id="btnShowAll"
              style="flex:1;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;border:1px solid ${!state.showingSiteFilter ? '#C78C00' : '#2A2A2A'};background:${!state.showingSiteFilter ? '#C78C0022' : 'transparent'};color:${!state.showingSiteFilter ? '#E7A300' : '#64748b'}">
              📋 Todas (${state.credentials.filter(c => !isCert(c)).length})
            </button>
          </div>
        ` : state.tab === 'logins' && showDomain ? `<div style="margin-top:6px;font-size:11px;color:#475569">Site: <span style="color:#555552">${escapeHtml(domain)}</span> — <span style="color:#64748b">sem matches, mostrando todas</span></div>` : ''}
      </div>

      ${state.loadError ? `<div style="background:#fee2e220;border-bottom:1px solid #fca5a544;color:#f87171;padding:8px 14px;font-size:12px">${escapeHtml(state.loadError)}</div>` : ''}

      <!-- Credential list -->
      <div style="flex:1;overflow-y:auto;background:#0D0D0D">
        ${creds.length === 0 ? `
          <div style="padding:30px 14px;text-align:center;color:#3A3A38">
            <svg style="margin:0 auto 8px;display:block;opacity:0.25" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p style="font-size:13px">Nenhuma credencial encontrada</p>
            ${showDomain ? `<p style="font-size:11px;margin-top:4px;opacity:0.5">para ${escapeHtml(domain)}</p>` : ''}
          </div>
        ` : state.tab === 'certs' ? creds.map((c, i) => renderCertItem(c, i)).join('') : creds.map((c, i) => `
          <div class="cred-item" data-index="${i}" style="padding:10px 14px;border-bottom:1px solid #1A1A1A;cursor:default">
            <div style="display:flex;align-items:center;gap:10px">
              ${avatar(c)}
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title)}</div>
                <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.username || '')}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button class="btn-copy-user" data-index="${i}" title="Copiar usuário"
                  style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;padding:4px 6px;cursor:pointer;color:#94a3b8;font-size:10px;line-height:1">👤</button>
                <button class="btn-copy-pw" data-index="${i}" title="Copiar senha"
                  style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;padding:4px 6px;cursor:pointer;color:#94a3b8;font-size:10px;line-height:1">🔑</button>
                <button class="btn-fill" data-index="${i}" title="Preencher formulário"
                  style="background:linear-gradient(135deg,#C78C00,#AD7B04);border:none;border-radius:6px;padding:4px 8px;cursor:pointer;color:white;font-size:11px;font-weight:700;line-height:1">↗</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Footer -->
      <div style="padding:8px 14px;border-top:1px solid #1E1E1E;display:flex;justify-content:space-between;align-items:center;background:#111111;gap:8px">
        <label style="font-size:11px;color:#64748b;display:flex;align-items:center;gap:5px;cursor:pointer" title="Preenche sozinho quando há uma única senha para o site">
          <input id="autofillToggle" type="checkbox" ${state.autofill ? 'checked' : ''} style="accent-color:#C78C00"> Preencher automaticamente
        </label>
        <button id="btnRefresh" style="background:none;border:none;cursor:pointer;color:#555552;font-size:11px;display:flex;align-items:center;gap:4px">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
          </svg>
          Atualizar
        </button>
      </div>
    </div>

    ${state.copied ? `
      <div style="position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:#22c55e;color:white;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;white-space:nowrap;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4)">
        ✓ ${escapeHtml(state.copied)} copiado!
      </div>
    ` : ''}
  `;
}

function renderCertItem(c, i) {
  let due = '';
  if (c.expiresAt) {
    const d = new Date(c.expiresAt);
    const days = Math.ceil((d - Date.now()) / 86400000);
    const color = days < 0 ? '#f87171' : days <= 30 ? '#f59e0b' : '#64748b';
    due = `<span style="color:${color}">${days < 0 ? 'vencido em' : 'vence'} ${escapeHtml(d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }))}</span>`;
  }
  const hl = state.highlightId === c.id ? 'background:#C78C0014;' : '';
  return `
    <div class="cred-item" data-index="${i}" style="padding:10px 14px;border-bottom:1px solid #1A1A1A;${hl}">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="cred-avatar">🔐</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title)}</div>
          <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.username || '')} ${due}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn-cert-dl" data-index="${i}" title="Baixar arquivo do certificado (.pfx)"
            style="background:linear-gradient(135deg,#C78C00,#AD7B04);border:none;border-radius:6px;padding:4px 8px;cursor:pointer;color:white;font-size:11px;font-weight:700;line-height:1">⬇</button>
          <button class="btn-copy-pw" data-index="${i}" title="Copiar senha do certificado"
            style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;padding:4px 6px;cursor:pointer;color:#94a3b8;font-size:10px;line-height:1">🔑</button>
        </div>
      </div>
    </div>`;
}

// Baixa o(s) anexo(s) do certificado já decifrados (o arquivo só existe em claro aqui)
async function downloadCertificate(cred) {
  const detail = await apiFetch(`/credentials/${cred.id}`);
  const atts = detail.attachments || [];
  if (!atts.length) { showToast('Certificado sem arquivo anexado'); return; }
  for (const att of atts) {
    const { data, fileName, mimeType } = await apiFetch(`/attachments/${cred.id}/${att.id}/download`);
    const bytes = await state.keyring.decryptAttachment(detail, data);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/x-pkcs12' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName || `${cred.title}.pfx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  showToast('Arquivo');
}

function applyTabFilter() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const base = state.credentials.filter(c => (state.tab === 'certs') === isCert(c));
  if (q) {
    state.filteredCreds = base.filter(c =>
      c.title?.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q) || c.url?.toLowerCase().includes(q));
  } else if (state.tab === 'logins' && state.siteMatches.length) {
    state.filteredCreds = state.showingSiteFilter ? state.siteMatches : base;
  } else {
    state.filteredCreds = base;
  }
}

function renderSaveForm() {
  const sf = state.saveForm || {};
  return `
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="background:#111111;padding:12px 14px;border-bottom:1px solid #1E1E1E;display:flex;align-items:center;gap:8px">
        <button id="btnBackToVault" style="background:none;border:none;cursor:pointer;color:#C78C00;padding:2px;display:flex;align-items:center">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span style="font-size:13px;font-weight:700;color:#f1f5f9">Salvar Senha</span>
      </div>
      <div style="padding:16px;flex:1;background:#0D0D0D;overflow-y:auto">
        ${state.error ? `<div style="background:#fee2e220;border:1px solid #fca5a5;color:#f87171;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:12px">${escapeHtml(state.error)}</div>` : ''}

        ${!sf.password ? `
          <div style="background:#f59e0b15;border:1px solid #f59e0b44;color:#f59e0b;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:12px">
            ⚠ Nenhuma senha foi detectada nesta página
          </div>
        ` : ''}

        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Título *</label>
          <input id="saveTitle" type="text" value="${escapeHtml(sf.title || '')}"
            style="width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box" />
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Usuário / E-mail</label>
          <input id="saveUsername" type="text" value="${escapeHtml(sf.username || '')}"
            style="width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box" />
        </div>
        <div style="margin-bottom:16px">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Pasta *</label>
          <select id="saveFolder"
            style="width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box">
            <option value="">Selecione uma pasta...</option>
            ${(sf.folders || []).map(f => `<option value="${escapeHtml(f.id)}" ${f.id === sf.lastFolderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
        </div>
        <button id="btnConfirmSave"
          style="width:100%;background:linear-gradient(135deg,#C78C00,#AD7B04);color:white;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;opacity:${state.loading ? '0.7' : '1'}">
          ${state.loading ? 'Salvando...' : 'Salvar no Cofre'}
        </button>
      </div>
    </div>
  `;
}

// ─── Event binding ──────────────────────────────────────────────────────────
function bindEvents() {
  if (state.view === 'setup') {
    document.getElementById('btnConnect')?.addEventListener('click', handleConnect);
    ['serverUrl', 'apiToken'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') handleConnect(); });
    });
    document.getElementById('serverUrl')?.addEventListener('input', e => {
      document.getElementById('insecureWarn').style.display = isInsecureServer(e.target.value.trim()) ? 'block' : 'none';
    });
  }

  if (state.view === 'vault') {
    if (state.unlocking) {
      document.getElementById('btnUnlockCancel')?.addEventListener('click', () => {
        state.unlocking = false; state.unlockAction = null; state.error = null; render();
      });
      document.getElementById('btnUnlockConfirm')?.addEventListener('click', handleUnlock);
      document.getElementById('unlockPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
      document.getElementById('unlockPassword')?.focus();
      return;
    }

    document.getElementById('searchInput')?.addEventListener('input', handleSearch);
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      state.showingSiteFilter = state.tab === 'logins' && state.siteMatches.length > 0;
      applyTabFilter();
      render();
    }));
    document.getElementById('autofillToggle')?.addEventListener('change', async (e) => {
      state.autofill = e.target.checked;
      await chrome.storage.local.set({ [STORAGE_AUTOFILL]: state.autofill });
    });
    document.querySelectorAll('.btn-cert-dl').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const idx = +btn.dataset.index;
        if (!(await refreshKeyring())) {
          state.unlocking = true; state.unlockAction = { type: 'download', index: idx }; state.error = null; render(); return;
        }
        try { await downloadCertificate(state.filteredCreds[idx]); } catch { showToast('Erro ao baixar'); }
      });
    });
    document.getElementById('btnRefresh')?.addEventListener('click', loadCredentials);

    document.getElementById('btnFilterSite')?.addEventListener('click', () => {
      state.showingSiteFilter = true;
      document.getElementById('searchInput').value = '';
      applyTabFilter();
      render();
    });
    document.getElementById('btnShowAll')?.addEventListener('click', () => {
      state.showingSiteFilter = false;
      document.getElementById('searchInput').value = '';
      applyTabFilter();
      render();
    });

    document.getElementById('btnSettings')?.addEventListener('click', () => {
      state.view = 'setup'; state.keyring?.lock();
      clearKeyring();
      render();
    });
    document.getElementById('btnSave')?.addEventListener('click', handleSaveFromPage);
    document.getElementById('btnLock')?.addEventListener('click', async () => {
      state.keyring?.lock();
      await clearKeyring();
      showToast('Cofre bloqueado');
    });

    document.querySelectorAll('.btn-copy-user').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cred = state.filteredCreds[+btn.dataset.index];
        copyToClipboard(cred.username || '', 'Usuário');
      });
    });

    document.querySelectorAll('.btn-copy-pw').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const idx = +btn.dataset.index;
        if (!(await refreshKeyring())) {
          state.unlocking = true; state.unlockAction = { type: 'copy', index: idx }; state.error = null; render(); return;
        }
        const cred = state.filteredCreds[idx];
        try {
          const detail = await apiFetch(`/credentials/${cred.id}`);
          const plain  = await state.keyring.decryptValue(detail, detail.encryptedPass);
          copyToClipboard(plain, 'Senha');
        } catch { showToast('Erro ao copiar'); }
      });
    });

    document.querySelectorAll('.btn-fill').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const idx = +btn.dataset.index;
        if (!(await refreshKeyring())) {
          state.unlocking = true; state.unlockAction = { type: 'fill', index: idx }; state.error = null; render(); return;
        }
        const cred = state.filteredCreds[idx];
        try {
          const detail = await apiFetch(`/credentials/${cred.id}`);
          const plain  = await state.keyring.decryptValue(detail, detail.encryptedPass);
          if (await fillSiteTab(detail, plain)) window.close();
        } catch (err) {
          console.error('Autofill error', err);
          showToast('Erro ao preencher');
        }
      });
    });
  }

  if (state.view === 'save-form') {
    document.getElementById('btnBackToVault')?.addEventListener('click', () => {
      state.view = 'vault'; state.saveForm = null; state.error = null;
      chrome.storage.session.remove(PENDING_SAVE_KEY);
      render();
    });
    document.getElementById('btnConfirmSave')?.addEventListener('click', handleConfirmSave);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handleConnect() {
  const serverUrl = document.getElementById('serverUrl')?.value?.trim().replace(/\/$/, '');
  const apiToken  = document.getElementById('apiToken')?.value?.trim();

  if (!serverUrl || !apiToken) {
    state.error = 'Preencha todos os campos'; render(); return;
  }

  state.loading = true; state.error = null; render();

  try {
    if (!/^https?:\/\//i.test(serverUrl)) throw Object.assign(new Error('Informe a URL com http:// ou https://'), { friendly: true });
    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.status === 403) {
      // Token válido, mas a conta tem pendência (2FA, troca de senha, IP)
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error || 'Acesso negado'), { friendly: true });
    }
    if (!res.ok) throw new Error('token_invalid');

    state.serverUrl = serverUrl;
    state.apiToken  = apiToken;
    state.loading   = false;

    await chrome.storage.local.set({
      [STORAGE_SERVER_URL]: serverUrl,
      [STORAGE_API_TOKEN]:  apiToken,
    });

    await loadCredentials();
  } catch (e) {
    state.loading = false;
    state.error = e.friendly ? e.message
      : e.message === 'token_invalid'
      ? 'Token de API inválido ou URL do servidor incorreta'
      : 'Não foi possível conectar. Verifique os dados.';
    render();
  }
}

async function handleUnlock() {
  const vaultPw = document.getElementById('unlockPassword')?.value;
  if (!vaultPw) { state.error = 'Digite sua senha'; render(); return; }

  state.loading = true; state.error = null; render();

  try {
    const keyring = new Keyring(makeApi(state.serverUrl, state.apiToken));
    // A extensão não gera chaves: isso acontece no primeiro acesso ao cofre web
    await keyring.unlock(vaultPw, { allowCreate: false });
    state.keyring   = keyring;
    state.loading   = false;
    state.unlocking = false;

    await saveKeyring(keyring);

    // Execute the pending action
    const action = state.unlockAction;
    state.unlockAction = null;

    if (action?.type === 'copy') {
      const cred   = state.filteredCreds[action.index];
      const detail = await apiFetch(`/credentials/${cred.id}`);
      const plain  = await state.keyring.decryptValue(detail, detail.encryptedPass);
      copyToClipboard(plain, 'Senha');
    } else if (action?.type === 'fill') {
      const cred   = state.filteredCreds[action.index];
      const detail = await apiFetch(`/credentials/${cred.id}`);
      const plain  = await state.keyring.decryptValue(detail, detail.encryptedPass);
      if (await fillSiteTab(detail, plain)) window.close();
      else render();
      return;
    } else if (action?.type === 'save') {
      render();
      await handleConfirmSave();
      return;
    } else if (action?.type === 'download') {
      render();
      await downloadCertificate(state.filteredCreds[action.index]).catch(() => showToast('Erro ao baixar'));
      return;
    }

    render();
  } catch (e) {
    state.loading = false;
    state.error = e.code === 'NO_KEYS'
      ? 'Abra o cofre web uma vez para gerar suas chaves de criptografia'
      : e.code === 'KEY_DECRYPT_FAILED'
      ? 'Senha incorreta (se você trocou a senha, abra o cofre web primeiro)'
      : e.status === 403 ? e.message
      : 'Não foi possível desbloquear. Verifique a conexão.';
    render();
  }
}

async function loadCredentials() {
  state.loading = true;
  try {
    const tab = await getSiteTab();
    state.currentUrl = tab?.url || '';
    const domain = extractDomain(state.currentUrl);
    const isSpecialPage = !domain || domain.startsWith('chrome') ||
      state.currentUrl.startsWith('chrome') || state.currentUrl.startsWith('about') ||
      state.currentUrl.startsWith('chrome-extension');

    // Sempre carrega TODAS as credenciais
    const all = await apiFetch('/credentials');
    state.credentials = Array.isArray(all) ? all : [];

    // Filtragem client-side pela mesma regra do preenchimento automático
    if (!isSpecialPage && domain) {
      state.siteMatches = state.credentials.filter(c => !isCert(c) && c.url && urlMatches(c.url, state.currentUrl));
      // Se há matches para o site, filtra por padrão; senão, mostra tudo
      state.showingSiteFilter = state.siteMatches.length > 0;
    } else {
      state.siteMatches        = [];
      state.showingSiteFilter  = false;
    }
    applyTabFilter();

    state.view = 'vault';
    state.loadError = null;
  } catch (e) {
    if (e.status === 401) {
      // Só 401 = token inválido/expirado/revogado; 403 é pendência da conta
      await chrome.storage.local.remove(STORAGE_API_TOKEN);
      await clearKeyring();
      state.apiToken  = '';
      state.keyring?.lock();
      state.view      = 'setup';
      state.error     = 'Token de API expirado ou revogado. Reconecte.';
    } else if (e.status === 403) {
      state.credentials = []; state.siteMatches = []; state.filteredCreds = [];
      state.view  = 'setup';
      state.error = e.message;
    } else {
      state.credentials      = [];
      state.siteMatches      = [];
      state.filteredCreds    = [];
      state.view             = 'vault';
      state.loadError        = 'Não foi possível falar com o servidor do VaultGuard. Verifique a conexão e clique em Atualizar.';
    }
  }
  state.loading = false;
  render();
}

function handleSearch(e) {
  const q = e.target.value.toLowerCase();
  // Busca em todas as credenciais da aba (inclusive de pastas compartilhadas);
  // ao limpar, volta ao filtro do site quando houver
  state.showingSiteFilter = !q && state.tab === 'logins' && state.siteMatches.length > 0;
  applyTabFilter();
  render();
  const input = document.getElementById('searchInput');
  if (input) { input.value = q; input.focus(); input.setSelectionRange(q.length, q.length); }
}

async function handleSaveFromPage() {
  const tab = await getSiteTab();
  if (!tab?.id) { showToast('Nenhuma aba de site aberta'); return; }
  chrome.tabs.sendMessage(tab.id, { type: 'GET_CREDENTIALS' }, async (response) => {
    const folders = await writableFolders();

    state.saveForm = {
      title:    tab.title || extractDomain(tab.url || ''),
      username: response?.username || '',
      password: response?.password || '',
      // Só a origem: a URL completa pode ter tokens (ex.: ?code= do OAuth)
      url:      pageOrigin(tab.url || ''),
      folders,
      lastFolderId: state.lastFolderId,
    };
    state.view  = 'save-form';
    state.error = null;
    render();
  });
}

// Só pastas em que o usuário pode criar credenciais (pessoal, equipes, compartilhadas)
const FOLDER_ICON = { personal: '🔒', team: '👥', shared: '🏢' };
async function writableFolders() {
  try {
    const list = await apiFetch('/folders/writable');
    return list.map(f => ({ id: f.id, name: `${FOLDER_ICON[f.type] || '📁'} ${f.path}` }));
  } catch { return []; }
}

async function handleConfirmSave() {
  const title    = document.getElementById('saveTitle')?.value?.trim();
  const username = document.getElementById('saveUsername')?.value?.trim();
  const folderId = document.getElementById('saveFolder')?.value;

  if (!title || !folderId) {
    state.error = 'Título e pasta são obrigatórios'; render(); return;
  }
  if (!state.saveForm?.password) {
    state.error = 'Nenhuma senha foi detectada nesta página'; render(); return;
  }
  if (!(await refreshKeyring())) {
    state.view = 'vault'; state.unlocking = true; state.unlockAction = { type: 'save' }; state.error = null; render(); return;
  }

  state.loading = true; state.error = null; render();

  try {
    // Chave própria da credencial, cifrada com a chave da pasta escolhida
    const { payload } = await state.keyring.buildCredentialPayload({
      folderId, password: state.saveForm.password, customFields: [],
    });
    await apiFetch('/credentials', {
      method: 'POST',
      body: JSON.stringify({
        title,
        username,
        url:         state.saveForm.url,
        folderId,
        ...payload,
      }),
    });

    state.saveForm = null;
    await chrome.storage.local.set({ [STORAGE_LAST_FOLDER]: folderId });
    await chrome.storage.session.remove(PENDING_SAVE_KEY);
    await loadCredentials();
    showToast('Senha salva no cofre');
  } catch (e) {
    state.loading = false;
    state.error   = e.code ? e.message : 'Erro ao salvar. Verifique sua conexão.';
    render();
  }
}

let clipboardTimer = null;
function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(label);
    // Senha não fica na área de transferência (vale enquanto a janela estiver aberta)
    if (label === 'Senha') {
      clearTimeout(clipboardTimer);
      clipboardTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), CLIPBOARD_CLEAR_MS);
    }
  });
}

function showToast(label) {
  state.copied = label;
  render();
  setTimeout(() => { state.copied = null; render(); }, 2000);
}

// Aberto pelo aviso de certificado na página: #certs ou #certs:<id>. Com a
// janela já aberta só o hash muda (sem recarregar), por isso o hashchange
function applyHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash.startsWith('certs')) return false;
  state.tab = 'certs';
  state.highlightId = hash.split(':')[1] || null;
  return true;
}

window.addEventListener('hashchange', () => {
  if (!applyHash() || state.view !== 'vault') return;
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  applyTabFilter();
  render();
});

// ─── Init ──────────────────────────────────────────────────────────────────
async function init() {
  state.view = 'loading';
  render();

  await purgeLegacySecrets();
  const stored    = await chrome.storage.local.get([STORAGE_SERVER_URL, STORAGE_API_TOKEN]);
  state.serverUrl = stored[STORAGE_SERVER_URL] || '';
  state.apiToken  = stored[STORAGE_API_TOKEN]  || '';
  state.autofill  = (await chrome.storage.local.get(STORAGE_AUTOFILL))[STORAGE_AUTOFILL] !== false;
  state.lastFolderId = (await chrome.storage.local.get(STORAGE_LAST_FOLDER))[STORAGE_LAST_FOLDER] || null;
  applyHash();

  // Cofre bloqueado não é motivo para ir ao setup — basta o URL e o token
  if (!state.serverUrl || !state.apiToken) {
    state.view = 'setup';
    render();
    return;
  }

  state.keyring = await loadKeyring(makeApi(state.serverUrl, state.apiToken));
  await loadCredentials();

  // Verificar se há senha pendente para salvar (detectada pelo content script)
  if (state.view === 'vault') {
    await checkPendingSave();
  }
}

async function checkPendingSave() {
  const data = await chrome.storage.session.get(PENDING_SAVE_KEY);
  const pending = data[PENDING_SAVE_KEY];
  if (!pending) return;

  if (Date.now() - pending.savedAt > PENDING_SAVE_TTL_MS) {
    await chrome.storage.session.remove(PENDING_SAVE_KEY);
    return;
  }

  // Atualização de senha existente é concluída pelo aviso na própria página
  if (pending.type === 'update') return;
  const folders = await writableFolders();

  let title = pending.title || '';
  try { title = new URL(pending.url).hostname; } catch {}

  state.saveForm = {
    title,
    username: pending.username || '',
    password: pending.password || '',
    url:      pageOrigin(pending.url || ''),
    folders,
    lastFolderId: state.lastFolderId,
  };
  state.view  = 'save-form';
  state.error = null;
  render();
}

init();

// Janela aberta por muito tempo: confere a cada minuto se o cofre bloqueou
setInterval(async () => {
  if (!state.keyring?.isUnlocked) return;
  const data = (await chrome.storage.session.get(STORAGE_KEYRING))[STORAGE_KEYRING];
  if (!data?.session || Date.now() - (data.lastUsed || 0) > IDLE_LOCK_MS) {
    state.keyring.lock();
    await clearKeyring();
    render();
  }
}, 60 * 1000);
