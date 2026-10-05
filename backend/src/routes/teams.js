import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';
import { sendTeamInviteNotification } from '../services/email.js';
import { pruneFolderKeys } from '../services/keys.js';

const router = Router();
const prisma = new PrismaClient();

async function enrichTeams(teams, userId) {
  const memberCounts = await prisma.teamMember.groupBy({
    by: ['teamId'],
    where: { teamId: { in: teams.map(t => t.id) }, status: 'ACTIVE' },
    _count: { _all: true },
  });
  const countMap = Object.fromEntries(memberCounts.map(m => [m.teamId, m._count._all]));

  const ownerIds = [...new Set(teams.map(t => t.ownerId))];
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const ownerMap = Object.fromEntries(owners.map(o => [o.id, o]));

  let myStatus = {};
  if (userId) {
    const mine = await prisma.teamMember.findMany({
      where: { teamId: { in: teams.map(t => t.id) }, userId },
      select: { teamId: true, status: true },
    });
    myStatus = Object.fromEntries(mine.map(m => [m.teamId, m.status]));
  }

  return teams.map(t => ({
    ...t,
    owner: ownerMap[t.ownerId],
    memberCount: countMap[t.id] || 0,
    myStatus: myStatus[t.id] || null,
  }));
}

// GET /api/teams — mine (dono ou membro ACTIVE); admin com ?all=true vê todos
router.get('/', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'ADMINISTRADOR';

    let teams;
    if (isAdmin && req.query.all === 'true') {
      teams = await prisma.team.findMany({ orderBy: { name: 'asc' } });
    } else {
      const memberships = await prisma.teamMember.findMany({
        where: { userId: req.user.id, status: 'ACTIVE' },
        select: { teamId: true },
      });
      teams = await prisma.team.findMany({
        where: { id: { in: memberships.map(m => m.teamId) } },
        orderBy: { name: 'asc' },
      });
    }

    res.json(await enrichTeams(teams, req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/teams — qualquer usuário cria, vira dono e membro ACTIVE
router.post('/', authenticate,
  [body('name').notEmpty().trim()],
  validate,
  async (req, res, next) => {
    try {
      const team = await prisma.team.create({
        data: {
          name: req.body.name,
          description: req.body.description || null,
          ownerId: req.user.id,
          members: {
            create: { userId: req.user.id, status: 'ACTIVE', invitedById: req.user.id, respondedAt: new Date() },
          },
        },
      });

      await createAuditLog(req.user.id, 'team.create', team.id, 'Team', { name: team.name }, req.ip);
      res.status(201).json(team);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/teams/invites — convites PENDING do usuário logado
router.get('/invites', authenticate, async (req, res, next) => {
  try {
    const invites = await prisma.teamMember.findMany({
      where: { userId: req.user.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    const teamIds = [...new Set(invites.map(i => i.teamId))];
    const inviterIds = [...new Set(invites.map(i => i.invitedById))];
    const [teams, inviters] = await Promise.all([
      prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, description: true } }),
      prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t]));
    const inviterMap = Object.fromEntries(inviters.map(u => [u.id, u]));

    res.json(invites.map(i => ({ ...i, team: teamMap[i.teamId], invitedBy: inviterMap[i.invitedById] })));
  } catch (err) {
    next(err);
  }
});

// PUT /api/teams/invites/:id — o próprio convidado aceita ou recusa
router.put('/invites/:id',
  authenticate,
  [body('accept').isBoolean()],
  validate,
  async (req, res, next) => {
    try {
      const invite = await prisma.teamMember.findUnique({ where: { id: req.params.id } });
      if (!invite) return res.status(404).json({ error: 'Convite não encontrado' });
      if (invite.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      if (invite.status !== 'PENDING') return res.status(409).json({ error: 'Convite já respondido' });

      const updated = await prisma.teamMember.update({
        where: { id: invite.id },
        data: { status: req.body.accept ? 'ACTIVE' : 'DECLINED', respondedAt: new Date() },
      });

      await createAuditLog(req.user.id, req.body.accept ? 'team.invite_accept' : 'team.invite_decline',
        invite.teamId, 'Team', {}, req.ip);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/teams/:id/invite — dono do time ou admin convida um usuário
router.post('/:id/invite', authenticate,
  [body('userId').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const team = await prisma.team.findUnique({ where: { id: req.params.id } });
      if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

      const isAdmin = req.user.role === 'ADMINISTRADOR';
      if (team.ownerId !== req.user.id && !isAdmin) {
        return res.status(403).json({ error: 'Só o dono da equipe ou um administrador pode convidar' });
      }

      const existing = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: req.body.userId } },
      });
      if (existing && existing.status !== 'DECLINED') {
        return res.status(409).json({ error: 'Usuário já é membro ou já tem convite pendente' });
      }

      const member = existing
        ? await prisma.teamMember.update({
            where: { id: existing.id },
            data: { status: 'PENDING', invitedById: req.user.id, respondedAt: null },
          })
        : await prisma.teamMember.create({
            data: { teamId: team.id, userId: req.body.userId, status: 'PENDING', invitedById: req.user.id },
          });

      await createAuditLog(req.user.id, 'team.invite', team.id, 'Team', { userId: req.body.userId }, req.ip);

      sendTeamInviteNotification({ inviteeId: req.body.userId, team, inviter: req.user }).catch(() => {});

      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/teams/:id/members — lista membros ACTIVE (qualquer membro/dono/admin vê)
router.get('/:id/members', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'ADMINISTRADOR';
    if (!isAdmin) {
      const me = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: req.params.id, userId: req.user.id } },
      });
      if (!me || me.status !== 'ACTIVE') return res.status(403).json({ error: 'Forbidden' });
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId: req.params.id, status: { in: ['ACTIVE', 'PENDING'] } },
      orderBy: { createdAt: 'asc' },
    });
    const userIds = members.map(m => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    res.json(members.map(m => ({ ...m, user: userMap[m.userId] })));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/teams/:id/members/:userId — dono/admin remove, ou o próprio sai
router.delete('/:id/members/:userId', authenticate, async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({ where: { id: req.params.id } });
    if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

    const isAdmin = req.user.role === 'ADMINISTRADOR';
    const isOwner = team.ownerId === req.user.id;
    const isSelf = req.params.userId === req.user.id;
    if (!isAdmin && !isOwner && !isSelf) return res.status(403).json({ error: 'Forbidden' });
    if (req.params.userId === team.ownerId) return res.status(400).json({ error: 'Não é possível remover o dono da equipe' });

    await prisma.teamMember.deleteMany({ where: { teamId: team.id, userId: req.params.userId } });
    const teamFolders = await prisma.folder.findMany({ where: { teamId: team.id }, select: { id: true } });
    if (teamFolders.length) await pruneFolderKeys(teamFolders.map(f => f.id));
    await createAuditLog(req.user.id, 'team.member_remove', team.id, 'Team', { userId: req.params.userId }, req.ip);
    res.json({ message: 'Removido da equipe' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/teams/:id — dono ou admin exclui (bloqueia se houver pastas)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({ where: { id: req.params.id } });
    if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

    const isAdmin = req.user.role === 'ADMINISTRADOR';
    if (team.ownerId !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const folderCount = await prisma.folder.count({ where: { teamId: team.id } });
    if (folderCount > 0) {
      return res.status(409).json({ error: `Exclua ou mova as ${folderCount} pasta(s) da equipe antes de excluí-la` });
    }

    await prisma.team.delete({ where: { id: team.id } });
    await createAuditLog(req.user.id, 'team.delete', team.id, 'Team', { name: team.name }, req.ip);
    res.json({ message: 'Equipe excluída' });
  } catch (err) {
    next(err);
  }
});

export default router;
