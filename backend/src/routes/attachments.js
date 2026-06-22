import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import { canAccessFolder } from '../services/permissions.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const prisma = new PrismaClient();

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// GET /api/attachments/:credentialId — list attachments (metadata only)
router.get('/:credentialId', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.credentialId } });
    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    const canAccess = await canAccessFolder(req.user.id, req.user.role, cred.folderId);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    const attachments = await prisma.attachment.findMany({
      where: { credentialId: req.params.credentialId },
      select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });

    res.json(attachments);
  } catch (err) {
    next(err);
  }
});

// POST /api/attachments/:credentialId — upload attachment (base64 in body)
router.post('/:credentialId', authenticate, async (req, res, next) => {
  try {
    const cred = await prisma.credential.findUnique({ where: { id: req.params.credentialId } });
    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    const canEdit = await canAccessFolder(req.user.id, req.user.role, cred.folderId, 'canEdit');
    if (!canEdit) return res.status(403).json({ error: 'No edit permission' });

    const { fileName, mimeType, data } = req.body;
    if (!fileName || !data) return res.status(400).json({ error: 'fileName and data are required' });

    // data is base64 string
    const sizeBytes = Math.ceil((data.length * 3) / 4);
    if (sizeBytes > MAX_SIZE_BYTES) {
      return res.status(413).json({ error: 'File too large (max 5 MB)' });
    }

    const attachment = await prisma.attachment.create({
      data: {
        credentialId: req.params.credentialId,
        fileName,
        mimeType: mimeType || 'application/octet-stream',
        size: sizeBytes,
        data,
      },
      select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true }
    });

    await createAuditLog(req.user.id, 'attachment.upload', attachment.id, 'Attachment',
      { fileName, credentialId: cred.id }, req.ip);

    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
});

// GET /api/attachments/:credentialId/:attachmentId/download — download (returns base64 data)
router.get('/:credentialId/:attachmentId/download', authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { credential: true }
    });

    if (!attachment || attachment.credentialId !== req.params.credentialId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const canAccess = await canAccessFolder(req.user.id, req.user.role, attachment.credential.folderId);
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    await createAuditLog(req.user.id, 'attachment.download', attachment.id, 'Attachment',
      { fileName: attachment.fileName }, req.ip);

    res.json({ data: attachment.data, fileName: attachment.fileName, mimeType: attachment.mimeType });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/attachments/:credentialId/:attachmentId
router.delete('/:credentialId/:attachmentId', authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { credential: true }
    });

    if (!attachment || attachment.credentialId !== req.params.credentialId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const canEdit = await canAccessFolder(req.user.id, req.user.role, attachment.credential.folderId, 'canEdit');
    if (!canEdit) return res.status(403).json({ error: 'No edit permission' });

    await prisma.attachment.delete({ where: { id: req.params.attachmentId } });
    await createAuditLog(req.user.id, 'attachment.delete', attachment.id, 'Attachment',
      { fileName: attachment.fileName }, req.ip);

    res.json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
