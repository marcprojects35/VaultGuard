import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../db.js';
import { createAuditLog } from '../services/audit.js';
import { sendTeamInviteNotification } from '../services/email.js';
import { pruneFolderKeys } from '../services/keys.js';
import { requireCap, teamMemberPerms, invalidateRoleScopes } from '../services/permissions.js';
import { normalizePolicy } from '../services/passwordPolicy.js';
import { getTwoFactorConfig } from '../services/twoFactor.js';
import { Prisma } from '@prisma/client';

const PERM_FIELDS = ['canEdit', 'canDelete', 'canShare'];
const DEFAULT_FIELDS = { canEdit: 'memberCanEdit', canDelete: 'memberCanDelete', canShare: 'memberCanShare' };

// Padrões do grupo vindos do corpo: { memberCanEdit: true, ... }
const pickDefaults = (body) => Object.fromEntries(Object.values(DEFAULT_FIELDS)
  .filter(f => typeof body[f] === 'boolean').map(f => [f, body[f]]));

// Usuários ativos existentes dentre os ids enviados
async function activeUserIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids.map(String).slice(0, 500) }, status: 'ACTIVE' }, select: { id: true },
  });
  return users.map(u => u.id);
}

const router = Router();

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

// POST /api/teams — quem tem a permissão do cargo cria e vira dono. O admin pode
// escolher outro dono e já incluir membros (entram direto, sem convite).
router.post('/', authenticate, requireCap('canCreateTeams', 'Seu cargo não pode criar grupos'),
  [body('name').notEmpty().trim().isLength({ max: 100 })],
  validate,
  async (req, res, next) => {
    try {
      const isAdmin = req.user.role === 'ADMINISTRADOR';
      let ownerId = req.user.id;
      if (isAdmin && req.body.ownerId) {
        const [owner] = await activeUserIds([req.body.ownerId]);
        if (!owner) return res.status(400).json({ error: 'Dono inválido' });
        ownerId = owner;
      }
      const memberIds = isAdmin ? (await activeUserIds(req.body.memberIds)).filter(id => id !== ownerId) : [];
      const now = new Date();

      const team = await prisma.team.create({
        data: {
          name: req.body.name,
          description: req.body.description || null,
          ownerId,
          ...(isAdmin ? pickDefaults(req.body) : {}),
          members: {
            create: [ownerId, ...memberIds].map(userId => ({ userId, status: 'ACTIVE', invitedById: req.user.id, respondedAt: now })),
          },
        },
      });

      await createAuditLog(req.user.id, 'team.create', team.id, 'Team', { name: team.name, ownerId, members: memberIds.length }, req.ip);
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
      if (invite.userId !== req.user.id) return res.status(403).json({ error: 'Você não tem permissão para esta ação' });
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

// POST /api/teams/:id/invite — o dono convida (a pessoa aceita); o admin
// adiciona direto, sem convite. Aceita userId ou userIds (vários de uma vez).
router.post('/:id/invite', authenticate,
  [body('userId').optional().notEmpty(), body('userIds').optional().isArray({ max: 500 })],
  validate,
  async (req, res, next) => {
    try {
      if (Array.isArray(req.body.userIds)) return addMany(req, res);
      if (!req.body.userId) return res.status(400).json({ error: 'Informe o usuário' });
      const team = await prisma.team.findUnique({ where: { id: req.params.id } });
      if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

      const isAdmin = req.user.role === 'ADMINISTRADOR';
      if (team.ownerId !== req.user.id && !isAdmin) {
        return res.status(403).json({ error: 'Só o dono da equipe ou um administrador pode convidar' });
      }

      const [userId] = await activeUserIds([req.body.userId]);
      if (!userId) return res.status(404).json({ error: 'Usuário não encontrado ou inativo' });

      const existing = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId } },
      });
      if (existing?.status === 'ACTIVE') return res.status(409).json({ error: 'Usuário já é membro' });
      if (existing?.status === 'PENDING' && !isAdmin) return res.status(409).json({ error: 'Usuário já tem convite pendente' });

      const data = isAdmin
        ? { status: 'ACTIVE', invitedById: req.user.id, respondedAt: new Date() }
        : { status: 'PENDING', invitedById: req.user.id, respondedAt: null };
      const member = existing
        ? await prisma.teamMember.update({ where: { id: existing.id }, data })
        : await prisma.teamMember.create({ data: { teamId: team.id, userId, ...data } });

      await createAuditLog(req.user.id, isAdmin ? 'team.member_add' : 'team.invite', team.id, 'Team', { userId }, req.ip);
      if (!isAdmin) sendTeamInviteNotification({ inviteeId: userId, team, inviter: req.user }).catch(() => {});

      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  }
);

