import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

const prisma = new PrismaClient();

async function getTransporter() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
  const smtp = settings?.smtpConfig;
  if (!smtp?.host) return null;

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure ?? false,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    tls: { rejectUnauthorized: false },
  });
}

export async function sendEmail({ to, subject, html, text }) {
  try {
    const transporter = await getTransporter();
    if (!transporter) {
      logger.warn('Email not configured — skipping send');
      return false;
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const smtp = settings?.smtpConfig;

    await transporter.sendMail({
      from: smtp?.from || `"${settings?.siteName || 'VaultGuard'}" <noreply@vaultguard.local>`,
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    logger.error('Email send error:', err.message);
    return false;
  }
}

export async function sendAccessRequestNotification({ requester, folder, message }) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMINISTRADOR', status: 'ACTIVE' },
    select: { email: true, firstName: true }
  });

  for (const admin of admins) {
    await sendEmail({
      to: admin.email,
      subject: `[VaultGuard] Solicitação de Acesso: ${folder.name}`,
      text: `${requester.firstName} ${requester.lastName} solicitou acesso à pasta "${folder.name}".\n\nMensagem: ${message || 'Sem mensagem'}\n\nAcesse o VaultGuard para aprovar ou rejeitar.`,
      html: `<p><strong>${requester.firstName} ${requester.lastName}</strong> solicitou acesso à pasta <strong>${folder.name}</strong>.</p>${message ? `<p>Mensagem: ${message}</p>` : ''}<p>Acesse o VaultGuard para aprovar ou rejeitar.</p>`,
    });
  }
}

export async function sendAccessRequestResult({ userId, folderName, approved }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
  if (!user?.email) return;

  await sendEmail({
    to: user.email,
    subject: `[VaultGuard] Solicitação de Acesso ${approved ? 'Aprovada' : 'Rejeitada'}`,
    text: `${user.firstName}, sua solicitação de acesso à pasta "${folderName}" foi ${approved ? 'aprovada' : 'rejeitada'}.`,
    html: `<p>${user.firstName}, sua solicitação de acesso à pasta <strong>${folderName}</strong> foi <strong>${approved ? 'aprovada ✅' : 'rejeitada ❌'}</strong>.</p>`,
  });
}

export async function sendExpiryNotifications() {
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const expiring = await prisma.credential.findMany({
    where: { expiresAt: { not: null, gt: new Date(), lt: in7Days } },
    select: {
      id: true, title: true, expiresAt: true,
      folder: { select: { name: true, ownerId: true, permissions: { select: { userId: true } } } }
    }
  });

  if (expiring.length === 0) return;

  const userIds = new Set();
  expiring.forEach(c => {
    if (c.folder.ownerId) userIds.add(c.folder.ownerId);
    c.folder.permissions.forEach(p => { if (p.userId) userIds.add(p.userId); });
  });

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] }, status: 'ACTIVE' },
    select: { id: true, email: true, firstName: true }
  });

  for (const user of users) {
    const userCreds = expiring.filter(c =>
      c.folder.ownerId === user.id || c.folder.permissions.some(p => p.userId === user.id)
    );
    if (userCreds.length === 0) continue;

    const list = userCreds.map(c =>
      `- ${c.title} (expira em ${new Date(c.expiresAt).toLocaleDateString('pt-BR')})`
    ).join('\n');

    await sendEmail({
      to: user.email,
      subject: `[VaultGuard] ${userCreds.length} senha(s) expirando em breve`,
      text: `${user.firstName}, as seguintes credenciais vencerão em 7 dias:\n\n${list}`,
      html: `<p>${user.firstName}, as seguintes credenciais vencerão em 7 dias:</p><ul>${userCreds.map(c => `<li><strong>${c.title}</strong> — expira em ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}</li>`).join('')}</ul>`,
    });
  }
}
