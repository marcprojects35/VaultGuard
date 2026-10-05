/**
 * Backup offline do cofre (.vaultguard), força e gerador de senhas.
 * A criptografia das credenciais fica em vaultCrypto.js / keyring.js.
 */

import { bytesToB64 } from './vaultCrypto.js';

const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;

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
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
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
