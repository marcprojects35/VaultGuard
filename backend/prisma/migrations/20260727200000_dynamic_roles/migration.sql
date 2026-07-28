-- Torna as classificações (cargos) dinâmicas: substitui o enum fixo "UserRole"
-- por uma tabela "Role" que o admin pode gerenciar (criar/renomear/excluir).
--
-- "User"."role" e "FolderPermission"."role" continuam guardando a MESMA string
-- (ex: 'ADMINISTRADOR', 'AUXILIAR') — só muda de enum pra texto com FK pra
-- "Role"."key". Nenhum dado existente é perdido.

-- 1. Cria a tabela Role
CREATE TABLE "Role" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("key")
);

-- 2. Popula as 6 classificações atuais ANTES de criar as FKs, senão a
--    constraint falha contra os valores já existentes em User/FolderPermission.
INSERT INTO "Role" ("key", "label", "priority", "isProtected", "color", "updatedAt") VALUES
    ('AUXILIAR',      'Auxiliar',      0, false, '#64748b', CURRENT_TIMESTAMP),
    ('ASSISTENTE',    'Assistente',    1, false, '#0ea5e9', CURRENT_TIMESTAMP),
    ('ANALISTA',      'Analista',      2, false, '#6366f1', CURRENT_TIMESTAMP),
    ('COORDENACAO',   'Coordenação',   3, false, '#8b5cf6', CURRENT_TIMESTAMP),
    ('DIRETORIA',     'Diretoria',     4, false, '#f59e0b', CURRENT_TIMESTAMP),
    ('ADMINISTRADOR', 'Administrador', 5, true,  '#ef4444', CURRENT_TIMESTAMP);

-- 3. Converte as colunas de enum pra texto (o valor textual do enum vira o
--    texto correspondente, sem perda de dado).
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'AUXILIAR';

ALTER TABLE "FolderPermission" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;

-- 4. Adiciona as foreign keys.
--    User.role fica RESTRICT (não deixa apagar uma Role em uso — a rota de
--    exclusão reatribui os usuários antes de apagar).
--    FolderPermission.role fica CASCADE (permissões de pasta da role apagada
--    deixam de fazer sentido e somem junto).
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey"
    FOREIGN KEY ("role") REFERENCES "Role"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_role_fkey"
    FOREIGN KEY ("role") REFERENCES "Role"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Remove o enum antigo, que não é mais referenciado por nenhuma coluna.
DROP TYPE "UserRole";
