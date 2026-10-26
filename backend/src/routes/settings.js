import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { invalidateSecuritySettings, isIpAllowed } from '../services/securitySettings.js';
import { sendEmail, getGraphToken } from '../services/email.js';
import { createAuditLog } from '../services/audit.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Aceita #rgb ou #rrggbb e grava sempre #rrggbb minúsculo: o frontend monta
// variações da cor a partir desse formato
function normalizeColor(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return '#' + hex.toLowerCase();
}

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
      if (req.body[key] === '' || req.body[key] === null) {
        // Fundo e superfície vazios = cores do tema; as cores da marca são obrigatórias
        if (key === 'primaryColor' || key === 'accentColor') return res.status(400).json({ error: `Informe a cor: ${key}` });
        data[key] = '';
        continue;
      }
      const color = normalizeColor(req.body[key]);
      if (!color) return res.status(400).json({ error: `Cor inválida em ${key}. Use o formato #RRGGBB.` });
      data[key] = color;
    }
    if (req.body.themeMode !== undefined) {
      if (!['dark', 'light'].includes(req.body.themeMode)) return res.status(400).json({ error: 'Tema inválido' });
      data.themeMode = req.body.themeMode;
    }
    for (const key of ['siteName', 'siteSubtitle']) {
      if (req.body[key] !== undefined) data[key] = String(req.body[key] ?? '').trim().slice(0, 100);
    }
    if (data.siteName === '') return res.status(400).json({ error: 'Informe o nome do sistema' });
    if (req.body.loginMessage !== undefined) data.loginMessage = String(req.body.loginMessage ?? '').trim().slice(0, 300) || null;
    if (req.body.loginOverlay !== undefined) {
      const n = Number(req.body.loginOverlay);
      if (!Number.isFinite(n) || n < 0 || n > 90) return res.status(400).json({ error: 'Escurecimento do fundo deve ficar entre 0 e 90%' });
      data.loginOverlay = Math.round(n);
    }
    if (req.body.appOverlay !== undefined) {
      const n = Number(req.body.appOverlay);
      if (!Number.isFinite(n) || n < 0 || n > 95) return res.status(400).json({ error: 'Cobertura do fundo da aplicação deve ficar entre 0 e 95%' });
      data.appOverlay = Math.round(n);
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

// ── Imagens da marca (logo, favicon e fundo da tela de login) ──
// Toda imagem é reprocessada pelo sharp (nunca servimos o arquivo enviado como
// veio), o que também descarta SVG com script e metadados como GPS de fotos.
const MAX_UPLOAD_MB = 10;
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

const IMAGE_KINDS = {
  logo: {
    field: 'logoUrl',
    process: (img) => img.resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }),
    ext: 'webp',
  },
  favicon: {
    field: 'faviconUrl',
    process: (img) => img.resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png(),
    ext: 'png',
    allowIco: true,
  },
  'login-background': {
    field: 'loginBackgroundUrl',
    process: (img) => img.rotate().resize(2560, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }),
    ext: 'webp',
  },
  'app-background': {
    field: 'appBackgroundUrl',
    process: (img) => img.rotate().resize(2560, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }),
    ext: 'webp',
  },
};

// Arquivo .ico (o sharp não lê esse formato): cabeçalho 00 00 01 00 + quantidade de imagens
const isIco = (buf) => buf.length > 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1 && buf.readUInt16LE(4) > 0;

// Apaga o arquivo anterior — só nomes gerados aqui, nunca um caminho arbitrário vindo do banco
async function removeUpload(url) {
  const m = /^\/uploads\/((?:logo|favicon|login-background|app-background)-[\w-]+\.(?:webp|png|ico))$/.exec(url || '');
  if (m) await fs.unlink(path.join(uploadDir, m[1])).catch(() => {});
}

function receiveImage(fieldName) {
  return (req, res, next) => imageUpload.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Arquivo muito grande. O limite é ${MAX_UPLOAD_MB} MB.` });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Envie um único arquivo no campo "${fieldName}"` });
    next(err);
  });
}

for (const [kind, cfg] of Object.entries(IMAGE_KINDS)) {
  // Campo do formulário: 'logo', 'favicon' ou 'image' (aceito em todos)
  const fieldName = kind.endsWith('-background') ? 'image' : kind;

  router.post(`/${kind}`, authenticate, requireAdmin, receiveImage(fieldName), async (req, res, next) => {
    try {
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

      let output, ext = cfg.ext;
      if (cfg.allowIco && isIco(req.file.buffer)) {
        if (req.file.buffer.length > 1024 * 1024) return res.status(413).json({ error: 'Arquivo .ico muito grande (máximo 1 MB)' });
        output = req.file.buffer;
        ext = 'ico';
      } else {
        try {
          output = await cfg.process(sharp(req.file.buffer, { animated: false })).toBuffer();
        } catch {
          return res.status(400).json({ error: 'Imagem inválida ou formato não suportado. Use PNG, JPG, WEBP, GIF ou SVG.' });
        }
      }

      await fs.mkdir(uploadDir, { recursive: true });
      const filename = `${kind}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      await fs.writeFile(path.join(uploadDir, filename), output);

      const url = `/uploads/${filename}`;
      const previous = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
      await prisma.systemSettings.upsert({
        where: { id: 'singleton' },
        update: { [cfg.field]: url },
        create: { id: 'singleton', [cfg.field]: url },
      });
      await removeUpload(previous?.[cfg.field]);
      await createAuditLog(req.user.id, 'settings.branding_updated', null, null, { image: kind }, req.ip);

      res.json({ [cfg.field]: url });
    } catch (err) {
      next(err);
    }
  });

  // Volta à imagem padrão
  router.delete(`/${kind}`, authenticate, requireAdmin, async (req, res, next) => {
    try {
      const previous = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
      await prisma.systemSettings.upsert({
        where: { id: 'singleton' },
        update: { [cfg.field]: null },
        create: { id: 'singleton' },
      });
      await removeUpload(previous?.[cfg.field]);
      await createAuditLog(req.user.id, 'settings.branding_updated', null, null, { image: kind, removed: true }, req.ip);
      res.json({ [cfg.field]: null });
    } catch (err) {
      next(err);
    }
  });
}

export default router;
