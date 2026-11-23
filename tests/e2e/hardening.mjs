// Verificação de segurança: acesso indevido, mass assignment, vazamento em respostas,
// uploads, robôs, RLS no banco, cabeçalhos e LGPD
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import fs from 'fs';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const owner = new PrismaClient();
const appDb = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });

const APP = 'http://127.0.0.1:3901';
const ADMIN_PASS = 'Adm1n!Test#2026', USER_PASS = 'Us3r!Seguro#2026';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const session = async (login, password) => {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login, password }) });
  if (!res.ok()) throw new Error(`login ${login}: ${res.status()}`);
  return ctx;
};
const call = async (ctx, method, url, body) => {
  const r = await ctx.request.fetch(`${APP}/api${url}`, { method, headers: H, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status(), body: json, headers: r.headers() };
};

const admin = await session('admin@vaultguard.local', ADMIN_PASS);
const mk = async (email, role) => {
  const r = await call(admin, 'POST', '/users', { email, username: email.split('@')[0], password: USER_PASS, firstName: email[0].toUpperCase(), lastName: 'Teste', role });
  await owner.user.update({ where: { email }, data: { mustChangePassword: false } });
  return r.body.id;
};
const aliceId = await mk('alice@teste.local', 'ANALISTA');
const bobId = await mk('bob@teste.local', 'AUXILIAR');
const alice = await session('alice@teste.local', USER_PASS);
const bob = await session('bob@teste.local', USER_PASS);
const anon = await browser.newContext();

// ── Autenticação no servidor: toda rota exige sessão, salvo a lista pública ──
const server = fs.readFileSync(`${ROOT}backend/src/server.js`, 'utf8');
const imports = Object.fromEntries([...server.matchAll(/import (\w+) from '\.\/routes\/([\w.]+)'/g)].map(m => [m[1], m[2]]));
const routes = [];
for (const [, prefix, name] of server.matchAll(/app\.use\('(\/api\/[a-z-]+)',\s*(\w+)\)/g)) {
  if (!imports[name]) continue;
  const src = fs.readFileSync(`${ROOT}backend/src/routes/${imports[name]}`, 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|delete)\(\s*'([^']*)'/g)) routes.push([m[1].toUpperCase(), (prefix + (m[2] === '/' ? '' : m[2])).replace(/:\w+/g, '00000000-0000-0000-0000-000000000000')]);
}
const PUBLIC = new Set(['POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/auth/2fa/validate', 'GET /api/settings']);
const open = [];
for (const [m, p] of routes) {
  if (PUBLIC.has(`${m} ${p}`)) continue;
  const r = await anon.request.fetch(APP + p, { method: m, headers: H, data: m === 'GET' ? undefined : '{}' });
  if (![401, 403].includes(r.status())) open.push(`${m} ${p} -> ${r.status()}`);
}
check(`todas as ${routes.length} rotas exigem login (exceto as públicas)`, open.length === 0, open.join(', '));
const noCsrf = await alice.request.post(`${APP}/api/folders`, { headers: { 'Content-Type': 'application/json' }, data: '{"name":"x"}' });
check('requisição sem o cabeçalho anti-CSRF é recusada', noCsrf.status() === 403, String(noCsrf.status()));

// ── Restrição de acesso ──
const adminOnly = [['GET', '/users'], ['GET', '/audit'], ['GET', '/audit/verify'], ['GET', '/data'], ['PUT', '/data/retention'], ['POST', '/data/audit/purge'],
  ['GET', '/ldap/config'], ['GET', '/settings/security'], ['PUT', '/settings/security'], ['GET', '/settings/email'], ['PUT', '/settings'], ['GET', '/tokens/all'],
  ['GET', '/folders/admin-all'], ['POST', '/roles'], ['DELETE', '/roles/AUXILIAR'], ['DELETE', `/users/${aliceId}`], ['POST', `/users/${aliceId}/reset-password`]];
const leaked = [];
for (const [m, p] of adminOnly) { const r = await call(bob, m, p, m === 'GET' ? undefined : {}); if (r.status !== 403) leaked.push(`${m} ${p}: ${r.status}`); }
check('rotas de administrador recusam usuário comum', leaked.length === 0, leaked.join(', '));

