// Extensão: fluxos no estilo do gerenciador do Chrome + proteções
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { Keyring } from '../../frontend/src/utils/keyring.js';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://127.0.0.1:3901';
const SP = process.env.OUT_DIR;
// Chromium do Playwright (npx playwright install chromium) ou outro via CHROME_PATH
const CHROME = process.env.CHROME_PATH || undefined;
const EXT = `${ROOT}extension/dist`;
const SHOTS = process.env.SHOTS === '1';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};

function client() {
  const state = {};
  const call = async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (state.cookie) headers.Cookie = state.cookie;
    const res = await fetch(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) state.cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error(data?.error || res.status); e.status = res.status; throw e; }
    return data;
  };
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}
async function login(l, p) { const c = client(); await c.post('/auth/login', { login: l, password: p }); return c; }

// ── Dados ──
const PW = 'Senha#Forte123';
const admin = await login('admin@vaultguard.local', 'Adm1n!Test#2026');
const akr = new Keyring(admin);
await akr.unlock('Adm1n!Test#2026');
const mk = async (u) => (await admin.post('/users', { email: `${u}@t.local`, username: u, password: PW, firstName: u, lastName: 'T', role: 'ANALISTA' })).id;
const joaoId = await mk('joao');
const mariaId = await mk('maria');
await prisma.user.updateMany({ where: { id: { in: [joaoId, mariaId] } }, data: { mustChangePassword: false } });
const shared = await prisma.folder.create({ data: { name: 'Marketing', visibleToAll: false } });
await prisma.folderPermission.createMany({ data: [joaoId, mariaId].map(userId => ({ folderId: shared.id, userId, canView: true, canEdit: true })) });

const joao = await login('joao', PW);
const jkr = new Keyring(joao); await jkr.unlock(PW);
const maria = await login('maria', PW);
const mkr = new Keyring(maria); await mkr.unlock(PW);
await akr.sync();
await jkr.sync(); await mkr.sync();

const add = async (kr, c, data) => {
  const b = await kr.buildCredentialPayload({ folderId: data.folderId, password: data.password });
  const { password, ...rest } = data;
  return { cred: await c.post('/credentials', { ...rest, ...b.payload }), key: b.key };
};
// João salva a senha da loja (localhost:3999) na pasta compartilhada
await add(jkr, joao, { title: 'Loja (equipe)', username: 'marketing@empresa.com', url: 'http://localhost:3999', folderId: shared.id, password: 'Loja#Joao1' });
// Certificado digital da empresa para o mesmo site
const { cred: cert, key: certKey } = await add(jkr, joao, { title: 'Certificado A1 Empresa', username: 'EMPRESA LTDA', url: 'http://localhost:3999', folderId: shared.id, kind: 'certificate', expiresAt: '2027-05-10', password: 'SenhaDoPfx#1' });
await joao.post(`/attachments/${cert.id}`, { fileName: 'empresa.pfx', mimeType: 'application/x-pkcs12', size: 9, data: await jkr.encryptAttachmentWith(certKey, Buffer.from('PFX-BYTES').toString('base64')) });
// Credencial só https (não pode ir para http) e de outro site
await add(jkr, joao, { title: 'Só https', username: 'tls', url: 'https://127.0.0.1:3999', folderId: shared.id, password: 'SO-HTTPS' });
await add(jkr, joao, { title: 'Google', username: 'g', url: 'https://google.com', folderId: shared.id, password: 'NAO-DEVE-VAZAR' });
const token = (await maria.post('/tokens', { name: 'ext', scopes: ['read', 'write'] })).token;

