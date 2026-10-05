import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';

// Allow ±1 TOTP period (30s window) to tolerate minor clock skew
authenticator.options = { window: 1 };
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';
import { getLdapConfig, authenticateWithAD } from '../services/ldap.js';
import { verifyUserPassword } from '../services/passwordCheck.js';
import logger from '../utils/logger.js';
import { getSecuritySettings, checkPasswordPolicy, passwordChangeRequired } from '../services/securitySettings.js';
import { notifyLockout, trackLoginDevice, notifyPasswordChanged, notifyAdminAlert } from '../services/notifications.js';
import { readCookie, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from '../utils/tokens.js';

const prisma = new PrismaClient();

function generateSalt() {
  return randomBytes(32).toString('hex');
}

const signTempToken = (userId) =>
  jwt.sign({ userId, temp: true }, process.env.JWT_SECRET, { expiresIn: '5m' });

function buildSafeUser(user) {
  const {
    passwordHash, totpSecret, totpPendingSecret, totpLastStep, totpRecoveryCodes, passwordHistory,
    failedLoginAttempts, lockedUntil, tokenVersion, encryptedPrivateKey, ...safe
  } = user;
  return { ...safe, recoveryCodesLeft: totpRecoveryCodes?.length || 0 };
}

// Respeita a opção "Registrar logins com falha" da tela de segurança
async function logLoginFailure(userId, details, ip, ua) {
  const { logFailedLogins } = await getSecuritySettings();
  if (logFailedLogins) await createAuditLog(userId, 'user.login_failed', null, null, details, ip, ua);
}

// Emite a sessão em cookie httpOnly (o JWT nunca fica acessível ao JavaScript)
async function startSession(req, res, user) {
  const { sessionTimeout, require2FA } = await getSecuritySettings();
  const token = jwt.sign(
    { userId: user.id, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: `${sessionTimeout}m` }
  );
  setSessionCookie(req, res, token, sessionTimeout * 60 * 1000);
  return {
    requires2FASetup: require2FA && !user.totpEnabled,
    requiresPasswordChange: await passwordChangeRequired(user),
  };
}

function isLocked(user) {
  return user.lockedUntil && user.lockedUntil > new Date();
}

async function registerFailedAttempt(user, ip) {
  const { maxLoginAttempts, lockoutMinutes } = await getSecuritySettings();
  const attempts = (user.failedLoginAttempts || 0) + 1;
  if (attempts >= maxLoginAttempts) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + lockoutMinutes * 60 * 1000) },
    });
    await createAuditLog(user.id, 'user.locked', null, null, { attempts }, ip, null);
    notifyLockout(user, ip, attempts);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts } });
  }
}

async function clearFailedAttempts(user) {
  if (user.failedLoginAttempts || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }
}

// Hash fixo para comparar quando o usuário não existe: o tempo de resposta
// fica igual ao de senha errada e não revela quais logins existem
const DUMMY_HASH = bcrypt.hashSync('vaultguard-timing-dummy', 12);

// Confere o código TOTP e recusa reuso de um código já aceito.
// Retorna o passo (para gravar em totpLastStep) ou null.
function checkTotp(user, token, secret = user.totpSecret) {
  const delta = authenticator.checkDelta(String(token || ''), secret);
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (user.totpLastStep != null && step <= user.totpLastStep) return null;
  return step;
}

const LOCKED_MSG = 'Conta bloqueada temporariamente por excesso de tentativas. Tente novamente mais tarde.';

async function ensureUserHasSalt(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { encryptionSalt: true } });
  if (!user.encryptionSalt) {
    const salt = generateSalt();
    await prisma.user.update({ where: { id: userId }, data: { encryptionSalt: salt } });
    return salt;
  }
  return user.encryptionSalt;
}

async function ensureUserHasPersonalFolder(userId, firstName) {
  const existing = await prisma.folder.findFirst({
    where: { isPersonal: true, ownerId: userId }
  });
  if (!existing) {
    await prisma.folder.create({
      data: {
        name: `Pasta de ${firstName}`,
        icon: 'lock',
        color: '#8b5cf6',
        isPersonal: true,
        ownerId: userId,
      }
    });
  }
}