const alicePersonal = (await call(alice, 'POST', '/folders', { name: 'Privada', visibility: 'personal' })).body;
const cred = (await call(alice, 'POST', '/credentials', { title: 'Segredo Alice', folderId: alicePersonal.id, encryptedPass: 'x', wrappedKey: 'y' })).body;
const att = (await call(alice, 'POST', `/attachments/${cred.id}`, { fileName: 'doc.pdf', mimeType: 'application/pdf', data: 'abc' })).body;
const idor = [['GET', `/credentials/${cred.id}`], ['PUT', `/credentials/${cred.id}`], ['DELETE', `/credentials/${cred.id}`], ['GET', `/credentials/${cred.id}/history`], ['GET', `/credentials/${cred.id}/shares`],
  ['POST', `/credentials/${cred.id}/shares`], ['GET', `/attachments/${cred.id}`], ['GET', `/attachments/${cred.id}/${att.id}/download`], ['DELETE', `/attachments/${cred.id}/${att.id}`],
  ['PUT', `/folders/${alicePersonal.id}`], ['DELETE', `/folders/${alicePersonal.id}`], ['PUT', `/users/${aliceId}`], ['POST', `/keys/folders/${alicePersonal.id}/rotate`]];
const holes = [];
for (const [m, p] of idor) { const r = await call(bob, m, p, m === 'GET' || m === 'DELETE' ? undefined : { title: 'hack', name: 'hack', firstName: 'hack' }); if (r.status < 400) holes.push(`${m} ${p}: ${r.status}`); }
check('um usuário não acessa dados de outro (IDOR)', holes.length === 0, holes.join(', '));
check('nem o administrador abre a pasta pessoal de outra pessoa', (await call(admin, 'GET', `/credentials/${cred.id}`)).status === 403);
const list = (await call(bob, 'GET', '/credentials')).body;
check('listagem não traz senhas de outros', !list.some(c => c.id === cred.id));

// ── Mass assignment ──
await call(bob, 'PUT', `/users/${bobId}`, { role: 'ADMINISTRADOR', status: 'ACTIVE', passwordHash: 'x', totpEnabled: true, tokenVersion: 99, require2FA: false, email: 'hack@x.com', id: 'novo' });
let row = await owner.user.findUnique({ where: { id: bobId } });
check('usuário não se promove a administrador', row.role === 'AUXILIAR' && row.email === 'bob@teste.local' && row.passwordHash !== 'x' && row.tokenVersion !== 99 && !row.totpEnabled);
const f2 = (await call(bob, 'POST', '/folders', { name: 'Minha', visibility: 'personal', ownerId: aliceId, isPersonal: false, visibleToAll: true, teamId: 'x', keyInitialized: true })).body;
const fRow = await owner.folder.findUnique({ where: { id: f2.id } });
check('campos internos da pasta são ignorados', fRow.ownerId === bobId && fRow.isPersonal && !fRow.visibleToAll && !fRow.keyInitialized);
const c2 = (await call(bob, 'POST', '/credentials', { title: 'A', folderId: f2.id, encryptedPass: 'x', wrappedKey: 'y', deletedAt: '2020-01-01', deletedById: aliceId, id: 'fixo', createdAt: '2000-01-01' })).body;
const cRow = await owner.credential.findUnique({ where: { id: c2.id } });
check('campos internos da credencial são ignorados', c2.id !== 'fixo' && !cRow.deletedAt && !cRow.deletedById && cRow.createdAt.getFullYear() > 2020);
await call(bob, 'POST', '/teams', { name: 'G', ownerId: aliceId, memberIds: [aliceId], memberCanDelete: true, require2FA: true });
const t = await owner.team.findFirst({ where: { name: 'G' }, include: { members: true } });
check('usuário comum não define dono nem membros ao criar grupo', t.ownerId === bobId && t.members.length === 1 && !t.memberCanDelete);

