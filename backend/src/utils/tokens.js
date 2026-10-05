import { createHash } from 'crypto';

export const SESSION_COOKIE = 'vg_session';

export function hashToken(raw) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(req, res, token, maxAgeMs) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/api',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/api' });
}
