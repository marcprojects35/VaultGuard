import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { requireCap } from '../services/permissions.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../db.js';
import crypto from 'crypto';
import { hashToken } from '../utils/tokens.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();

const VALID_SCOPES = ['read', 'write'];
const TOKEN_SELECT = { id: true, name: true, tokenPrefix: true, lastUsed: true, expiresAt: true, scopes: true, createdAt: true };

// GET /api/tokens
router.get('/', authenticate, async (req, res, next) => {
  try {
    const tokens = await prisma.apiToken.findMany({
      where: { userId: req.user.id },
      select: TOKEN_SELECT,
    });
    res.json(tokens);
  } catch (err) { next(err); }
});

// GET /api/tokens/all — admin only: all tokens
router.get('/all', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMINISTRADOR') {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação' });
    }
    const tokens = await prisma.apiToken.findMany({
      select: {
        ...TOKEN_SELECT,
        user: { select: { id: true, firstName: true, lastName: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(tokens);
  } catch (err) { next(err); }
});

// POST /api/tokens
router.post('/', authenticate, requireCap('canUseApiTokens', 'Seu cargo não pode usar tokens de API'),
  [body('name').notEmpty().trim()],
  validate,
  async (req, res, next) => {
    try {
      const requested = Array.isArray(req.body.scopes) ? req.body.scopes : ['read', 'write'];
      const scopes = [...new Set(requested.filter(s => VALID_SCOPES.includes(s)))];
      if (!scopes.includes('read')) scopes.unshift('read');

      const rawToken = `vg_${crypto.randomBytes(32).toString('hex')}`;
      const token = await prisma.apiToken.create({
        data: {
          userId: req.user.id,
          name: req.body.name,
          token: hashToken(rawToken),
          tokenPrefix: rawToken.slice(0, 10),
          scopes,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        },
        select: TOKEN_SELECT,
      });
      await createAuditLog(req.user.id, 'api_token.create', token.id, 'ApiToken', { name: token.name, scopes }, req.ip);
      // Valor bruto só nesta resposta; o banco guarda apenas o hash
      res.status(201).json({ ...token, token: rawToken });
    } catch (err) { next(err); }
  }
);

// DELETE /api/tokens/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const token = await prisma.apiToken.findUnique({ where: { id: req.params.id } });
    if (!token) return res.status(404).json({ error: 'Token não encontrado' });
    if (token.userId !== req.user.id && req.user.role !== 'ADMINISTRADOR') {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação' });
    }
    await prisma.apiToken.delete({ where: { id: req.params.id } });
    await createAuditLog(req.user.id, 'api_token.delete', token.id, 'ApiToken', { name: token.name }, req.ip);
    res.json({ message: 'Token deleted' });
  } catch (err) { next(err); }
});

export default router;