export const login = async (req, res, next) => {
  try {
    const { login: loginInput, password } = req.body;
    const ip = req.ip;
    const ua = req.headers['user-agent'];
    const normalizedLogin = loginInput.toLowerCase().trim();

    // ── 1. Verificar se LDAP está habilitado ──────────────────────────────
    const ldapCfg = await getLdapConfig();

    // Admin de emergência: mesmo em modo "Somente LDAP", uma conta local com
    // cargo ADMINISTRADOR pode logar com a senha local — evita perder acesso
    // à plataforma por causa de um AD fora do ar ou mal configurado.
    let isEmergencyAdmin = false;
    if (ldapCfg?.ldapOnly) {
      const emergencyAdmin = await prisma.user.findFirst({
        where: {
          OR: [{ email: normalizedLogin }, { username: normalizedLogin }],
          authSource: 'local',
          role: 'ADMINISTRADOR',
          status: 'ACTIVE',
        },
      });
      isEmergencyAdmin = !!emergencyAdmin;
    }

    if (ldapCfg && !isEmergencyAdmin) {
      try {
        const ldapUser = await authenticateWithAD(normalizedLogin, password, ip, ua);

        if (ldapUser === null) {
          if (!ldapCfg.ldapOnly) {
            // Continua para auth local abaixo
          } else {
            await logLoginFailure(null, { reason: 'ldap_invalid_credentials', login: normalizedLogin }, ip, ua);
            return res.status(401).json({ error: 'Invalid credentials' });
          }
        } else if (ldapUser?.error) {
          return res.status(403).json({ error: ldapUser.error });
        } else if (ldapUser) {
          if (ldapUser.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account not active. Contact administrator.' });
          }
          // Garante salt e pasta pessoal para usuários LDAP
          const encryptionSalt = await ensureUserHasSalt(ldapUser.id);
          await ensureUserHasPersonalFolder(ldapUser.id, ldapUser.firstName);

          if (isLocked(ldapUser)) return res.status(423).json({ error: LOCKED_MSG });
          if (ldapUser.totpEnabled) {
            const tempToken = signTempToken(ldapUser.id);
            return res.json({ requires2FA: true, tempToken, encryptionSalt });
          }
          await trackLoginDevice(ldapUser, ip, ua);
          const session = await startSession(req, res, ldapUser);
          return res.json({
            ...session,
            user: { ...buildSafeUser(ldapUser), encryptionSalt },
            authMethod: 'ldap'
          });
        }
      } catch (ldapErr) {
        if (ldapErr.code === 'LOCAL_ACCOUNT_CONFLICT') {
          return res.status(409).json({ error: ldapErr.message });
        }
        if (!ldapCfg.ldapOnly) {
          logger.warn('LDAP error, falling back to local auth', { error: ldapErr.message });
        } else {
          return res.status(503).json({ error: 'LDAP server unavailable. Contact administrator.' });
        }
      }
    }

    // ── 2. Autenticação local ─────────────────────────────────────────────
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedLogin },
          { username: normalizedLogin },
        ],
        authSource: 'local',
      },
    });

    if (!user || !user.passwordHash) {
      await bcrypt.compare(password, DUMMY_HASH);
      await logLoginFailure(null, { reason: 'user_not_found', login: normalizedLogin }, ip, ua);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account not active. Contact administrator.' });
    }

    if (isLocked(user)) {
      await logLoginFailure(user.id, { reason: 'locked' }, ip, ua);
      return res.status(423).json({ error: LOCKED_MSG });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await registerFailedAttempt(user, ip);
      await logLoginFailure(user.id, { reason: 'wrong_password' }, ip, ua);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Garante salt e pasta pessoal
    const encryptionSalt = await ensureUserHasSalt(user.id);
    await ensureUserHasPersonalFolder(user.id, user.firstName);

    if (user.totpEnabled) {
      const tempToken = signTempToken(user.id);
      // Pass salt in temp token response so client can derive key after 2FA
      return res.json({ requires2FA: true, tempToken, encryptionSalt });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    await createAuditLog(user.id, 'user.login', null, null, { method: 'local' }, ip, ua);
    await trackLoginDevice(user, ip, ua);

    const session = await startSession(req, res, user);
    res.json({
      ...session,
      user: { ...buildSafeUser(user), encryptionSalt },
      authMethod: 'local'
    });
  } catch (err) {
    next(err);
  }
};

