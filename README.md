# VaultGuard — Cofre de Senhas Corporativo

Sistema completo de gerenciamento de credenciais para empresas, com criptografia AES-256-GCM, integração nativa com Active Directory/LDAP, controle de acesso granular por cargo, auditoria completa e extensão Chrome com autofill automático.

---

## Sumário

- [Funcionalidades](#-funcionalidades)
- [Stack técnica](#️-stack-técnica)
- [Arquitetura](#-arquitetura)
- [Modelo de dados](#-modelo-de-dados)
- [API REST](#-api-rest)
- [Variáveis de ambiente](#-variáveis-de-ambiente)
- [Instalação com Docker](#-instalação-com-docker)
- [Instalação manual (sem Docker)](#-instalação-manual-sem-docker)
- [Active Directory](#-active-directory)
- [Hierarquia de cargos e permissões](#-hierarquia-de-cargos-e-permissões)
- [Extensão Chrome](#-extensão-chrome)
- [Segurança](#-segurança)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Comandos úteis](#-comandos-úteis)
- [Solução de problemas](#-solução-de-problemas)

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| Cofre de senhas | Credenciais em pastas hierárquicas com criptografia AES-256-GCM |
| Active Directory | Login via LDAP/AD com sincronização automática de grupos e cargos |
| Controle de acesso | 6 níveis de cargo com permissões individuais por pasta (visualizar, editar, excluir, compartilhar) |
| Pastas pessoais | Cada usuário tem um espaço privado inacessível a outros |
| Compartilhamento | Compartilhamento de credenciais ponto-a-ponto com expiração opcional |
| Campos customizados | Campos extras por credencial (texto, senha, OTP, URL) |
| Anexos | Armazenamento de arquivos vinculados a credenciais |
| Favoritos | Acesso rápido a credenciais marcadas |
| Requisições de acesso | Usuários solicitam acesso a pastas; admins aprovam/rejeitam |
| 2FA | TOTP (Google Authenticator, Authy) por usuário ou obrigatório globalmente |
| Tokens de API | Tokens com escopos e expiração para extensão e integrações externas |
| Auditoria | Log de todas as ações: login, acesso, criação, edição, exclusão, exportação CSV |
| Dashboard de segurança | Métricas de senhas fracas, reutilizadas, expiradas e de logins suspeitos |
| Personalização | Logo, favicon, cores, nome e subtítulo configuráveis pela interface |
| 31 idiomas | i18n completo com suporte a RTL (árabe, hebraico, persa) |
| Extensão Chrome | Autofill automático e salvar senhas detectadas no navegador |

---

## Stack técnica

### Backend

| Tecnologia | Versão | Função |
|---|---|---|
| Node.js | 20 (LTS) | Runtime |
| Express | 4.18 | Framework HTTP |
| Prisma ORM | 5.10 | Acesso ao banco + migrations |
| PostgreSQL | 16 | Banco de dados principal |
| argon2 | 0.31 | Hash de senhas de usuários |
| jsonwebtoken | 9.0 | Autenticação stateless (JWT) |
| otplib | 12.0 | Geração e validação de TOTP (2FA) |
| ldapts | 4.2 | Integração LDAP/Active Directory |
| helmet | 7.1 | Cabeçalhos de segurança HTTP |
| express-rate-limit | 7.1 | Rate limiting por IP |
| winston | 3.11 | Logs estruturados em arquivo |
| morgan | 1.10 | Log de requisições HTTP |
| nodemailer | 9.0 | Envio de e-mail (SMTP) |
| multer | 1.4 | Upload de arquivos (logos, anexos) |
| sharp | 0.33 | Processamento de imagens |
| qrcode | 1.5 | Geração de QR Code para 2FA |

### Frontend

| Tecnologia | Versão | Função |
|---|---|---|
| React | 18.2 | UI |
| Vite | 5.1 | Bundler e dev server |
| TailwindCSS | 3.4 | Estilização utilitária |
| Zustand | 4.5 | Gerenciamento de estado global |
| React Router | 6.22 | Roteamento SPA |
| TanStack Query | 5.17 | Cache e fetching de dados |
| Axios | 1.6 | Cliente HTTP |
| i18next | 23.8 | Internacionalização (31 idiomas) |
| Headless UI | 1.7 | Componentes de acessibilidade |
| lucide-react | 0.323 | Ícones |
| zod | 3.22 | Validação de formulários |
| react-hot-toast | 2.4 | Notificações |

### Extensão Chrome

| Spec | Detalhe |
|---|---|
| Manifest | V3 |
| Permissões | `storage`, `activeTab`, `scripting`, `tabs` |
| Background | Service Worker (module) |
| Content script | Injeta autofill em `<all_urls>` em `document_idle` |

---

## Arquitetura

```
                        ┌─────────────────────┐
                        │   Nginx (porta 80)  │
                        │  Rate limit + proxy │
                        └────────┬────────────┘
                                 │
              ┌──────────────────┼───────────────────┐
              │                  │                   │
        /api/*              /uploads/            /* (SPA)
              │                  │                   │
   ┌──────────▼──────────────────▼───────────────────▼──────┐
   │              Backend (Express · porta 3001)             │
   │                                                         │
   │  /api/auth          /api/folders     /api/audit         │
   │  /api/users         /api/credentials /api/tokens        │
   │  /api/ldap          /api/favorites   /api/attachments   │
   │  /api/settings      /api/access-requests                │
   │  /api/dashboard     /api/health                         │
   └──────────────────────┬──────────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │  PostgreSQL 16        │
              │  (volume persistente) │
              └───────────────────────┘

   Chrome Extension ──► /api/* via API Token (Bearer vg_...)
```

O build Docker usa **multi-stage**: a imagem de builder compila o frontend (`npm run build`) e gera o cliente Prisma; a imagem final (Node 20 Bullseye/Debian) copia apenas os artefatos necessários. O backend serve o frontend estático em produção via `express.static`.

> **Nota:** Alpine Linux **não é suportado** — o Prisma requer `libssl.so.1.1` que não está disponível no musl/Alpine. Use obrigatoriamente `node:20-bullseye` ou superior.

---

## Modelo de dados

```
User
 ├─ id (UUID)
 ├─ email, username (únicos)
 ├─ passwordHash (argon2, nullable — usuários AD não têm)
 ├─ role: AUXILIAR | ASSISTENTE | ANALISTA | COORDENACAO | DIRETORIA | ADMINISTRADOR
 ├─ status: ACTIVE | INACTIVE | PENDING
 ├─ totpSecret, totpEnabled
 ├─ authSource: "local" | "ldap"
 ├─ ldapDn, ldapGuid (para usuários AD)
 └─ encryptionSalt (derivação de chave AES por usuário)

Folder
 ├─ id, name, description, icon, color
 ├─ parentId → Folder (árvore recursiva)
 ├─ isPersonal + ownerId → User (pastas pessoais)
 └─ children[], credentials[], permissions[]

FolderPermission
 ├─ folderId → Folder
 ├─ userId → User (permissão individual) OU role (permissão por cargo)
 └─ canView, canEdit, canDelete, canShare

Credential
 ├─ folderId → Folder
 ├─ title, username, url, notes, tags[], favicon
 ├─ encryptedPass (AES-256-GCM, base64)
 ├─ strength (score 0–100), lastUsed, expiresAt
 ├─ customFields[] → CredentialField
 └─ attachments[] → Attachment

ApiToken
 ├─ userId → User
 ├─ token (prefixo vg_)
 ├─ scopes: ["read"] | ["read","write"] | ...
 └─ expiresAt (opcional)

AuditLog
 ├─ userId, action, resourceType, resourceId
 ├─ details (JSON), ipAddress, userAgent
 └─ createdAt (indexado)

SystemSettings (singleton)
 ├─ siteName, siteSubtitle, logoUrl, faviconUrl
 ├─ primaryColor, accentColor, bgColor, surfaceColor
 ├─ defaultLanguage, allowSelfReg, require2FA
 ├─ sessionTimeout (min), maxLoginAttempts
 ├─ passwordPolicy (JSON), smtpConfig (JSON)
 └─ ldapEnabled, ldapConfig (JSON, criptografado)
```

---

## API REST

Todas as rotas usam prefixo `/api`. Autenticação via `Authorization: Bearer <JWT>` ou `X-API-Token: vg_...`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | Login local ou AD |
| POST | `/auth/refresh` | Renovar JWT |
| POST | `/auth/2fa/setup` | Gerar QR Code TOTP |
| POST | `/auth/2fa/verify` | Ativar 2FA |
| GET | `/users` | Listar usuários (admin) |
| POST | `/users` | Criar usuário |
| PUT | `/users/:id` | Editar usuário |
| GET | `/folders` | Árvore de pastas (filtrada por permissão) |
| POST | `/folders` | Criar pasta |
| PUT | `/folders/:id/permissions` | Gerenciar permissões |
| GET | `/credentials` | Listar credenciais da pasta |
| POST | `/credentials` | Criar credencial |
| GET | `/credentials/:id/password` | Revelar senha (auditado) |
| POST | `/credentials/:id/share` | Compartilhar credencial |
| GET | `/favorites` | Favoritos do usuário |
| POST | `/attachments/:credentialId` | Anexar arquivo |
| POST | `/access-requests` | Solicitar acesso a pasta |
| GET | `/audit` | Log de auditoria (admin) |
| GET | `/tokens` | Listar tokens de API |
| POST | `/tokens` | Gerar token |
| GET | `/ldap/config` | Ler configuração LDAP |
| PUT | `/ldap/config` | Salvar configuração LDAP |
| POST | `/ldap/test` | Testar conexão AD |
| POST | `/ldap/sync` | Sincronizar usuários do AD |
| GET | `/settings` | Configurações do sistema |
| PUT | `/settings` | Atualizar configurações |
| GET | `/dashboard` | Métricas do dashboard de segurança |
| GET | `/health` | Health check `{ status, version, timestamp }` |

**Rate limits:**
- `/api/auth/*`: 20 req / 15 min por IP (Express) · 5 req / min extra via Nginx
- `/api/*`: 200 req / min por IP

---

## Variáveis de ambiente

O `install.sh` gera o `.env` automaticamente. Para configuração manual, copie o template:

```bash
cp .env.example .env
```

| Variável | Descrição | Obrigatório |
|---|---|---|
| `COMPANY_NAME` | Nome da empresa (aparece na interface) | Não |
| `ADMIN_EMAIL` | E-mail do administrador inicial | Sim |
| `ADMIN_PASSWORD` | Senha do administrador inicial | Sim |
| `DB_PASSWORD` | Senha do PostgreSQL | Sim |
| `JWT_SECRET` | Chave de assinatura JWT (`openssl rand -hex 64`) | Sim |
| `FRONTEND_URL` | URL pública de acesso (ex: `http://192.168.1.10`) | Sim |
| `HTTP_PORT` | Porta HTTP (padrão `80`) | Não |
| `HTTPS_PORT` | Porta HTTPS (padrão `443`, só com SSL) | Não |
| `NODE_ENV` | `production` em produção | Não |

> **Nunca altere `JWT_SECRET` após instalar** — invalida todas as sessões ativas.

---

## Instalação com Docker

### Instalação automática (recomendado)

Execute num servidor **Ubuntu 20+**, **Debian 11+** ou **CentOS 7+**:

```bash
git clone https://github.com/seu-org/vaultguard.git
cd vaultguard
bash install.sh
```

O assistente vai guiar cada etapa:

| Etapa | O que acontece |
|---|---|
| Pré-requisitos | Detecta e instala Docker automaticamente se necessário |
| Dados da empresa | Nome da empresa, e-mail e senha do admin (com validação de força) |
| Rede | Detecta o IP do servidor; verifica se a porta 80 está livre |
| HTTPS | Opcional: gera certificado autoassinado ou usa um existente |
| Build | `docker compose up --build` |
| Verificação | Aguarda o health check e exibe URL + credenciais no terminal |

> `JWT_SECRET` e `DB_PASSWORD` são gerados aleatoriamente pelo script e salvos em `.env`. Guarde este arquivo em local seguro.

### Desinstalar

```bash
bash uninstall.sh
```

Pergunta separadamente sobre remoção de containers, volumes de dados e imagens.

### HTTPS

Durante a instalação, ao responder **s** para HTTPS:

- O script gera `ssl/cert.pem` + `ssl/key.pem` (autoassinado, 10 anos) ou copia um certificado existente
- Ativa `docker-compose.ssl.yml` via `COMPOSE_FILE` no `.env`
- `nginx-https.conf` faz redirect HTTP → HTTPS + TLS 1.2/1.3

Para trocar o certificado depois (Let's Encrypt, CA corporativa):

```bash
cp /caminho/cert.pem ssl/cert.pem
cp /caminho/key.pem  ssl/key.pem
docker compose restart nginx
```

### O que o container executa na inicialização

```
docker-entrypoint.sh:
  npx prisma migrate deploy   → aplica migrations (com retry automático)
  node src/prisma/seed.js     → cria empresa e admin (idempotente)
  node src/server.js          → inicia o servidor
```

---

## Instalação manual (sem Docker)

### Requisitos

- Node.js 20+
- PostgreSQL 16+
- Nginx (recomendado como proxy reverso)

### Backend

```bash
cd backend
cp ../.env.example .env
# Configure DATABASE_URL, JWT_SECRET e as variáveis de admin no .env

npm install
npx prisma migrate deploy
node src/prisma/seed.js

npm run dev    # desenvolvimento (nodemon)
npm start      # produção
```

### Frontend

```bash
cd frontend
npm install
npm run build       # gera dist/ — servido pelo backend em produção
npm run dev         # dev server em http://localhost:5173
```

### Nginx

O repositório inclui dois arquivos prontos:

| Arquivo | Uso |
|---|---|
| `nginx.conf` | HTTP (porta 80) |
| `nginx-https.conf` | HTTPS com redirect HTTP → HTTPS |

---

## Active Directory

### Configuração pela interface

1. Acesse o sistema como **Administrador**
2. No menu lateral, vá em **Active Directory**
3. Preencha as seções:

**Conexão**

| Campo | Exemplo | Descrição |
|---|---|---|
| Servidor | `192.168.0.10` | IP ou FQDN do Domain Controller |
| Porta | `389` / `636` | 389 = LDAP, 636 = LDAPS |
| Base DN | `DC=empresa,DC=local` | Raiz da busca |

**Service Account (Bind)**

| Campo | Exemplo |
|---|---|
| Bind DN | `CN=vaultguard-svc,OU=ServiceAccounts,DC=empresa,DC=local` |
| Senha | `<senha da service account>` |

Permissões mínimas no AD: `Read` em todos os objetos do container base + `Read Members` nos grupos mapeados.

**Mapeamento de grupos → cargos**

```
GRP_TI_AUXILIAR   → AUXILIAR
GRP_TI_ANALISTAS  → ANALISTA
GRP_COORDENACAO   → COORDENACAO
GRP_DIRETORES     → DIRETORIA
GRP_ADMINS_TI     → ADMINISTRADOR
```

Usuários em múltiplos grupos recebem o cargo de maior privilégio. Usuários AD são criados automaticamente no banco local no primeiro login — sem necessidade de cadastro prévio.

### Fluxo de autenticação AD

```
Usuário digita login + senha
         ↓
VaultGuard lê ldapConfig do banco (SystemSettings)
         ↓
Bind com service account → busca o usuário por sAMAccountName/email
         ↓
Re-bind com as credenciais do usuário (valida senha no AD)
         ↓
Sincroniza grupos → determina cargo (maior nível)
         ↓
Upsert do usuário no banco local (nome, email, ldapDn, ldapGuid, role)
         ↓
Emite JWT → usuário autenticado
```

---

## Hierarquia de cargos e permissões

| Cargo | Nível | Descrição |
|---|---|---|
| AUXILIAR | 0 | Acesso mínimo — apenas pastas explicitamente concedidas |
| ASSISTENTE | 1 | Acesso a pastas de nível assistente e abaixo |
| ANALISTA | 2 | Acesso mais amplo a recursos técnicos |
| COORDENACAO | 3 | Acesso a credenciais de coordenação |
| DIRETORIA | 4 | Acesso a credenciais executivas |
| ADMINISTRADOR | 5 | Acesso total + configurações do sistema |

Permissões podem ser definidas **por cargo** (todos os usuários daquele nível) ou **por usuário específico**, com granularidade de ação:

| Permissão | Descrição |
|---|---|
| `canView` | Visualizar a pasta e listar credenciais |
| `canEdit` | Criar e editar credenciais na pasta |
| `canDelete` | Excluir credenciais |
| `canShare` | Compartilhar credenciais com outros usuários |

---

## Extensão Chrome

### Build

```bash
cd extension
npm install
node build.js     # Gera extension/dist/
```

### Instalação (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** → selecione `extension/dist/`

### Configuração inicial

1. Clique no ícone do VaultGuard na barra do Chrome
2. Informe a URL do servidor: `http://IP_DO_SERVIDOR`
3. Cole um token gerado em **VaultGuard → Tokens de API**

### Funcionalidades

- **Badge** com o número de credenciais disponíveis para o site atual
- **Autofill** automático ao detectar formulários de login
- **Salvar** credenciais de login inseridas manualmente
- Comunicação com o backend via `X-API-Token: vg_...`

**Permissões do manifest:**

| Permissão | Uso |
|---|---|
| `storage` | Salva URL do servidor e token localmente |
| `activeTab` | Lê a URL da aba atual para filtrar credenciais |
| `scripting` | Injeta autofill nos campos de formulário |
| `tabs` | Detecta navegação entre abas |

---

## Segurança

**Criptografia**
- Senhas armazenadas com **AES-256-GCM** (Web Crypto API); a chave é derivada por usuário a partir de um `encryptionSalt` único
- Senhas de usuários locais hasheadas com **Argon2** (memória: 64 MB, tempo: 3 iterações)
- Senhas de usuários AD **nunca são armazenadas** — somente validadas via re-bind LDAP

**Autenticação**
- JWT com expiração configurável (`sessionTimeout` em minutos, padrão 480)
- 2FA por TOTP (RFC 6238) — opcional por usuário ou obrigatório globalmente via `require2FA`
- Máximo de tentativas de login configurável (padrão: 5); bloqueio após exceder

**Tokens de API**
- Prefixo `vg_` seguido de UUID
- Escopos: `read`, `write` (definidos por token)
- Expiração opcional; revogação imediata possível pela UI

**Rate limiting (dupla camada)**

| Camada | Rota | Limite |
|---|---|---|
| Nginx | `/api/auth/login` | 5 req / min por IP |
| Nginx | `/api/*` | 30 req / min por IP |
| Express | `/api/auth/*` | 20 req / 15 min por IP |
| Express | `/api/*` | 200 req / min por IP |

**Cabeçalhos HTTP**
- Helmet com CSP desativado (para compatibilidade com extensão), COEP desativado
- `X-Forwarded-For` propagado pelo Nginx para logs corretos

**Auditoria**
- Todo acesso a senha (`GET /credentials/:id/password`) é registrado com usuário, IP e user-agent
- Logs persistidos em volume Docker (`logs_data`) e em arquivo via Winston

---

## Estrutura do projeto

```
vaultguard/
├── install.sh                           # Assistente de instalação (executa primeiro)
├── uninstall.sh                         # Remoção limpa com confirmações
├── docker-compose.yml                   # postgres + backend + nginx (HTTP)
├── docker-compose.ssl.yml               # Overlay HTTPS (ativado pelo install.sh)
├── nginx.conf                           # Nginx HTTP
├── nginx-https.conf                     # Nginx HTTPS + redirect HTTP→HTTPS
├── .env.example                         # Template de variáveis de ambiente
├── ssl/                                 # Certificados TLS (gerados pelo install.sh)
├── backend/
│   ├── Dockerfile                       # Multi-stage: builder (Node+Vite) → slim final
│   ├── docker-entrypoint.sh             # Migrate (com retry) + seed + server
│   ├── prisma/
│   │   ├── schema.prisma                # Modelos: User, Folder, Credential, AuditLog...
│   │   └── migrations/                  # Migrations versionadas
│   └── src/
│       ├── server.js                    # Entry point: Express, middleware, rotas
│       ├── routes/
│       │   ├── auth.js                  # Login local + LDAP, 2FA, refresh
│       │   ├── users.js                 # CRUD de usuários
│       │   ├── folders.js               # Árvore de pastas + permissões
│       │   ├── credentials.js           # CRUD + reveal + share
│       │   ├── ldap.js                  # Config, test, sync, grupos AD
│       │   ├── audit.js                 # Log de auditoria + export CSV
│       │   ├── apiTokens.js             # Tokens de API
│       │   ├── favorites.js             # Favoritos por usuário
│       │   ├── attachments.js           # Anexos de credenciais
│       │   ├── accessRequests.js        # Solicitações de acesso
│       │   ├── settings.js              # Configurações do sistema
│       │   └── securityDashboard.js     # Métricas de segurança
│       ├── middleware/
│       │   └── errorHandler.js
│       ├── services/
│       │   └── ldap.js                  # Motor de integração AD/LDAP
│       ├── utils/
│       │   └── logger.js                # Winston com transports arquivo
│       └── prisma/
│           └── seed.js                  # Cria empresa e admin (lê COMPANY_NAME/ADMIN_*)
├── frontend/
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── App.jsx                      # Roteamento principal
│       ├── pages/                       # VaultPage, UsersPage, AdminLdapPage...
│       └── components/                  # Componentes reutilizáveis
└── extension/
    ├── manifest.json                    # Chrome MV3
    ├── popup.html
    ├── build.js                         # Script de build da extensão
    └── icons/
```

---

## Comandos úteis

```bash
# Instalar / reinstalar
bash install.sh

# Desinstalar
bash uninstall.sh

# Logs em tempo real
docker compose logs -f backend

# Ver status dos containers
docker compose ps

# Acessar o PostgreSQL
docker compose exec postgres psql -U vaultguard

# Aplicar migrations manualmente
docker compose exec backend npx prisma migrate deploy

# Explorador visual do banco (Prisma Studio)
docker compose exec backend npx prisma studio

# Rebuild após mudanças no código
docker compose up -d --build backend

# Reiniciar nginx (ex: após trocar certificado SSL)
docker compose restart nginx

# Parar tudo
docker compose down

# Backup do banco
docker compose exec postgres pg_dump -U vaultguard vaultguard > backup_$(date +%Y%m%d).sql

# Restaurar backup
cat backup_20240101.sql | docker compose exec -T postgres psql -U vaultguard vaultguard
```

---

## Solução de problemas

**"LDAP server unavailable"**
```bash
# Teste conectividade com o DC
telnet IP_DO_DC 389
# ou
nc -zv IP_DO_DC 389
```
Verifique firewall entre o container do backend e o DC. Confirme que o DC aceita bind anônimo ou com a service account configurada.

**"Invalid credentials" no login AD**
```bash
# Teste o bind manualmente
ldapsearch -H ldap://IP_DO_DC -D "CN=vaultguard-svc,OU=ServiceAccounts,DC=empresa,DC=local" \
  -w SENHA -b "DC=empresa,DC=local" "(sAMAccountName=usuario)"
```
Verifique se a service account não expirou e se tem permissão de leitura no AD.

**Extensão não encontra senhas**
- A URL do servidor não deve terminar com `/`
- Gere um novo token em **VaultGuard → Tokens de API** e reconecte a extensão
- Verifique se o token tem o escopo `read`

**Backend não inicia**
```bash
docker compose logs backend
docker compose logs postgres
# Causas comuns:
# - DB_PASSWORD diferente do que foi usado na criação do volume
#   → solução: docker compose down -v && bash install.sh
# - JWT_SECRET muito curto (mínimo: 64 chars)
# - Porta 80 ocupada por outro serviço
#   → solução: definir HTTP_PORT=8080 no .env e reiniciar
```

**Aviso de certificado no navegador (HTTPS autoassinado)**

Comportamento esperado. Para eliminar:
- Em ambiente interno: importe `ssl/cert.pem` como CA confiável nas máquinas dos usuários
- Em produção com domínio público: substitua por certificado Let's Encrypt

```bash
# Trocar certificado e aplicar sem downtime
cp novo-cert.pem ssl/cert.pem
cp nova-chave.pem ssl/key.pem
docker compose restart nginx
```

**Upload de logo falha**
- Limite do Nginx: `client_max_body_size 10M`
- Limite do Express: `express.json({ limit: '20mb' })`
- O sharp converte e redimensiona automaticamente

---

