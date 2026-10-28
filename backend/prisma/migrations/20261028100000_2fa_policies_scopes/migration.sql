-- 2FA por pessoa e por grupo, configuração do 2FA
ALTER TABLE "User" ADD COLUMN "require2FA" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "require2FASince" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "themeInverted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "require2FA" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "require2FASince" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN "twoFactorConfig" JSONB;
ALTER TABLE "SystemSettings" ADD COLUMN "require2FASince" TIMESTAMP(3);

-- Política de senhas guardadas por grupo e grupos vindos do AD
ALTER TABLE "Team" ADD COLUMN "passwordPolicy" JSONB;
ALTER TABLE "Team" ADD COLUMN "adGroupDn" TEXT;
ALTER TABLE "Team" ADD COLUMN "adSyncedAt" TIMESTAMP(3);

-- Auditoria em janela móvel: novas instalações guardam 90 dias
ALTER TABLE "SystemSettings" ALTER COLUMN "auditRetentionDays" SET DEFAULT 90;

-- Cargo dentro de um grupo
CREATE TABLE "RoleGroupScope" (
    "id" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "folderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canEdit" BOOLEAN NOT NULL DEFAULT true,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canShare" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoleGroupScope_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoleGroupScope_roleKey_teamId_key" ON "RoleGroupScope"("roleKey", "teamId");
CREATE INDEX "RoleGroupScope_teamId_idx" ON "RoleGroupScope"("teamId");
ALTER TABLE "RoleGroupScope" ADD CONSTRAINT "RoleGroupScope_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "Role"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleGroupScope" ADD CONSTRAINT "RoleGroupScope_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
