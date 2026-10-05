import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import { invalidateSecuritySettings, isIpAllowed } from '../services/securitySettings.js';
import { sendEmail, getGraphToken } from '../services/email.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Mesmo diretório servido em /uploads pelo server.js (e montado como volume)
const uploadDir = path.join(__dirname, '../../uploads');

// Remove segredos (SMTP, senha da conta de serviço do AD) e a whitelist de
// IPs (mapa da rede interna) antes de responder
function publicSettings(settings) {
  const { smtpConfig, ldapConfig, ...safe } = settings;
  if (safe.passwordPolicy) {
    const { allowedIPs, ...policy } = safe.passwordPolicy;
    safe.passwordPolicy = policy;
  }
  return safe;
}

const HEX_COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i;

// GET /api/settings — public (for branding)
router.get('/', async (req, res, next) => {
  try {
    let settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: { id: 'singleton' } });
    }
    const safe = publicSettings(settings);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings — admin only (generic)
router.put('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Só aparência: segurança tem rota própria com validação (/security)
    const data = {};
    for (const key of ['primaryColor', 'accentColor', 'bgColor', 'surfaceColor']) {
      if (req.body[key] === undefined) continue;
      if (req.body[key] !== '' && !HEX_COLOR.test(String(req.body[key]))) return res.status(400).json({ error: `Cor inválida: ${key}` });
      data[key] = String(req.body[key]);
    }
    if (req.body.themeMode !== undefined) {
      if (!['dark', 'light'].includes(req.body.themeMode)) return res.status(400).json({ error: 'Tema inválido' });
      data.themeMode = req.body.themeMode;
    }
    for (const key of ['siteName', 'siteSubtitle']) {
      if (req.body[key] !== undefined) data[key] = String(req.body[key]).slice(0, 100);
    }

    const settings = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data }
    });

    invalidateSecuritySettings();
    const safe = publicSettings(settings);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/general — general settings
router.put('/general', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const data = {};
    for (const key of ['siteName', 'siteSubtitle', 'defaultLanguage']) {
      if (req.body[key] !== undefined) data[key] = String(req.body[key]).slice(0, 100);
    }
    if (req.body.supportEmail !== undefined) {
      const email = String(req.body.supportEmail || '').trim();
      if (email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return res.status(400).json({ error: 'E-mail de suporte inválido' });
      data.supportEmail = email || null;
    }
    if (req.body.sessionTimeout !== undefined) {
      // Minutos; valor inválido quebraria a emissão do JWT
      const n = parseInt(req.body.sessionTimeout, 10);
      if (!Number.isInteger(n) || n < 5 || n > 10080) return res.status(400).json({ error: 'Tempo de sessão deve ficar entre 5 e 10080 minutos' });
      data.sessionTimeout = n;
    }

    const settings = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data }
    });

    invalidateSecuritySettings();
    const safe = publicSettings(settings);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/security — política completa (inclui a whitelist de IPs)