// ── Sites de teste ──
const loginForm = `<form action="/home" method="get"><input name="email" type="email" placeholder="E-mail"><input name="senha" type="password" placeholder="Senha"><button type="submit">Entrar</button></form>`;
const pages = {
  '/login': loginForm,
  '/callback': loginForm,
  '/spa': `<div id="box"><input id="u" placeholder="E-mail ou CPF"><input id="p" type="password" placeholder="Senha">
    <div role="button" id="go" style="display:inline-block;padding:6px;border:1px solid">Entrar</div></div>
    <script>document.getElementById('go').onclick=()=>setTimeout(()=>{document.getElementById('box').innerHTML='<h1>Bem-vindo</h1>'},300)</script>`,
  '/step1': `<form action="/step2" method="get"><input name="username" autocomplete="username" placeholder="E-mail"><button>Continuar</button></form>`,
  '/step2': `<form action="/home" method="get"><input type="password" name="password" placeholder="Senha"><button>Entrar</button></form>`,
  '/home': `<h1>Área logada</h1>`,
  '/spa-fail': `<div><input id="u" placeholder="E-mail"><input id="p" type="password" placeholder="Senha"><div role="button" id="go">Entrar</div><p id="msg"></p></div>
    <script>document.getElementById('go').onclick=()=>{document.getElementById('msg').textContent='Senha incorreta'}</script>`,
  '/login-fail': `<form action="/login-error" method="get"><input name="email" type="email"><input name="senha" type="password"><button type="submit">Entrar</button></form>`,
  '/login-error': `<p>Senha incorreta</p><form><input name="email" type="email"><input name="senha" type="password"><button>Entrar</button></form>`,
  '/change': `<form action="/home" method="get"><input type="password" autocomplete="current-password" name="atual"><input type="password" autocomplete="new-password" name="nova"><input type="password" name="conf"><button type="submit">Salvar</button></form>`,
  '/prefilled': `<form action="/home" method="get"><input name="email" type="email" value="maria@gmail.com"><input type="password" name="pw"><button>Entrar</button></form>`,
  '/prefilled-other': `<form action="/home" method="get"><input name="email" type="email" value="desconhecido@x.com"><input type="password" name="pw"><button>Entrar</button></form>`,
  '/signup': `<form action="/home" method="get"><input name="email" type="email"><input type="password" name="pw"><input type="password" name="pw2"><button>Criar conta</button></form>`,
};
const site = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><title>Loja</title></head><body style="margin:40px;font-family:sans-serif">${pages[path] || pages['/home']}</body></html>`);
}).listen(3999);

const dir = fs.mkdtempSync(`${SP}/chrome-`);
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: CHROME, headless: false, viewport: { width: 1200, height: 800 },
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  acceptDownloads: true,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const SW = () => ctx.serviceWorkers()[0];
const session = (k) => SW().evaluate((key) => chrome.storage.session.get(key).then(d => d[key]), k);
const local = (k) => SW().evaluate((key) => chrome.storage.local.get(key).then(d => key ? d[key] : d), k);
check('extensão carregada', !!extId);

// ── Conexão e desbloqueio (Maria) ──
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.fill('#serverUrl', BASE);
await popup.fill('#apiToken', token);
await popup.click('#btnConnect');
await popup.waitForSelector('.tab-btn', { timeout: 15000 });
await popup.fill('#searchInput', 'equipe');
await popup.waitForTimeout(300);
check('busca no popup acha a senha que o João salvou na pasta compartilhada', (await popup.textContent('body')).includes('Loja (equipe)'));
const disk = await local(null);
check('em disco só URL do servidor e token', !Object.keys(disk).some(k => /master|keyring|pending/.test(k)), JSON.stringify(Object.keys(disk)));
await popup.locator('.btn-copy-pw').first().click();
await popup.fill('#unlockPassword', PW);
await popup.click('#btnUnlockConfirm');
await popup.waitForSelector('#unlockPassword', { state: 'detached', timeout: 15000 });
check('chaves desbloqueadas só em storage.session', !!(await session('vaultguard_keyring'))?.session);

// ── Preenche sozinho ao abrir o site ──
const page = await ctx.newPage();
await page.goto('http://localhost:3999/login');
await page.waitForTimeout(2500);
const openLayers = () => page.evaluate(() => [...document.documentElement.children].filter(el => el.style.position === 'absolute' && el.style.zIndex === '2147483647').length);
check('preenche usuário e senha ao abrir o site',
  (await page.inputValue('input[type=email]')) === 'marketing@empresa.com' && (await page.inputValue('input[type=password]')) === 'Loja#Joao1');
check('lista não abre sozinha depois do preenchimento automático', (await openLayers()) === 0);
check('preenchimento automático não rouba o foco', await page.evaluate(() => document.activeElement === document.body || document.activeElement === null));
const audit = await prisma.auditLog.findMany({ where: { userId: mariaId }, select: { action: true } });
check('preenchimento automático é auditado como "autofill"', audit.some(a => a.action === 'credential.autofill'), JSON.stringify(audit.map(a => a.action)));
check('credencial de outro site não aparece', !(await page.inputValue('input[type=password]')).includes('NAO-DEVE-VAZAR'));

// O site não enxerga o conteúdo do que a extensão desenha
await page.click('input[type=password]');
await page.waitForTimeout(600);
const dom = await page.evaluate(() => document.documentElement.outerHTML);
check('lista aberta, mas o site não lê títulos/usuários', (await openLayers()) === 1 && !dom.includes('Loja (equipe)') && !dom.includes('Certificado A1'));
await page.keyboard.press('Escape');

const framed = await page.evaluate(async (id) => {
  try { const r = await fetch(`chrome-extension://${id}/popup.html`); return r.status; } catch { return 'bloqueado'; }
}, extId);
check('site não acessa o popup da extensão (clickjacking)', framed === 'bloqueado', String(framed));