export const validate2FA = async (req, res, next) => {
  try {
    const { token: totpToken, tempToken, recoveryCode } = req.body;
    const ip = req.ip;
    const ua = req.headers['user-agent'];

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired temp token' });
    }

    if (!decoded.temp) return res.status(401).json({ error: 'Invalid token type' });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.totpSecret || user.status !== 'ACTIVE') return res.status(401).json({ error: 'User not found' });
    if (isLocked(user)) return res.status(423).json({ error: LOCKED_MSG });

    let step = null;
    let remainingCodes = null;
    if (recoveryCode) {
      // Código de recuperação: vale uma vez, e só se a política permitir
      const { allow2FARecovery } = await getSecuritySettings();
      const normalized = String(recoveryCode).trim().toLowerCase();
      let matched = -1;
      if (allow2FARecovery) {
        for (let i = 0; i < user.totpRecoveryCodes.length; i++) {
          if (await bcrypt.compare(normalized, user.totpRecoveryCodes[i])) { matched = i; break; }
        }
      }
      if (matched >= 0) remainingCodes = user.totpRecoveryCodes.filter((_, i) => i !== matched);
    } else {
      step = checkTotp(user, totpToken);
    }
    if (step === null && remainingCodes === null) {
      await registerFailedAttempt(user, ip);
      await logLoginFailure(user.id, { reason: recoveryCode ? 'wrong_recovery_code' : 'wrong_2fa' }, ip, ua);
      return res.status(401).json({ error: recoveryCode ? 'Código de recuperação inválido' : 'Invalid 2FA code' });
    }

    await clearFailedAttempts(user);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLogin: new Date(),
        ...(step !== null && { totpLastStep: step }),
        ...(remainingCodes !== null && { totpRecoveryCodes: remainingCodes }),
      },
    });
    await createAuditLog(user.id, 'user.login', null, null, { method: remainingCodes !== null ? '2fa_recovery_code' : '2fa' }, ip, ua);
    if (remainingCodes !== null) {
      notifyAdminAlert('código de recuperação do 2FA usado', `${user.email} entrou com um código de recuperação do 2FA (restam ${remainingCodes.length}).`);
    }
    await trackLoginDevice(user, ip, ua);

    const encryptionSalt = await ensureUserHasSalt(user.id);
    const session = await startSession(req, res, user);
    res.json({
      ...session,
      user: { ...buildSafeUser(user), encryptionSalt }
    });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req, res) => {
  // Invalida todos os JWTs emitidos para o usuário (inclusive em outros navegadores)
  if (!req.isApiToken) {
    await prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } });
  }
  clearSessionCookie(req, res);
  await createAuditLog(req.user.id, 'user.logout', null, null, null, req.ip, req.headers['user-agent']);
  res.json({ message: 'Logged out successfully' });
};

export const refresh = async (req, res) => {
  try {
    const token = readCookie(req, SESSION_COOKIE) || req.body?.token;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.temp) return res.status(401).json({ error: 'Invalid token type' });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.status !== 'ACTIVE' || (decoded.tv ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const session = await startSession(req, res, user);
    res.json(session);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const me = async (req, res) => {
  const encryptionSalt = await ensureUserHasSalt(req.user.id);
  const { require2FA } = await getSecuritySettings();
  res.json({
    ...buildSafeUser(req.user),
    encryptionSalt,
    requires2FASetup: require2FA && !req.user.totpEnabled,
    requiresPasswordChange: await passwordChangeRequired(req.user),
  });
};

export const setup2FA = async (req, res, next) => {
  try {
    // Com 2FA ativo, o segredo só muda depois de desativar (o que exige o código atual)
    if (req.user.totpEnabled) {
      return res.status(400).json({ error: 'O 2FA já está ativo. Desative-o antes de configurar outro dispositivo.' });
    }
    const secret = authenticator.generateSecret();
    const siteName = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.siteName || 'VaultGuard';
    const otpauth = authenticator.keyuri(req.user.email, siteName, secret);
    const qrCode = await QRCode.toDataURL(otpauth);
    await prisma.user.update({ where: { id: req.user.id }, data: { totpPendingSecret: secret } });
    res.json({ secret, qrCode });
  } catch (err) {
    next(err);
  }
};

export const verify2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.totpPendingSecret) return res.status(400).json({ error: 'No 2FA setup in progress' });
    const step = checkTotp({ ...user, totpLastStep: null }, token, user.totpPendingSecret);
    if (step === null) return res.status(400).json({ error: 'Invalid code' });
    await prisma.user.update({
      where: { id: req.user.id },
      data: { totpEnabled: true, totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpLastStep: step },
    });
    await createAuditLog(req.user.id, 'user.2fa_enabled', null, null, null, req.ip);
    res.json({ message: '2FA enabled successfully' });
  } catch (err) {
    next(err);
  }
};

