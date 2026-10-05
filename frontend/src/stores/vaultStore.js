import { create } from 'zustand';
import api from '../utils/api.js';
import { Keyring } from '../utils/keyring.js';

// Chaves só em memória: recarregar a página bloqueia o cofre de novo
const adapter = {
  get: (path) => api.get(path).then(r => r.data),
  post: (path, body) => api.post(path, body).then(r => r.data),
  put: (path, body) => api.put(path, body).then(r => r.data),
};
for (const method of Object.keys(adapter)) {
  const call = adapter[method];
  adapter[method] = (...args) => call(...args).catch(e => {
    e.status = e.response?.status;
    throw e;
  });
}

export const keyring = new Keyring(adapter);

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
let syncTimer = null;

export const useVaultStore = create((set, get) => ({
  unlocked: false,
  // Falha de desbloqueio no login, para a tela de desbloqueio continuar dali
  pending: null, // { password, code }

  unlock: async (password) => {
    try {
      await keyring.unlock(password);
      set({ unlocked: true, pending: null });
      get().startMaintenance();
      return { ok: true };
    } catch (e) {
      if (e.code) {
        set({ pending: { password, code: e.code } });
        return { ok: false, code: e.code, message: e.message };
      }
      throw e;
    }
  },

  recover: async (oldPassword, currentPassword) => {
    await keyring.recoverWithOldPassword(oldPassword, currentPassword);
    set({ unlocked: true, pending: null });
    get().startMaintenance();
  },

  reset: async (password) => {
    await keyring.resetKeys(password);
    set({ unlocked: true, pending: null });
    get().startMaintenance();
  },

  lock: () => {
    keyring.lock();
    clearInterval(syncTimer);
    syncTimer = null;
    set({ unlocked: false, pending: null });
  },

  // Distribui chaves e migra credenciais legadas em segundo plano
  startMaintenance: () => {
    const run = async () => {
      try {
        await keyring.sync();
        const creds = await adapter.get('/credentials');
        await keyring.migrateLegacy(creds);
      } catch { /* tenta de novo no próximo ciclo */ }
    };
    clearInterval(syncTimer);
    run();
    syncTimer = setInterval(run, SYNC_INTERVAL_MS);
  },
}));

/** Mensagem amigável para erros de chave. */
export function keyErrorMessage(e, fallback = 'Erro ao descriptografar') {
  if (e?.code === 'NO_FOLDER_KEY') return e.message;
  if (e?.code === 'LOCKED') return 'Cofre bloqueado: desbloqueie para continuar';
  if (e?.code === 'LEGACY') return 'Credencial antiga ainda não migrada: peça a quem a criou para abrir o cofre';
  if (e?.message === 'locked') return 'Cofre bloqueado: desbloqueie para continuar';
  return e?.response?.data?.error || fallback;
}
