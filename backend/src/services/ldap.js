/**
 * VaultGuard — Serviço de Active Directory / LDAP
 *
 * Suporta:
 *  - Microsoft Active Directory (porta 389 / 636 LDAPS)
 *  - OpenLDAP
 *  - FreeIPA / 389 Directory Server
 *
 * Fluxo de autenticação AD:
 *  1. Bind com conta de serviço (service account)
 *  2. Buscar o usuário pelo sAMAccountName ou userPrincipalName
 *  3. Re-bind com as credenciais do usuário para validar a senha
 *  4. Retornar atributos do usuário para sincronização local
 */

import { Client } from 'ldapts';
import { pruneFolderKeys } from './keys.js';
import { prisma } from '../db.js';
import { createAuditLog } from './audit.js';
import logger from '../utils/logger.js';


// ── Mapeamento de role por grupo do AD ───────────────────────────────────────
const DEFAULT_ROLE_MAP = {
  // grupo AD (lowercase) → role VaultGuard
  // Pode ser sobrescrito via ldapConfig.roleGroupMap
};

// ── Prioridade das classificações (Role.priority), buscada do banco ──────────
// As classificações são gerenciáveis pelo admin (tabela Role) — não há mais
// uma lista fixa de cargos, então a prioridade usada pra escolher o cargo de
// maior privilégio entre os grupos do AD vem do banco, não de um objeto fixo.
async function getRolePriorityMap() {
  const roles = await prisma.role.findMany({ select: { key: true, priority: true } });
  return Object.fromEntries(roles.map(r => [r.key, r.priority]));
}

// ── Vários servidores (failover) ─────────────────────────────────────────────
// A config guarda uma lista de servidores, cada um com conexão e conta de
// serviço próprias. Só um é usado por vez: o preferido (escolhido pelo admin).
// Se ele falhar, o próximo da lista assume na hora (autoFailover); quando o
// preferido volta a responder, ele reassume.
export const SERVER_FIELDS = ['host', 'port', 'useTLS', 'startTLS', 'verifyCert', 'domain', 'baseDn', 'bindDn', 'bindPassword'];

/** Converte a config antiga (um servidor só, campos no topo) para a lista */
export function normalizeLdapConfig(raw) {
  if (!raw) return null;
  const cfg = { ...raw };
  if (!Array.isArray(cfg.servers) || !cfg.servers.length) {
    cfg.servers = cfg.host ? [{ id: 'principal', name: 'Principal', ...Object.fromEntries(SERVER_FIELDS.map(f => [f, raw[f]])) }] : [];
  }
  for (const f of SERVER_FIELDS) delete cfg[f];
  if (!cfg.servers.some(sv => sv.id === cfg.activeServerId)) cfg.activeServerId = cfg.servers[0]?.id || null;
  cfg.autoFailover = cfg.autoFailover !== false;
  return cfg;
}

/** Config usada numa conexão: opções gerais + dados do servidor */
export function serverConfig(cfg, server) {
  const { servers, activeServerId, autoFailover, ...shared } = cfg;
  return { ...shared, ...server };
}

// Saúde de cada servidor, em memória: { state: 'ok'|'down', lastError, lastCheck, lastOk }
const health = new Map();
let inUseServerId = null;
const DOWN_RETRY_MS = 60 * 1000;

// Erros de conexão em linguagem de gente (o original fica no log)
export function explainLdapError(err) {
  const m = `${err?.name || ''} ${String(err?.message || err || '')}`.trim();
  if (/ECONNREFUSED/.test(m)) return 'O servidor recusou a conexão: está desligado ou a porta está errada.';
  if (/ETIMEDOUT|timeout|Timed out/i.test(m)) return 'O servidor não respondeu a tempo: pode estar fora do ar ou bloqueado por firewall.';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Nome do servidor não encontrado (DNS). Confira o endereço.';
  if (/EHOSTUNREACH|ENETUNREACH/.test(m)) return 'Servidor inacessível pela rede.';
  if (/ECONNRESET|socket hang up|closed/i.test(m)) return 'A conexão caiu no meio. Confira LDAPS/StartTLS e a porta.';
  if (/InvalidCredentialsError|invalid credentials/i.test(m)) return 'A conta de serviço ou a senha foram recusadas pelo AD.';
  if (/certificate|self.signed|CERT_|UNABLE_TO_VERIFY/i.test(m)) return 'O certificado do servidor não é confiável. Instale a CA ou desligue "Verificar certificado".';
  if (/NoSuchObjectError/.test(m)) return 'Base DN não encontrado no diretório.';
  return String(err?.message || err || '');
}

