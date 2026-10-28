// Lixeira de senhas e pastas.
//
// Excluir = mover para a lixeira (deletedAt). A pasta leva junto as subpastas e
// as senhas que estavam nela (deletedWithFolder = pasta excluída), e restaurar a
// pasta traz tudo de volta. Depois do prazo de Configurações › Dados e retenção
// o item é apagado de vez. As chaves de criptografia ficam guardadas enquanto o
// item está na lixeira, então o conteúdo continua legível ao restaurar.
import { prisma, WITH_DELETED } from '../db.js';
import { createAuditLog } from './audit.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getRetention() {
  const s = await prisma.systemSettings.findUnique({
    where: { id: 'singleton' }, select: { trashRetentionDays: true, auditRetentionDays: true },
  });
  return { trashRetentionDays: s?.trashRetentionDays ?? 30, auditRetentionDays: s?.auditRetentionDays ?? 90 };
}

export async function trashCredential(cred, userId) {
  await prisma.credential.update({
    where: { id: cred.id },
    data: { deletedAt: new Date(), deletedById: userId, deletedWithFolder: null },
  });
}

/** Pasta + subpastas + senhas que estão nelas vão para a lixeira como um item só */
export async function trashFolder(folderId, userId) {
  const ids = [folderId];
  for (let i = 0; i < ids.length; i++) {
    const children = await prisma.folder.findMany({ where: { parentId: ids[i] }, select: { id: true } });
    ids.push(...children.map(c => c.id));
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.folder.update({ where: { id: folderId }, data: { deletedAt: now, deletedById: userId, deletedWithFolder: null } }),
    prisma.folder.updateMany({ where: { id: { in: ids.slice(1) } }, data: { deletedAt: now, deletedById: userId, deletedWithFolder: folderId } }),
    prisma.credential.updateMany({ where: { folderId: { in: ids } }, data: { deletedAt: now, deletedById: userId, deletedWithFolder: folderId } }),
  ]);
  return ids.length;
}

// O que cada pessoa enxerga na lixeira: o admin vê tudo que não é pessoal e a
// própria pasta pessoal; os demais, só o que é da própria pasta pessoal
function visibleFolderFilter(user) {
  return user.role === 'ADMINISTRADOR'
    ? { OR: [{ isPersonal: false }, { ownerId: user.id }] }
    : { isPersonal: true, ownerId: user.id };
}

async function findItem(user, type, id) {
  const where = { id, deletedAt: { not: null }, deletedWithFolder: null };
  if (type === 'folder') return prisma.folder.findFirst({ where: { ...where, ...visibleFolderFilter(user) } });
  if (type === 'credential') {
    const cred = await prisma.credential.findFirst({ where });
    if (!cred) return null;
    const folder = await prisma.folder.findFirst({ where: { ...WITH_DELETED, id: cred.folderId, ...visibleFolderFilter(user) } });
    return folder ? { ...cred, folder } : null;
  }
  return null;
}

