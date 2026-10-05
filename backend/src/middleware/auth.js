import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { getSecuritySettings, passwordChangeRequired, isIpAllowed } from '../services/securitySettings.js';
import { hashToken, readCookie, SESSION_COOKIE } from '../utils/tokens.js';

const prisma = new PrismaClient();

// Rotas que um token de API (extensão / integrações) pode usar
const API_TOKEN_ALLOWED = [/^\/api\/credentials(\/|$)/, /^\/api\/folders(\/|$)/, /^\/api\/favorites(\/|$)/, /^\/api\/attachments(\/|$)/, /^\/api\/keys(\/|$)/, /^\/api\/auth\/me$/];
// Exportação/importação em massa nunca por token de API, mesmo de admin
const API_TOKEN_DENIED = [/^\/api\/credentials\/(export|vault-export|import)(\/|$)/];

// Rotas liberadas para quem ainda precisa ativar o 2FA obrigatório ou trocar
// a senha (a troca re-cifra a chave privada, por isso /api/keys/me)
const PENDING_ALLOWED = [/^\/api\/auth\//, /^\/api\/keys\/me(\/|$)/];
const PASSWORD_CHANGE_MSG = { error: 'Sua senha expirou ou precisa ser trocada', code: 'PASSWORD_CHANGE_REQUIRED' };

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function requestPath(req) {
  return req.originalUrl.split('?')[0];
}

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader
      ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader)
      : null;

    let fromCookie = false;
    if (!token) {
      token = readCookie(req, SESSION_COOKIE);
      fromCookie = !!token;
    }
    if (!token) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    // Sessão por cookie: exige header customizado em requests que alteram estado
    // (defesa extra contra CSRF além do SameSite=Strict)
    if (fromCookie && !SAFE_METHODS.includes(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'CSRF check failed' });
    }

    const security = await getSecuritySettings();
    const path = requestPath(req);

    // API token (prefixo "vg_") — guardado no banco apenas como hash
    if (token.startsWith('vg_')) {
      const apiToken = await prisma.apiToken.findUnique({
        where: { token: hashToken(token) },
        include: { user: true }
      });

      if (!apiToken) {
        return res.status(401).json({ error: 'Invalid API token' });
      }

      if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
        return res.status(401).json({ error: 'API token expired' });
      }

      if (apiToken.user.status !== 'ACTIVE') {
        return res.status(403).json({ error: 'Account inactive' });
      }

      if (API_TOKEN_DENIED.some(r => r.test(path)) || !API_TOKEN_ALLOWED.some(r => r.test(path))) {
        return res.status(403).json({ error: 'API tokens cannot access this endpoint' });
      }

      const needed = SAFE_METHODS.includes(req.method) ? 'read' : 'write';
      if (!apiToken.scopes.includes(needed)) {
        return res.status(403).json({ error: `API token missing "${needed}" scope` });
      }

      if (security.require2FA && !apiToken.user.totpEnabled) {
        return res.status(403).json({ error: '2FA obrigatório: ative o 2FA no perfil', code: '2FA_REQUIRED' });
      }
      if (await passwordChangeRequired(apiToken.user)) return res.status(403).json(PASSWORD_CHANGE_MSG);

      await prisma.apiToken.update({
        where: { id: apiToken.id },
        data: { lastUsed: new Date() }
      });

      req.user = apiToken.user;
      req.tokenScopes = apiToken.scopes;
      req.isApiToken = true;
      return next();
    }

    // JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Token temporário (senha ok, 2FA pendente) não vale como sessão
    if (decoded.temp) {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    // Sessão revogada (logout, troca/reset de senha, mudança de status)
    if ((decoded.tv ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ error: 'Session revoked' });
    }

    const pendingAllowed = PENDING_ALLOWED.some(r => r.test(path));
    if (security.require2FA && !user.totpEnabled && !pendingAllowed) {
      return res.status(403).json({ error: '2FA obrigatório: ative o 2FA no perfil', code: '2FA_REQUIRED' });
    }
    if (!pendingAllowed && await passwordChangeRequired(user)) {
      return res.status(403).json(PASSWORD_CHANGE_MSG);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    next(err);
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const roleHierarchy = {
    AUXILIAR: 0,
    ASSISTENTE: 1,
    ANALISTA: 2,
    COORDENACAO: 3,
    DIRETORIA: 4,
    ADMINISTRADOR: 5,
  };

  const userLevel = roleHierarchy[req.user.role] ?? -1;
  const requiredLevel = Math.min(...roles.map(r => roleHierarchy[r] ?? 99));

  if (userLevel < requiredLevel) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

export const requireAdmin = requireRole('ADMINISTRADOR');

// Whitelist de IPs da tela de segurança. Vale para toda a API, inclusive o
// login; /api/health fica livre para o healthcheck do container.
export const ipAllowlist = async (req, res, next) => {
  try {
    if (req.path === '/health') return next();
    const { allowedIPs } = await getSecuritySettings();
    if (isIpAllowed(req.ip, allowedIPs)) return next();
    return res.status(403).json({ error: 'Acesso não permitido a partir deste endereço IP', code: 'IP_NOT_ALLOWED' });
  } catch (err) {
    next(err);
  }
};
