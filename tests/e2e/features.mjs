// 2FA por pessoa/grupo e configuração, política de senhas por grupo e pasta (com senha vencida),
// inversão de cores, cargo dentro do grupo, pasta pessoal no 1º login e importação de grupos do AD
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import path from 'path';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APP = 'http://127.0.0.1:3901';
const OUT = process.env.OUT_DIR || '.out';
const ADMIN_PASS = 'Adm1n!Test#2026';
const USER_PASS = 'Us3r!Test#2026';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sh = (cmd, input) => execSync(cmd, { input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }).toString();
const issues = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });

function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) issues.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) issues.push(`[${label}] HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
}
// Pelo contexto do navegador (mesmo cookie), sem depender da página: a tela pode
// navegar sozinha (ex.: 2FA obrigatório leva ao perfil) no meio da chamada
const api = async (page, method, url, body) => {
  const r = await page.request.fetch(`${APP}/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    data: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status(), body: json };
};
async function unlock(page, password) {
  await page.waitForTimeout(800);
  if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
    await page.fill('input[placeholder="Senha"]', password);
    await page.click('button:has-text("Desbloquear")');
    await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 15000 });
  }
}
async function login(label, email, password) {
  const page = await (await browser.newContext()).newPage();
  watch(page, label);
  await page.goto(`${APP}/login`);
  await page.fill('input[placeholder="usuario@empresa.com"]', email);
  await page.fill('input[placeholder="••••••••"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 });
  await unlock(page, password);
  return page;
}
const cssVar = (page, n) => page.evaluate(x => getComputedStyle(document.documentElement).getPropertyValue(x).trim(), n);

const admin = await login('admin', 'admin@vaultguard.local', ADMIN_PASS);
const mkUser = async (first, email, role) => {
  await api(admin, 'POST', '/users', { email, username: email.split('@')[0], password: USER_PASS, firstName: first, lastName: 'Teste', role });
  await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
  return (await prisma.user.findUnique({ where: { email } })).id;
};
const anaId = await mkUser('Ana', 'ana@teste.local', 'ANALISTA');
const bobId = await mkUser('Bob', 'bob@teste.local', 'AUXILIAR');
const carlaId = await mkUser('Carla', 'carla@teste.local', 'ASSISTENTE');

// ── Pasta pessoal no primeiro login ──
const carla = await login('carla', 'carla@teste.local', USER_PASS);
check('pessoa tem exatamente uma pasta pessoal após o primeiro login', (await prisma.folder.count({ where: { ownerId: carlaId, isPersonal: true } })) === 1);
await prisma.folder.deleteMany({ where: { ownerId: carlaId, isPersonal: true } });
await api(carla, 'GET', '/auth/me');
check('pasta pessoal que falta é recriada ao entrar', (await prisma.folder.count({ where: { ownerId: carlaId, isPersonal: true } })) === 1);

// ── Grupos e pastas ──
const rh = (await api(admin, 'POST', '/teams', { name: 'RH', memberIds: [anaId] })).body;
const dev = (await api(admin, 'POST', '/teams', { name: 'Desenvolvimento', memberIds: [bobId] })).body;
const infra = (await api(admin, 'POST', '/teams', { name: 'Infra', memberIds: [anaId, bobId] })).body;
const mkFolder = async (name, teamId) => (await api(admin, 'POST', '/folders', { name, visibility: 'team', teamId })).body;
const rhDocs = await mkFolder('RH Docs', rh.id);
const rhOutros = await mkFolder('RH Outros', rh.id);
const devFolder = await mkFolder('Dev Senhas', dev.id);
const infraDocs = await mkFolder('Infra Docs', infra.id);
const infraSec = await mkFolder('Infra Secreta', infra.id);
check('grupos e pastas criados', rh.id && dev.id && infra.id && rhDocs.id && devFolder.id && infraSec.id);

// ── Política de senhas por grupo e pasta ──
await admin.goto(`${APP}/admin/settings/groups`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="group-RH"] >> text=RH');
const pol = admin.locator('[data-testid="group-RH"] [data-testid="policy-editor"]');
await pol.locator('[data-testid="policy-enabled"]').check();
await pol.locator('[data-testid="policy-min"]').fill('10');
await pol.locator('[data-testid="policy-expire"]').fill('20');
await pol.locator('[data-testid="policy-folder-RH Docs"]').click();
await pol.locator('[data-testid="policy-save"]').click();
await admin.waitForSelector('text=Grupo atualizado', { timeout: 10000 });
let team = await prisma.team.findUnique({ where: { id: rh.id } });
check('política do RH salva só para a pasta escolhida', team.passwordPolicy?.minLength === 10 && team.passwordPolicy.expireDays === 20 && team.passwordPolicy.folderIds?.length === 1 && team.passwordPolicy.folderIds[0] === rhDocs.id, JSON.stringify(team.passwordPolicy));
let r = await api(admin, 'PUT', `/teams/${dev.id}`, { passwordPolicy: { enabled: true, minLength: 24, requireSymbols: true, expireDays: 0, folderIds: [] } });
check('política do Desenvolvimento (24) salva', r.status === 200 && r.body.passwordPolicy.minLength === 24);
r = await api(admin, 'PUT', `/teams/${dev.id}`, { passwordPolicy: { enabled: true, minLength: 2 } });
check('política inválida é recusada', r.status === 400);
r = await api(admin, 'PUT', `/teams/${rh.id}`, { passwordPolicy: { enabled: true, minLength: 10, folderIds: [devFolder.id] } });
check('política não aceita pasta de outro grupo', r.status === 400);

// Cofre: senha curta bloqueada, gerador respeita a regra, vencimento automático
await admin.goto(`${APP}/`);
await unlock(admin, ADMIN_PASS);
await admin.click('button:has-text("Novo")');
await admin.waitForSelector('h2:has-text("Nova Credencial")');
await admin.fill('input[placeholder="Ex: Gmail Corporativo"]', 'Folha de pagamento');
await admin.locator('.fixed select').first().selectOption({ label: 'RH Docs' });
await admin.locator('.fixed input[type="password"]').first().fill('curta');
await admin.waitForTimeout(300);
check('regra do grupo aparece no formulário', /mínimo 10 caracteres/.test(await admin.locator('[data-testid="policy-hint"]').innerText()));
check('senha fora da regra não salva', await admin.locator('.fixed button:has-text("Salvar")').isDisabled());
await admin.locator('.fixed select').first().selectOption({ label: 'RH Outros' });
await admin.waitForTimeout(300);
check('pasta do grupo fora da política não tem regra', !(await admin.isVisible('[data-testid="policy-hint"]')));
await admin.locator('.fixed select').first().selectOption({ label: 'Dev Senhas' });
await admin.locator('.fixed button:has(svg.lucide-wand-sparkles), .fixed button:has(svg.lucide-wand2), .fixed button:has(svg.lucide-wand-2)').first().click().catch(() => {});
await admin.waitForTimeout(300);
let pw = await admin.locator('.fixed input.font-mono').first().inputValue();
check('gerador cria no tamanho do grupo (Dev: 24)', pw.length >= 24 && /[^A-Za-z0-9]/.test(pw), `${pw.length}`);
await admin.locator('.fixed select').first().selectOption({ label: 'RH Docs' });
await admin.click('.fixed button:has-text("Salvar")');
await admin.waitForSelector('text=Credencial criada!', { timeout: 15000 });
let cred = await prisma.credential.findFirst({ where: { title: 'Folha de pagamento' } });
const days = (new Date(cred.expiresAt) - Date.now()) / 86400000;
check('senha na pasta com política vence em 20 dias', days > 19.9 && days <= 20.01, String(days));

// Senha vencida: card para gerar nova
await prisma.credential.update({ where: { id: cred.id }, data: { expiresAt: new Date(Date.now() - 86400000) } });
await admin.reload();
await unlock(admin, ADMIN_PASS);
await admin.waitForSelector('[data-testid="expired-card"]', { timeout: 10000 });
check('card de senha vencida aparece', /Folha de pagamento/.test(await admin.locator('[data-testid="expired-card"]').innerText()));
await admin.screenshot({ path: path.join(OUT, 'features-expired.png') });
await admin.click('[data-testid="renew-password"]');
await admin.waitForTimeout(800);
pw = await admin.locator('.fixed input.font-mono').first().inputValue();
check('"Gerar nova" abre já com senha nova dentro da regra', pw.length >= 20, String(pw.length));
await admin.click('.fixed button:has-text("Salvar")');
await admin.waitForSelector('text=Credencial atualizada', { timeout: 15000 }).catch(() => {});
await admin.waitForTimeout(800);
cred = await prisma.credential.findUnique({ where: { id: cred.id } });
check('nova senha volta a vencer em 20 dias', new Date(cred.expiresAt) > new Date(Date.now() + 19 * 86400000));
check('senha antiga fica no histórico', (await prisma.credentialHistory.count({ where: { credentialId: cred.id } })) === 1);
await admin.reload();
await unlock(admin, ADMIN_PASS);
check('card some depois de trocar', !(await admin.isVisible('[data-testid="expired-card"]')));

// Troca de senha com vencimento ainda no futuro: prazo volta a contar; e não dá para remover o vencimento
const pc = (await api(admin, 'POST', '/credentials', { title: 'VPN RH', folderId: rhDocs.id, encryptedPass: 'a', wrappedKey: 'x' })).body.id;
const in5 = new Date(Date.now() + 5 * 86400000);
await prisma.credential.update({ where: { id: pc }, data: { expiresAt: in5 } });
r = await api(admin, 'PUT', `/credentials/${pc}`, { encryptedPass: 'b', expiresAt: in5.toISOString().slice(0, 10) });
let pcRow = await prisma.credential.findUnique({ where: { id: pc } });
check('senha trocada reinicia o prazo mesmo com a data antiga no futuro', new Date(pcRow.expiresAt) > new Date(Date.now() + 19 * 86400000), String(pcRow.expiresAt));
r = await api(admin, 'PUT', `/credentials/${pc}`, { title: 'VPN RH', expiresAt: null });
pcRow = await prisma.credential.findUnique({ where: { id: pc } });
check('editar sem trocar a senha não remove o vencimento da política', !!pcRow.expiresAt);
r = await api(admin, 'PUT', `/credentials/${pc}`, { title: 'VPN RH', expiresAt: '2099-01-01' });
pcRow = await prisma.credential.findUnique({ where: { id: pc } });
check('nem adia além do prazo', new Date(pcRow.expiresAt) < new Date(Date.now() + 21 * 86400000));

// ── Cargo dentro do grupo (Cargos e permissões › Onde vale) ──
const mkCred = async (title, folderId) => (await api(admin, 'POST', '/credentials', { title, folderId, encryptedPass: 'x', wrappedKey: 'x' })).body.id;
const cDocs = await mkCred('Servidor docs', infraDocs.id);
const cSec = await mkCred('Root secreto', infraSec.id);
await admin.goto(`${APP}/admin/roles`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="scopes-ANALISTA"]');
await admin.waitForSelector('[data-testid="role-scopes-modal"]');
await admin.locator('[data-testid="scope-add-team"]').selectOption({ label: 'Infra' });
const sc = admin.locator('[data-testid="scope-Infra"]');
await sc.locator('[data-testid="scope-folder-Infra Docs"]').click();
await sc.locator('[data-testid="scope-canDelete"]').click();
await admin.screenshot({ path: path.join(OUT, 'features-scopes.png') });
await admin.click('[data-testid="scope-save"]');
await admin.waitForSelector('text=Onde o cargo vale foi salvo', { timeout: 10000 });
const scopeRow = await prisma.roleGroupScope.findFirst({ where: { roleKey: 'ANALISTA', teamId: infra.id } });
check('regra "Analista do grupo Infra" salva', scopeRow && scopeRow.folderIds.length === 1 && scopeRow.canDelete === true);
const ana = await login('ana', 'ana@teste.local', USER_PASS);
r = await api(ana, 'GET', '/folders');
const anaFolders = r.body.shared.flatMap(f => [f, ...(f.children || [])]).map(f => f.name);
check('Analista no Infra vê só a pasta liberada', anaFolders.includes('Infra Docs') && !anaFolders.includes('Infra Secreta'), JSON.stringify(anaFolders));
r = await api(ana, 'GET', `/credentials/${cSec}`);
check('pasta fora da regra do cargo fica inacessível', r.status === 403 || r.status === 404, String(r.status));
r = await api(ana, 'DELETE', `/credentials/${cDocs}`);
check('cargo no grupo libera excluir onde vale', r.status === 200, JSON.stringify(r));
const bob = await login('bob', 'bob@teste.local', USER_PASS);
r = await api(bob, 'GET', '/folders');
const bobFolders = r.body.shared.flatMap(f => [f, ...(f.children || [])]).map(f => f.name);
check('outro cargo no mesmo grupo segue o padrão do grupo', bobFolders.includes('Infra Secreta') && bobFolders.includes('Infra Docs'));
r = await api(bob, 'DELETE', `/credentials/${cSec}`);
check('padrão do grupo continua sem excluir', r.status === 403);
const { getFolderAudiences } = await import(`${ROOT}backend/src/services/keys.js`);
const aud = await getFolderAudiences([infraSec.id, infraDocs.id]);
check('chave da pasta escondida não vai para o cargo restrito', !aud.get(infraSec.id).has(anaId) && aud.get(infraDocs.id).has(anaId) && aud.get(infraSec.id).has(bobId));

// ── Inversão de cores pela própria pessoa ──
await ana.goto(`${APP}/`);
await unlock(ana, USER_PASS);
const before = { bg: (await cssVar(ana, '--color-bg')).toLowerCase(), primary: (await cssVar(ana, '--color-primary')).toLowerCase() };
const low = async (n) => (await cssVar(ana, n)).toLowerCase();
await ana.click('[data-testid="toggle-theme"]');
await ana.waitForTimeout(400);
check('inverter: fundo vira a cor principal', (await low('--color-bg')) === before.primary, `${before.primary} -> ${await low('--color-bg')}`);
check('inverter: cor principal vira o fundo', (await low('--color-primary')) === before.bg, `${before.bg} -> ${await low('--color-primary')}`);
check('texto continua legível (preto sobre dourado)', (await cssVar(ana, '--color-text')).toLowerCase() === '#111111' && (await ana.getAttribute('html', 'data-theme')) === 'light');
await ana.screenshot({ path: path.join(OUT, 'features-inverted.png') });
await sleep(500);
check('preferência salva na conta', (await prisma.user.findUnique({ where: { id: anaId } })).themeInverted === true);
await ana.evaluate(() => localStorage.removeItem('vg-theme-inverted'));
await ana.reload();
await unlock(ana, USER_PASS);
await ana.waitForTimeout(1500);
check('vale em outro navegador (vem da conta)', (await low('--color-bg')) === before.primary);
await ana.click('[data-testid="toggle-theme"]');
await ana.waitForTimeout(400);
check('voltar às cores normais', (await low('--color-bg')) === before.bg);

// Claro/Escuro na Aparência troca mesmo com fundo personalizado
await api(admin, 'PUT', '/settings', { bgColor: '#0b1220', surfaceColor: '#111a2e', themeMode: 'dark' });
await admin.goto(`${APP}/admin/settings/appearance`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="theme-light"]');
await admin.waitForTimeout(400);
check('Claro funciona mesmo com fundo personalizado', (await admin.getAttribute('html', 'data-theme')) === 'light' && (await cssVar(admin, '--color-bg')).toUpperCase() === '#F5F4EF');
await admin.click('[data-testid="theme-dark"]');
await admin.waitForTimeout(400);
check('Escuro volta', (await admin.getAttribute('html', 'data-theme')) === 'dark');
await api(admin, 'PUT', '/settings', { bgColor: '', surfaceColor: '', themeMode: 'dark' });

// ── 2FA: configuração, por pessoa e por grupo ──
await admin.goto(`${APP}/admin/settings/security`);
await unlock(admin, ADMIN_PASS);
await admin.fill('[data-testid="2fa-issuer"]', 'Cofre Empresa');
await admin.fill('[data-testid="2fa-instructions-input"]', 'Use o Microsoft Authenticator do celular corporativo.');
check('digitar não perde o foco do campo', await admin.evaluate(() => document.activeElement?.getAttribute('data-testid') === '2fa-instructions-input'));
await admin.fill('[data-testid="2fa-grace"]', '0');
await admin.click('button:has-text("Salvar")');
await admin.waitForSelector('text=Configurações de segurança salvas', { timeout: 10000 });
const st = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
check('configuração do 2FA salva', st.twoFactorConfig?.issuer === 'Cofre Empresa' && /Microsoft/.test(st.twoFactorConfig.instructions));
r = await api(admin, 'PUT', '/settings/security', { twoFactorConfig: { issuer: 'Com:dois', graceDays: 0 } });
check('nome com ":" é recusado', r.status === 400);

// Só uma pessoa (Carla)
r = await api(carla, 'GET', '/credentials');
check('antes de exigir, Carla usa normalmente', r.status === 200);
await admin.goto(`${APP}/admin/users`);
await unlock(admin, ADMIN_PASS);
await admin.locator('tr:has-text("carla@teste.local") button').first().click();
await admin.check('[data-testid="user-require-2fa"]');
await admin.click('.fixed button:has-text("Salvar")');
await admin.waitForTimeout(1000);
check('2FA exigido só da Carla', (await prisma.user.findUnique({ where: { id: carlaId } })).require2FA === true);
r = await api(carla, 'GET', '/credentials');
check('Carla sem 2FA fica bloqueada', r.status === 403 && r.body?.code === '2FA_REQUIRED', JSON.stringify(r));
r = await api(ana, 'GET', '/credentials');
check('outras pessoas não são afetadas', r.status === 200);
r = await api(carla, 'GET', '/auth/me');
check('perfil mostra o nome e as instruções do admin', r.body.twoFactor.issuer === 'Cofre Empresa' && /Microsoft/.test(r.body.twoFactor.instructions) && r.body.twoFactor.sources.includes('sua conta'));
await carla.goto(`${APP}/profile?tab=security`);
await carla.waitForTimeout(1500);
check('tela de ativação mostra as instruções', await carla.isVisible('[data-testid="2fa-instructions"]'));

// Grupo (Desenvolvimento) com prazo de 7 dias
await api(admin, 'PUT', '/settings/security', { twoFactorConfig: { issuer: 'Cofre Empresa', instructions: 'Use o Microsoft Authenticator do celular corporativo.', graceDays: 7 } });
await admin.goto(`${APP}/admin/settings/groups`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="group-Desenvolvimento"] >> text=Desenvolvimento');
await admin.click('[data-testid="group-Desenvolvimento"] [data-testid="group-require-2fa"]');
await admin.waitForSelector('text=Grupo atualizado', { timeout: 10000 });
check('2FA exigido do grupo', (await prisma.team.findUnique({ where: { id: dev.id } })).require2FA === true);
r = await api(bob, 'GET', '/credentials');
check('dentro do prazo o membro continua usando', r.status === 200);
const bobLogin = await (await browser.newContext()).request.post(`${APP}/api/auth/login`, { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, data: JSON.stringify({ login: 'bob@teste.local', password: USER_PASS }) });
const bobBody = await bobLogin.json();
check('dentro do prazo o login não força ativar (só avisa)', bobLogin.status() === 200 && bobBody.requires2FASetup === false && bobBody.twoFactor?.required === true, JSON.stringify({ s: bobLogin.status(), r: bobBody.requires2FASetup }));
await bob.goto(`${APP}/`);
await unlock(bob, USER_PASS);
await bob.waitForSelector('[data-testid="2fa-banner"]', { timeout: 10000 });
check('aviso com a data limite para o membro', /Desenvolvimento/.test(await bob.locator('[data-testid="2fa-banner"]').innerText()));
await prisma.team.update({ where: { id: dev.id }, data: { require2FASince: new Date(Date.now() - 8 * 86400000) } });
await prisma.teamMember.updateMany({ where: { teamId: dev.id, userId: bobId }, data: { respondedAt: new Date(Date.now() - 8 * 86400000) } });
r = await api(bob, 'GET', '/credentials');
check('passado o prazo, o membro é bloqueado até ativar', r.status === 403 && r.body?.code === '2FA_REQUIRED');
r = await api(ana, 'GET', '/credentials');
check('quem não é do grupo não é afetado', r.status === 200);
r = await api(admin, 'PUT', `/teams/${rh.id}`, { require2FA: true });
check('admin dentro do prazo pode exigir do grupo em que está', r.status === 200);
await api(admin, 'PUT', `/teams/${rh.id}`, { require2FA: false });
r = await api(admin, 'PUT', '/settings/security', { twoFactorConfig: { issuer: 'Cofre Empresa', graceDays: 0 } });
check('tirar o prazo sendo obrigado sem 2FA é recusado (não se tranca)', r.status === 400 && /bloqueado/.test(r.body?.error || ''), JSON.stringify(r));
await prisma.team.update({ where: { id: dev.id }, data: { require2FA: false } });
r = await api(admin, 'PUT', '/settings/security', { twoFactorConfig: { issuer: 'Cofre Empresa', graceDays: 0 } });
r = await api(admin, 'PUT', `/teams/${rh.id}`, { require2FA: true });
check('sem prazo, admin sem 2FA não exige de grupo em que está', r.status === 400 && /2FA/.test(r.body?.error || ''), JSON.stringify(r));
await api(admin, 'PUT', '/settings/security', { twoFactorConfig: { issuer: 'Cofre Empresa', graceDays: 7 } });

// ── Auditoria descrita como janela móvel ──
await admin.goto(`${APP}/admin/settings/data`);
await unlock(admin, ADMIN_PASS);
check('auditoria descrita como sobrescrita (padrão 90 dias)', await admin.isVisible('text=sobrescritos pelos novos'));
check('instalação nova guarda 90 dias', (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })).auditRetentionDays === 90);