function markOk(server) {
  health.set(server.id, { ...(health.get(server.id) || {}), state: 'ok', lastError: null, lastCheck: new Date(), lastOk: new Date() });
}
function markDown(server, err) {
  health.set(server.id, { ...(health.get(server.id) || {}), state: 'down', lastError: explainLdapError(err), lastCheck: new Date() });
}

// Ordem de tentativa: preferido primeiro; servidores que caíram há pouco vão para o fim
function tryOrder(cfg) {
  const preferred = cfg.servers.find(sv => sv.id === cfg.activeServerId);
  const rest = cfg.servers.filter(sv => sv !== preferred);
  const order = [preferred, ...(cfg.autoFailover ? rest : [])].filter(Boolean);
  const recentlyDown = (sv) => health.get(sv.id)?.state === 'down' && Date.now() - health.get(sv.id).lastCheck < DOWN_RETRY_MS;
  return [...order.filter(sv => !recentlyDown(sv)), ...order.filter(recentlyDown)];
}

async function noteInUse(cfg, server) {
  if (inUseServerId === server.id) return;
  const previous = cfg.servers.find(sv => sv.id === inUseServerId);
  inUseServerId = server.id;
  if (!previous) return;
  const action = server.id === cfg.activeServerId ? 'ldap.failback' : 'ldap.failover';
  logger.warn(`LDAP: ${action} ${previous.name} -> ${server.name}`);
  await createAuditLog(null, action, server.id, 'Settings', { from: previous.name, to: server.name, reason: health.get(previous.id)?.lastError || null }, null);
}

/**
 * Executa fn(configDoServidor) no servidor em uso, passando para o próximo se
 * a conexão ou a conta de serviço falhar. Erros do próprio usuário (senha
 * errada) não chegam aqui: fn os devolve como resultado, não como exceção.
 */
export async function withLdapServer(cfg, fn) {
  if (!cfg?.servers?.length) throw new Error('Nenhum servidor do Active Directory configurado');
  let lastErr;
  for (const server of tryOrder(cfg)) {
    try {
      const result = await fn(serverConfig(cfg, server), server);
      markOk(server);
      await noteInUse(cfg, server);
      return result;
    } catch (err) {
      lastErr = err;
      markDown(server, err);
      logger.error('LDAP server failed', { server: server.name, host: server.host, error: err.message });
    }
  }
  throw lastErr;
}

/** Situação de cada servidor para a tela do admin */
export function getLdapStatus(cfg) {
  const servers = (cfg?.servers || []).map(sv => ({
    id: sv.id, name: sv.name, host: sv.host, port: sv.port,
    preferred: sv.id === cfg.activeServerId,
    inUse: sv.id === (inUseServerId && cfg.servers.some(x => x.id === inUseServerId) ? inUseServerId : cfg.activeServerId),
    ...(health.get(sv.id) || { state: 'unknown' }),
  }));
  return { servers, autoFailover: cfg?.autoFailover !== false, activeServerId: cfg?.activeServerId || null };
}

/** Testa todos os servidores (rotina periódica e botão "Verificar agora") */
export async function checkAllServers(cfg) {
  if (!cfg?.servers?.length) return getLdapStatus(cfg);
  for (const server of cfg.servers) {
    const r = await testConnection(serverConfig(cfg, server));
    if (r.success) markOk(server); else markDown(server, new Error(r.message));
  }
  // Em uso = o primeiro que responde na ordem de preferência
  const order = [cfg.servers.find(sv => sv.id === cfg.activeServerId), ...cfg.servers.filter(sv => sv.id !== cfg.activeServerId)].filter(Boolean);
  const candidates = cfg.autoFailover ? order : order.slice(0, 1);
  const up = candidates.find(sv => health.get(sv.id)?.state === 'ok');
  if (up) await noteInUse(cfg, up);
  return getLdapStatus(cfg);
}

/** Troca manual: o escolhido passa a ser o preferido e o em uso */
export function setInUse(serverId) {
  inUseServerId = serverId;
}

// ── Ler config do banco ───────────────────────────────────────────────────────
export async function getLdapConfig() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings?.ldapEnabled || !settings?.ldapConfig) return null;
  return normalizeLdapConfig(settings.ldapConfig);
}

