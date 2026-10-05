-- Tipo da credencial: login de site ou certificado digital
ALTER TABLE "Credential" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'login';