// ── Grupos do AD com as pessoas de dentro ──
const BASE = 'dc=empresa,dc=local', LPASS = 'LdapAdm#2026';
try { sh('docker rm -f vg-ldap-g'); } catch { /* */ }
for (let i = 0; i < 30 && sh(`docker ps -a --format '{{.Names}}'`).split('\n').includes('vg-ldap-g'); i++) await sleep(500);
sh(`docker run -d --rm --name vg-ldap-g -p 127.0.0.1:13895:389 -e LDAP_ORGANISATION=Empresa -e LDAP_DOMAIN=empresa.local -e LDAP_ADMIN_PASSWORD=${LPASS} osixia/openldap:1.5.0`);
const person = (uid, first) => `dn: uid=${uid},${BASE}\nobjectClass: inetOrgPerson\nuid: ${uid}\ncn: ${first} Silva\ngivenName: ${first}\nsn: Silva\nmail: ${uid}@empresa.local\nuserPassword: Senha#${uid}1\n\n`;
const ldif = person('rel1', 'Rita') + person('rel2', 'Rui') + person('rel3', 'Rosa')
  + `dn: cn=relacionamento,${BASE}\nobjectClass: groupOfNames\ncn: relacionamento\ndescription: Time de relacionamento\nmember: uid=rel1,${BASE}\nmember: uid=rel2,${BASE}\nmember: uid=rel3,${BASE}\n\n`;