// ── Extrair valor escalar de atributo LDAP ────────────────────────────────────
// ldapts retorna atributos ausentes/vazios como array vazio ([]), que é "truthy"
// em JS — isso quebra fallbacks como "entry.mail || entry.userPrincipalName",
// pois [] nunca deixa o operador cair no próximo valor. Normaliza pra string.
function ldapStr(value) {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : '';
  if (value === null || value === undefined) return '';
  return String(value);
}

// objectGUID do AD em hex. Diretórios sem esse atributo (OpenLDAP, FreeIPA)
// devolvem lista vazia: vira null, senão todos teriam o mesmo GUID ""
function guidOf(entry) {
  const raw = Array.isArray(entry?.objectGUID) ? entry.objectGUID[0] : entry?.objectGUID;
  if (!raw || !raw.length) return null;
  const hex = Buffer.from(raw).toString('hex');
  return hex || null;
}

// Atributo multivalorado como lista de strings
function ldapList(value) {
  if (value === null || value === undefined || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
}

// ── Normalizar Bind DN ────────────────────────────────────────────────────────
// AD não aceita bind simples com nome de usuário puro (ex: "svc-vault") — exige DN
// completo (CN=...), UPN (usuario@dominio) ou down-level (DOMINIO\usuario).
// Se vier só o nome de usuário e houver domínio configurado, monta o UPN.
function normalizeBindDn(bindDn, domain) {
  if (!bindDn) return bindDn;
  const looksQualified = bindDn.includes('=') || bindDn.includes('@') || bindDn.includes('\\');
  if (looksQualified || !domain) return bindDn;
  return `${bindDn}@${domain}`;
}

// ── Criar cliente LDAP ───────────────────────────────────────────────────────
function createClient(cfg) {
  const url = cfg.useTLS
    ? `ldaps://${cfg.host}:${cfg.port || 636}`
    : `ldap://${cfg.host}:${cfg.port || 389}`;

  return new Client({
    url,
    timeout: (cfg.timeout || 10) * 1000,
    connectTimeout: 5000,
    tlsOptions: cfg.useTLS ? {
      rejectUnauthorized: cfg.verifyCert !== false,
    } : undefined,
  });
}

// StartTLS: criptografa a conexão na porta 389 antes de qualquer senha trafegar
async function maybeStartTLS(client, cfg) {
  if (cfg.useTLS || !cfg.startTLS) return;
  await client.startTLS({ rejectUnauthorized: cfg.verifyCert !== false });
}

// ── Testar conexão e bind de serviço ─────────────────────────────────────────
export async function testConnection(cfg) {
  const client = createClient(cfg);
  try {
    await maybeStartTLS(client, cfg);
    await client.bind(normalizeBindDn(cfg.bindDn, cfg.domain), cfg.bindPassword);
    // Busca de teste no baseDN
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes: ['dn'],
      sizeLimit: 1,
    });
    await client.unbind();
    return { success: true, message: `Conectado. BaseDN acessível.` };
  } catch (err) {
    logger.error('LDAP test connection error', { error: err.message });
    return { success: false, message: explainLdapError(err) };
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}

