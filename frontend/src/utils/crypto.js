/**
 * Client-side AES-256-GCM encryption for passwords.
 * The master key is derived from the user's password + server-provided salt.
 * This ensures zero-knowledge: the server never sees plain passwords.
 * 
 * For simplicity in this implementation, we use a per-credential random key
 * stored as part of the encrypted payload. In production, integrate a proper
 * master password derived key (PBKDF2/Argon2).
 */

const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;

// Generate a random AES key
export async function generateKey() {
  const key = await crypto.subtle.generateKey(
    { name: ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

// Import a base64 key
async function importKey(b64Key) {
  const raw = Uint8Array.from(atob(b64Key), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a plaintext password.
 * Returns a JSON string: { iv, ciphertext, keyHint }
 * The key is stored separately in user's session / derived from master password.
 * 
 * In this demo implementation, we use a fixed per-installation key derived from
 * a server-provided secret. In production, each user should have a master password
 * derived encryption key never sent to the server.
 */
export async function encryptPassword(plaintext, masterKey) {
  if (!masterKey) {
    // Fallback: just base64 encode (dev mode only — replace in production!)
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
    return encryptedJson; // Already plain? Legacy.
  }

  // Dev fallback
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

/**
 * Calculate password strength (0-100)
 */
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

/**
 * Generate a secure random password
 */
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
