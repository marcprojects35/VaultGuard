/**
 * GET  /api/ldap/config      — Ler config LDAP (sem senha)
 * PUT  /api/ldap/config      — Salvar config LDAP
 * POST /api/ldap/test        — Testar conexão
 * GET  /api/ldap/groups      — Listar grupos do AD
 * POST /api/ldap/sync        — Sincronizar usuários do AD
 * GET  /api/ldap/sync/status — Status da última sincronização
 * GET  /api/ldap/status      — Situação de cada servidor (em uso, reserva, fora do ar)
 * POST /api/ldap/status/check — Verificar todos os servidores agora
 * PUT  /api/ldap/active      — Trocar manualmente o servidor em uso
 */
import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  testConnection, fetchADGroups, syncAllUsersFromAD, fetchUsersForPreview, linkUsersFromAD,
  normalizeLdapConfig, serverConfig, getLdapStatus, checkAllServers, setInUse, SERVER_FIELDS,
} from '../services/ldap.js';
import { createAuditLog } from '../services/audit.js';
import { pruneFolderKeys } from '../services/keys.js';
import logger from '../utils/logger.js';

const router = Router();

// Estado de sync em memória (simples — para produção usar Redis/BullMQ)
let syncState = { running: false, lastRun: null, lastResult: null };

// A senha salva da conta de serviço só é reaproveitada para o mesmo servidor
// e a mesma conta; senão bastaria trocar o host para recebê-la em outro lugar.
function sameServer(cfg, saved) {
  if (!saved?.bindPassword) return false;
  const norm = (c) => [String(c.host || '').trim().toLowerCase(), String(c.port || (c.useTLS ? 636 : 389)), String(c.bindDn || '').trim().toLowerCase(), !!c.useTLS, !!c.startTLS];
  return JSON.stringify(norm(cfg)) === JSON.stringify(norm(saved));
}

const MASK = '••••••••';

async function savedLdapConfig() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
  return normalizeLdapConfig(settings?.ldapConfig || null);
}

// Senha mascarada ("••••••••") vem do formulário: reaproveita a salva do mesmo
// servidor (mesmo id, host, porta, TLS e conta); senão fica vazia
function unmaskServers(cfg, saved) {
  return {
    ...cfg,
    servers: (cfg.servers || []).map(sv => {
      if (sv.bindPassword !== MASK) return sv;
      const old = saved?.servers?.find(o => o.id === sv.id);
      return { ...sv, bindPassword: sameServer(sv, old) ? old.bindPassword : '' };
    }),
  };
}

// ── Resolve a config efetiva: usa a enviada pelo form (não salva ainda),
// caindo para a config salva no banco quando não vier nenhuma no body.
async function resolveConfig(bodyConfig) {
  const saved = await savedLdapConfig();
  if (!bodyConfig || !Object.keys(bodyConfig).length) return saved;
  const cfg = normalizeLdapConfig(bodyConfig);
  cfg.servers = cfg.servers.map(sv => ({ ...sv, port: sv.port ? parseInt(sv.port, 10) : sv.port }));
  return unmaskServers(cfg, saved);
}

// ── GET /api/ldap/config ─────────────────────────────────────────────────────
router.get('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const cfg = normalizeLdapConfig(settings?.ldapConfig || {}) || { servers: [] };
    // Nunca retornar a senha das contas de serviço para o frontend
    const safeCfg = { ...cfg, servers: cfg.servers.map(sv => ({ ...sv, bindPassword: sv.bindPassword ? MASK : '' })) };
    res.json({ enabled: settings?.ldapEnabled || false, config: safeCfg });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/ldap/config ─────────────────────────────────────────────────────
router.put('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body;
    if (!req.body.config || typeof req.body.config !== 'object' || Array.isArray(req.body.config)) {
      return res.status(400).json({ error: 'Configuração inválida' });
    }
    const saved = await savedLdapConfig();
    const cfg = normalizeLdapConfig(req.body.config);
    if (cfg.servers.length > 10) return res.status(400).json({ error: 'Cadastre no máximo 10 servidores' });

    const ids = new Set();
    cfg.servers = cfg.servers.map((sv, i) => {
      const id = /^[\w-]{1,40}$/.test(String(sv.id || '')) ? String(sv.id) : `srv${Date.now()}${i}`;
      return {
        id, name: String(sv.name || `Servidor ${i + 1}`).trim().slice(0, 60) || `Servidor ${i + 1}`,
        ...Object.fromEntries(SERVER_FIELDS.map(f => [f, sv[f]])),
        port: sv.port ? parseInt(sv.port, 10) : (sv.useTLS ? 636 : 389),
      };
    });
    for (const sv of cfg.servers) {
      if (ids.has(sv.id)) return res.status(400).json({ error: 'Servidores repetidos na lista' });
      ids.add(sv.id);
      if (!Number.isInteger(sv.port) || sv.port < 1 || sv.port > 65535) return res.status(400).json({ error: `Porta inválida em "${sv.name}"` });
    }

    const withPasswords = unmaskServers(cfg, saved);
    if (enabled) {
      if (!withPasswords.servers.length) return res.status(400).json({ error: 'Cadastre ao menos um servidor do Active Directory' });
      for (const sv of withPasswords.servers) {
        for (const [field, label] of [['host', 'servidor (host)'], ['baseDn', 'Base DN'], ['bindDn', 'Bind DN'], ['bindPassword', 'senha da conta de serviço']]) {
          if (!sv[field]) {
            const masked = field === 'bindPassword' && cfg.servers.find(x => x.id === sv.id)?.bindPassword === MASK;
            return res.status(400).json({ error: masked
              ? `Em "${sv.name}": ao trocar servidor, porta, TLS ou conta de serviço, informe a senha da conta de serviço novamente`
              : `Em "${sv.name}": preencha ${label}` });
          }
        }
      }
    }
    if (!withPasswords.servers.some(sv => sv.id === withPasswords.activeServerId)) withPasswords.activeServerId = withPasswords.servers[0]?.id || null;

    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: { ldapEnabled: !!enabled, ldapConfig: withPasswords },
      create: { id: 'singleton', ldapEnabled: !!enabled, ldapConfig: withPasswords },
    });
    if (saved?.activeServerId !== withPasswords.activeServerId) setInUse(withPasswords.activeServerId);

    await createAuditLog(req.user.id, 'settings.ldap_updated', 'SystemSettings', 'singleton',
      { enabled, servers: withPasswords.servers.map(sv => sv.name), preferred: withPasswords.servers.find(sv => sv.id === withPasswords.activeServerId)?.name, autoFailover: withPasswords.autoFailover }, req.ip, req.headers['user-agent']);

    res.json({ success: true, message: 'Configuração LDAP salva.' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/ldap/status ──────────────────────────────────────────────────────
router.get('/status', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(getLdapStatus(await savedLdapConfig()));
  } catch (err) { next(err); }
});

