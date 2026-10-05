import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { sendEmail, esc } from './email.js';
import { getSecuritySettings } from './securitySettings.js';
import { createAuditLog } from './audit.js';

// Notificações de segurança. Todas são "fire and forget": falha de e-mail
// nunca derruba a operação principal.

const prisma = new PrismaClient();
const appUrl = () => (process.env.FRONTEND_URL || '').split(',')[0].trim();

const fireAndForget = (p) => { p.catch(() => {}); };

async function emailAdmins(subject, text) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMINISTRADOR', status: 'ACTIVE' }, select: { email: true },
  });
  for (const a of admins) {
    await sendEmail({ to: a.email, subject, text, html: `<p>${esc(text).replace(/\n/g, '<br>')}</p>` });
  }
}

/** Evento de segurança grave para os administradores (se habilitado). */
export function notifyAdminAlert(subject, text) {
  fireAndForget((async () => {
    const { notifications } = await getSecuritySettings();
    if (notifications.adminAlert) await emailAdmins(`[VaultGuard] Alerta: ${subject}`, text);
  })());
}

export function notifyNewUser(user) {
  fireAndForget((async () => {
    const { notifications } = await getSecuritySettings();
    if (!notifications.newUser) return;
    const url = appUrl();
    await sendEmail({
      to: user.email,
      subject: '[VaultGuard] Sua conta foi criada',
      text: `Olá ${user.firstName}, sua conta no VaultGuard foi criada (usuário: ${user.username}).\n` +
        `A senha inicial será informada pelo administrador e precisa ser trocada no primeiro acesso.` +
        (url ? `\n\nAcesse: ${url}` : ''),
      html: `<p>Olá ${esc(user.firstName)}, sua conta no VaultGuard foi criada (usuário: <strong>${esc(user.username)}</strong>).</p>` +
        `<p>A senha inicial será informada pelo administrador e precisa ser trocada no primeiro acesso.</p>` +
        (url ? `<p>Acesse: ${esc(url)}</p>` : ''),
    });
  })());
}

/** Senha trocada pelo próprio usuário ou redefinida pelo admin. */
export function notifyPasswordChanged(user, { byAdmin = false } = {}) {
  fireAndForget((async () => {
    const { notifications } = await getSecuritySettings();
    if (!notifications.passwordReset) return;
    const msg = byAdmin
      ? 'Sua senha do VaultGuard foi redefinida por um administrador. Você precisará criar uma senha nova no próximo acesso.'
      : 'Sua senha do VaultGuard foi alterada. Se não foi você, avise o administrador imediatamente.';
    await sendEmail({
      to: user.email,
      subject: '[VaultGuard] Senha alterada',
      text: `Olá ${user.firstName}, ${msg}`,
      html: `<p>Olá ${esc(user.firstName)}, ${esc(msg)}</p>`,
    });
  })());
}

/** Conta bloqueada por tentativas: avisa o usuário e os admins. */
export function notifyLockout(user, ip, attempts) {
  fireAndForget((async () => {
    const { notifications, lockoutMinutes } = await getSecuritySettings();
    if (notifications.failedLogin) {
      await sendEmail({
        to: user.email,
        subject: '[VaultGuard] Conta bloqueada temporariamente',
        text: `Olá ${user.firstName}, houve ${attempts} tentativas de login sem sucesso na sua conta (IP ${ip || 'desconhecido'}). ` +
          `Ela ficará bloqueada por ${lockoutMinutes} minutos. Se não foi você, avise o administrador.`,
        html: `<p>Olá ${esc(user.firstName)}, houve ${attempts} tentativas de login sem sucesso na sua conta (IP ${esc(ip || 'desconhecido')}).</p>` +
          `<p>Ela ficará bloqueada por ${lockoutMinutes} minutos. Se não foi você, avise o administrador.</p>`,
      });
    }
    if (notifications.adminAlert) {
      await emailAdmins('[VaultGuard] Alerta: conta bloqueada',
        `A conta ${user.email} foi bloqueada após ${attempts} tentativas de login (IP ${ip || 'desconhecido'}).`);
    }
  })());
}

function deviceFingerprint(ua, ip) {
  // Navegador + rede /24 (IPv4) ou /64 aprox. (IPv6): troca de IP dentro da mesma rede não alerta
  const addr = String(ip || '').replace(/^::ffff:/, '');
  const net = addr.includes('.') ? addr.split('.').slice(0, 3).join('.') : addr.split(':').slice(0, 4).join(':');
  return createHash('sha256').update(`${ua || ''}|${net}`).digest('hex');
}

/**
 * Registra o dispositivo do login. Se for novo (e não o primeiro da conta),
 * audita e avisa o usuário.
 */
export async function trackLoginDevice(user, ip, ua) {
  try {
    const fingerprint = deviceFingerprint(ua, ip);
    const existing = await prisma.userDevice.findUnique({ where: { userId_fingerprint: { userId: user.id, fingerprint } } });
    if (existing) {
      await prisma.userDevice.update({ where: { id: existing.id }, data: { lastSeen: new Date(), ip } });
      return;
    }
    const known = await prisma.userDevice.count({ where: { userId: user.id } });
    await prisma.userDevice.create({ data: { userId: user.id, fingerprint, userAgent: ua?.slice(0, 500), ip } });
    if (known === 0) return;

    await createAuditLog(user.id, 'user.new_device', null, null, { ip, userAgent: ua?.slice(0, 200) }, ip, ua);
    const { alertOnNewDevice, notifications } = await getSecuritySettings();
    if (!alertOnNewDevice || !notifications.newDevice) return;
    fireAndForget(sendEmail({
      to: user.email,
      subject: '[VaultGuard] Novo acesso à sua conta',
      text: `Olá ${user.firstName}, houve um login na sua conta a partir de um dispositivo novo.\n\nIP: ${ip}\nNavegador: ${ua || 'desconhecido'}\nData: ${new Date().toLocaleString('pt-BR')}\n\nSe não foi você, troque sua senha e avise o administrador.`,
      html: `<p>Olá ${esc(user.firstName)}, houve um login na sua conta a partir de um dispositivo novo.</p>` +
        `<p>IP: ${esc(ip)}<br>Navegador: ${esc(ua || 'desconhecido')}<br>Data: ${esc(new Date().toLocaleString('pt-BR'))}</p>` +
        `<p>Se não foi você, troque sua senha e avise o administrador.</p>`,
    }));
  } catch { /* não bloqueia o login */ }
}

// Uma notificação por usuário+credencial por hora, para não inundar caixas de entrada
const viewThrottle = new Map();
const VIEW_THROTTLE_MS = 60 * 60 * 1000;

/** Senha de uma credencial foi aberta (GET da credencial com a senha cifrada). */
export function notifyCredentialView(viewer, cred) {
  fireAndForget((async () => {
    const { notifications } = await getSecuritySettings();
    if (!notifications.credentialView) return;
    const key = `${viewer.id}:${cred.id}`;
    const last = viewThrottle.get(key);
    if (last && Date.now() - last < VIEW_THROTTLE_MS) return;
    viewThrottle.set(key, Date.now());
    if (viewThrottle.size > 10000) viewThrottle.clear();
    await emailAdmins('[VaultGuard] Credencial acessada',
      `${viewer.firstName} ${viewer.lastName} (${viewer.email}) abriu a credencial "${cred.title}" em ${new Date().toLocaleString('pt-BR')}.`);
  })());
}
