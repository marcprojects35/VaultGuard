// Cofre web: certificado pela interface + varredura de todas as telas
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APP = 'http://127.0.0.1:3901';
// Chromium do Playwright (npx playwright install chromium) ou outro via CHROME_PATH
const CHROME = process.env.CHROME_PATH || undefined;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};
const issues = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function session(label, login, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let route = '(login)';
  page.on('console', m => { if (m.type() === 'error') issues.push(`[${label} ${route}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${label} ${route}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) issues.push(`[${label} ${route}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(APP, '')}`); });
  await page.goto(`${APP}/login`);
  await page.fill('input[placeholder="usuario@empresa.com"]', login);
  await page.fill('input[placeholder="••••••••"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 15000 });
  await page.waitForTimeout(2500);
  return { page, setRoute: (r) => { route = r; } };
}
async function unlockIfNeeded(page, password) {
  if (await page.isVisible('text=Cofre bloqueado').catch(() => false)) {
    await page.fill('input[placeholder="Senha"]', password);
    await page.click('button:has-text("Desbloquear")');
    await page.waitForSelector('text=Cofre bloqueado', { state: 'detached', timeout: 15000 });
  }
}

const admin = await session('admin', 'admin@vaultguard.local', 'Adm1n!Test#2026');
const { page } = admin;
await page.evaluate(async () => {
  await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ name: 'Fiscal', visibility: 'corporate' }) });
});
await page.reload();
await unlockIfNeeded(page, 'Adm1n!Test#2026');
await page.waitForTimeout(2000);

// ── Certificado digital pela interface ──
admin.setRoute('/ (novo certificado)');
await page.click('button:has-text("Novo")');
await page.waitForSelector('h2:has-text("Nova Credencial")');
await page.click('button:has-text("Certificado Digital")');
check('modelo de certificado muda o rótulo da senha', await page.isVisible('text=Senha do certificado'));
await page.fill('input[placeholder="Ex: Gmail Corporativo"]', 'e-CNPJ Empresa');
await page.locator('select').first().selectOption({ label: 'Fiscal' });
await page.locator('input[type="password"]').first().fill('PfxSenha#9');
await page.click('button:has-text("Anexos")');
await page.setInputFiles('input[type="file"]', { name: 'ecnpj.pfx', mimeType: 'application/x-pkcs12', buffer: Buffer.from('PFX-WEB') });
await page.waitForTimeout(500);
await page.click('button:has-text("Salvar")');
await page.waitForSelector('text=Credencial criada!', { timeout: 15000 });
const row = await prisma.credential.findFirst({ where: { title: 'e-CNPJ Empresa' }, include: { attachments: true, customFields: true } });
check('certificado salvo com tipo "certificate"', row?.kind === 'certificate');
check('arquivo do certificado anexado e cifrado', row?.attachments.length === 1 && row.attachments[0].data.includes('"v":2') && !row.attachments[0].data.includes(Buffer.from('PFX-WEB').toString('base64')));
check('campos do modelo (Titular, CPF/CNPJ, Emissor) presentes', ['Titular', 'CPF/CNPJ', 'Emissor'].every(n => row?.customFields.some(f => f.name === n)) || row?.customFields.length === 0, JSON.stringify(row?.customFields.map(f => f.name)));
await page.click('text=e-CNPJ Empresa');
await page.waitForTimeout(800);
const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
await page.locator('text=ecnpj.pfx').locator('xpath=ancestor::div[1]').locator('button').last().click();
const d = await dl;
check('anexo do certificado baixa decifrado no cofre web', d && require('fs').readFileSync(await d.path(), 'utf8') === 'PFX-WEB');

// ── Varredura de telas ──
const ADMIN_ROUTES = ['/', '/profile', '/profile?tab=security', '/profile?tab=tokens', '/profile?tab=timeline', '/tokens', '/search', '/favorites',
  '/security', '/access-requests', '/teams', '/import', '/export', '/admin/access-requests', '/admin/users', '/admin/folders', '/admin/roles',
  '/admin/audit', '/admin/settings/appearance', '/admin/settings/ldap', '/admin/settings/general', '/admin/settings/security', '/admin/settings/email'];
for (const r of ADMIN_ROUTES) {
  admin.setRoute(r);
  await page.goto(`${APP}${r}`);
  await unlockIfNeeded(page, 'Adm1n!Test#2026').catch(() => issues.push(`[admin ${r}] não desbloqueou`));
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  if ((await page.evaluate(() => document.querySelector('#root')?.innerText.trim().length || 0)) < 20) issues.push(`[admin ${r}] tela vazia`);
}
const uniq = [...new Set(issues)];
check('nenhum erro de JavaScript, console ou API nas telas', uniq.length === 0, '\n' + uniq.join('\n'));

await browser.close();
console.log(`\n${pass} ok, ${fail} falhas`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
