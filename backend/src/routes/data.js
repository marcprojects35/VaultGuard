// Configurações › Dados e retenção (somente administrador)
import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { prisma, WITH_DELETED } from '../db.js';
import { createAuditLog } from '../services/audit.js';
import { getRetention, purgeAuditLogs } from '../services/trash.js';

const router = Router();
router.use(authenticate, requireAdmin);

const TABLES = { AuditLog: 'Registros de auditoria', Credential: 'Senhas', CredentialHistory: 'Versões de senhas', Attachment: 'Anexos', Folder: 'Pastas', User: 'Usuários' };

// GET /api/data — prazos, volume dos registros e espaço ocupado no banco
router.get('/', async (req, res, next) => {
  try {
    const [retention, auditCount, auditRange, trashCreds, trashFolders, oldestTrash, dbSize, sizes] = await Promise.all([
      getRetention(),
      prisma.auditLog.count(),
      prisma.auditLog.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.credential.count({ where: { deletedAt: { not: null }, deletedWithFolder: null } }),
      prisma.folder.count({ where: { deletedAt: { not: null }, deletedWithFolder: null } }),
      prisma.credential.aggregate({ where: { ...WITH_DELETED, deletedAt: { not: null } }, _min: { deletedAt: true } }),
      prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`,
      prisma.$queryRaw`SELECT relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    ]);
    const sizeMap = Object.fromEntries(sizes.map(r => [r.name, Number(r.bytes)]));
    res.json({
      ...retention,
      audit: { count: auditCount, oldest: auditRange._min.createdAt, newest: auditRange._max.createdAt },
      trash: { credentials: trashCreds, folders: trashFolders, oldest: oldestTrash._min.deletedAt },
      database: {
        bytes: Number(dbSize[0]?.bytes || 0),
        tables: Object.entries(TABLES).map(([key, label]) => ({ key, label, bytes: sizeMap[key] || 0 })),
      },
    });
  } catch (err) { next(err); }
});

// PUT /api/data/retention — { trashRetentionDays, auditRetentionDays } (0 = sem limite)
router.put('/retention', async (req, res, next) => {
  try {
    const data = {};
    for (const key of ['trashRetentionDays', 'auditRetentionDays']) {
      if (req.body[key] === undefined) continue;
      const n = Number(req.body[key]);
      if (!Number.isInteger(n) || n < 0 || n > 3650) return res.status(400).json({ error: 'Informe um número de dias entre 0 (sem limite) e 3650' });
      data[key] = n;
    }
    // Auditoria guardada por menos de 7 dias apagaria rastros de incidentes recentes
    if (data.auditRetentionDays > 0 && data.auditRetentionDays < 7) return res.status(400).json({ error: 'Guarde a auditoria por pelo menos 7 dias (ou 0 para sem limite)' });
    await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } });
    await createAuditLog(req.user.id, 'settings.retention_updated', null, 'Settings', data, req.ip);
    res.json(await getRetention());
  } catch (err) { next(err); }
});

// POST /api/data/audit/purge — { olderThanDays: N } ou { all: true }
router.post('/audit/purge', async (req, res, next) => {
  try {
    let before;
    if (req.body?.all === true) before = new Date(Date.now() + 1000);
    else {
      const n = Number(req.body?.olderThanDays);
      if (!Number.isInteger(n) || n < 1 || n > 3650) return res.status(400).json({ error: 'Informe quantos dias manter (1 a 3650)' });
      before = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }
    const removed = await purgeAuditLogs(before, req.user.id, req.body?.all ? 'admin apagou todos' : `admin apagou anteriores a ${req.body.olderThanDays} dias`, req.ip);
    res.json({ removed });
  } catch (err) { next(err); }
});

export default router;
