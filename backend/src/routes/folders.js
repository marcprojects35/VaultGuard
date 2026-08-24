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
    const { userId, role, id: uid } = req.user;
    let folders;

    if (role === 'ADMINISTRADOR') {
      folders = await prisma.folder.findMany({
        where: {
          OR: [
            { isPersonal: false },
            { isPersonal: true, ownerId: uid },
          ]
        },
        include: {
          permissions: true,
          _count: { select: { credentials: true } }
        },
        orderBy: [{ isPersonal: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
      });
    } else {
      // Shared folders via permissions
      const perms = await prisma.folderPermission.findMany({
        where: {
          canView: true,
          OR: [{ userId: uid }, { role }]
        },
        select: { folderId: true }
      });
      const sharedIds = [...new Set(perms.map(p => p.folderId))];

      const memberships = await prisma.teamMember.findMany({
        where: { userId: uid, status: 'ACTIVE' },
        select: { teamId: true },
      });
      const teamIds = memberships.map(m => m.teamId);

      folders = await prisma.folder.findMany({
        where: {
          OR: [
            { id: { in: sharedIds } },
            { isPersonal: true, ownerId: uid },
            { visibleToAll: true },
            ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
          ]
        },
        include: { _count: { select: { credentials: true } } },
        orderBy: [{ isPersonal: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
      });
    }

    // Separate personal folders from shared tree
    const personalFolders = folders.filter(f => f.isPersonal);
    const sharedFolders = folders.filter(f => !f.isPersonal);

    const sharedTree = buildTree(sharedFolders);
    const personalTree = buildTree(personalFolders);

    res.json({ shared: sharedTree, personal: personalTree });
  } catch (err) {
    next(err);
  }
});

// GET /api/folders/admin-all — admin: all folders including all personal folders
router.get('/admin-all', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMINISTRADOR') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const allFolders = await prisma.folder.findMany({
      include: {
        permissions: true,
        _count: { select: { credentials: true } },
        owner: { select: { id: true, firstName: true, lastName: true } }
      },
      orderBy: [{ isPersonal: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
    });

    const sharedFolders = allFolders.filter(f => !f.isPersonal);
    const personalFolders = allFolders.filter(f => f.isPersonal);

    res.json({
      shared: buildTree(sharedFolders),
      personal: buildTree(personalFolders),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/folders — pasta pessoal (qualquer usuário), de equipe (membro ACTIVE
// do time) ou corporativa/visível-a-todos (só admin)
router.post('/', authenticate,
  [body('name').notEmpty().trim()],
  validate,
  async (req, res, next) => {
    try {
      const isAdmin = req.user.role === 'ADMINISTRADOR';
      const visibility = req.body.visibility || (req.body.isPersonal ? 'personal' : 'corporate');

      const data = {
        name: req.body.name,
        description: req.body.description,
        icon: req.body.icon || 'folder',
        color: req.body.color || '#6366f1',
        parentId: req.body.parentId || null,
        sortOrder: req.body.sortOrder || 0,
        isPersonal: false,
        ownerId: null,
        teamId: null,
        visibleToAll: false,
      };
      let auditAction;

      if (visibility === 'personal') {
        data.isPersonal = true;
        data.ownerId = req.user.id;
        auditAction = 'folder.create_personal';
      } else if (visibility === 'team') {
        const teamId = req.body.teamId;
        if (!teamId) return res.status(400).json({ error: 'teamId obrigatório para pasta de equipe' });
        const membership = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId: req.user.id } },
        });
        if (!membership || membership.status !== 'ACTIVE') {
          return res.status(403).json({ error: 'Você não é membro ativo dessa equipe' });
        }
        data.teamId = teamId;
        auditAction = 'folder.create_team';
      } else {
        if (!isAdmin) return res.status(403).json({ error: 'Only administrators can create corporate folders' });
        data.visibleToAll = true;
        auditAction = 'folder.create_corporate';
      }

      const folder = await prisma.folder.create({ data });
      await createAuditLog(req.user.id, auditAction, folder.id, 'Folder', { name: folder.name }, req.ip);
      res.status(201).json(folder);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/folders/:id
router.put('/:id', authenticate,
  [body('name').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const folder = await prisma.folder.findUnique({ where: { id: req.params.id } });
      if (!folder) return res.status(404).json({ error: 'Folder not found' });

      const isAdmin = req.user.role === 'ADMINISTRADOR';
      let isOwner = folder.isPersonal && folder.ownerId === req.user.id;
      if (!isOwner && folder.teamId) {
        const team = await prisma.team.findUnique({ where: { id: folder.teamId }, select: { ownerId: true } });
        isOwner = team?.ownerId === req.user.id;
      }

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const updated = await prisma.folder.update({
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
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/folders/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const folder = await prisma.folder.findUnique({ where: { id: req.params.id } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const isAdmin = req.user.role === 'ADMINISTRADOR';
    let isOwner = folder.isPersonal && folder.ownerId === req.user.id;
    if (!isOwner && folder.teamId) {
      const team = await prisma.team.findUnique({ where: { id: folder.teamId }, select: { ownerId: true } });
      isOwner = team?.ownerId === req.user.id;
    }

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.folder.delete({ where: { id: req.params.id } });
    await createAuditLog(req.user.id, 'folder.delete', req.params.id, 'Folder', null, req.ip);
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/folders/:id/permissions — admin only
router.put('/:id/permissions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { permissions } = req.body;
    const folderId = req.params.id;

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

// GET /api/folders/:id/permissions — admin only
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
