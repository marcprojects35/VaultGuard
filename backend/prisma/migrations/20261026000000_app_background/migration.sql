-- Imagem de fundo das telas internas
ALTER TABLE "SystemSettings" ADD COLUMN "appBackgroundUrl" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "appOverlay" INTEGER NOT NULL DEFAULT 80;
