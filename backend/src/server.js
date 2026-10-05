import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import folderRoutes from './routes/folders.js';
import credentialRoutes from './routes/credentials.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';
import apiTokenRoutes from './routes/apiTokens.js';
import ldapRoutes from './routes/ldap.js';
import favoritesRoutes from './routes/favorites.js';
import attachmentsRoutes from './routes/attachments.js';
import accessRequestsRoutes from './routes/accessRequests.js';
import securityDashboardRoutes from './routes/securityDashboard.js';
import rolesRoutes from './routes/roles.js';
import teamsRoutes from './routes/teams.js';
import keysRoutes from './routes/keys.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ipAllowlist } from './middleware/auth.js';
import { sendExpiryNotifications } from './services/email.js';
import { logger } from './utils/logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Recusa subir com segredo JWT ausente, curto ou de exemplo
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || /changeme|troque/i.test(JWT_SECRET)) {
  logger.error('JWT_SECRET ausente, curto (<32) ou com valor de exemplo. Gere um com: openssl rand -hex 64');
  process.exit(1);
}

// Atrás do nginx: usa X-Forwarded-For para IP real (rate limit e auditoria)
// e X-Forwarded-Proto para saber se a conexão é HTTPS (cookie Secure)
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// Security
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — só o próprio frontend. A extensão usa host_permissions, que não
// passam por CORS, então nenhuma origem chrome-extension:// precisa ser liberada.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
  credentials: true,
}));

app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

// Parâmetros de query são sempre texto simples: ?a[]=x ou ?a[b]=x chegariam
// como array/objeto e iriam direto para as consultas do Prisma
app.set('query parser', 'simple');
app.use((req, res, next) => {
  const clean = {};
  for (const [k, v] of Object.entries(req.query || {})) {
    if (/[[\]]/.test(k)) continue;
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === 'string') clean[k] = first;
  }
  Object.defineProperty(req, 'query', { value: clean, writable: true, configurable: true });
  next();
});

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' }
});

// Por sessão/token quando autenticado (empresas atrás de um único IP não
// dividem o limite entre todos); por IP nas requisições anônimas
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (auth) return `t:${createHash('sha256').update(auth).digest('hex').slice(0, 32)}`;
    const cookie = (req.headers.cookie || '').match(/vg_session=([^;]+)/);
    if (cookie) return `s:${createHash('sha256').update(cookie[1]).digest('hex').slice(0, 32)}`;
    return `ip:${req.ip}`;
  },
});

// Só os endpoints que recebem senha/código; /api/auth/me roda em todo carregamento
// Teto por IP (folgado), para trocar de token a cada requisição não driblar o limite
const ipLimiter = rateLimit({ windowMs: 60 * 1000, max: 1500 });

app.use(['/api/auth/login', '/api/auth/2fa/validate', '/api/auth/refresh', '/api/auth/verify-password',
  '/api/keys/me/private', '/api/keys/me/reset'], authLimiter);
app.use('/api', ipLimiter, apiLimiter);
app.use('/api', ipAllowlist);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/tokens', apiTokenRoutes);
app.use('/api/ldap', ldapRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/attachments', attachmentsRoutes);
app.use('/api/access-requests', accessRequestsRoutes);
app.use('/api/dashboard', securityDashboardRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/keys', keysRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`VaultGuard backend running on port ${PORT}`);
});

// Aviso diário de credenciais que vencem em até 7 dias
const DAY_MS = 24 * 60 * 60 * 1000;
const runExpiryJob = () => sendExpiryNotifications().catch(err => logger.error('Expiry notifications failed', { error: err.message }));
setTimeout(() => { runExpiryJob(); setInterval(runExpiryJob, DAY_MS).unref(); }, 60 * 1000).unref();

export default app;
