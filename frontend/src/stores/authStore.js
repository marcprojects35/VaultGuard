import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../utils/api.js';
import { deriveKeyFromPassword } from '../utils/crypto.js';

// masterKey is kept ONLY in memory (never persisted) for security
let _masterKey = null;

export function getMasterKey() {
  return _masterKey;
}

export async function deriveMasterKey(password, encryptionSalt) {
  if (!password || !encryptionSalt) return null;
  try {
    _masterKey = await deriveKeyFromPassword(password, encryptionSalt);
    return _masterKey;
  } catch {
    return null;
  }
}

export function clearMasterKey() {
  _masterKey = null;
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      setAuth: (user, token) => set({ user, token, isAuthenticated: true }),

      logout: () => {
        if (get().token) {
          api.post('/auth/logout').catch(() => {});
        }
        clearMasterKey();
        set({ user: null, token: null, isAuthenticated: false });
      },

      updateUser: (updates) => set(state => ({
        user: state.user ? { ...state.user, ...updates } : null
      })),
    }),
    {
      name: 'vaultguard-auth',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

export const useIsAdmin = () => {
  const user = useAuthStore(s => s.user);
  return user?.role === 'ADMINISTRADOR';
};

export const useCanAccess = (minRole) => {
  const user = useAuthStore(s => s.user);
  const hierarchy = { AUXILIAR: 0, ASSISTENTE: 1, ANALISTA: 2, COORDENACAO: 3, DIRETORIA: 4, ADMINISTRADOR: 5 };
  return (hierarchy[user?.role] ?? -1) >= (hierarchy[minRole] ?? 99);
};
