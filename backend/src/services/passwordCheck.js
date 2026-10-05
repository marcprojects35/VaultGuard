import bcrypt from 'bcryptjs';
import { authenticateWithAD } from './ldap.js';

/**
 * Confere a senha atual do usuário (local ou AD) para operações sensíveis,
 * como trocar ou descartar as chaves de criptografia.
 */
export async function verifyUserPassword(user, password) {
  if (!password) return false;
  if (user.authSource === 'ldap') {
    try {
      const ldapUser = await authenticateWithAD(user.username, password);
      return !!ldapUser && !ldapUser.error && ldapUser.id === user.id;
    } catch {
      return false;
    }
  }
  if (!user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}
