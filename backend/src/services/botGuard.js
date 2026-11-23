// Proteção contra robôs no login, sem serviço externo (nada sai da rede da empresa):
//  - campo-armadilha invisível: só robô preenche;
//  - atraso progressivo a cada erro vindo do mesmo IP;
//  - depois de 5 erros em 10 minutos, o navegador precisa resolver um desafio de
//    prova de trabalho (cerca de 1 segundo), o que encarece ataques em massa.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { dataKey } from './secretBox.js';

const WINDOW_MS = 10 * 60 * 1000;
const THRESHOLD = 5;
const DIFFICULTY = 16; // bits zerados no início do SHA-256
const CHALLENGE_MS = 2 * 60 * 1000;
const failures = new Map(); // ip -> { count, first }
const used = new Map();     // desafio já usado -> expira em

const sign = (text) => createHmac('sha256', dataKey()).update(`bot-guard|${text}`).digest('hex');

function issue() {
  const body = `${randomBytes(16).toString('hex')}.${Date.now() + CHALLENGE_MS}`;
  return `${body}.${sign(body)}`;
}

function solved(challenge, solution) {
  const [nonce, exp, mac] = String(challenge || '').split('.');
  if (!nonce || !exp || !mac || mac.length !== 64) return false;
  const expected = Buffer.from(sign(`${nonce}.${exp}`));
  if (!timingSafeEqual(expected, Buffer.from(mac)) || Date.now() > Number(exp) || used.has(challenge)) return false;
  const hash = createHash('sha256').update(`${challenge}:${solution}`).digest();
  const zero = hash[0] === 0 && hash[1] === 0;
  if (zero) used.set(challenge, Number(exp));
  return zero;
}

function failureCount(ip) {
  const f = failures.get(ip);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(ip); return 0; }
  return f.count;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  for (const [ip, f] of failures) if (now - f.first > WINDOW_MS) failures.delete(ip);
}, 60 * 1000).unref();

export async function loginBotGuard(req, res, next) {
  const ip = req.ip;
  const count = failureCount(ip);
  await new Promise(r => setTimeout(r, Math.min(count * 200, 2000)));
  // Armadilha: responde como senha errada, sem dar pista ao robô
  if (req.body?.website) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  if (count >= THRESHOLD && !solved(req.body?.botChallenge, req.body?.botSolution)) {
    return res.status(428).json({ error: 'Confirme que você não é um robô', code: 'BOT_CHECK', challenge: issue(), difficulty: DIFFICULTY });
  }
  res.on('finish', () => {
    if (res.statusCode === 401) {
      const f = failures.get(ip);
      if (f && Date.now() - f.first <= WINDOW_MS) f.count++;
      else failures.set(ip, { count: 1, first: Date.now() });
    } else if (res.statusCode === 200) {
      failures.delete(ip);
    }
  });
  next();
}
