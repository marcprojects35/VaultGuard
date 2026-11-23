FROM node:22-bookworm AS builder

WORKDIR /app

# Dependências de compilação para sharp
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
FROM node:22-bookworm-slim

WORKDIR /app

# O sharp já traz o próprio libvips; o sistema só precisa do essencial, atualizado
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    openssl curl \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
COPY --from=builder /frontend/dist /frontend/dist
RUN test -d /frontend/dist && test -f /frontend/dist/index.html || (echo "ERROR: Frontend build missing!" && exit 1)

COPY backend/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p uploads logs
# Em produção não se instala nada: sem npm, menos código e menos falhas conhecidas
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
