import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const companyName    = process.env.COMPANY_NAME    || 'VaultGuard';
  const adminEmail     = process.env.ADMIN_EMAIL     || 'admin@vaultguard.local';
  const adminPassword  = process.env.ADMIN_PASSWORD  || 'Admin@123456';

  console.log(`Configurando "${companyName}"...`);

  await prisma.systemSettings.upsert({
    where:  { id: 'singleton' },
    update: {},
    create: {
      id:             'singleton',
      siteName:       companyName,
      siteSubtitle:   'Cofre de Senhas Corporativo',
      primaryColor:   '#6366f1',
      accentColor:    '#8b5cf6',
      bgColor:        '#0f0f1a',
      surfaceColor:   '#1a1a2e',
      defaultLanguage:'pt-BR',
    }
  });

  const adminHash = await bcrypt.hash(adminPassword, 12);
  const username  = adminEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30) || 'admin';

  const admin = await prisma.user.upsert({
    where:  { email: adminEmail },
    update: {},
    create: {
      email:        adminEmail,
      username,
      passwordHash: adminHash,
      firstName:    'Administrador',
      lastName:     companyName,
      role:         'ADMINISTRADOR',
      status:       'ACTIVE',
    }
  });

  console.log(`Admin: ${admin.email}`);
  console.log('Setup completo. Crie suas pastas na interface de administração.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
