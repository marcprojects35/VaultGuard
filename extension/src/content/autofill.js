// VaultGuard Content Script

(function () {
  'use strict';

  const STORAGE_SERVER_URL = 'vaultguard_server_url';
  const STORAGE_API_TOKEN  = 'vaultguard_api_token';
  const STORAGE_MASTER_KEY = 'vaultguard_master_key';
  const PENDING_SAVE_KEY   = 'vaultguard_pending_save';

  // ── Crypto (espelho de frontend/src/utils/crypto.js) ──────────────────────
  const ALGO = 'AES-GCM';

  async function decryptPassword(encryptedJson, masterKey) {
    if (!encryptedJson) return '';
    let parsed;
    try { parsed = JSON.parse(encryptedJson); } catch { return encryptedJson; }
    if (parsed.v === 0) return decodeURIComponent(escape(atob(parsed.plain)));
    if (!masterKey) return '';
    const raw  = Uint8Array.from(atob(masterKey), c => c.charCodeAt(0));
    const key  = await crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['decrypt']);
    const iv   = Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0));
    const ct   = Uint8Array.from(atob(parsed.ciphertext), c => c.charCodeAt(0));
    const dec  = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ct);
    return new TextDecoder().decode(dec);
  }

  // ── Buscar e descriptografar credencial ───────────────────────────────────
  async function fetchAndFill(credId, passwordField, usernameField) {
    const stored = await chrome.storage.local.get([STORAGE_SERVER_URL, STORAGE_API_TOKEN, STORAGE_MASTER_KEY]);
    const { [STORAGE_SERVER_URL]: serverUrl, [STORAGE_API_TOKEN]: apiToken, [STORAGE_MASTER_KEY]: masterKey } = stored;
    if (!serverUrl || !apiToken) return;

    const res = await fetch(`${serverUrl}/api/credentials/${credId}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();

    const plain = await decryptPassword(detail.encryptedPass, masterKey);
    if (detail.username && usernameField) setNativeInputValue(usernameField, detail.username);
    if (plain && passwordField) setNativeInputValue(passwordField, plain);

    [usernameField, passwordField].filter(Boolean).forEach(el => {
      el.style.transition = 'outline 0.3s';
      el.style.outline = '2px solid #C78C00';
      setTimeout(() => { el.style.outline = ''; }, 1500);
    });
  }

  // ── Mensagens do popup ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AUTOFILL') {
      const { usernameField, passwordField } = findLoginFields();
      if (message.username && usernameField) setNativeInputValue(usernameField, message.username);
      if (message.password && passwordField) setNativeInputValue(passwordField, message.password);
      [usernameField, passwordField].filter(Boolean).forEach(el => {
        el.style.transition = 'outline 0.3s';
        el.style.outline = '2px solid #C78C00';
        setTimeout(() => { el.style.outline = ''; }, 1500);
      });
      sendResponse({ success: true });
    }
    if (message.type === 'GET_CREDENTIALS') {
      sendResponse(getPageCredentials());
    }
    return true;
  });

  // ── Simula digitação real (React/Vue/Angular) ─────────────────────────────
  function setNativeInputValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Detectar campos de login ───────────────────────────────────────────────
  function findLoginFields(root) {
    const container = root || document;
    const passwordFields = Array.from(container.querySelectorAll('input[type="password"]'))
      .filter(isVisible);
    if (!passwordFields.length) return {};
    const passwordField = passwordFields[0];
    const form = passwordField.closest('form');
    const selectors = [
      'input[type="email"]',
      'input[type="text"][name*="user"]', 'input[type="text"][name*="email"]',
      'input[type="text"][name*="login"]', 'input[autocomplete="username"]',
      'input[autocomplete="email"]', 'input[id*="user"]', 'input[id*="email"]',
      'input[id*="login"]', 'input[type="text"]',
    ];
    let usernameField = null;
    for (const sel of selectors) {
      const found = Array.from((form || container).querySelectorAll(sel))
        .filter(el => isVisible(el) && el !== passwordField);
      if (found.length) { usernameField = found[0]; break; }
    }
    return { usernameField, passwordField };
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
      getComputedStyle(el).visibility !== 'hidden' &&
      getComputedStyle(el).display !== 'none';
  }

  function getPageCredentials() {
    const { usernameField, passwordField } = findLoginFields();
    return { username: usernameField?.value || '', password: passwordField?.value || '' };
  }

  // ── Popup de autofill na página ───────────────────────────────────────────
  let autofillPopupVisible = false;

  function removeAutofillPopup() {
    document.querySelectorAll('.vg-autofill-popup').forEach(el => el.remove());
    autofillPopupVisible = false;
  }

  async function showAutofillPopup(creds, passwordField) {
    removeAutofillPopup();
    if (!creds.length) return;

    autofillPopupVisible = true;
    const { usernameField } = findLoginFields();

    // Posição: abaixo do campo de senha
    const rect = passwordField.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const popupHeight = Math.min(creds.length * 64 + 60, 300);
    const top = spaceBelow > popupHeight + 8
      ? rect.bottom + window.scrollY + 6
      : rect.top  + window.scrollY - popupHeight - 6;
    const left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 360 - 8));

    // Injetar estilos uma vez
    if (!document.getElementById('vg-styles')) {
      const s = document.createElement('style');
      s.id = 'vg-styles';
      s.textContent = `
        .vg-autofill-popup{position:absolute;z-index:2147483647;width:340px;background:#111111;border:1px solid #C78C00;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.7);font-family:system-ui,-apple-system,sans-serif;overflow:hidden;animation:vg-pop .2s ease}
        @keyframes vg-pop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        .vg-popup-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#0D0D0D;border-bottom:1px solid #1E1E1E}
        .vg-popup-title{flex:1;font-size:12px;font-weight:600;color:#94a3b8}
        .vg-popup-close{background:none;border:none;cursor:pointer;color:#555552;font-size:14px;line-height:1;padding:2px 4px}
        .vg-popup-close:hover{color:#f87171}
        .vg-cred-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #1A1A1A;cursor:default}
        .vg-cred-item:last-child{border-bottom:none}
        .vg-cred-info{flex:1;min-width:0}
        .vg-cred-title{font-size:13px;font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .vg-cred-user{font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
        .vg-fill-btn{background:linear-gradient(135deg,#C78C00,#AD7B04);border:none;border-radius:7px;padding:6px 12px;color:white;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0}
        .vg-fill-btn:hover{opacity:.85}
        .vg-fill-btn.loading{opacity:.6;pointer-events:none}
      `;
      document.head.appendChild(s);
    }

    const popup = document.createElement('div');
    popup.className = 'vg-autofill-popup';
    popup.style.top  = top  + 'px';
    popup.style.left = left + 'px';

    const hostname = (() => { try { return new URL(window.location.href).hostname; } catch { return window.location.hostname; } })();

    popup.innerHTML = `
      <div class="vg-popup-header">
        <svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><path fill="#C78C00" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
        <span class="vg-popup-title">Senhas salvas para <strong style="color:#E7A300">${hostname}</strong></span>
        <button class="vg-popup-close" title="Fechar">✕</button>
      </div>
      ${creds.map(c => `
        <div class="vg-cred-item">
          <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.url || hostname)}&sz=32"
            style="width:24px;height:24px;border-radius:5px;flex-shrink:0"
            onerror="this.style.display='none'">
          <div class="vg-cred-info">
            <div class="vg-cred-title">${esc(c.title)}</div>
            <div class="vg-cred-user">${esc(c.username || '')}</div>
          </div>
          <button class="vg-fill-btn" data-id="${esc(c.id)}">↗ Preencher</button>
        </div>
      `).join('')}
    `;

    document.body.appendChild(popup);

    // Fechar
    popup.querySelector('.vg-popup-close').addEventListener('click', removeAutofillPopup);

    // Clicar fora fecha
    const onOutside = (e) => {
      if (!popup.contains(e.target) && e.target !== passwordField && e.target !== usernameField) {
        removeAutofillPopup();
        document.removeEventListener('mousedown', onOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside), 100);

    // Botões de preencher
    popup.querySelectorAll('.vg-fill-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const credId = btn.dataset.id;
        btn.classList.add('loading');
        btn.textContent = '...';
        try {
          await fetchAndFill(credId, passwordField, usernameField);
          removeAutofillPopup();
        } catch (e) {
          btn.textContent = 'Erro';
          setTimeout(() => { btn.textContent = '↗ Preencher'; btn.classList.remove('loading'); }, 1500);
        }
      });
    });
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Mostrar popup ao focar campo de senha ─────────────────────────────────
  let focusTimeout;
  document.addEventListener('focusin', (e) => {
    if (e.target.type !== 'password') return;
    clearTimeout(focusTimeout);
    focusTimeout = setTimeout(async () => {
      if (autofillPopupVisible) return;
      const creds = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: 'FETCH_CREDS_FOR_URL', url: window.location.href }, r => resolve(r || []))
      );
      if (creds.length > 0) showAutofillPopup(creds, e.target);
    }, 300);
  }, true);

  // Fechar popup ao pressionar Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') removeAutofillPopup();
  }, true);

  // ── Detecção de submit de formulário de login ─────────────────────────────
  document.addEventListener('submit', (e) => {
    const { usernameField, passwordField } = findLoginFields(e.target);
    if (!passwordField?.value) return;

    chrome.storage.local.set({
      [PENDING_SAVE_KEY]: {
        username: usernameField?.value || '',
        password: passwordField.value,
        url:      window.location.href,
        title:    document.title || window.location.hostname,
        savedAt:  Date.now(),
      }
    });

    setTimeout(() => showSaveBanner(usernameField?.value || '', passwordField.value), 1000);
  }, true);

  // Verificar pendingSave de navegação anterior
  chrome.storage.local.get(PENDING_SAVE_KEY, (data) => {
    const pending = data[PENDING_SAVE_KEY];
    if (!pending) return;
    if (Date.now() - pending.savedAt > 3 * 60 * 1000) { chrome.storage.local.remove(PENDING_SAVE_KEY); return; }
    try {
      if (new URL(pending.url).hostname !== window.location.hostname) return;
      if (pending.url === window.location.href) return;
    } catch { return; }
    setTimeout(() => showSaveBanner(pending.username, pending.password), 800);
  });

  // ── Banner de salvar senha ────────────────────────────────────────────────
  function showSaveBanner(username, password) {
    document.querySelectorAll('.vg-save-banner').forEach(el => el.remove());

    if (!document.getElementById('vg-styles')) {
      const s = document.createElement('style');
      s.id = 'vg-styles';
      s.textContent = '';
      document.head.appendChild(s);
    }

    const banner = document.createElement('div');
    banner.className = 'vg-save-banner';
    banner.style.cssText = `
      position:fixed!important;top:16px!important;right:16px!important;
      z-index:2147483647!important;background:#111111!important;
      border:1px solid #C78C00!important;border-radius:12px!important;
      padding:12px 14px!important;display:flex!important;align-items:center!important;
      gap:10px!important;box-shadow:0 8px 32px rgba(0,0,0,0.6)!important;
      font-family:system-ui,sans-serif!important;min-width:280px!important;max-width:380px!important;
      animation:vg-slide-in .3s ease!important;
    `;

    if (!document.getElementById('vg-banner-styles')) {
      const s = document.createElement('style');
      s.id = 'vg-banner-styles';
      s.textContent = `@keyframes vg-slide-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`;
      document.head.appendChild(s);
    }

    banner.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" style="flex-shrink:0"><path fill="#C78C00" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#f1f5f9;line-height:1.3">Salvar senha?</div>
        <div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">${esc(username || window.location.hostname)}</div>
      </div>
      <button class="vg-save-yes" style="background:linear-gradient(135deg,#C78C00,#AD7B04);border:none;border-radius:7px;padding:6px 12px;color:white;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">Salvar</button>
      <button class="vg-save-no"  style="background:none;border:1px solid #2A2A2A;border-radius:7px;padding:6px 8px;color:#64748b;font-size:12px;cursor:pointer;line-height:1">✕</button>
    `;

    document.body.appendChild(banner);

    banner.querySelector('.vg-save-yes').addEventListener('click', () => {
      banner.remove();
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });
    banner.querySelector('.vg-save-no').addEventListener('click', () => {
      banner.remove();
      chrome.storage.local.remove(PENDING_SAVE_KEY);
    });

    setTimeout(() => banner.remove(), 12000);
  }
})();
