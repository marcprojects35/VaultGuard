import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PrismaClient } from '@prisma/client';
import { canAccessFolder, canAccessCredential, getAccessibleFolderIds } from '../services/permissions.js';
import { createAuditLog } from '../services/audit.js';
import { notifyAdminAlert, notifyCredentialView } from '../services/notifications.js';

const router = Router();
const prisma = new PrismaClient();

const CREDENTIAL_INCLUDE = {
  folder: { select: { id: true, name: true, color: true } },
  customFields: { orderBy: { sortOrder: 'asc' } },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true }
  },
};

const KINDS = ['login', 'certificate'];
const kindOf = (v) => (KINDS.includes(v) ? v : 'login');

const isEncrypted = (v) => { try { return JSON.parse(v).v === 2; } catch { return false; } };

// GET /api/credentials — list all accessible credentials
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search, folderId, tag, expiry } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    const accessibleFolders = await getAccessibleFolderIds(userId, userRole);

    // folderId vem do cliente: só filtra dentro das pastas que o usuário pode ver
    if (folderId && !accessibleFolders.includes(folderId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Also get individually shared credential IDs
    const sharedItems = await prisma.credentialShare.findMany({
      where: {
        sharedWithId: userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      select: { credentialId: true }
    });
    const sharedIds = sharedItems.map(s => s.credentialId);

    const now = new Date();
    const expiryFilter = expiry === 'expired'
      ? { expiresAt: { not: null, lt: now } }
      : expiry === 'expiring'
      ? { expiresAt: { not: null, lt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), gt: now } }
      : {};

    const where = {
      AND: [
        {
          OR: [
            { folderId: folderId ? folderId : { in: accessibleFolders } },
            ...(sharedIds.length > 0 ? [{ id: { in: sharedIds } }] : [])
          ]
        },
        ...(search ? [{
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
            { url: { contains: search, mode: 'insensitive' } },
            // notas são cifradas no cliente: não entram na busca do servidor
          ]
        }] : []),
        ...(tag ? [{ tags: { has: tag } }] : []),
        ...Object.keys(expiryFilter).length > 0 ? [expiryFilter] : [],
      ]
    };

    const credentials = await prisma.credential.findMany({
      where,
      include: {
        folder: { select: { id: true, name: true, color: true } },
        customFields: { orderBy: { sortOrder: 'asc' } },
        attachments: {
          select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true }
        },
      },
      orderBy: [{ folder: { name: 'asc' } }, { title: 'asc' }]
    });

    const safe = credentials.map(({ encryptedPass, ...c }) => c);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/export — export credentials as CSV (no passwords) — ADMIN only
