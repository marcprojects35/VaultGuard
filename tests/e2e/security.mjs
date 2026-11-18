// Reforço de segurança: KDF de 600 mil iterações com migração, segredos cifrados no banco,
// auditoria à prova de adulteração, cabeçalhos, política mínima e bloqueio por inatividade
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const { authenticator } = require('otplib');
const raw = new PrismaClient();

const APP = 'http://127.0.0.1:3901';
const ADMIN_PASS = 'Adm1n!Test#2026';
const USER_PASS = 'Us3r!Seguro#2026';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const issues = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
const api = async (page, method, url, body) => {
  const r = await page.request.fetch(`${APP}/api${url}`, { method, headers: H, data: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status(), body: json, headers: r.headers() };
};
async function unlock(page, password) {
  await page.waitForTimeout(800);
  if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
    await page.fill('input[placeholder="Senha"]', password);
    await page.click('button:has-text("Desbloquear")');
    await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 20000 });
  }
}
async function uiLogin(page, email, password) {
  page.on('pageerror', e => issues.push(e.message));
  await page.goto(`${APP}/login`);
  await page.fill('input[placeholder="usuario@empresa.com"]', email);
  await page.fill('input[placeholder="••••••••"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 20000 });
  await page.waitForTimeout(2500);
}
const admin = await (await browser.newContext()).newPage();
await uiLogin(admin, 'admin@vaultguard.local', ADMIN_PASS);
const adminRow = await raw.user.findUnique({ where: { email: 'admin@vaultguard.local' } });
check('chaves novas usam 600.000 iterações', adminRow.kdfIterations === 600000, String(adminRow.kdfIterations));

// ── Política mínima ──
let r = await api(admin, 'POST', '/users', { email: 'curta@teste.local', username: 'curta', password: 'Ab1!cdefgh', firstName: 'C', lastName: 'T', role: 'AUXILIAR' });
check('senha de acesso com menos de 12 caracteres é recusada', r.status === 400, JSON.stringify(r.body));
r = await api(admin, 'POST', '/users', { email: 'leg@teste.local', username: 'leg', password: USER_PASS, firstName: 'Leg', lastName: 'Ado', role: 'ANALISTA' });
check('senha forte é aceita', r.status === 201, JSON.stringify(r.body));
await raw.user.update({ where: { email: 'leg@teste.local' }, data: { mustChangePassword: false } });

// ── Migração: chave cifrada no formato antigo (210 mil) ──
const leg = await (await browser.newContext()).newPage();
await leg.goto(`${APP}/login`);
await leg.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'leg@teste.local', password: USER_PASS }) });
const me = (await api(leg, 'GET', '/keys/me')).body;
const sealed = await leg.evaluate(async ([password, hexSalt]) => {
  const salt = Uint8Array.from(hexSalt.match(/.{2}/g).map(b => parseInt(b, 16)));
  const m = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', hash: 'SHA-256', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey: b64(await crypto.subtle.exportKey('spki', pair.publicKey)), encryptedPrivateKey: JSON.stringify({ v: 2, iv: b64(iv), ct: b64(ct) }) };
}, [USER_PASS, me.encryptionSalt]);
r = await api(leg, 'PUT', '/keys/me', sealed);
let row = await raw.user.findUnique({ where: { email: 'leg@teste.local' } });
check('cliente antigo registra chave com o valor antigo', r.status === 200 && row.kdfIterations === 210000, JSON.stringify(r.body));
const oldSeal = row.encryptedPrivateKey;
await uiLogin(leg, 'leg@teste.local', USER_PASS);
await unlock(leg, USER_PASS);
await leg.waitForTimeout(1500);
row = await raw.user.findUnique({ where: { email: 'leg@teste.local' } });
check('ao entrar, a chave migra sozinha para 600.000', row.kdfIterations === 600000 && row.encryptedPrivateKey !== oldSeal && row.publicKey === sealed.publicKey, String(row.kdfIterations));
await leg.click('button:has-text("Novo")');
await leg.fill('input[placeholder="Ex: Gmail Corporativo"]', 'Conta migrada');
await leg.locator('.fixed select').first().selectOption({ index: 1 });
await leg.locator('.fixed input[type="password"]').first().fill('Segredo#Migrado1');
await leg.click('.fixed button:has-text("Salvar")');
await leg.waitForSelector('text=Credencial criada!', { timeout: 20000 });
const leg2 = await (await browser.newContext()).newPage();
await uiLogin(leg2, 'leg@teste.local', USER_PASS);
await unlock(leg2, USER_PASS);
await leg2.click('text=Conta migrada');
await leg2.waitForTimeout(800);
await leg2.locator('span.font-mono:has-text("★ ★ ★ ★ ★")').first().locator('xpath=following-sibling::button[1]').click();
await leg2.waitForTimeout(1500);
check('depois da migração a senha continua legível em novo login', (await leg2.locator('span.font-mono').first().textContent())?.trim() === 'Segredo#Migrado1');

