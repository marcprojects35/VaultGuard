import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import { canAccessFolder } from '../services/permissions.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/favorites — list user's favorites with credential data
router.get('/', authenticate, async (req, res, next) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (favorites.length === 0) return res.json([]);

    const credentialIds = favorites.map(f => f.credentialId);
    const credentials = await prisma.credential.findMany({
      where: { id: { in: credentialIds } },
      include: { folder: { select: { id: true, name: true, color: true } } },
    });

    // Filter to only accessible credentials and exclude password
    const accessible = [];
    for (const cred of credentials) {
      const ok = await canAccessFolder(req.user.id, req.user.role, cred.folderId);
      if (ok) {
        const { encryptedPass, ...safe } = cred;
        accessible.push({ ...safe, isFavorite: true });
      }
    }

    res.json(accessible);
  } catch (err) {
    next(err);
  }
});

// POST /api/favorites/:credentialId — add to favorites
router.post('/:credentialId', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.credentialId } });
    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    const canAccess = await canAccessFolder(req.user.id, req.user.role, cred.folderId);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    const fav = await prisma.favorite.upsert({
      where: { userId_credentialId: { userId: req.user.id, credentialId: req.params.credentialId } },
      update: {},
      create: { userId: req.user.id, credentialId: req.params.credentialId },
    });

    res.json(fav);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/favorites/:credentialId — remove from favorites
router.delete('/:credentialId', authenticate, async (req, res, next) => {
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.user.id, credentialId: req.params.credentialId },
    });
    res.json({ message: 'Removed from favorites' });
  } catch (err) {
    next(err);
  }
});

// GET /api/favorites/ids — list just the credential IDs favorited by user
router.get('/ids', authenticate, async (req, res, next) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user.id },
      select: { credentialId: true },
    });
    res.json(favorites.map(f => f.credentialId));
  } catch (err) {
    next(err);
  }
});

export default router;
