-- E-mail de suporte exibido no login e no menu (configurável; vazio = não exibe)
ALTER TABLE "SystemSettings" ADD COLUMN "supportEmail" TEXT;
