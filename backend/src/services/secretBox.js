// Cifra dos segredos que o servidor precisa ler de volta (segredo do 2FA, senha
// da conta de serviço do AD, senha do SMTP, client secret do Microsoft 365).
// AES-256-GCM com a chave DATA_ENCRYPTION_KEY, que fica fora do banco: um backup
// ou vazamento do banco sozinho não revela esses valores.
//
// Rotação: coloque a chave atual em DATA_ENCRYPTION_KEY_OLD, gere outra em
// DATA_ENCRYPTION_KEY e reinicie; tudo é recifrado ao subir.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function parseKey(hex) {
  return /^[0-9a-f]{64}$/i.test(hex || '') ? Buffer.from(hex, 'hex') : null;
}

export function dataKey() {
  const key = parseKey(process.env.DATA_ENCRYPTION_KEY);
  if (!key) throw new Error('DATA_ENCRYPTION_KEY ausente ou inválida. Gere uma com: openssl rand -hex 32');
  return key;
}

export const hasOldKey = () => !!parseKey(process.env.DATA_ENCRYPTION_KEY_OLD);
export const isSealed = (value) => typeof value === 'string' && value.startsWith(PREFIX);

/** Texto cifrado; `context` amarra o valor ao campo (não dá para copiar de um campo para outro) */
export function seal(value, context) {
  if (typeof value !== 'string' || !value || isSealed(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

function openWith(key, value, context) {
  const [iv, tag, data] = value.slice(PREFIX.length).split('.').map(p => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Valor aberto. Texto ainda não cifrado (instalação antiga) passa direto até a migração */
export function open(value, context) {
  if (!isSealed(value)) return value;
  try {
    return openWith(dataKey(), value, context);
  } catch (err) {
    const old = parseKey(process.env.DATA_ENCRYPTION_KEY_OLD);
    if (old) return openWith(old, value, context);
    throw err;
  }
}

/** HMAC-SHA256 com chave derivada (encadeamento da auditoria) */
export function auditMac(text) {
  const key = createHmac('sha256', dataKey()).update('vaultguard-audit-chain-v1').digest();
  return createHmac('sha256', key).update(text).digest('hex');
}
