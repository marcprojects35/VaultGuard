FROM node:20-bullseye AS builder

WORKDIR /app

# Dependências de compilação para Argon2 e sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Instala dependências do backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ .
RUN npx prisma generate

# Build do frontend
COPY frontend/ /frontend/
RUN cd /frontend && npm ci && npm run build

# ── Imagem final ────────────────────────────────────────────────────────────
FROM node:20-bullseye-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 openssl curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
COPY --from=builder /frontend/dist /frontend/dist

COPY backend/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p uploads logs

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
