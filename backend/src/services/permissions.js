import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLE_HIERARCHY = {
  AUXILIAR: 0,
  ASSISTENTE: 1,
  ANALISTA: 2,
  COORDENACAO: 3,
  DIRETORIA: 4,
  ADMINISTRADOR: 5,
};

/**
 * Check if a user can access a folder with the given permission level
 * @param {string} userId
 * @param {string} userRole
 * @param {string} folderId
 * @param {'canView'|'canEdit'|'canDelete'|'canShare'} level
 */
export async function canAccessFolder(userId, userRole, folderId, level = 'canView') {
  if (userRole === 'ADMINISTRADOR') return true;

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
