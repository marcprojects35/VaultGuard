import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const uploadDir = path.join(__dirname, '../../../uploads');

// GET /api/settings — public (for branding)
router.get('/', async (req, res, next) => {
  try {
    let settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: { id: 'singleton' } });
    }
    const { smtpConfig, ...safe } = settings;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings — admin only (generic)
router.put('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      'siteName', 'siteSubtitle', 'primaryColor', 'accentColor',
      'bgColor', 'surfaceColor', 'defaultLanguage', 'allowSelfReg',
      'require2FA', 'sessionTimeout', 'maxLoginAttempts', 'passwordPolicy',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    const settings = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data }
    });

    const { smtpConfig, ...safe } = settings;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/general — general settings
router.put('/general', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const data = {};
    const allowed = ['siteName', 'siteSubtitle', 'defaultLanguage', 'allowSelfReg', 'sessionTimeout'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    const settings = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data }
    });

    const { smtpConfig, ...safe } = settings;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/security — security settings
router.put('/security', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const passwordPolicy = {
      minLength: req.body.minPasswordLength ?? 10,
      requireUppercase: req.body.requireUppercase ?? true,
      requireNumbers: req.body.requireNumbers ?? true,
      requireSymbols: req.body.requireSymbols ?? true,
      expireDays: req.body.passwordExpireDays ?? 90,
      preventReuse: req.body.preventPasswordReuse ?? 5,
      lockoutDurationMin: req.body.lockoutDurationMin ?? 15,
      logFailedLogins: req.body.logFailedLogins ?? true,
      alertOnNewDevice: req.body.alertOnNewDevice ?? true,
      allowedIPs: req.body.allowedIPs ?? '',
    };

    const data = { passwordPolicy };
    if (req.body.maxLoginAttempts !== undefined) data.maxLoginAttempts = req.body.maxLoginAttempts;
    if (req.body.require2FA !== undefined) data.require2FA = req.body.require2FA;

    const settings = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data }
    });

    const { smtpConfig, ...safe } = settings;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/email — SMTP / email settings
router.put('/email', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const smtpConfig = {
      enabled: req.body.emailEnabled ?? true,
      provider: req.body.provider ?? 'smtp',
      smtp: req.body.smtp,
      fromName: req.body.fromName,
      fromEmail: req.body.fromEmail,
      notifications: {
        notifyNewUser: req.body.notifyNewUser ?? true,
        notifyPasswordReset: req.body.notifyPasswordReset ?? true,
        notifyFailedLogin: req.body.notifyFailedLogin ?? false,
        notifyNewDevice: req.body.notifyNewDevice ?? true,
        notifyAdminAlert: req.body.notifyAdminAlert ?? true,
        notifyCredentialView: req.body.notifyCredentialView ?? false,
      }
    };

    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: { smtpConfig },
      create: { id: 'singleton', smtpConfig }
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/email/test — test SMTP (stub)
router.post('/email/test', authenticate, requireAdmin, async (req, res) => {
  res.json({ success: true, message: 'Teste de e-mail enfileirado. Configure SMTP para envio real.' });
});

// GET /api/settings/email/office365/status
router.get('/email/office365/status', authenticate, requireAdmin, async (req, res) => {
  res.json({ connected: false });
});

// POST /api/settings/email/office365/authorize
router.post('/email/office365/authorize', authenticate, requireAdmin, async (req, res) => {
  res.status(501).json({ error: 'Integração Office 365 OAuth não configurada nesta instalação.' });
});

// DELETE /api/settings/email/office365/revoke
router.delete('/email/office365/revoke', authenticate, requireAdmin, async (req, res) => {
  res.json({ success: true });
});

// POST /api/settings/logo — upload logo
router.post('/logo', authenticate, requireAdmin, upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    await fs.mkdir(uploadDir, { recursive: true });
    const filename = `logo-${Date.now()}.webp`;
    const filepath = path.join(uploadDir, filename);

    await sharp(req.file.buffer)
      .resize(400, 120, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toFile(filepath);

    const logoUrl = `/uploads/${filename}`;
    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: { logoUrl },
      create: { id: 'singleton', logoUrl }
    });

    res.json({ logoUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/favicon
router.post('/favicon', authenticate, requireAdmin, upload.single('favicon'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    await fs.mkdir(uploadDir, { recursive: true });
    const filename = `favicon-${Date.now()}.webp`;
    const filepath = path.join(uploadDir, filename);

    await sharp(req.file.buffer)
      .resize(64, 64, { fit: 'cover' })
      .webp({ quality: 90 })
      .toFile(filepath);

    const faviconUrl = `/uploads/${filename}`;
    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: { faviconUrl },
      create: { id: 'singleton', faviconUrl }
    });

    res.json({ faviconUrl });
  } catch (err) {
    next(err);
  }
});

export default router;