// ── Certificado: aviso na página abre o popup na aba de certificados ──
if (SHOTS) await page.screenshot({ path: `${SP}/shot-cert.png` });
const vp = page.viewportSize();
// O VaultGuard já está aberto (aba "popup"): o aviso reaproveita essa aba
await page.mouse.click(vp.width - 60, vp.height - 42);
await page.waitForTimeout(2000);
const certPopup = ctx.pages().find(pg => pg.url().includes('popup.html#certs')) || null;
check('aviso de certificado abre o VaultGuard na aba Certificados', !!certPopup && certPopup === popup, certPopup?.url());
await page.bringToFront();
await page.mouse.click(vp.width - 60, vp.height - 42);
await page.waitForTimeout(1500);
const vgTabs = ctx.pages().filter(pg => pg.url().startsWith(`chrome-extension://${extId}/popup.html`)).length;
check('abrir de novo não duplica a janela do VaultGuard', vgTabs === 1, String(vgTabs));
if (certPopup) {
  await certPopup.waitForSelector('.btn-cert-dl', { timeout: 15000 });
  check('abre direto na aba Certificados', (await certPopup.textContent('.tab-btn.active')).includes('Certificados'));
  check('validade exibida sem voltar um dia', (await certPopup.textContent('body')).includes('10/05/2027'));
  const dl = certPopup.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await certPopup.click('.btn-cert-dl');
  const d = await dl;
  const content = d ? fs.readFileSync(await d.path(), 'utf8') : '';
  check('baixa o .pfx decifrado', d?.suggestedFilename() === 'empresa.pfx' && content === 'PFX-BYTES', `${d?.suggestedFilename()} ${content}`);
  const reqs = [];
  certPopup.on('request', r => reqs.push(r.url()));
  await certPopup.reload();
  await certPopup.waitForTimeout(2000);
  check('popup não chama serviços externos', !reqs.some(u => !u.startsWith('chrome-extension://') && !u.startsWith(BASE)), reqs.join(' '));
}

