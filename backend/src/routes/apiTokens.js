import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

function maskToken(t) {
  const { token, ...rest } = t;
  return { ...rest, tokenPrefix: token ? token.slice(0, 10) : '—' };
}

// GET /api/tokens
router.get('/', authenticate, async (req, res, next) => {
  try {
    const tokens = await prisma.apiToken.findMany({
      where: { userId: req.user.id },
      select: { id: true, name: true, token: true, lastUsed: true, expiresAt: true, scopes: true, createdAt: true }
    });
    res.json(tokens.map(maskToken));
  } catch (err) { next(err); }
});

// GET /api/tokens/all — admin only: all tokens
router.get('/all', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMINISTRADOR') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const tokens = await prisma.apiToken.findMany({
      select: {
        id: true, name: true, token: true, lastUsed: true,
        expiresAt: true, scopes: true, createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(tokens.map(maskToken));
  } catch (err) { next(err); }
});

// POST /api/tokens
router.post('/', authenticate,
  [body('name').notEmpty().trim()],
  validate,
  async (req, res, next) => {
    try {
      const rawToken = `vg_${crypto.randomBytes(32).toString('hex')}`;
      const token = await prisma.apiToken.create({
        data: {
          userId: req.user.id,
          name: req.body.name,
          token: rawToken,
          scopes: req.body.scopes || ['read'],
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        }
      });
      // Return raw token only once
      res.status(201).json({ ...token, token: rawToken });
    } catch (err) { next(err); }
  }
);

// DELETE /api/tokens/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const token = await prisma.apiToken.findUnique({ where: { id: req.params.id } });
    if (!token) return res.status(404).json({ error: 'Token not found' });
    if (token.userId !== req.user.id && req.user.role !== 'ADMINISTRADOR') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.apiToken.delete({ where: { id: req.params.id } });
    res.json({ message: 'Token deleted' });
  } catch (err) { next(err); }
});

export default router;
