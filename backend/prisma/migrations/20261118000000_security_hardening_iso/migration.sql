-- Iterações do PBKDF2 por pessoa (migra para 600.000 no próximo desbloqueio)
ALTER TABLE "User" ADD COLUMN "kdfIterations" INTEGER NOT NULL DEFAULT 210000;

-- Auditoria encadeada
ALTER TABLE "AuditLog" ADD COLUMN "actorId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "chainSeq" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;
CREATE UNIQUE INDEX "AuditLog_chainSeq_key" ON "AuditLog"("chainSeq");

-- Senhas de acesso com no mínimo 12 caracteres (vale na próxima troca)
UPDATE "SystemSettings"
SET "passwordPolicy" = jsonb_set("passwordPolicy"::jsonb, '{minLength}', '12')
WHERE "passwordPolicy" IS NOT NULL AND COALESCE(("passwordPolicy"->>'minLength')::int, 0) < 12;
