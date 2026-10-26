// Grupos e permissões: admin adiciona direto, permissões do grupo/membro e teto do cargo
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APP = process.env.APP_URL || 'http://127.0.0.1:3901';
const CHROME = process.env.CHROME_PATH || undefined;
const OUT = process.env.OUT_DIR || '.out';
const ADMIN_PASS = 'Adm1n!Test#2026';
const USER_PASS = 'Us3r!Test#2026';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const issues = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) issues.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) issues.push(`[${label}] HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
}
const api = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(`/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, url, body]);
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
  await page.waitForURL(`${APP}/`, { timeout: 15000 });
  await unlock(page, password);
  return page;
}

// ── Preparação ──
const admin = await login('admin', 'admin@vaultguard.local', ADMIN_PASS);
const mkUser = async (first, email, role) => {
  const r = await api(admin, 'POST', '/users', { email, username: email.split('@')[0], password: USER_PASS, firstName: first, lastName: 'Teste', role });
  await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
  return r.body?.id || (await prisma.user.findUnique({ where: { email } })).id;
};
const auxId = await mkUser('Aux', 'aux@teste.local', 'AUXILIAR');
const anaId = await mkUser('Ana', 'ana@teste.local', 'ANALISTA');
const outId = await mkUser('Otto', 'otto@teste.local', 'ANALISTA');
check('usuários de teste criados', auxId && anaId && outId);

// ── Admin cria grupo pela tela, com membros direto ──
await admin.goto(`${APP}/admin/settings/groups`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="new-group"]');
await admin.fill('[data-testid="group-name"]', 'Financeiro');
for (const name of ['Aux', 'Ana']) {
  await admin.fill('.fixed [data-testid="user-picker"]', name);
  await admin.click(`.fixed button:has-text("${name} Teste")`);
}
await admin.click('[data-testid="group-create"]');
await admin.waitForSelector('text=Grupo criado', { timeout: 10000 });
const team = await prisma.team.findFirst({ where: { name: 'Financeiro' }, include: { members: true } });
check('grupo criado pela tela', !!team);
const st = (uid) => team.members.find(m => m.userId === uid)?.status;
check('membros adicionados pelo admin entram direto (sem convite)', st(auxId) === 'ACTIVE' && st(anaId) === 'ACTIVE', JSON.stringify(team.members));
check('padrão do grupo: editar sim, excluir não', team.memberCanEdit && !team.memberCanDelete && !team.memberCanShare);

// Pasta do grupo com credenciais (conteúdo cifrado não importa aqui: só permissões)
const folder = (await api(admin, 'POST', '/folders', { name: 'Fin Pasta', visibility: 'team', teamId: team.id })).body;
check('pasta do grupo criada', !!folder?.id, JSON.stringify(folder));
const mkCred = async (title) => (await api(admin, 'POST', '/credentials', { title, folderId: folder.id, encryptedPass: 'x', wrappedKey: 'x' })).body.id;
const c1 = await mkCred('Banco 1'), c2 = await mkCred('Banco 2'), c3 = await mkCred('Banco 3');

// ── Permissões padrão do grupo ──
const ana = await login('ana', 'ana@teste.local', USER_PASS);
let r = await api(ana, 'DELETE', `/credentials/${c1}`);
check('membro não exclui (padrão do grupo)', r.status === 403, JSON.stringify(r));
r = await api(ana, 'PUT', `/credentials/${c1}`, { title: 'Banco 1 editado' });
check('membro edita (padrão do grupo)', r.status !== 403, JSON.stringify(r));
r = await api(ana, 'GET', `/credentials?folderId=${folder.id}`);
const perm1 = r.body?.find?.(c => c.id === c1)?.myPermissions;
check('lista informa as permissões', perm1?.canEdit === true && perm1?.canDelete === false, JSON.stringify(perm1));

