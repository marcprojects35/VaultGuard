/**
 * URL de credencial para usar em href. Só http(s); sem esquema vira https://.
 * Qualquer outro esquema (javascript:, data:, file:...) é descartado.
 */
export function safeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;
  return `https://${raw}`;
}
