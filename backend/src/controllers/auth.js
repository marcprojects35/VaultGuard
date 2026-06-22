import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/audit.js';
import { getLdapConfig, authenticateWithAD } from '../services/ldap.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

function generateSalt() {
  return randomBytes(32).toString('hex');
}

const signToken = (userId, expiresIn = '8h') =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn });

const signTempToken = (userId) =>
  jwt.sign({ userId, temp: true }, process.env.JWT_SECRET, { expiresIn: '5m' });

function buildSafeUser(user) {
  const { passwordHash, totpSecret, ...safe } = user;
  return safe;
}

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
    if (ldapCfg) {
      try {
        const ldapUser = await authenticateWithAD(normalizedLogin, password, ip, ua);

        if (ldapUser === null) {
          if (!ldapCfg.ldapOnly) {
            // Continua para auth local abaixo
          } else {
            await createAuditLog(null, 'user.login_failed', null, null,
              { reason: 'ldap_invalid_credentials', login: normalizedLogin }, ip, ua);
            return res.status(401).json({ error: 'Invalid credentials' });
          }
        } else if (ldapUser?.error) {
          return res.status(403).json({ error: ldapUser.error });
        } else if (ldapUser) {
          // Garante salt e pasta pessoal para usuários LDAP
          const encryptionSalt = await ensureUserHasSalt(ldapUser.id);
          await ensureUserHasPersonalFolder(ldapUser.id, ldapUser.firstName);

          if (ldapUser.totpEnabled) {
            const tempToken = signTempToken(ldapUser.id);
            return res.json({ requires2FA: true, tempToken });
          }
          const token = signToken(ldapUser.id);
          return res.json({
            token,
            user: { ...buildSafeUser(ldapUser), encryptionSalt },
            authMethod: 'ldap'
          });
        }
      } catch (ldapErr) {
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
      await createAuditLog(null, 'user.login_failed', null, null,
        { reason: 'user_not_found', login: normalizedLogin }, ip, ua);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account not active. Contact administrator.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await createAuditLog(user.id, 'user.login_failed', null, null, { reason: 'wrong_password' }, ip, ua);
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

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await createAuditLog(user.id, 'user.login', null, null, { method: 'local' }, ip, ua);

    const token = signToken(user.id);
    res.json({
      token,
      user: { ...buildSafeUser(user), encryptionSalt },
      authMethod: 'local'
    });
  } catch (err) {
    next(err);
  }
};

export const validate2FA = async (req, res, next) => {
  try {
    const { token: totpToken, tempToken } = req.body;
    const ip = req.ip;
    const ua = req.headers['user-agent'];

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired temp token' });
    }

    if (!decoded.temp) return res.status(401).json({ error: 'Invalid token type' });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.totpSecret) return res.status(401).json({ error: 'User not found' });

    const valid = authenticator.verify({ token: totpToken, secret: user.totpSecret });
    if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await createAuditLog(user.id, 'user.login', null, null, { method: '2fa' }, ip, ua);

    const encryptionSalt = await ensureUserHasSalt(user.id);
    const jwtToken = signToken(user.id);
    res.json({
      token: jwtToken,
      user: { ...buildSafeUser(user), encryptionSalt }
    });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req, res) => {
  await createAuditLog(req.user.id, 'user.logout', null, null, null, req.ip, req.headers['user-agent']);
  res.json({ message: 'Logged out successfully' });
};

export const refresh = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const newToken = signToken(decoded.userId);
    res.json({ token: newToken });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const me = async (req, res) => {
  const encryptionSalt = await ensureUserHasSalt(req.user.id);
  const { passwordHash, totpSecret, ...safeUser } = req.user;
  res.json({ ...safeUser, encryptionSalt });
};

export const setup2FA = async (req, res, next) => {
  try {
    const secret = authenticator.generateSecret();
    const siteName = (await prisma.systemSettings.findUnique({ where: { id: 'singleton' } }))?.siteName || 'VaultGuard';
    const otpauth = authenticator.keyuri(req.user.email, siteName, secret);
    const qrCode = await QRCode.toDataURL(otpauth);
    await prisma.user.update({ where: { id: req.user.id }, data: { totpSecret: secret } });
    res.json({ secret, qrCode });
  } catch (err) {
    next(err);
  }
};

export const verify2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.totpSecret) return res.status(400).json({ error: 'No 2FA setup in progress' });
    const valid = authenticator.verify({ token, secret: user.totpSecret });
    if (!valid) return res.status(400).json({ error: 'Invalid code' });
    await prisma.user.update({ where: { id: req.user.id }, data: { totpEnabled: true } });
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
      if (!token) return res.status(400).json({ error: 'Token required' });
      const valid = authenticator.verify({ token, secret: user.totpSecret });
      if (!valid) return res.status(400).json({ error: 'Invalid 2FA code' });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { totpEnabled: false, totpSecret: null } });
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

    const hash = await bcrypt.hash(newPassword, 12);
    // Regenerate salt when password changes (credentials need re-encryption on next login)
    const encryptionSalt = generateSalt();
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: hash, encryptionSalt } });
    await createAuditLog(req.user.id, 'user.password_changed', null, null, null, req.ip);
    res.json({ message: 'Password changed successfully', encryptionSalt });
  } catch (err) {
    next(err);
  }
};