// ── Bloqueio por inatividade ──
const idleCtx = await browser.newContext();
const idle = await idleCtx.newPage();
await idle.clock.install();
await uiLogin(idle, 'leg@teste.local', USER_PASS).catch(() => {});
await idle.clock.runFor(5000);
await unlock(idle, USER_PASS).catch(() => {});
await idle.clock.fastForward(16 * 60 * 1000);
await idle.clock.runFor(2000);
check('cofre tranca após 15 minutos sem uso', await idle.isVisible('text=Cofre bloqueado'));
await idleCtx.close();

// ── Segredos cifrados no banco ──
const setup = (await api(leg, 'POST', '/auth/2fa/setup')).body;
r = await api(leg, 'POST', '/auth/2fa/verify', { token: authenticator.generate(setup.secret) });
check('2FA ativa', r.status === 200, JSON.stringify(r.body));
const [{ totpSecret }] = await raw.$queryRaw`SELECT "totpSecret" FROM "User" WHERE email = 'leg@teste.local'`;
check('segredo do 2FA cifrado no banco', totpSecret.startsWith('enc:v1:') && !totpSecret.includes(setup.secret));
const login2fa = async () => {
  await raw.$executeRaw`UPDATE "User" SET "totpLastStep" = NULL WHERE email = 'leg@teste.local'`;
  const c = await browser.newContext();
  const a = await (await c.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'leg@teste.local', password: USER_PASS }) })).json();
  const b = await c.request.post(`${APP}/api/auth/2fa/validate`, { headers: H, data: JSON.stringify({ tempToken: a.tempToken, token: authenticator.generate(setup.secret) }) });
  await c.close();
  return b.status();
};
check('login com 2FA funciona com o segredo cifrado', (await login2fa()) === 200);
r = await api(admin, 'PUT', '/settings/email', { provider: 'smtp', smtp: { host: 'smtp.teste.local', port: 587, user: 'u', password: 'SmtpSegredo#1' }, fromEmail: 'a@teste.local' });
check('e-mail salvo', r.status === 200, JSON.stringify(r.body));
await api(admin, 'PUT', '/ldap/config', { enabled: false, config: { servers: [{ id: 'd1', name: 'DC', host: '127.0.0.1', port: 389, baseDn: 'dc=a', bindDn: 'cn=a', bindPassword: 'AdSegredo#1' }], activeServerId: 'd1' } });
const [s1] = await raw.$queryRaw`SELECT "ldapConfig"::text AS l, "smtpConfig"::text AS s FROM "SystemSettings"`;
check('senha da conta de serviço do AD cifrada', !s1.l.includes('AdSegredo#1') && s1.l.includes('enc:v1:'));
check('senha do SMTP cifrada', !String(s1.s).includes('SmtpSegredo#1') && String(s1.s).includes('enc:v1:'), String(s1.s).slice(0, 120));
r = await api(admin, 'GET', '/ldap/config');
check('tela continua mascarando a senha do AD', r.body.config.servers[0].bindPassword === '••••••••');
// Instalação antiga: texto puro é cifrado ao subir
await raw.$executeRaw`UPDATE "User" SET "totpSecret" = ${setup.secret} WHERE email = 'leg@teste.local'`;
const { migrateSecrets } = await import(`${ROOT}backend/src/services/migrateSecrets.js`);
await migrateSecrets();
const [{ totpSecret: t2 }] = await raw.$queryRaw`SELECT "totpSecret" FROM "User" WHERE email = 'leg@teste.local'`;
check('segredos antigos em texto puro são cifrados ao iniciar', t2.startsWith('enc:v1:'));
check('e o 2FA continua funcionando', (await login2fa()) === 200);

