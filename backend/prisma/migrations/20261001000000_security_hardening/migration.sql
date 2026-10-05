-- User: revogação de sessão, 2FA pendente e bloqueio por tentativas
ALTER TABLE "User" ADD COLUMN "totpPendingSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- ApiToken: passa a guardar apenas o hash SHA-256 do token.
-- Tokens existentes continuam válidos (o hash é calculado a partir do valor atual).
-- Escopos não eram aplicados até aqui, então os tokens antigos recebem read+write
-- para manter o comportamento que já tinham (ex.: salvar senha pela extensão).
ALTER TABLE "ApiToken" ADD COLUMN "tokenPrefix" TEXT;
UPDATE "ApiToken"
SET "tokenPrefix" = LEFT("token", 10),
    "token"       = encode(sha256(convert_to("token", 'UTF8')), 'hex'),
    "scopes"      = ARRAY['read', 'write']::TEXT[];
