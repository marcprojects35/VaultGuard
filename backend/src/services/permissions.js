import { prisma } from '../db.js';


const NONE = { canView: false, canEdit: false, canDelete: false, canShare: false };
const ALL = { canView: true, canEdit: true, canDelete: true, canShare: true };

// Capacidades do cargo (Configurações > Cargos). Cache curto: são lidas em toda
// checagem de permissão; invalidateRoleCaps() é chamado quando o admin altera.
export const ROLE_CAPS = ['canEdit', 'canDelete', 'canShare', 'canCreateTeams', 'canExport', 'canImport', 'canUseApiTokens'];
let capsCache = null;
let capsAt = 0;
export function invalidateRoleCaps() { capsCache = null; }
export async function getRoleCaps(roleKey) {
  if (roleKey === 'ADMINISTRADOR') return Object.fromEntries(ROLE_CAPS.map(c => [c, true]));
  if (!capsCache || Date.now() - capsAt > 30000) {
    const roles = await prisma.role.findMany({ select: { key: true, ...Object.fromEntries(ROLE_CAPS.map(c => [c, true])) } });
    capsCache = Object.fromEntries(roles.map(r => [r.key, r]));
    capsAt = Date.now();
  }
  // Cargo desconhecido: nada além de ver
  return capsCache[roleKey] || Object.fromEntries(ROLE_CAPS.map(c => [c, false]));
}

/** Middleware: exige uma capacidade do cargo (ex.: canExport) */
export function requireCap(cap, message) {
  return async (req, res, next) => {
    try {
      if ((await getRoleCaps(req.user.role))[cap]) return next();
      res.status(403).json({ error: message || 'Seu cargo não tem permissão para esta ação', code: 'ROLE_FORBIDDEN' });
    } catch (err) { next(err); }
  };
}

/** Permissões do membro nas pastas do grupo: dono tem todas; os demais seguem o padrão do grupo ou o ajuste individual */
export function teamMemberPerms(team, member) {
  if (team.ownerId === member.userId) return { ...ALL };
  return {
    canView: true,
    canEdit: member.canEdit ?? team.memberCanEdit,
    canDelete: member.canDelete ?? team.memberCanDelete,
    canShare: member.canShare ?? team.memberCanShare,
  };
}

/** Permissões efetivas na pasta (sem o teto do cargo) */
async function rawFolderPermissions(userId, userRole, folder) {
  if (!folder) return { ...NONE };
  // Dono de pasta pessoal sempre tem acesso total à própria pasta —
  // pastas pessoais nunca têm FolderPermission cadastrada.
  if (folder.isPersonal) return folder.ownerId === userId ? { ...ALL, personal: true } : { ...NONE };
  if (userRole === 'ADMINISTRADOR') return { ...ALL };
  // Pasta corporativa: todo mundo vê; editar/excluir/compartilhar só com
  // permissão explícita (cargo ou usuário) definida pelo admin em Pastas
  let result = folder.visibleToAll ? { ...NONE, canView: true } : { ...NONE };
  if (folder.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: folder.teamId, userId } },
    });
    if (membership?.status === 'ACTIVE') {
      const team = await prisma.team.findUnique({
        where: { id: folder.teamId },
        select: { ownerId: true, memberCanEdit: true, memberCanDelete: true, memberCanShare: true },
      });
      if (team) result = teamMemberPerms(team, membership);
    }
  }

  // Permissão explícita na pasta: a do usuário prevalece sobre a do cargo
  const perm = await prisma.folderPermission.findFirst({ where: { folderId: folder.id, userId } })
    || await prisma.folderPermission.findFirst({ where: { folderId: folder.id, role: userRole } });
  if (perm) {
    // Grupo e permissão explícita somam
    for (const k of ['canView', 'canEdit', 'canDelete', 'canShare']) result[k] = result[k] || perm[k] === true;
  }
  return result;
}

/**
 * Permissões do usuário na pasta, já limitadas pelo cargo
 * (ex.: Auxiliar pode editar mas não excluir em nenhuma pasta compartilhada)
 */
export async function getUserPermissionsForFolder(userId, userRole, folderId) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, isPersonal: true, ownerId: true, teamId: true, visibleToAll: true },
  });
  const raw = await rawFolderPermissions(userId, userRole, folder);
  if (raw.personal) return { ...ALL };
  const caps = await getRoleCaps(userRole);
  return {
    canView: raw.canView,
    canEdit: raw.canEdit && caps.canEdit,
    canDelete: raw.canDelete && caps.canDelete,
    canShare: raw.canShare && caps.canShare,
  };
}

/**
 * Check if a user can access a folder with the given permission level
 * @param {'canView'|'canEdit'|'canDelete'|'canShare'} level
 */
export async function canAccessFolder(userId, userRole, folderId, level = 'canView') {
  return (await getUserPermissionsForFolder(userId, userRole, folderId))[level] === true;
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
  // Check individual share (view only, or edit if canEdit); editar segue o teto do cargo
  if (permission === 'canEdit' && !(await getRoleCaps(userRole)).canEdit) return false;
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

/**
 * Permissões do usuário em cada credencial da lista (para a interface esconder
 * editar/excluir/compartilhar). Calcula uma vez por pasta.
 */
export async function attachCredentialPermissions(user, credentials) {
  const byFolder = new Map();
  for (const folderId of new Set(credentials.map(c => c.folderId))) {
    byFolder.set(folderId, await getUserPermissionsForFolder(user.id, user.role, folderId));
  }
  const viaShare = credentials.filter(c => !byFolder.get(c.folderId)?.canView).map(c => c.id);
  const shares = viaShare.length ? await prisma.credentialShare.findMany({
    where: { credentialId: { in: viaShare }, sharedWithId: user.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { credentialId: true, canEdit: true },
  }) : [];
  const shareMap = new Map(shares.map(s => [s.credentialId, s]));
  const caps = await getRoleCaps(user.role);
  return credentials.map(c => {
    const folderPerms = byFolder.get(c.folderId);
    if (folderPerms?.canView) return { ...c, myPermissions: folderPerms };
    const share = shareMap.get(c.id);
    return { ...c, myPermissions: { canView: !!share, canEdit: !!share?.canEdit && caps.canEdit, canDelete: false, canShare: false } };
  });
}
