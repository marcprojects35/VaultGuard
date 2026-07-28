import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const prisma = new PrismaClient();

function slugifyRoleKey(label) {
  return label
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'CARGO';
}

async function uniqueRoleKey(label) {
  const base = slugifyRoleKey(label);
  let key = base;
  let n = 1;
  while (await prisma.role.findUnique({ where: { key } })) {
    n += 1;
    key = `${base}_${n}`;
  }
  return key;
}

// GET /api/roles — qualquer usuário autenticado (usado nos seletores de cargo)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { priority: 'desc' },
      include: { _count: { select: { users: true } } },
    });
    res.json(roles);
  } catch (err) {
    next(err);
  }
});

// POST /api/roles — admin only
router.post('/', authenticate, requireAdmin,
  [body('label').notEmpty().trim()],
  validate,
  async (req, res, next) => {
    try {
      const { label, color } = req.body;
      const key = await uniqueRoleKey(label);

      // A nova classificação entra logo abaixo das protegidas (ex: Administrador).
      // Como as prioridades são inteiros consecutivos sem "buracos", abre espaço
      // empurrando pra cima quem já está na prioridade das protegidas ou acima.
      const minProtected = await prisma.role.aggregate({
        where: { isProtected: true },
        _min: { priority: true },
      });
      const priority = minProtected._min.priority ?? 0;

      const [role] = await prisma.$transaction([
        prisma.role.create({
          data: { key, label, color: color || '#64748b', priority, isProtected: false },
        }),
        prisma.role.updateMany({
          where: { isProtected: true, priority: { gte: priority } },
          data: { priority: { increment: 1 } },
        }),
      ]);

      await createAuditLog(req.user.id, 'role.create', role.key, 'Role', { label }, req.ip);
      res.status(201).json(role);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/roles/:key — admin only (label/cor apenas; key é imutável)
router.put('/:key', authenticate, requireAdmin,
  [body('label').optional().trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const role = await prisma.role.findUnique({ where: { key: req.params.key } });
      if (!role) return res.status(404).json({ error: 'Classificação não encontrada' });
      if (role.isProtected) return res.status(403).json({ error: 'Esta classificação é protegida e não pode ser editada' });

      const updated = await prisma.role.update({
        where: { key: role.key },
        data: {
          ...(req.body.label !== undefined && { label: req.body.label }),
          ...(req.body.color !== undefined && { color: req.body.color }),
        },
      });

      await createAuditLog(req.user.id, 'role.update', role.key, 'Role', req.body, req.ip);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/roles/:key/priority — admin only, troca de posição com uma role vizinha
router.put('/:key/priority', authenticate, requireAdmin,
  [body('direction').isIn(['up', 'down'])],
  validate,
  async (req, res, next) => {
    try {
      const role = await prisma.role.findUnique({ where: { key: req.params.key } });
      if (!role) return res.status(404).json({ error: 'Classificação não encontrada' });
      if (role.isProtected) return res.status(403).json({ error: 'A prioridade desta classificação é fixa' });

      const roles = await prisma.role.findMany({ orderBy: { priority: 'asc' } });
      const idx = roles.findIndex(r => r.key === role.key);
      const swapIdx = req.body.direction === 'up' ? idx + 1 : idx - 1;
      if (swapIdx < 0 || swapIdx >= roles.length) return res.json(roles);

      const other = roles[swapIdx];
      if (other.isProtected) return res.status(403).json({ error: 'A prioridade desta classificação é fixa' });
      await prisma.$transaction([
        prisma.role.update({ where: { key: role.key }, data: { priority: other.priority } }),
        prisma.role.update({ where: { key: other.key }, data: { priority: role.priority } }),
      ]);

      const updated = await prisma.role.findMany({ orderBy: { priority: 'desc' } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/roles/:key — admin only
router.delete('/:key', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const role = await prisma.role.findUnique({ where: { key: req.params.key } });
    if (!role) return res.status(404).json({ error: 'Classificação não encontrada' });
    if (role.isProtected) return res.status(403).json({ error: 'Esta classificação é protegida e não pode ser excluída' });

    const usersCount = await prisma.user.count({ where: { role: role.key } });

    if (usersCount > 0) {
      const { reassignTo } = req.body;
      if (!reassignTo) {
        return res.status(400).json({
          error: 'Há usuários com esta classificação. Escolha um cargo substituto.',
          usersCount,
        });
      }
      if (reassignTo === role.key) {
        return res.status(400).json({ error: 'O cargo substituto precisa ser diferente do que está sendo excluído' });
      }
      const target = await prisma.role.findUnique({ where: { key: reassignTo } });
      if (!target) return res.status(400).json({ error: 'Cargo substituto inválido' });

      await prisma.user.updateMany({ where: { role: role.key }, data: { role: reassignTo } });
    }

    await prisma.role.delete({ where: { key: role.key } });

    await createAuditLog(req.user.id, 'role.delete', role.key, 'Role',
      { reassignedUsers: usersCount, reassignTo: req.body.reassignTo || null }, req.ip);
    res.json({ message: 'Classificação excluída com sucesso' });
  } catch (err) {
    next(err);
  }
});

export default router;
