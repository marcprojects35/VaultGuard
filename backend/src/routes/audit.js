import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, userId, action, search, resourceId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      ...(userId && { userId }),
      ...(resourceId && { resourceId }),
      ...(action && { action: { contains: action } }),
      ...(search && {
        OR: [
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
        take: parseInt(limit),
      }),
      prisma.auditLog.count({ where })
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

export default router;
