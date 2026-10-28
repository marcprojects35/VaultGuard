// Política das senhas guardadas nas pastas de um grupo (ex.: RH mínimo 10
// caracteres, Desenvolvimento mínimo 20, trocar a cada 90 dias).
//
// O cofre é de conhecimento zero: o servidor nunca vê a senha, então tamanho e
// complexidade são conferidos no cofre ao salvar. A validade é aplicada aqui:
// toda senha nova ou trocada numa pasta com política vence no prazo do grupo.
import { prisma } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Valida e normaliza a política enviada pelo admin; lança erro com mensagem */
export function normalizePolicy(input, teamFolderIds) {
  if (input === null) return null;
  const p = input || {};
  const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw Object.assign(new Error(`${label}: de ${min} a ${max}`), { status: 400 });
    return n;
  };
  const folderIds = Array.isArray(p.folderIds) ? [...new Set(p.folderIds.map(String))] : [];
  const unknown = folderIds.filter(id => !teamFolderIds.includes(id));
  if (unknown.length) throw Object.assign(new Error('Escolha só pastas deste grupo'), { status: 400 });
  return {
    enabled: p.enabled !== false,
    minLength: int(p.minLength ?? 12, 4, 128, 'Tamanho mínimo'),
    requireUppercase: !!p.requireUppercase,
    requireNumbers: !!p.requireNumbers,
    requireSymbols: !!p.requireSymbols,
    expireDays: int(p.expireDays ?? 0, 0, 3650, 'Validade em dias'),
    folderIds, // vazio = todas as pastas do grupo
  };
}

/** Política que vale para a pasta (ou null) */
export function policyForFolder(folder, teamPolicy) {
  if (!folder?.teamId || !teamPolicy?.enabled) return null;
  if (teamPolicy.folderIds?.length && !teamPolicy.folderIds.includes(folder.id)) return null;
  return teamPolicy;
}

export async function getFolderPolicy(folderId) {
  const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { id: true, teamId: true } });
  if (!folder?.teamId) return null;
  const team = await prisma.team.findUnique({ where: { id: folder.teamId }, select: { passwordPolicy: true } });
  return policyForFolder(folder, team?.passwordPolicy);
}

/**
 * Vencimento de uma senha nova/trocada: o prazo do grupo, ou a data pedida
 * se ela for antes. Sem política, vale o que foi pedido.
 */
export function policyExpiry(policy, requested) {
  const asked = requested ? new Date(requested) : null;
  if (!policy?.expireDays) return asked;
  const max = new Date(Date.now() + policy.expireDays * DAY_MS);
  // Data pedida já vencida (ex.: a da senha antiga) não vale para a senha nova
  return asked && asked > new Date() && asked < max ? asked : max;
}