// O OpenLDAP reinicia durante a inicialização: espera ficar estável e confere que tudo entrou
const count = () => { try { return (sh(`docker exec vg-ldap-g ldapsearch -x -H ldap://localhost -b ${BASE} -D cn=admin,${BASE} -w ${LPASS} "(|(uid=rel*)(cn=relacionamento))" dn`).match(/^dn:/gm) || []).length; } catch { return -1; } };
for (let i = 0; i < 60 && count() < 4; i++) {
  if (count() >= 0) { try { sh(`docker exec -i vg-ldap-g ldapadd -c -x -H ldap://localhost -D cn=admin,${BASE} -w ${LPASS}`, ldif); } catch { /* entradas que já existem */ } }
  await sleep(1000);
}
check('LDAP de teste com 3 pessoas e o grupo', count() === 4, String(count()));
r = await api(admin, 'PUT', '/ldap/config', { enabled: true, config: {
  servers: [{ id: 'dc1', name: 'DC', host: '127.0.0.1', port: 13895, baseDn: BASE, bindDn: `cn=admin,${BASE}`, bindPassword: LPASS }],
  activeServerId: 'dc1', userFilter: '(uid={login})', groupFilter: '(objectClass=groupOfNames)', defaultRole: 'AUXILIAR',
} });
check('AD configurado', r.status === 200, JSON.stringify(r));
await admin.goto(`${APP}/admin/settings/groups`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="import-ad-groups"]');
await admin.waitForSelector('[data-testid="ad-group-relacionamento"]', { timeout: 20000 });
check('grupo do AD aparece com a contagem de membros', /3 membro/.test(await admin.locator('[data-testid="ad-group-relacionamento"]').innerText()));
await admin.locator('[data-testid="ad-group-relacionamento"] input').check();
await admin.click('[data-testid="ad-import"]');
await admin.waitForSelector('[data-testid="ad-import-results"]', { timeout: 20000 });
await admin.screenshot({ path: path.join(OUT, 'features-ad-import.png') });
let adTeam = await prisma.team.findFirst({ where: { adGroupDn: `cn=relacionamento,${BASE}` }, include: { members: { include: { user: true } } } });
const names = adTeam?.members.map(m => m.user.firstName).sort();
check('grupo criado com o nome do AD e as 3 pessoas', adTeam && adTeam.adGroupDn === `cn=relacionamento,${BASE}` && ['Rita', 'Rosa', 'Rui'].every(n => names.includes(n)), JSON.stringify(names));
check('pessoas do AD entram direto e como usuários do AD', adTeam.members.filter(m => m.user.authSource === 'ldap').every(m => m.status === 'ACTIVE') && adTeam.members.filter(m => m.user.authSource === 'ldap').length === 3);
await admin.click('[data-testid="ad-import-results"] button:has-text("Fechar")');
await admin.click('[data-testid="group-relacionamento"] >> text=relacionamento');
await admin.waitForTimeout(800);
check('membros visíveis dentro do grupo', await admin.isVisible('[data-testid="member-rel1@empresa.local"]') && await admin.isVisible('[data-testid="member-rel3@empresa.local"]'));
// Alguém sai do grupo no AD e o admin coloca uma pessoa à mão
sh(`docker exec -i vg-ldap-g ldapmodify -x -H ldap://localhost -D cn=admin,${BASE} -w ${LPASS}`, `dn: cn=relacionamento,${BASE}\nchangetype: modify\ndelete: member\nmember: uid=rel3,${BASE}\n`);
await api(admin, 'POST', `/teams/${adTeam.id}/invite`, { userIds: [carlaId] });
await api(admin, 'PUT', `/teams/${adTeam.id}`, { name: 'Relacionamento com clientes' });
r = await api(admin, 'POST', '/ldap/groups/resync');
adTeam = await prisma.team.findFirst({ where: { adGroupDn: `cn=relacionamento,${BASE}` }, include: { members: { include: { user: true } } } });
const after = adTeam.members.map(m => m.user.firstName);
check('sincronizar: quem saiu no AD sai daqui', !after.includes('Rosa') && after.includes('Rita'), JSON.stringify(after));
check('sincronizar: quem o admin colocou à mão continua', after.includes('Carla'));
check('sincronizar mantém o nome dado pelo admin', adTeam.name === 'Relacionamento com clientes', adTeam.name);
const rita = await prisma.user.findUnique({ where: { email: 'rel1@empresa.local' } });
const visitor = await (await browser.newContext()).newPage();
await visitor.goto(`${APP}/login`);
r = await visitor.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ login: 'rel1', password: 'Senha#rel11' }) })).status);
check('pessoa importada entra com a senha do AD', r === 200);
check('e ganha a pasta pessoal no primeiro login', (await prisma.folder.count({ where: { ownerId: rita.id, isPersonal: true } })) === 1);
try { sh('docker rm -f vg-ldap-g'); } catch { /* */ }

check('sem erros no console / 500', issues.length === 0, '\n    ' + issues.join('\n    '));
console.log(`\n${pass} ok, ${fail} falhas`);
await browser.close();
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