// ── Buscar usuário no AD ──────────────────────────────────────────────────────
async function searchUser(client, cfg, login) {
  const escapedLogin = login.replace(/[*()\\\x00]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

  // Filtro flexível: sAMAccountName, userPrincipalName ou uid (OpenLDAP)
  const filter = cfg.userFilter
    ? cfg.userFilter.replace('{login}', escapedLogin)
    : `(|(sAMAccountName=${escapedLogin})(userPrincipalName=${escapedLogin})(uid=${escapedLogin})(mail=${escapedLogin}))`;

  const attributes = [
    'dn', 'sAMAccountName', 'userPrincipalName', 'uid',
    'givenName', 'sn', 'cn', 'displayName', 'mail',
    'memberOf', 'objectGUID', 'userAccountControl',
    'thumbnailPhoto', ...(cfg.extraAttributes || []),
  ];

  const { searchEntries } = await client.search(cfg.baseDn, {
    scope: cfg.searchScope || 'sub',
    filter,
    attributes,
    sizeLimit: 1,
    explicitBufferAttributes: ['objectGUID'],
  });

  return searchEntries[0] || null;
}

// ── Extrair grupos do atributo memberOf ───────────────────────────────────────
function extractGroups(entry) {
  const memberOf = entry.memberOf || [];
  const groups = Array.isArray(memberOf) ? memberOf : [memberOf];
  // Extrai apenas o CN do grupo: CN=GRP_TI,OU=Grupos,DC=... → grp_ti
  return groups.map(dn => {
    const match = String(dn).match(/^CN=([^,]+)/i);
    return match ? match[1].toLowerCase() : dn.toLowerCase();
  });
}

// ── Resolver role pelo mapeamento de grupos ───────────────────────────────────
function resolveRole(groups, roleGroupMap = {}, defaultRole = 'AUXILIAR', priorityMap = {}) {
  const map = { ...DEFAULT_ROLE_MAP, ...roleGroupMap };
  let highestRole = defaultRole;
  let highestPriority = priorityMap[defaultRole] ?? 0;

  for (const group of groups) {
    const role = map[group];
    if (role && priorityMap[role] !== undefined) {
      if (priorityMap[role] > highestPriority) {
        highestRole = role;
        highestPriority = priorityMap[role];
      }
    }
  }
  return highestRole;
}

// ── Verificar se usuário está ativo no AD ─────────────────────────────────────
function isAdUserActive(entry) {
  // userAccountControl — bit 2 (0x2) = conta desabilitada
  const uac = parseInt(entry.userAccountControl || '0', 10);
  if (uac & 0x2) return false; // desabilitado
  return true;
}

// ── Autenticar via AD ─────────────────────────────────────────────────────────
export async function authenticateWithAD(login, password, ip, ua) {
  const base = await getLdapConfig();
  if (!base) throw new Error('LDAP não configurado ou desabilitado');

  // Conexão, conta de serviço e busca rodam no servidor em uso (com troca
  // automática); a senha do usuário é validada no mesmo servidor
  const found = await withLdapServer(base, async (cfg) => {
    const client = createClient(cfg);
    try {
      await maybeStartTLS(client, cfg);
      await client.bind(normalizeBindDn(cfg.bindDn, cfg.domain), cfg.bindPassword);
      const entry = await searchUser(client, cfg, login);
      if (!entry) return { cfg, entry: null };
      if (!isAdUserActive(entry)) return { cfg, entry, disabled: true };
      try {
        await client.bind(entry.dn, password);
        return { cfg, entry, passwordOk: true };
      } catch {
        return { cfg, entry, passwordOk: false };
      }
    } finally {
      try { await client.unbind(); } catch { /* ignore */ }
    }
  });
  const cfg = found.cfg;
  const entry = found.entry;

  try {
    if (!entry) {
      logger.warn('LDAP: usuário não encontrado', { login });
      return null;
    }
    if (found.disabled) {
      logger.warn('LDAP: conta desabilitada no AD', { login, dn: entry.dn });
      return { error: 'Conta desabilitada no Active Directory' };
    }
    if (!found.passwordOk) {
      logger.warn('LDAP: senha inválida', { login, dn: entry.dn });
      return null; // senha errada
    }

    // 5. Extrair atributos
    const email = (ldapStr(entry.mail) || ldapStr(entry.userPrincipalName) || `${login}@${cfg.domain || 'local'}`).toLowerCase();
    const username = (ldapStr(entry.sAMAccountName) || ldapStr(entry.uid) || login).toLowerCase();
    const firstName = ldapStr(entry.givenName) || ldapStr(entry.cn) || login;
    const lastName = ldapStr(entry.sn);
    const ldapDn = entry.dn.toString();
    const ldapGuid = guidOf(entry);

    // 6. Resolver role pelos grupos
    const groups = extractGroups(entry);
    const priorityMap = await getRolePriorityMap();
    const role = resolveRole(groups, cfg.roleGroupMap, cfg.defaultRole || 'AUXILIAR', priorityMap);

    // 7. Sincronizar usuário no banco local (upsert)
    const user = await upsertLdapUser({
      email, username, firstName, lastName, ldapDn, ldapGuid, role,
      syncGroups: cfg.syncGroups !== false,
    });

    await createAuditLog(user.id, 'user.login', null, null, { method: 'ldap', groups }, ip, ua);

    return user;
  } catch (err) {
    logger.error('LDAP authentication error', { error: err.message, login });
    throw err;
  }
}

// ── Localiza o usuário local que corresponde a uma conta do AD ───────────────
// Por DN/GUID; por e-mail só se a conta local já for do AD. Uma conta local
// (senha própria) com o mesmo e-mail nunca é convertida automaticamente: isso
// permitiria a uma conta do AD assumir, por exemplo, o admin de emergência.
// Vincular contas locais existentes é uma ação explícita do admin (linkUsersFromAD).
async function findLdapMatch({ ldapDn, ldapGuid, email }) {
  const byId = await prisma.user.findFirst({
    where: { OR: [{ ldapDn }, ...(ldapGuid ? [{ ldapGuid }] : [])] },
  });
  if (byId) return byId;
  const byEmail = await prisma.user.findFirst({ where: { email } });
  if (!byEmail) return null;
  if (byEmail.authSource === 'ldap') return byEmail;
  const e = new Error('Já existe uma conta local com este e-mail. Peça ao administrador para vinculá-la ao AD.');
  e.code = 'LOCAL_ACCOUNT_CONFLICT';
  throw e;
}

// ── Upsert do usuário LDAP no banco local ─────────────────────────────────────
async function upsertLdapUser({ email, username, firstName, lastName, ldapDn, ldapGuid, role, syncGroups }) {
  const existing = await findLdapMatch({ ldapDn, ldapGuid, email });

  const data = {
    email,
    username,
    firstName,
    lastName,
    ldapDn,
    ldapGuid,
    authSource: 'ldap',
    lastLogin: new Date(),
    // Só atualiza role se sincronização de grupos estiver ativa
    ...(syncGroups ? { role } : {}),
  };

  // Status não é tocado: quem foi desativado no VaultGuard continua desativado
  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data,
    });
    // Cargo mudou pelos grupos do AD: ajusta acesso às chaves
    if (syncGroups && existing.role !== updated.role) {
      if (updated.role !== 'ADMINISTRADOR') await prisma.orgKeyGrant.deleteMany({ where: { userId: updated.id } });
      await pruneFolderKeys();
    }
    return updated;
  }

  // Criar novo usuário
  return prisma.user.create({
    data: {
      ...data,
      role: role || 'AUXILIAR',
      status: 'ACTIVE',
      // passwordHash null = autenticação apenas por LDAP
    },
  });
}