export const disable2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.totpEnabled) {
      const { require2FA } = await getSecuritySettings();
      if (require2FA) return res.status(403).json({ error: 'O 2FA é obrigatório nesta organização e não pode ser desativado.' });
      if (!token) return res.status(400).json({ error: 'Token required' });
      if (checkTotp(user, token) === null) return res.status(400).json({ error: 'Invalid 2FA code' });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { totpEnabled: false, totpSecret: null, totpPendingSecret: null, totpLastStep: null, totpRecoveryCodes: [] } });
    await createAuditLog(req.user.id, 'user.2fa_disabled', null, null, null, req.ip);
    res.json({ message: '2FA disabled' });
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (user.authSource === 'ldap') {
      return res.status(400).json({ error: 'Usuários do AD devem alterar a senha pelo Active Directory.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });

    const policyError = await checkPasswordPolicy(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });

    // Não aceita a senha atual nem as últimas N (política "impedir reuso")
    const { passwordPolicy } = await getSecuritySettings();
    const recent = [user.passwordHash, ...(user.passwordHistory || []).slice(0, passwordPolicy.preventReuse)];
    for (const old of recent) {
      if (old && await bcrypt.compare(newPassword, old)) {
        return res.status(400).json({ error: passwordPolicy.preventReuse
          ? `A nova senha não pode repetir nenhuma das últimas ${passwordPolicy.preventReuse} senhas`
          : 'A nova senha precisa ser diferente da atual' });
      }
    }

    // A chave privada precisa vir re-cifrada com a senha nova (o salt não muda),
    // senão o usuário perderia acesso às próprias chaves
    const { encryptedPrivateKey } = req.body;
    if (user.publicKey && (typeof encryptedPrivateKey !== 'string' || !encryptedPrivateKey)) {
      return res.status(400).json({ error: 'Desbloqueie o cofre antes de trocar a senha' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    // tokenVersion++ derruba as outras sessões; a atual recebe um cookie novo
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        passwordHash: hash, tokenVersion: { increment: 1 },
        passwordChangedAt: new Date(), mustChangePassword: false,
        passwordHistory: [user.passwordHash, ...(user.passwordHistory || [])].filter(Boolean).slice(0, 24),
        ...(user.publicKey && { encryptedPrivateKey }),
      },
    });
    await createAuditLog(req.user.id, 'user.password_changed', null, null, null, req.ip);
    notifyPasswordChanged(updated);
    await startSession(req, res, updated);
    res.json({ message: 'Password changed successfully', encryptionSalt: updated.encryptionSalt });
  } catch (err) {
    next(err);
  }
};

// Usado pelo cofre para diferenciar "senha errada" de "senha mudou desde que
// as chaves foram cifradas" (troca de senha no AD)
export const verifyPassword = async (req, res, next) => {
  try {
    const valid = await verifyUserPassword(req.user, req.body.password);
    if (!valid) {
      if (req.user.authSource !== 'ldap') await registerFailedAttempt(req.user, req.ip);
      return res.status(400).json({ error: 'Senha incorreta' });
    }
    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
};

// Gera 10 códigos de recuperação do 2FA (exibidos uma única vez).
// Exige o código atual do app autenticador.
export const generateRecoveryCodes = async (req, res, next) => {
  try {
    const { allow2FARecovery } = await getSecuritySettings();
    if (!allow2FARecovery) return res.status(403).json({ error: 'Códigos de recuperação estão desativados pela organização' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.totpEnabled) return res.status(400).json({ error: 'Ative o 2FA antes' });
    const step = checkTotp(user, req.body.token);
    if (step === null) return res.status(400).json({ error: 'Invalid 2FA code' });

    const codes = Array.from({ length: 10 }, () => {
      const hex = randomBytes(5).toString('hex');
      return `${hex.slice(0, 5)}-${hex.slice(5)}`;
    });
    const hashes = await Promise.all(codes.map(c => bcrypt.hash(c, 10)));
    await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: hashes, totpLastStep: step } });
    await createAuditLog(user.id, 'user.2fa_recovery_codes_generated', null, null, null, req.ip);
    res.json({ codes });
  } catch (err) {
    next(err);
  }
};
