// VaultGuard Extension Popup
// Build com Vite ou copie diretamente este arquivo como popup.js

const API_BASE_STORAGE_KEY = 'vaultguard_server_url';
const API_TOKEN_STORAGE_KEY = 'vaultguard_api_token';

// ─── Estado global ─────────────────────────────────────────────────────────
let state = {
  view: 'loading', // loading | setup | vault | search
  serverUrl: '',
  apiToken: '',
  credentials: [],
  filteredCreds: [],
  currentUrl: '',
  error: null,
  loading: false,
  copied: null,
};

// ─── Utils ──────────────────────────────────────────────────────────────────
function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${state.serverUrl}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': state.apiToken,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function decryptPassword(encryptedData) {
  // Se backend retorna senha em plain text (após validação do token), usar diretamente
  if (typeof encryptedData === 'string' && !encryptedData.includes(':')) return encryptedData;
  // Senão, tentar descriptografar com Web Crypto (client-side AES-GCM)
  return encryptedData;
}

// ─── Render Engine ───────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('root');
  root.innerHTML = getTemplate();
  bindEvents();
}

function getTemplate() {
  if (state.view === 'loading') return renderLoading();
  if (state.view === 'setup') return renderSetup();
  if (state.view === 'vault' || state.view === 'search') return renderVault();
  return '<div style="padding:20px;color:#666">Erro desconhecido</div>';
}

function renderLoading() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;height:200px;flex-direction:column;gap:12px">
      <div class="spinner"></div>
      <p style="color:#64748b;font-size:13px">Conectando ao servidor...</p>
    </div>
    <style>.spinner{width:24px;height:24px;border:2px solid #1e293b;border-top:2px solid #6366f1;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
}

function renderSetup() {
  return `
    <div style="padding:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;display:flex;align-items:center;justify-content:center">
          <svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
        </div>
        <div>
          <h1 style="font-size:16px;font-weight:700;color:#f1f5f9">VaultGuard</h1>
          <p style="font-size:11px;color:#64748b">Configuração inicial</p>
        </div>
      </div>

      ${state.error ? `<div style="background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:12px">${state.error}</div>` : ''}

      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">URL do Servidor</label>
        <input id="serverUrl" type="text" value="${state.serverUrl}" placeholder="http://192.168.0.78"
          style="width:100%;background:#1a1d2e;border:1px solid #1e293b;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none" />
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Token de API</label>
        <input id="apiToken" type="password" value="${state.apiToken}" placeholder="vg_xxxxxxxxxxxxxxxx"
          style="width:100%;background:#1a1d2e;border:1px solid #1e293b;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;outline:none;font-family:monospace" />
        <p style="font-size:11px;color:#475569;margin-top:4px">Gere um token em: VaultGuard → Tokens de API</p>
      </div>
      <button id="btnConnect" style="width:100%;background:#6366f1;color:white;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer">
        ${state.loading ? 'Conectando...' : 'Conectar'}
      </button>
    </div>
  `;
}

