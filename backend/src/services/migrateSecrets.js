// Cifra os segredos gravados antes da DATA_ENCRYPTION_KEY existir e, na rotação
// da chave (DATA_ENCRYPTION_KEY_OLD), recifra tudo com a chave nova.
import { prisma } from '../db.js';
import { hasOldKey } from './secretBox.js';
import logger from '../utils/logger.js';

export async function migrateSecrets() {
  const rotate = hasOldKey();
  const users = rotate
    ? await prisma.$queryRaw`SELECT id FROM "User" WHERE "totpSecret" IS NOT NULL OR "totpPendingSecret" IS NOT NULL`
    : await prisma.$queryRaw`SELECT id FROM "User"
        WHERE ("totpSecret" IS NOT NULL AND "totpSecret" NOT LIKE 'enc:v1:%')
           OR ("totpPendingSecret" IS NOT NULL AND "totpPendingSecret" NOT LIKE 'enc:v1:%')`;
  for (const { id } of users) {
    const u = await prisma.user.findUnique({ where: { id }, select: { totpSecret: true, totpPendingSecret: true } });
    await prisma.user.update({ where: { id }, data: { totpSecret: u.totpSecret, totpPendingSecret: u.totpPendingSecret } });
  }
  const s = await prisma.systemSettings.findUnique({ where: { id: 'singleton' }, select: { ldapConfig: true, smtpConfig: true } });
  if (s?.ldapConfig || s?.smtpConfig) {
    await prisma.systemSettings.update({
      where: { id: 'singleton' },
      data: { ...(s.ldapConfig && { ldapConfig: s.ldapConfig }), ...(s.smtpConfig && { smtpConfig: s.smtpConfig }) },
    });
  }
  if (users.length) logger.info(`Segredos cifrados: ${users.length} usuário(s)`);
}
