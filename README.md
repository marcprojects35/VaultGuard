# 🔐 VaultGuard — Cofre de Senhas Corporativo

Sistema completo de gerenciamento de senhas para empresas, similar ao TeamPass, com suporte a Active Directory, extensão Chrome e controle de acesso granular por cargo.

---

## ✨ Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 🔑 Cofre de senhas | Credenciais organizadas em pastas hierárquicas com criptografia AES-256-GCM |
| 🏢 Active Directory | Login via AD/LDAP com sincronização de grupos e cargos |
| 🧑‍💼 Controle de acesso | 6 níveis de cargo com permissões por pasta (visualizar, editar, excluir, compartilhar) |
| 🌐 31 idiomas | Internacionalização completa com suporte a RTL (árabe, hebraico, persa) |
| 🎨 Personalização | Logo, favicon, cores e nome do sistema configuráveis pelo admin |
| 🔒 2FA | Autenticação em dois fatores via TOTP (Google Authenticator, Authy) |
| 🧩 Extensão Chrome | Autofill automático e salvar senhas diretamente do navegador |
| 📊 Auditoria | Log completo de todas as ações com filtros e exportação CSV |
| 🔑 Tokens de API | Geração de tokens para a extensão Chrome e integrações externas |

---

## 🏗️ Stack

- **Backend**: Node.js 20 + Express + Prisma ORM
- **Banco de dados**: PostgreSQL 16
- **Frontend**: React 18 + Vite + TailwindCSS + Zustand
- **LDAP**: ldapts (Active Directory e OpenLDAP)
- **Criptografia**: AES-256-GCM (Web Crypto API)
- **Autenticação**: JWT + TOTP (otplib)
- **Extensão**: Chrome Manifest V3

---

## 🚀 Instalação (Docker — Recomendado)

### 1. Pré-requisitos
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
```

### 2. Clonar e configurar
```bash
git clone https://github.com/seu-org/vaultguard.git
cd vaultguard

# Criar arquivo de variáveis de ambiente
cp backend/.env.example .env
nano .env  # Defina DB_PASSWORD e JWT_SECRET
```

### 3. Subir os containers
```bash
docker compose up -d

# Acompanhar logs
docker compose logs -f backend
```

### 4. Acessar
- **Sistema**: http://IP_DO_SERVIDOR
- **Credenciais iniciais**: `admin@vaultguard.local` / `Admin@123456`
- ⚠️ **Troque a senha imediatamente após o primeiro acesso!**

---

## 🛠️ Instalação Manual (sem Docker)

### Requisitos
- Node.js 20+
- PostgreSQL 16+
- (Opcional) Nginx como proxy reverso

### Backend
```bash
cd backend
cp ../.env.example .env
# Edite o .env com DATABASE_URL e JWT_SECRET

npm install
npx prisma migrate deploy
npx prisma generate
node src/prisma/seed.js   # Cria admin padrão

node src/server.js        # ou: npm start
```

### Frontend
```bash
cd frontend
npm install
npm run build             # Gera dist/ que é servido pelo backend
```

O backend serve o frontend em produção automaticamente. Em desenvolvimento:
```bash
cd frontend
npm run dev               # http://localhost:5173
```

---

## 🏢 Configuração do Active Directory

### Passo a passo na interface

1. Acesse o sistema como **Administrador**
2. No menu lateral, clique em **Active Directory**
3. Configure as seções:

#### 🔌 Conexão
| Campo | Exemplo | Descrição |
|---|---|---|
| Servidor | `192.168.0.10` | IP ou hostname do DC |
| Porta | `389` / `636` | 389 = LDAP, 636 = LDAPS |
| Base DN | `DC=empresa,DC=local` | Raiz da busca no AD |

#### 🔐 Autenticação (Service Account)
| Campo | Exemplo |
|---|---|
| Bind DN | `CN=vaultguard-svc,OU=ServiceAccounts,DC=empresa,DC=local` |
| Senha | senha da service account |

**Permissões mínimas** da service account no AD:
- `Read` em todos os objetos do container base
- `Read Members` nos grupos

#### 👥 Mapeamento de Grupos → Cargos

Vincule grupos do AD aos cargos do VaultGuard:

```
GRP_TI_AUXILIAR   → AUXILIAR
GRP_TI_ANALISTAS  → ANALISTA
GRP_COORDENACAO   → COORDENACAO
GRP_DIRETORES     → DIRETORIA
GRP_ADMINS_TI     → ADMINISTRADOR
```

Usuários em múltiplos grupos recebem o cargo de **maior privilégio**.

#### ⚙️ Sincronização
- **Sincronizar grupos**: Atualiza cargos automaticamente ao login
- **Sincronizar Agora**: Importa todos os usuários ativos do AD em lote

### Fluxo de login com AD

```
Usuário digita login/senha
       ↓
