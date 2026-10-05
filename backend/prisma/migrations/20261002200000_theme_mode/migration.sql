-- Tema claro/escuro escolhido na tela de Aparência
ALTER TABLE "SystemSettings" ADD COLUMN "themeMode" TEXT NOT NULL DEFAULT 'dark';
