// Conexão única com o banco, compartilhada por todo o backend.
//
// Lixeira: senhas e pastas excluídas ganham deletedAt e somem de todas as
// consultas automaticamente. Para enxergá-las (lixeira, chaves de criptografia),
// a consulta precisa citar deletedAt no where — ex.: { deletedAt: { not: null } }
// ou WITH_DELETED, que traz as duas.
import { PrismaClient } from '@prisma/client';
import { seal, open } from './services/secretBox.js';

const SOFT_DELETE_MODELS = new Set(['Credential', 'Folder']);
const READ_OPERATIONS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'updateMany',
]);

/** Inclui itens da lixeira na consulta: where: { ...WITH_DELETED, ... } */
export const WITH_DELETED = { deletedAt: undefined };

// Segredos cifrados no banco e abertos só na leitura pelo backend
const USER_SECRETS = ['totpSecret', 'totpPendingSecret'];

function mapSettingsSecrets(row, fn) {
  const out = { ...row };
  if (out.ldapConfig && typeof out.ldapConfig === 'object') {
    const ldap = { ...out.ldapConfig };
    if (ldap.bindPassword) ldap.bindPassword = fn(ldap.bindPassword, 'ldap.bindPassword');
    if (Array.isArray(ldap.servers)) {
      ldap.servers = ldap.servers.map(sv => (sv?.bindPassword ? { ...sv, bindPassword: fn(sv.bindPassword, 'ldap.bindPassword') } : sv));
    }
    out.ldapConfig = ldap;
  }
  if (out.smtpConfig && typeof out.smtpConfig === 'object') {
    const smtp = { ...out.smtpConfig };
    if (smtp.smtp?.password) smtp.smtp = { ...smtp.smtp, password: fn(smtp.smtp.password, 'smtp.password') };
    if (smtp.office365?.clientSecret) smtp.office365 = { ...smtp.office365, clientSecret: fn(smtp.office365.clientSecret, 'office365.clientSecret') };
    out.smtpConfig = smtp;
  }
  return out;
}

function mapUserSecrets(row, fn) {
  const out = { ...row };
  for (const f of USER_SECRETS) if (typeof out[f] === 'string') out[f] = fn(out[f], `user.${f}`);
  return out;
}

const SECRET_MAPPERS = { User: mapUserSecrets, SystemSettings: mapSettingsSecrets };

function sealArgs(mapper, args) {
  if (!args) return args;
  const next = { ...args };
  for (const key of ['data', 'create', 'update']) {
    if (next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])) next[key] = mapper(next[key], seal);
  }
  return next;
}

function openResult(mapper, result) {
  if (Array.isArray(result)) return result.map(r => openResult(mapper, r));
  return result && typeof result === 'object' ? mapper(result, open) : result;
}

const base = new PrismaClient();

export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && READ_OPERATIONS.has(operation)) {
          const where = args?.where || {};
          if (!Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
            args = { ...args, where: { ...where, deletedAt: null } };
          }
        }
        const mapper = SECRET_MAPPERS[model];
        if (!mapper) return query(args);
        return openResult(mapper, await query(sealArgs(mapper, args)));
      },
    },
  },
});

export default prisma;
