import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { getFolderAudiences } from './keys.js';

const prisma = new PrismaClient();

// Nomes, mensagens e títulos vêm de usuários: escapa antes de montar o HTML
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A tela de configurações grava { enabled, provider, smtp: { host, port, secure, user, password },
// office365: { tenantId, clientId, clientSecret }, fromName, fromEmail }
function readSmtpConfig(settings) {
  const cfg = settings?.smtpConfig || {};
  if (cfg.enabled === false) return null;
  const smtp = cfg.smtp || cfg;
  if (!smtp?.host) return null;
  return { cfg, smtp };
}

// ─── Microsoft 365 (Graph, permissão de aplicativo Mail.Send) ───────────────
const graphTokens = new Map(); // clientId -> { token, expiresAt }

export async function getGraphToken({ tenantId, clientId, clientSecret }, { force = false } = {}) {
  const cached = graphTokens.get(clientId);
  if (!force && cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description?.split('\r\n')[0] || data.error || `HTTP ${res.status}`);
  }
  graphTokens.set(clientId, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function sendViaGraph(cfg, { to, subject, html, text }) {
  if (!cfg.fromEmail) throw new Error('Defina o e-mail do remetente (caixa usada no Microsoft 365)');
  const token = await getGraphToken(cfg.office365);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.fromEmail)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: text || '' },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Microsoft Graph HTTP ${res.status}`);
  }
}

async function getTransporter() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
  const conf = readSmtpConfig(settings);
  if (!conf) return null;
  const { smtp } = conf;
  const user = smtp.user || smtp.username;

  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: smtp.secure === true || smtp.secure === 'true' || smtp.secure === 'ssl',
    auth: user ? { user, pass: smtp.password } : undefined,
    // Certificado inválido só com opt-in explícito (senão a senha SMTP fica exposta a MITM)
    tls: { rejectUnauthorized: smtp.allowInvalidCert !== true },
  });
}

export async function sendEmail({ to, subject, html, text, throwOnError = false }) {
  try {
    const settings0 = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const cfg0 = settings0?.smtpConfig || {};
    if (cfg0.enabled !== false && cfg0.provider === 'office365') {
      if (!cfg0.office365?.clientSecret) throw new Error('Microsoft 365 não conectado');
      await sendViaGraph(cfg0, { to, subject: String(subject).replace(/[\r\n]+/g, ' '), html, text });
      return true;
    }

    const transporter = await getTransporter();
    if (!transporter) {
      if (throwOnError) throw new Error('E-mail desativado ou servidor SMTP não configurado');
      logger.warn('Email not configured — skipping send');
      return false;
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });
    const { cfg } = readSmtpConfig(settings);
    const fromName = String(cfg.fromName || settings?.siteName || 'VaultGuard').replace(/["\r\n]/g, '');

    await transporter.sendMail({
      from: `"${fromName}" <${cfg.fromEmail || 'noreply@vaultguard.local'}>`,
      to,
      // Assunto vai em cabeçalho: sem quebras de linha
      subject: String(subject).replace(/[\r\n]+/g, ' '),
      html,
      text,
    });
    return true;
  } catch (err) {
    logger.error('Email send error:', { error: err.message });
    if (throwOnError) throw err;
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
      html: `<p><strong>${esc(requester.firstName)} ${esc(requester.lastName)}</strong> solicitou acesso à pasta <strong>${esc(folder.name)}</strong>.</p>${message ? `<p>Mensagem: ${esc(message)}</p>` : ''}<p>Acesse o VaultGuard para aprovar ou rejeitar.</p>`,
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
    html: `<p>${esc(user.firstName)}, sua solicitação de acesso à pasta <strong>${esc(folderName)}</strong> foi <strong>${approved ? 'aprovada ✅' : 'rejeitada ❌'}</strong>.</p>`,
  });
}

export async function sendTeamInviteNotification({ inviteeId, team, inviter }) {
  const invitee = await prisma.user.findUnique({ where: { id: inviteeId }, select: { email: true, firstName: true } });
  if (!invitee?.email) return;

  await sendEmail({
    to: invitee.email,
    subject: `[VaultGuard] Convite para a equipe "${team.name}"`,
    text: `${inviter.firstName} ${inviter.lastName} convidou você para a equipe "${team.name}". Acesse o VaultGuard em Equipes para aceitar ou recusar.`,
    html: `<p><strong>${esc(inviter.firstName)} ${esc(inviter.lastName)}</strong> convidou você para a equipe <strong>${esc(team.name)}</strong>.</p><p>Acesse o VaultGuard em "Equipes" para aceitar ou recusar.</p>`,
  });
}

export async function sendExpiryNotifications() {
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const expiring = await prisma.credential.findMany({
    where: { expiresAt: { not: null, gt: new Date(), lt: in7Days } },
    select: { id: true, title: true, expiresAt: true, folderId: true }
  });

  if (expiring.length === 0) return;

  // Quem enxerga a pasta (dono, equipe, corporativa, permissões) recebe o aviso
  const audiences = await getFolderAudiences([...new Set(expiring.map(c => c.folderId))]);
  const userIds = new Set();
  for (const set of audiences.values()) set.forEach(id => userIds.add(id));

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] }, status: 'ACTIVE' },
    select: { id: true, email: true, firstName: true }
  });

  for (const user of users) {
    const userCreds = expiring.filter(c => audiences.get(c.folderId)?.has(user.id));
    if (userCreds.length === 0) continue;

    const list = userCreds.map(c =>
      `- ${c.title} (expira em ${new Date(c.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })})`
    ).join('\n');

    await sendEmail({
      to: user.email,
      subject: `[VaultGuard] ${userCreds.length} senha(s) expirando em breve`,
      text: `${user.firstName}, as seguintes credenciais vencerão em 7 dias:\n\n${list}`,
      html: `<p>${esc(user.firstName)}, as seguintes credenciais vencerão em 7 dias:</p><ul>${userCreds.map(c => `<li><strong>${esc(c.title)}</strong> — expira em ${new Date(c.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</li>`).join('')}</ul>`,
    });
  }
}
