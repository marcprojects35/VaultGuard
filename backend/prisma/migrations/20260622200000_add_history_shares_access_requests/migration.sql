-- CreateTable CredentialHistory
CREATE TABLE "CredentialHistory" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "encryptedPass" TEXT NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CredentialHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable CredentialShare
CREATE TABLE "CredentialShare" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "sharedById" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CredentialShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable AccessRequest
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CredentialHistory_credentialId_idx" ON "CredentialHistory"("credentialId");
CREATE INDEX "CredentialHistory_changedAt_idx" ON "CredentialHistory"("changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialShare_credentialId_sharedWithId_key" ON "CredentialShare"("credentialId", "sharedWithId");
CREATE INDEX "CredentialShare_credentialId_idx" ON "CredentialShare"("credentialId");
CREATE INDEX "CredentialShare_sharedWithId_idx" ON "CredentialShare"("sharedWithId");

-- CreateIndex
CREATE INDEX "AccessRequest_userId_idx" ON "AccessRequest"("userId");
CREATE INDEX "AccessRequest_folderId_idx" ON "AccessRequest"("folderId");
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");