// ── Duas credenciais: lista ao focar o campo ──
const personal = await prisma.folder.findFirst({ where: { isPersonal: true, ownerId: mariaId } });
await add(mkr, maria, { title: 'Loja (minha)', username: 'maria@gmail.com', url: 'http://localhost:3999', folderId: personal.id, password: 'Pessoal#Maria' });
await page.waitForTimeout(5500); // cache de 5 s da consulta por site
await page.goto('http://localhost:3999/login');
await page.waitForTimeout(2000);
check('com duas credenciais não preenche sozinho', (await page.inputValue('input[type=password]')) === '');
await page.click('input[type=password]');
await page.waitForTimeout(600);
const pwBox = await page.locator('input[type=password]').boundingBox();
const itemY = (n) => pwBox.y + pwBox.height + 4 + 37 + 46 * n + 23;
// Clique sintético (do próprio site) não preenche
await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y })), { x: pwBox.x + 60, y: itemY(1) });
await page.waitForTimeout(1200);
check('clique sintético do site não preenche', (await page.inputValue('input[type=password]')) === '');
await page.mouse.click(pwBox.x + 60, itemY(1));
await page.waitForTimeout(1500);
check('escolher na lista preenche a credencial certa', (await page.inputValue('input[type=password]')) === 'Pessoal#Maria', await page.inputValue('input[type=password]'));

// ── Site já traz o e-mail ("lembrar usuário") ──
const pf = await ctx.newPage();
await pf.goto('http://localhost:3999/prefilled');
await pf.waitForTimeout(2000);
check('e-mail pré-preenchido: completa só a senha da conta certa', (await pf.inputValue('input[type=password]')) === 'Pessoal#Maria' && (await pf.inputValue('input[type=email]')) === 'maria@gmail.com');
await pf.goto('http://localhost:3999/prefilled-other');
await pf.waitForTimeout(2000);
check('e-mail pré-preenchido desconhecido: não preenche nada', (await pf.inputValue('input[type=password]')) === '' && (await pf.inputValue('input[type=email]')) === 'desconhecido@x.com');
await pf.close();

// ── "Preencher" pelo popup (janela própria) mira a aba do site ──
await page.fill('input[type=email]', ''); await page.fill('input[type=password]', '');
await SW().evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 400, height: 680, focused: true }), `chrome-extension://${extId}/popup.html`);
const pop = await ctx.waitForEvent('page', { timeout: 10000 });
await pop.waitForSelector('.btn-fill', { timeout: 15000 });
const idx = await pop.evaluate(() => [...document.querySelectorAll('.cred-item')].findIndex(el => el.innerText.includes('Loja (equipe)')));
await pop.locator('.btn-fill').nth(Math.max(0, idx)).click();
await page.waitForTimeout(2500);
check('popup preenche a aba do site', (await page.inputValue('input[type=password]')) === 'Loja#Joao1', `idx=${idx}`);

// ── Servidor só recebe a origem da página ──
const cb = await ctx.newPage();
await cb.goto('http://localhost:3999/callback?code=SEGREDO-OAUTH-123');
await cb.waitForTimeout(2000);
const srvLog = fs.readFileSync(`${SP}/server.log`, 'utf8');
check('caminho/query da página não vão para o servidor', !srvLog.includes('SEGREDO-OAUTH') && srvLog.includes('by-url'));
await cb.close();

// ── https não vai para http ──
const ip = await ctx.newPage();
await ip.goto('http://127.0.0.1:3999/login');
await ip.waitForTimeout(2000);
check('credencial https não é preenchida em página http', (await ip.inputValue('input[type=password]')) === '');
await ip.close();

// ── Site novo com login por JavaScript: pede para salvar ──
const spa = await ctx.newPage();
await spa.goto('http://127.0.0.1:3999/spa');
await spa.fill('#u', 'nova@empresa.com');
await spa.fill('#p', 'Nova#Senha1');
await spa.click('#go');
await spa.waitForTimeout(2500);
const pend = await session('vaultguard_pending_save');
check('login por JavaScript gera pedido de salvar', pend?.type === 'save' && pend.username === 'nova@empresa.com');
check('pedido oferece pasta pessoal e compartilhada', pend?.folders?.some(f => f.type === 'personal') && pend.folders.some(f => f.path === 'Marketing'));
check('senha detectada fica só na sessão', !JSON.stringify(await local(null)).includes('Nova#Senha1'));
if (SHOTS) await spa.screenshot({ path: `${SP}/shot-save.png` });
const W = 1200;
await spa.mouse.click(W - 310, 180); // Salvar
await spa.waitForTimeout(2500);
const savedNew = await prisma.credential.findFirst({ where: { username: 'nova@empresa.com' }, include: { folder: true } });
let opened = null;
if (savedNew) { const d = await maria.get(`/credentials/${savedNew.id}`); opened = await mkr.decryptValue(d, d.encryptedPass).catch(e => 'ERR ' + e.message); }
check('"Salvar" grava a senha cifrada na pasta escolhida, só com a origem', opened === 'Nova#Senha1' && savedNew.folder.isPersonal && savedNew.url === 'http://127.0.0.1:3999', `${opened} ${savedNew?.url}`);
check('pedido some depois de salvar', !(await session('vaultguard_pending_save')));

