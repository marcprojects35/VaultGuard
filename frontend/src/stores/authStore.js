import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../utils/api.js';
import { useVaultStore } from './vaultStore.js';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      // O JWT fica em cookie httpOnly definido pelo backend; aqui só o perfil
      setAuth: (user) => set({ user, isAuthenticated: true }),

      logout: () => {
        if (get().isAuthenticated) {
          api.post('/auth/logout').catch(() => {});
        }
        useVaultStore.getState().lock();
        set({ user: null, isAuthenticated: false });
      },

      updateUser: (updates) => set(state => ({
        user: state.user ? { ...state.user, ...updates } : null
      })),
    }),
    {
      name: 'vaultguard-auth',
      version: 1,
      // v0 guardava o JWT no localStorage: descarta e força novo login (cookie)
      migrate: () => ({ user: null, isAuthenticated: false }),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
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
