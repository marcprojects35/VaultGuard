import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { canAccessFolder } from '../services/permissions.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/folders — tree of folders accessible to user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { userId, role } = req.user;
    let folders;

    if (role === 'ADMINISTRADOR') {
      folders = await prisma.folder.findMany({
        include: {
          permissions: true,
          _count: { select: { credentials: true } }
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
      });
    } else {
      const perms = await prisma.folderPermission.findMany({
        where: {
          canView: true,
          OR: [{ userId: req.user.id }, { role }]
        },
        select: { folderId: true }
      });
      const folderIds = [...new Set(perms.map(p => p.folderId))];

      folders = await prisma.folder.findMany({
        where: { id: { in: folderIds } },
        include: { _count: { select: { credentials: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
      });
    }

    // Build tree
    const tree = buildTree(folders);
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

// POST /api/folders
router.post('/', authenticate, requireAdmin,
  [body('name').notEmpty().trim()],
  validate,
  async (req, res, next) => {
    try {
      const folder = await prisma.folder.create({
        data: {
          name: req.body.name,
          description: req.body.description,
          icon: req.body.icon || 'folder',
          color: req.body.color || '#6366f1',
          parentId: req.body.parentId || null,
          sortOrder: req.body.sortOrder || 0,
        }
      });
      await createAuditLog(req.user.id, 'folder.create', folder.id, 'Folder', { name: folder.name }, req.ip);
      res.status(201).json(folder);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/folders/:id
router.put('/:id', authenticate, requireAdmin,
  [body('name').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const folder = await prisma.folder.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name && { name: req.body.name }),
          ...(req.body.description !== undefined && { description: req.body.description }),
          ...(req.body.icon && { icon: req.body.icon }),
          ...(req.body.color && { color: req.body.color }),
          ...(req.body.parentId !== undefined && { parentId: req.body.parentId }),
          ...(req.body.sortOrder !== undefined && { sortOrder: req.body.sortOrder }),
        }
      });
      res.json(folder);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/folders/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.folder.delete({ where: { id: req.params.id } });
    await createAuditLog(req.user.id, 'folder.delete', req.params.id, 'Folder', null, req.ip);
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/folders/:id/permissions — set permissions for folder
router.put('/:id/permissions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { permissions } = req.body; // Array of { userId?, role?, canView, canEdit, canDelete, canShare }
    const folderId = req.params.id;

    // Delete existing then recreate
    await prisma.folderPermission.deleteMany({ where: { folderId } });

    if (permissions && permissions.length > 0) {
      await prisma.folderPermission.createMany({
        data: permissions.map(p => ({
          folderId,
          userId: p.userId || null,
          role: p.role || null,
          canView: p.canView ?? true,
          canEdit: p.canEdit ?? false,
          canDelete: p.canDelete ?? false,
          canShare: p.canShare ?? false,
        }))
      });
    }

    const updated = await prisma.folderPermission.findMany({ where: { folderId } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/folders/:id/permissions
router.get('/:id/permissions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const perms = await prisma.folderPermission.findMany({
      where: { folderId: req.params.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } }
    });
    res.json(perms);
  } catch (err) {
    next(err);
  }
});

function buildTree(folders, parentId = null) {
  return folders
    .filter(f => f.parentId === parentId)
    .map(f => ({
      ...f,
      children: buildTree(folders, f.id)
    }));
}

export default router;
