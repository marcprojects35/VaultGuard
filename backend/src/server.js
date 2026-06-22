import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
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
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS — allow extension + frontend
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      /^chrome-extension:\/\//,
    ];
    if (!origin || allowed.some(p => typeof p === 'string' ? p === origin : p.test(origin))) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

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

export default app;
