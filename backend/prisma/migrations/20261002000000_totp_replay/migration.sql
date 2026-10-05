-- Impede reuso de código TOTP dentro da janela de tolerância
ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER;
