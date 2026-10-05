-- Criptografia por pasta: chaves de usuário, de pasta, de credencial e da organização
ALTER TABLE "User" ADD COLUMN "publicKey" TEXT;
ALTER TABLE "User" ADD COLUMN "encryptedPrivateKey" TEXT;

ALTER TABLE "Folder" ADD COLUMN "keyInitialized" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Credential" ADD COLUMN "wrappedKey" TEXT;

ALTER TABLE "CredentialShare" ADD COLUMN "wrappedKey" TEXT;

CREATE TABLE "FolderKey" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FolderKey_folderId_holder_key" ON "FolderKey"("folderId", "holder");
CREATE INDEX "FolderKey_holder_idx" ON "FolderKey"("holder");
ALTER TABLE "FolderKey" ADD CONSTRAINT "FolderKey_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrgKey" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgKeyGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgKeyGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgKeyGrant_userId_key" ON "OrgKeyGrant"("userId");
