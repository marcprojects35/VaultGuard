import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { canAccessFolder } from '../services/permissions.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/credentials — list all accessible credentials
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search, folderId, tag } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get folders this user can access
    const accessibleFolders = await getAccessibleFolderIds(userId, userRole);

    const where = {
      folderId: folderId ? folderId : { in: accessibleFolders },
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { url: { contains: search, mode: 'insensitive' } },
        ]
      }),
      ...(tag && { tags: { has: tag } })
    };

    const credentials = await prisma.credential.findMany({
      where,
      include: { folder: { select: { id: true, name: true, color: true } } },
      orderBy: [{ folder: { name: 'asc' } }, { title: 'asc' }]
    });

    // Never return encrypted password in list
    const safe = credentials.map(({ encryptedPass, ...c }) => c);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/:id — get single with encrypted password
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({
      where: { id: req.params.id },
      include: { folder: true }
    });

    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    const canAccess = await canAccessFolder(req.user.id, req.user.role, cred.folderId);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    // Update last used
    await prisma.credential.update({ where: { id: cred.id }, data: { lastUsed: new Date() } });
    await createAuditLog(req.user.id, 'credential.view', cred.id, 'Credential', { title: cred.title }, req.ip);

    res.json(cred);
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials
router.post('/', authenticate,
  [
    body('title').notEmpty().trim(),
    body('folderId').notEmpty(),
    body('encryptedPass').notEmpty(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { folderId } = req.body;
      const canEdit = await canAccessFolder(req.user.id, req.user.role, folderId, 'canEdit');
      if (!canEdit) return res.status(403).json({ error: 'No edit permission on this folder' });

      const cred = await prisma.credential.create({
        data: {
          folderId: req.body.folderId,
          title: req.body.title,
          username: req.body.username,
          encryptedPass: req.body.encryptedPass,
          url: req.body.url,
          notes: req.body.notes,
          tags: req.body.tags || [],
          strength: req.body.strength,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        },
        include: { folder: { select: { id: true, name: true } } }
      });

      await createAuditLog(req.user.id, 'credential.create', cred.id, 'Credential', { title: cred.title }, req.ip);
      const { encryptedPass, ...safe } = cred;
      res.status(201).json(safe);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/credentials/:id
router.put('/:id', authenticate,
  [body('title').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
      if (!cred) return res.status(404).json({ error: 'Not found' });

      const canEdit = await canAccessFolder(req.user.id, req.user.role, cred.folderId, 'canEdit');
      if (!canEdit) return res.status(403).json({ error: 'No edit permission' });

      const updated = await prisma.credential.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.title && { title: req.body.title }),
          ...(req.body.username !== undefined && { username: req.body.username }),
          ...(req.body.encryptedPass && { encryptedPass: req.body.encryptedPass }),
          ...(req.body.url !== undefined && { url: req.body.url }),
          ...(req.body.notes !== undefined && { notes: req.body.notes }),
          ...(req.body.tags && { tags: req.body.tags }),
          ...(req.body.strength !== undefined && { strength: req.body.strength }),
          ...(req.body.expiresAt !== undefined && { expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null }),
        }
      });

      await createAuditLog(req.user.id, 'credential.update', cred.id, 'Credential', { title: updated.title }, req.ip);
      const { encryptedPass, ...safe } = updated;
      res.json(safe);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/credentials/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });

    const canDel = await canAccessFolder(req.user.id, req.user.role, cred.folderId, 'canDelete');
    if (!canDel) return res.status(403).json({ error: 'No delete permission' });

    await prisma.credential.delete({ where: { id: req.params.id } });
    await createAuditLog(req.user.id, 'credential.delete', cred.id, 'Credential', { title: cred.title }, req.ip);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/export — export credentials as CSV (no passwords)
router.get('/export', authenticate, async (req, res, next) => {
  try {
    const { folderId, search } = req.query;
    const accessibleFolders = await getAccessibleFolderIds(req.user.id, req.user.role);

    const where = {
      folderId: folderId ? folderId : { in: accessibleFolders },
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ]
      }),
    };

    const credentials = await prisma.credential.findMany({
      where,
      include: { folder: { select: { name: true } } },
      orderBy: [{ folder: { name: 'asc' } }, { title: 'asc' }]
    });

    const rows = [['Título', 'Usuário', 'URL', 'Pasta', 'Tags', 'Notas', 'Criado em']];
    credentials.forEach(c => rows.push([
      c.title,
      c.username || '',
      c.url || '',
      c.folder?.name || '',
      (c.tags || []).join('; '),
      (c.notes || '').replace(/\n/g, ' '),
      new Date(c.createdAt).toLocaleString('pt-BR'),
    ]));

    const csv = rows.map(r =>
      r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vaultguard-export-${Date.now()}.csv"`);
    res.send('﻿' + csv); // BOM for Excel
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials/import — bulk import from CSV
router.post('/import', authenticate, async (req, res, next) => {
  try {
    const { rows, folderId } = req.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No rows to import' });
    }

    const canEdit = await canAccessFolder(req.user.id, req.user.role, folderId, 'canEdit');
    if (!canEdit) return res.status(403).json({ error: 'No edit permission on this folder' });

    const created = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.title) { errors.push({ row: i + 1, error: 'Título obrigatório' }); continue; }

      try {
        const cred = await prisma.credential.create({
          data: {
            folderId,
            title: row.title,
            username: row.username || null,
            encryptedPass: row.encryptedPass || row.password || '',
            url: row.url || null,
            notes: row.notes || null,
            tags: row.tags ? row.tags.split(';').map(t => t.trim()).filter(Boolean) : [],
            strength: 0,
          }
        });
        created.push(cred.id);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }

    await createAuditLog(req.user.id, 'credential.import', null, 'Credential',
      { count: created.length, folderId }, req.ip);

    res.json({ imported: created.length, errors });
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/by-url?url=...  (for Chrome extension autofill)
router.get('/search/by-url', authenticate, async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.json([]);

    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const accessibleFolders = await getAccessibleFolderIds(req.user.id, req.user.role);

    const credentials = await prisma.credential.findMany({
      where: {
        folderId: { in: accessibleFolders },
        url: { contains: hostname }
      },
      include: { folder: { select: { id: true, name: true } } }
    });

    const safe = credentials.map(({ encryptedPass, ...c }) => c);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

async function getAccessibleFolderIds(userId, userRole) {
  // Admin sees all
  if (userRole === 'ADMINISTRADOR') {
    const all = await prisma.folder.findMany({ select: { id: true } });
    return all.map(f => f.id);
  }

  const perms = await prisma.folderPermission.findMany({
    where: {
      canView: true,
      OR: [{ userId }, { role: userRole }]
    },
    select: { folderId: true }
  });

  return [...new Set(perms.map(p => p.folderId))];
}

export default router;
