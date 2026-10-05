// VaultGuard Content Script
//
// Roda só no frame principal. Não vê token, chaves nem senhas guardadas: pede
// ao service worker, que confere o domínio da aba. Tudo que é desenhado na
// página fica num shadow root fechado (o site não lê nem clica por script).

(function () {
  'use strict';
  if (window.top !== window) return;

  const send = (msg) => new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r ?? null); });
    } catch { resolve(null); }
  });

  let page = { configured: false, unlocked: false, autofill: false, logins: [], certs: [], stepUsername: '' };
  let autofilled = false;
  let promptShown = false;
  let userTyped = false; // a pessoa já digitou em algum campo desta página

  // ─── Campos ────────────────────────────────────────────────────────────────

  const USER_HINT = /user|usu[aá]rio|email|e-mail|login|conta|account|cpf|cnpj|documento|matr[ií]cula/i;

  function isVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  function passwordFields(root = document) {
    return [...root.querySelectorAll('input[type="password"]')].filter(isVisible);
  }

  // Cadastro ou troca de senha (campo de senha nova / mais de um campo de senha)
  function isNewPasswordForm() {
    const pws = passwordFields();
    return pws.length > 1 || pws.some(el => (el.autocomplete || '').toLowerCase() === 'new-password');
  }

  // Senha a guardar: em "trocar senha" (atual + nova + confirmação) é a nova,
  // reconhecida pelo autocomplete ou por aparecer repetida na confirmação
  function chosenPassword() {
    const filled = passwordFields().filter(el => el.value);
    if (filled.length <= 1) return filled[0] || null;
    const byHint = filled.find(el => (el.autocomplete || '').toLowerCase() === 'new-password');
    if (byHint) return byHint;
    const repeated = filled.find((el, i) => filled.some((o, j) => j !== i && o.value === el.value));
    return repeated || filled[filled.length - 1];
  }

  function isUsernameLike(el) {
    if (!el || el.tagName !== 'INPUT' || !isVisible(el)) return false;
    const type = (el.type || 'text').toLowerCase();
    if (!['text', 'email', 'tel', ''].includes(type)) return false;
    const ac = (el.autocomplete || '').toLowerCase();
    if (ac === 'username' || ac === 'email') return true;
    return USER_HINT.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`);
  }

  // Campo de usuário que acompanha um campo de senha (o mais próximo antes dele)
  function usernameFieldFor(pw) {
    const scope = pw.closest('form') || document;
    const inputs = [...scope.querySelectorAll('input')].filter(el => el !== pw && isVisible(el));
    const before = inputs.filter(el => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    const typed = (list) => list.filter(el => ['text', 'email', 'tel', ''].includes((el.type || 'text').toLowerCase()));
    return [...before].reverse().find(isUsernameLike) || typed(before).pop() || inputs.find(isUsernameLike) || null;
  }

  // Tela só de usuário (1ª etapa de login em duas telas)
  function loneUsernameField() {
    if (passwordFields().length) return null;
    return [...document.querySelectorAll('input')].find(isUsernameLike) || null;
  }

  // Foco causado pelo próprio preenchimento não abre a lista de credenciais
  let filling = false;

  // focus=false no preenchimento automático: não tira o cursor de onde o usuário está
  function setNativeInputValue(el, value, focus = true) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    filling = true;
    if (focus) el.focus();
    setTimeout(() => { filling = false; }, 300);
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function highlight(...els) {
    els.filter(Boolean).forEach(el => {
      el.style.transition = 'outline 0.3s';
      el.style.outline = '2px solid #C78C00';
      setTimeout(() => { el.style.outline = ''; }, 1500);
    });
  }

  async function fillCredential(credId, { interactive = true, passwordOnly = false } = {}) {
    const pw = passwordFields()[0] || null;
    const user = pw ? usernameFieldFor(pw) : loneUsernameField();
    if (!pw && !user) return false;
    const result = await send({ type: 'FILL_CREDENTIAL', credId, interactive, usernameOnly: !pw });
    if (!result || result.error) return false;
    // Automático: a resposta leva um instante; se nesse meio-tempo a pessoa
    // começou a digitar, não sobrescreve o que ela escreveu
    if (!interactive && (userTyped || pw?.value || (!passwordOnly && user?.value))) return false;
    if (user && result.username && !passwordOnly) setNativeInputValue(user, result.username, interactive);
    if (pw && result.password) setNativeInputValue(pw, result.password, interactive);
    highlight(user, pw);
    if (!pw && result.username) send({ type: 'REMEMBER_USERNAME', username: result.username });
    return true;
  }

  // ─── Shadow root fechado ───────────────────────────────────────────────────

  const BASE_CSS = `
    *{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
    .card{background:#111111;border:1px solid #C78C00;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#e2e8f0;overflow:hidden;animation:pop .18s ease}
    @keyframes pop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
    .head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#0D0D0D;border-bottom:1px solid #1E1E1E;font-size:12px;font-weight:600;color:#94a3b8}
    .head b{color:#E7A300;font-weight:600}
    .x{margin-left:auto;background:none;border:none;color:#555552;font-size:14px;cursor:pointer;padding:2px 4px}
    .x:hover{color:#f87171}
    .item{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid #1A1A1A;cursor:pointer}
    .item:last-child{border-bottom:none}
    .item:hover{background:#1A1A1A}
    .av{width:26px;height:26px;border-radius:6px;background:#C78C0022;color:#E7A300;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .info{flex:1;min-width:0}
    .t{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .s{font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
    .body{padding:12px 14px}
    .msg{font-size:13px;margin-bottom:10px;line-height:1.4}
    .msg small{display:block;color:#64748b;font-size:11px;margin-top:2px}
    select{width:100%;background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:7px 10px;color:#e2e8f0;font-size:12px;margin-bottom:10px;outline:none}
    .row{display:flex;gap:8px;align-items:center}
    .btn{border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.5;cursor:default}
    .pri{background:linear-gradient(135deg,#C78C00,#AD7B04);color:#fff}
    .sec{background:none;border:1px solid #2A2A2A;color:#94a3b8}
    .link{background:none;border:none;color:#64748b;font-size:11px;cursor:pointer;margin-left:auto;text-decoration:underline}
    .ok{color:#22c55e;font-size:13px;padding:12px 14px}
    .err{color:#f87171;font-size:11px;margin-bottom:8px}
  `;

  function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const initial = (s) => esc(String(s || '?').trim().charAt(0).toUpperCase() || '?');

  function makeLayer(style) {
    const host = document.createElement('div');
    host.style.cssText = style;
    const shadow = host.attachShadow({ mode: 'closed' });
    const css = document.createElement('style');
    css.textContent = BASE_CSS;
    shadow.appendChild(css);
    document.documentElement.appendChild(host);
    return { host, shadow };
  }

  // Ação só com clique real do usuário (a página não consegue disparar)
  function onTrusted(el, fn) {
    el?.addEventListener('click', (e) => { if (e.isTrusted) fn(e); });
  }

  // ─── Lista de credenciais junto ao campo ───────────────────────────────────

  let dropdown = null;
  function closeDropdown() { dropdown?.host.remove(); dropdown = null; }

  function showDropdown(field) {
    closeDropdown();
    if (!page.logins.length) return;
    const r = field.getBoundingClientRect();
    const width = Math.max(260, Math.min(340, r.width));
    const height = Math.min(page.logins.length * 46 + 40, 300);
    const below = window.innerHeight - r.bottom > height + 8;
    const top = (below ? r.bottom + 4 : r.top - height - 4) + window.scrollY;
    const left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 8));

    dropdown = makeLayer(`position:absolute;top:${top}px;left:${left}px;width:${width}px;z-index:2147483647`);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="head">VaultGuard <span style="font-weight:400">· ${esc(location.hostname)}</span><button class="x" title="Fechar">✕</button></div>
      <div style="max-height:260px;overflow-y:auto">
        ${page.logins.map(c => `
          <div class="item" data-id="${esc(c.id)}">
            <div class="av">${initial(c.title)}</div>
            <div class="info"><div class="t">${esc(c.username || c.title)}</div><div class="s">${esc(c.title)}</div></div>
          </div>`).join('')}
      </div>`;
    dropdown.shadow.appendChild(card);
    onTrusted(card.querySelector('.x'), closeDropdown);
    card.querySelectorAll('.item').forEach(item => onTrusted(item, async () => {
      item.style.opacity = '0.5';
      await fillCredential(item.dataset.id);
      closeDropdown();
    }));
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (filling || !(el instanceof HTMLInputElement) || !page.logins.length) return;
    const isPw = el.type === 'password';
    if (!isPw && !(isUsernameLike(el) && (passwordFields().length || loneUsernameField() === el))) return;
    // Campo já preenchido: a lista só abre com clique (ver mousedown)
    if (el.value) return;
    setTimeout(() => { if (!filling && !el.value && document.activeElement === el) showDropdown(el); }, 120);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (dropdown && e.target !== dropdown.host) closeDropdown();
    // Clique num campo de login já preenchido (ex.: após o preenchimento
    // automático) abre a lista para trocar de conta
    const el = e.target;
    if (e.isTrusted && el instanceof HTMLInputElement && el.value && page.logins.length &&
        (el.type === 'password' || isUsernameLike(el))) {
      setTimeout(() => showDropdown(el), 50);
    }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); }, true);
  // Digitou no campo: a pessoa não quer a lista (como no Chrome) e ela não
  // pode ficar por cima do botão de entrar
  // Também marca que a pessoa já está digitando: o preenchimento automático
  // (que pode chegar um pouco depois) não sobrescreve o que ela escreveu
  document.addEventListener('input', (e) => {
    if (!e.isTrusted || filling) return;
    userTyped = true;
    closeDropdown();
  }, true);
  // Posição absoluta fica errada ao rolar ou redimensionar: fecha
  window.addEventListener('scroll', closeDropdown, { passive: true, capture: true });
  window.addEventListener('resize', closeDropdown, { passive: true });

  // ─── Pedido de salvar / atualizar senha ────────────────────────────────────

  let promptLayer = null;
  function closePrompt() { promptLayer?.host.remove(); promptLayer = null; }

  const FOLDER_ICON = { personal: '🔒', team: '👥', shared: '🏢' };

  function showPrompt(p) {
    if (!p || promptShown) return;
    promptShown = true;
    closeDropdown();
    closePrompt();
    promptLayer = makeLayer('position:fixed;top:16px;right:16px;width:340px;z-index:2147483647');
    const card = document.createElement('div');
    card.className = 'card';
    const who = esc(p.username || 'sem usuário');

    if (p.type === 'update') {
      card.innerHTML = `
        <div class="head">VaultGuard<button class="x" title="Fechar">✕</button></div>
        <div class="body">
          <div class="msg">Atualizar a senha salva?<small>${who} · ${esc(p.credTitle || p.host)}</small></div>
          <div class="err" hidden></div>
          <div class="row"><button class="btn pri act">Atualizar</button><button class="btn sec no">Agora não</button></div>
        </div>`;
    } else {
      const folders = p.folders || [];
      const selected = folders.some(f => f.id === p.lastFolderId) ? p.lastFolderId : folders[0]?.id;
      card.innerHTML = `
        <div class="head">VaultGuard<button class="x" title="Fechar">✕</button></div>
        <div class="body">
          <div class="msg">Salvar senha de <b>${esc(p.host)}</b>?<small>${who}</small></div>
          ${folders.length ? `
            <select class="folder" title="Pasta">
              ${folders.map(f => `<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${FOLDER_ICON[f.type] || '📁'} ${esc(f.path)}</option>`).join('')}
            </select>` : '<div class="err">Você não tem nenhuma pasta onde possa salvar.</div>'}
          <div class="err" hidden></div>
          <div class="row">
            <button class="btn pri act" ${folders.length ? '' : 'disabled'}>${p.locked ? 'Desbloquear e salvar' : 'Salvar'}</button>
            <button class="btn sec no">Agora não</button>
            <button class="link never">Nunca neste site</button>
          </div>
        </div>`;
    }
    promptLayer.shadow.appendChild(card);
    const errBoxes = card.querySelectorAll('.err');
    const errBox = errBoxes[errBoxes.length - 1];
    const done = (text) => {
      card.innerHTML = `<div class="ok">✓ ${esc(text)}</div>`;
      setTimeout(closePrompt, 1800);
    };

    onTrusted(card.querySelector('.x'), () => { send({ type: 'DISMISS_PROMPT' }); closePrompt(); });
    onTrusted(card.querySelector('.no'), () => { send({ type: 'DISMISS_PROMPT' }); closePrompt(); });
    onTrusted(card.querySelector('.never'), () => { send({ type: 'NEVER_SAVE' }); closePrompt(); });
    onTrusted(card.querySelector('.act'), async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const r = p.type === 'update'
        ? await send({ type: 'UPDATE_PENDING' })
        : await send({ type: 'SAVE_PENDING', folderId: card.querySelector('.folder')?.value });
      if (r?.ok) return done(p.type === 'update' ? 'Senha atualizada no VaultGuard' : 'Senha salva no VaultGuard');
      if (r?.needsUnlock) return done('Desbloqueie o cofre na janela do VaultGuard para concluir');
      btn.disabled = false;
      errBox.hidden = false;
      errBox.textContent = r?.error || 'Não foi possível concluir';
    });

    // Some sozinho depois de um tempo, sem descartar (ainda aparece na próxima página)
    setTimeout(() => { if (promptLayer?.shadow.contains(card)) closePrompt(); }, 45000);
  }

  // ─── Aviso de certificado digital ──────────────────────────────────────────

  function showCertBanner(certs) {
    if (!certs.length) return;
    const layer = makeLayer('position:fixed;bottom:16px;right:16px;width:340px;z-index:2147483646');
    const card = document.createElement('div');
    card.className = 'card';
    // Validade é data sem hora (meia-noite UTC): exibir em UTC para não voltar um dia
    const fmt = (d) => { try { return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }); } catch { return ''; } };
    card.innerHTML = `
      <div class="head">🔐 Certificado digital no VaultGuard<button class="x" title="Fechar">✕</button></div>
      ${certs.map(c => `
        <div class="item" data-id="${esc(c.id)}">
          <div class="av">🔐</div>
          <div class="info"><div class="t">${esc(c.title)}</div><div class="s">${esc(c.username)}${c.expiresAt ? ` · vence ${esc(fmt(c.expiresAt))}` : ''}</div></div>
          <button class="btn pri">Abrir</button>
        </div>`).join('')}`;
    layer.shadow.appendChild(card);
    onTrusted(card.querySelector('.x'), () => { send({ type: 'DISMISS_CERT' }); layer.host.remove(); });
    card.querySelectorAll('.item').forEach(item => onTrusted(item, () => send({ type: 'OPEN_POPUP', view: 'certs', credId: item.dataset.id })));
  }

  // ─── Captura do login (formulário, botão por JavaScript, Enter) ────────────

  let lastCapture = { key: '', at: 0 };

  function capture() {
    if (!page.configured) return;
    const pw = chosenPassword();
    if (!pw) {
      // 1ª etapa (só usuário): guarda para quando a senha for pedida
      const user = loneUsernameField();
      if (user?.value) send({ type: 'REMEMBER_USERNAME', username: user.value });
      return;
    }
    // Na troca de senha o campo de usuário costuma não existir: fica vazio e o
    // service worker usa o da credencial salva do site
    const user = usernameFieldFor(passwordFields()[0] || pw);
    const username = user?.value || '';
    const key = `${username}\u0000${pw.value}`;
    if (key === lastCapture.key && Date.now() - lastCapture.at < 5000) return;
    lastCapture = { key, at: Date.now() };

    const typed = pw.value;
    send({ type: 'CAPTURE_LOGIN', username, password: typed, title: document.title }).then(prompt => {
      if (!prompt) return;
      // Sites que não recarregam a página (SPA): se o campo de senha continua
      // na tela com o mesmo valor, o login provavelmente falhou (senha errada)
      // e não oferece salvar. Se a página navegar, a próxima mostra o aviso.
      setTimeout(() => {
        if (pw.isConnected && isVisible(pw) && pw.value === typed) { send({ type: 'DISMISS_PROMPT' }); return; }
        showPrompt(prompt);
      }, 1500);
    });
  }

  document.addEventListener('submit', capture, true);
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const btn = e.target.closest?.('button, input[type="submit"], input[type="button"], [role="button"], a');
    if (!btn) return;
    const label = `${btn.innerText || btn.value || ''} ${btn.id} ${btn.name || ''} ${btn.className || ''}`.toLowerCase();
    if (btn.type === 'submit' || /entrar|login|log in|sign in|acessar|continuar|avançar|pr[oó]ximo|next|continue|enviar|confirmar/.test(label)) {
      capture();
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.isTrusted && e.target instanceof HTMLInputElement) capture();
  }, true);

  // ─── Mensagens do popup ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'AUTOFILL') {
      const pw = passwordFields()[0];
      const user = pw ? usernameFieldFor(pw) : loneUsernameField();
      if (message.username && user) setNativeInputValue(user, message.username);
      if (message.password && pw) setNativeInputValue(pw, message.password);
      highlight(user, pw);
      sendResponse({ success: true });
    }
    if (message.type === 'GET_CREDENTIALS') {
      const pw = passwordFields()[0];
      const user = pw ? usernameFieldFor(pw) : loneUsernameField();
      sendResponse({ username: user?.value || '', password: pw?.value || '' });
    }
    return true;
  });

  // ─── Início ────────────────────────────────────────────────────────────────

  // Preencher sozinho só quando é inequívoco: uma credencial (ou a do usuário
  // da 1ª etapa), cofre desbloqueado, campos vazios e página https/local
  function canAutofill() {
    if (autofilled || userTyped || !page.autofill || !page.unlocked) return null;
    const secure = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!secure) return null;
    const byStep = page.stepUsername && page.logins.filter(c => c.username.toLowerCase() === page.stepUsername.toLowerCase());
    const choice = byStep?.length === 1 ? byStep[0] : page.logins.length === 1 ? page.logins[0] : null;
    const pw = passwordFields()[0];
    // Cadastro / troca de senha: nunca preenche sozinho (o usuário escolhe na lista)
    if (pw) {
      if (pw.value || isNewPasswordForm()) return null;
      // Site já trouxe o usuário preenchido ("lembrar e-mail"): completa só a
      // senha, se for de uma credencial salva para esse usuário
      const prefilled = usernameFieldFor(pw)?.value?.trim().toLowerCase();
      if (prefilled) {
        const same = page.logins.filter(c => c.username.toLowerCase() === prefilled);
        return same.length === 1 ? { ...same[0], passwordOnly: true } : null;
      }
      return choice;
    }
    const user = loneUsernameField();
    return choice && user && !user.value ? choice : null;
  }

  async function tryAutofill() {
    const choice = canAutofill();
    if (!choice) return;
    autofilled = true;
    if (!(await fillCredential(choice.id, { interactive: false, passwordOnly: !!choice.passwordOnly }))) autofilled = false;
  }

  async function init() {
    page = { ...page, ...((await send({ type: 'PAGE_INFO' })) || {}) };
    if (!page.configured) return;
    tryAutofill();
    showCertBanner(page.certs || []);
    const pending = await send({ type: 'GET_PROMPT' });
    if (pending) {
      // Voltou para uma tela com campo de senha (ex.: "senha incorreta"): o
      // login falhou; não oferece salvar a senha errada
      setTimeout(() => {
        if (pending.type === 'save' && passwordFields().length) { send({ type: 'DISMISS_PROMPT' }); return; }
        showPrompt(pending);
      }, 800);
    }

    // Formulários que aparecem depois (SPA, modais de login)
    let tries = 0;
    const obs = new MutationObserver(() => {
      if (autofilled || ++tries > 200) { obs.disconnect(); return; }
      tryAutofill();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 15000);
  }

  init();
})();
