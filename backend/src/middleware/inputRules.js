// Regras de entrada compartilhadas: tipos, tamanhos e formatos aceitos pela API.
const isStr = (v) => typeof v === 'string';
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const ICON_NAME = /^[a-z0-9-]{1,40}$/i;
// Esquemas que executam código ou leem arquivos ao clicar no link
export const unsafeUrl = (url) => /^\s*(javascript|data|vbscript|file|blob):/i.test(String(url));

/** Texto opcional com limite; devolve mensagem de erro ou null */
export function textProblem(value, label, max) {
  if (value === undefined || value === null) return null;
  if (!isStr(value)) return `${label}: formato inválido`;
  return value.length > max ? `${label}: máximo de ${max} caracteres` : null;
}

/** Corpo de criação/edição de credencial */
export function credentialProblem(b) {
  const texts = [['title', 'Título', 255], ['username', 'Usuário', 255], ['url', 'URL', 2048],
    ['notes', 'Anotações', 200000], ['encryptedPass', 'Senha', 100000], ['wrappedKey', 'Chave', 10000]];
  for (const [key, label, max] of texts) {
    const p = textProblem(b[key], label, max);
    if (p) return p;
  }
  if (b.url && unsafeUrl(b.url)) return 'URL: endereço não permitido';
  if (b.tags !== undefined && b.tags !== null && !isStr(b.tags)) {
    if (!Array.isArray(b.tags) || b.tags.length > 50 || b.tags.some(t => !isStr(t) || t.length > 60)) return 'Tags: até 50, com 60 caracteres cada';
  }
  if (b.strength !== undefined && b.strength !== null && !(Number.isInteger(b.strength) && b.strength >= 0 && b.strength <= 100)) return 'Força da senha inválida';
  if (b.expiresAt && Number.isNaN(new Date(b.expiresAt).getTime())) return 'Data de validade inválida';
  if (b.customFields !== undefined && b.customFields !== null) {
    if (!Array.isArray(b.customFields) || b.customFields.length > 100) return 'Campos personalizados: até 100';
    for (const f of b.customFields) {
      if (!f || !isStr(f.name) || !isStr(f.value) || f.name.length > 255 || f.value.length > 100000) return 'Campo personalizado inválido';
      if (f.fieldType !== undefined && !/^[a-z]{1,20}$/.test(String(f.fieldType))) return 'Tipo de campo inválido';
    }
  }
  return null;
}

export function checkCredentialBody(req, res, next) {
  const problem = credentialProblem(req.body || {});
  return problem ? res.status(400).json({ error: problem }) : next();
}

/** Nome, descrição, ícone e cor de pasta */
export function folderProblem(b) {
  return textProblem(b.name, 'Nome', 120) || textProblem(b.description, 'Descrição', 500)
    || (b.color !== undefined && b.color !== null && !HEX_COLOR.test(String(b.color)) ? 'Cor inválida' : null)
    || (b.icon !== undefined && b.icon !== null && !ICON_NAME.test(String(b.icon)) ? 'Ícone inválido' : null)
    || (b.sortOrder !== undefined && !(Number.isInteger(b.sortOrder) && Math.abs(b.sortOrder) <= 100000) ? 'Ordem inválida' : null)
    || (b.parentId !== undefined && b.parentId !== null && !isStr(b.parentId) ? 'Pasta superior inválida' : null);
}

// Anexos chegam cifrados e são baixados só por quem tem acesso; ainda assim,
// tipos executáveis ficam de fora para não circular malware entre as pessoas
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|cpl|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|lnk|dll|sys|sh|html?|svg|xhtml)$/i;
export function fileNameProblem(name) {
  if (!isStr(name) || !name.trim() || name.length > 255) return 'Nome de arquivo inválido';
  // eslint-disable-next-line no-control-regex
  if (/[/\\\x00-\x1f]/.test(name) || name.includes('..')) return 'Nome de arquivo inválido';
  return BLOCKED_EXT.test(name.trim()) ? 'Tipo de arquivo não permitido' : null;
}