// Admin liga "excluir" no padrão do grupo pela tela
await admin.reload();
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="group-Financeiro"] >> text=Financeiro');
await admin.click('[data-testid="group-Financeiro"] [data-testid="default-canDelete"]');
await admin.waitForSelector('text=Grupo atualizado', { timeout: 10000 });
r = await api(ana, 'DELETE', `/credentials/${c2}`);
check('após o admin liberar, membro exclui', r.status === 200, JSON.stringify(r));

// ── Ajuste individual: Ana deixa de editar ──
await admin.click('[data-testid="member-ana@teste.local"] [data-testid="member-canEdit"]');
await admin.waitForTimeout(800);
r = await api(ana, 'PUT', `/credentials/${c1}`, { title: 'outra' });
check('ajuste individual tira a edição só da Ana', r.status === 403, JSON.stringify(r));
const anaMember = await prisma.teamMember.findFirst({ where: { teamId: team.id, userId: anaId } });
check('ajuste gravado só no membro', anaMember.canEdit === false && anaMember.canDelete === null);
await admin.click('[data-testid="member-ana@teste.local"] [data-testid="member-canEdit"]');
await admin.waitForTimeout(800);
await admin.screenshot({ path: path.join(OUT, 'groups-admin.png') });
check('clicar de novo volta ao padrão', (await prisma.teamMember.findFirst({ where: { teamId: team.id, userId: anaId } })).canEdit === null);

// ── Teto do cargo: Auxiliar edita mas não exclui, mesmo com o grupo liberando ──
await admin.goto(`${APP}/admin/roles`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="cap-AUXILIAR-canDelete"]');
await admin.waitForSelector('text=Permissão atualizada', { timeout: 10000 });
check('cargo salvo', (await prisma.role.findUnique({ where: { key: 'AUXILIAR' } })).canDelete === false);
const aux = await login('aux', 'aux@teste.local', USER_PASS);
r = await api(aux, 'DELETE', `/credentials/${c3}`);
check('Auxiliar não exclui (cargo)', r.status === 403, JSON.stringify(r));
check('mensagem de bloqueio em português', /permissão/.test(r.body?.error || ''), r.body?.error);
r = await api(aux, 'PUT', `/credentials/${c3}`, { title: 'Banco 3 editado' });
check('Auxiliar edita', r.status !== 403, JSON.stringify(r));

// Interface do Auxiliar: Editar aparece, Excluir não
await aux.goto(`${APP}/`);
await unlock(aux, USER_PASS);
await aux.click('text=Fin Pasta');
await aux.click('text=Banco 3 editado');
await aux.waitForTimeout(800);
const actions = await aux.locator('button:has-text("Editar"), button:has-text("Excluir")').allTextContents();
check('Auxiliar vê Editar e não vê Excluir', actions.some(t => t.includes('Editar')) && !actions.some(t => t.includes('Excluir')), JSON.stringify(actions));
await aux.screenshot({ path: path.join(OUT, 'groups-aux.png') });

// Grupo do admin mostra o bloqueio do cargo no membro
await admin.goto(`${APP}/admin/settings/groups`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="group-Financeiro"] >> text=Financeiro');
await admin.waitForTimeout(800);
const auxChips = await admin.locator('[data-testid="member-aux@teste.local"] [data-testid="member-canDelete"]').textContent();
check('tela de grupos avisa que o cargo bloqueia', /\(cargo\)/.test(auxChips || ''), auxChips);

// Corporativa só leitura não aparece na lista de pastas ao criar senha
const corpRO = (await api(admin, 'POST', '/folders', { name: 'Só Leitura', visibility: 'corporate' })).body;
await aux.goto(`${APP}/`);
await unlock(aux, USER_PASS);
await aux.click('text=Só Leitura');
await aux.waitForTimeout(600);
check('sem "Nova senha nesta pasta" onde só vê', !(await aux.isVisible('text=Nova senha nesta pasta')));
await aux.click('button:has-text("Novo")').catch(() => {});
await aux.waitForTimeout(600);
const options = await aux.locator('.fixed select').first().locator('option').allTextContents().catch(() => []);
check('formulário só lista pastas onde pode criar', options.some(o => o.includes('Fin Pasta')) && !options.some(o => o.includes('Só Leitura')), JSON.stringify(options));
await aux.keyboard.press('Escape');
await aux.goto(`${APP}/`);

