/**
 * Client-side AES-256-GCM encryption.
 * Master key is derived from the user's login password + server-provided salt via PBKDF2.
 * Zero-knowledge: the server never sees plain passwords.
 */

const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;

// ─── Key utilities ──────────────────────────────────────────────────────────

export async function generateKey() {
  const key = await crypto.subtle.generateKey(
    { name: ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importKey(b64Key) {
  const raw = Uint8Array.from(atob(b64Key), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['encrypt', 'decrypt']);
}

/**
 * Derive an AES-256-GCM key from user password + hex salt using PBKDF2.
 * Returns a base64-encoded raw key.
 */
export async function deriveKeyFromPassword(password, hexSalt) {
  const enc = new TextEncoder();
  const saltBytes = Uint8Array.from(
    hexSalt.match(/.{1,2}/g).map(b => parseInt(b, 16))
  );

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derived = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 210000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  const raw = await crypto.subtle.exportKey('raw', derived);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

// ─── Credential encrypt/decrypt ─────────────────────────────────────────────

/**
 * Encrypt a plaintext password.
 * v:0 = dev fallback (base64, no key needed)
 * v:1 = AES-256-GCM with derived master key
 */
export async function encryptPassword(plaintext, masterKey) {
  if (!masterKey) {
    return JSON.stringify({ plain: btoa(unescape(encodeURIComponent(plaintext))), v: 0 });
  }

  const key = await importKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);

  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    v: 1,
  });
}

export async function decryptPassword(encryptedJson, masterKey) {
  if (!encryptedJson) return '';

  let parsed;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch {
    return encryptedJson;
  }

  if (parsed.v === 0) {
    return decodeURIComponent(escape(atob(parsed.plain)));
  }

  if (!masterKey) return '••••••••••';

  const key = await importKey(masterKey);
  const iv = Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(parsed.ciphertext), c => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ─── Vault (offline backup) encrypt/decrypt ─────────────────────────────────

/**
 * Encrypt an entire vault export with a user-chosen passphrase.
 * Used for offline backup (.vaultguard files).
 */
export async function encryptVault(data, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    enc.encode(JSON.stringify(data))
  );

  return JSON.stringify({
    v: 1,
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  });
}

export async function decryptVault(encryptedJson, passphrase) {
  const enc = new TextEncoder();
  let parsed;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch {
    throw new Error('Arquivo inválido');
  }

  if (parsed.v !== 1) throw new Error('Formato de arquivo não suportado');

  const salt = Uint8Array.from(atob(parsed.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(parsed.ciphertext), c => c.charCodeAt(0));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['decrypt']
  );

  try {
    const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw new Error('Senha incorreta ou arquivo corrompido');
  }
}

// ─── Password strength ───────────────────────────────────────────────────────

export function calculateStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 20;
  if (password.length >= 12) score += 20;
  if (password.length >= 16) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/[a-z]/.test(password)) score += 10;
  if (/[0-9]/.test(password)) score += 10;
  if (/[^A-Za-z0-9]/.test(password)) score += 20;
  return Math.min(100, score);
}

export function getStrengthLabel(strength) {
  if (strength < 30) return 'weak';
  if (strength < 50) return 'fair';
  if (strength < 75) return 'good';
  return 'strong';
}

export function getStrengthColor(strength) {
  if (strength < 30) return '#ef4444';
  if (strength < 50) return '#f59e0b';
  if (strength < 75) return '#3b82f6';
  return '#10b981';
}

// ─── Password generator ──────────────────────────────────────────────────────

export function generatePassword(options = {}) {
  const {
    length = 20,
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
  } = options;

  let charset = '';
  if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (numbers) charset += '0123456789';
  if (symbols) charset += '!@#$%^&*()-_=+[]{}|;:,.<>?';

  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';

  let password = '';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  return password;
}
