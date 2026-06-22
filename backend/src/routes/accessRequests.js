import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';
import { sendAccessRequestNotification, sendAccessRequestResult } from '../services/email.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/access-requests — user sees own, admin sees all
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status } = req.query;
    const isAdmin = req.user.role === 'ADMINISTRADOR';

    const where = {
      ...(isAdmin ? {} : { userId: req.user.id }),
      ...(status ? { status } : {}),
    };

    const requests = await prisma.accessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with user and folder info
    const userIds = [...new Set(requests.flatMap(r => [r.userId, r.reviewedById].filter(Boolean)))];
    const folderIds = [...new Set(requests.map(r => r.folderId))];

    const [users, folders] = await Promise.all([
      userIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
        : [],
      folderIds.length > 0
        ? prisma.folder.findMany({ where: { id: { in: folderIds } }, select: { id: true, name: true, color: true } })
        : [],
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const folderMap = Object.fromEntries(folders.map(f => [f.id, f]));

    res.json(requests.map(r => ({
      ...r,
      user: userMap[r.userId],
      folder: folderMap[r.folderId],
      reviewedBy: r.reviewedById ? userMap[r.reviewedById] : null,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/access-requests — user submits a request
router.post('/', authenticate,
  [body('folderId').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { folderId, message } = req.body;

      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder) return res.status(404).json({ error: 'Folder not found' });

      // Check if already has access
      const existingPerm = await prisma.folderPermission.findFirst({
        where: { folderId, OR: [{ userId: req.user.id }, { role: req.user.role }] }
      });
      if (existingPerm?.canView) {
        return res.status(409).json({ error: 'You already have access to this folder' });
      }

      // Check for pending request
      const existing = await prisma.accessRequest.findFirst({
        where: { userId: req.user.id, folderId, status: 'PENDING' }
      });
      if (existing) {
        return res.status(409).json({ error: 'You already have a pending request for this folder' });
      }

      const request = await prisma.accessRequest.create({
        data: { userId: req.user.id, folderId, message: message || null }
      });

      await createAuditLog(req.user.id, 'access_request.create', request.id, 'AccessRequest',
        { folder: folder.name }, req.ip);

      // Notify admins (fire and forget)
      sendAccessRequestNotification({
        requester: req.user,
        folder,
        message,
      }).catch(() => {});

      res.status(201).json(request);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/access-requests/:id — admin approves or rejects
router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status, canEdit, canDelete, canShare } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
    }

    const request = await prisma.accessRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'Request already reviewed' });

    const updated = await prisma.accessRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      }
    });

    // On approval, grant folder permission
    if (status === 'APPROVED') {
      await prisma.folderPermission.upsert({
        where: { folderId_userId: { folderId: request.folderId, userId: request.userId } },
        update: {
          canView: true,
          canEdit: canEdit ?? false,
          canDelete: canDelete ?? false,
          canShare: canShare ?? false,
        },
        create: {
          folderId: request.folderId,
          userId: request.userId,
          canView: true,
          canEdit: canEdit ?? false,
          canDelete: canDelete ?? false,
          canShare: canShare ?? false,
        }
      });
    }

    await createAuditLog(req.user.id, `access_request.${status.toLowerCase()}`, request.id, 'AccessRequest',
      { userId: request.userId, folderId: request.folderId }, req.ip);

    // Notify requester (fire and forget)
    const folder = await prisma.folder.findUnique({ where: { id: request.folderId }, select: { name: true } });
    sendAccessRequestResult({
      userId: request.userId,
      folderName: folder?.name || '',
      approved: status === 'APPROVED',
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/access-requests/:id — user cancels own pending request
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const request = await prisma.accessRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Not found' });

    const isAdmin = req.user.role === 'ADMINISTRADOR';
    if (!isAdmin && request.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (request.status !== 'PENDING' && !isAdmin) {
      return res.status(409).json({ error: 'Cannot cancel a reviewed request' });
    }

    await prisma.accessRequest.delete({ where: { id: req.params.id } });
    res.json({ message: 'Request cancelled' });
  } catch (err) {
    next(err);
  }
});

export default router;
