// VaultGuard Extension Popup

// ─── Storage keys ──────────────────────────────────────────────────────────
const STORAGE_SERVER_URL = 'vaultguard_server_url';
const STORAGE_API_TOKEN  = 'vaultguard_api_token';
const STORAGE_MASTER_KEY = 'vaultguard_master_key';

// ─── Crypto (same algorithm as frontend/src/utils/crypto.js) ───────────────
const ALGO = 'AES-GCM';

async function deriveKeyFromPassword(password, hexSalt) {
  const enc       = new TextEncoder();
  const saltBytes = Uint8Array.from(hexSalt.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const km        = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  const derived   = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 210000, hash: 'SHA-256' },
    km,
    { name: ALGO, length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', derived);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function encryptPassword(plaintext, masterKey) {
  if (!masterKey) {
    return JSON.stringify({ plain: btoa(unescape(encodeURIComponent(plaintext))), v: 0 });
  }
  const raw  = Uint8Array.from(atob(masterKey), c => c.charCodeAt(0));
  const key  = await crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['encrypt']);
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const ct   = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(plaintext));
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    v: 1,
  });
}

async function decryptPassword(encryptedJson, masterKey) {
  if (!encryptedJson) return '';
  let parsed;
  try { parsed = JSON.parse(encryptedJson); } catch { return encryptedJson; }
  if (parsed.v === 0) return decodeURIComponent(escape(atob(parsed.plain)));
  if (!masterKey) return '••••••••';
  const raw       = Uint8Array.from(atob(masterKey), c => c.charCodeAt(0));
  const key       = await crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['decrypt']);
  const iv        = Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0));
  const ct        = Uint8Array.from(atob(parsed.ciphertext), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

// ─── State ─────────────────────────────────────────────────────────────────
let state = {
  view: 'loading',       // loading | setup | vault | save-form
  serverUrl: '',
  apiToken: '',
  masterKey: null,
  unlocking: false,      // showing the inline vault-password prompt
  unlockAction: null,    // { type: 'copy'|'fill'|'save', index? } — pending action after unlock
  credentials: [],
  filteredCreds: [],
  currentUrl: '',
  error: null,
  loading: false,
  copied: null,
  saveForm: null,        // { title, username, password, url, folders }
};

// ─── Utils ─────────────────────────────────────────────────────────────────
function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">URL do Servidor</label>
        <input id="serverUrl" type="text" value="${escapeHtml(state.serverUrl)}" placeholder="http://192.168.0.78:8080"
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
        <p style="font-size:12px;color:#64748b;margin-bottom:12px">Digite sua senha para descriptografar. Você não precisará digitar novamente.</p>
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
          style="background:none;border:none;cursor:pointer;color:#555552;padding:4px;display:flex;align-items:center;transition:color .15s"
          onmouseover="this.style.color='#C78C00'" onmouseout="this.style.color='#555552'">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>
        <button id="btnSettings" title="Reconfigurar"
          style="background:none;border:none;cursor:pointer;color:#555552;padding:4px;display:flex;align-items:center;transition:color .15s"
          onmouseover="this.style.color='#C78C00'" onmouseout="this.style.color='#555552'">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      <!-- Search -->
      <div style="padding:10px 14px;border-bottom:1px solid #1E1E1E;background:#111111">
        <div style="position:relative">
          <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#475569" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="searchInput" type="text" placeholder="Buscar credenciais..."
            style="width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:7px 10px 7px 30px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box" />
        </div>
        ${showDomain ? `<div style="margin-top:6px;font-size:11px;color:#475569">Site: <span style="color:#C78C00">${escapeHtml(domain)}</span></div>` : ''}
      </div>

      <!-- Credential list -->
      <div style="flex:1;overflow-y:auto;max-height:350px;background:#0D0D0D">
        ${creds.length === 0 ? `
          <div style="padding:30px 14px;text-align:center;color:#3A3A38">
            <svg style="margin:0 auto 8px;display:block;opacity:0.25" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p style="font-size:13px">Nenhuma credencial encontrada</p>
            ${showDomain ? `<p style="font-size:11px;margin-top:4px;opacity:0.5">para ${escapeHtml(domain)}</p>` : ''}
          </div>
        ` : creds.map((c, i) => `
          <div class="cred-item" data-index="${i}" style="padding:10px 14px;border-bottom:1px solid #1A1A1A;cursor:default">
            <div style="display:flex;align-items:center;gap:10px">
              <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.url || c.title)}&sz=32"
                style="width:20px;height:20px;border-radius:4px;flex-shrink:0"
                onerror="this.style.display='none'" />
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
      <div style="padding:8px 14px;border-top:1px solid #1E1E1E;display:flex;justify-content:space-between;align-items:center;background:#111111">
        <span style="font-size:11px;color:#3A3A38">${creds.length} credencial${creds.length !== 1 ? 'is' : ''}</span>
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
            ${(sf.folders || []).map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('')}
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
    document.getElementById('btnRefresh')?.addEventListener('click', loadCredentials);
    document.getElementById('btnSettings')?.addEventListener('click', () => {
      state.view = 'setup'; state.masterKey = null;
      chrome.storage.local.remove(STORAGE_MASTER_KEY);
      render();
    });
    document.getElementById('btnSave')?.addEventListener('click', handleSaveFromPage);

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
        if (!state.masterKey) {
          state.unlocking = true; state.unlockAction = { type: 'copy', index: idx }; state.error = null; render(); return;
        }
        const cred = state.filteredCreds[idx];
        try {
          const detail = await apiFetch(`/credentials/${cred.id}`);
          const plain  = await decryptPassword(detail.encryptedPass, state.masterKey);
          copyToClipboard(plain, 'Senha');
        } catch { showToast('Erro ao copiar'); }
      });
    });

    document.querySelectorAll('.btn-fill').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const idx = +btn.dataset.index;
        if (!state.masterKey) {
          state.unlocking = true; state.unlockAction = { type: 'fill', index: idx }; state.error = null; render(); return;
        }
        const cred = state.filteredCreds[idx];
        try {
          const detail = await apiFetch(`/credentials/${cred.id}`);
          const plain  = await decryptPassword(detail.encryptedPass, state.masterKey);
          const [tab]  = await chrome.tabs.query({ active: true, currentWindow: true });
          chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', username: detail.username || '', password: plain });
          window.close();
        } catch (err) {
          console.error('Autofill error', err);
          showToast('Erro ao preencher');
        }
      });
    });
  }

  if (state.view === 'save-form') {
    document.getElementById('btnBackToVault')?.addEventListener('click', () => {
      state.view = 'vault'; state.saveForm = null; state.error = null; render();
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
    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
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
    state.error = e.message === 'token_invalid'
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
    const user = await apiFetch('/auth/me');
    if (!user.encryptionSalt) throw new Error('no_salt');

    const masterKey = await deriveKeyFromPassword(vaultPw, user.encryptionSalt);
    state.masterKey = masterKey;
    state.loading   = false;
    state.unlocking = false;

    await chrome.storage.local.set({ [STORAGE_MASTER_KEY]: masterKey });

    // Execute the pending action
    const action = state.unlockAction;
    state.unlockAction = null;

    if (action?.type === 'copy') {
      const cred   = state.filteredCreds[action.index];
      const detail = await apiFetch(`/credentials/${cred.id}`);
      const plain  = await decryptPassword(detail.encryptedPass, masterKey);
      copyToClipboard(plain, 'Senha');
    } else if (action?.type === 'fill') {
      const cred   = state.filteredCreds[action.index];
      const detail = await apiFetch(`/credentials/${cred.id}`);
      const plain  = await decryptPassword(detail.encryptedPass, masterKey);
      const [tab]  = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', username: detail.username || '', password: plain });
      window.close();
      return;
    } else if (action?.type === 'save') {
      render();
      await handleConfirmSave();
      return;
    }

    render();
  } catch (e) {
    state.loading = false;
    state.error = e.message === 'no_salt'
      ? 'Erro ao obter configuração do servidor'
      : 'Senha incorreta. Tente novamente.';
    render();
  }
}

async function loadCredentials() {
  state.loading = true;
  try {
    const [tab]  = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentUrl = tab?.url || '';
    const domain = extractDomain(state.currentUrl);

    let creds = [];
    const isChrome = !domain || domain.startsWith('chrome') || state.currentUrl.startsWith('chrome') || state.currentUrl.startsWith('about');

    if (!isChrome) {
      try {
        const byUrl = await apiFetch(`/credentials/search/by-url?url=${encodeURIComponent(state.currentUrl)}`);
        creds = Array.isArray(byUrl) ? byUrl : [];
      } catch {
        // fallback: load all
        const all = await apiFetch('/credentials');
        creds = Array.isArray(all) ? all : [];
      }
    } else {
      const all = await apiFetch('/credentials');
      creds = Array.isArray(all) ? all : [];
    }

    state.credentials  = creds;
    state.filteredCreds = creds;
    state.view         = 'vault';
  } catch (e) {
    if (e.message.includes('401') || e.message.includes('403')) {
      state.view  = 'setup';
      state.error = 'Token expirado ou inválido. Reconecte.';
    } else {
      state.credentials  = [];
      state.filteredCreds = [];
      state.view         = 'vault';
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
  const input = document.getElementById('searchInput');
  if (input) { input.value = q; input.focus(); input.setSelectionRange(q.length, q.length); }
}

async function handleSaveFromPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'GET_CREDENTIALS' }, async (response) => {
    let folders = [];
    try {
      const data = await apiFetch('/folders');
      const shared   = data.shared   || [];
      const personal = data.personal || [];
      folders = [
        ...flattenFolderTree(shared),
        ...flattenFolderTree(personal),
      ];
    } catch { /* ignore */ }

    state.saveForm = {
      title:    tab.title || extractDomain(tab.url || ''),
      username: response?.username || '',
      password: response?.password || '',
      url:      tab.url || '',
      folders,
    };
    state.view  = 'save-form';
    state.error = null;
    render();
  });
}

function flattenFolderTree(folders, depth = 0) {
  const result = [];
  for (const f of folders) {
    result.push({ id: f.id, name: '  '.repeat(depth) + f.name });
    if (f.children?.length) result.push(...flattenFolderTree(f.children, depth + 1));
  }
  return result;
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
  if (!state.masterKey) {
    state.view = 'vault'; state.unlocking = true; state.unlockAction = { type: 'save' }; state.error = null; render(); return;
  }

  state.loading = true; state.error = null; render();

  try {
    const encryptedPass = await encryptPassword(state.saveForm.password, state.masterKey);
    await apiFetch('/credentials', {
      method: 'POST',
      body: JSON.stringify({
        title,
        username,
        url:         state.saveForm.url,
        encryptedPass,
        folderId,
      }),
    });

    state.saveForm = null;
    await loadCredentials();
    showToast('Senha salva no cofre');
  } catch {
    state.loading = false;
    state.error   = 'Erro ao salvar. Verifique sua conexão.';
    render();
  }
}

function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => showToast(label));
}

function showToast(label) {
  state.copied = label;
  render();
  setTimeout(() => { state.copied = null; render(); }, 2000);
}

// ─── Init ──────────────────────────────────────────────────────────────────
async function init() {
  state.view = 'loading';
  render();

  const stored    = await chrome.storage.local.get([STORAGE_SERVER_URL, STORAGE_API_TOKEN, STORAGE_MASTER_KEY]);
  state.serverUrl = stored[STORAGE_SERVER_URL] || '';
  state.apiToken  = stored[STORAGE_API_TOKEN]  || '';
  state.masterKey = stored[STORAGE_MASTER_KEY] || null;

  if (!state.serverUrl || !state.apiToken || !state.masterKey) {
    state.view = 'setup';
    render();
    return;
  }

  await loadCredentials();
}

init();