// ── Auditoria à prova de adulteração ──
r = await api(admin, 'GET', '/audit/verify');
check('corrente da auditoria íntegra', r.body.ok === true && r.body.checked > 5, JSON.stringify(r.body));
const victim = await raw.auditLog.findFirst({ where: { chainSeq: { gt: 3 } }, orderBy: { chainSeq: 'asc' } });
await raw.$executeRaw`UPDATE "AuditLog" SET action = 'user.logout' WHERE id = ${victim.id}`;
r = await api(admin, 'GET', '/audit/verify');
check('alterar um registro é detectado', r.body.ok === false && r.body.brokenAt === victim.chainSeq, JSON.stringify(r.body));
await raw.$executeRaw`UPDATE "AuditLog" SET action = ${victim.action} WHERE id = ${victim.id}`;
await raw.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${victim.id}`;
r = await api(admin, 'GET', '/audit/verify');
check('apagar um registro do meio é detectado', r.body.ok === false, JSON.stringify(r.body));
await raw.$executeRaw`INSERT INTO "AuditLog" (id,"userId",action,"resourceId","resourceType",details,"ipAddress","userAgent","createdAt","actorId","chainSeq","prevHash",hash)
  VALUES (${victim.id},${victim.userId},${victim.action},${victim.resourceId},${victim.resourceType},${victim.details === null ? null : JSON.stringify(victim.details)}::jsonb,${victim.ipAddress},${victim.userAgent},${victim.createdAt},${victim.actorId},${victim.chainSeq},${victim.prevHash},${victim.hash})`;
await api(admin, 'POST', '/users', { email: 'tchau@teste.local', username: 'tchau', password: USER_PASS, firstName: 'T', lastName: 'C', role: 'AUXILIAR' });
const bye = await raw.user.findUnique({ where: { email: 'tchau@teste.local' } });
await raw.user.update({ where: { id: bye.id }, data: { mustChangePassword: false } });
const byeCtx = await browser.newContext();
await byeCtx.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'tchau@teste.local', password: USER_PASS }) });
await byeCtx.close();
await api(admin, 'DELETE', `/users/${bye.id}`);
r = await api(admin, 'GET', '/audit/verify');
check('excluir um usuário não quebra a corrente', r.body.ok === true, JSON.stringify(r.body));
await admin.goto(`${APP}/admin/audit`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="verify-audit"]');
await admin.waitForSelector('[data-testid="audit-integrity"]', { timeout: 15000 });
check('botão mostra o resultado da verificação', /Íntegro/.test(await admin.locator('[data-testid="audit-integrity"]').innerText()));

// ── Cabeçalhos e exposição ──
const home = await admin.request.get(`${APP}/login`);
const h = home.headers();
check('HSTS de 1 ano', /max-age=31536000/.test(h['strict-transport-security'] || ''), h['strict-transport-security']);
check('CSP sem script inline', /script-src 'self'/.test(h['content-security-policy'] || '') && !/script-src[^;]*unsafe/.test(h['content-security-policy']));
check('não anuncia a tecnologia', !h['x-powered-by']);
check('Permissions-Policy e nosniff', /camera=\(\)/.test(h['permissions-policy'] || '') && h['x-content-type-options'] === 'nosniff');
r = await api(admin, 'GET', '/folders');
check('API sem cache', r.headers['cache-control'] === 'no-store', r.headers['cache-control']);
const anon = await (await browser.newContext()).request.get(`${APP}/api/settings`);
const pub = await anon.json();
check('rota pública não revela a política de segurança', !('passwordPolicy' in pub) && !('maxLoginAttempts' in pub) && !('require2FA' in pub) && !('ldapEnabled' in pub) && !('smtpConfig' in pub), Object.keys(pub).join(','));
const health = await (await admin.request.get(`${APP}/api/health`)).json();
check('health não revela versão', !('version' in health));

// ── Backup offline do cofre ──
globalThis.btoa ||= (s) => Buffer.from(s, 'binary').toString('base64');
const { encryptVault, decryptVault } = await import(`${ROOT}frontend/src/utils/crypto.js`);
const file = await encryptVault({ a: 1 }, 'Frase#Longa#2026');
check('backup offline usa 600.000 iterações', JSON.parse(file).iterations === 600000 && JSON.parse(file).v === 2);
check('backup offline abre', (await decryptVault(file, 'Frase#Longa#2026')).a === 1);

check('sem erros de JavaScript', issues.length === 0, issues.join(' | '));
console.log(`\n${pass} ok, ${fail} falhas`);
await browser.close();
await raw.$disconnect();
process.exit(fail ? 1 : 0);
