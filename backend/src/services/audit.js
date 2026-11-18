import { prisma } from '../db.js';
import { auditMac } from './secretBox.js';

// Auditoria à prova de adulteração: cada registro leva um HMAC do seu conteúdo e
// do registro anterior. Alterar, inserir ou apagar um registro no meio quebra a
// corrente (GET /api/audit/verify). A rotação remove só os mais antigos, então o
// registro mais velho que sobrou é aceito como início da corrente.

// JSON com chaves ordenadas: o banco não preserva a ordem das chaves
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function auditHash(row) {
  return auditMac(canonical({
    seq: row.chainSeq, prev: row.prevHash ?? null, at: new Date(row.createdAt).toISOString(),
    actor: row.actorId ?? null, action: row.action, resourceId: row.resourceId ?? null,
    resourceType: row.resourceType ?? null, details: row.details ?? null,
    ip: row.ipAddress ?? null, ua: row.userAgent ?? null,
  }));
}

let head; // último registro da corrente { chainSeq, hash }
let queue = Promise.resolve();

async function write(userId, action, resourceId, resourceType, details, ipAddress, userAgent) {
  const clean = details === undefined || details === null ? null : JSON.parse(JSON.stringify(details));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (head === undefined) {
      head = await prisma.auditLog.findFirst({
        where: { chainSeq: { not: null } }, orderBy: { chainSeq: 'desc' }, select: { chainSeq: true, hash: true },
      });
    }
    const row = {
      actorId: userId ?? null, action, resourceId: resourceId ?? null, resourceType: resourceType ?? null,
      details: clean, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null,
      createdAt: new Date(), chainSeq: (head?.chainSeq ?? 0) + 1, prevHash: head?.hash ?? null,
    };
    row.hash = auditHash(row);
    try {
      await prisma.auditLog.create({
        data: { ...row, userId: userId ?? null, details: clean ?? undefined },
      });
      head = { chainSeq: row.chainSeq, hash: row.hash };
      return;
    } catch (err) {
      head = undefined; // outro processo escreveu antes: relê o fim da corrente
      if (err.code !== 'P2002' || attempt === 2) throw err;
    }
  }
}

export function createAuditLog(...args) {
  // Um por vez: a corrente depende da ordem
  const run = queue.then(() => write(...args)).catch((err) => {
    // Não derruba a requisição por falha na auditoria
    console.error('Audit log error:', err);
  });
  queue = run;
  return run;
}

/** Confere a corrente inteira */
export async function verifyAuditChain() {
  let checked = 0;
  let prev = null;
  let cursor;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { chainSeq: cursor === undefined ? { not: null } : { gt: cursor } },
      orderBy: { chainSeq: 'asc' }, take: 1000,
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (auditHash(row) !== row.hash) return { ok: false, checked, brokenAt: row.chainSeq, reason: 'Registro alterado', at: row.createdAt };
      if (prev && row.chainSeq !== prev.chainSeq + 1) return { ok: false, checked, brokenAt: row.chainSeq, reason: 'Registro removido da sequência', at: row.createdAt };
      if (prev && row.prevHash !== prev.hash) return { ok: false, checked, brokenAt: row.chainSeq, reason: 'Corrente quebrada', at: row.createdAt };
      prev = row;
      checked++;
    }
    cursor = rows[rows.length - 1].chainSeq;
  }
  const legacy = await prisma.auditLog.count({ where: { chainSeq: null } });
  return { ok: true, checked, legacy };
}
