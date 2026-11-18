#!/bin/bash
# Backup cifrado do VaultGuard: banco de dados e imagens enviadas.
#
#   bash scripts/backup.sh [pasta-de-destino] [dias-de-retenção]
#
# Cifra com GPG (AES-256) usando a senha do arquivo BACKUP_KEY_FILE (padrão
# /root/.vaultguard-backup.key, criado na primeira execução, modo 600).
# Guarde uma cópia dessa senha E da DATA_ENCRYPTION_KEY do .env fora do servidor:
# sem elas o backup não pode ser restaurado.
#
# Restaurar o banco:
#   gpg --batch --pinentry-mode loopback --passphrase-file <key> -d vg-AAAAMMDD-HHMM.tar.gz.gpg | tar xz
#   gunzip -c db.sql.gz | docker exec -i vaultguard-db psql -U vaultguard vaultguard
set -euo pipefail

DEST="${1:-/opt/vaultguard-backups}"
KEEP_DAYS="${2:-30}"
KEY_FILE="${BACKUP_KEY_FILE:-/root/.vaultguard-backup.key}"

umask 077
mkdir -p "$DEST"
[ -s "$KEY_FILE" ] || openssl rand -hex 32 > "$KEY_FILE"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
docker exec vaultguard-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$TMP/db.sql.gz"
gunzip -t "$TMP/db.sql.gz"
docker exec vaultguard-api tar czf - -C /app uploads > "$TMP/uploads.tar.gz"

FILE="$DEST/vg-$(date +%Y%m%d-%H%M).tar.gz.gpg"
tar czf - -C "$TMP" db.sql.gz uploads.tar.gz \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$KEY_FILE" \
        --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 -o "$FILE"

# Confere se o arquivo abre antes de apagar os antigos
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE" -d "$FILE" | tar tz >/dev/null
find "$DEST" -name 'vg-*.tar.gz.gpg' -mtime +"$KEEP_DAYS" -delete
echo "Backup: $FILE"
