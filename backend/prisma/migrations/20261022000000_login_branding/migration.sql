-- Personalização da tela de login
ALTER TABLE "SystemSettings" ADD COLUMN "loginBackgroundUrl" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "loginOverlay" INTEGER NOT NULL DEFAULT 55;
ALTER TABLE "SystemSettings" ADD COLUMN "loginMessage" TEXT;

-- Fundo/superfície vazios passam a significar "cores do tema"; os padrões
-- antigos (escuros) quebravam o tema claro
ALTER TABLE "SystemSettings" ALTER COLUMN "bgColor" SET DEFAULT '';
ALTER TABLE "SystemSettings" ALTER COLUMN "surfaceColor" SET DEFAULT '';
UPDATE "SystemSettings" SET "bgColor" = '' WHERE lower("bgColor") = '#0f0f1a';
UPDATE "SystemSettings" SET "surfaceColor" = '' WHERE lower("surfaceColor") = '#1a1a2e';

ALTER TABLE "SystemSettings" ALTER COLUMN "primaryColor" SET DEFAULT '#c78c00';
ALTER TABLE "SystemSettings" ALTER COLUMN "accentColor" SET DEFAULT '#ad7b04';
