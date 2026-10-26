import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { listTrash, restoreItem, purgeItem } from '../services/trash.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Lista enviada pelo cliente: [{ type: 'credential'|'folder', id }]
function parseItems(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items
    .filter(i => (i?.type === 'credential' || i?.type === 'folder') && typeof i.id === 'string')
    .slice(0, 1000);
}

// GET /api/trash — admin vê tudo que não é pessoal (e a própria pasta pessoal);
// os demais, só o que excluíram da própria pasta pessoal
router.get('/', async (req, res, next) => {
  try {
    const type = ['credential', 'folder'].includes(req.query.type) ? req.query.type : undefined;
    res.json(await listTrash(req.user, { type, search: typeof req.query.search === 'string' ? req.query.search : '' }));
  } catch (err) { next(err); }
});

// POST /api/trash/restore — { items }
router.post('/restore', async (req, res, next) => {
  try {
    const items = parseItems(req.body);
    if (!items.length) return res.status(400).json({ error: 'Selecione ao menos um item' });
    const results = [];
    // Pastas antes das senhas: restaurar a pasta libera as senhas que dependem dela
    for (const i of [...items].sort((a, b) => (a.type === 'folder' ? -1 : 1) - (b.type === 'folder' ? -1 : 1))) {
      results.push({ ...i, ...(await restoreItem(req.user, i.type, i.id, req.ip)) });
    }
    res.json({ restored: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) });
  } catch (err) { next(err); }
});

// POST /api/trash/purge — { items } apaga de vez; { all: true } esvazia a lixeira visível
router.post('/purge', async (req, res, next) => {
  try {
    let items = parseItems(req.body);
    if (req.body?.all === true) {
      const { items: all } = await listTrash(req.user);
      items = all.map(i => ({ type: i.type, id: i.id }));
    }
    if (!items.length) return res.status(400).json({ error: 'A lixeira já está vazia' });
    let purged = 0;
    const failed = [];
    for (const i of items) {
      const r = await purgeItem(req.user, i.type, i.id, { ip: req.ip });
      if (r.ok) purged++; else failed.push({ ...i, error: r.error });
    }
    if (req.body?.all === true) await createAuditLog(req.user.id, 'trash.empty', null, 'Vault', { purged }, req.ip);
    res.json({ purged, failed });
  } catch (err) { next(err); }
});

export default router;
