FROM node:20-bullseye AS builder

WORKDIR /app

# Dependências do sistema para Argon2 e sharp
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ libvips-dev && rm -rf /var/lib/apt/lists/*

# Build do backend
COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ .
RUN npx prisma generate

# Build do frontend
COPY frontend/ /frontend/
RUN cd /frontend && npm ci && npm run build

# ── Imagem final ────────────────────────────────────────────────────────────
FROM node:20-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libvips42 openssl curl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
COPY --from=builder /frontend/dist /frontend/dist

RUN mkdir -p uploads logs

EXPOSE 3001

# Roda migrations + seed (upsert é idempotente) e inicia o servidor
CMD sh -c "npx prisma migrate deploy && node src/prisma/seed.js && node src/server.js"