// ── Sincronizar todos os usuários do AD (importação em lote) ──────────────────
async function syncAllUsersFromADOnServer(cfg) {
  const client = createClient(cfg);
  const results = { created: 0, updated: 0, disabled: 0, errors: [] };

  try {
    await maybeStartTLS(client, cfg);
    await client.bind(normalizeBindDn(cfg.bindDn, cfg.domain), cfg.bindPassword);

    const filter = cfg.syncFilter || '(&(objectClass=user)(objectCategory=person))';
    const attributes = [
      'dn', 'sAMAccountName', 'userPrincipalName', 'givenName', 'sn',
      'mail', 'memberOf', 'objectGUID', 'userAccountControl',
    ];

    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub', filter, attributes,
      sizeLimit: cfg.syncMaxUsers || 5000,
      paged: true,
      explicitBufferAttributes: ['objectGUID'],
    });

    const priorityMap = await getRolePriorityMap();

    for (const entry of searchEntries) {
      try {
        const active = isAdUserActive(entry);
        const email = (ldapStr(entry.mail) || ldapStr(entry.userPrincipalName)).toLowerCase();
        const username = ldapStr(entry.sAMAccountName).toLowerCase();

        if (!email || !username) continue;

        const firstName = ldapStr(entry.givenName) || username;
        const lastName = ldapStr(entry.sn);
        const ldapDn = entry.dn.toString();
        const ldapGuid = guidOf(entry);
        const groups = extractGroups(entry);
        const role = resolveRole(groups, cfg.roleGroupMap, cfg.defaultRole || 'AUXILIAR', priorityMap);

        const existing = await findLdapMatch({ ldapDn, ldapGuid, email });

        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              email, username, firstName, lastName, ldapDn, ldapGuid,
              authSource: 'ldap',
              // Desabilitado no AD desativa aqui; reativar é decisão do admin
              ...(!active && { status: 'INACTIVE', tokenVersion: { increment: 1 } }),
              ...(cfg.syncGroups !== false ? { role } : {}),
            },
          });
          if (!active) results.disabled++;
          else results.updated++;
        } else if (active) {
          await prisma.user.create({
            data: {
              email, username, firstName, lastName, ldapDn, ldapGuid,
              authSource: 'ldap', status: 'ACTIVE', role,
            },
          });
          results.created++;
        }
      } catch (entryErr) {
        results.errors.push({ dn: entry.dn?.toString(), error: entryErr.message });
      }
    }

    await client.unbind();
  } catch (err) {
    logger.error('LDAP sync error', { error: err.message });
    throw err;
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }

  return results;
}

