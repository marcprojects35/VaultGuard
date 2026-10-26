-- Lixeira para senhas e pastas
ALTER TABLE "Credential" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Credential" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Credential" ADD COLUMN "deletedWithFolder" TEXT;
CREATE INDEX "Credential_deletedAt_idx" ON "Credential"("deletedAt");
ALTER TABLE "Folder" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Folder" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Folder" ADD COLUMN "deletedWithFolder" TEXT;
CREATE INDEX "Folder_deletedAt_idx" ON "Folder"("deletedAt");

-- Retenção configurável (0 = sem limite). Auditoria começa sem limite para
-- nenhuma instalação perder registros ao atualizar.
ALTER TABLE "SystemSettings" ADD COLUMN "trashRetentionDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "SystemSettings" ADD COLUMN "auditRetentionDays" INTEGER NOT NULL DEFAULT 0;