// Admin adiciona vários usuários de uma vez, já como membros ativos
async function addMany(req, res) {
  if (req.user.role !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Só o administrador adiciona vários de uma vez' });
  const team = await prisma.team.findUnique({ where: { id: req.params.id } });
  if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });
  const ids = await activeUserIds(req.body.userIds);
  const now = new Date();
  for (const userId of ids) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId } },
      update: { status: 'ACTIVE', respondedAt: now },
      create: { teamId: team.id, userId, status: 'ACTIVE', invitedById: req.user.id, respondedAt: now },
    });
  }
  await createAuditLog(req.user.id, 'team.member_add', team.id, 'Team', { userIds: ids }, req.ip);
  res.status(201).json({ added: ids.length });
}

// PUT /api/teams/:id — dono ou admin: nome/descrição; só o admin: permissões
// padrão dos membros e troca de dono
router.put('/:id', authenticate,
  [body('name').optional().trim().notEmpty().isLength({ max: 100 })],
  validate,
  async (req, res, next) => {
    try {
      const team = await prisma.team.findUnique({ where: { id: req.params.id } });
      if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });
      const isAdmin = req.user.role === 'ADMINISTRADOR';
      if (!isAdmin && team.ownerId !== req.user.id) return res.status(403).json({ error: 'Você não tem permissão para esta ação' });

      const data = {
        ...(req.body.name !== undefined && { name: req.body.name }),
        ...(req.body.description !== undefined && { description: String(req.body.description || '').slice(0, 500) || null }),
        ...(isAdmin ? pickDefaults(req.body) : {}),
      };
      // Política das senhas guardadas nas pastas do grupo (só o admin)
      if (isAdmin && req.body.passwordPolicy !== undefined) {
        const teamFolders = await prisma.folder.findMany({ where: { teamId: team.id }, select: { id: true } });
        try {
          data.passwordPolicy = normalizePolicy(req.body.passwordPolicy, teamFolders.map(f => f.id));
        } catch (e) {
          return res.status(e.status || 400).json({ error: e.message });
        }
        if (data.passwordPolicy === null) data.passwordPolicy = Prisma.DbNull;
      }
      // 2FA obrigatório para os membros do grupo (só o admin)
      if (isAdmin && typeof req.body.require2FA === 'boolean') {
        // Sem prazo, quem liga e é membro sem 2FA ficaria trancado para fora na hora
        if (req.body.require2FA && !team.require2FA && !req.user.totpEnabled) {
          const isMember = await prisma.teamMember.findFirst({ where: { teamId: team.id, userId: req.user.id, status: 'ACTIVE' } });
          const { graceDays } = await getTwoFactorConfig();
          if (isMember && !graceDays) return res.status(400).json({ error: 'Você é membro deste grupo e ainda não usa 2FA. Ative o 2FA no seu perfil antes (ou defina um prazo em Configurações › Segurança).' });
        }
        data.require2FA = req.body.require2FA;
        if (req.body.require2FA && !team.require2FA) data.require2FASince = new Date();
      }
      if (isAdmin && req.body.ownerId && req.body.ownerId !== team.ownerId) {
        const [owner] = await activeUserIds([req.body.ownerId]);
        if (!owner) return res.status(400).json({ error: 'Dono inválido' });
        data.ownerId = owner;
        // O novo dono precisa ser membro ativo
        await prisma.teamMember.upsert({
          where: { teamId_userId: { teamId: team.id, userId: owner } },
          update: { status: 'ACTIVE', respondedAt: new Date() },
          create: { teamId: team.id, userId: owner, status: 'ACTIVE', invitedById: req.user.id, respondedAt: new Date() },
        });
      }

      const updated = await prisma.team.update({ where: { id: team.id }, data });
      await createAuditLog(req.user.id, 'team.update', team.id, 'Team', data, req.ip);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/teams/:id/members/:userId — admin ajusta as permissões de um membro
// ({ canEdit: true|false|null, ... }; null volta ao padrão do grupo)
router.put('/:id/members/:userId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: req.params.id, userId: req.params.userId } },
    });
    if (!member) return res.status(404).json({ error: 'Membro não encontrado' });
    const data = {};
    for (const f of PERM_FIELDS) {
      if (req.body[f] === null || typeof req.body[f] === 'boolean') data[f] = req.body[f];
    }
    const updated = await prisma.teamMember.update({ where: { id: member.id }, data });
    await createAuditLog(req.user.id, 'team.member_permissions', req.params.id, 'Team', { userId: req.params.userId, ...data }, req.ip);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/teams/:id/members — lista membros ACTIVE (qualquer membro/dono/admin vê)