function renderVault() {
  const creds = state.filteredCreds;
  const domain = extractDomain(state.currentUrl);

  return `
    <div style="display:flex;flex-direction:column;height:100%">
      <!-- Header -->
      <div style="background:#1a1d2e;padding:12px 14px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px">
        <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="12" height="12" fill="white" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
        </div>
        <span style="font-size:13px;font-weight:600;color:#f1f5f9;flex:1">VaultGuard</span>
        <button id="btnSave" title="Salvar senha da página" style="background:none;border:none;cursor:pointer;color:#64748b;padding:4px" title="Salvar senha da página atual">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </button>
        <button id="btnSettings" title="Configurações" style="background:none;border:none;cursor:pointer;color:#64748b;padding:4px">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>

      <!-- Busca -->
      <div style="padding:10px 14px;border-bottom:1px solid #1e293b">
        <div style="position:relative">
          <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#475569" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="searchInput" type="text" placeholder="Buscar credenciais..."
            style="width:100%;background:#1a1d2e;border:1px solid #1e293b;border-radius:8px;padding:7px 10px 7px 30px;color:#e2e8f0;font-size:13px;outline:none" />
        </div>
        ${domain ? `<div style="margin-top:6px;font-size:11px;color:#475569">Site atual: <span style="color:#6366f1">${domain}</span></div>` : ''}
      </div>

      <!-- Lista -->
      <div style="flex:1;overflow-y:auto;max-height:350px">
        ${creds.length === 0 ? `
          <div style="padding:30px 14px;text-align:center;color:#475569">
            <svg style="margin:0 auto 8px;display:block;opacity:0.4" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <p style="font-size:13px">Nenhuma credencial encontrada</p>
            <p style="font-size:11px;margin-top:4px;opacity:0.6">para ${domain || 'este site'}</p>
          </div>
        ` : creds.map((c, i) => `
          <div class="cred-item" data-index="${i}" style="padding:10px 14px;border-bottom:1px solid #0f1117;cursor:pointer;transition:background 0.15s">
            <div style="display:flex;align-items:center;gap:10px">
              <img src="https://www.google.com/s2/favicons?domain=${c.url || c.title}&sz=32" 
                style="width:20px;height:20px;border-radius:4px;flex-shrink:0"
                onerror="this.style.display='none'" />
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;color:#e2e8f0;truncate:true;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.title}</div>
                <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.username || ''}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button class="btn-copy-user" data-index="${i}" title="Copiar usuário" style="background:#1e293b;border:none;border-radius:6px;padding:5px;cursor:pointer;color:#94a3b8;font-size:10px">
                  👤
                </button>
                <button class="btn-copy-pw" data-index="${i}" title="Copiar senha" style="background:#1e293b;border:none;border-radius:6px;padding:5px;cursor:pointer;color:#94a3b8;font-size:10px">
                  🔑
                </button>
                <button class="btn-fill" data-index="${i}" title="Preencher formulário" style="background:#4f46e5;border:none;border-radius:6px;padding:5px 8px;cursor:pointer;color:white;font-size:10px">
                  ↗
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Footer -->
      <div style="padding:8px 14px;border-top:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;color:#334155">${creds.length} credencial${creds.length !== 1 ? 'is' : ''}</span>
        <button id="btnRefresh" style="background:none;border:none;cursor:pointer;color:#475569;font-size:11px;display:flex;align-items:center;gap:4px">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
          Atualizar
        </button>
      </div>
    </div>

    ${state.copied ? `
      <div style="position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:#22c55e;color:white;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500">
        ${state.copied} copiado!
      </div>
    ` : ''}
  `;
}

// ─── Bind Events ─────────────────────────────────────────────────────────────
function bindEvents() {
  if (state.view === 'setup') {
    document.getElementById('btnConnect')?.addEventListener('click', handleConnect);
    document.getElementById('serverUrl')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleConnect(); });
    document.getElementById('apiToken')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleConnect(); });
  }

  if (state.view === 'vault' || state.view === 'search') {
    document.getElementById('searchInput')?.addEventListener('input', handleSearch);
    document.getElementById('btnRefresh')?.addEventListener('click', loadCredentials);
    document.getElementById('btnSettings')?.addEventListener('click', () => { state.view = 'setup'; render(); });
    document.getElementById('btnSave')?.addEventListener('click', handleSaveFromPage);

    document.querySelectorAll('.btn-copy-user').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cred = state.filteredCreds[btn.dataset.index];
        copyToClipboard(cred.username || '', 'Usuário');
      });
    });

    document.querySelectorAll('.btn-copy-pw').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cred = state.filteredCreds[btn.dataset.index];
        try {
          const detail = await apiFetch(`/credentials/${cred.id}`);
          copyToClipboard(detail.password || '', 'Senha');
        } catch { copyToClipboard('', 'Erro'); }
      });
    });

    document.querySelectorAll('.btn-fill').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cred = state.filteredCreds[btn.dataset.index];
        try {
          const detail = await apiFetch(`/credentials/${cred.id}`);
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          chrome.tabs.sendMessage(tab.id, {
            type: 'AUTOFILL',
            username: detail.username || '',
            password: detail.password || '',
          });
          window.close();
        } catch (e) { console.error('Autofill error', e); }
      });
    });
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handleConnect() {
  const serverUrl = document.getElementById('serverUrl')?.value?.trim().replace(/\/$/, '');
  const apiToken = document.getElementById('apiToken')?.value?.trim();

  if (!serverUrl || !apiToken) { state.error = 'Preencha todos os campos'; render(); return; }

  state.loading = true; state.error = null; render();

  try {
    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'X-API-Token': apiToken }
    });
    if (!res.ok) throw new Error('Credenciais inválidas');

    state.serverUrl = serverUrl;
    state.apiToken = apiToken;
    state.loading = false;

    await chrome.storage.local.set({ [API_BASE_STORAGE_KEY]: serverUrl, [API_TOKEN_STORAGE_KEY]: apiToken });
    await loadCredentials();
  } catch (e) {
    state.loading = false;
    state.error = e.message === 'Credenciais inválidas' ? 'Token ou servidor inválido' : 'Não foi possível conectar ao servidor';
    render();
  }
}

async function loadCredentials() {
  state.loading = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentUrl = tab?.url || '';
    const domain = extractDomain(state.currentUrl);

    let creds = [];
    if (domain && !domain.startsWith('chrome')) {
      try {
        const byUrl = await apiFetch(`/credentials/search/by-url?url=${encodeURIComponent(state.currentUrl)}`);
        creds = byUrl;
      } catch {
        const all = await apiFetch('/credentials?limit=50');
        creds = all.credentials || [];
      }
    } else {
      const all = await apiFetch('/credentials?limit=50');
      creds = all.credentials || [];
    }

    state.credentials = creds;
    state.filteredCreds = creds;
    state.view = 'vault';
  } catch (e) {
    if (e.message.includes('401') || e.message.includes('403')) {
      state.view = 'setup';
      state.error = 'Token expirado ou inválido. Reconecte.';
    } else {
      state.credentials = [];
      state.filteredCreds = [];
      state.view = 'vault';
    }
  }
  state.loading = false;
  render();
}

function handleSearch(e) {
  const q = e.target.value.toLowerCase();
  state.filteredCreds = q
    ? state.credentials.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.username?.toLowerCase().includes(q) ||
        c.url?.toLowerCase().includes(q)
      )
    : state.credentials;
  render();
  // Manter foco e valor no input após re-render
  const input = document.getElementById('searchInput');
  if (input) { input.value = q; input.focus(); input.setSelectionRange(q.length, q.length); }
}

async function handleSaveFromPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'GET_CREDENTIALS' }, async (response) => {
    if (response && (response.username || response.password)) {
      const title = tab.title || extractDomain(tab.url);
      try {
        await apiFetch('/credentials', {
          method: 'POST',
          body: JSON.stringify({
            title, username: response.username, password: response.password, url: tab.url
          })
        });
        state.credentials = [];
        await loadCredentials();
        showCopied('Credencial salva');
      } catch (e) {
        console.error('Erro ao salvar', e);
      }
    } else {
      showCopied('Nenhum formulário detectado');
    }
  });
}

function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => showCopied(label));
}

function showCopied(label) {
  state.copied = label;
  render();
  setTimeout(() => { state.copied = null; render(); }, 2000);
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  state.view = 'loading';
  render();

  const stored = await chrome.storage.local.get([API_BASE_STORAGE_KEY, API_TOKEN_STORAGE_KEY]);
  state.serverUrl = stored[API_BASE_STORAGE_KEY] || '';
  state.apiToken = stored[API_TOKEN_STORAGE_KEY] || '';

  if (!state.serverUrl || !state.apiToken) {
    state.view = 'setup';
    render();
    return;
  }

  await loadCredentials();
}

init();
