// Active Directory com 2 servidores: troca automática quando um cai, volta ao preferido e troca manual
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
const LDAP_ADMIN_PASS = 'LdapAdm#2026';
const BASE = 'dc=empresa,dc=local';
const PORTS = { 'vg-ldap1': 13891, 'vg-ldap2': 13892 };
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Dois servidores LDAP (OpenLDAP) com o mesmo usuário ──
for (const [name, port] of Object.entries(PORTS)) {
  try { sh(`docker rm -f ${name}`); } catch { /* não existia */ }
  sh(`docker run -d --rm --name ${name} -p 127.0.0.1:${port}:389 -e LDAP_ORGANISATION=Empresa -e LDAP_DOMAIN=empresa.local -e LDAP_ADMIN_PASSWORD=${LDAP_ADMIN_PASS} osixia/openldap:1.5.0`);
}
const ldif = `dn: uid=joao,${BASE}\nobjectClass: inetOrgPerson\nuid: joao\ncn: Joao Silva\ngivenName: Joao\nsn: Silva\nmail: joao@empresa.local\nuserPassword: Joao#Senha1\n`;
for (const name of Object.keys(PORTS)) {
  for (let i = 0; i < 40; i++) {
    try { sh(`docker exec ${name} ldapsearch -x -H ldap://localhost -b ${BASE} -D cn=admin,${BASE} -w ${LDAP_ADMIN_PASS} -s base`); break; } catch { await sleep(1000); }
  }
  execSync(`docker exec -i ${name} ldapadd -x -H ldap://localhost -D cn=admin,${BASE} -w ${LDAP_ADMIN_PASS}`, { input: ldif, stdio: ['pipe', 'ignore', 'pipe'] });
}
// O OpenLDAP reinicia sozinho durante a inicialização: tenta até a entrada existir
async function seed(name) {
  for (let i = 0; i < 40; i++) {
    try {
      execSync(`docker exec -i ${name} ldapadd -x -H ldap://localhost -D cn=admin,${BASE} -w ${LDAP_ADMIN_PASS}`, { input: ldif, stdio: ['pipe', 'ignore', 'pipe'] });
      return;
    } catch (e) {
      if (/Already exists/.test(e.stderr?.toString() || '')) return;
      await sleep(1000);
    }
  }
  throw new Error(`não foi possível preparar ${name}`);
}
const stop = (name) => sh(`docker stop -t 1 ${name}`);
const start = async (name, port) => {
  try { sh(`docker rm -f ${name}`); } catch { /* já removido */ }
  // --rm remove em segundo plano: espera o nome ficar livre
  for (let i = 0; i < 30 && sh(`docker ps -a --format '{{.Names}}'`).split('\n').includes(name); i++) await sleep(500);
  sh(`docker run -d --rm --name ${name} -p 127.0.0.1:${port}:389 -e LDAP_ORGANISATION=Empresa -e LDAP_DOMAIN=empresa.local -e LDAP_ADMIN_PASSWORD=${LDAP_ADMIN_PASS} osixia/openldap:1.5.0`);
  for (let i = 0; i < 40; i++) {
    try { sh(`docker exec ${name} ldapsearch -x -H ldap://localhost -b ${BASE} -D cn=admin,${BASE} -w ${LDAP_ADMIN_PASS} -s base`); break; } catch { await sleep(1000); }
  }
  await seed(name);
};

const issues = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' && !/status of (4\d\d|503)/.test(m.text())) issues.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500 && r.status() !== 503) issues.push(`[${label}] HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
}
const api = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, url, body]);
const ldapLogin = async (page, login = 'joao', password = 'Joao#Senha1') =>
  page.evaluate(async ([login, password]) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ login, password }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [login, password]);
async function unlock(page) {
  await page.waitForTimeout(800);
  if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
    await page.fill('input[placeholder="Senha"]', ADMIN_PASS);
    await page.click('button:has-text("Desbloquear")');
    await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 15000 });
  }
}
const status = async (page) => (await api(page, 'GET', '/ldap/status')).body;
const inUseName = (st) => st?.servers?.find(s => s.inUse)?.name;

