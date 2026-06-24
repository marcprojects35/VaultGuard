#!/bin/bash
# VaultGuard — Desinstalação

set -euo pipefail

R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' W='\033[1;37m' DIM='\033[2m' NC='\033[0m'

echo -e "${R}${W}"
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║          VaultGuard — Desinstalação                      ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${R}ATENÇÃO: Esta operação não pode ser desfeita.${NC}"
echo

# Detectar compose
if docker compose version &>/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE="docker-compose"
else
    echo -e "  ${R}Docker Compose não encontrado.${NC}"
    exit 1
fi

echo -ne "  ${Y}Confirma a remoção do VaultGuard?${NC} [s/N]: "
read -r reply
[[ "$reply" =~ ^[sSyY] ]] || { echo "  Cancelado."; exit 0; }

echo
echo -ne "  ${R}Remover também todos os dados do banco de dados?${NC} [s/N]: "
read -r remove_data
echo

# Para e remove containers e rede
echo -e "  Parando containers..."
$COMPOSE down 2>/dev/null || true

if [[ "$remove_data" =~ ^[sSyY] ]]; then
    echo -e "  ${R}Removendo volumes (banco de dados, uploads, logs)...${NC}"
    $COMPOSE down -v 2>/dev/null || true
    echo -e "  ${G}Volumes removidos.${NC}"
else
    echo -e "  Dados preservados. Os volumes Docker ainda existem."
    echo -e "  Para remover manualmente: docker volume rm vaultguard_postgres_data"
fi

# Remove imagens
echo
echo -ne "  Remover imagens Docker do VaultGuard? [s/N]: "
read -r remove_images
if [[ "$remove_images" =~ ^[sSyY] ]]; then
    docker rmi vaultguard-vaultguard-api 2>/dev/null || \
    docker rmi "$(docker images | grep vaultguard | awk '{print $3}')" 2>/dev/null || true
    echo -e "  ${G}Imagens removidas.${NC}"
fi

# Remove arquivos locais opcionalmente
echo
echo -ne "  Remover .env e ssl/ ? [s/N]: "
read -r remove_files
if [[ "$remove_files" =~ ^[sSyY] ]]; then
    rm -f .env docker-compose.ssl.yml
    rm -rf ssl/
    echo -e "  ${G}Arquivos de configuração removidos.${NC}"
fi

echo
echo -e "  ${G}VaultGuard removido.${NC}"
echo -e "  ${DIM}Para reinstalar: bash install.sh${NC}"
echo
