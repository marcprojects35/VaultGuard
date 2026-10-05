import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const ORG_HOLDER = 'ORG';

/**
 * Usuários (não administradores) que podem ver cada pasta, espelhando a ordem
 * de canAccessFolder. Administradores não entram: eles abrem as pastas não
 * pessoais pela chave da organização.
 * Retorna Map<folderId, Set<userId>>.
 */
export async function getFolderAudiences(folderIds) {
  const [folders, users, perms, memberships] = await Promise.all([
    prisma.folder.findMany({
      where: folderIds ? { id: { in: folderIds } } : {},
      select: { id: true, isPersonal: true, ownerId: true, teamId: true, visibleToAll: true },
    }),
    prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, role: true } }),
    prisma.folderPermission.findMany({
      where: folderIds ? { folderId: { in: folderIds } } : {},
      select: { folderId: true, userId: true, role: true, canView: true },
    }),
    prisma.teamMember.findMany({ where: { status: 'ACTIVE' }, select: { teamId: true, userId: true } }),
  ]);

  const teamMembers = new Map();
  for (const m of memberships) {
    if (!teamMembers.has(m.teamId)) teamMembers.set(m.teamId, new Set());
    teamMembers.get(m.teamId).add(m.userId);
  }
  const permsByFolder = new Map();
  for (const p of perms) {
    if (!permsByFolder.has(p.folderId)) permsByFolder.set(p.folderId, []);
    permsByFolder.get(p.folderId).push(p);
  }
  const activeIds = new Set(users.map(u => u.id));

  const result = new Map();
  for (const f of folders) {
    const audience = new Set();
    if (f.isPersonal) {
      if (f.ownerId && activeIds.has(f.ownerId)) audience.add(f.ownerId);
      result.set(f.id, audience);
      continue;
    }
    const fPerms = permsByFolder.get(f.id) || [];
    const members = f.teamId ? (teamMembers.get(f.teamId) || new Set()) : new Set();
    for (const u of users) {
      if (u.role === 'ADMINISTRADOR') continue;
      if (f.visibleToAll || members.has(u.id)) { audience.add(u.id); continue; }
      const userPerm = fPerms.find(p => p.userId === u.id);
      if (userPerm) { if (userPerm.canView) audience.add(u.id); continue; }
      const rolePerm = fPerms.find(p => p.role === u.role);
      if (rolePerm?.canView) audience.add(u.id);
    }
    result.set(f.id, audience);
  }
  return result;
}

/**
 * Ids das pastas cuja chave o usuário consegue abrir: as que têm cópia para
 * ele, mais (se for admin com acesso à chave da organização) as que têm cópia "ORG".
 */
export async function getHeldFolderIds(user) {
  const own = await prisma.folderKey.findMany({ where: { holder: user.id }, select: { folderId: true } });
  const ids = new Set(own.map(k => k.folderId));
  if (user.role === 'ADMINISTRADOR') {
    const grant = await prisma.orgKeyGrant.findUnique({ where: { userId: user.id } });
    if (grant) {
      const org = await prisma.folderKey.findMany({ where: { holder: ORG_HOLDER }, select: { folderId: true } });
      org.forEach(k => ids.add(k.folderId));
    }
  }
  return ids;
}

/**
 * Remove cópias de chave de quem perdeu acesso às pastas. Quem já baixou a
 * chave pode tê-la em memória; para revogar de fato é preciso rotacionar.
 */
export async function pruneFolderKeys(folderIds) {
  const audiences = await getFolderAudiences(folderIds);
  const keys = await prisma.folderKey.findMany({
    where: { holder: { not: ORG_HOLDER }, ...(folderIds ? { folderId: { in: folderIds } } : {}) },
    select: { id: true, folderId: true, holder: true },
  });
  const stale = keys.filter(k => !audiences.get(k.folderId)?.has(k.holder));
  // Admin dono de pasta pessoal está na audiência; admins em pastas não pessoais
  // usam a chave da organização, então a cópia própria (da criação) é mantida
  const admins = new Set((await prisma.user.findMany({
    where: { role: 'ADMINISTRADOR', status: 'ACTIVE' }, select: { id: true },
  })).map(u => u.id));
  const removed = stale.filter(k => !admins.has(k.holder));
  if (removed.length) {
    await prisma.folderKey.deleteMany({ where: { id: { in: removed.map(k => k.id) } } });
    // Quem saiu pode ter guardado a chave: a próxima pessoa com acesso gera outra
    await markForRotation([...new Set(removed.map(k => k.folderId))]);
  }
  return removed.length;
}

/**
 * Descarta todo o material de chave de um usuário (reset de senha pelo admin).
 * Pastas compartilhadas voltam a ser liberadas automaticamente por quem tem a
 * chave; pastas pessoais não têm cópia e ficam ilegíveis.
 */
export async function markForRotation(folderIds) {
  if (!folderIds.length) return;
  await prisma.folder.updateMany({ where: { id: { in: folderIds }, keyInitialized: true }, data: { needsKeyRotation: true } });
}

export async function wipeUserKeys(userId) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { publicKey: null, encryptedPrivateKey: null } }),
    prisma.folderKey.deleteMany({ where: { holder: userId } }),
    prisma.orgKeyGrant.deleteMany({ where: { userId } }),
    prisma.credentialShare.updateMany({ where: { sharedWithId: userId }, data: { wrappedKey: null } }),
    // A pasta pessoal ganha chave nova no próximo login; o conteúdo antigo fica ilegível
    prisma.folder.updateMany({ where: { isPersonal: true, ownerId: userId }, data: { keyInitialized: false } }),
  ]);
}