const ctx = await browser.newContext();
const admin = await ctx.newPage();
watch(admin, 'admin');
await admin.goto(`${APP}/login`);
await admin.fill('input[placeholder="usuario@empresa.com"]', 'admin@vaultguard.local');
await admin.fill('input[placeholder="••••••••"]', ADMIN_PASS);
await admin.click('button[type="submit"]');
await admin.waitForURL(`${APP}/`);

// ── Cadastro dos 2 servidores pela tela ──
await admin.goto(`${APP}/admin/settings/ldap`);
await admin.waitForTimeout(800);
if (await admin.isVisible('text=Cofre bloqueado').catch(() => false)) {
  await admin.fill('input[placeholder="Senha"]', ADMIN_PASS);
  await admin.click('button:has-text("Desbloquear")');
  await admin.waitForSelector('text=Cofre bloqueado', { state: 'detached' });
}
await admin.locator('h1:has-text("Active Directory")').locator('xpath=ancestor::div[2]').locator('button').first().click(); // liga o LDAP
for (const [i, [name, port]] of [['DC Matriz', 13891], ['DC Filial', 13892]].entries()) {
  await admin.click('[data-testid="add-server"]');
  const card = admin.locator('[data-testid^="server-"]').nth(i);
  await card.locator('[data-testid="server-name"]').fill(name);
  await card.locator('[data-testid="server-host"]').fill('127.0.0.1');
  await card.locator('[data-testid="server-port"]').fill(String(port));
  await card.locator('[data-testid="server-basedn"]').fill(BASE);
  await card.locator('[data-testid="server-binddn"]').fill(`cn=admin,${BASE}`);
  await card.locator('[data-testid="server-password"]').fill(LDAP_ADMIN_PASS);
}
// Busca de usuários do OpenLDAP (o padrão é o do AD)
await admin.click('button:has-text("Avançado")');
await admin.locator('text=Filtro de usuário').locator('xpath=ancestor::div[contains(@class,"grid")][1]').locator('input').fill('(uid={login})');
await admin.click('button:has-text("Conexão")');
await admin.click('[data-testid="save-ldap"]');
await admin.waitForSelector('text=Configuração LDAP salva!', { timeout: 10000 });
let cfg = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })).ldapConfig;
check('dois servidores salvos, o primeiro é o preferido', cfg.servers?.length === 2 && cfg.activeServerId === cfg.servers[0].id && cfg.autoFailover === true, JSON.stringify(cfg?.servers?.map(s => s.name)));
let r = await api(admin, 'GET', '/ldap/config');
check('senha das contas de serviço nunca volta para a tela', r.body.config.servers.every(s => s.bindPassword === '••••••••'));

for (const name of ['DC Matriz', 'DC Filial']) {
  await admin.locator(`[data-testid="server-${name}"] [data-testid="test-server"]`).click();
  await admin.locator(`[data-testid="server-${name}"] [data-testid="test-result"]`).waitFor({ timeout: 15000 });
  check(`testar conexão: ${name}`, /Conectado/.test(await admin.locator(`[data-testid="server-${name}"] [data-testid="test-result"]`).innerText()));
}

// ── Login pelo AD usa o preferido ──
const visitor = await (await browser.newContext()).newPage();
await visitor.goto(`${APP}/login`);
r = await ldapLogin(visitor);
check('login pelo AD funciona', r.status === 200 && r.body?.user?.email === 'joao@empresa.local', JSON.stringify(r));
check('em uso: preferido (DC Matriz)', inUseName(await status(admin)) === 'DC Matriz');
r = await ldapLogin(visitor, 'joao', 'errada');
check('senha errada não derruba o servidor', r.status === 401 && (await status(admin)).servers.find(s => s.name === 'DC Matriz').state === 'ok');

