import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { canAccessFolder, getAccessibleFolderIds } from '../services/permissions.js';
import { ORG_HOLDER, getFolderAudiences, getHeldFolderIds, wipeUserKeys } from '../services/keys.js';
import { verifyUserPassword } from '../services/passwordCheck.js';
import { createAuditLog } from '../services/audit.js';
import { notifyAdminAlert } from '../services/notifications.js';

// O servidor só guarda e repassa material cifrado no cliente. Ele não consegue
// conferir se uma chave embrulhada está correta; garante apenas quem pode
// gravar e quem pode ler cada uma.

const router = Router();
const prisma = new PrismaClient();

const MAX_KEY_LEN = 8192;
const isKeyString = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_KEY_LEN;

// Token de API (extensão) só lê chaves
router.use(authenticate, (req, res, next) => {
  if (req.isApiToken && req.method !== 'GET') {
    return res.status(403).json({ error: 'API tokens cannot change keys' });
  }
  next();
});

const isAdmin = (user) => user.role === 'ADMINISTRADOR';

// GET /api/keys/me — material de chave do usuário logado
router.get('/me', async (req, res, next) => {
  try {
    const [orgKey, grant] = await Promise.all([
      prisma.orgKey.findUnique({ where: { id: 'singleton' } }),
      isAdmin(req.user) ? prisma.orgKeyGrant.findUnique({ where: { userId: req.user.id } }) : null,
    ]);
    res.json({
      userId: req.user.id,
      isAdmin: isAdmin(req.user),
      encryptionSalt: req.user.encryptionSalt,
      publicKey: req.user.publicKey,
      encryptedPrivateKey: req.user.encryptedPrivateKey,
      orgPublicKey: orgKey?.publicKey || null,
      orgWrappedKey: grant?.wrappedKey || null,
    });
  } catch (err) { next(err); }
});