router.get('/export', authenticate, async (req, res, next) => {
  if (req.user.role !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Acesso restrito a administradores' });
  try {
    const { folderId, search } = req.query;
    const accessibleFolders = await getAccessibleFolderIds(req.user.id, req.user.role);
    if (folderId && !accessibleFolders.includes(folderId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where = {
      folderId: folderId ? folderId : { in: accessibleFolders },
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ]
      }),
    };

    const credentials = await prisma.credential.findMany({
      where,
      include: { folder: { select: { name: true } } },
      orderBy: [{ folder: { name: 'asc' } }, { title: 'asc' }]
    });

    const rows = [['Título', 'Usuário', 'URL', 'Pasta', 'Tags', 'Notas', 'Criado em']];
    credentials.forEach(c => rows.push([
      c.title,
      c.username || '',
      c.url || '',
      c.folder?.name || '',
      (c.tags || []).join('; '),
      // Notas cifradas não saem no CSV (que nunca leva segredos)
      isEncrypted(c.notes) ? '(cifrado)' : (c.notes || '').replace(/\n/g, ' '),
      new Date(c.createdAt).toLocaleString('pt-BR'),
    ]));

    // Prefixo ' neutraliza fórmulas (=, +, -, @) ao abrir no Excel/Sheets
    const cell = (v) => {
      let str = String(v);
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return `"${str.replace(/"/g, '""')}"`;
    };
    const csv = rows.map(r => r.map(cell).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vaultguard-export-${Date.now()}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/vault-export — export ALL credentials including encryptedPass — ADMIN only
router.get('/vault-export', authenticate, async (req, res, next) => {
  if (req.user.role !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Acesso restrito a administradores' });
  try {
    const accessibleFolders = await getAccessibleFolderIds(req.user.id, req.user.role);

    const credentials = await prisma.credential.findMany({
      where: { folderId: { in: accessibleFolders } },
      include: {
        folder: { select: { id: true, name: true } },
        customFields: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ folder: { name: 'asc' } }, { title: 'asc' }]
    });

    await createAuditLog(req.user.id, 'vault.export', null, 'Vault',
      { count: credentials.length }, req.ip);
    notifyAdminAlert('exportação do cofre', `${req.user.email} exportou ${credentials.length} credenciais (IP ${req.ip}).`);

    res.json({ credentials, exportedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/search/by-url (for Chrome extension autofill)
router.get('/search/by-url', authenticate, async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.json([]);

    let hostname;
    try { hostname = normalizeHost(new URL(url).hostname); } catch { return res.json([]); }
    if (!hostname) return res.json([]);
    const accessibleFolders = await getAccessibleFolderIds(req.user.id, req.user.role);

    // O "contains" do banco só pré-filtra; a decisão é por hostname exato ou
    // subdomínio, senão "gle.com" casaria com credenciais de "google.com"
    // accounts.google.com → também procura "google.com" (credencial do domínio pai)
    const labels = hostname.split('.');
    const hostVariants = labels.length > 2
      ? labels.slice(0, -1).map((_, i) => labels.slice(i).join('.')).filter(h => h.includes('.'))
      : [hostname];
    const candidates = await prisma.credential.findMany({
      where: {
        folderId: { in: accessibleFolders },
        OR: hostVariants.map(h => ({ url: { contains: h, mode: 'insensitive' } }))
      },
      include: { folder: { select: { id: true, name: true } } }
    });

    const safe = candidates
      .filter(c => hostMatches(c.url, hostname))
      .map(({ encryptedPass, ...c }) => c);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/:id — get single with encrypted password
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({
      where: { id: req.params.id },
      include: {
        folder: true,
        customFields: { orderBy: { sortOrder: 'asc' } },
        attachments: {
          select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true }
        },
      }
    });

    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    const canAccess = await canAccessCredential(req.user.id, req.user.role, cred);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    // Quem recebeu a credencial por compartilhamento abre com a chave do share
    const share = await prisma.credentialShare.findUnique({
      where: { credentialId_sharedWithId: { credentialId: cred.id, sharedWithId: req.user.id } },
      select: { wrappedKey: true },
    });

    // A extensão informa o motivo. Sempre audita (o cliente não decide se fica
    // rastro); só muda o nome do evento e, na comparação da senha digitada no
    // login com a salva, não dispara o alerta de "credencial acessada"
    const context = ['compare', 'autofill'].includes(req.query.context) ? req.query.context : 'view';
    await createAuditLog(req.user.id, `credential.${context}`, cred.id, 'Credential', { title: cred.title }, req.ip);
    if (context !== 'compare') {
      await prisma.credential.update({ where: { id: cred.id }, data: { lastUsed: new Date() } });
      notifyCredentialView(req.user, cred);
    }

    res.json({ ...cred, shareKey: share?.wrappedKey || null });
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials
router.post('/', authenticate,
  [
    body('title').notEmpty().trim(),
    body('folderId').notEmpty(),
    body('encryptedPass').notEmpty(),
    body('wrappedKey').isString().notEmpty(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { folderId, customFields } = req.body;
      const canEdit = await canAccessFolder(req.user.id, req.user.role, folderId, 'canEdit');
      if (!canEdit) return res.status(403).json({ error: 'No edit permission on this folder' });

      const cred = await prisma.credential.create({
        data: {
          folderId: req.body.folderId,
          title: req.body.title,
          username: req.body.username,
          encryptedPass: req.body.encryptedPass,
          wrappedKey: req.body.wrappedKey,
          url: req.body.url,
          notes: req.body.notes,
          tags: req.body.tags || [],
          kind: kindOf(req.body.kind),
          strength: req.body.strength,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
          ...(customFields?.length > 0 && {
            customFields: {
              create: customFields.map((f, i) => ({
                name: f.name,
                value: f.value,
                fieldType: f.fieldType || 'text',
                sortOrder: i,
              }))
            }
          })
        },
        include: CREDENTIAL_INCLUDE
      });

      await createAuditLog(req.user.id, 'credential.create', cred.id, 'Credential', { title: cred.title }, req.ip);
      const { encryptedPass, ...safe } = cred;
      res.status(201).json(safe);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/credentials/:id
router.put('/:id', authenticate,
  [body('title').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
      if (!cred) return res.status(404).json({ error: 'Not found' });

      // Check permission: own folder or shared with edit
      const canEdit = await canAccessCredential(req.user.id, req.user.role, cred, 'canEdit');
      if (!canEdit) return res.status(403).json({ error: 'No edit permission' });

      const { customFields } = req.body;

      // wrappedKey só é gravado na migração de uma credencial legada; depois disso
      // a chave da credencial não muda (o histórico depende dela)
      const migrating = typeof req.body.wrappedKey === 'string' && req.body.wrappedKey.length > 0;
      if (migrating && cred.wrappedKey) return res.status(409).json({ error: 'Credencial já migrada' });
      if (!migrating && !cred.wrappedKey && req.body.encryptedPass) {
        return res.status(409).json({ error: 'Credencial legada: migre antes de editar a senha' });
      }

      // Save password history before overwriting (na migração o valor é o mesmo, só re-cifrado)
      if (!migrating && req.body.encryptedPass && req.body.encryptedPass !== cred.encryptedPass) {
        await prisma.credentialHistory.create({
          data: {
            credentialId: cred.id,
            encryptedPass: cred.encryptedPass,
            changedById: req.user.id,
          }
        });
        // Keep only last 10 versions
        const history = await prisma.credentialHistory.findMany({
          where: { credentialId: cred.id },
          orderBy: { changedAt: 'desc' },
          select: { id: true }
        });
        if (history.length > 10) {
          const toDelete = history.slice(10).map(h => h.id);
          await prisma.credentialHistory.deleteMany({ where: { id: { in: toDelete } } });
        }
      }

      const updated = await prisma.credential.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.title && { title: req.body.title }),
          ...(req.body.username !== undefined && { username: req.body.username }),
          ...(req.body.encryptedPass && { encryptedPass: req.body.encryptedPass }),
          ...(migrating && { wrappedKey: req.body.wrappedKey }),
          ...(req.body.url !== undefined && { url: req.body.url }),
          ...(req.body.notes !== undefined && { notes: req.body.notes }),
          ...(req.body.tags && { tags: req.body.tags }),
          ...(req.body.kind !== undefined && { kind: kindOf(req.body.kind) }),
          ...(req.body.strength !== undefined && { strength: req.body.strength }),
          ...(req.body.expiresAt !== undefined && {
            expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null
          }),
          ...(customFields !== undefined && {
            customFields: {
              deleteMany: {},
              create: customFields.map((f, i) => ({
                name: f.name,
                value: f.value,
                fieldType: f.fieldType || 'text',
                sortOrder: i,
              }))
            }
          })
        },
        include: CREDENTIAL_INCLUDE
      });

      await createAuditLog(req.user.id, migrating ? 'credential.migrate' : 'credential.update', cred.id, 'Credential', { title: updated.title }, req.ip);
      const { encryptedPass, ...safe } = updated;
      res.json(safe);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/credentials/:id/history — password version history
router.get('/:id/history', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });
    const canAccess = await canAccessCredential(req.user.id, req.user.role, cred);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    const history = await prisma.credentialHistory.findMany({
      where: { credentialId: req.params.id },
      orderBy: { changedAt: 'desc' },
    });

    // Fetch changer names
    const changerIds = [...new Set(history.map(h => h.changedById).filter(Boolean))];
    const changers = changerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: changerIds } },
          select: { id: true, firstName: true, lastName: true }
        })
      : [];
    const changerMap = Object.fromEntries(changers.map(u => [u.id, u]));

    res.json(history.map(h => ({
      id: h.id,
      encryptedPass: h.encryptedPass,
      changedAt: h.changedAt,
      changedBy: h.changedById ? changerMap[h.changedById] : null,
    })));
  } catch (err) {
    next(err);
  }
});

// PUT /api/credentials/:id/history/:historyId — re-cifra uma versão legada (migração)
router.put('/:id/history/:historyId', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });
    const canEdit = await canAccessCredential(req.user.id, req.user.role, cred, 'canEdit');
    if (!canEdit) return res.status(403).json({ error: 'No edit permission' });

    const entry = await prisma.credentialHistory.findUnique({ where: { id: req.params.historyId } });
    if (!entry || entry.credentialId !== cred.id) return res.status(404).json({ error: 'Not found' });
    let version;
    try { version = JSON.parse(entry.encryptedPass).v; } catch { version = undefined; }
    if (version === 2) return res.status(409).json({ error: 'Versão já migrada' });
    if (typeof req.body.encryptedPass !== 'string' || !req.body.encryptedPass) {
      return res.status(400).json({ error: 'encryptedPass required' });
    }

    await prisma.credentialHistory.update({ where: { id: entry.id }, data: { encryptedPass: req.body.encryptedPass } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/credentials/:id/shares
router.get('/:id/shares', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });
    const canAccess = await canAccessCredential(req.user.id, req.user.role, cred);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    const shares = await prisma.credentialShare.findMany({
      where: { credentialId: req.params.id }
    });

    const userIds = [...new Set([...shares.map(s => s.sharedWithId), ...shares.map(s => s.sharedById)])];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true }
        })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    res.json(shares.map(s => ({
      ...s,
      sharedWith: userMap[s.sharedWithId],
      sharedBy: userMap[s.sharedById],
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials/:id/shares
router.post('/:id/shares', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });
    const canShare = await canAccessFolder(req.user.id, req.user.role, cred.folderId, 'canShare');
    if (!canShare) return res.status(403).json({ error: 'No share permission' });

    const { sharedWithId, canEdit, expiresAt, wrappedKey } = req.body;
    if (!sharedWithId) return res.status(400).json({ error: 'sharedWithId required' });

    const targetUser = await prisma.user.findUnique({ where: { id: sharedWithId } });
    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });
    if (!cred.wrappedKey) return res.status(409).json({ error: 'Credencial legada: abra-a no cofre para migrar antes de compartilhar' });
    if (!targetUser.publicKey) return res.status(409).json({ error: 'O usuário ainda não ativou as chaves (precisa entrar no cofre uma vez)' });
    if (typeof wrappedKey !== 'string' || !wrappedKey) return res.status(400).json({ error: 'wrappedKey required' });

    const share = await prisma.credentialShare.upsert({
      where: { credentialId_sharedWithId: { credentialId: req.params.id, sharedWithId } },
      update: { canEdit: canEdit ?? false, expiresAt: expiresAt ? new Date(expiresAt) : null, wrappedKey },
      create: {
        credentialId: req.params.id,
        sharedById: req.user.id,
        sharedWithId,
        canEdit: canEdit ?? false,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        wrappedKey,
      }
    });

    await createAuditLog(req.user.id, 'credential.share', cred.id, 'Credential',
      { title: cred.title, sharedWith: targetUser.email }, req.ip);
    res.status(201).json(share);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/credentials/:id/shares/:shareId
router.delete('/:id/shares/:shareId', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });
    const canShare = await canAccessFolder(req.user.id, req.user.role, cred.folderId, 'canShare');
    if (!canShare) return res.status(403).json({ error: 'No share permission' });

    const share = await prisma.credentialShare.findUnique({ where: { id: req.params.shareId } });
    if (!share || share.credentialId !== cred.id) return res.status(404).json({ error: 'Share not found' });

    await prisma.credentialShare.delete({ where: { id: share.id } });
    await createAuditLog(req.user.id, 'credential.unshare', cred.id, 'Credential',
      { title: cred.title, sharedWithId: share.sharedWithId }, req.ip);
    res.json({ message: 'Share removed' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/credentials/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.id } });
    if (!cred) return res.status(404).json({ error: 'Not found' });

    const canDel = await canAccessFolder(req.user.id, req.user.role, cred.folderId, 'canDelete');
    if (!canDel) return res.status(403).json({ error: 'No delete permission' });

    await prisma.credential.delete({ where: { id: req.params.id } });
    await createAuditLog(req.user.id, 'credential.delete', cred.id, 'Credential', { title: cred.title }, req.ip);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials/import — bulk import from CSV — ADMIN only
