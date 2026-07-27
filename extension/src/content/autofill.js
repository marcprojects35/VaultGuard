// VaultGuard Content Script — Autofill, detecção de formulários e banner de salvar

(function () {
  'use strict';

  const PENDING_SAVE_KEY = 'vaultguard_pending_save';

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Mensagens do popup/background ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AUTOFILL') {
      autofill(message.username, message.password);
      sendResponse({ success: true });
    }
    if (message.type === 'GET_CREDENTIALS') {
      sendResponse(getPageCredentials());
    }
    return true;
  });

  // ── Autofill ───────────────────────────────────────────────────────────────
  function autofill(username, password) {
    const { usernameField, passwordField } = findLoginFields();
    if (usernameField && username) setNativeInputValue(usernameField, username);
    if (passwordField && password) setNativeInputValue(passwordField, password);

    [usernameField, passwordField].filter(Boolean).forEach(el => {
      el.style.transition = 'outline 0.3s';
      el.style.outline = '2px solid #C78C00';
      setTimeout(() => { el.style.outline = ''; }, 1500);
    });
  }

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
      .filter(el => isVisible(el));
    if (passwordFields.length === 0) return {};
    const passwordField = passwordFields[0];
    const form = passwordField.closest('form');

    const selectors = [
      'input[type="email"]',
      'input[type="text"][name*="user"]',
      'input[type="text"][name*="email"]',
      'input[type="text"][name*="login"]',
      'input[autocomplete="username"]',
      'input[autocomplete="email"]',
      'input[id*="user"]',
      'input[id*="email"]',
      'input[id*="login"]',
      'input[type="text"]',
    ];

    let usernameField = null;
    for (const sel of selectors) {
      const found = Array.from((form || container).querySelectorAll(sel))
        .filter(el => isVisible(el) && el !== passwordField);
      if (found.length > 0) { usernameField = found[0]; break; }
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

  // ── Detecção de envio de formulário de login ───────────────────────────────
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const { usernameField, passwordField } = findLoginFields(form);
    if (!passwordField?.value) return;

    const pending = {
      username: usernameField?.value || '',
      password: passwordField.value,
      url: window.location.href,
      title: document.title || window.location.hostname,
      savedAt: Date.now(),
    };

    chrome.storage.local.set({ [PENDING_SAVE_KEY]: pending });

    // Para SPAs (sem navegação), mostrar banner após 1s
    setTimeout(() => showSaveBanner(pending, true), 1000);
  }, true);

  // ── Verificar pendingSave ao carregar a página ─────────────────────────────
  chrome.storage.local.get(PENDING_SAVE_KEY, (data) => {
    const pending = data[PENDING_SAVE_KEY];
    if (!pending) return;

    // Expirar após 3 minutos
    if (Date.now() - pending.savedAt > 3 * 60 * 1000) {
      chrome.storage.local.remove(PENDING_SAVE_KEY);
      return;
    }

    // Mesmo domínio mas URL diferente (navegação após login)
    try {
      const pendingHost = new URL(pending.url).hostname;
      if (pendingHost !== window.location.hostname) return;
      if (pending.url === window.location.href) return;
    } catch { return; }

    // Aguardar a página renderizar antes de mostrar o banner
    setTimeout(() => showSaveBanner(pending, false), 800);
  });

  // ── Banner de salvar senha ─────────────────────────────────────────────────
  function showSaveBanner(pending, fromSamePageSubmit) {
    document.querySelectorAll('.vaultguard-save-banner').forEach(el => el.remove());

    // Se for submit da mesma página E não for SPA, o banner vai sumir logo — ok
    const banner = document.createElement('div');
    banner.className = 'vaultguard-save-banner';
    banner.style.cssText = `
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      z-index: 2147483647 !important;
      background: #111111 !important;
      border: 1px solid #C78C00 !important;
      border-radius: 12px !important;
      padding: 12px 14px !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      min-width: 280px !important;
      max-width: 380px !important;
      animation: vg-slide-in 0.3s ease !important;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes vg-slide-in { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
      .vaultguard-save-banner button:hover { opacity: 0.85 !important; }
    `;
    document.head.appendChild(style);

    const user = pending.username || window.location.hostname;
    banner.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" style="flex-shrink:0">
        <path fill="#C78C00" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
      </svg>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#f1f5f9;line-height:1.3">Salvar senha?</div>
        <div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">${esc(user)}</div>
      </div>
      <button class="vg-btn-save" style="background:linear-gradient(135deg,#C78C00,#AD7B04);border:none;border-radius:7px;padding:6px 12px;color:white;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">Salvar</button>
      <button class="vg-btn-dismiss" style="background:none;border:1px solid #2A2A2A;border-radius:7px;padding:6px 8px;color:#64748b;font-size:12px;cursor:pointer;line-height:1">✕</button>
    `;

    document.body.appendChild(banner);

    banner.querySelector('.vg-btn-save').addEventListener('click', () => {
      banner.remove();
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });

    banner.querySelector('.vg-btn-dismiss').addEventListener('click', () => {
      banner.remove();
      chrome.storage.local.remove(PENDING_SAVE_KEY);
    });

    // Auto-dismiss após 12 segundos
    setTimeout(() => banner.remove(), 12000);
  }

  // ── Sugestão de autofill ao focar campo de senha ───────────────────────────
  let suggestTimeout;
  document.addEventListener('focusin', (e) => {
    if (e.target.type !== 'password') return;
    clearTimeout(suggestTimeout);
    suggestTimeout = setTimeout(() => showAutofillHint(e.target), 400);
  }, true);

  function showAutofillHint(passwordField) {
    document.querySelectorAll('.vaultguard-hint').forEach(el => el.remove());

    chrome.runtime.sendMessage({ type: 'FETCH_CREDS_FOR_URL', url: window.location.href }, (creds) => {
      if (!creds || creds.length === 0) return;

      const rect = passwordField.getBoundingClientRect();
      if (!rect.width) return;

      const hint = document.createElement('div');
      hint.className = 'vaultguard-hint';
      hint.style.cssText = `
        position: fixed !important;
        top: ${Math.min(rect.bottom + 6, window.innerHeight - 60)}px !important;
        left: ${rect.left}px !important;
        background: #111111 !important;
        border: 1px solid #C78C00 !important;
        border-radius: 8px !important;
        padding: 7px 11px !important;
        font-size: 12px !important;
        color: #E7A300 !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
        font-family: system-ui, sans-serif !important;
        white-space: nowrap !important;
      `;
      hint.innerHTML = `
        <svg width="12" height="12" fill="#C78C00" viewBox="0 0 24 24">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
        </svg>
        ${creds.length} senha${creds.length > 1 ? 's' : ''} salva${creds.length > 1 ? 's' : ''} — clique para preencher
      `;

      hint.addEventListener('click', () => {
        hint.remove();
        chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
      });

      document.body.appendChild(hint);

      const remove = () => hint.remove();
      passwordField.addEventListener('blur', remove, { once: true });
      setTimeout(remove, 5000);
    });
  }
})();