// ── Preview de usuários do AD (sem salvar no banco) ──────────────────────────
async function fetchUsersForPreviewOnServer(cfg) {
  const client = createClient(cfg);
  try {
    await maybeStartTLS(client, cfg);
    await client.bind(normalizeBindDn(cfg.bindDn, cfg.domain), cfg.bindPassword);

    const filter = cfg.syncFilter || '(&(objectClass=user)(objectCategory=person))';
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: cfg.searchScope || 'sub',
      filter,
      attributes: [
        'dn', 'sAMAccountName', 'userPrincipalName', 'mail',
        'givenName', 'sn', 'userAccountControl', 'memberOf', 'objectGUID',
      ],
      sizeLimit: cfg.syncMaxUsers || 5000,
      paged: true,
      explicitBufferAttributes: ['objectGUID'],
    });

    await client.unbind();

    const priorityMap = await getRolePriorityMap();

    return searchEntries
      .map(e => {
        const active = isAdUserActive(e);
        const groups = extractGroups(e);
        const role = resolveRole(groups, cfg.roleGroupMap, cfg.defaultRole || 'AUXILIAR', priorityMap);
        const email = (ldapStr(e.mail) || ldapStr(e.userPrincipalName)).toLowerCase();
        const username = ldapStr(e.sAMAccountName).toLowerCase();
        return {
          dn: e.dn?.toString(),
          username,
          email,
          firstName: ldapStr(e.givenName) || username,
          lastName: ldapStr(e.sn),
          active,
          role,
        };
      })
      .filter(u => u.username && u.email);
  } catch (err) {
    logger.error('LDAP fetchUsersForPreview error', { error: err.message });
    throw err;
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}

// ── Vincular usuários específicos do AD ao VaultGuard ────────────────────────
export async function linkUsersFromAD(cfg, emails) {
  const adUsers = await fetchUsersForPreview(cfg);
  const toLink = adUsers.filter(u => emails.includes(u.email));

  const results = { created: 0, updated: 0, disabled: 0, errors: [] };

  for (const u of toLink) {
    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ ldapDn: u.dn }, { email: u.email }] },
      });

      const data = {
        email: u.email,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        ldapDn: u.dn,
        authSource: 'ldap',
        status: u.active ? 'ACTIVE' : 'INACTIVE',
        ...(cfg.syncGroups !== false ? { role: u.role } : {}),
      };

      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data });
        if (!u.active) results.disabled++;
        else results.updated++;
      } else {
        await prisma.user.create({
          data: { ...data, role: u.role || cfg.defaultRole || 'AUXILIAR' },
        });
        results.created++;
      }
    } catch (err) {
      results.errors.push({ username: u.username, error: err.message });
    }
  }

  return results;
}

// ── Buscar grupos do AD (para mapear a roles) ─────────────────────────────────
async function fetchADGroupsOnServer(cfg) {
  const client = createClient(cfg);
  try {
    await maybeStartTLS(client, cfg);
    await client.bind(normalizeBindDn(cfg.bindDn, cfg.domain), cfg.bindPassword);
    const filter = cfg.groupFilter || '(objectClass=group)';
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub', filter,
      attributes: ['dn', 'cn', 'description', 'member'],
      sizeLimit: 500,
    });
    await client.unbind();
    return searchEntries.map(e => ({
      dn: e.dn?.toString(),
      cn: ldapStr(e.cn),
      description: ldapStr(e.description),
      memberCount: ldapList(e.member).length,
    }));
  } catch (err) {
    logger.error('LDAP fetchGroups error', { error: err.message });
    throw err;
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}

export async function syncAllUsersFromAD(cfg) {
  return withLdapServer(normalizeLdapConfig(cfg), (serverCfg) => syncAllUsersFromADOnServer(serverCfg));
}

export async function fetchUsersForPreview(cfg) {
  return withLdapServer(normalizeLdapConfig(cfg), (serverCfg) => fetchUsersForPreviewOnServer(serverCfg));
}

export async function fetchADGroups(cfg) {
  return withLdapServer(normalizeLdapConfig(cfg), (serverCfg) => fetchADGroupsOnServer(serverCfg));
}

