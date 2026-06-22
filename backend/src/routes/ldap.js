/**
 * GET  /api/ldap/config      — Ler config LDAP (sem senha)
 * PUT  /api/ldap/config      — Salvar config LDAP
 * POST /api/ldap/test        — Testar conexão
 * GET  /api/ldap/groups      — Listar grupos do AD
 * POST /api/ldap/sync        — Sincronizar usuários do AD
 * GET  /api/ldap/sync/status — Status da última sincronização
 */
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { testConnection, fetchADGroups, syncAllUsersFromAD, fetchUsersForPreview, linkUsersFromAD } from '../services/ldap.js';
import { createAuditLog } from '../services/audit.js';
import logger from '../utils/logger.js';

const router = Router();
const prisma = new PrismaClient();

// Estado de sync em memória (simples — para produção usar Redis/BullMQ)
let syncState = { running: false, lastRun: null, lastResult: null };

// ── GET /api/ldap/config ─────────────────────────────────────────────────────
router.get('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const cfg = settings?.ldapConfig || {};

    // Nunca retornar a senha da service account para o frontend
    const safeCfg = { ...cfg, bindPassword: cfg.bindPassword ? '••••••••' : '' };

    res.json({
      enabled: settings?.ldapEnabled || false,
      config: safeCfg,
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/ldap/config ─────────────────────────────────────────────────────
router.put('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { enabled, config } = req.body;

    // Campos obrigatórios quando habilitado
    if (enabled) {
      const required = ['host', 'baseDn', 'bindDn', 'bindPassword'];
      for (const field of required) {
        if (!config?.[field] || config[field] === '••••••••') {
          // Se bindPassword for mascarado, manter o existente
          if (field === 'bindPassword' && config[field] === '••••••••') continue;
          return res.status(400).json({ error: `Campo obrigatório: ${field}` });
        }
      }
    }

    // Se senha está mascarada, buscar a existente
    let finalConfig = { ...config };
    if (config?.bindPassword === '••••••••') {
      const existing = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
      finalConfig.bindPassword = existing?.ldapConfig?.bindPassword || '';
    }

    // Sanitizar porta
    if (finalConfig.port) finalConfig.port = parseInt(finalConfig.port, 10);

    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: { ldapEnabled: !!enabled, ldapConfig: finalConfig },
      create: { id: 'singleton', ldapEnabled: !!enabled, ldapConfig: finalConfig },
    });

    await createAuditLog(req.user.id, 'settings.ldap_updated', 'SystemSettings', 'singleton',
      { enabled }, req.ip, req.headers['user-agent']);

    res.json({ success: true, message: 'Configuração LDAP salva.' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/ldap/test ───────────────────────────────────────────────────────
router.post('/test', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { config } = req.body;
    if (!config?.host || !config?.bindDn || !config?.bindPassword || !config?.baseDn) {
      return res.status(400).json({ error: 'Preencha host, baseDn, bindDn e bindPassword' });
    }

    // Se senha mascarada, buscar do banco
    let testCfg = { ...config };
    if (testCfg.bindPassword === '••••••••') {
      const existing = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
      testCfg.bindPassword = existing?.ldapConfig?.bindPassword || '';
    }
    if (testCfg.port) testCfg.port = parseInt(testCfg.port, 10);

    const result = await testConnection(testCfg);
    res.json(result);
  } catch (err) {
    logger.error('LDAP test route error', { error: err.message });
    res.json({ success: false, message: err.message });
  }
});

// ── GET /api/ldap/groups ──────────────────────────────────────────────────────
router.get('/groups', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.ldapConfig) return res.status(400).json({ error: 'LDAP não configurado' });

    const groups = await fetchADGroups(settings.ldapConfig);
    res.json(groups);
  } catch (err) {
    logger.error('LDAP fetch groups error', { error: err.message });
    next(err);
  }
});

// ── POST /api/ldap/sync ───────────────────────────────────────────────────────
router.post('/sync', authenticate, requireAdmin, async (req, res, next) => {
  if (syncState.running) {
    return res.status(409).json({ error: 'Sincronização já em andamento' });
  }

  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.ldapEnabled || !settings?.ldapConfig) {
      return res.status(400).json({ error: 'LDAP não habilitado' });
    }

    syncState.running = true;
    res.json({ message: 'Sincronização iniciada em background' });

    // Roda em background
    syncAllUsersFromAD(settings.ldapConfig)
      .then(result => {
        syncState = { running: false, lastRun: new Date().toISOString(), lastResult: result };
        createAuditLog(req.user.id, 'ldap.sync_completed', 'User', null, result, req.ip);
        logger.info('LDAP sync completed', result);
      })
      .catch(err => {
        syncState = {
          running: false,
          lastRun: new Date().toISOString(),
          lastResult: { error: err.message },
        };
        logger.error('LDAP sync failed', { error: err.message });
      });
  } catch (err) {
    syncState.running = false;
    next(err);
  }
});

// ── GET /api/ldap/sync/status ─────────────────────────────────────────────────
router.get('/sync/status', authenticate, requireAdmin, (req, res) => {
  res.json(syncState);
});

// ── GET /api/ldap/users/preview ───────────────────────────────────────────────
// Lista usuários do AD cruzando com status no VaultGuard (sem importar)
router.get('/users/preview', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.ldapConfig) return res.status(400).json({ error: 'LDAP não configurado' });

    const adUsers = await fetchUsersForPreview(settings.ldapConfig);

    // Cruzar com usuários já existentes no VaultGuard
    const vgUsers = await prisma.user.findMany({
      where: { authSource: 'ldap' },
      select: { email: true, username: true, status: true },
    });
    const vgByEmail = new Map(vgUsers.map(u => [u.email, u]));
    const vgByUsername = new Map(vgUsers.map(u => [u.username, u]));

    const users = adUsers.map(u => {
      const existing = vgByEmail.get(u.email) || vgByUsername.get(u.username);
      return {
        ...u,
        vgStatus: existing ? existing.status : 'NEW', // NEW | ACTIVE | INACTIVE | PENDING
      };
    });

    res.json({ total: users.length, users });
  } catch (err) {
    logger.error('LDAP preview error', { error: err.message });
    next(err);
  }
});

// ── POST /api/ldap/users/link ─────────────────────────────────────────────────
// Vincula (cria ou atualiza) usuários específicos do AD no VaultGuard
router.post('/users/link', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.ldapConfig) return res.status(400).json({ error: 'LDAP não configurado' });

    const { emails } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um e-mail para vincular' });
    }

    const result = await linkUsersFromAD(settings.ldapConfig, emails);

    await createAuditLog(
      req.user.id, 'ldap.users_linked', 'User', null,
      { count: result.created + result.updated, emails },
      req.ip, req.headers['user-agent'],
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