// ── Validação de entrada ──
const bad = [
  ['POST', '/credentials', { title: 'x'.repeat(300), folderId: f2.id, encryptedPass: 'x', wrappedKey: 'y' }, 'título gigante'],
  ['POST', '/credentials', { title: 'A', folderId: f2.id, encryptedPass: 'x', wrappedKey: 'y', url: 'javascript:alert(1)' }, 'URL javascript:'],
  ['POST', '/credentials', { title: 'A', folderId: f2.id, encryptedPass: 'x', wrappedKey: 'y', tags: [{ a: 1 }] }, 'tags inválidas'],
  ['POST', '/credentials', { title: { contains: 'a' }, folderId: f2.id, encryptedPass: 'x', wrappedKey: 'y' }, 'objeto no título'],
  ['POST', '/folders', { name: 'A', visibility: 'personal', color: 'red;background:url(x)' }, 'cor inválida'],
  ['PUT', `/folders/${f2.id}`, { parentId: alicePersonal.id }, 'mover para pasta de outra pessoa'],
  ['PUT', `/folders/${f2.id}`, { parentId: f2.id }, 'pasta dentro de si mesma'],
];
const accepted = [];
for (const [m, p, b, label] of bad) { const r = await call(bob, m, p, b); if (r.status !== 400) accepted.push(`${label}: ${r.status}`); }
check('entradas inválidas são recusadas', accepted.length === 0, accepted.join(', '));
const sqli = await call(bob, 'GET', `/credentials?search=${encodeURIComponent("' OR 1=1; DROP TABLE \"User\"; --")}`);
check('injeção de SQL não tem efeito', sqli.status === 200 && sqli.body.length === 0 && (await owner.user.count()) > 2);
const big = await bob.request.fetch(`${APP}/api/folders`, { method: 'POST', headers: H, data: JSON.stringify({ name: 'A', description: 'x'.repeat(2 * 1024 * 1024) }) });
check('corpo maior que 1 MB é recusado', big.status() === 413, String(big.status()));

// ── Uploads ──
const up = async (b) => (await call(bob, 'POST', `/attachments/${c2.id}`, b)).status;
check('anexo executável é recusado', (await up({ fileName: 'virus.exe', data: 'abc' })) === 400);
check('nome com caminho é recusado', (await up({ fileName: '../../etc/passwd', data: 'abc' })) === 400);
check('tipo inválido é recusado', (await up({ fileName: 'a.pdf', mimeType: 'text/html; x', data: 'abc' })) === 400);
check('anexo acima de 5 MB é recusado', (await up({ fileName: 'a.pdf', data: 'x'.repeat(8 * 1024 * 1024) })) === 413);
check('anexo válido é aceito', (await up({ fileName: 'certificado.pfx', mimeType: 'application/x-pkcs12', data: 'abc' })) === 201);
const logoBad = await admin.request.post(`${APP}/api/settings/logo`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, multipart: { logo: { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<script>alert(1)</script>') } } });
check('imagem falsa é recusada', logoBad.status() === 400, String(logoBad.status()));
const icoBad = await admin.request.post(`${APP}/api/settings/favicon`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, multipart: { favicon: { name: 'x.ico', mimeType: 'image/x-icon', buffer: Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(40, 65)]) } } });
check('ICO adulterado é recusado', icoBad.status() === 400, String(icoBad.status()));

// ── Respostas sem dados internos ──
const FORBIDDEN = ['passwordHash', 'passwordHistory', 'totpSecret', 'totpPendingSecret', 'totpRecoveryCodes', 'totpLastStep', 'tokenVersion', 'failedLoginAttempts', 'lockedUntil', 'ldapConfig', 'smtpConfig', 'ldapDn', 'ldapGuid', 'apiToken'];
const scan = (v, path, out) => {
  if (Array.isArray(v)) v.forEach(x => scan(x, path, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (FORBIDDEN.includes(k)) out.push(`${path}.${k}`); scan(x, path, out); }
};
const found = [];
for (const ctx of [admin, alice]) for (const p of ['/auth/me', '/users', '/users/search?q=te', '/teams', '/folders', '/credentials', '/tokens', '/tokens/all', '/roles', '/favorites', '/access-requests', '/trash', '/settings', '/auth/me/data-export']) {
  const r = await call(ctx, 'GET', p); if (r.status === 200) scan(r.body, p, found);
}
const loginBody = await (await anon.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'alice@teste.local', password: USER_PASS }) })).json();
scan(loginBody, 'login', found);
check('nenhuma resposta traz campos internos', found.length === 0, found.join(', '));
await call(alice, 'POST', `/credentials/${cred.id}/shares`, { sharedWithId: bobId, wrappedKey: 'k' });
await owner.user.update({ where: { id: bobId }, data: { publicKey: 'pk' } });
await call(alice, 'POST', `/credentials/${cred.id}/shares`, { sharedWithId: bobId, wrappedKey: 'chave-do-bob' });
const sh = await call(alice, 'GET', `/credentials/${cred.id}/shares`);
check('lista de compartilhamentos não expõe chaves', sh.status === 200 && sh.body.length === 1 && !('wrappedKey' in sh.body[0]), JSON.stringify(sh.body));
const err404 = await call(bob, 'GET', '/credentials/nao-existe');
check('erro não revela detalhes técnicos', !/prisma|stack|node_modules|at .*\.js/i.test(JSON.stringify(err404.body)));