// Mesma senha de novo: não pergunta
await spa.goto('http://127.0.0.1:3999/spa');
await spa.waitForTimeout(1500);
await spa.fill('#u', 'nova@empresa.com'); await spa.fill('#p', 'Nova#Senha1');
await spa.click('#go');
await spa.waitForTimeout(2500);
check('senha já salva não gera pedido', !(await session('vaultguard_pending_save')));

// Senha trocada no site: pede para atualizar
await spa.goto('http://127.0.0.1:3999/spa');
await spa.waitForTimeout(1500);
await spa.fill('#u', 'nova@empresa.com'); await spa.fill('#p', 'Trocada#Senha2');
await spa.click('#go');
await spa.waitForTimeout(2500);
const upd = await session('vaultguard_pending_save');
check('senha diferente para o mesmo usuário pede atualização', upd?.type === 'update' && upd.credId === savedNew?.id);
await spa.mouse.click(W - 310, 135); // Atualizar
await spa.waitForTimeout(2500);
const after = await maria.get(`/credentials/${savedNew.id}`);
check('"Atualizar" troca a senha salva', (await mkr.decryptValue(after, after.encryptedPass)) === 'Trocada#Senha2');
check('senha anterior vai para o histórico', (await maria.get(`/credentials/${savedNew.id}/history`)).length === 1);

// ── Login com senha errada (SPA): não oferece salvar ──
const bad = await ctx.newPage();
await bad.goto('http://127.0.0.1:3999/spa-fail');
await bad.fill('#u', 'x@x.com'); await bad.fill('#p', 'Errada#1');
await bad.click('#go');
await bad.waitForTimeout(5000);
{ const pp = await session('vaultguard_pending_save'); check('login que falhou (SPA) não oferece salvar', !pp, JSON.stringify(pp && { ...pp, password: '***', folders: undefined })); }
// ── Login com senha errada (página recarrega com erro) ──
await bad.goto('http://127.0.0.1:3999/login-fail');
await bad.fill('input[type=email]', 'x@x.com'); await bad.fill('input[type=password]', 'Errada#2');
await bad.click('button');
await bad.waitForURL(/login-error/);
await bad.waitForTimeout(2500);
check('login que voltou com erro não oferece salvar', !(await session('vaultguard_pending_save')));

// ── Troca de senha (atual + nova + confirmação, sem campo de usuário) ──
await bad.goto('http://127.0.0.1:3999/change');
await bad.waitForTimeout(1200);
const cps = bad.locator('input[type=password]');
await cps.nth(0).fill('Trocada#Senha2'); await cps.nth(1).fill('Nova#Senha3'); await cps.nth(2).fill('Nova#Senha3');
await bad.click('button');
await bad.waitForURL(/home/);
await bad.waitForTimeout(2500);
const chg = await session('vaultguard_pending_save');
check('troca de senha pede para atualizar a credencial do site (com a senha nova)', chg?.type === 'update' && chg.credId === savedNew?.id, JSON.stringify(chg && { ...chg, password: '***' }));
await bad.mouse.click(W - 310, 135);
await bad.waitForTimeout(2500);
const afterChg = await maria.get(`/credentials/${savedNew.id}`);
check('senha nova da troca é a que fica salva', (await mkr.decryptValue(afterChg, afterChg.encryptedPass)) === 'Nova#Senha3');
const cmp = await prisma.auditLog.count({ where: { userId: mariaId, action: 'credential.compare' } });
check('comparação da senha no login é auditada como "compare"', cmp > 0);
await bad.close();