router.post('/import', authenticate, async (req, res, next) => {
  if (req.user.role !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Acesso restrito a administradores' });
  try {
    const { rows, folderId } = req.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No rows to import' });
    }

    const canEdit = await canAccessFolder(req.user.id, req.user.role, folderId, 'canEdit');
    if (!canEdit) return res.status(403).json({ error: 'No edit permission on this folder' });

    const created = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.title) { errors.push({ row: i + 1, error: 'Título obrigatório' }); continue; }
      // Só aceita conteúdo já cifrado no cliente
      if (typeof row.wrappedKey !== 'string' || !row.wrappedKey) { errors.push({ row: i + 1, error: 'Linha sem chave de criptografia' }); continue; }

      try {
        const cred = await prisma.credential.create({
          data: {
            folderId,
            title: row.title,
            username: row.username || null,
            encryptedPass: row.encryptedPass || '',
            wrappedKey: row.wrappedKey,
            url: row.url || null,
            notes: row.notes || null,
            tags: Array.isArray(row.tags)
              ? row.tags.map(t => String(t).trim()).filter(Boolean)
              : (row.tags ? String(row.tags).split(';').map(t => t.trim()).filter(Boolean) : []),
            strength: 0,
            kind: kindOf(row.kind),
            ...(row.customFields?.length > 0 && {
              customFields: {
                create: row.customFields.map((f, i) => ({
                  name: f.name, value: f.value,
                  fieldType: f.fieldType || 'text', sortOrder: i,
                }))
              }
            })
          }
        });
        created.push(cred.id);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }

    await createAuditLog(req.user.id, 'credential.import', null, 'Credential',
      { count: created.length, folderId }, req.ip);

    res.json({ imported: created.length, errors });
  } catch (err) {
    next(err);
  }
});

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

// Hostname da credencial igual ao do site, ou um é subdomínio do outro
function hostMatches(credUrl, siteHost) {
  if (!credUrl) return false;
  let credHost;
  try {
    credHost = normalizeHost(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(credUrl) ? credUrl : `https://${credUrl}`).hostname);
  } catch {
    return false;
  }
  if (!credHost) return false;
  return credHost === siteHost || siteHost.endsWith('.' + credHost) || credHost.endsWith('.' + siteHost);
}


export default router;