router.get('/:id/members', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'ADMINISTRADOR';
    if (!isAdmin) {
      const me = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: req.params.id, userId: req.user.id } },
      });
      if (!me || me.status !== 'ACTIVE') return res.status(403).json({ error: 'Você não tem permissão para esta ação' });
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId: req.params.id, status: { in: ['ACTIVE', 'PENDING'] } },
      orderBy: { createdAt: 'asc' },
    });
    const userIds = members.map(m => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true, role: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const team = await prisma.team.findUnique({ where: { id: req.params.id } });
    const scopes = new Map((await prisma.roleGroupScope.findMany({ where: { teamId: req.params.id } })).map(sc => [sc.roleKey, sc]));
    res.json(members.map(m => {
      const scope = scopes.get(userMap[m.userId]?.role) || null;
      return {
        ...m, user: userMap[m.userId], isOwner: team?.ownerId === m.userId,
        // Cargo no grupo (Cargos e permissões › Onde vale), se houver
        roleScope: scope ? { folderIds: scope.folderIds, canEdit: scope.canEdit, canDelete: scope.canDelete, canShare: scope.canShare } : null,
        effective: team ? teamMemberPerms(team, m, scope) : null,
      };
    }));
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
    if (!isAdmin && !isOwner && !isSelf) return res.status(403).json({ error: 'Você não tem permissão para esta ação' });
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
    if (team.ownerId !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Você não tem permissão para esta ação' });

    const folderCount = await prisma.folder.count({ where: { teamId: team.id } });
    if (folderCount > 0) {
      return res.status(409).json({ error: `Exclua ou mova as ${folderCount} pasta(s) do grupo antes de excluí-lo` });
    }
    // Pastas do grupo na lixeira seriam apagadas junto (sem volta): pede para decidir antes
    const trashed = await prisma.folder.count({ where: { teamId: team.id, deletedAt: { not: null } } });
    if (trashed > 0) {
      return res.status(409).json({ error: `O grupo tem ${trashed} pasta(s) na Lixeira. Restaure ou exclua de vez na Lixeira antes de excluir o grupo.` });
    }

    await prisma.team.delete({ where: { id: team.id } });
    invalidateRoleScopes();
    await createAuditLog(req.user.id, 'team.delete', team.id, 'Team', { name: team.name }, req.ip);
    res.json({ message: 'Equipe excluída' });
  } catch (err) {
    next(err);
  }
});

export default router;