// PUT /api/keys/me — registra o par de chaves (só na primeira vez)
router.put('/me', async (req, res, next) => {
  try {
    const { publicKey, encryptedPrivateKey } = req.body;
    if (!isKeyString(publicKey) || !isKeyString(encryptedPrivateKey)) {
      return res.status(400).json({ error: 'publicKey e encryptedPrivateKey obrigatórios' });
    }
    const updated = await prisma.user.updateMany({
      where: { id: req.user.id, publicKey: null },
      data: { publicKey, encryptedPrivateKey },
    });
    if (updated.count === 0) return res.status(409).json({ error: 'Chaves já registradas' });
    await createAuditLog(req.user.id, 'keys.created', null, null, null, req.ip);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/keys/me/private — re-cifra a chave privada (senha nova). Exige a senha atual.
router.put('/me/private', async (req, res, next) => {
  try {
    const { encryptedPrivateKey, password } = req.body;
    if (!isKeyString(encryptedPrivateKey)) return res.status(400).json({ error: 'encryptedPrivateKey obrigatório' });
    if (!req.user.publicKey) return res.status(409).json({ error: 'Usuário ainda não tem chaves' });
    if (!(await verifyUserPassword(req.user, password))) return res.status(400).json({ error: 'Senha incorreta' });
    await prisma.user.update({ where: { id: req.user.id }, data: { encryptedPrivateKey } });
    await createAuditLog(req.user.id, 'keys.rewrapped', null, null, null, req.ip);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/keys/me/reset — descarta as chaves (perde a pasta pessoal) e registra novas
router.post('/me/reset', async (req, res, next) => {
  try {
    const { publicKey, encryptedPrivateKey, password } = req.body;
    if (!isKeyString(publicKey) || !isKeyString(encryptedPrivateKey)) {
      return res.status(400).json({ error: 'publicKey e encryptedPrivateKey obrigatórios' });
    }
    if (!(await verifyUserPassword(req.user, password))) return res.status(400).json({ error: 'Senha incorreta' });
    await wipeUserKeys(req.user.id);
    await prisma.user.update({ where: { id: req.user.id }, data: { publicKey, encryptedPrivateKey } });
    await createAuditLog(req.user.id, 'keys.reset', null, null, null, req.ip);
    notifyAdminAlert('chaves de usuário descartadas', `${req.user.email} gerou chaves novas (conteúdo da pasta pessoal perdido).`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/keys/org — primeiro admin cria a chave da organização
router.post('/org', async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    if (!req.user.publicKey) return res.status(409).json({ error: 'Registre suas chaves antes' });
    const { publicKey, wrappedKey } = req.body;
    if (!isKeyString(publicKey) || !isKeyString(wrappedKey)) return res.status(400).json({ error: 'publicKey e wrappedKey obrigatórios' });

    await prisma.$transaction(async (tx) => {
      const existing = await tx.orgKey.findUnique({ where: { id: 'singleton' } });
      if (existing) {
        const e = new Error('Chave da organização já existe'); e.status = 409; throw e;
      }
      await tx.orgKey.create({ data: { id: 'singleton', publicKey } });
      await tx.orgKeyGrant.create({ data: { userId: req.user.id, wrappedKey, grantedById: req.user.id } });
    });
    await createAuditLog(req.user.id, 'keys.org_created', null, null, null, req.ip);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/keys/users/:id/public — chave pública (para compartilhar uma credencial)
router.get('/users/:id/public', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, publicKey: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ userId: user.id, publicKey: user.publicKey });
  } catch (err) { next(err); }
});

// GET /api/keys/folders — chaves (embrulhadas) das pastas acessíveis
router.get('/folders', async (req, res, next) => {
  try {
    const accessible = await getAccessibleFolderIds(req.user.id, req.user.role);
    const [folders, keys, grant] = await Promise.all([
      prisma.folder.findMany({ where: { id: { in: accessible } }, select: { id: true, isPersonal: true, keyInitialized: true } }),
      prisma.folderKey.findMany({ where: { folderId: { in: accessible }, holder: { in: [req.user.id, ORG_HOLDER] } } }),
      isAdmin(req.user) ? prisma.orgKeyGrant.findUnique({ where: { userId: req.user.id } }) : null,
    ]);
    const mine = new Map(keys.filter(k => k.holder === req.user.id).map(k => [k.folderId, k.wrappedKey]));
    const org = new Map(keys.filter(k => k.holder === ORG_HOLDER).map(k => [k.folderId, k.wrappedKey]));

    res.json(folders.map(f => {
      if (mine.has(f.id)) return { folderId: f.id, isPersonal: f.isPersonal, initialized: f.keyInitialized, via: 'user', wrappedKey: mine.get(f.id) };
      if (grant && org.has(f.id)) return { folderId: f.id, isPersonal: f.isPersonal, initialized: f.keyInitialized, via: 'org', wrappedKey: org.get(f.id) };
      return { folderId: f.id, isPersonal: f.isPersonal, initialized: f.keyInitialized, via: null, wrappedKey: null };
    }));
  } catch (err) { next(err); }
});

// POST /api/keys/folders/:id/init — gera a chave da pasta (uma única vez)
router.post('/folders/:id/init', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findUnique({ where: { id: req.params.id } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    if (!(await canAccessFolder(req.user.id, req.user.role, folder.id, 'canView'))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // Pasta pessoal: só o dono gera, e a chave não vai para a organização
    if (folder.isPersonal && folder.ownerId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const { wrappedKey, orgWrappedKey } = req.body;
    if (!isKeyString(wrappedKey)) return res.status(400).json({ error: 'wrappedKey obrigatório' });
    if (!req.user.publicKey) return res.status(409).json({ error: 'Registre suas chaves antes' });

    let orgCopy = null;
    if (!folder.isPersonal) {
      const orgKey = await prisma.orgKey.findUnique({ where: { id: 'singleton' } });
      if (!orgKey) return res.status(409).json({ error: 'Aguardando um administrador ativar a criptografia da organização' });
      if (!isKeyString(orgWrappedKey)) return res.status(400).json({ error: 'orgWrappedKey obrigatório' });
      orgCopy = orgWrappedKey;
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.folder.updateMany({
        where: { id: folder.id, keyInitialized: false },
        data: { keyInitialized: true },
      });
      if (claimed.count === 0) {
        const e = new Error('A pasta já tem chave'); e.status = 409; throw e;
      }
      await tx.folderKey.deleteMany({ where: { folderId: folder.id } });
      await tx.folderKey.create({ data: { folderId: folder.id, holder: req.user.id, wrappedKey, grantedById: req.user.id } });
      if (orgCopy) {
        await tx.folderKey.create({ data: { folderId: folder.id, holder: ORG_HOLDER, wrappedKey: orgCopy, grantedById: req.user.id } });
      }
    });
    await createAuditLog(req.user.id, 'keys.folder_init', folder.id, 'Folder', { name: folder.name }, req.ip);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/keys/pending — o que este cliente consegue (e deve) distribuir
router.get('/pending', async (req, res, next) => {
  try {
    const me = req.user;
    const [orgKey, myGrant] = await Promise.all([
      prisma.orgKey.findUnique({ where: { id: 'singleton' } }),
      isAdmin(me) ? prisma.orgKeyGrant.findUnique({ where: { userId: me.id } }) : null,
    ]);

    // 1. Pastas acessíveis ainda sem chave (o cliente gera)
    const accessible = await getAccessibleFolderIds(me.id, me.role);
    const uninitialized = await prisma.folder.findMany({
      where: {
        id: { in: accessible }, keyInitialized: false,
        OR: [{ isPersonal: true, ownerId: me.id }, ...(orgKey ? [{ isPersonal: false }] : [])],
      },
      select: { id: true, isPersonal: true },
    });

    // 2. Cópias de chave de pasta faltando para quem tem acesso
    const held = [...await getHeldFolderIds(me)];
    const folderGrants = [];
    if (held.length) {
      const [audiences, existing, folders, withKeys] = await Promise.all([
        getFolderAudiences(held),
        prisma.folderKey.findMany({ where: { folderId: { in: held } }, select: { folderId: true, holder: true } }),
        prisma.folder.findMany({ where: { id: { in: held } }, select: { id: true, isPersonal: true } }),
        prisma.user.findMany({ where: { status: 'ACTIVE', publicKey: { not: null } }, select: { id: true, publicKey: true } }),
      ]);
      const pub = new Map(withKeys.map(u => [u.id, u.publicKey]));
      const has = new Set(existing.map(k => `${k.folderId}:${k.holder}`));
      for (const f of folders) {
        const targets = [];
        for (const uid of audiences.get(f.id) || []) {
          if (!has.has(`${f.id}:${uid}`) && pub.has(uid)) targets.push({ holder: uid, publicKey: pub.get(uid) });
        }
        if (!f.isPersonal && orgKey && !has.has(`${f.id}:${ORG_HOLDER}`)) {
          targets.push({ holder: ORG_HOLDER, publicKey: orgKey.publicKey });
        }
        if (targets.length) folderGrants.push({ folderId: f.id, targets });
      }
    }

    // 3. Admins sem acesso à chave da organização
    let orgGrants = [];
    if (myGrant) {
      const [admins, grants] = await Promise.all([
        prisma.user.findMany({ where: { role: 'ADMINISTRADOR', status: 'ACTIVE', publicKey: { not: null } }, select: { id: true, publicKey: true } }),
        prisma.orgKeyGrant.findMany({ select: { userId: true } }),
      ]);
      const granted = new Set(grants.map(g => g.userId));
      orgGrants = admins.filter(a => !granted.has(a.id)).map(a => ({ userId: a.id, publicKey: a.publicKey }));
    }

    // 4. Compartilhamentos individuais sem chave (destinatário trocou de chaves)
    let shareGrants = [];
    if (held.length) {
      const shares = await prisma.credentialShare.findMany({
        where: { wrappedKey: null },
        select: { id: true, credentialId: true, sharedWithId: true },
      });
      if (shares.length) {
        const creds = await prisma.credential.findMany({
          where: { id: { in: shares.map(s => s.credentialId) }, folderId: { in: held }, wrappedKey: { not: null } },
          select: { id: true, folderId: true, wrappedKey: true },
        });
        const credMap = new Map(creds.map(c => [c.id, c]));
        const recipients = await prisma.user.findMany({
          where: { id: { in: shares.map(s => s.sharedWithId) }, status: 'ACTIVE', publicKey: { not: null } },
          select: { id: true, publicKey: true },
        });
        const pub = new Map(recipients.map(u => [u.id, u.publicKey]));
        shareGrants = shares
          .filter(s => credMap.has(s.credentialId) && pub.has(s.sharedWithId))
          .map(s => ({
            shareId: s.id,
            credentialId: s.credentialId,
            folderId: credMap.get(s.credentialId).folderId,
            credentialWrappedKey: credMap.get(s.credentialId).wrappedKey,
            publicKey: pub.get(s.sharedWithId),
          }));
      }
    }

    // 5. Pastas que precisam de chave nova (alguém perdeu acesso)
    const rotations = [];
    if (held.length) {
      const folders = await prisma.folder.findMany({
        where: { id: { in: held }, needsKeyRotation: true },
        select: { id: true, isPersonal: true },
      });
      for (const f of folders) {
        if (!(await canAccessFolder(me.id, me.role, f.id, 'canEdit'))) continue;
        const [credentials, audience] = await Promise.all([
          prisma.credential.findMany({ where: { folderId: f.id, wrappedKey: { not: null } }, select: { id: true, wrappedKey: true } }),
          getFolderAudiences([f.id]).then(m => m.get(f.id) || new Set()),
        ]);
        rotations.push({
          folderId: f.id,
          credentials,
          targets: await rotationTargets(f, audience, me, orgKey),
        });
      }
    }

    res.json({ uninitialized, folderGrants, orgGrants, shareGrants, rotations });
  } catch (err) { next(err); }
});

// Quem recebe a chave nova numa rotação: a audiência atual com chaves,
// o próprio cliente (se não for admin usando a cópia da organização) e "ORG"
async function rotationTargets(folder, audience, me, orgKey) {
  const ids = new Set(audience);
  if (me.role !== 'ADMINISTRADOR' || folder.isPersonal) ids.add(me.id);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, status: 'ACTIVE', publicKey: { not: null } },
    select: { id: true, publicKey: true },
  });
  const targets = users.map(u => ({ holder: u.id, publicKey: u.publicKey }));
  if (!folder.isPersonal && orgKey) targets.push({ holder: ORG_HOLDER, publicKey: orgKey.publicKey });
  return targets;
}

// POST /api/keys/folders/:id/rotate — troca a chave da pasta: re-embrulha a
// chave de cada credencial e entrega a chave nova a quem ainda tem acesso
router.post('/folders/:id/rotate', async (req, res, next) => {
  try {
    const me = req.user;
    const folder = await prisma.folder.findUnique({ where: { id: req.params.id } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    if (!folder.needsKeyRotation) return res.status(409).json({ error: 'A pasta não precisa de rotação' });
    if (!(await getHeldFolderIds(me)).has(folder.id)) return res.status(403).json({ error: 'Access denied' });
    // Re-embrulhar as chaves das credenciais pode destruí-las: só quem edita a pasta
    if (!(await canAccessFolder(me.id, me.role, folder.id, 'canEdit'))) {
      return res.status(403).json({ error: 'Só quem edita a pasta pode rotacionar a chave' });
    }

    const { credentialKeys = [], folderKeys = [] } = req.body;
    if (!Array.isArray(credentialKeys) || !Array.isArray(folderKeys) || !folderKeys.length) {
      return res.status(400).json({ error: 'Formato inválido' });
    }
    if (![...credentialKeys, ...folderKeys].every(k => isKeyString(k.wrappedKey))) {
      return res.status(400).json({ error: 'Chave inválida' });
    }

    const orgKey = await prisma.orgKey.findUnique({ where: { id: 'singleton' } });
    const audience = (await getFolderAudiences([folder.id])).get(folder.id) || new Set();
    const allowed = new Set((await rotationTargets(folder, audience, me, orgKey)).map(t => t.holder));
    const rows = folderKeys.filter(k => allowed.has(k.holder));
    // Ninguém pode ficar sem acesso: precisa ir para quem roda e (se houver) para a organização
    const mustHave = [...allowed].filter(h => h === ORG_HOLDER || h === me.id);
    if (!mustHave.every(h => rows.some(r => r.holder === h))) {
      return res.status(400).json({ error: 'A chave nova precisa incluir você e a organização' });
    }

    await prisma.$transaction(async (tx) => {
      const creds = await tx.credential.findMany({ where: { folderId: folder.id, wrappedKey: { not: null } }, select: { id: true } });
      const sent = new Set(credentialKeys.map(k => k.id));
      if (creds.length !== sent.size || !creds.every(c => sent.has(c.id))) {
        const e = new Error('As credenciais da pasta mudaram durante a rotação; tente de novo'); e.status = 409; throw e;
      }
      for (const k of credentialKeys) {
        await tx.credential.update({ where: { id: k.id }, data: { wrappedKey: k.wrappedKey } });
      }
      await tx.folderKey.deleteMany({ where: { folderId: folder.id } });
      await tx.folderKey.createMany({
        data: rows.map(r => ({ folderId: folder.id, holder: r.holder, wrappedKey: r.wrappedKey, grantedById: me.id })),
      });
      await tx.folder.update({ where: { id: folder.id }, data: { needsKeyRotation: false } });
    });
    await createAuditLog(me.id, 'keys.folder_rotated', folder.id, 'Folder', { name: folder.name, credentials: credentialKeys.length }, req.ip);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/keys/grants — grava as cópias embrulhadas pelo cliente
router.post('/grants', async (req, res, next) => {
  try {
    const me = req.user;
    const { folderKeys = [], orgKeys = [], shareKeys = [] } = req.body;
    if (![folderKeys, orgKeys, shareKeys].every(Array.isArray)) return res.status(400).json({ error: 'Formato inválido' });
    if (folderKeys.length + orgKeys.length + shareKeys.length > 2000) return res.status(400).json({ error: 'Lote grande demais' });

    let created = 0;

    if (folderKeys.length) {
      const held = await getHeldFolderIds(me);
      const folderIds = [...new Set(folderKeys.map(k => k.folderId))].filter(id => held.has(id));
      const [audiences, folders, orgKey] = await Promise.all([
        getFolderAudiences(folderIds),
        prisma.folder.findMany({ where: { id: { in: folderIds } }, select: { id: true, isPersonal: true } }),
        prisma.orgKey.findUnique({ where: { id: 'singleton' } }),
      ]);
      const personal = new Map(folders.map(f => [f.id, f.isPersonal]));
      const rows = folderKeys
        .filter(k => held.has(k.folderId) && isKeyString(k.wrappedKey))
        .filter(k => k.holder === ORG_HOLDER
          ? (orgKey && personal.get(k.folderId) === false)
          : audiences.get(k.folderId)?.has(k.holder))
        .map(k => ({ folderId: k.folderId, holder: k.holder, wrappedKey: k.wrappedKey, grantedById: me.id }));
      if (rows.length) created += (await prisma.folderKey.createMany({ data: rows, skipDuplicates: true })).count;
    }

    if (orgKeys.length) {
      const myGrant = isAdmin(me) ? await prisma.orgKeyGrant.findUnique({ where: { userId: me.id } }) : null;
      if (myGrant) {
        const admins = new Set((await prisma.user.findMany({
          where: { role: 'ADMINISTRADOR', status: 'ACTIVE', publicKey: { not: null } }, select: { id: true },
        })).map(u => u.id));
        const rows = orgKeys
          .filter(k => admins.has(k.userId) && isKeyString(k.wrappedKey))
          .map(k => ({ userId: k.userId, wrappedKey: k.wrappedKey, grantedById: me.id }));
        if (rows.length) created += (await prisma.orgKeyGrant.createMany({ data: rows, skipDuplicates: true })).count;
      }
    }

    if (shareKeys.length) {
      const held = await getHeldFolderIds(me);
      for (const k of shareKeys) {
        if (!isKeyString(k.wrappedKey)) continue;
        const share = await prisma.credentialShare.findUnique({ where: { id: k.shareId } });
        if (!share || share.wrappedKey) continue;
        const cred = await prisma.credential.findUnique({ where: { id: share.credentialId }, select: { folderId: true } });
        if (!cred || !held.has(cred.folderId)) continue;
        const r = await prisma.credentialShare.updateMany({ where: { id: share.id, wrappedKey: null }, data: { wrappedKey: k.wrappedKey } });
        created += r.count;
      }
    }

    if (created) await createAuditLog(me.id, 'keys.granted', null, null, { count: created }, req.ip);
    res.json({ created });
  } catch (err) { next(err); }
});

export default router;
