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
  if (userRole === 'ADMINISTRADOR') return true;

  // Dono de pasta pessoal sempre tem acesso total à própria pasta —
  // pastas pessoais nunca têm FolderPermission cadastrada.
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { isPersonal: true, ownerId: true, teamId: true, visibleToAll: true }
  });
  if (folder?.isPersonal && folder.ownerId === userId) return true;

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
  if (userRole === 'ADMINISTRADOR') {
    return { canView: true, canEdit: true, canDelete: true, canShare: true };
  }

  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { isPersonal: true, ownerId: true, teamId: true, visibleToAll: true }
  });
  if (folder?.isPersonal && folder.ownerId === userId) {
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
