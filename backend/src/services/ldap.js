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
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from './audit.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

// ── Mapeamento de role por grupo do AD ───────────────────────────────────────
const DEFAULT_ROLE_MAP = {
  // grupo AD (lowercase) → role VaultGuard
  // Pode ser sobrescrito via ldapConfig.roleGroupMap
};

const ROLE_PRIORITY = {
  AUXILIAR: 0, ASSISTENTE: 1, ANALISTA: 2,
  COORDENACAO: 3, DIRETORIA: 4, ADMINISTRADOR: 5,
};

// ── Ler config do banco ───────────────────────────────────────────────────────
export async function getLdapConfig() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings?.ldapEnabled || !settings?.ldapConfig) return null;
  return settings.ldapConfig;
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

// ── Testar conexão e bind de serviço ─────────────────────────────────────────
export async function testConnection(cfg) {
  const client = createClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
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
    return { success: false, message: err.message };
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}

// ── Buscar usuário no AD ──────────────────────────────────────────────────────
async function searchUser(client, cfg, login) {
  const escapedLogin = login.replace(/[*()\\\x00]/g, c => `\\${c.charCodeAt(0).toString(16)}`);

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
function resolveRole(groups, roleGroupMap = {}, defaultRole = 'AUXILIAR') {
  const map = { ...DEFAULT_ROLE_MAP, ...roleGroupMap };
  let highestRole = defaultRole;
  let highestPriority = ROLE_PRIORITY[defaultRole] ?? 0;

  for (const group of groups) {
    const role = map[group];
    if (role && ROLE_PRIORITY[role] !== undefined) {
      if (ROLE_PRIORITY[role] > highestPriority) {
        highestRole = role;
        highestPriority = ROLE_PRIORITY[role];
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
  const cfg = await getLdapConfig();
  if (!cfg) throw new Error('LDAP não configurado ou desabilitado');

  const client = createClient(cfg);

  try {
    // 1. Bind com service account
    await client.bind(cfg.bindDn, cfg.bindPassword);

    // 2. Buscar o usuário
    const entry = await searchUser(client, cfg, login);
    if (!entry) {
      logger.warn('LDAP: usuário não encontrado', { login });
      return null;
    }

    // 3. Verificar se está ativo no AD
    if (!isAdUserActive(entry)) {
      logger.warn('LDAP: conta desabilitada no AD', { login, dn: entry.dn });
      return { error: 'Conta desabilitada no Active Directory' };
    }

    // 4. Re-bind com credenciais do usuário (valida a senha)
    try {
      await client.bind(entry.dn, password);
    } catch (bindErr) {
      logger.warn('LDAP: senha inválida', { login, dn: entry.dn });
      return null; // senha errada
    }

    await client.unbind();

    // 5. Extrair atributos
    const email = (entry.mail || entry.userPrincipalName || `${login}@${cfg.domain || 'local'}`).toString().toLowerCase();
    const username = (entry.sAMAccountName || entry.uid || login).toString().toLowerCase();
    const firstName = (entry.givenName || entry.cn || login).toString();
    const lastName = (entry.sn || '').toString();
    const ldapDn = entry.dn.toString();
    const ldapGuid = entry.objectGUID ? Buffer.from(entry.objectGUID).toString('hex') : null;

    // 6. Resolver role pelos grupos
    const groups = extractGroups(entry);
    const role = resolveRole(groups, cfg.roleGroupMap, cfg.defaultRole || 'AUXILIAR');

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
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}

// ── Upsert do usuário LDAP no banco local ─────────────────────────────────────
async function upsertLdapUser({ email, username, firstName, lastName, ldapDn, ldapGuid, role, syncGroups }) {
  // Buscar por ldapDn ou email
  const existing = await prisma.user.findFirst({
    where: { OR: [{ ldapDn }, { email }] }
  });

  const data = {
    email,
    username,
    firstName,
    lastName,
    ldapDn,
    ldapGuid,
    authSource: 'ldap',
    status: 'ACTIVE',
    lastLogin: new Date(),
    // Só atualiza role se sincronização de grupos estiver ativa
    ...(syncGroups ? { role } : {}),
  };

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
    });
  }

  // Criar novo usuário
  return prisma.user.create({
    data: {
      ...data,
      role: role || 'AUXILIAR',
      // passwordHash null = autenticação apenas por LDAP
    },
  });
}

// ── Sincronizar todos os usuários do AD (importação em lote) ──────────────────
export async function syncAllUsersFromAD(cfg) {
  const client = createClient(cfg);
  const results = { created: 0, updated: 0, disabled: 0, errors: [] };

  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);

    const filter = cfg.syncFilter || '(&(objectClass=user)(objectCategory=person))';
    const attributes = [
      'dn', 'sAMAccountName', 'userPrincipalName', 'givenName', 'sn',
      'mail', 'memberOf', 'objectGUID', 'userAccountControl',
    ];

    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub', filter, attributes,
      sizeLimit: cfg.syncMaxUsers || 5000,
      paged: true,
    });

    for (const entry of searchEntries) {
      try {
        const active = isAdUserActive(entry);
        const email = (entry.mail || entry.userPrincipalName || '').toString().toLowerCase();
        const username = (entry.sAMAccountName || '').toString().toLowerCase();

        if (!email || !username) continue;

        const firstName = (entry.givenName || username).toString();
        const lastName = (entry.sn || '').toString();
        const ldapDn = entry.dn.toString();
        const ldapGuid = entry.objectGUID ? Buffer.from(entry.objectGUID).toString('hex') : null;
        const groups = extractGroups(entry);
        const role = resolveRole(groups, cfg.roleGroupMap, cfg.defaultRole || 'AUXILIAR');

        const existing = await prisma.user.findFirst({
          where: { OR: [{ ldapDn }, { email }] }
        });

        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              email, username, firstName, lastName, ldapDn, ldapGuid,
              authSource: 'ldap',
              status: active ? 'ACTIVE' : 'INACTIVE',
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

// ── Buscar grupos do AD (para mapear a roles) ─────────────────────────────────
export async function fetchADGroups(cfg) {
  const client = createClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const filter = cfg.groupFilter || '(objectClass=group)';
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub', filter,
      attributes: ['dn', 'cn', 'description'],
      sizeLimit: 500,
    });
    await client.unbind();
    return searchEntries.map(e => ({
      dn: e.dn?.toString(),
      cn: (e.cn || '').toString(),
      description: (e.description || '').toString(),
    }));
  } catch (err) {
    logger.error('LDAP fetchGroups error', { error: err.message });
    throw err;
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}
