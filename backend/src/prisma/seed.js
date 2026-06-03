import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default system settings
  await prisma.systemSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      siteName: 'VaultGuard',
      siteSubtitle: 'Cofre de Senhas Corporativo',
      primaryColor: '#6366f1',
      accentColor: '#8b5cf6',
      bgColor: '#0f0f1a',
      surfaceColor: '#1a1a2e',
      defaultLanguage: 'pt-BR',
    }
  });

  // Create admin user
  const adminHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@vaultguard.local' },
    update: {},
    create: {
      email: 'admin@vaultguard.local',
      username: 'admin',
      passwordHash: adminHash,
      firstName: 'Administrador',
      lastName: 'Sistema',
      role: 'ADMINISTRADOR',
      status: 'ACTIVE',
    }
  });
  console.log('Admin created:', admin.email, '/ password: Admin@123456');

  // Create sample folders
  const rootFolders = [
    { name: 'Sistemas Internos', icon: 'server', color: '#6366f1' },
    { name: 'E-mails Corporativos', icon: 'mail', color: '#0ea5e9' },
    { name: 'Redes e Infraestrutura', icon: 'network', color: '#f59e0b' },
    { name: 'Financeiro', icon: 'banknote', color: '#10b981' },
    { name: 'RH e Pessoal', icon: 'users', color: '#ec4899' },
    { name: 'Diretoria', icon: 'building', color: '#8b5cf6' },
  ];

  const roles = ['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA'];

  for (const f of rootFolders) {
    const folder = await prisma.folder.upsert({
      where: { id: f.name.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: {
        id: f.name.toLowerCase().replace(/\s+/g, '-'),
        name: f.name,
        icon: f.icon,
        color: f.color,
      }
    });

    // Set permissions: roles with index >= foldersIndex can view
    const folderIdx = rootFolders.indexOf(f);
    for (let i = 0; i < roles.length; i++) {
      if (i >= folderIdx - 1 && i <= 4) {
        await prisma.folderPermission.upsert({
          where: { folderId_role: { folderId: folder.id, role: roles[i] } },
          update: {},
          create: {
            folderId: folder.id,
            role: roles[i],
            canView: true,
            canEdit: i >= folderIdx,
            canDelete: i >= folderIdx + 1,
            canShare: i >= folderIdx,
          }
        }).catch(() => {});
      }
    }
  }

  console.log('Sample folders created.');
  console.log('\nSetup complete!');
  console.log('Admin login: admin@vaultguard.local / Admin@123456');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