router.get('/security', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const s = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    res.json({ require2FA: s?.require2FA ?? false, maxLoginAttempts: s?.maxLoginAttempts ?? 5, passwordPolicy: s?.passwordPolicy || {} });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/security — security settings
router.put('/security', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Campos não enviados mantêm o valor salvo
    const current = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.passwordPolicy || {};
    const pick = (bodyKey, policyKey, fallback) =>
      req.body[bodyKey] !== undefined ? req.body[bodyKey] : (current[policyKey] ?? fallback);
    const int = (v, min, max) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

    const passwordPolicy = {
      minLength: int(pick('minPasswordLength', 'minLength', 10), 6, 128),
      requireUppercase: !!pick('requireUppercase', 'requireUppercase', true),
      requireNumbers: !!pick('requireNumbers', 'requireNumbers', true),
      requireSymbols: !!pick('requireSymbols', 'requireSymbols', true),
      expireDays: int(pick('passwordExpireDays', 'expireDays', 0), 0, 3650),
      preventReuse: int(pick('preventPasswordReuse', 'preventReuse', 5), 0, 24),
      lockoutDurationMin: int(pick('lockoutDurationMin', 'lockoutDurationMin', 15), 1, 1440),
      logFailedLogins: !!pick('logFailedLogins', 'logFailedLogins', true),
      alertOnNewDevice: !!pick('alertOnNewDevice', 'alertOnNewDevice', true),
      allow2FARecovery: !!pick('allow2FARecovery', 'allow2FARecovery', true),
      allowedIPs: String(pick('allowedIPs', 'allowedIPs', '') || ''),
    };
    for (const [k, v] of Object.entries(passwordPolicy)) {
      if (v === null) return res.status(400).json({ error: `Valor inválido: ${k}` });
    }

    // Whitelist: formato válido e sem trancar o próprio admin para fora
    const rules = passwordPolicy.allowedIPs.split(/[\n,]/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
    const isV4 = (r) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(r) && r.split('/')[0].split('.').every(n => Number(n) <= 255) && (!r.includes('/') || Number(r.split('/')[1]) <= 32);
    const isV6 = (r) => r.includes(':') && /^[0-9a-f:]+$/i.test(r);
    const badRule = rules.find(r => !isV4(r) && !isV6(r));
    if (badRule) return res.status(400).json({ error: `IP/CIDR inválido: ${badRule}` });
    if (!isIpAllowed(req.ip, rules)) {
      return res.status(400).json({ error: `Seu IP atual (${req.ip}) não está na lista: você perderia o acesso` });
    }

    const data = { passwordPolicy };
    if (req.body.maxLoginAttempts !== undefined) {
      const n = parseInt(req.body.maxLoginAttempts, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) return res.status(400).json({ error: 'maxLoginAttempts inválido' });
      data.maxLoginAttempts = n;
    }
    if (req.body.require2FA !== undefined) {
      // Sem isso o próprio admin ficaria preso fora do painel ao salvar
      if (req.body.require2FA && !req.user.totpEnabled) {
        return res.status(400).json({ error: 'Ative o 2FA na sua conta antes de exigi-lo de todos.' });
      }
      data.require2FA = !!req.body.require2FA;
    }

    const settings = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data }
    });

    invalidateSecuritySettings();
    const safe = publicSettings(settings);
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/email — load saved SMTP config (password masked)
router.get('/email', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const cfg = settings?.smtpConfig || {};
    // Mask SMTP password
    const smtp = cfg.smtp ? { ...cfg.smtp, password: cfg.smtp.password ? '••••••••' : '' } : {};
    res.json({
      emailEnabled: cfg.enabled ?? true,
      provider: cfg.provider ?? 'smtp',
      smtp,
      fromName: cfg.fromName ?? '',
      fromEmail: cfg.fromEmail ?? '',
      ...(cfg.notifications || {}),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/email — SMTP / email settings
router.put('/email', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Senha mascarada na tela = manter a salva
    const current = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.smtpConfig;
    const smtp = req.body.smtp ? { ...req.body.smtp } : undefined;
    if (smtp && smtp.password === '••••••••') {
      const sameServer = current?.smtp?.host === smtp.host && (current?.smtp?.user || '') === (smtp.user || '');
      if (!sameServer) return res.status(400).json({ error: 'Ao trocar servidor ou usuário SMTP, informe a senha novamente' });
      smtp.password = current.smtp.password;
    }
    const smtpConfig = {
      // Credenciais do Microsoft 365 são gravadas só pelo /office365/authorize
      ...(current?.office365 && { office365: current.office365 }),
      enabled: req.body.emailEnabled ?? true,
      provider: req.body.provider ?? 'smtp',
      smtp,
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

// POST /api/settings/email/test — envia um e-mail de teste para o próprio admin
// usando a configuração salva
router.post('/email/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const to = typeof req.body?.to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.to) ? req.body.to : req.user.email;
    await sendEmail({
      to,
      subject: '[VaultGuard] E-mail de teste',
      text: 'Se você recebeu esta mensagem, o envio de e-mails do VaultGuard está funcionando.',
      html: '<p>Se você recebeu esta mensagem, o envio de e-mails do VaultGuard está funcionando.</p>',
      throwOnError: true,
    });
    res.json({ success: true, message: `E-mail de teste enviado para ${to}` });
  } catch (err) {
    res.status(400).json({ success: false, error: `Falha no envio: ${err.message}` });
  }
});

// GET /api/settings/email/office365/status
router.get('/email/office365/status', authenticate, requireAdmin, async (req, res) => {
  const cfg = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.smtpConfig || {};
  const o = cfg.office365;
  res.json({ connected: !!o?.clientSecret, email: cfg.fromEmail || null, tenantId: o?.tenantId || null, clientId: o?.clientId || null, connectedAt: o?.connectedAt || null });
});

// POST /api/settings/email/office365/authorize — valida o app do Azure (client
// credentials) obtendo um token e guarda as credenciais. Não há redirect: o
// app usa permissão de aplicativo Mail.Send com consentimento do admin.
router.post('/email/office365/authorize', authenticate, requireAdmin, async (req, res) => {
  const { tenantId, clientId, clientSecret } = req.body || {};
  const guid = /^[0-9a-f-]{36}$/i;
  if (!guid.test(String(tenantId || '')) && !/^[a-z0-9.-]+$/i.test(String(tenantId || ''))) return res.status(400).json({ error: 'Tenant ID inválido' });
  if (!guid.test(String(clientId || ''))) return res.status(400).json({ error: 'Client ID inválido' });
  if (!clientSecret) return res.status(400).json({ error: 'Client Secret obrigatório' });
  try {
    await getGraphToken({ tenantId, clientId, clientSecret }, { force: true });
  } catch (err) {
    return res.status(400).json({ error: `Microsoft recusou as credenciais: ${err.message}` });
  }
  const current = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.smtpConfig || {};
  const smtpConfig = { ...current, provider: 'office365', office365: { tenantId, clientId, clientSecret, connectedAt: new Date().toISOString() } };
  await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: { smtpConfig }, create: { id: 'singleton', smtpConfig } });
  await createAuditLog(req.user.id, 'settings.office365_connected', null, null, { tenantId, clientId }, req.ip);
  res.json({ connected: true });
});

// DELETE /api/settings/email/office365/revoke
router.delete('/email/office365/revoke', authenticate, requireAdmin, async (req, res) => {
  const current = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.smtpConfig || {};
  const { office365, ...rest } = current;
  await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { smtpConfig: rest } });
  await createAuditLog(req.user.id, 'settings.office365_revoked', null, null, null, req.ip);
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
