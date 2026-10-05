#!/bin/sh
set -e

# Roda como usuário sem privilégios: ajusta dono dos volumes (que podem ter
# sido criados como root em versões antigas) e reexecuta como "node"
if [ "$(id -u)" = "0" ]; then
    chown -R node:node /app/uploads /app/logs
    exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

echo "=== VaultGuard startup ==="

# Aguarda o banco aceitar conexões (segurança extra além do healthcheck)
MAX_RETRIES=10
RETRY=0
until npx prisma migrate deploy 2>&1; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "ERRO: migrations falharam após $MAX_RETRIES tentativas. Verifique a conexão com o banco."
        exit 1
    fi
    echo "Migration falhou (tentativa $RETRY/$MAX_RETRIES). Aguardando 5s..."
    sleep 5
done

echo "Migrations aplicadas."

# Seed (idempotente — seguro rodar sempre)
node src/prisma/seed.js 2>&1 || echo "Seed já aplicado ou erro não-fatal ignorado."

echo "Iniciando servidor..."
exec node src/server.js
