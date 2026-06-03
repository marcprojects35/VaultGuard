// VaultGuard Content Script — Autofill e detecção de formulários

(function () {
  'use strict';

  // Escuta mensagens do popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AUTOFILL') {
      autofill(message.username, message.password);
      sendResponse({ success: true });
    }

    if (message.type === 'GET_CREDENTIALS') {
      const creds = getPageCredentials();
      sendResponse(creds);
    }

    return true;
  });

  // ── Autofill ────────────────────────────────────────────────────────────────
  function autofill(username, password) {
    const { usernameField, passwordField } = findLoginFields();

    if (usernameField && username) {
      setNativeInputValue(usernameField, username);
    }
    if (passwordField && password) {
      setNativeInputValue(passwordField, password);
    }

    // Flash visual para feedback
    [usernameField, passwordField].filter(Boolean).forEach(el => {
      el.style.transition = 'outline 0.3s';
      el.style.outline = '2px solid #6366f1';
      setTimeout(() => { el.style.outline = ''; }, 1500);
    });
  }

  // Simula digitação real para frameworks como React/Vue/Angular
  function setNativeInputValue(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Detecção de formulários ─────────────────────────────────────────────────
  function findLoginFields() {
    // Campos de senha visíveis
    const passwordFields = Array.from(document.querySelectorAll('input[type="password"]'))
      .filter(el => isVisible(el));

    if (passwordFields.length === 0) return {};

    const passwordField = passwordFields[0];
    const form = passwordField.closest('form');

    // Buscar campo de usuário no mesmo form ou na página
    const usernameSelectors = [
      'input[type="email"]',
      'input[type="text"][name*="user"]',
      'input[type="text"][name*="email"]',
      'input[type="text"][name*="login"]',
      'input[type="text"][autocomplete*="username"]',
      'input[type="text"][autocomplete*="email"]',
      'input[id*="user"]',
      'input[id*="email"]',
      'input[id*="login"]',
      'input[type="text"]',
    ];

    let usernameField = null;
    for (const sel of usernameSelectors) {
      const fields = (form || document).querySelectorAll(sel);
      const visible = Array.from(fields).filter(el => isVisible(el) && el !== passwordField);
      if (visible.length > 0) { usernameField = visible[0]; break; }
    }

    return { usernameField, passwordField };
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
      getComputedStyle(el).visibility !== 'hidden' &&
      getComputedStyle(el).display !== 'none';
  }

  // ── Capturar credenciais da página ──────────────────────────────────────────
  function getPageCredentials() {
    const { usernameField, passwordField } = findLoginFields();
    return {
      username: usernameField?.value || '',
      password: passwordField?.value || '',
    };
  }

  // ── Sugestão automática (indicador visual) ──────────────────────────────────
  let suggestTimeout;
  document.addEventListener('focusin', (e) => {
    if (e.target.type !== 'password') return;
    clearTimeout(suggestTimeout);
    suggestTimeout = setTimeout(() => showSuggestionHint(e.target), 300);
  }, true);

  function showSuggestionHint(passwordField) {
    // Remove hints anteriores
    document.querySelectorAll('.vaultguard-hint').forEach(el => el.remove());

    const rect = passwordField.getBoundingClientRect();
    if (!rect.width) return;

    const hint = document.createElement('div');
    hint.className = 'vaultguard-hint';
    hint.style.cssText = `
      position: fixed;
      top: ${rect.bottom + window.scrollY + 4}px;
      left: ${rect.left + window.scrollX}px;
      background: #1a1d2e;
      border: 1px solid #6366f1;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: #a5b4fc;
      cursor: pointer;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      font-family: system-ui, sans-serif;
      pointer-events: auto;
    `;
    hint.innerHTML = `<svg width="12" height="12" fill="#6366f1" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg> VaultGuard — clique no ícone para preencher`;

    // Verificar se há credenciais para o site
    chrome.runtime.sendMessage({ type: 'FETCH_CREDS_FOR_URL', url: window.location.href }, (creds) => {
      if (!creds || creds.length === 0) return;
      hint.textContent = '';
      hint.innerHTML = `<svg width="12" height="12" fill="#6366f1" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg> ${creds.length} senha${creds.length > 1 ? 's' : ''} salva${creds.length > 1 ? 's' : ''} — clique no ícone 🔐`;
      document.body.appendChild(hint);

      const remove = () => hint.remove();
      hint.addEventListener('click', remove);
      passwordField.addEventListener('blur', remove, { once: true });
      setTimeout(remove, 4000);
    });
  }
})();
