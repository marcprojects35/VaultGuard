#!/bin/bash
# Testes de ponta a ponta do VaultGuard (cofre web + extensão no Chromium).
#
#   cd tests/e2e && npm install && npx playwright install chromium
#   ./run.sh ext.mjs      # extensão
#   ./run.sh web.mjs      # cofre web
#
# Cada execução usa um PostgreSQL descartável (container "vg-e2e-db", porta
# 55432) e sobe o backend na porta 3901. Nada do ambiente real é tocado.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
export OUT_DIR="$HERE/.out"
mkdir -p "$OUT_DIR"

DB_PORT=${E2E_DB_PORT:-55432}
export DATABASE_URL="postgresql://vg:e2e@127.0.0.1:${DB_PORT}/vg"

docker ps --format '{{.Names}}' | grep -q '^vg-e2e-db$' || {
  docker run -d --rm --name vg-e2e-db -e POSTGRES_DB=vg -e POSTGRES_USER=vg -e POSTGRES_PASSWORD=e2e \
    -p 127.0.0.1:${DB_PORT}:5432 postgres:16-alpine >/dev/null
  for i in $(seq 1 30); do docker exec vg-e2e-db pg_isready -U vg -d vg >/dev/null 2>&1 && break; sleep 1; done
  sleep 2
}
docker exec vg-e2e-db psql -U vg -d vg -qc "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1

# Builds usados pelos testes (frontend servido pelo backend; extensão carregada no Chromium)
(cd "$ROOT/frontend" && npx vite build >/dev/null 2>&1) || { echo "build do frontend falhou"; exit 1; }
(cd "$ROOT/extension" && npm run build >/dev/null 2>&1) || { echo "build da extensão falhou"; exit 1; }

cd "$ROOT/backend"
npx prisma migrate deploy >/dev/null 2>&1 || { echo "migrations falharam"; exit 1; }
ADMIN_PASSWORD='Adm1n!Test#2026' node src/prisma/seed.js >/dev/null 2>&1
JWT_SECRET=$(openssl rand -hex 32) PORT=3901 NODE_ENV=production TRUST_PROXY=0 FRONTEND_URL=http://127.0.0.1:3901 \
  node src/server.js > "$OUT_DIR/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s 127.0.0.1:3901/api/health >/dev/null && break; sleep 0.5; done

cd "$HERE"
node "$1"
