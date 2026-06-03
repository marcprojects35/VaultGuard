import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/users — admin only
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { search, role, status } = req.query;
    const users = await prisma.user.findMany({
      where: {
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ]
        }),
        ...(role && { role }),
        ...(status && { status }),
      },
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, status: true, totpEnabled: true, lastLogin: true, avatar: true,
        createdAt: true, updatedAt: true
      },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }]
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /api/users — admin creates user
router.post('/', authenticate, requireAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('username').notEmpty().trim().isLength({ min: 3 }),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').isIn(['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA', 'ADMINISTRADOR']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, username, password, firstName, lastName, role } = req.body;

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] }
      });
      if (existing) return res.status(409).json({ error: 'Email or username already exists' });

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          email, username, passwordHash, firstName, lastName,
          role, status: 'ACTIVE'
        },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          role: true, status: true, createdAt: true
        }
      });

      await createAuditLog(req.user.id, 'user.create', user.id, 'User', { email, role }, req.ip);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/users/:id
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const isSelf = req.user.id === req.params.id;
    const isAdmin = req.user.role === 'ADMINISTRADOR';
    if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const updateData = {};
    if (req.body.firstName) updateData.firstName = req.body.firstName;
    if (req.body.lastName) updateData.lastName = req.body.lastName;
    if (req.body.avatar !== undefined) updateData.avatar = req.body.avatar;

    // Only admin can change role/status
    if (isAdmin) {
      if (req.body.role) updateData.role = req.body.role;
      if (req.body.status) updateData.status = req.body.status;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, status: true, avatar: true, updatedAt: true
      }
    });

    await createAuditLog(req.user.id, 'user.update', user.id, 'User', updateData, req.ip);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await prisma.user.delete({ where: { id: req.params.id } });
    await createAuditLog(req.user.id, 'user.delete', req.params.id, 'User', null, req.ip);
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/reset-password — admin
router.post('/:id/reset-password', authenticate, requireAdmin,
  [body('password').isLength({ min: 8 })],
  validate,
  async (req, res, next) => {
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: hash } });
      await createAuditLog(req.user.id, 'user.password_reset', req.params.id, 'User', null, req.ip);
      res.json({ message: 'Password reset successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