VaultGuard busca config LDAP no banco
       ↓
Bind com service account → busca usuário no AD
       ↓
Re-bind com credenciais do usuário (valida senha)
       ↓
Sincroniza nome, email, grupos, cargo no banco local
       ↓
Emite JWT → usuário autenticado
```

> Usuários do AD **não precisam ser criados manualmente**. São criados automaticamente no primeiro login.

---

## 🧩 Extensão Chrome

### Instalação (modo desenvolvedor)
```bash
cd extension
npm install
node build.js             # Gera /dist
```

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** → selecione a pasta `extension/dist`

### Configuração
1. Clique no ícone 🔐 na barra do Chrome
2. Informe a URL do servidor: `http://IP_DO_SERVIDOR`
3. Cole um token gerado em **VaultGuard → Tokens de API**

### Funcionalidades
- **Badge** com contagem de senhas do site atual
- **Autofill** automático em formulários de login
- **Salvar** credenciais detectadas na página

---

## 👥 Hierarquia de Cargos

| Cargo | Nível | Descrição |
|---|---|---|
| AUXILIAR | 0 | Acesso mínimo — pastas específicas |
| ASSISTENTE | 1 | Acesso a pastas de assistente e auxiliar |
| ANALISTA | 2 | Acesso mais amplo a recursos técnicos |
| COORDENACAO | 3 | Acesso à área de coordenação |
| DIRETORIA | 4 | Acesso a credenciais executivas |
| ADMINISTRADOR | 5 | Acesso total + configurações do sistema |

Cada pasta pode ter permissões configuradas por **cargo** ou por **usuário específico**.

---

## 🔒 Segurança

- Senhas criptografadas com **AES-256-GCM** no servidor
- Senhas do AD **nunca armazenadas** localmente — somente validação via bind LDAP
- Rate limiting nas rotas de autenticação (5 tentativas / 15 min)
- 2FA por TOTP disponível para todos os usuários
- Log completo de auditoria (login, acesso a senhas, alterações)
- Tokens de API com prefixo `vg_` e expiração configurável
- Cabeçalhos de segurança via Helmet

---

## 📁 Estrutura do Projeto

```
vaultguard/
├── backend/
│   ├── prisma/schema.prisma      # Modelos do banco
│   └── src/
│       ├── controllers/auth.js   # Login local + LDAP integrado
│       ├── routes/ldap.js        # Config, teste, sync, grupos AD
│       ├── routes/               # credentials, folders, users, ...
│       ├── services/ldap.js      # Motor de integração AD/LDAP
│       └── server.js
├── frontend/
│   └── src/
│       ├── pages/AdminLdapPage.jsx   # UI de configuração do AD
│       ├── pages/                    # Vault, Users, Folders, ...
│       └── components/
├── extension/                    # Chrome Extension MV3
├── docker-compose.yml
├── nginx.conf
└── README.md
```

---

## ⚡ Comandos Úteis

```bash
# Ver logs em tempo real
docker compose logs -f backend

# Acessar container do banco
docker compose exec postgres psql -U vaultguard

# Rodar migrations manualmente
docker compose exec backend npx prisma migrate deploy

# Rebuild após mudanças
docker compose up -d --build backend
```

---

## 🆘 Solução de Problemas

**"LDAP server unavailable"**
→ Verifique conectividade: `telnet IP_DO_DC 389`
→ Confirme que o DC aceita conexões de fora do domínio

**"Invalid credentials" no login AD**
→ Teste o Bind DN manualmente com `ldapsearch`
→ Verifique se a service account não expirou

**Extensão não encontra senhas**
→ Confirme que a URL do servidor não tem `/` no final
→ Gere um novo token de API e reconecte

---

*VaultGuard — desenvolvido para Grupo FGF*
