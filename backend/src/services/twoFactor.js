// Quem precisa de 2FA e até quando.
//
// O 2FA pode ser exigido de todos (Configurações › Segurança), de uma pessoa
// (Usuários) ou dos membros de um grupo (Grupos). O admin define um prazo em
// dias: até lá a pessoa só vê o aviso; depois, só entra no perfil para ativar.
import { prisma } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_2FA_CONFIG = { issuer: '', instructions: '', graceDays: 0 };

// Lida em toda requisição de quem ainda não usa 2FA: cache curto
let cache = null;
let cacheAt = 0;
export function invalidateTwoFactorConfig() { cache = null; }

export async function getTwoFactorConfig() {
  if (!cache || Date.now() - cacheAt > 15000) {
    cache = await prisma.systemSettings.findUnique({
      where: { id: 'singleton' }, select: { twoFactorConfig: true, siteName: true, require2FA: true, require2FASince: true },
    });
    cacheAt = Date.now();
  }
  const s = cache;
  const cfg = { ...DEFAULT_2FA_CONFIG, ...(s?.twoFactorConfig || {}) };
  return { ...cfg, issuer: cfg.issuer || s?.siteName || 'VaultGuard', _settings: s };
}

/** { required, sources: [texto], deadline, blocking } para o usuário */
export async function twoFactorRequirement(user) {
  const cfg = await getTwoFactorConfig();
  const s = cfg._settings;
  const sources = [];
  const since = [];
  if (s?.require2FA) { sources.push('todos os usuários'); since.push(s.require2FASince || new Date(0)); }
  if (user.require2FA) { sources.push('sua conta'); since.push(user.require2FASince || new Date(0)); }
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id, status: 'ACTIVE', team: { require2FA: true } },
    select: { createdAt: true, respondedAt: true, team: { select: { name: true, require2FASince: true } } },
  });
  for (const m of memberships) {
    sources.push(`grupo ${m.team.name}`);
    // O prazo conta a partir do que veio por último: exigência no grupo ou entrada da pessoa
    const joined = m.respondedAt || m.createdAt;
    const teamSince = m.team.require2FASince || new Date(0);
    since.push(joined > teamSince ? joined : teamSince);
  }
  if (!sources.length) return { required: false, sources, deadline: null, blocking: false };
  const start = new Date(Math.min(...since.map(d => new Date(d).getTime())));
  const deadline = cfg.graceDays > 0 ? new Date(start.getTime() + cfg.graceDays * DAY_MS) : null;
  const blocking = !user.totpEnabled && (!deadline || Date.now() >= deadline.getTime());
  return { required: true, sources, deadline, blocking };
}
