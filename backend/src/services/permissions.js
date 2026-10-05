import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Check if a user can access a folder with the given permission level
 * @param {string} userId
 * @param {string} userRole
 * @param {string} folderId
 * @param {'canView'|'canEdit'|'canDelete'|'canShare'} level
 */
export async function canAccessFolder(userId, userRole, folderId, level = 'canView') {
  // Dono de pasta pessoal sempre tem acesso total à própria pasta —
  // pastas pessoais nunca têm FolderPermission cadastrada.
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { isPersonal: true, ownerId: true, teamId: true, visibleToAll: true }
  });
  if (folder?.isPersonal && folder.ownerId === userId) return true;
  // Pasta pessoal de outra pessoa: ninguém vê o conteúdo, nem o admin
  // (o admin ainda pode renomear/excluir a pasta pelas rotas de pastas)
  if (folder?.isPersonal) return false;

  if (userRole === 'ADMINISTRADOR') return true;

  // Pasta corporativa: todo mundo vê; só admin edita/apaga/compartilha
  // (admin já retornou true acima, então aqui só sobra o canView).
  if (folder?.visibleToAll) return level === 'canView';

  // Pasta de equipe: membro ACTIVE vê/edita; excluir/compartilhar só o dono do time.
  if (folder?.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: folder.teamId, userId } }
    });
    if (membership?.status === 'ACTIVE') {
      if (level === 'canView' || level === 'canEdit') return true;
      const team = await prisma.team.findUnique({ where: { id: folder.teamId }, select: { ownerId: true } });
      return team?.ownerId === userId;
    }
  }

  // Check user-specific permission first
  const userPerm = await prisma.folderPermission.findFirst({
    where: { folderId, userId }
  });

  if (userPerm) return userPerm[level] === true;

  // Check role-based permission
  const rolePerm = await prisma.folderPermission.findFirst({
    where: { folderId, role: userRole }
  });

  if (rolePerm) return rolePerm[level] === true;

  return false;
}

export async function getUserPermissionsForFolder(userId, userRole, folderId) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { isPersonal: true, ownerId: true, teamId: true, visibleToAll: true }
  });
  if (folder?.isPersonal && folder.ownerId === userId) {
    return { canView: true, canEdit: true, canDelete: true, canShare: true };
  }
  if (folder?.isPersonal) {
    return { canView: false, canEdit: false, canDelete: false, canShare: false };
  }

  if (userRole === 'ADMINISTRADOR') {
    return { canView: true, canEdit: true, canDelete: true, canShare: true };
  }

  if (folder?.visibleToAll) {
    return { canView: true, canEdit: false, canDelete: false, canShare: false };
  }

  if (folder?.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: folder.teamId, userId } }
    });
    if (membership?.status === 'ACTIVE') {
      const team = await prisma.team.findUnique({ where: { id: folder.teamId }, select: { ownerId: true } });
      const isTeamOwner = team?.ownerId === userId;
      return { canView: true, canEdit: true, canDelete: isTeamOwner, canShare: isTeamOwner };
    }
  }

  const userPerm = await prisma.folderPermission.findFirst({
    where: { folderId, userId }
  });
  if (userPerm) return userPerm;

  const rolePerm = await prisma.folderPermission.findFirst({
    where: { folderId, role: userRole }
  });
  if (rolePerm) return rolePerm;

  return { canView: false, canEdit: false, canDelete: false, canShare: false };
}

export async function getAccessibleFolderIds(userId, userRole) {
  if (userRole === 'ADMINISTRADOR') {
    const all = await prisma.folder.findMany({
      where: { OR: [{ isPersonal: false }, { ownerId: userId }] },
      select: { id: true },
    });
    return all.map(f => f.id);
  }

  // Shared folders via permissions. Como em canAccessFolder, a permissão do
  // usuário prevalece sobre a do cargo (inclusive para negar).
  const allPerms = await prisma.folderPermission.findMany({
    where: { OR: [{ userId }, { role: userRole }] },
    select: { folderId: true, userId: true, canView: true }
  });
  const denied = new Set(allPerms.filter(p => p.userId === userId && !p.canView).map(p => p.folderId));
  const personalIds = new Set((await prisma.folder.findMany({
    where: { id: { in: allPerms.map(p => p.folderId) }, isPersonal: true }, select: { id: true },
  })).map(f => f.id));
  const perms = allPerms.filter(p => p.canView && !personalIds.has(p.folderId) && !(p.userId !== userId && denied.has(p.folderId)));

  // Personal folders owned by this user
  const personal = await prisma.folder.findMany({
    where: { isPersonal: true, ownerId: userId },
    select: { id: true }
  });

  // Pastas corporativas (visíveis a todos) e pastas das equipes ativas do usuário
  const memberships = await prisma.teamMember.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { teamId: true }
  });
  const teamIds = memberships.map(m => m.teamId);
  const visible = await prisma.folder.findMany({
    where: {
      OR: [
        { visibleToAll: true },
        ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
      ]
    },
    select: { id: true }
  });

  const ids = new Set([
    ...perms.map(p => p.folderId),
    ...personal.map(f => f.id),
    ...visible.map(f => f.id),
  ]);
  return [...ids];
}

/** Acesso à credencial pela pasta ou por compartilhamento individual válido. */
export async function canAccessCredential(userId, userRole, cred, permission = 'canView') {
  // Check folder-level access (já trata admin e pastas pessoais)
  const folderAccess = await canAccessFolder(userId, userRole, cred.folderId, permission);
  if (folderAccess) return true;
  // Check individual share (view only, or edit if canEdit)
  if (permission === 'canView' || permission === 'canEdit') {
    const share = await prisma.credentialShare.findFirst({
      where: {
        credentialId: cred.id,
        sharedWithId: userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(permission === 'canEdit' ? { canEdit: true } : {})
      }
    });
    return !!share;
  }
  return false;
}
