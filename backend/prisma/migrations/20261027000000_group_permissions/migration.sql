-- Permissões por cargo (teto nas pastas compartilhadas e acesso a recursos)
ALTER TABLE "Role" ADD COLUMN "canEdit" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Role" ADD COLUMN "canDelete" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Role" ADD COLUMN "canShare" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Role" ADD COLUMN "canCreateTeams" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Role" ADD COLUMN "canExport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Role" ADD COLUMN "canImport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Role" ADD COLUMN "canUseApiTokens" BOOLEAN NOT NULL DEFAULT true;

-- Permissões dos membros nas pastas do grupo (padrões = comportamento anterior)
ALTER TABLE "Team" ADD COLUMN "memberCanEdit" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Team" ADD COLUMN "memberCanDelete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "memberCanShare" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "canEdit" BOOLEAN;
ALTER TABLE "TeamMember" ADD COLUMN "canDelete" BOOLEAN;
ALTER TABLE "TeamMember" ADD COLUMN "canShare" BOOLEAN;
