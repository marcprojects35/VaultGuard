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
      settings = await prisma.systemSettings.create({
        data: { id: 'singleton' }
      });
    }
    // Don't expose smtpConfig publicly
    const { smtpConfig, ...safe } = settings;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings — admin only
router.put('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      'siteName', 'siteSubtitle', 'primaryColor', 'accentColor',
      'bgColor', 'surfaceColor', 'defaultLanguage', 'allowSelfReg',
      'require2FA', 'sessionTimeout', 'maxLoginAttempts', 'passwordPolicy'
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