// ── POST /api/ldap/status/check — testa todos os servidores salvos agora ─────
router.post('/status/check', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await checkAllServers(await savedLdapConfig()));
  } catch (err) { next(err); }
});

// ── PUT /api/ldap/active — troca manual do servidor em uso ───────────────────
router.put('/active', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const cfg = normalizeLdapConfig(settings?.ldapConfig || null);
    const target = cfg?.servers.find(sv => sv.id === req.body?.serverId);
    if (!target) return res.status(404).json({ error: 'Servidor não encontrado. Salve a configuração antes de trocar.' });
    const previous = cfg.servers.find(sv => sv.id === cfg.activeServerId);
    cfg.activeServerId = target.id;
    await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { ldapConfig: cfg } });
    setInUse(target.id);
    await createAuditLog(req.user.id, 'ldap.server_switched', target.id, 'Settings', { from: previous?.name || null, to: target.name }, req.ip);
    res.json(getLdapStatus(cfg));
  } catch (err) { next(err); }
});

// ── POST /api/ldap/test — { config, serverId } testa um servidor (do formulário, antes de salvar)
router.post('/test', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cfg = await resolveConfig(req.body?.config);
    const server = cfg?.servers?.find(sv => sv.id === req.body?.serverId) || cfg?.servers?.find(sv => sv.id === cfg.activeServerId);
    const testCfg = server && serverConfig(cfg, server);
    if (!testCfg?.host || !testCfg?.bindDn || !testCfg?.bindPassword || !testCfg?.baseDn) {
      return res.status(400).json({ error: 'Preencha servidor (host), Base DN, Bind DN e a senha da conta de serviço' });
    }
    res.json(await testConnection(testCfg));
  } catch (err) {
    logger.error('LDAP test route error', { error: err.message });
    res.json({ success: false, message: err.message });
  }
});

// ── POST /api/ldap/groups ──────────────────────────────────────────────────────
// Usa a config atual do formulário (mesmo antes de salvar), com fallback pra config salva.
router.post('/groups', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cfg = await resolveConfig(req.body?.config);
    if (!cfg?.servers?.length) {
      return res.status(400).json({ error: 'LDAP não configurado — cadastre um servidor' });
    }

    const groups = await fetchADGroups(cfg);
    res.json(groups);
  } catch (err) {
    logger.error('LDAP fetch groups error', { error: err.message });
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.message?.includes('connect')) {
      return res.status(503).json({ error: `Não foi possível conectar ao servidor LDAP: ${err.message}` });
    }
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
      .then(async result => {
        // Cargos e status podem ter mudado: revisa quem ainda deve ter cada chave
        await pruneFolderKeys().catch(err => logger.error('pruneFolderKeys after LDAP sync failed', { error: err.message }));
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

// ── POST /api/ldap/users/preview ───────────────────────────────────────────────
// Lista usuários do AD cruzando com status no VaultGuard (sem importar).
// Usa a config atual do formulário (mesmo antes de salvar), com fallback pra config salva.
router.post('/users/preview', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cfg = await resolveConfig(req.body?.config);
    if (!cfg?.servers?.length) {
      return res.status(400).json({ error: 'LDAP não configurado — cadastre um servidor' });
    }

    const adUsers = await fetchUsersForPreview(cfg);

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
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.message?.includes('connect')) {
      return res.status(503).json({ error: `Não foi possível conectar ao servidor LDAP: ${err.message}` });
    }
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
