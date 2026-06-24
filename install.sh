#!/bin/bash
# VaultGuard — Instalação automática
# Suportado: Ubuntu 20+, Debian 11+, CentOS 7+, RHEL 8+

set -euo pipefail

# ── Cores ────────────────────────────────────────────────────────────────────
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m' C='\033[0;36m'
W='\033[1;37m' DIM='\033[2m' NC='\033[0m'

# ── Banner ───────────────────────────────────────────────────────────────────
clear
echo -e "${B}${W}"
cat << 'BANNER'
 __   __         _ _   _____                     _
 \ \ / /_ _ _  _| | |_/ ____|                   | |
  \ V / _` | || | |  _| |  __ _   _  __ _ _ __ __| |
   \ / (_| | || | | | | | |_ | | | |/ _` | '__/ _` |
    \_/\__,_|\__,_| |_| \____||___|_|\__,_|_|  \__,_|
                   |_|          |_____|
BANNER
echo -e "${NC}"
echo -e "${W}    Cofre de Senhas Corporativo — Assistente de Instalação${NC}"
echo -e "${DIM}    ─────────────────────────────────────────────────────────${NC}"
echo

# ── Utilitários ──────────────────────────────────────────────────────────────
ask()      { echo -ne "${C}  → ${W}$1${NC} "; }
step()     { echo -e "\n${B}▶  $1${NC}"; }
ok()       { echo -e "  ${G}✓${NC}  $1"; }
warn()     { echo -e "  ${Y}!${NC}  $1"; }
err()      { echo -e "  ${R}✗${NC}  $1"; }
sep()      { echo -e "${DIM}  ─────────────────────────────────────────────────${NC}"; }

confirm() {
    local msg="$1" default="${2:-n}"
    local opts="[s/N]"
    [ "$default" = "s" ] && opts="[S/n]"
    ask "$msg $opts: "
    read -r reply
    reply=${reply:-$default}
    [[ "$reply" =~ ^[sSyY] ]]
}

gen_password() {
    # Gera senha de 20 chars: letras, números + símbolos seguros em .env
    local p
    p=$(openssl rand -base64 32 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 17)
    echo "${p}1aA!"
}

gen_secret() {
    openssl rand -hex 64 2>/dev/null || \
    head -c 64 /dev/urandom | xxd -p | head -c 128
}

port_in_use() {
    ss -tlnp 2>/dev/null | grep -q ":$1 " || \
    netstat -tlnp 2>/dev/null | grep -q ":$1 "
}

validate_email() {
    [[ "$1" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]
}

validate_password() {
    local p="$1"
    [[ ${#p} -ge 8 ]] && \
    [[ "$p" =~ [A-Z] ]] && \
    [[ "$p" =~ [a-z] ]] && \
    [[ "$p" =~ [0-9] ]]
}

# ── Verificar se já está instalado ───────────────────────────────────────────
ALREADY_INSTALLED=false
if [ -f .env ] && docker ps 2>/dev/null | grep -q "vaultguard"; then
    ALREADY_INSTALLED=true
    warn "VaultGuard já parece estar rodando."
    if ! confirm "Reinstalar/atualizar mesmo assim?"; then
        echo
        CURR_PORT=$(grep -E '^HTTP_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "80")
        CURR_IP=$(grep -E '^FRONTEND_URL=' .env 2>/dev/null | sed 's|.*://\([^:/]*\).*|\1|' || hostname -I | awk '{print $1}')
        ok "Sistema em execução: http://${CURR_IP}:${CURR_PORT}"
        exit 0
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
step "1/6 — Verificando pré-requisitos"
sep

# Detectar OS
OS_ID=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-}"
fi

install_docker() {
    echo
    warn "Docker não encontrado. Instalando automaticamente..."
    echo
    if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh 2>/dev/null; then
        sh /tmp/get-docker.sh
        rm -f /tmp/get-docker.sh
        # Adiciona usuário atual ao grupo docker
        if [ -n "${SUDO_USER:-}" ]; then
            usermod -aG docker "$SUDO_USER"
        elif [ "$EUID" -ne 0 ]; then
            sudo usermod -aG docker "$USER" 2>/dev/null || true
        fi
        systemctl enable docker 2>/dev/null || true
        systemctl start docker 2>/dev/null || true
        ok "Docker instalado com sucesso."
    else
        err "Falha ao baixar o instalador do Docker."
        err "Instale manualmente: https://docs.docker.com/get-docker/"
        exit 1
    fi
}

# Docker
DOCKER_CMD="docker"
if ! command -v docker &>/dev/null; then
    if [ "$EUID" -eq 0 ]; then
        install_docker
    else
        err "Docker não encontrado."
        ask "Instalar Docker agora? (requer sudo) [S/n]: "
        read -r reply
        reply=${reply:-s}
        if [[ "$reply" =~ ^[sSyY] ]]; then
            sudo bash -c "$(curl -fsSL https://get.docker.com)"
            sudo usermod -aG docker "$USER"
            DOCKER_CMD="sudo docker"
        else
            err "Instale o Docker e execute ./install.sh novamente."
            exit 1
        fi
    fi
elif ! docker info &>/dev/null 2>&1; then
    if sudo docker info &>/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
        warn "Docker requer sudo. Use: sudo usermod -aG docker \$USER para evitar isso."
    else
        err "Docker instalado mas não está rodando."
        err "Execute: sudo systemctl start docker"
        exit 1
    fi
fi
ok "Docker: $($DOCKER_CMD --version | head -1)"

# Docker Compose
if $DOCKER_CMD compose version &>/dev/null 2>&1; then
    COMPOSE="$DOCKER_CMD compose"
elif command -v docker-compose &>/dev/null || $DOCKER_CMD run --rm hello-world &>/dev/null 2>&1; then
    if command -v docker-compose &>/dev/null; then
        COMPOSE="docker-compose"
    else
        err "Docker Compose não encontrado."
        err "Instale: sudo apt install docker-compose-plugin"
        exit 1
    fi
else
    err "Docker Compose não encontrado."
    exit 1
fi
ok "Docker Compose: $($COMPOSE version --short 2>/dev/null || echo 'disponível')"

# ═══════════════════════════════════════════════════════════════════════════
step "2/6 — Dados da empresa"
sep
echo

# Nome da empresa
ask "Nome da empresa [VaultGuard]: "
read -r COMPANY_NAME
COMPANY_NAME="${COMPANY_NAME:-VaultGuard}"

# E-mail do administrador
while true; do
    ask "E-mail do administrador [admin@${COMPANY_NAME,,}.local]: "
    read -r ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$(echo "$COMPANY_NAME" | tr '[:upper:]' '[:lower:]' | tr -dc 'a-z0-9').local}"
    if validate_email "$ADMIN_EMAIL"; then
        break
    fi
    err "E-mail inválido. Tente novamente."
done

# Senha do administrador
while true; do
    echo
    warn "A senha precisa ter: 8+ caracteres, letra maiúscula, minúscula e número."
    ask "Senha do administrador (Enter = gerar automaticamente): "
    read -rs ADMIN_PASSWORD
    echo
    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD=$(gen_password)
        ok "Senha gerada: ${Y}${ADMIN_PASSWORD}${NC}"
        ok "Guarde esta senha em local seguro!"
        break
    fi
    if validate_password "$ADMIN_PASSWORD"; then
        ask "Confirme a senha: "
        read -rs ADMIN_CONFIRM
        echo
        if [ "$ADMIN_PASSWORD" = "$ADMIN_CONFIRM" ]; then
            break
        fi
        err "As senhas não coincidem. Tente novamente."
    else
        err "Senha fraca. Mínimo: 8 chars, maiúscula, minúscula e número."
    fi
done

# ═══════════════════════════════════════════════════════════════════════════
step "3/6 — Configuração de rede"
sep
echo

# IP do servidor
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' | tr -d ' ')
[ -z "$SERVER_IP" ] && SERVER_IP="localhost"

ask "IP ou domínio do servidor [$SERVER_IP]: "
read -r INPUT_IP
SERVER_IP="${INPUT_IP:-$SERVER_IP}"

# Porta HTTP
HTTP_PORT=80
if port_in_use 80; then
    warn "Porta 80 em uso."
    HTTP_PORT=8080
    while port_in_use "$HTTP_PORT"; do
        HTTP_PORT=$((HTTP_PORT + 1))
    done
fi
ask "Porta HTTP [$HTTP_PORT]: "
read -r INPUT_PORT
HTTP_PORT="${INPUT_PORT:-$HTTP_PORT}"

# HTTPS
ENABLE_HTTPS=false
HTTPS_PORT=443
HTTPS_URL=""
mkdir -p ssl

echo
if confirm "Habilitar HTTPS (SSL)?"; then
    ENABLE_HTTPS=true

    if port_in_use 443; then
        warn "Porta 443 em uso."
        HTTPS_PORT=8443
        while port_in_use "$HTTPS_PORT"; do
            HTTPS_PORT=$((HTTPS_PORT + 1))
        done
    fi
    ask "Porta HTTPS [$HTTPS_PORT]: "
    read -r INPUT_HTTPS
    HTTPS_PORT="${INPUT_HTTPS:-$HTTPS_PORT}"

    echo
    echo -e "  Como configurar o certificado SSL?"
    echo -e "  ${W}1)${NC} Gerar certificado autoassinado (recomendado para uso interno)"
    echo -e "  ${W}2)${NC} Usar certificado existente (Let's Encrypt ou CA própria)"
    ask "Opção [1]: "
    read -r SSL_OPT
    SSL_OPT="${SSL_OPT:-1}"

    if [ "$SSL_OPT" = "2" ]; then
        ask "Caminho do certificado (.pem ou .crt): "
        read -r CERT_PATH
        ask "Caminho da chave privada (.key): "
        read -r KEY_PATH
        if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
            cp "$CERT_PATH" ssl/cert.pem
            cp "$KEY_PATH" ssl/key.pem
            ok "Certificado copiado para ssl/"
        else
            err "Arquivos não encontrados. Gerando autoassinado como fallback."
            SSL_OPT="1"
        fi
    fi

    if [ "$SSL_OPT" = "1" ]; then
        ok "Gerando certificado autoassinado (válido por 10 anos)..."
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout ssl/key.pem -out ssl/cert.pem \
            -subj "/CN=${SERVER_IP}/O=${COMPANY_NAME}/C=BR" \
            2>/dev/null
        ok "Certificado gerado em ssl/"
        warn "Certificado autoassinado: o navegador vai exibir aviso de segurança."
        warn "Para produção, substitua ssl/cert.pem e ssl/key.pem e reinicie o nginx."
    fi

    HTTPS_URL="https://${SERVER_IP}:${HTTPS_PORT}"
fi

HTTP_URL="http://${SERVER_IP}:${HTTP_PORT}"

# ═══════════════════════════════════════════════════════════════════════════
step "4/6 — Gerando configuração"
sep
echo

JWT_SECRET=$(gen_secret)
DB_PASSWORD=$(gen_password)

# Determina a URL pública (HTTPS preferido se habilitado)
if [ "$ENABLE_HTTPS" = true ]; then
    FRONTEND_URL="$HTTPS_URL"
else
    FRONTEND_URL="$HTTP_URL"
fi

# Salva o .env (garante que valores com chars especiais ficam entre aspas)
cat > .env <<EOF
# VaultGuard — gerado em $(date '+%Y-%m-%d %H:%M:%S')
# NÃO compartilhe este arquivo — contém segredos de produção.

# ── Empresa ──────────────────────────────────────────────────────────────────
COMPANY_NAME="${COMPANY_NAME}"

# ── Administrador inicial ─────────────────────────────────────────────────────
ADMIN_EMAIL="${ADMIN_EMAIL}"
ADMIN_PASSWORD="${ADMIN_PASSWORD}"

# ── Rede ─────────────────────────────────────────────────────────────────────
HTTP_PORT=${HTTP_PORT}
HTTPS_PORT=${HTTPS_PORT}
FRONTEND_URL="${FRONTEND_URL}"

# ── Banco de dados ────────────────────────────────────────────────────────────
DB_PASSWORD="${DB_PASSWORD}"

# ── JWT (NÃO altere após instalar) ───────────────────────────────────────────
JWT_SECRET="${JWT_SECRET}"

# ── Ambiente ──────────────────────────────────────────────────────────────────
NODE_ENV=production
EOF

# Se HTTPS, ativa o docker-compose.ssl.yml via COMPOSE_FILE
if [ "$ENABLE_HTTPS" = true ]; then
    echo "" >> .env
    echo "# ── Ativa overlay SSL (não remova esta linha) ───────────────────────────────" >> .env
    echo "COMPOSE_FILE=docker-compose.yml:docker-compose.ssl.yml" >> .env
fi

ok ".env criado"
chmod 600 .env

ok "Configuração pronta"

# ═══════════════════════════════════════════════════════════════════════════
step "5/6 — Build e inicialização"
sep
echo

warn "A primeira instalação pode levar 3–8 minutos (download de imagens e build)."
echo

# Para containers antigos se existirem
$COMPOSE down 2>/dev/null || true

# Build e subida
$COMPOSE up -d --build

# ═══════════════════════════════════════════════════════════════════════════
step "6/6 — Aguardando o sistema inicializar"
sep
echo

MAX_WAIT=240
WAITED=0
READY=false

while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf "http://localhost:${HTTP_PORT}/api/health" >/dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 6
    WAITED=$((WAITED + 6))
    printf "  ${DIM}Aguardando... %ds${NC}\r" "$WAITED"
done
echo

# ═══════════════════════════════════════════════════════════════════════════
echo
if [ "$READY" = true ]; then
    echo -e "${G}${W}"
    echo "  ╔══════════════════════════════════════════════════════════╗"
    echo "  ║         VaultGuard instalado com sucesso!                ║"
    echo "  ╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # Validar que o frontend está sendo servido
    if curl -sf "http://localhost:${HTTP_PORT}/" >/dev/null 2>&1; then
        ok "Frontend servido corretamente"
    else
        warn "Frontend não respondeu em http://localhost:${HTTP_PORT}/ — verifique os logs do nginx"
    fi
    echo
    echo -e "  ${W}Acesso ao sistema:${NC}"
    echo -e "    URL:   ${C}${HTTP_URL}${NC}"
    [ "$ENABLE_HTTPS" = true ] && \
    echo -e "    HTTPS: ${C}${HTTPS_URL}${NC}"
    echo
    sep
    echo
    echo -e "  ${Y}┌─────────────────────────────────────────────────────────┐${NC}"
    echo -e "  ${Y}│            CREDENCIAIS DE PRIMEIRO ACESSO               │${NC}"
    echo -e "  ${Y}├─────────────────────────────────────────────────────────┤${NC}"
    echo -e "  ${Y}│${NC}  Use estes dados para entrar no sistema pela 1ª vez:    ${Y}│${NC}"
    echo -e "  ${Y}│${NC}                                                         ${Y}│${NC}"
    echo -e "  ${Y}│${NC}  Usuário:  ${W}${ADMIN_EMAIL}${NC}"
    echo -e "  ${Y}│${NC}  Senha:    ${W}${ADMIN_PASSWORD}${NC}"
    echo -e "  ${Y}│${NC}                                                         ${Y}│${NC}"
    echo -e "  ${Y}│${NC}  ${R}Troque a senha após o primeiro login!${NC}                ${Y}│${NC}"
    echo -e "  ${Y}└─────────────────────────────────────────────────────────┘${NC}"
    echo
    echo -e "  ${DIM}Anote estas credenciais — elas não serão exibidas novamente.${NC}"
    echo
    sep
    echo -e "  ${W}Comandos úteis:${NC}"
    echo -e "    ${DIM}$COMPOSE logs -f backend${NC}    — logs em tempo real"
    echo -e "    ${DIM}$COMPOSE ps${NC}                 — status dos containers"
    echo -e "    ${DIM}$COMPOSE restart backend${NC}    — reiniciar a API"
    echo -e "    ${DIM}$COMPOSE down${NC}               — parar tudo"
    echo -e "    ${DIM}bash uninstall.sh${NC}           — remover completamente"
    echo
    echo -e "  ${DIM}Extensão Chrome: gere um token em VaultGuard → Tokens de API${NC}"
    echo
else
    echo -e "${R}  O sistema não respondeu após ${MAX_WAIT}s.${NC}"
    echo
    echo -e "  Verifique os logs:"
    echo -e "    ${DIM}$COMPOSE logs backend${NC}"
    echo -e "    ${DIM}$COMPOSE logs postgres${NC}"
    echo
    $COMPOSE ps
    echo
    echo -e "  Após resolver o problema: ${DIM}bash install.sh${NC}"
    exit 1
fi