// ── Importar grupos do AD como grupos do VaultGuard ──────────────────────────
// Cada grupo do AD vira um grupo com o mesmo nome, com as pessoas de dentro
// (criadas/vinculadas como usuários do AD). Na sincronização, só os membros que
// vieram do AD (invitedById = AD_MEMBER) entram e saem; quem o admin colocou à
// mão continua. Grupos dentro de grupos não são expandidos.
export const AD_MEMBER = 'ad-sync';
const USER_ATTRS = ['dn', 'sAMAccountName', 'userPrincipalName', 'uid', 'mail', 'givenName', 'sn', 'cn',
  'userAccountControl', 'memberOf', 'objectGUID', 'objectClass'];

// Membros do grupo. O AD entrega grupos grandes em partes (member;range=0-1499):
// busca as partes até o fim (até ~100 mil membros)
async function getGroupMembers(client, groupDn) {
  const { searchEntries: [group] } = await client.search(groupDn, { scope: 'base', filter: '(objectClass=*)', attributes: ['cn', 'member'] });
  if (!group) throw new Error('Grupo não encontrado no AD');
  let members = ldapList(group.member);
  let rangeKey = Object.keys(group).find(k => /^member;range=/i.test(k));
  for (let i = 0; rangeKey && i < 70; i++) {
    members = members.concat(ldapList(group[rangeKey]));
    const end = rangeKey.split('-').pop();
    if (end === '*') break;
    const next = Number(end) + 1;
    const { searchEntries: [part] } = await client.search(groupDn, { scope: 'base', filter: '(objectClass=*)', attributes: [`member;range=${next}-*`] });
    rangeKey = part && Object.keys(part).find(k => /^member;range=/i.test(k));
    if (!rangeKey) break;
    if (rangeKey.endsWith('-*')) { members = members.concat(ldapList(part[rangeKey])); break; }
    group[rangeKey] = part[rangeKey];
  }
  return { cn: ldapStr(group.cn) || groupDn, members };
}

