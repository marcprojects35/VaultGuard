// Personalização: cores, logo, favicon e fundo da tela de login
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const sharp = require('sharp');

const APP = process.env.APP_URL || 'http://127.0.0.1:3901';
const CHROME = process.env.CHROME_PATH || undefined;
const OUT = process.env.OUT_DIR || '.out';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Adm1n!Test#2026';
const ADMIN = process.env.ADMIN_EMAIL || 'admin@vaultguard.local';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const issues = [];

// Arquivos de teste
const files = path.join(OUT, 'appearance');
fs.mkdirSync(files, { recursive: true });
const solid = (w, h, color) => sharp({ create: { width: w, height: h, channels: 4, background: color } });
const logo = path.join(files, 'logo.png');
await solid(800, 300, '#1e66f5').png().toFile(logo);
const colorful = path.join(files, 'colorido.jpg');
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff0066"/><stop offset="1" stop-color="#00ccff"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>')).jpeg().toFile(colorful);
const bg = path.join(files, 'fundo.jpg');
await sharp({ create: { width: 3000, height: 2000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg({ quality: 95 }).toFile(bg);
// .ico com uma imagem PNG 32x32 embutida
const png32 = await solid(32, 32, '#e11d48').png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
const favicon = path.join(files, 'favicon.ico');
fs.writeFileSync(favicon, Buffer.concat([ico, png32]));
const big = path.join(files, 'grande.jpg');
fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 1));
const notImage = path.join(files, 'nao-imagem.png');
fs.writeFileSync(notImage, 'isto não é uma imagem');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
function watch(page, label) {
  // 4xx esperados (testes de validação) aparecem como "Failed to load resource"
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) issues.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) issues.push(`[${label}] HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
}
const cssVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const api = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(`/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, url, body]);
const uploadRaw = (page, kind, field, name, bytes) => page.evaluate(async ([kind, field, name, size]) => {
  const fd = new FormData();
  fd.append(field, new Blob([new Uint8Array(size).fill(1)]), name);
  const r = await fetch(`/api/settings/${kind}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [kind, field, name, bytes]);

async function unlock(page) {
  await page.waitForTimeout(800);
  if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
    await page.fill('input[placeholder="Senha"]', PASSWORD);
    await page.click('button:has-text("Desbloquear")');
    await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 15000 });
  }
}

const ctx = await browser.newContext();
const page = await ctx.newPage();
watch(page, 'admin');
await page.goto(`${APP}/login`);
await page.fill('input[placeholder="usuario@empresa.com"]', ADMIN);
await page.fill('input[placeholder="••••••••"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(`${APP}/`, { timeout: 15000 });
await page.waitForTimeout(1500);

// ── Validação no servidor ──
let r = await api(page, 'PUT', '/settings', { primaryColor: '#abc' });
check('cor curta (#abc) é normalizada', r.status === 200 && r.body.primaryColor === '#aabbcc', JSON.stringify(r));
r = await api(page, 'PUT', '/settings', { primaryColor: 'red' });
check('cor inválida dá 400 com mensagem', r.status === 400 && /Cor inválida/.test(r.body?.error), JSON.stringify(r));
r = await api(page, 'PUT', '/settings', { primaryColor: '' });
check('cor principal vazia dá 400', r.status === 400);
r = await api(page, 'PUT', '/settings', { loginOverlay: 95 });
check('escurecimento fora da faixa dá 400', r.status === 400);
r = await api(page, 'PUT', '/settings', { siteName: '   ' });
check('nome do sistema vazio dá 400', r.status === 400);
r = await uploadRaw(page, 'logo', 'logo', 'x.png', 11 * 1024 * 1024);
check('arquivo de 11 MB dá 413', r.status === 413 && /limite/.test(r.body?.error), JSON.stringify(r));
r = await uploadRaw(page, 'logo', 'outro', 'x.png', 100);
check('campo errado dá 400', r.status === 400, JSON.stringify(r));
r = await uploadRaw(page, 'favicon', 'favicon', 'x.ico', 100);
check('arquivo que não é imagem dá 400', r.status === 400 && /Imagem inválida/.test(r.body?.error), JSON.stringify(r));
r = await api(page, 'PUT', '/settings', { primaryColor: '#c78c00' });

// ── Página de Aparência ──
await page.goto(`${APP}/admin/settings/appearance`);
if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
  await page.fill('input[placeholder="Senha"]', PASSWORD);
  await page.click('button:has-text("Desbloquear")');
  await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 15000 });
}
await page.waitForSelector('text=Tela de login');

// Uploads pela interface
await page.setInputFiles('[data-testid="file-logo"]', logo);
await page.waitForSelector('text=Logo atualizado', { timeout: 15000 });
check('logo PNG enviado', /\/uploads\/logo-.*\.webp$/.test(await page.getAttribute('img[alt="Logo"]', 'src') || ''));
await page.setInputFiles('[data-testid="file-favicon"]', favicon);
await page.waitForSelector('text=Favicon atualizado', { timeout: 15000 });
check('favicon .ico enviado', /\/uploads\/favicon-.*\.ico$/.test(await page.getAttribute('link[rel~="icon"]', 'href') || ''));
await page.setInputFiles('[data-testid="file-login-background"]', bg);
await page.waitForSelector('text=Imagem de fundo do login atualizado', { timeout: 30000 });
const bgUrl = await page.getAttribute('img[alt="Imagem de fundo do login"]', 'src');
check('fundo do login enviado (foto 3000x2000)', /\/uploads\/login-background-.*\.webp$/.test(bgUrl || ''));
const meta = await sharp(Buffer.from(await (await page.request.get(`${APP}${bgUrl}`)).body())).metadata();
check('fundo reduzido para no máximo 2560px', meta.width <= 2560 && meta.format === 'webp', JSON.stringify(meta));
await page.setInputFiles('[data-testid="file-logo"]', big);
await page.waitForSelector('text=Arquivo muito grande', { timeout: 5000 }).catch(() => {});
check('arquivo grande avisado sem enviar', await page.isVisible('text=Arquivo muito grande'));
await page.setInputFiles('[data-testid="file-logo"]', notImage);
await page.waitForSelector('text=Imagem inválida', { timeout: 10000 }).catch(() => {});
check('arquivo inválido mostra mensagem clara', await page.isVisible('text=Imagem inválida'));

// Cor: pré-visualização ao vivo e contraste do texto
await page.fill('[data-testid="color-primaryColor"]', '#1e66f5');
await page.waitForTimeout(300);
check('cor aplicada ao vivo', (await cssVar(page, '--color-primary')) === '#1e66f5');
check('rgb derivado', (await cssVar(page, '--color-primary-rgb')) === '30, 102, 245');
check('texto branco sobre cor escura', (await cssVar(page, '--color-on-primary')).toUpperCase() === '#FFFFFF');
await page.fill('[data-testid="color-primaryColor"]', '#1e66f');
check('cor incompleta bloqueia o salvar', await page.isDisabled('[data-testid="save-appearance"]'));
check('cor incompleta não quebra o tema', (await cssVar(page, '--color-primary')) === '#1e66f5');
await page.fill('[data-testid="color-primaryColor"]', '#1e66f5');
await page.fill('[data-testid="color-accentColor"]', '#0b3d91');
await page.fill('[data-testid="login-message-input"]', 'Use seu usuário da rede');
await page.locator('[data-testid="login-overlay"]').fill('40');
await page.click('[data-testid="save-appearance"]');
await page.waitForSelector('text=Aparência salva', { timeout: 10000 });

// Persistência e aplicação em outras telas
await page.goto(`${APP}/`);
await page.waitForTimeout(1500);
check('cor persiste após recarregar', (await cssVar(page, '--color-primary')) === '#1e66f5');
const anyPrimary = await page.evaluate(() => [...document.querySelectorAll('*')].some(el => {
  const s = getComputedStyle(el);
  return [s.color, s.backgroundColor, s.borderColor, s.backgroundImage].some(v => v.includes('30, 102, 245'));
}));
check('cor nova usada nos elementos do cofre', anyPrimary);
const oldGold = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => {
  const s = getComputedStyle(el);
  return [s.color, s.backgroundColor, s.borderColor, s.backgroundImage, s.boxShadow].some(v => v.includes('199, 140, 0'));
}).map(el => el.tagName + '.' + el.className).slice(0, 5));
check('nenhum dourado antigo sobrando no cofre', oldGold.length === 0, JSON.stringify(oldGold));

// Tema claro
r = await api(page, 'PUT', '/settings', { themeMode: 'light' });
await page.reload();
await page.waitForTimeout(1500);
await page.goto(`${APP}/admin/settings/appearance`); await page.waitForTimeout(1500);
check('formulário abre com o tema salvo, não o padrão', await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="theme-light"]')).borderColor.includes('30, 102, 245')));
check('formulário abre com a cor salva', (await page.inputValue('[data-testid="color-primaryColor"]')) === '#1e66f5');
check('tema claro aplicado', (await page.getAttribute('html', 'data-theme')) === 'light' && (await cssVar(page, '--color-bg')).toUpperCase() === '#F5F4EF');
await page.screenshot({ path: path.join(OUT, 'appearance-light.png') });

// ── Tela de login (visitante) ──
const anon = await (await browser.newContext()).newPage();
watch(anon, 'login');
await anon.goto(`${APP}/login`);
await anon.waitForSelector('[data-testid="login-bg"]', { timeout: 10000 });
const bgStyle = await anon.getAttribute('[data-testid="login-bg"]', 'style');
check('login com a imagem da empresa', bgStyle.includes('/uploads/login-background-'));
check('mensagem no login', (await anon.textContent('[data-testid="login-message"]'))?.includes('Use seu usuário da rede'));
const btnColor = await anon.evaluate(() => getComputedStyle(document.querySelector('button[type="submit"]')).color);
check('botão de entrar com texto legível', btnColor === 'rgb(255, 255, 255)', btnColor);
const bgLoaded = await anon.evaluate(async (u) => (await fetch(u)).ok, bgStyle.match(/url\("?([^")]+)/)[1]);
check('imagem de fundo carrega (CSP/rota)', bgLoaded);
await anon.screenshot({ path: path.join(OUT, 'appearance-login.png') });

await page.goto(`${APP}/admin/settings/appearance`); await page.waitForTimeout(1500);
if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
  await page.fill('input[placeholder="Senha"]', PASSWORD);
  await page.click('button:has-text("Desbloquear")');
  await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 15000 });
}
await page.locator('h2:has-text("Tela de login")').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(OUT, 'appearance-page.png') });

// Remoção volta ao padrão e apaga o arquivo
r = await api(page, 'DELETE', '/settings/login-background');
check('remover fundo', r.status === 200);
check('arquivo antigo apagado', !fs.existsSync(path.join(ROOT, 'backend', bgUrl)));
await anon.reload();
await anon.waitForTimeout(1000);
check('login volta ao fundo padrão', !(await anon.isVisible('[data-testid="login-bg"]')));

// ── Fundo da aplicação (telas internas) ──
await page.goto(`${APP}/admin/settings/appearance`);
await unlock(page);
await page.waitForSelector('text=Fundo da aplicação');
await page.setInputFiles('[data-testid="file-app-background"]', colorful);
await page.waitForSelector('text=Imagem de fundo da aplicação atualizado', { timeout: 30000 });
const appBgUrl = await page.getAttribute('img[alt="Imagem de fundo da aplicação"]', 'src');
check('fundo da aplicação enviado', /\/uploads\/app-background-.*\.webp$/.test(appBgUrl || ''));
check('fundo aparece atrás da tela na hora', await page.isVisible('[data-testid="app-bg"]'));
await page.locator('[data-testid="app-overlay"]').fill('50');
await page.waitForTimeout(300);
check('cobertura muda ao vivo', (await cssVar(page, '--app-bg-overlay')) === '0.5');
await page.click('[data-testid="save-appearance"]');
await page.waitForSelector('text=Aparência salva', { timeout: 10000 });
await page.goto(`${APP}/`);
await unlock(page);
check('fundo da aplicação no cofre', await page.isVisible('[data-testid="app-bg"]')
  && (await page.getAttribute('[data-testid="app-bg"]', 'style')).includes('/uploads/app-background-'));
check('cobertura salva persiste', (await cssVar(page, '--app-bg-overlay')) === '0.5');
check('imagem de fundo da aplicação carrega', (await page.request.get(`${APP}${appBgUrl}`)).ok());
const clickable = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('main button')].find(b => b.offsetParent);
  if (!btn) return true;
  const r = btn.getBoundingClientRect();
  return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === btn;
});
check('conteúdo continua clicável por cima do fundo', clickable);
// A imagem precisa aparecer de verdade no meio da tela do cofre (painéis translúcidos)
const shot = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => { const i = (y * shot.info.width + x) * shot.info.channels; return [shot.data[i], shot.data[i + 1], shot.data[i + 2]]; };
const tinted = [[900, 400], [350, 400], [1100, 600]].filter(([x, y]) => { const [r, g, b] = px(x, y); return Math.max(r, g, b) - Math.min(r, g, b) > 12; });
check('imagem visível atrás das páginas', tinted.length >= 2, JSON.stringify([[900, 400], [350, 400], [1100, 600]].map(([x, y]) => px(x, y))));
await page.screenshot({ path: path.join(OUT, 'appearance-app-bg.png') });
r = await api(page, 'PUT', '/settings', { appOverlay: 99 });
check('cobertura fora da faixa dá 400', r.status === 400);
r = await api(page, 'DELETE', '/settings/app-background');
check('remover fundo da aplicação', r.status === 200 && !fs.existsSync(path.join(ROOT, 'backend', appBgUrl)));
await page.reload();
await unlock(page);
check('cofre volta ao fundo liso', !(await page.isVisible('[data-testid="app-bg"]')));

// Temas prontos
await page.goto(`${APP}/admin/settings/appearance`);
await unlock(page);
await page.waitForSelector('text=Temas prontos');
await page.click('[data-testid="preset-Azul e branco"]');
await page.waitForTimeout(300);
check('tema pronto "Azul e branco" aplicado ao vivo', (await cssVar(page, '--color-primary')) === '#1d4ed8'
  && (await cssVar(page, '--color-bg')) === '#f1f5f9' && (await page.getAttribute('html', 'data-theme')) === 'light');
check('aviso de alteração não salva', await page.isVisible('text=Alterações não salvas'));
await page.click('[data-testid="save-appearance"]');
await page.waitForSelector('text=Aparência salva', { timeout: 10000 });
await page.reload();
await page.waitForTimeout(1500);
await unlock(page);
check('tema pronto persiste', (await cssVar(page, '--color-primary')) === '#1d4ed8' && (await cssVar(page, '--color-surface')) === '#ffffff');
await page.screenshot({ path: path.join(OUT, 'appearance-preset-azul-branco.png') });
await page.click('[data-testid="preset-Azul noturno"]');
await page.waitForTimeout(300);
check('tema escuro pronto deriva texto claro', (await page.getAttribute('html', 'data-theme')) === 'dark'
  && (await cssVar(page, '--color-text')).toUpperCase() === '#F0F0EE');
await page.click('[data-testid="save-appearance"]');
await page.waitForSelector('text=Aparência salva', { timeout: 10000 });
const anon2 = await (await browser.newContext()).newPage();
watch(anon2, 'login2');
await anon2.goto(`${APP}/login`);
await anon2.waitForTimeout(1500);
check('login segue o tema salvo', (await cssVar(anon2, '--color-primary')) === '#3b82f6' && (await cssVar(anon2, '--color-bg')) === '#0b1220');
await anon2.screenshot({ path: path.join(OUT, 'appearance-login-preset.png') });

// Padrão de volta para não afetar outros testes
await api(page, 'PUT', '/settings', { primaryColor: '#c78c00', accentColor: '#ad7b04', bgColor: '', surfaceColor: '', themeMode: 'dark', loginMessage: '', appOverlay: 80 });
await api(page, 'DELETE', '/settings/logo');
await api(page, 'DELETE', '/settings/favicon');

check('sem erros no console / 500', issues.length === 0, '\n    ' + issues.join('\n    '));
console.log(`\n${pass} ok, ${fail} falhas`);
await browser.close();
process.exit(fail ? 1 : 0);
