import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';
import { checkPasswordPolicy } from '../services/securitySettings.js';
import { pruneFolderKeys, wipeUserKeys, markForRotation } from '../services/keys.js';
import { notifyNewUser, notifyPasswordChanged, notifyAdminAlert } from '../services/notifications.js';

const router = Router();
const prisma = new PrismaClient();

function generateSalt() {
  return randomBytes(32).toString('hex');
}

async function createPersonalFolder(userId, firstName) {
  return prisma.folder.create({
    data: {
      name: `Pasta de ${firstName}`,
      icon: 'lock',
      color: '#8b5cf6',
      isPersonal: true,
      ownerId: userId,
    }
  });
}

// GET /api/users/search — qualquer usuário autenticado; busca leve pra convite
// de equipe/compartilhamento. Não expõe role/status/totp — só o essencial.
router.get('/search', authenticate, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      take: 10,
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// GET /api/users — admin only
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { search, role, status } = req.query;
    const users = await prisma.user.findMany({
      where: {
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ]
        }),
        ...(role && { role }),
        ...(status && { status }),
      },
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, status: true, totpEnabled: true, lastLogin: true, avatar: true,
        createdAt: true, updatedAt: true
      },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }]
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /api/users — admin creates user
router.post('/', authenticate, requireAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('username').notEmpty().trim().isLength({ min: 3 }),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').custom(async (value) => {
      const role = await prisma.role.findUnique({ where: { key: value } });
      if (!role) throw new Error('Classificação inválida');
      return true;
    }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, username, password, firstName, lastName, role } = req.body;

      const policyError = await checkPasswordPolicy(password);
      if (policyError) return res.status(400).json({ error: policyError });

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] }
      });
      if (existing) return res.status(409).json({ error: 'Email or username already exists' });

      const passwordHash = await bcrypt.hash(password, 12);
      const encryptionSalt = generateSalt();

      const user = await prisma.user.create({
        data: {
          email, username, passwordHash, firstName, lastName,
          role, status: 'ACTIVE', encryptionSalt,
          // Senha definida pelo admin: o usuário cria a dele no primeiro acesso
          mustChangePassword: true,
        },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          role: true, status: true, createdAt: true
        }
      });

      // Auto-create personal folder for new user
      await createPersonalFolder(user.id, firstName);

      await createAuditLog(req.user.id, 'user.create', user.id, 'User', { email, role }, req.ip);
      notifyNewUser(user);
      if (role === 'ADMINISTRADOR') {
        notifyAdminAlert('novo administrador', `${req.user.email} criou o administrador ${email}.`);
      }
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/users/:id
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const isSelf = req.user.id === req.params.id;
    const isAdmin = req.user.role === 'ADMINISTRADOR';
    if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const updateData = {};
    if (req.body.firstName) updateData.firstName = req.body.firstName;
    if (req.body.lastName) updateData.lastName = req.body.lastName;
    if (req.body.avatar !== undefined) {
      const avatar = req.body.avatar;
      if (avatar !== null && avatar !== '' &&
          !(typeof avatar === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))) {
        return res.status(400).json({ error: 'Avatar inválido' });
      }
      updateData.avatar = avatar || null;
    }

    if (isAdmin) {
      if (req.body.role) {
        const role = await prisma.role.findUnique({ where: { key: req.body.role } });
        if (!role) return res.status(400).json({ error: 'Classificação inválida' });
        updateData.role = req.body.role;
        // Quem deixa de ser admin perde a chave da organização
        if (req.body.role !== 'ADMINISTRADOR') {
          await prisma.orgKeyGrant.deleteMany({ where: { userId: req.params.id } });
        } else {
          const before = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true, email: true } });
          if (before && before.role !== 'ADMINISTRADOR') {
            notifyAdminAlert('novo administrador', `${req.user.email} promoveu ${before.email} a administrador.`);
          }
        }
      }
      if (req.body.status) {
        if (!['ACTIVE', 'INACTIVE', 'PENDING'].includes(req.body.status)) {
          return res.status(400).json({ error: 'Status inválido' });
        }
        updateData.status = req.body.status;
        // Mudança de status (ex.: desativar) derruba as sessões abertas na hora
        const current = await prisma.user.findUnique({ where: { id: req.params.id }, select: { status: true } });
        if (current && current.status !== req.body.status) updateData.tokenVersion = { increment: 1 };
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, status: true, avatar: true, updatedAt: true
      }
    });

    if (updateData.role || updateData.status) await pruneFolderKeys();

    const { tokenVersion, avatar, ...auditData } = updateData;
    if (avatar !== undefined) auditData.avatarChanged = true;
    await createAuditLog(req.user.id, 'user.update', user.id, 'User', auditData, req.ip);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    const heldKeys = await prisma.folderKey.findMany({ where: { holder: req.params.id }, select: { folderId: true } });
    await prisma.user.delete({ where: { id: req.params.id } });
    await prisma.folderKey.deleteMany({ where: { holder: req.params.id } });
    await markForRotation(heldKeys.map(k => k.folderId));
    await prisma.orgKeyGrant.deleteMany({ where: { userId: req.params.id } });
    await createAuditLog(req.user.id, 'user.delete', req.params.id, 'User', null, req.ip);
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/reset-password — admin
router.post('/:id/reset-password', authenticate, requireAdmin,
  [body('password').isLength({ min: 8 })],
  validate,
  async (req, res, next) => {
    try {
      const policyError = await checkPasswordPolicy(req.body.password);
      if (policyError) return res.status(400).json({ error: policyError });

      const hash = await bcrypt.hash(req.body.password, 12);
      await prisma.user.update({
        where: { id: req.params.id },
        data: {
          passwordHash: hash, mustChangePassword: true, passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null,
        }
      });
      // Sem a senha antiga a chave privada não pode ser aberta: o usuário recebe
      // chaves novas no próximo login e as pastas compartilhadas são reliberadas
      await wipeUserKeys(req.params.id);
      // Tokens de API também caem: o reset costuma ser resposta a conta comprometida
      await prisma.apiToken.deleteMany({ where: { userId: req.params.id } });
      await createAuditLog(req.user.id, 'user.password_reset', req.params.id, 'User', null, req.ip);
      const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { email: true, firstName: true } });
      if (target) notifyPasswordChanged(target, { byAdmin: true });
      res.json({ message: 'Password reset successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export { generateSalt, createPersonalFolder };
export default router;