async function importADGroupsOnServer(cfg, dns, adminUserId) {
  const client = createClient(cfg);
  const results = [];
  let rolesChanged = false;
  try {
    await maybeStartTLS(client, cfg);
    await client.bind(normalizeBindDn(cfg.bindDn, cfg.domain), cfg.bindPassword);
    const priorityMap = await getRolePriorityMap();

    for (const groupDn of dns) {
      const r = { dn: groupDn, name: null, members: 0, added: 0, removed: 0, created: false, skipped: [], disabled: 0 };
      try {
        const group = await getGroupMembers(client, groupDn);
        r.name = group.cn;
        const memberDns = new Set(group.members.map(d => d.toLowerCase()));

        const activeIds = [];
        // Quem não deu para ler agora (erro, sem e-mail, conflito) não sai do grupo
        const keepIds = new Set();
        for (const memberDn of group.members) {
          let entry;
          try {
            ({ searchEntries: [entry] } = await client.search(memberDn, { scope: 'base', filter: '(objectClass=*)', attributes: USER_ATTRS, explicitBufferAttributes: ['objectGUID'] }));
          } catch {
            r.skipped.push(memberDn);
            const known = await prisma.user.findFirst({ where: { ldapDn: { equals: memberDn, mode: 'insensitive' } }, select: { id: true } });
            if (known) keepIds.add(known.id);
            continue;
          }
          const classes = ldapList(entry?.objectClass).map(c => c.toLowerCase());
          if (!entry || classes.includes('group') || classes.includes('groupofnames')) { r.skipped.push(memberDn); continue; }
          const email = (ldapStr(entry.mail) || ldapStr(entry.userPrincipalName)).toLowerCase();
          const username = (ldapStr(entry.sAMAccountName) || ldapStr(entry.uid)).toLowerCase();
          if (!email || !username) { r.skipped.push(memberDn); continue; }
          const ldapDn = entry.dn.toString();
          const ldapGuid = guidOf(entry);
          const active = isAdUserActive(entry);
          const role = resolveRole(extractGroups(entry), cfg.roleGroupMap, cfg.defaultRole || 'AUXILIAR', priorityMap);
          const data = {
            email, username, ldapDn, ldapGuid, authSource: 'ldap',
            firstName: ldapStr(entry.givenName) || ldapStr(entry.cn) || username,
            lastName: ldapStr(entry.sn),
          };
          let user;
          try {
            const existing = await findLdapMatch({ ldapDn, ldapGuid, email });
            if (existing) {
              const newRole = cfg.syncGroups !== false ? role : existing.role;
              user = await prisma.user.update({
                where: { id: existing.id },
                data: {
                  ...data, role: newRole,
                  // Desativado no AD desativa aqui (e derruba as sessões); reativar é decisão do admin
                  ...(!active && existing.status === 'ACTIVE' ? { status: 'INACTIVE', tokenVersion: { increment: 1 } } : {}),
                },
              });
              if (existing.role !== newRole) {
                rolesChanged = true;
                if (newRole !== 'ADMINISTRADOR') await prisma.orgKeyGrant.deleteMany({ where: { userId: user.id } });
              }
            } else {
              user = await prisma.user.create({ data: { ...data, role, status: active ? 'ACTIVE' : 'INACTIVE' } });
            }
          } catch (e) {
            r.skipped.push(`${email}: ${e.message}`);
            const known = await prisma.user.findFirst({ where: { email }, select: { id: true } });
            if (known) keepIds.add(known.id);
            continue;
          }
          if (user.status !== 'ACTIVE') { r.disabled++; continue; }
          activeIds.push(user.id);
        }
        r.members = activeIds.length;

        let team = await prisma.team.findFirst({ where: { adGroupDn: groupDn } });
        if (!team) {
          team = await prisma.team.create({
            data: {
              name: r.name, description: 'Importado do Active Directory', ownerId: adminUserId, adGroupDn: groupDn,
              members: { create: { userId: adminUserId, status: 'ACTIVE', invitedById: adminUserId, respondedAt: new Date() } },
            },
          });
          r.created = true;
        }
        const current = await prisma.teamMember.findMany({ where: { teamId: team.id }, include: { user: { select: { ldapDn: true, status: true } } } });
        const now = new Date();
        for (const userId of activeIds) {
          const m = current.find(c => c.userId === userId);
          if (!m) {
            await prisma.teamMember.create({ data: { teamId: team.id, userId, status: 'ACTIVE', invitedById: AD_MEMBER, respondedAt: now } });
            r.added++;
          } else if (m.status !== 'ACTIVE') {
            await prisma.teamMember.update({ where: { id: m.id }, data: { status: 'ACTIVE', respondedAt: now } });
            r.added++;
          }
        }
        // Sai só quem veio do AD e não está mais na lista de membros do grupo no AD
        // (ou foi desativado lá). Lista vazia com membros do AD aqui = leitura suspeita: não remove ninguém
        const adMembersHere = current.filter(c => c.invitedById === AD_MEMBER && c.userId !== team.ownerId);
        if (!group.members.length && adMembersHere.length) {
          r.skipped.push('O AD devolveu o grupo sem membros: ninguém foi removido. Confira o grupo e sincronize de novo.');
        } else {
          const gone = adMembersHere.filter(c => !keepIds.has(c.userId) && !activeIds.includes(c.userId)
            && (!c.user?.ldapDn || !memberDns.has(c.user.ldapDn.toLowerCase()) || c.user.status !== 'ACTIVE'));
          if (gone.length) {
            await prisma.teamMember.deleteMany({ where: { id: { in: gone.map(g => g.id) } } });
            r.removed = gone.length;
          }
        }
        // O nome só vem do AD na criação: se o admin renomeou, fica o nome dele
        await prisma.team.update({ where: { id: team.id }, data: { adSyncedAt: now } });
        r.teamId = team.id;
        r.name = team.name;
      } catch (e) {
        r.error = explainLdapError(e);
      }
      results.push(r);
    }
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
  if (rolesChanged || results.some(r => r.removed || r.disabled)) await pruneFolderKeys();
  return results;
}

export async function importADGroups(cfg, dns, adminUserId) {
  return withLdapServer(normalizeLdapConfig(cfg), (serverCfg) => importADGroupsOnServer(serverCfg, dns, adminUserId));
}

/** Sincroniza os grupos já importados (botão e sincronização geral do AD) */
export async function resyncADGroups(cfg, adminUserId) {
  const teams = await prisma.team.findMany({ where: { adGroupDn: { not: null } }, select: { adGroupDn: true, ownerId: true } });
  if (!teams.length) return [];
  return importADGroups(cfg, teams.map(t => t.adGroupDn), adminUserId || teams[0].ownerId);
}
