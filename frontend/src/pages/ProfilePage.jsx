import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { User, Lock, Shield, Eye, EyeOff, Check, X, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuthStore } from '../stores/authStore';

const ROLE_LABELS = {
  AUXILIAR: 'Auxiliar', ASSISTENTE: 'Assistente', ANALISTA: 'Analista',
  COORDENACAO: 'Coordenação', DIRETORIA: 'Diretoria', ADMINISTRADOR: 'Administrador',
};

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuthStore();

  const [profileForm, setProfileForm] = useState({ name: user?.name || '', email: user?.email || '' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false });
  const [twoFaStep, setTwoFaStep] = useState(null); // null | 'setup' | 'disable'
  const [twoFaData, setTwoFaData] = useState(null);
  const [twoFaCode, setTwoFaCode] = useState('');

  const updateProfile = useMutation({
    mutationFn: (data) => api.put(`/users/${user.id}`, data),
    onSuccess: (res) => { setUser(res.data); toast.success('Perfil atualizado!'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const changePw = useMutation({
    mutationFn: (data) => api.post('/auth/change-password', data),
    onSuccess: () => { toast.success('Senha alterada!'); setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const setup2fa = useMutation({
    mutationFn: () => api.post('/auth/2fa/setup'),
    onSuccess: (res) => { setTwoFaData(res.data); setTwoFaStep('setup'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const verify2fa = useMutation({
    mutationFn: (code) => api.post('/auth/2fa/verify', { token: code }),
    onSuccess: () => {
      toast.success('2FA ativado com sucesso!');
      setUser({ ...user, twoFactorEnabled: true });
      setTwoFaStep(null); setTwoFaData(null); setTwoFaCode('');
    },
    onError: () => toast.error('Código inválido'),
  });

  const disable2fa = useMutation({
    mutationFn: (code) => api.post('/auth/2fa/disable', { token: code }),
    onSuccess: () => {
      toast.success('2FA desativado!');
      setUser({ ...user, twoFactorEnabled: false });
      setTwoFaStep(null); setTwoFaCode('');
    },
    onError: () => toast.error('Código inválido'),
  });

  const pwStrength = (pw) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^a-zA-Z0-9]/.test(pw)) s++;
    return s;
  };

  const strength = pwStrength(pwForm.newPassword);
  const strengthColors = ['', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];
  const strengthLabels = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];

  const PwInput = ({ field, label, show, onToggle }) => (
    <div>
      <label className="text-sm text-slate-400 mb-1.5 block">{label}</label>
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={pwForm[field]}
          onChange={e => setPwForm({ ...pwForm, [field]: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-10 text-white text-sm focus:outline-none focus:border-indigo-500" />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <User size={24} className="text-indigo-400" /> Meu Perfil
      </h1>

      {/* Info básica */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Informações Pessoais</h2>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-white">{user?.name}</p>
            <p className="text-sm text-slate-400">{user?.email}</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 mt-1 inline-block">
              {ROLE_LABELS[user?.role] || user?.role}
            </span>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Nome</label>
            <input value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">E-mail</label>
            <input value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <button onClick={() => updateProfile.mutate(profileForm)} disabled={updateProfile.isPending}
          className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
          {updateProfile.isPending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* Trocar senha */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Lock size={14} /> Trocar Senha
        </h2>
        <div className="space-y-3">
          <PwInput field="currentPassword" label="Senha Atual" show={showPw.current} onToggle={() => setShowPw({ ...showPw, current: !showPw.current })} />
          <PwInput field="newPassword" label="Nova Senha" show={showPw.new} onToggle={() => setShowPw({ ...showPw, new: !showPw.new })} />
          {pwForm.newPassword && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1,2,3,4].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strengthColors[strength] : 'bg-white/10'}`} />
                ))}
              </div>
              <p className="text-xs text-slate-500">{strengthLabels[strength]}</p>
            </div>
          )}
          <PwInput field="confirmPassword" label="Confirmar Nova Senha" show={showPw.confirm} onToggle={() => setShowPw({ ...showPw, confirm: !showPw.confirm })} />
          {pwForm.confirmPassword && pwForm.newPassword !== pwForm.confirmPassword && (
            <p className="text-xs text-red-400 flex items-center gap-1"><X size={12} /> Senhas não coincidem</p>
          )}
        </div>
        <button onClick={() => changePw.mutate(pwForm)}
          disabled={!pwForm.currentPassword || !pwForm.newPassword || pwForm.newPassword !== pwForm.confirmPassword || changePw.isPending}
          className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
          {changePw.isPending ? 'Alterando...' : 'Alterar Senha'}
        </button>
      </div>

      {/* 2FA */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Shield size={14} /> Autenticação em Dois Fatores (2FA)
        </h2>
        {user?.twoFactorEnabled ? (
          <div>
            <div className="flex items-center gap-2 text-green-400 mb-3">
              <Check size={16} /> <span className="text-sm">2FA está ativado na sua conta</span>
            </div>
            {twoFaStep === 'disable' ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">Digite o código do seu app autenticador para desativar:</p>
                <input value={twoFaCode} onChange={e => setTwoFaCode(e.target.value)} maxLength={6}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center font-mono tracking-widest focus:outline-none focus:border-red-500"
                  placeholder="000000" />
                <div className="flex gap-2">
                  <button onClick={() => { setTwoFaStep(null); setTwoFaCode(''); }} className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-sm">Cancelar</button>
                  <button onClick={() => disable2fa.mutate(twoFaCode)} disabled={twoFaCode.length !== 6}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-50">Desativar 2FA</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setTwoFaStep('disable')} className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded-lg text-sm transition-colors">
                Desativar 2FA
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-400 mb-4">Proteja sua conta com um app autenticador (Google Authenticator, Authy, etc.)</p>
            {twoFaStep === 'setup' && twoFaData ? (
              <div className="space-y-4">
                <div className="flex gap-4 items-start">
                  <div className="bg-white p-2 rounded-lg">
                    <img src={twoFaData.qrCode} alt="QR Code 2FA" className="w-32 h-32" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-400 mb-2">1. Escaneie o QR code com seu app</p>
                    <p className="text-sm text-slate-400 mb-2">2. Ou insira a chave manualmente:</p>
                    <code className="text-xs bg-black/30 px-2 py-1 rounded font-mono text-indigo-300 break-all block">{twoFaData.secret}</code>
                    <p className="text-sm text-slate-400 mt-3 mb-2">3. Digite o código gerado:</p>
                    <input value={twoFaCode} onChange={e => setTwoFaCode(e.target.value)} maxLength={6}
                      className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center font-mono tracking-widest focus:outline-none focus:border-indigo-500"
                      placeholder="000000" />
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => { setTwoFaStep(null); setTwoFaData(null); setTwoFaCode(''); }}
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-sm">Cancelar</button>
                      <button onClick={() => verify2fa.mutate(twoFaCode)} disabled={twoFaCode.length !== 6}
                        className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm disabled:opacity-50 flex items-center gap-1">
                        <Check size={12} /> Verificar e Ativar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={() => setup2fa.mutate()}
                className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-400 rounded-lg text-sm transition-colors">
                <Smartphone size={14} /> Configurar 2FA
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
