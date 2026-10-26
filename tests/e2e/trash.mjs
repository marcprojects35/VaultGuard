// Lixeira e retenção: excluir, restaurar (conteúdo continua legível), excluir de vez, prazos e limpeza de auditoria
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
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
const issues = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });

function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) issues.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) issues.push(`[${label}] HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
}
const api = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
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
async function createCred(page, folderName, title, password) {
  await page.goto(`${APP}/`);
  await unlock(page, ADMIN_PASS);
  await page.click('button:has-text("Novo")');
  await page.waitForSelector('h2:has-text("Nova Credencial")');
  await page.fill('input[placeholder="Ex: Gmail Corporativo"]', title);
  await page.locator('.fixed select').first().selectOption({ label: folderName });
  await page.locator('.fixed input[type="password"]').first().fill(password);
  await page.click('button:has-text("Salvar")');
  await page.waitForSelector('text=Credencial criada!', { timeout: 15000 });
}
async function revealPassword(page, folderName, title) {
  await page.goto(`${APP}/`);
  await unlock(page, ADMIN_PASS);
  await page.click(`text=${folderName}`);
  await page.click(`text=${title}`);
  await page.waitForTimeout(600);
  await page.locator('span.font-mono:has-text("★ ★ ★ ★ ★")').first().locator('xpath=following-sibling::button[1]').click();
  await page.waitForTimeout(1200);
  return (await page.locator('span.font-mono').first().textContent())?.trim();
}

const admin = await login('admin', 'admin@vaultguard.local', ADMIN_PASS);
await api(admin, 'POST', '/folders', { name: 'Financeiro', visibility: 'corporate' });
await api(admin, 'POST', '/folders', { name: 'Contas', visibility: 'corporate' });
await createCred(admin, 'Financeiro', 'Banco Itaú', 'Senha#Itau1');
await createCred(admin, 'Financeiro', 'Banco Caixa', 'Senha#Caixa2');
await createCred(admin, 'Contas', 'Energia', 'Senha#Luz3');
const itau = await prisma.credential.findFirst({ where: { title: 'Banco Itaú' } });

// ── Excluir senha: vai para a lixeira ──
await admin.click('text=Financeiro');
await admin.click('text=Banco Itaú');
await admin.click('button:has-text("Excluir")');
check('confirmação fala em lixeira', await admin.isVisible('text=Mover senha para a lixeira?'));
await admin.click('.fixed button:has-text("Excluir")');
await admin.waitForSelector('text=Senha movida para a lixeira', { timeout: 10000 });
const trashed = await prisma.credential.findUnique({ where: { id: itau.id } });
check('senha marcada como excluída (não apagada)', !!trashed?.deletedAt && !!trashed.deletedById);
let r = await api(admin, 'GET', '/credentials');
check('senha some do cofre', !r.body.some(c => c.id === itau.id));
r = await api(admin, 'GET', `/credentials/${itau.id}`);
check('senha excluída não abre pelo id', r.status === 404);

// Lixeira mostra quem excluiu, quando, quem criou
await admin.goto(`${APP}/trash`);
await unlock(admin, ADMIN_PASS);
await admin.waitForSelector('[data-testid="trash-row-Banco Itaú"]');
const rowText = await admin.locator('[data-testid="trash-row-Banco Itaú"]').innerText();
await admin.screenshot({ path: path.join(OUT, 'trash-items.png') });
check('lixeira mostra quem excluiu, local e data', /Administrador/.test(rowText) && /Financeiro/.test(rowText) && /\d{2}\/\d{2}\/\d{4}/.test(rowText), rowText);

// Troca de chave da pasta com a senha na lixeira (ex.: alguém perdeu acesso)
await prisma.folder.updateMany({ where: { name: 'Financeiro' }, data: { needsKeyRotation: true } });
await admin.goto(`${APP}/`);
await unlock(admin, ADMIN_PASS);
await admin.waitForTimeout(3000);
check('chave da pasta trocada com item na lixeira', (await prisma.folder.findFirst({ where: { name: 'Financeiro' } })).needsKeyRotation === false);

// Restaurar pela tela
await admin.goto(`${APP}/trash`);
await unlock(admin, ADMIN_PASS);
await admin.locator('[data-testid="trash-row-Banco Itaú"] [data-testid="restore-one"]').click();
await admin.waitForSelector('text=1 item(ns) restaurado(s)', { timeout: 10000 });
check('senha restaurada', !(await prisma.credential.findUnique({ where: { id: itau.id } })).deletedAt);
check('senha restaurada continua legível (mesmo após troca de chave)', (await revealPassword(admin, 'Financeiro', 'Banco Itaú')) === 'Senha#Itau1');

// ── Excluir pasta leva as senhas junto; restaurar traz tudo ──
const fin = await prisma.folder.findFirst({ where: { name: 'Financeiro' } });
r = await api(admin, 'DELETE', `/folders/${fin.id}`);
check('pasta para a lixeira', r.status === 200);
const inFolder = await prisma.credential.findMany({ where: { folderId: fin.id } });
check('senhas da pasta vão junto', inFolder.length === 2 && inFolder.every(c => c.deletedAt && c.deletedWithFolder === fin.id));
r = await api(admin, 'GET', '/trash');
check('lixeira mostra a pasta como um item, com a contagem', r.body.items.some(i => i.type === 'folder' && i.name === 'Financeiro' && i.contains === 2) && !r.body.items.some(i => i.name === 'Banco Caixa'));
r = await api(admin, 'POST', '/trash/restore', { items: [{ type: 'folder', id: fin.id }] });
check('restaurar pasta', r.body.restored === 1);
check('senhas voltam com a pasta', (await prisma.credential.findMany({ where: { folderId: fin.id, deletedAt: null } })).length === 2);
check('senha da pasta restaurada legível', (await revealPassword(admin, 'Financeiro', 'Banco Caixa')) === 'Senha#Caixa2');

// Senha excluída junto com a pasta não pode voltar sozinha
await api(admin, 'DELETE', `/folders/${fin.id}`);
const caixa = await prisma.credential.findFirst({ where: { title: 'Banco Caixa' } });
r = await api(admin, 'POST', '/trash/restore', { items: [{ type: 'credential', id: caixa.id }] });
check('senha da pasta excluída pede para restaurar a pasta', r.body.restored === 0 && /pasta/.test(r.body.failed?.[0]?.error || ''), JSON.stringify(r.body));
await api(admin, 'POST', '/trash/restore', { items: [{ type: 'folder', id: fin.id }] });

// ── Usuário comum: lixeira só da pasta pessoal ──
await api(admin, 'POST', '/users', { email: 'ana@teste.local', username: 'ana', password: USER_PASS, firstName: 'Ana', lastName: 'Teste', role: 'ANALISTA' });
await prisma.user.update({ where: { email: 'ana@teste.local' }, data: { mustChangePassword: false } });
const ana = await login('ana', 'ana@teste.local', USER_PASS);
const energia = await prisma.credential.findFirst({ where: { title: 'Energia' } });
await api(admin, 'DELETE', `/credentials/${energia.id}`);
r = await api(ana, 'GET', '/trash');
check('usuário comum não vê itens compartilhados na lixeira', r.status === 200 && !r.body.items.some(i => i.id === energia.id));
r = await api(ana, 'POST', '/trash/restore', { items: [{ type: 'credential', id: energia.id }] });
check('usuário comum não restaura item compartilhado', r.body.restored === 0);
r = await api(ana, 'POST', '/trash/purge', { items: [{ type: 'credential', id: energia.id }] });
check('usuário comum não exclui de vez item compartilhado', r.body.purged === 0);

// ── Marcar todos e excluir de vez pela tela ──
await createCred(admin, 'Contas', 'Água', 'Senha#Agua4');
const agua = await prisma.credential.findFirst({ where: { title: 'Água' } });
await prisma.credentialHistory.create({ data: { credentialId: agua.id, encryptedPass: 'x', changedBy: (await prisma.user.findFirst({ where: { email: 'admin@vaultguard.local' } })).id } }).catch(() => {});
await api(admin, 'POST', '/favorites', { credentialId: agua.id }).catch(() => {});
await api(admin, 'DELETE', `/credentials/${agua.id}`);
await admin.goto(`${APP}/trash`);
await unlock(admin, ADMIN_PASS);
await admin.waitForSelector('[data-testid="trash-row-Água"]');
await admin.click('[data-testid="select-all"]');
check('marcar todos seleciona tudo', await admin.isVisible('text=2 selecionado(s)'));
await admin.click('[data-testid="purge-selected"]');
check('confirmação de exclusão definitiva', await admin.isVisible('text=Não dá para desfazer'));
await admin.click('[data-testid="confirm-action"]');
await admin.waitForSelector('text=2 item(ns) excluído(s) definitivamente', { timeout: 10000 });
check('excluídas de vez do banco', !(await prisma.credential.findUnique({ where: { id: agua.id } })) && !(await prisma.credential.findUnique({ where: { id: energia.id } })));
check('sem restos (histórico/favoritos)', (await prisma.credentialHistory.count({ where: { credentialId: agua.id } })) === 0 && (await prisma.favorite.count({ where: { credentialId: agua.id } })) === 0);
check('lixeira vazia', await admin.isVisible('text=A lixeira está vazia'));
await admin.screenshot({ path: path.join(OUT, 'trash.png') });

// Esvaziar lixeira
await createCred(admin, 'Contas', 'Internet', 'Senha#Net5');
const net = await prisma.credential.findFirst({ where: { title: 'Internet' } });
await api(admin, 'DELETE', `/credentials/${net.id}`);
await admin.goto(`${APP}/trash`);
await unlock(admin, ADMIN_PASS);
await admin.waitForSelector('[data-testid="trash-row-Internet"]');
await admin.click('[data-testid="empty-trash"]');
await admin.click('[data-testid="confirm-action"]');
await admin.waitForSelector('text=excluído(s) definitivamente', { timeout: 10000 });
check('esvaziar lixeira apaga tudo', !(await prisma.credential.findUnique({ where: { id: net.id } })));

// ── Dados e retenção ──
await admin.goto(`${APP}/admin/settings/data`);
await unlock(admin, ADMIN_PASS);
await admin.waitForSelector('text=Prazos de retenção');
await admin.fill('[data-testid="trash-days"]', '7');
await admin.fill('[data-testid="audit-days"]', '90');
await admin.click('[data-testid="save-retention"]');
await admin.waitForSelector('text=Prazos salvos', { timeout: 10000 });
const st = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
check('prazos salvos', st.trashRetentionDays === 7 && st.auditRetentionDays === 90);
r = await api(admin, 'PUT', '/data/retention', { auditRetentionDays: 3 });
check('auditoria com menos de 7 dias é recusada', r.status === 400);
r = await api(admin, 'GET', '/data');
check('mostra volume da auditoria e tamanho do banco', r.body.audit.count > 0 && r.body.database.bytes > 0 && r.body.database.tables.length > 0);
await admin.screenshot({ path: path.join(OUT, 'data-retention.png'), fullPage: true });

// Lixeira vencida é apagada pela rotina
await createCred(admin, 'Contas', 'Antiga', 'Senha#Old6');
const old = await prisma.credential.findFirst({ where: { title: 'Antiga' } });
await api(admin, 'DELETE', `/credentials/${old.id}`);
await prisma.credential.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 8 * 86400000) } });
const { purgeExpiredTrash, purgeExpiredAudit } = await import(`${ROOT}backend/src/services/trash.js`);
await purgeExpiredTrash();
check('item além do prazo da lixeira é apagado automaticamente', !(await prisma.credential.findUnique({ where: { id: old.id } })));
await prisma.auditLog.create({ data: { action: 'user.login', createdAt: new Date(Date.now() - 100 * 86400000) } });
const before = await prisma.auditLog.count({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
await purgeExpiredAudit();
check('auditoria além do prazo é apagada automaticamente', before > 0 && (await prisma.auditLog.count({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } })) === 0);

// Limpeza manual com registro de quem fez
await admin.goto(`${APP}/admin/settings/data`);
await unlock(admin, ADMIN_PASS);
await admin.click('[data-testid="purge-all-audit"]');
await admin.click('[data-testid="confirm-purge"]');
await admin.waitForSelector('text=registro(s) de auditoria apagado(s)', { timeout: 10000 });
const left = await prisma.auditLog.findMany();
check('apagar todos deixa só o registro de quem apagou', left.length >= 1 && left.every(l => l.action === 'audit.purge' || new Date(l.createdAt) > new Date(Date.now() - 5000)) && left.some(l => l.action === 'audit.purge' && l.userId), JSON.stringify(left.map(l => l.action)));

check('sem erros no console / 500', issues.length === 0, '\n    ' + issues.join('\n    '));
console.log(`\n${pass} ok, ${fail} falhas`);
await browser.close();
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
