import { useEffect, useState } from 'react';
import { Lock, KeyRound, AlertTriangle, LogOut } from 'lucide-react';
import api from '../utils/api.js';
import { useVaultStore } from '../stores/vaultStore.js';
import { useAuthStore } from '../stores/authStore.js';

const GOLD = '#C78C00';
const inputStyle = { background: '#1A1A1A', border: '1px solid #2A2A2A', color: 'var(--color-text)' };

/**
 * Bloqueio do cofre. As chaves vivem só em memória, então a cada carregamento
 * da página o usuário digita a senha de novo para abrir a chave privada.
 */
export default function UnlockVault({ onLogout }) {
  const { unlock, recover, reset, pending } = useVaultStore();
  const user = useAuthStore(s => s.user);

  // password | changed | reset
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleFailure = async (pwd, code, message) => {
    if (code !== 'KEY_DECRYPT_FAILED') { setError(message || 'Não foi possível desbloquear'); return; }
    // A senha abre a conta mas não a chave: ela mudou desde que a chave foi cifrada
    try {
      await api.post('/auth/verify-password', { password: pwd });
      setPassword(pwd);
      setStep('changed');
      setError('');
    } catch {
      setError('Senha incorreta');
    }
  };

  // Login já tentou desbloquear e falhou: continua do ponto em que parou
  useEffect(() => {
    if (pending?.password) handleFailure(pending.password, pending.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erro');
    } finally { setBusy(false); }
  };

  const submitPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await unlock(password);
      if (!r.ok) await handleFailure(password, r.code, r.message);
    });
  };

  const submitOld = (e) => {
    e.preventDefault();
    run(() => recover(oldPassword, password));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn" style={{ background: '#111111', border: '1px solid #252525' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${GOLD}22` }}>
            {step === 'password' ? <Lock className="w-5 h-5" style={{ color: GOLD }} /> : <KeyRound className="w-5 h-5" style={{ color: GOLD }} />}
          </div>
          <div>
            <h2 className="font-bold" style={{ color: 'var(--color-text)' }}>
              {step === 'password' ? 'Cofre bloqueado' : step === 'changed' ? 'Sua senha mudou' : 'Gerar chaves novas'}
            </h2>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{user?.email}</p>
          </div>
        </div>

        {step === 'password' && (
          <form onSubmit={submitPassword} className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Digite sua senha para abrir as chaves de criptografia. Elas ficam só nesta aba e são descartadas ao recarregar a página.
            </p>
            <input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Senha" />
            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            <button type="submit" disabled={busy || !password}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #AD7B04)` }}>
              {busy ? 'Abrindo...' : 'Desbloquear'}
            </button>
          </form>
        )}

        {step === 'changed' && (
          <form onSubmit={submitOld} className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Suas chaves foram protegidas com a senha anterior (por exemplo, depois de uma troca de senha no Active Directory).
              Digite a senha anterior uma vez para transferi-las para a senha atual.
            </p>
            <input type="password" autoFocus value={oldPassword} onChange={e => setOldPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Senha anterior" />
            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            <button type="submit" disabled={busy || !oldPassword}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #AD7B04)` }}>
              {busy ? 'Transferindo...' : 'Transferir chaves'}
            </button>
            <button type="button" onClick={() => { setStep('reset'); setError(''); }}
              className="w-full py-2 text-xs hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Não lembro a senha anterior
            </button>
          </form>
        )}

        {step === 'reset' && (
          <div className="space-y-3">
            <div className="flex gap-2 p-3 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Sem a senha anterior suas chaves não podem ser abertas. Gerar chaves novas faz você
                <b> perder o conteúdo da sua pasta pessoal</b>. As pastas compartilhadas voltam a ser
                liberadas automaticamente quando um membro ou administrador estiver online.
              </span>
            </div>
            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            <button onClick={() => run(() => reset(password))} disabled={busy}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#dc2626' }}>
              {busy ? 'Gerando...' : 'Gerar chaves novas'}
            </button>
            <button onClick={() => { setStep('changed'); setError(''); }}
              className="w-full py-2 text-xs hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Voltar
            </button>
          </div>
        )}

        <button onClick={onLogout} className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-xs hover:underline"
          style={{ color: 'var(--color-text-muted)' }}>
          <LogOut className="w-3.5 h-3.5" /> Sair
        </button>
      </div>
    </div>
  );
}