// ── Cookies e cabeçalhos ──
const lg = await (await browser.newContext()).request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'alice@teste.local', password: USER_PASS }) });
const cookie = lg.headers()['set-cookie'] || '';
check('cookie HttpOnly, SameSite=Strict e restrito à API', /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie) && /Path=\/api/i.test(cookie), cookie.replace(/=[^;]+/, '=***'));
const httpsLg = await (await browser.newContext()).request.post(`${APP}/api/auth/login`, { headers: { ...H, 'X-Forwarded-Proto': 'https' }, data: '{}' });
const h = (await anon.request.get(`${APP}/login`)).headers();
for (const [name, re] of [['content-security-policy', /default-src 'self'/], ['strict-transport-security', /max-age=31536000/], ['x-content-type-options', /nosniff/], ['x-frame-options', /./], ['referrer-policy', /no-referrer/], ['permissions-policy', /camera/], ['cross-origin-opener-policy', /same-origin/], ['x-robots-tag', /noindex/]]) check(`cabeçalho ${name}`, re.test(h[name] || ''), h[name]);
check('CSP não permite origens externas', !/https?:/.test(h['content-security-policy']), h['content-security-policy']);
const dist = fs.readdirSync(`${ROOT}frontend/dist/assets`);
check('produção sem source maps', !dist.some(f => f.endsWith('.map')));
const bundle = dist.filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}frontend/dist/assets/${f}`, 'utf8')).join('');
check('código do navegador sem segredos', !/DATA_ENCRYPTION_KEY|JWT_SECRET|DATABASE_URL|postgresql:\/\/|sk_live|AKIA[0-9A-Z]{16}/.test(bundle));
check('sem fontes ou scripts de terceiros', !/fonts\.googleapis|fonts\.gstatic/.test(bundle + dist.filter(f => f.endsWith('.css')).map(f => fs.readFileSync(`${ROOT}frontend/dist/assets/${f}`, 'utf8')).join('')));
for (const p of ['/.env', '/.git/config', '/backend/.env', '/package.json']) {
  const r = await anon.request.get(APP + p); const t = await r.text();
  if (/JWT_SECRET|repositoryformat|"dependencies"/.test(t)) check(`arquivo interno exposto: ${p}`, false);
}
check('arquivos internos não são servidos', true);

// ── Senhas ──
const hashes = await owner.user.findMany({ where: { passwordHash: { not: null } }, select: { passwordHash: true } });
check('senhas só em bcrypt com custo 12 ou maior', hashes.every(u => /^\$2[aby]\$(1[2-9]|[23]\d)\$/.test(u.passwordHash)));
await owner.$executeRaw`UPDATE "User" SET "passwordHash" = ${require('bcryptjs').hashSync(USER_PASS, 8)} WHERE id = ${aliceId}`;
await session('alice@teste.local', USER_PASS);
check('hash fraco é refeito no login', /^\$2[aby]\$12\$/.test((await owner.user.findUnique({ where: { id: aliceId } })).passwordHash));
check('senha acima de 72 bytes é recusada', (await call(admin, 'POST', '/users', { email: 'l@teste.local', username: 'longa', password: 'Aa1!'.repeat(20), firstName: 'L', lastName: 'L', role: 'AUXILIAR' })).status === 400);

// ── RLS e privilégio mínimo no banco ──
const [who] = await appDb.$queryRaw`SELECT current_user::text AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS by`;
check('aplicação usa papel sem superusuário e sem ignorar RLS', who.u === 'vaultguard_app' && !who.su && !who.by, JSON.stringify(who));
const off = await owner.$queryRaw`SELECT relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname <> '_prisma_migrations' AND NOT (relrowsecurity AND relforcerowsecurity)`;
check('RLS ligado e forçado em todas as tabelas', off.length === 0, JSON.stringify(off));
const denied = async (fn) => { try { await fn(); return false; } catch { return true; } };
check('aplicação não altera a auditoria', await denied(() => appDb.$executeRaw`UPDATE "AuditLog" SET action = 'x'`));
check('aplicação não apaga a auditoria fora da retenção', (await appDb.$executeRaw`DELETE FROM "AuditLog"`) === 0 && (await owner.auditLog.count()) > 0);
check('aplicação não apaga tabelas', await denied(() => appDb.$executeRawUnsafe('DROP TABLE "Favorite"')));
check('aplicação não cria tabelas', await denied(() => appDb.$executeRawUnsafe('CREATE TABLE invasor (id int)')));
check('aplicação não lê o controle de migrações', await denied(() => appDb.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"')));
check('aplicação não cria segunda configuração', await denied(() => appDb.$executeRaw`INSERT INTO "SystemSettings" (id, "updatedAt") VALUES ('outra', now())`));
const before = await owner.auditLog.count();
const purge = await call(admin, 'POST', '/data/audit/purge', { olderThanDays: 3650 });
check('rotina de retenção continua funcionando com RLS', purge.status === 200 && (await owner.auditLog.count()) >= before, JSON.stringify(purge.body));

// ── Robôs ──
const trap = await anon.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'alice@teste.local', password: USER_PASS, website: 'http://spam' }) });
check('campo-armadilha bloqueia robô mesmo com a senha certa', trap.status() === 401);
const page = await (await browser.newContext()).newPage();
await page.goto(`${APP}/login`);
for (let i = 0; i < 6; i++) await anon.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: `ninguem${i}@x.com`, password: 'errada-123456' }) });
const pow = await anon.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'alice@teste.local', password: USER_PASS }) });
const powBody = await pow.json();
check('muitos erros exigem desafio anti-robô', pow.status() === 428 && powBody.code === 'BOT_CHECK', String(pow.status()));
const fake = await anon.request.post(`${APP}/api/auth/login`, { headers: H, data: JSON.stringify({ login: 'alice@teste.local', password: USER_PASS, botChallenge: powBody.challenge, botSolution: '1' }) });
check('resposta errada ao desafio é recusada', fake.status() === 428);
await page.fill('input[placeholder="usuario@empresa.com"]', 'alice@teste.local');
await page.fill('input[placeholder="••••••••"]', USER_PASS);
await page.click('button[type="submit"]');
await page.waitForURL(`${APP}/`, { timeout: 30000 });
check('pessoa real passa pelo desafio sem perceber', true);

// ── LGPD ──
await call(admin, 'PUT', '/settings/general', { privacyConfig: { controllerName: 'Empresa Teste Ltda', cnpj: '00.000.000/0001-00', dpoName: 'Dora DPO', dpoEmail: 'dpo@teste.local' } });
const pp = await (await browser.newContext()).newPage();
await pp.goto(`${APP}/login`);
await pp.click('[data-testid="privacy-link"]');
await pp.waitForSelector('h1:has-text("Política de Privacidade")');
const text = await pp.locator('main').innerText();
check('política pública mostra controlador e encarregado', /Empresa Teste Ltda/.test(text) && /Dora DPO/.test(text) && /dpo@teste\.local/.test(text));
check('política cobre bases legais, direitos e retenção', /art\. 18/i.test(text) && /Base legal/i.test(text) && /90 dias/.test(text) && /ANPD/.test(text));
const my = await call(alice, 'GET', '/auth/me/data-export');
check('titular baixa os próprios dados', my.status === 200 && my.body.perfil.email === 'alice@teste.local' && Array.isArray(my.body.atividade));
check('exportação não traz dados de outras pessoas', !JSON.stringify(my.body).includes('bob@teste.local'));

console.log(`\n${pass} ok, ${fail} falhas`);
await browser.close();
await owner.$disconnect(); await appDb.$disconnect();
process.exit(fail ? 1 : 0);
