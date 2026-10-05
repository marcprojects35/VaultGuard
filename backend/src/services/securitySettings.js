import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CACHE_MS = 10 * 1000;
let cached = null;
let cachedAt = 0;

// Lista de IPs/CIDRs (um por linha; # comenta)
function parseAllowedIPs(text) {
  return String(text || '')
    .split(/[\n,]/)
    .map(l => l.replace(/#.*/, '').trim())
    .filter(Boolean);
}

/**
 * Configurações de segurança usadas em todo request autenticado.
 * Cache curto para não bater no banco a cada chamada.
 */
export async function getSecuritySettings() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const s = await prisma.systemSettings.findUnique({
    where: { id: 'singleton' },
    select: { require2FA: true, sessionTimeout: true, maxLoginAttempts: true, passwordPolicy: true, smtpConfig: true },
  });
  const policy = s?.passwordPolicy || {};
  const notifications = s?.smtpConfig?.notifications || {};
  cached = {
    require2FA: !!s?.require2FA,
    sessionTimeout: s?.sessionTimeout > 0 ? s.sessionTimeout : 480,
    maxLoginAttempts: s?.maxLoginAttempts > 0 ? s.maxLoginAttempts : 5,
    lockoutMinutes: Number(policy.lockoutDurationMin) > 0 ? Number(policy.lockoutDurationMin) : 15,
    passwordPolicy: {
      minLength: Number(policy.minLength) > 0 ? Number(policy.minLength) : 8,
      requireUppercase: !!policy.requireUppercase,
      requireNumbers: !!policy.requireNumbers,
      requireSymbols: !!policy.requireSymbols,
      // 0 = nunca expira / sem histórico
      expireDays: Number(policy.expireDays) > 0 ? Number(policy.expireDays) : 0,
      preventReuse: Math.min(Math.max(Number(policy.preventReuse) || 0, 0), 24),
    },
    logFailedLogins: policy.logFailedLogins !== false,
    alertOnNewDevice: policy.alertOnNewDevice !== false,
    allow2FARecovery: policy.allow2FARecovery !== false,
    allowedIPs: parseAllowedIPs(policy.allowedIPs),
    // Mesmos padrões da tela de e-mail
    notifications: {
      newUser: notifications.notifyNewUser ?? true,
      passwordReset: notifications.notifyPasswordReset ?? true,
      failedLogin: notifications.notifyFailedLogin ?? false,
      newDevice: notifications.notifyNewDevice ?? true,
      adminAlert: notifications.notifyAdminAlert ?? true,
      credentialView: notifications.notifyCredentialView ?? false,
    },
  };
  cachedAt = Date.now();
  return cached;
}

export function invalidateSecuritySettings() {
  cached = null;
}

/**
 * Valida uma senha nova contra a política configurada.
 * Retorna a mensagem de erro, ou null se a senha é aceita.
 */
export async function checkPasswordPolicy(password) {
  const { passwordPolicy: p } = await getSecuritySettings();
  const pw = String(password || '');
  if (pw.length < p.minLength) return `A senha deve ter pelo menos ${p.minLength} caracteres`;
  if (p.requireUppercase && !/[A-Z]/.test(pw)) return 'A senha deve ter ao menos uma letra maiúscula';
  if (p.requireNumbers && !/[0-9]/.test(pw)) return 'A senha deve ter ao menos um número';
  if (p.requireSymbols && !/[^A-Za-z0-9]/.test(pw)) return 'A senha deve ter ao menos um símbolo';
  return null;
}

/** Senha local expirada pela política ou marcada para troca obrigatória. */
export async function passwordChangeRequired(user) {
  if (user.authSource === 'ldap') return false;
  if (user.mustChangePassword) return true;
  const { passwordPolicy: p } = await getSecuritySettings();
  if (!p.expireDays || !user.passwordChangedAt) return false;
  return Date.now() - new Date(user.passwordChangedAt).getTime() > p.expireDays * 24 * 60 * 60 * 1000;
}

// ─── IP allowlist ────────────────────────────────────────────────────────────

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '').toLowerCase();
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** IP exato (v4/v6) ou bloco CIDR IPv4. */
export function ipMatches(ip, rule) {
  const addr = normalizeIp(ip);
  const r = normalizeIp(rule);
  if (!r.includes('/')) return addr === r;
  const [base, bitsStr] = r.split('/');
  const bits = Number(bitsStr);
  const a = ipv4ToInt(addr);
  const b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export function isIpAllowed(ip, rules) {
  if (!rules.length) return true;
  const addr = normalizeIp(ip);
  if (addr === '127.0.0.1' || addr === '::1') return true;
  return rules.some(rule => ipMatches(addr, rule));
}
