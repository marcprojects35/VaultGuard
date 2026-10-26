// Todas as rotas da API com entradas inválidas: nenhuma pode responder 500
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${ROOT}backend/package.json`);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APP = 'http://127.0.0.1:3901';

// Rotas a partir do código: prefixo do server.js + caminho de cada router
const server = fs.readFileSync(`${ROOT}backend/src/server.js`, 'utf8');
const mounts = [...server.matchAll(/app\.use\('(\/api\/[a-z-]+)',\s*(\w+)\)/g)].map(m => [m[1], m[2]]);
const imports = Object.fromEntries([...server.matchAll(/import (\w+) from '\.\/routes\/([\w.]+)'/g)].map(m => [m[1], m[2]]));
const routes = [];
for (const [prefix, name] of mounts) {
  const file = imports[name]; if (!file) continue;
  const src = fs.readFileSync(`${ROOT}backend/src/routes/${file}`, 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|delete)\(\s*'([^']*)'/g)) routes.push([m[1].toUpperCase(), prefix + (m[2] === '/' ? '' : m[2])]);
}
// Não tocar no que encerra a sessão ou destrói as chaves do usuário de teste
const SKIP = [/\/auth\/logout/, /\/keys\/me\/reset/, /\/auth\/2fa\/disable/, /\/auth\/change-password/, /\/settings\/security$/, /\/data\/audit\/purge/, /\/trash\/purge/];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
async function session(email, password) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${APP}/login`);
  await page.fill('input[placeholder="usuario@empresa.com"]', email);
  await page.fill('input[placeholder="••••••••"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 15000 });
  return page;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = async (page, method, url, body) => { await sleep(220); return rawCall(page, method, url, body); };
const rawCall = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body === undefined ? undefined : body });
    return { status: r.status, text: (await r.text()).slice(0, 160) };
  } catch (e) { return { status: -1, text: e.message }; }
}, [method, url, body]);

const admin = await session('admin', 'Adm1n!Test#2026');
await call(admin, 'POST', '/api/users', JSON.stringify({ email: 'fz@teste.local', username: 'fuzz', password: 'Fuzz!Test#2026', firstName: 'F', lastName: 'Z', role: 'AUXILIAR' }));
await prisma.user.update({ where: { email: 'fz@teste.local' }, data: { mustChangePassword: false } });
const user = await session('fz@teste.local', 'Fuzz!Test#2026');
await call(admin, 'POST', '/api/folders', JSON.stringify({ name: 'Fz', visibility: 'corporate' }));
const folder = await prisma.folder.findFirst({ where: { name: 'Fz' } });
const realIds = { id: folder.id, key: 'AUXILIAR', userId: (await prisma.user.findUnique({ where: { email: 'fz@teste.local' } })).id };

const IDS = ['00000000-0000-0000-0000-000000000000', 'x', "'; DROP TABLE x;--", '%00', 'a'.repeat(300)];
const BODIES = [undefined, '{}', 'null', '[]', '"texto"', '{"bad json"', '{"a":1}',
  JSON.stringify({ name: 123, title: [], label: {}, email: 5, password: null, folderId: 'x', userId: {}, userIds: 'x', items: 'x', role: [], color: {}, ownerId: 'x', teamId: 1, permissions: 'x', rows: {}, scopes: 'x', accept: 'x', direction: 'x', primaryColor: 1, loginOverlay: 'x', appOverlay: [], trashRetentionDays: 'x', auditRetentionDays: -1, olderThanDays: 'x', memberCanEdit: 'x', canEdit: 'x' }),
  JSON.stringify({ items: [{ type: 'folder', id: {} }, { type: 'credential', id: 'x' }, null, 5], all: 'sim' }),
  JSON.stringify({ name: 'x'.repeat(5000), title: 'x'.repeat(5000), description: 'y'.repeat(20000) }),
];

const fails = [];
let calls = 0;
const statuses = {};
await Promise.all([['admin', admin], ['auxiliar', user]].map(async ([who, page]) => {
  for (const [method, path] of routes) {
    if (SKIP.some(r => r.test(path))) continue;
    const ids = path.includes(':') ? [...IDS, null] : [null];
    for (const id of ids) {
      const url = path.replace(/:(\w+)/g, (_, p) => encodeURIComponent(id === null ? (realIds[p] || realIds.id) : id));
      for (const body of (method === 'GET' || method === 'DELETE') ? [undefined] : BODIES) {
        const r = await call(page, method, url, body); calls++; statuses[r.status] = (statuses[r.status] || 0) + 1;
        if (r.status >= 500 || r.status === -1) fails.push(`[${who}] ${method} ${url.slice(0, 90)} body=${String(body).slice(0, 50)} -> ${r.status} ${r.text}`);
      }
      // query string estranha nas listagens
      if (method === 'GET') {
        const r = await call(page, 'GET', `${url}?search[]=1&page=-5&limit=99999&type=x&all=true&folderId=x&q=%27`); calls++;
        if (r.status >= 500) fails.push(`[${who}] GET ${url}?... -> ${r.status} ${r.text}`);
      }
    }
  }
}));
console.log(`${routes.length} rotas, ${calls} chamadas`, JSON.stringify(statuses));
if ((statuses[429] || 0) > calls * 0.02) fails.push(`limite de requisições atingido ${statuses[429]}x — teste não confiável`);
const uniq = [...new Set(fails)];
console.log(uniq.length ? `FAIL ${uniq.length} respostas 500:\n  ` + uniq.slice(0, 60).join('\n  ') : 'ok    nenhuma resposta 500');
await browser.close();
await prisma.$disconnect();
process.exit(uniq.length ? 1 : 0);
