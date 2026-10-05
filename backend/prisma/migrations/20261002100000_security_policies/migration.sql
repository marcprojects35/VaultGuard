-- Políticas de senha, códigos de recuperação do 2FA, dispositivos e rotação de chave
ALTER TABLE "User" ADD COLUMN "totpRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passwordHistory" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Folder" ADD COLUMN "needsKeyRotation" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserDevice_userId_fingerprint_key" ON "UserDevice"("userId", "fingerprint");
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");