// Validação com mensagem clara
r = await api(admin, 'POST', '/teams', { name: '' });
check('validação explica o campo', r.status === 400 && /nome/.test(r.body?.error || ''), JSON.stringify(r.body?.error));

// ── Recursos por cargo ──
r = await api(aux, 'GET', '/credentials/vault-export');
check('exportar desligado por padrão para não admin', r.status === 403);
check('menu sem Exportar', !(await aux.isVisible('nav >> text=Exportar').catch(() => false)) && !(await aux.isVisible('a[href="/export"]')));
await admin.goto(`${APP}/admin/roles`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="cap-AUXILIAR-canExport"]');
await admin.waitForSelector('text=Permissão atualizada', { timeout: 10000 });
r = await api(aux, 'GET', '/credentials/vault-export');
check('admin libera exportar para o cargo', r.status === 200 && r.body.credentials.every(c => c.folderId === folder.id || c.folder), JSON.stringify(r.status));
await aux.goto(`${APP}/`);
await unlock(aux, USER_PASS);
check('menu mostra Exportar após liberar', await aux.isVisible('a[href="/export"]'));
r = await api(aux, 'GET', '/auth/me');
check('/auth/me traz as permissões do cargo', r.body?.capabilities?.canExport === true && r.body.capabilities.canDelete === false);

await admin.click('[data-testid="cap-AUXILIAR-canCreateTeams"]');
await admin.waitForSelector('text=Permissão atualizada', { timeout: 10000 });
r = await api(aux, 'POST', '/teams', { name: 'Grupo do Aux' });
check('sem "criar grupos" o cargo não cria', r.status === 403);
await admin.click('[data-testid="cap-AUXILIAR-canUseApiTokens"]');
await admin.waitForSelector('text=Permissão atualizada', { timeout: 10000 });
r = await api(aux, 'POST', '/tokens', { name: 'x', scopes: ['read'] });
check('sem "tokens de API" o cargo não cria token', r.status === 403);

// ── Convite x adição direta ──
r = await api(ana, 'POST', '/teams', { name: 'Grupo da Ana' });
check('Analista cria o próprio grupo', r.status === 201);
const anaTeam = r.body;
r = await api(ana, 'POST', `/teams/${anaTeam.id}/invite`, { userId: outId });
check('dono comum convida (fica pendente)', r.status === 201 && r.body.status === 'PENDING');
r = await api(admin, 'POST', `/teams/${anaTeam.id}/invite`, { userId: outId });
check('admin adiciona direto mesmo com convite pendente', r.status === 201 && r.body.status === 'ACTIVE');
r = await api(ana, 'PUT', `/teams/${anaTeam.id}/members/${outId}`, { canDelete: true });
check('só o admin ajusta permissões de membro', r.status === 403);
r = await api(ana, 'PUT', `/teams/${anaTeam.id}`, { memberCanDelete: true });
check('dono comum não muda permissões padrão', r.status === 200 && r.body.memberCanDelete === false);

// Troca de dono pelo admin
r = await api(admin, 'PUT', `/teams/${team.id}`, { ownerId: auxId });
check('admin troca o dono do grupo', r.status === 200 && r.body.ownerId === auxId);
r = await api(aux, 'DELETE', `/credentials/${c3}`);
check('dono do grupo ainda limitado pelo cargo', r.status === 403);