// ── Preferido cai: reserva assume sozinho ──
stop('vg-ldap1');
const t0 = Date.now();
r = await ldapLogin(visitor);
check('com o preferido fora do ar, o login continua funcionando', r.status === 200, JSON.stringify(r));
check('troca automática é rápida', Date.now() - t0 < 8000, `${Date.now() - t0} ms`);
let st = await status(admin);
check('reserva (DC Filial) em uso e preferido marcado fora do ar', inUseName(st) === 'DC Filial' && st.servers.find(s => s.name === 'DC Matriz').state === 'down', JSON.stringify(st.servers.map(s => [s.name, s.state, s.inUse])));
check('troca automática registrada na auditoria', (await prisma.auditLog.count({ where: { action: 'ldap.failover' } })) === 1);
await admin.reload();
await unlock(admin);
await admin.waitForSelector('[data-testid="in-use-banner"]', { timeout: 10000 });
check('tela avisa que o reserva assumiu', /reserva assumiu/.test(await admin.locator('[data-testid="in-use-banner"]').innerText()));
await admin.screenshot({ path: path.join(OUT, 'ldap-failover.png'), fullPage: true });
r = await ldapLogin(visitor);
check('próximos logins vão direto ao reserva', r.status === 200);

// ── Preferido volta: reassume ──
await start('vg-ldap1', 13891);
r = await api(admin, 'POST', '/ldap/status/check');
check('preferido voltou e reassumiu', inUseName(r.body) === 'DC Matriz', JSON.stringify(r.body?.servers?.map(s => [s.name, s.state, s.inUse])));
check('volta ao preferido registrada', (await prisma.auditLog.count({ where: { action: 'ldap.failback' } })) === 1);

// ── Troca manual pelo botão ──
await admin.reload();
await unlock(admin);
await admin.locator('[data-testid="server-DC Filial"] [data-testid="use-server"]').click();
await admin.waitForSelector('text=Agora usando: DC Filial', { timeout: 10000 });
st = await status(admin);
check('botão "Usar este" troca o servidor', inUseName(st) === 'DC Filial' && st.servers.find(s => s.name === 'DC Filial').preferred);
check('troca manual registrada', (await prisma.auditLog.count({ where: { action: 'ldap.server_switched' } })) === 1);
r = await ldapLogin(visitor);
check('login usa o escolhido manualmente', r.status === 200 && inUseName(await status(admin)) === 'DC Filial');

// Escolhido cai: volta para o outro sozinho
stop('vg-ldap2');
r = await ldapLogin(visitor);
check('escolhido cai e o outro assume', r.status === 200 && inUseName(await status(admin)) === 'DC Matriz', JSON.stringify(r));

// ── Troca automática desligada ──
cfg = (await api(admin, 'GET', '/ldap/config')).body.config;
r = await api(admin, 'PUT', '/ldap/config', { enabled: true, config: { ...cfg, autoFailover: false, ldapOnly: true } });
check('salvar sem redigitar a senha mantém a senha', r.status === 200, JSON.stringify(r));
r = await ldapLogin(visitor);
check('sem troca automática, preferido fora do ar = login pelo AD indisponível', r.status === 503 && /indisponível/.test(r.body?.error || ''), JSON.stringify(r));
await start('vg-ldap2', 13892);
r = await ldapLogin(visitor);
check('preferido volta e o login funciona', r.status === 200, JSON.stringify(r));

// Trocar o endereço sem redigitar a senha não reaproveita a senha
cfg = (await api(admin, 'GET', '/ldap/config')).body.config;
r = await api(admin, 'PUT', '/ldap/config', { enabled: true, config: { ...cfg, servers: cfg.servers.map((s, i) => i === 0 ? { ...s, host: 'outro.servidor.local' } : s) } });
check('mudar o endereço exige a senha de novo', r.status === 400 && /senha/.test(r.body?.error || ''));

// ── Config antiga (um servidor só) continua funcionando ──
await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { ldapConfig: { host: '127.0.0.1', port: 13891, baseDn: BASE, bindDn: `cn=admin,${BASE}`, bindPassword: LDAP_ADMIN_PASS, userFilter: '(uid={login})', ldapOnly: true } } });
r = await api(admin, 'GET', '/ldap/config');
check('config antiga vira a lista com um servidor', r.body.config.servers?.length === 1 && r.body.config.servers[0].name === 'Principal');
r = await ldapLogin(visitor);
check('login com a config antiga', r.status === 200, JSON.stringify(r));

check('sem erros no console / 500', issues.length === 0, '\n    ' + issues.join('\n    '));
console.log(`\n${pass} ok, ${fail} falhas`);
for (const name of Object.keys(PORTS)) { try { sh(`docker rm -f ${name}`); } catch { /* */ } }
await browser.close();
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
