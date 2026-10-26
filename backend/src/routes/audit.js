import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../db.js';

const router = Router();

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { userId, action, search, resourceId } = req.query;
    // Paginação vinda da URL: números fora da faixa viram o padrão
    const int = (v, def, min, max) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= min && n <= max ? n : def; };
    const page = int(req.query.page, 1, 1, 1000000);
    const limit = int(req.query.limit, 50, 1, 500);
    const skip = (page - 1) * limit;
    const actionCodes = typeof req.query.actions === 'string'
      ? req.query.actions.split(',').map(a => a.trim()).filter(a => /^[a-z0-9_.]{1,60}$/.test(a)).slice(0, 100) : [];

    const where = {
      ...(userId && { userId }),
      ...(resourceId && { resourceId }),
      ...(action && { action: { contains: action } }),
      ...(search && {
        OR: [
          // Ações cujo texto em português bate com a busca (a tela manda os códigos)
          ...(actionCodes.length ? [{ action: { in: actionCodes } }] : []),
          // Pessoa: cada palavra precisa aparecer no nome, sobrenome ou e-mail ("Ana Teste")
          { user: { is: { AND: search.trim().split(/\s+/).slice(0, 5).map(w => ({ OR: [
            { firstName: { contains: w, mode: 'insensitive' } },
            { lastName: { contains: w, mode: 'insensitive' } },
            { email: { contains: w, mode: 'insensitive' } },
          ] })) } } },
          { action: { contains: search, mode: 'insensitive' } },
          { resourceType: { contains: search, mode: 'insensitive' } },
          { resourceId: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search, mode: 'insensitive' } },
        ]
      }),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where })
    ]);

    res.json({ logs, total, page, limit });
  } catch (err) { next(err); }
});

export default router;