// ── Pasta corporativa: todos veem; admin libera editar por cargo ──
const corp = (await api(admin, 'POST', '/folders', { name: 'Corporativa', visibility: 'corporate' })).body;
const cc = (await api(admin, 'POST', '/credentials', { title: 'Wi-Fi', folderId: corp.id, encryptedPass: 'x', wrappedKey: 'x' })).body.id;
r = await api(ana, 'PUT', `/credentials/${cc}`, { title: 'Wi-Fi 2' });
check('pasta corporativa: sem permissão extra só vê', r.status === 403);
await api(admin, 'PUT', `/folders/${corp.id}/permissions`, { permissions: [{ role: 'ANALISTA', canView: true, canEdit: true }] });
r = await api(ana, 'PUT', `/credentials/${cc}`, { title: 'Wi-Fi 2' });
check('pasta corporativa: admin libera editar para o cargo', r.status !== 403, JSON.stringify(r));
r = await api(ana, 'DELETE', `/credentials/${cc}`);
check('pasta corporativa: excluir continua bloqueado', r.status === 403);
r = await api(aux, 'PUT', `/credentials/${cc}`, { title: 'x' });
check('pasta corporativa: outro cargo segue só vendo', r.status === 403);

// Auditoria descritiva
await admin.goto(`${APP}/admin/audit`);
await unlock(admin, ADMIN_PASS);
await admin.waitForTimeout(1000);
const auditText = await admin.locator('table tbody').innerText();
const raw = auditText.match(/\b(user|credential|team|role|keys|folder|settings|vault)\.[a-z_]+\b/g);
check('auditoria em português', /Alterou|Criou|Entrou/.test(auditText) && !raw, JSON.stringify(raw));
await admin.screenshot({ path: path.join(OUT, 'groups-audit.png') });
await admin.fill('input[placeholder^="Buscar por pessoa"]', 'Ana Teste');
await admin.waitForTimeout(1200);
const byPerson = await admin.locator('table tbody tr').allInnerTexts();
check('busca da auditoria por nome da pessoa', byPerson.length > 0 && byPerson.every(t => /Ana Teste/.test(t)), JSON.stringify(byPerson.slice(0, 3)));
await admin.fill('input[placeholder^="Buscar por pessoa"]', 'criou grupo');
await admin.waitForTimeout(1200);
const byLabel = await admin.locator('table tbody tr').allInnerTexts();
check('busca da auditoria pelo texto em português', byLabel.length > 0 && byLabel.every(t => /Criou grupo/.test(t)), JSON.stringify(byLabel.slice(0, 3)));

// Excluir usuário dono de grupo: grupo passa para o admin (antes dava erro 500)
const otto = await prisma.user.findUnique({ where: { email: 'otto@teste.local' } });
const ottoTeam = await prisma.team.create({ data: { name: 'Grupo do Otto', ownerId: otto.id, members: { create: { userId: otto.id, status: 'ACTIVE', invitedById: otto.id } } } });
r = await api(admin, 'DELETE', `/users/${otto.id}`);
check('excluir usuário dono de grupo funciona', r.status === 200 && r.body.transferredGroups?.includes('Grupo do Otto'), JSON.stringify(r));
const adminUser = await prisma.user.findUnique({ where: { email: 'admin@vaultguard.local' } });
check('grupo passa para o admin', (await prisma.team.findUnique({ where: { id: ottoTeam.id } })).ownerId === adminUser.id);
check('pasta pessoal do usuário excluído não fica órfã', (await prisma.folder.count({ where: { isPersonal: true, ownerId: null } })) === 0);

// Excluir grupo com pasta na lixeira pede para decidir antes
const gFolder = (await api(admin, 'POST', '/folders', { name: 'Pasta do Otto', visibility: 'team', teamId: ottoTeam.id })).body;
await api(admin, 'DELETE', `/folders/${gFolder.id}`);
r = await api(admin, 'DELETE', `/teams/${ottoTeam.id}`);
check('grupo com pasta na lixeira não é excluído sem aviso', r.status === 409 && /Lixeira/.test(r.body?.error || ''), JSON.stringify(r));

// Volta o cargo ao padrão para não afetar outros testes
await prisma.role.update({ where: { key: 'AUXILIAR' }, data: { canDelete: true, canExport: false, canCreateTeams: true, canUseApiTokens: true } });

check('sem erros no console / 500', issues.length === 0, '\n    ' + issues.join('\n    '));
console.log(`\n${pass} ok, ${fail} falhas`);
await browser.close();
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
