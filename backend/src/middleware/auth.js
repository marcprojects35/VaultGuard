import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    // Check if it's an API token (starts with "vg_")
    if (token.startsWith('vg_')) {
      const apiToken = await prisma.apiToken.findUnique({
        where: { token },
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

      // Update last used
      await prisma.apiToken.update({
        where: { id: apiToken.id },
        data: { lastUsed: new Date() }
      });

      req.user = apiToken.user;
      req.tokenScopes = apiToken.scopes;
      req.isApiToken = true;
      return next();
    }

    // JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid or inactive user' });
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