/** Itens da lixeira com quem excluiu, quem criou e quem editou por último */
export async function listTrash(user, { type, search } = {}) {
  const retention = await getRetention();
  const term = search?.trim();
  const folderVis = visibleFolderFilter(user);

  const [folders, creds] = await Promise.all([
    type === 'credential' ? [] : prisma.folder.findMany({
      where: { deletedAt: { not: null }, deletedWithFolder: null, ...folderVis, ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}) },
      include: { _count: { select: { credentials: { where: WITH_DELETED } } } },
    }),
    type === 'folder' ? [] : prisma.credential.findMany({
      where: {
        deletedAt: { not: null }, deletedWithFolder: null,
        folder: { is: folderVis },
        ...(term ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { username: { contains: term, mode: 'insensitive' } }, { url: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      select: { id: true, title: true, username: true, url: true, kind: true, folderId: true, deletedAt: true, deletedById: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const credFolders = await prisma.folder.findMany({
    where: { ...WITH_DELETED, id: { in: [...new Set(creds.map(c => c.folderId))] } },
    select: { id: true, name: true, isPersonal: true, deletedAt: true },
  });
  const folderMap = new Map(credFolders.map(f => [f.id, f]));

  // Criação e última edição pela auditoria
  const resourceIds = [...creds.map(c => c.id), ...folders.map(f => f.id)];
  const logs = resourceIds.length ? await prisma.auditLog.findMany({
    where: { resourceId: { in: resourceIds }, action: { in: ['credential.create', 'credential.update', 'credential.import', 'folder.create_corporate', 'folder.create_personal', 'folder.create_team', 'folder.update'] } },
    orderBy: { createdAt: 'asc' },
    select: { resourceId: true, action: true, userId: true, createdAt: true },
  }) : [];
  const created = new Map(), edited = new Map();
  for (const l of logs) {
    if (/create|import/.test(l.action)) { if (!created.has(l.resourceId)) created.set(l.resourceId, l); } else edited.set(l.resourceId, l);
  }

  const userIds = new Set([...folders, ...creds].map(i => i.deletedById).filter(Boolean));
  for (const l of logs) if (l.userId) userIds.add(l.userId);
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, firstName: true, lastName: true, email: true } });
  const userMap = new Map(users.map(u => [u.id, { id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email }]));
  const who = (log) => log ? { user: userMap.get(log.userId) || null, at: log.createdAt } : null;
  const expiresAt = (d) => retention.trashRetentionDays > 0 ? new Date(d.getTime() + retention.trashRetentionDays * DAY_MS) : null;

  const items = [
    ...folders.map(f => ({
      type: 'folder', id: f.id, name: f.name, isPersonal: f.isPersonal, location: f.isPersonal ? 'Pasta pessoal' : (f.visibleToAll ? 'Corporativa' : f.teamId ? 'Grupo' : 'Compartilhada'),
      contains: f._count.credentials, deletedAt: f.deletedAt, deletedBy: userMap.get(f.deletedById) || null,
      created: who(created.get(f.id)), lastEdit: who(edited.get(f.id)), expiresAt: expiresAt(f.deletedAt),
    })),
    ...creds.map(c => {
      const folder = folderMap.get(c.folderId);
      return {
        type: 'credential', id: c.id, name: c.title, username: c.username, url: c.url, kind: c.kind,
        location: folder?.name || '—', folderInTrash: !!folder?.deletedAt, isPersonal: !!folder?.isPersonal,
        deletedAt: c.deletedAt, deletedBy: userMap.get(c.deletedById) || null,
        created: who(created.get(c.id)), // Só edições registradas na auditoria (updatedAt muda também ao excluir)
        lastEdit: who(edited.get(c.id)),
        expiresAt: expiresAt(c.deletedAt),
      };
    }),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  return { items, retentionDays: retention.trashRetentionDays };
}

export async function restoreItem(user, type, id, ip = null) {
  if (type === 'credential') {
    // Senha que foi junto com a pasta volta só com a pasta
    const withFolder = await prisma.credential.findFirst({ where: { id, deletedAt: { not: null }, deletedWithFolder: { not: null } } });
    if (withFolder) {
      const folder = await prisma.folder.findFirst({ where: { ...WITH_DELETED, id: withFolder.deletedWithFolder, ...visibleFolderFilter(user) }, select: { name: true } });
      if (folder) return { ok: false, error: `Esta senha foi excluída junto com a pasta "${folder.name}". Restaure a pasta para trazê-la de volta.` };
    }
  }
  const item = await findItem(user, type, id);
  if (!item) return { ok: false, error: 'Item não está na lixeira ou você não tem acesso' };

  if (type === 'credential') {
    if (item.folder.deletedAt) {
      return { ok: false, error: `A pasta "${item.folder.name}" também está na lixeira. Restaure a pasta primeiro.` };
    }
    await prisma.credential.update({ where: { id }, data: { deletedAt: null, deletedById: null, deletedWithFolder: null } });
    await createAuditLog(user.id, 'trash.restore', id, 'Credential', { title: item.title }, ip);
    return { ok: true };
  }

  // Pasta: se a pasta-mãe foi para a lixeira separadamente, volta para o topo
  const parent = item.parentId ? await prisma.folder.findFirst({ where: { ...WITH_DELETED, id: item.parentId } }) : null;
  const clear = { deletedAt: null, deletedById: null, deletedWithFolder: null };
  await prisma.$transaction([
    prisma.folder.update({ where: { id }, data: { ...clear, ...(parent?.deletedAt ? { parentId: null } : {}) } }),
    prisma.folder.updateMany({ where: { ...WITH_DELETED, deletedWithFolder: id }, data: clear }),
    prisma.credential.updateMany({ where: { ...WITH_DELETED, deletedWithFolder: id }, data: clear }),
  ]);
  await createAuditLog(user.id, 'trash.restore', id, 'Folder', { name: item.name, movedToTop: !!parent?.deletedAt }, ip);
  return { ok: true, movedToTop: !!parent?.deletedAt };
}

// Apaga de vez (sem volta) e limpa o que aponta para o item
async function hardDeleteCredentials(ids) {
  if (!ids.length) return;
  await prisma.$transaction([
    prisma.favorite.deleteMany({ where: { credentialId: { in: ids } } }),
    prisma.credentialHistory.deleteMany({ where: { credentialId: { in: ids } } }),
    prisma.credentialShare.deleteMany({ where: { credentialId: { in: ids } } }),
    prisma.credential.deleteMany({ where: { ...WITH_DELETED, id: { in: ids } } }),
  ]);
}

async function hardDeleteFolder(rootId) {
  return purgeFolderNow(rootId);
}

/** Apaga uma pasta de vez (com subpastas e senhas), esteja ou não na lixeira */
export async function purgeFolderNow(rootId) {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    const children = await prisma.folder.findMany({ where: { ...WITH_DELETED, OR: [{ parentId: ids[i] }, { deletedWithFolder: ids[i] }] }, select: { id: true } });
    for (const c of children) if (!ids.includes(c.id)) ids.push(c.id);
  }
  const creds = await prisma.credential.findMany({ where: { ...WITH_DELETED, folderId: { in: ids } }, select: { id: true } });
  await hardDeleteCredentials(creds.map(c => c.id));
  await prisma.$transaction([
    // Subpastas que tinham ido para a lixeira separadamente perdem a pasta-mãe
    prisma.folder.updateMany({ where: { ...WITH_DELETED, parentId: { in: ids } }, data: { parentId: null } }),
    prisma.accessRequest.deleteMany({ where: { folderId: { in: ids } } }),
    prisma.folder.deleteMany({ where: { ...WITH_DELETED, id: { in: ids } } }),
  ]);
}

export async function purgeItem(user, type, id, { auto = false, ip = null } = {}) {
  const item = auto
    ? (type === 'folder' ? await prisma.folder.findFirst({ where: { id, deletedAt: { not: null } } }) : await prisma.credential.findFirst({ where: { id, deletedAt: { not: null } } }))
    : await findItem(user, type, id);
  if (!item) return { ok: false, error: 'Item não está na lixeira ou você não tem acesso' };
  if (type === 'folder') await hardDeleteFolder(id); else await hardDeleteCredentials([id]);
  if (!auto) {
    await createAuditLog(user.id, 'trash.purge', id, type === 'folder' ? 'Folder' : 'Credential', { name: item.name || item.title }, ip);
  }
  return { ok: true };
}

/** Apaga de vez o que passou do prazo da lixeira (rotina periódica) */
export async function purgeExpiredTrash() {
  const { trashRetentionDays } = await getRetention();
  if (!trashRetentionDays) return 0;
  const before = new Date(Date.now() - trashRetentionDays * DAY_MS);
  const where = { deletedAt: { lt: before }, deletedWithFolder: null };
  const [folders, creds] = await Promise.all([
    prisma.folder.findMany({ where, select: { id: true } }),
    prisma.credential.findMany({ where, select: { id: true } }),
  ]);
  for (const f of folders) await hardDeleteFolder(f.id);
  await hardDeleteCredentials(creds.map(c => c.id));
  const total = folders.length + creds.length;
  if (total) await createAuditLog(null, 'trash.auto_purge', null, 'Vault', { folders: folders.length, credentials: creds.length, retentionDays: trashRetentionDays }, null);
  return total;
}

/** Apaga registros de auditoria mais antigos que a data (fica registrado quem apagou) */
export async function purgeAuditLogs(before, userId = null, reason = 'manual', ip = null) {
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: before } } });
  if (count) await createAuditLog(userId, 'audit.purge', null, 'Audit', { removed: count, before: before.toISOString(), reason }, ip);
  return count;
}

export async function purgeExpiredAudit() {
  const { auditRetentionDays } = await getRetention();
  if (!auditRetentionDays) return 0;
  return purgeAuditLogs(new Date(Date.now() - auditRetentionDays * DAY_MS), null, 'retenção automática');
}
