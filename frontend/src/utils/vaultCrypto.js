/**
 * Primitivas criptográficas do cofre (WebCrypto puro, sem estado).
 * Compartilhado entre o frontend e a extensão.
 *
 * Hierarquia de chaves:
 *   senha + salt --PBKDF2--> KEK (AES-256-GCM)  cifra a chave privada RSA do usuário
 *   par RSA-OAEP 3072 do usuário                 recebe as chaves das pastas
 *   chave AES da pasta                           cifra as chaves das credenciais
 *   chave AES da credencial                      cifra senha, campos secretos, histórico e anexos
 *
 * Formatos (todos JSON):
 *   v:0  legado: base64 sem criptografia
 *   v:1  legado: AES-GCM direto com a KEK de quem criou
 *   v:2  AES-GCM com a chave da credencial (ou da pasta, para embrulhar chaves)
 */

const AES = 'AES-GCM';
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
const PBKDF2_ITERATIONS = 210000;

// ─── base64 ──────────────────────────────────────────────────────────────────

export function bytesToB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

// ─── KEK (derivada da senha) ─────────────────────────────────────────────────

export async function deriveKek(password, hexSalt, extractable = false) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: hexToBytes(hexSalt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: AES, length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

export async function exportAesKey(key) {
  return bytesToB64(await crypto.subtle.exportKey('raw', key));
}

export async function importAesKey(raw, extractable = false) {
  const bytes = typeof raw === 'string' ? b64ToBytes(raw) : raw;
  return crypto.subtle.importKey('raw', bytes, { name: AES }, extractable, ['encrypt', 'decrypt']);
}

// ─── AES-GCM ─────────────────────────────────────────────────────────────────

export function randomKeyBytes() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function aesEncryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: AES, iv }, key, bytes);
  return JSON.stringify({ v: 2, iv: bytesToB64(iv), ct: bytesToB64(ct) });
}

export async function aesDecryptBytes(key, json) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  if (p.v !== 2) throw new Error('unsupported_format');
  const pt = await crypto.subtle.decrypt({ name: AES, iv: b64ToBytes(p.iv) }, key, b64ToBytes(p.ct));
  return new Uint8Array(pt);
}

export async function aesEncryptString(key, text) {
  return aesEncryptBytes(key, new TextEncoder().encode(text ?? ''));
}

export async function aesDecryptString(key, json) {
  return new TextDecoder().decode(await aesDecryptBytes(key, json));
}

export function formatVersion(json) {
  if (!json) return null;
  try { return JSON.parse(json).v ?? null; } catch { return null; }
}

export const isV2 = (json) => formatVersion(json) === 2;

// ─── Formatos legados (v0 / v1) ──────────────────────────────────────────────

/** Abre um valor legado. Lança erro se for v1 de outra pessoa (KEK diferente). */
export async function legacyDecrypt(json, kek) {
  if (!json) return '';
  let p;
  try { p = JSON.parse(json); } catch { return json; }
  if (p.v === 0) return decodeURIComponent(escape(atob(p.plain)));
  if (p.v === 1) {
    if (!kek) throw new Error('locked');
    const pt = await crypto.subtle.decrypt(
      { name: AES, iv: b64ToBytes(p.iv) }, kek, b64ToBytes(p.ciphertext)
    );
    return new TextDecoder().decode(pt);
  }
  throw new Error('unsupported_format');
}

// ─── RSA-OAEP ────────────────────────────────────────────────────────────────

export async function generateUserKeyPair() {
  return crypto.subtle.generateKey(
    { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportPublicKey(key) {
  return bytesToB64(await crypto.subtle.exportKey('spki', key));
}

export async function importPublicKey(b64) {
  return crypto.subtle.importKey('spki', b64ToBytes(b64), RSA, false, ['encrypt']);
}

export async function exportPrivateKey(key) {
  return bytesToB64(await crypto.subtle.exportKey('pkcs8', key));
}

export async function importPrivateKey(b64, extractable = false) {
  return crypto.subtle.importKey('pkcs8', b64ToBytes(b64), RSA, extractable, ['decrypt']);
}

/** Cifra a chave privada com a KEK (para guardar no servidor). */
export async function sealPrivateKey(privateKey, kek) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return aesEncryptBytes(kek, new Uint8Array(pkcs8));
}

export async function openPrivateKey(sealed, kek, extractable = false) {
  const pkcs8 = await aesDecryptBytes(kek, sealed);
  return crypto.subtle.importKey('pkcs8', pkcs8, RSA, extractable, ['decrypt']);
}

export async function rsaWrap(publicKey, bytes) {
  const pub = typeof publicKey === 'string' ? await importPublicKey(publicKey) : publicKey;
  return bytesToB64(await crypto.subtle.encrypt(RSA, pub, bytes));
}

export async function rsaUnwrap(privateKey, b64) {
  return new Uint8Array(await crypto.subtle.decrypt(RSA, privateKey, b64ToBytes(b64)));
}

/** RSA + AES para conteúdos maiores que o limite do OAEP (ex.: chave privada da organização). */
export async function hybridSeal(publicKey, bytes) {
  const keyBytes = randomKeyBytes();
  const data = await aesEncryptBytes(await importAesKey(keyBytes), bytes);
  return JSON.stringify({ v: 2, k: await rsaWrap(publicKey, keyBytes), d: data });
}

export async function hybridOpen(privateKey, json) {
  const p = JSON.parse(json);
  const key = await importAesKey(await rsaUnwrap(privateKey, p.k));
  return aesDecryptBytes(key, p.d);
}
