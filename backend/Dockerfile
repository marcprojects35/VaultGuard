FROM node:20-alpine AS builder

WORKDIR /app

# Dependências do sistema para Argon2 e sharp
RUN apk add --no-cache python3 make g++ vips-dev

# Build do backend
COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ .
RUN npx prisma generate

# Build do frontend
COPY frontend/ /frontend/
RUN cd /frontend && npm ci && npm run build

# ── Imagem final ────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache vips openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
COPY --from=builder /backend/dist ./dist

RUN mkdir -p uploads logs

EXPOSE 3001

# Roda migrations + seed (upsert é idempotente) e inicia o servidor
CMD sh -c "npx prisma migrate deploy && node src/prisma/seed.js && node src/server.js"
