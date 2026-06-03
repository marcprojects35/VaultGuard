FROM node:20-alpine AS builder

WORKDIR /app

# Dependências do sistema para Argon2 e sharp
RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Gerar Prisma Client
RUN npx prisma generate

# Build do frontend (se existir)
COPY ../frontend /frontend
RUN if [ -d "/frontend" ]; then \
  cd /frontend && npm ci && npm run build; \
fi

# ── Imagem final ────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache vips openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Copia frontend buildado para ser servido pelo backend
RUN if [ -d "/frontend/dist" ]; then \
  cp -r /frontend/dist ./dist; \
fi

RUN mkdir -p uploads logs

EXPOSE 3001

# Aguarda DB e roda migrations + seed na primeira vez
CMD sh -c "npx prisma migrate deploy && node src/prisma/seed.js 2>/dev/null || true && node src/server.js"
