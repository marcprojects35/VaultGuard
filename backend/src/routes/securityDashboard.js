import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/dashboard/security
router.get('/security', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const isAdmin = userRole === 'ADMINISTRADOR';

    // Get accessible folder IDs
    let folderIds;
    if (isAdmin) {
      const all = await prisma.folder.findMany({ select: { id: true } });
      folderIds = all.map(f => f.id);
    } else {
      const perms = await prisma.folderPermission.findMany({
        where: { canView: true, OR: [{ userId }, { role: userRole }] },
        select: { folderId: true }
      });
      const personal = await prisma.folder.findMany({
        where: { isPersonal: true, ownerId: userId },
        select: { id: true }
      });
      folderIds = [...new Set([...perms.map(p => p.folderId), ...personal.map(f => f.id)])];
    }

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      total,
      expired,
      expiringSoon,
      expiringCritical,
      weakPasswords,
      noPassword,
      withTags,
      withAttachments,
      strengthDistribution,
      pendingRequests,
      recentCreated,
    ] = await Promise.all([
      prisma.credential.count({ where: { folderId: { in: folderIds } } }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, expiresAt: { not: null, lt: now } }
      }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, expiresAt: { not: null, gte: now, lt: in30Days } }
      }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, expiresAt: { not: null, gte: now, lt: in7Days } }
      }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, strength: { not: null, lt: 40 } }
      }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, OR: [{ strength: null }, { strength: 0 }] }
      }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, tags: { isEmpty: false } }
      }),

      prisma.credential.count({
        where: { folderId: { in: folderIds }, attachments: { some: {} } }
      }),

      // Strength buckets: null/0, 1-39, 40-69, 70-89, 90-100
      prisma.credential.groupBy({
        by: ['strength'],
        where: { folderId: { in: folderIds } },
        _count: { id: true },
      }),

      isAdmin
        ? prisma.accessRequest.count({ where: { status: 'PENDING' } })
        : Promise.resolve(0),

      prisma.credential.count({
        where: {
          folderId: { in: folderIds },
          createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
        }
      }),
    ]);

    // Build strength buckets
    const buckets = { critical: 0, weak: 0, fair: 0, strong: 0, veryStrong: 0 };
    for (const row of strengthDistribution) {
      const s = row.strength;
      const count = row._count.id;
      if (s == null || s === 0) buckets.critical += count;
      else if (s < 40) buckets.weak += count;
      else if (s < 70) buckets.fair += count;
      else if (s < 90) buckets.strong += count;
      else buckets.veryStrong += count;
    }

    // Top expired credentials (for admin list)
    const expiredList = await prisma.credential.findMany({
      where: { folderId: { in: folderIds }, expiresAt: { not: null, lt: now } },
      select: { id: true, title: true, expiresAt: true, folder: { select: { name: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 10,
    });

    const expiringSoonList = await prisma.credential.findMany({
      where: { folderId: { in: folderIds }, expiresAt: { not: null, gte: now, lt: in30Days } },
      select: { id: true, title: true, expiresAt: true, folder: { select: { name: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 10,
    });

    const weakList = await prisma.credential.findMany({
      where: { folderId: { in: folderIds }, strength: { not: null, lt: 40 } },
      select: { id: true, title: true, strength: true, folder: { select: { name: true } } },
      orderBy: { strength: 'asc' },
      take: 10,
    });

    res.json({
      total,
      expired,
      expiringSoon,
      expiringCritical,
      weakPasswords,
      noPassword,
      withTags,
      withAttachments,
      recentCreated,
      pendingRequests,
      strengthBuckets: buckets,
      score: calculateScore({ total, expired, expiringSoon, weakPasswords }),
      lists: { expired: expiredList, expiringSoon: expiringSoonList, weak: weakList },
    });
  } catch (err) {
    next(err);
  }
});

function calculateScore({ total, expired, expiringSoon, weakPasswords }) {
  if (total === 0) return 100;
  const expiredPct = (expired / total) * 100;
  const expiringSoonPct = (expiringSoon / total) * 100;
  const weakPct = (weakPasswords / total) * 100;
  const score = Math.max(0, 100 - expiredPct * 2 - expiringSoonPct * 0.5 - weakPct * 1.5);
  return Math.round(score);
}

export default router;