// ── Cadastro: não preenche sozinho a senha salva ──
const sg = await ctx.newPage();
await sg.goto('http://localhost:3999/signup');
await sg.waitForTimeout(2000);
check('tela de cadastro não recebe preenchimento automático', (await sg.locator('input[type=password]').first().inputValue()) === '');
await sg.close();

// ── O próprio VaultGuard: extensão não age ──
const vg = await ctx.newPage();
await vg.goto(`${BASE}/login`);
await vg.fill('input[placeholder="usuario@empresa.com"]', 'maria');
await vg.fill('input[placeholder="••••••••"]', PW);
await vg.click('button[type="submit"]');
await vg.waitForTimeout(3000);
check('não captura nem oferece salvar a senha do próprio VaultGuard', !(await session('vaultguard_pending_save')));
await vg.close();

// ── Login em duas etapas ──
const st = await ctx.newPage();
await st.goto('http://127.0.0.1:3999/step1');
await st.waitForTimeout(1200);
await st.fill('input[name=username]', 'etapas@empresa.com');
await st.click('button');
await st.waitForURL(/step2/);
await st.waitForTimeout(1200);
await st.fill('input[type=password]', 'Etapas#Pw1');
await st.click('button');
await st.waitForTimeout(2500);
const two = await session('vaultguard_pending_save');
check('login em duas etapas junta usuário e senha', two?.type === 'save' && two.username === 'etapas@empresa.com');
if (SHOTS) await st.screenshot({ path: `${SP}/shot-never.png` });
await st.mouse.click(W - 75, 180); // Nunca neste site
await st.waitForTimeout(1000);
const never = await local('vaultguard_never_save');
check('"Nunca neste site" lembra o site e descarta o pedido', never?.includes('127.0.0.1') && !(await session('vaultguard_pending_save')), JSON.stringify(never));
await st.goto('http://127.0.0.1:3999/spa');
await st.waitForTimeout(1200);
await st.fill('#u', 'outro@x.com'); await st.fill('#p', 'Outra#1234');
await st.click('#go');
await st.waitForTimeout(2500);
check('site marcado como "nunca" não pergunta mais', !(await session('vaultguard_pending_save')));

// ── Bloqueio por inatividade ──
await SW().evaluate(async () => {
  const d = (await chrome.storage.session.get('vaultguard_keyring')).vaultguard_keyring;
  await chrome.storage.session.set({ vaultguard_keyring: { ...d, lastUsed: Date.now() - 31 * 60 * 1000 } });
});
await page.goto('http://localhost:3999/login');
await page.waitForTimeout(1500);
await page.click('input[type=password]');
await page.waitForTimeout(600);
const box2 = await page.locator('input[type=password]').boundingBox();
await page.mouse.click(box2.x + 60, box2.y + box2.height + 4 + 37 + 23);
await page.waitForTimeout(2000);
check('cofre bloqueia após 30 min sem uso', (await page.inputValue('input[type=password]')) === '' && !(await session('vaultguard_keyring')));

// ── 403 (pendência da conta) não apaga o token ──
await prisma.user.update({ where: { id: mariaId }, data: { mustChangePassword: true } });
const pop4 = await ctx.newPage();
await pop4.goto(`chrome-extension://${extId}/popup.html`);
await pop4.waitForTimeout(2500);
const msg = await pop4.textContent('body');
check('403 mostra o motivo e mantém o token', !!(await local('vaultguard_api_token')) && /senha/i.test(msg), msg.slice(0, 120));
await prisma.user.update({ where: { id: mariaId }, data: { mustChangePassword: false } });

console.log(`\n${pass} ok, ${fail} falhas`);
await ctx.close(); site.close(); fs.rmSync(dir, { recursive: true, force: true });
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
