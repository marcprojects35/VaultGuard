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
- [Atualizando uma instalação existente](#atualizando-uma-instalação-existente)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Comandos úteis](#-comandos-úteis)
- [Solução de problemas](#-solução-de-problemas)

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| Cofre de senhas | Credenciais em pastas hierárquicas com criptografia de ponta a ponta (o servidor não lê as senhas) |
| Active Directory | Login via LDAP/AD com sincronização automática de grupos e cargos |
| Controle de acesso | 6 níveis de cargo com permissões individuais por pasta (visualizar, editar, excluir, compartilhar) |
| Pastas pessoais | Cada usuário tem um espaço privado inacessível a outros |
| Compartilhamento | Compartilhamento de credenciais ponto-a-ponto com expiração opcional |
| Campos customizados | Campos extras por credencial (texto, senha, OTP, URL) |
| Anexos | Armazenamento de arquivos vinculados a credenciais |
| Favoritos | Acesso rápido a credenciais marcadas |
| Requisições de acesso | Usuários solicitam acesso a pastas; admins aprovam/rejeitam |
| 2FA | TOTP (Google Authenticator, Authy) por usuário ou obrigatório globalmente |
| Tokens de API | Tokens com escopos (leitura/escrita) e expiração para extensão e integrações externas |
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
| Node.js | 22 (LTS) | Runtime |
| Express | 4.18 | Framework HTTP |
| Prisma ORM | 5.10 | Acesso ao banco + migrations |
| PostgreSQL | 16 | Banco de dados principal |
| bcryptjs | 2.4 | Hash de senhas de usuários (custo 12) |
| jsonwebtoken | 9.0 | Autenticação stateless (JWT) |
| otplib | 12.0 | Geração e validação de TOTP (2FA) |
| ldapts | 9.2 | Integração LDAP/Active Directory |
| helmet | 7.1 | Cabeçalhos de segurança HTTP |
| express-rate-limit | 7.1 | Rate limiting por IP |
| winston | 3.11 | Logs estruturados em arquivo |
| morgan | 1.10 | Log de requisições HTTP |
| nodemailer | 10.0 | Envio de e-mail (SMTP; Microsoft 365 via Graph) |
| multer | 1.4 | Upload de arquivos (logos, anexos) |
| sharp | 0.35 | Processamento de imagens |
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

O build Docker usa **multi-stage**: a imagem de builder compila o frontend (`npm run build`) e gera o cliente Prisma; a imagem final (Node 22 Bookworm/Debian, executando como usuário `node`) copia apenas os artefatos necessários. O backend serve o frontend estático em produção via `express.static`.

> **Nota:** Alpine Linux **não é suportado** — o cliente Prisma é gerado para Debian (OpenSSL 1.1 e 3). Use `node:22-bookworm`.

---

## Modelo de dados

```
User
 ├─ id (UUID)
 ├─ email, username (únicos)
 ├─ passwordHash (bcrypt, nullable — usuários AD não têm)
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
| `TRUST_PROXY` | Saltos de proxy confiáveis para obter o IP real (`1` atrás do Nginx, `0` no modo local) | Não |
| `BIND_ADDR` | Interface do modo local (padrão `127.0.0.1`; `0.0.0.0` expõe na rede) | Não |

> **Nunca altere `JWT_SECRET` após instalar** — invalida todas as sessões ativas. O servidor recusa iniciar com `JWT_SECRET` ausente, com menos de 32 caracteres ou com o valor de exemplo.

---

## Instalação com Docker

### Instalação automática (recomendado)

Execute num servidor **Ubuntu 20+**, **Debian 11+**, **CentOS 7+** ou **RHEL 8+**:

```bash
git clone https://github.com/marcprojects35/VaultGuard.git
cd vaultguard
bash install.sh
```

O assistente interativo guia cada etapa (a primeira instalação leva entre 3 e 8 minutos):

| Etapa | O que acontece |
|---|---|
| Modo | Escolha entre **servidor** (porta 80/443, IP externo, suporte a SSL) ou **máquina local** (porta 8080, localhost, sem SSL) |
| Pré-requisitos | Detecta e instala Docker automaticamente se necessário |
| Dados da empresa | Nome da empresa, e-mail e senha do admin (com validação de força) |
| Rede | Detecta o IP do servidor; verifica se a porta escolhida está livre |
| HTTPS | Opcional: gera certificado autoassinado ou usa um existente |
| Configuração | Gera o `.env` com `JWT_SECRET` e `DB_PASSWORD` aleatórios e seguros |
| Build | `docker compose up -d --build` |
| Verificação | Aguarda o health check e exibe URL + credenciais no terminal |

> `JWT_SECRET` e `DB_PASSWORD` são gerados aleatoriamente pelo script e salvos em `.env`. Guarde este arquivo em local seguro.

### Desinstalar

```bash
bash uninstall.sh
```

Pergunta separadamente sobre remoção de containers, volumes de dados e imagens.

### HTTPS

O cofre e a extensão **só funcionam em HTTPS** (a criptografia do navegador exige conexão segura), e o Chrome recusa certificados em que não confia — a extensão nem conecta. Duas formas:

**1. Autoridade própria (uso interno, sem domínio público)** — padrão do `install.sh`:

```bash
bash scripts/gen-certs.sh 192.168.0.10 vault.empresa.local   # IPs e/ou nomes do servidor
docker compose restart nginx
```

- Cria uma autoridade certificadora da instalação (`ssl-ca/ca.key`, fora da pasta montada no nginx — faça backup) e o certificado do servidor com SAN (`ssl/cert.pem`, 825 dias).
- Em **cada computador**, instale **uma vez** o certificado público da autoridade como raiz confiável. Ele fica em `ssl/ca.crt` e também em `https://<servidor>:<porta>/ca.crt`:
  - **Windows:** duplo clique em `ca.crt` → *Instalar certificado* → *Máquina local* → *Autoridades de Certificação Raiz Confiáveis* (ou distribua por GPO).
  - **macOS:** *Acesso às Chaves* → *Sistema* → importar → *Sempre confiar*.
  - **Linux (Chrome):** `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "VaultGuard CA" -i ca.crt` (pacote `libnss3-tools`).
  - Depois, feche e abra o Chrome. Confira a impressão digital (SHA-256) do `ca.crt` com a TI antes de instalar.
- Para renovar o certificado do servidor, rode o script de novo: a autoridade é reaproveitada e os computadores não precisam de nada.

**2. Certificado de uma autoridade pública ou corporativa** (ex.: Let's Encrypt para `vault.suaempresa.com`):

```bash
cp /caminho/fullchain.pem ssl/cert.pem
cp /caminho/privkey.pem   ssl/key.pem
docker compose restart nginx
```

O `docker-compose.ssl.yml` (ativado via `COMPOSE_FILE` no `.env`) publica a porta HTTPS; o `nginx-https.conf` usa TLS 1.2/1.3. As pastas `ssl/` e `ssl-ca/` estão no `.gitignore`.

### O que o container executa na inicialização

```
docker-entrypoint.sh:
  npx prisma migrate deploy   → aplica migrations (com retry automático)
  node src/prisma/seed.js     → cria empresa e admin (idempotente)
  node src/server.js          → inicia o servidor
```

---

## Instalação manual (sem Docker)

> Para a grande maioria dos casos, prefira a **instalação automática com `bash install.sh`** descrita acima — ela cuida do Docker, da geração de segredos e da configuração de rede automaticamente. A instalação manual é indicada apenas para ambientes sem Docker ou integrações customizadas.

### Requisitos

- Node.js 22+
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

- **Preenchimento como o do Chrome:** ao abrir um site com uma única senha salva, preenche usuário e senha sozinho (opção "Preencher automaticamente" no popup; só em https ou localhost). Com mais de uma, ao clicar no campo aparece a lista para escolher.
- **Salvar senha nova:** depois do login num site sem senha salva, aparece na própria página **"Salvar senha?"** com a escolha da pasta (pessoal, de equipe ou compartilhada, só as que você pode editar). Funciona com formulário comum, login por JavaScript (botão sem `submit`), Enter e login em duas etapas (usuário numa tela, senha na outra).
- **Atualizar senha:** se a senha digitada for diferente da salva para o mesmo usuário, pergunta **"Atualizar a senha salva?"**; a anterior vai para o histórico. Se a senha já estiver salva, não pergunta nada.
- **"Nunca neste site"** para não perguntar mais naquele site.
- **Pastas compartilhadas:** senhas salvas por colegas em pastas a que você tem acesso aparecem no site e na busca do popup.
- **Certificados digitais (A1):** cadastre no cofre com o modelo **Certificado Digital** (arquivo `.pfx` em Anexos + senha do certificado, URL do site principal). Ao abrir esse site, a extensão avisa no canto da página; no popup, a aba **Certificados** lista todos com validade, **baixa o `.pfx` decifrado** e **copia a senha**. No Windows, abrir o `.pfx` instala o certificado e o próprio Chrome passa a oferecê-lo quando o site pedir.
  > O Chrome não permite que extensões entreguem o certificado diretamente ao site no momento em que ele é solicitado (isso só existe no ChromeOS); o uso passa pelo repositório de certificados do sistema.
- **Badge** com o número de credenciais do site atual.
- **Busca** em todas as credenciais e certificados acessíveis.

**Permissões do manifest:**

| Permissão | Uso |
|---|---|
| `storage` | URL do servidor e token (local); chaves desbloqueadas e senha detectada só na sessão (memória) |
| `tabs` | Lê a URL da aba ativa para filtrar credenciais e o badge |
| `host_permissions: <all_urls>` | Content script de autofill em qualquer site e chamadas ao servidor sem depender de CORS |

**Proteções:**

- Só a **origem** da página (esquema + host + porta) vai ao servidor; caminho e query, que podem ter tokens, não saem do navegador.
- Preenche só no domínio da credencial (ou subdomínio), na mesma porta se a credencial fixar uma, e **nunca** uma credencial `https` em página `http`.
- O popup de autofill fica num shadow root fechado: o site não lê títulos e usuários nem aciona o preenchimento por script.
- O popup não é acessível a sites (sem `web_accessible_resources`) e não carrega ícones de serviços externos.
- Cofre bloqueia após **30 minutos sem uso** e ao fechar o navegador; botão de bloqueio manual no popup.
- Senha copiada é apagada da área de transferência após 30 segundos (enquanto a janela do VaultGuard estiver aberta).
- Aviso ao configurar um servidor `http://` fora da própria máquina.

---|---|
| `storage` | URL do servidor e token (local); chaves desbloqueadas só na sessão |
| `activeTab` | Lê a URL da aba atual para filtrar credenciais |
| `scripting` | Injeta autofill nos campos de formulário |
| `tabs` | Detecta navegação entre abas |

---

## Segurança

### Criptografia (zero-knowledge)

O servidor guarda apenas conteúdo cifrado no navegador: nem o banco nem quem administra o servidor consegue ler as senhas.

| Chave | O que protege | Onde fica |
|---|---|---|
| KEK (PBKDF2-SHA256, 210 000 iterações, senha + `encryptionSalt`) | A chave privada do usuário | Só na memória da aba / da extensão |
| Par RSA-OAEP 3072 do usuário | Recebe as chaves das pastas | Pública no servidor; privada cifrada com a KEK |
| Chave AES-256 da pasta | As chaves das credenciais da pasta | Uma cópia cifrada para cada pessoa com acesso |
| Chave AES-256 da credencial | Senha, campos do tipo senha, notas, histórico e anexos | Cifrada com a chave da pasta (e com a chave pública de quem recebeu compartilhamento individual) |
| Chave da organização (RSA) | Cópia das chaves das pastas **não pessoais** | Privada cifrada para cada administrador |

- **Distribuição automática:** quando alguém ganha acesso a uma pasta (permissão, cargo, equipe, pedido aprovado), qualquer membro ou administrador online entrega a cópia da chave em até 2 minutos.
- **Revogação:** quem perde acesso tem a cópia apagada e a pasta recebe **chave nova** no próximo acesso de um membro. As chaves das credenciais são re-embrulhadas, sem re-cifrar o conteúdo.
- **Pastas pessoais** não recebem cópia da organização: nem o administrador as lê. Por isso, **redefinir a senha de um usuário pelo painel apaga as chaves dele e o conteúdo da pasta pessoal fica ilegível**. As pastas compartilhadas são liberadas de novo automaticamente.
- **Troca de senha no AD:** no próximo acesso o cofre pede a senha anterior uma vez para transferir as chaves.
- **Bloqueio:** as chaves ficam só em memória; recarregar a página bloqueia o cofre de novo.
- **Formatos antigos (v0/v1)** são migrados automaticamente quando quem consegue abri-los (e tem permissão de edição) entra no cofre.
- Título, usuário e URL ficam em texto puro: são usados na listagem, na busca do servidor e no preenchimento automático por site.

### Autenticação e sessão

- Sessão em cookie `httpOnly` + `SameSite=Strict` (o JWT nunca fica acessível ao JavaScript); requests que alteram estado exigem o cabeçalho `X-Requested-With`.
- JWT HS256 com duração configurável (`sessionTimeout`); logout, troca/redefinição de senha e desativação derrubam todas as sessões abertas.
- 2FA por TOTP com proteção contra reuso de código e **códigos de recuperação** opcionais; pode ser obrigatório para todos.
- Bloqueio temporário após N tentativas (configurável), com aviso por e-mail.
- **Política de senha:** tamanho mínimo, maiúscula, número, símbolo, **expiração**, **bloqueio de reuso** das últimas N senhas e troca obrigatória no primeiro acesso após senha definida pelo admin.
- **Whitelist de IPs/CIDR** para toda a API (o salvamento recusa uma lista que exclua o IP do próprio admin).
- **Alerta de novo dispositivo** (navegador + rede) por e-mail.
- Senhas locais com bcrypt (custo 12); senhas do AD nunca são armazenadas. Prefira LDAPS (636) ou StartTLS: sem isso as senhas trafegam em texto puro até o controlador de domínio.

### Tokens de API

- Prefixo `vg_` + 256 bits aleatórios; o banco guarda só o **SHA-256**.
- Escopos `read` / `write` aplicados de fato; acesso só às rotas que a extensão usa (credenciais, pastas, favoritos, anexos, chaves e `/auth/me`). Exportação/importação em massa nunca por token.
- Revogados automaticamente quando o admin redefine a senha do usuário.

### Rede e cabeçalhos

- Helmet com **CSP restritiva** (`script-src 'self'`, `frame-ancestors 'none'`), HSTS e demais cabeçalhos.
- CORS apenas para `FRONTEND_URL` (a extensão usa `host_permissions` e não depende de CORS).
- Atrás do Nginx, o IP real vem de `X-Forwarded-For` (`TRUST_PROXY=1`); no modo local sem proxy use `TRUST_PROXY=0`.
- O container roda como usuário sem privilégios (`node`).

| Camada | Rota | Limite |
|---|---|---|
| Nginx | `/api/auth/login`, `/api/auth/2fa/validate` | 5 req / min por IP |
| Nginx | `/api/*` | 30 req / min por IP |
| Express | login, 2FA, refresh, verificação de senha | 20 req / 15 min por IP |
| Express | `/api/*` | 200 req / min por IP |

### Notificações por e-mail

Configuráveis em **Configurações → E-mail** (SMTP ou Microsoft 365 via Graph): boas-vindas, senha alterada/redefinida, conta bloqueada, novo dispositivo, alertas ao admin (bloqueios, exportação do cofre, novos administradores, chaves descartadas, uso de código de recuperação), acesso a credencial e vencimento de senhas (diário).

### Auditoria

- Logins (e falhas, se habilitado), visualização de senha, criação/edição/exclusão, compartilhamentos, exportação, distribuição e rotação de chaves.
- Logs persistidos em volume Docker (`logs_data`) e em arquivo via Winston.

---

## Atualizando uma instalação existente

1. Confira o `.env`: `JWT_SECRET` (mínimo 32 caracteres, sem valor de exemplo), `DB_PASSWORD` e `ADMIN_PASSWORD` são obrigatórios — sem eles o Compose e o servidor não sobem.
2. `docker compose up -d --build` — as migrations rodam sozinhas.
3. **Um administrador deve entrar primeiro**: o navegador dele cria a chave da organização e as chaves das pastas. Até isso acontecer, os demais veem "aguardando".
4. Todos os usuários precisam entrar de novo (a sessão passou para cookie). Cada um gera o próprio par de chaves no primeiro acesso.
5. Extensão: recarregue `extension/dist/` em `chrome://extensions`. Os tokens existentes continuam válidos (com leitura e escrita).
6. Usuários do AD cujo e-mail coincide com uma conta local veem um erro no login até o admin vinculá-los em **Active Directory → Vincular usuários**.

---

## Testes de ponta a ponta

Ficam em `tests/e2e/` e rodam o sistema de verdade: backend, cofre web e a extensão carregada num Chromium.

```bash
cd tests/e2e
npm install
npx playwright install chromium   # ou defina CHROME_PATH para um Chromium já instalado
./run.sh web.mjs                  # cofre web: certificado digital e todas as telas sem erro
./run.sh ext.mjs                  # extensão: preencher, salvar, atualizar, certificados e proteções
```

Cada execução cria um PostgreSQL descartável em container (`vg-e2e-db`, porta 55432) e sobe o backend na porta 3901 — o ambiente real não é tocado. Requer Docker, Node.js 22 e `openssl`.

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

