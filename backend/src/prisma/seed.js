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

  const rootFolders = [
    { name: 'Sistemas Internos',       icon: 'server',   color: '#6366f1' },
    { name: 'E-mails Corporativos',    icon: 'mail',     color: '#0ea5e9' },
    { name: 'Redes e Infraestrutura',  icon: 'network',  color: '#f59e0b' },
    { name: 'Financeiro',              icon: 'banknote', color: '#10b981' },
    { name: 'RH e Pessoal',            icon: 'users',    color: '#ec4899' },
    { name: 'Diretoria',               icon: 'building', color: '#8b5cf6' },
  ];

  const roles = ['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA'];

  for (const f of rootFolders) {
    const folderId = f.name.toLowerCase().replace(/\s+/g, '-');
    const folder = await prisma.folder.upsert({
      where:  { id: folderId },
      update: {},
      create: { id: folderId, name: f.name, icon: f.icon, color: f.color }
    });

    const folderIdx = rootFolders.indexOf(f);
    for (let i = 0; i < roles.length; i++) {
      if (i >= folderIdx - 1 && i <= 4) {
        await prisma.folderPermission.upsert({
          where:  { folderId_role: { folderId: folder.id, role: roles[i] } },
          update: {},
          create: {
            folderId: folder.id,
            role:      roles[i],
            canView:   true,
            canEdit:   i >= folderIdx,
            canDelete: i >= folderIdx + 1,
            canShare:  i >= folderIdx,
          }
        }).catch(() => {});
      }
    }
  }

  console.log('Setup completo.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
