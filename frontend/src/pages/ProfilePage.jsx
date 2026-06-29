import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  User, Lock, Shield, Eye, EyeOff, Check, X, Smartphone, Key,
  Activity, Camera, Plus, Trash2, RefreshCw, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuthStore } from '../stores/authStore';

const ROLE_LABELS = {
  AUXILIAR: 'Auxiliar', ASSISTENTE: 'Assistente', ANALISTA: 'Analista',
  COORDENACAO: 'Coordenação', DIRETORIA: 'Diretoria', ADMINISTRADOR: 'Administrador',
};

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuthStore();
  const qc = useQueryClient();
  const avatarInputRef = useRef(null);

  const fullName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') || '?';

  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
  });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false });
  const [twoFaStep, setTwoFaStep] = useState(null);
  const [twoFaData, setTwoFaData] = useState(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [activeTab, setActiveTab] = useState('info');

  // New token form
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState('');
  const [showCreateToken, setShowCreateToken] = useState(false);
  const [createdToken, setCreatedToken] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [deleteTokenTarget, setDeleteTokenTarget] = useState(null);

  const { data: tokens = [], isLoading: tokensLoading } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get('/tokens').then(r => r.data),
    enabled: activeTab === 'tokens',
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['my-audit'],
    queryFn: () => api.get('/audit', { params: { limit: 20, userId: user?.id } }).then(r => r.data.logs || []),
    enabled: activeTab === 'timeline',
  });

  const updateProfile = useMutation({
    mutationFn: (data) => api.put(`/users/${user.id}`, data),
    onSuccess: (res) => { updateUser(res.data); toast.success('Perfil atualizado!'); },
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
      updateUser({ totpEnabled: true });
      setTwoFaStep(null); setTwoFaData(null); setTwoFaCode('');
    },
    onError: () => toast.error('Código inválido. Verifique se o horário do dispositivo está correto.'),
  });

  const disable2fa = useMutation({
    mutationFn: (code) => api.post('/auth/2fa/disable', { token: code }),
    onSuccess: () => {
      toast.success('2FA desativado!');
      updateUser({ totpEnabled: false });
      setTwoFaStep(null); setTwoFaCode('');
    },
    onError: () => toast.error('Código inválido'),
  });

  const createToken = useMutation({
    mutationFn: () => api.post('/tokens', {
      name: newTokenName,
      expiresAt: newTokenExpiry || null,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      setCreatedToken(res.data);
      setNewTokenName('');
      setNewTokenExpiry('');
      setShowCreateToken(false);
      toast.success('Token criado! Copie agora — não será exibido novamente.');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao criar token'),
  });

  const revokeToken = useMutation({
    mutationFn: (id) => api.delete(`/tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      toast.success('Token revogado!');
      setDeleteTokenTarget(null);
    },
    onError: () => toast.error('Erro ao revogar token'),
  });

  const handleAvatarSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Foto muito grande. Máx 2MB.'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result;
      updateProfile.mutate({ ...profileForm, avatar: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const copyToken = async (value, id) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { toast.error('Erro ao copiar'); }
  };

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
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-10 text-white text-sm focus:outline-none focus:border-[#C78C00]" />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );

  const TABS = [
    { id: 'info', label: 'Informações' },
    { id: 'security', label: 'Segurança' },
    { id: 'tokens', label: 'Token de API' },
    { id: 'timeline', label: 'Histórico' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <User size={24} className="text-[#C78C00]" /> Meu Perfil
      </h1>

      {/* Header card */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex items-center gap-4">
        <div className="relative flex-shrink-0">
          {user?.avatar ? (
            <img src={user.avatar} alt="avatar"
              className="w-16 h-16 rounded-full object-cover ring-2 ring-[#C78C00]/40" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#AD7B04] to-[#C78C00] flex items-center justify-center text-2xl font-bold text-white">
              {initials}
            </div>
          )}
          <button
            onClick={() => avatarInputRef.current?.click()}
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#C78C00] flex items-center justify-center hover:bg-[#FFB400] transition-colors"
            title="Alterar foto">
            <Camera size={11} className="text-white" />
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
        </div>
        <div>
          <p className="font-semibold text-white text-lg">{fullName || user?.username}</p>
          <p className="text-sm text-slate-400">{user?.email}</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#C78C00]/20 text-[#E7A300] mt-1 inline-block">
            {ROLE_LABELS[user?.role] || user?.role}
          </span>
        </div>
        <div className="ml-auto grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-xs text-slate-500">Último acesso</div>
            <div className="text-sm text-slate-300">{user?.lastLogin ? new Date(user.lastLogin).toLocaleDateString('pt-BR') : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">2FA</div>
            <div className={`text-sm font-medium ${user?.totpEnabled ? 'text-green-400' : 'text-slate-500'}`}>
              {user?.totpEnabled ? 'Ativo' : 'Inativo'}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10 pb-0">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === tab.id ? 'text-[#C78C00] border-b-2 border-[#C78C00]' : 'text-slate-500 hover:text-slate-300'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Informações */}
      {activeTab === 'info' && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Informações Pessoais</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Nome</label>
              <input value={profileForm.firstName} onChange={e => setProfileForm({ ...profileForm, firstName: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Sobrenome</label>
              <input value={profileForm.lastName} onChange={e => setProfileForm({ ...profileForm, lastName: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]" />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">E-mail</label>
            <input value={user?.email || ''} disabled
              className="w-full bg-white/3 border border-white/5 rounded-lg px-3 py-2 text-slate-500 text-sm cursor-not-allowed" />
            <p className="text-xs text-slate-600 mt-1">E-mail não pode ser alterado aqui.</p>
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Login</label>
            <input value={user?.username || ''} disabled
              className="w-full bg-white/3 border border-white/5 rounded-lg px-3 py-2 text-slate-500 text-sm cursor-not-allowed" />
          </div>
          <button onClick={() => updateProfile.mutate(profileForm)} disabled={updateProfile.isPending}
            className="mt-2 px-4 py-2 bg-[#C78C00] hover:bg-[#FFB400] text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
            {updateProfile.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}

      {/* Tab: Segurança */}
      {activeTab === 'security' && (
        <div className="space-y-5">
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
              className="mt-4 px-4 py-2 bg-[#C78C00] hover:bg-[#FFB400] text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
              {changePw.isPending ? 'Alterando...' : 'Alterar Senha'}
            </button>
          </div>

          {/* 2FA */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Shield size={14} /> Autenticação em Dois Fatores (2FA)
            </h2>
            {user?.totpEnabled ? (
              <div>
                <div className="flex items-center gap-2 text-green-400 mb-3">
                  <Check size={16} /> <span className="text-sm">2FA está ativado na sua conta</span>
                </div>
                {twoFaStep === 'disable' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-400">Digite o código do seu app autenticador para desativar:</p>
                    <input value={twoFaCode} onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6}
                      className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center font-mono tracking-widest focus:outline-none focus:border-red-500"
                      placeholder="000000" inputMode="numeric" />
                    <div className="flex gap-2">
                      <button onClick={() => { setTwoFaStep(null); setTwoFaCode(''); }} className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-sm">Cancelar</button>
                      <button onClick={() => disable2fa.mutate(twoFaCode)} disabled={twoFaCode.length !== 6 || disable2fa.isPending}
                        className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-50">
                        {disable2fa.isPending ? '...' : 'Desativar 2FA'}
                      </button>
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
                        <code className="text-xs bg-black/30 px-2 py-1 rounded font-mono text-[#E7A300] break-all block">{twoFaData.secret}</code>
                        <p className="text-sm text-slate-400 mt-3 mb-2">3. Digite o código de 6 dígitos gerado:</p>
                        <input value={twoFaCode}
                          onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          maxLength={6}
                          className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center font-mono tracking-widest focus:outline-none focus:border-[#C78C00]"
                          placeholder="000000"
                          inputMode="numeric" />
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => { setTwoFaStep(null); setTwoFaData(null); setTwoFaCode(''); }}
                            className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-sm">Cancelar</button>
                          <button onClick={() => verify2fa.mutate(twoFaCode)}
                            disabled={twoFaCode.length !== 6 || verify2fa.isPending}
                            className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm disabled:opacity-50 flex items-center gap-1">
                            {verify2fa.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                            Verificar e Ativar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setup2fa.mutate()} disabled={setup2fa.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-400 rounded-lg text-sm transition-colors disabled:opacity-50">
                    {setup2fa.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Smartphone size={14} />}
                    Configurar 2FA
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Token de API */}
      {activeTab === 'tokens' && (
        <div className="space-y-4">
          {/* Banner showing newly created token */}
          {createdToken && (
            <div className="rounded-xl p-4 border" style={{ background: '#10b98115', borderColor: '#10b98144' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-green-400">Token criado — copie agora!</span>
                <button onClick={() => setCreatedToken(null)} className="text-slate-500 hover:text-slate-300">
                  <X size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
                <code className="text-xs font-mono text-[#E7A300] flex-1 break-all">{createdToken.token}</code>
                <button onClick={() => copyToken(createdToken.token, 'new')}
                  className="flex-shrink-0" style={{ color: copiedId === 'new' ? '#10b981' : '#9ca3af' }}>
                  {copiedId === 'new' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Este token não será exibido novamente.</p>
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Key size={14} /> Tokens de API
              </h2>
              <button onClick={() => setShowCreateToken(!showCreateToken)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: '#C78C0022', color: '#E7A300', border: '1px solid #C78C0044' }}>
                <Plus size={12} /> Novo Token
              </button>
            </div>

            {/* Create form */}
            {showCreateToken && (
              <div className="mb-4 p-4 rounded-xl" style={{ background: 'rgba(199,140,0,0.06)', border: '1px solid rgba(199,140,0,0.2)' }}>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Nome do token *</label>
                    <input value={newTokenName} onChange={e => setNewTokenName(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]"
                      placeholder="Ex: Script de backup" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Expira em (opcional)</label>
                    <input type="date" value={newTokenExpiry} onChange={e => setNewTokenExpiry(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setShowCreateToken(false); setNewTokenName(''); setNewTokenExpiry(''); }}
                    className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-xs">Cancelar</button>
                  <button onClick={() => createToken.mutate()} disabled={createToken.isPending || !newTokenName.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
                    style={{ background: '#C78C00' }}>
                    {createToken.isPending ? 'Criando...' : 'Criar Token'}
                  </button>
                </div>
              </div>
            )}

            <p className="text-sm text-slate-400 mb-4">Use tokens para integrar scripts e ferramentas externas com a API.</p>

            {tokensLoading ? (
              <div className="flex items-center gap-2 text-slate-500 py-4">
                <RefreshCw size={14} className="animate-spin" /> Carregando...
              </div>
            ) : tokens.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum token criado ainda.</p>
            ) : (
              <div className="space-y-2">
                {tokens.map(tok => (
                  <div key={tok.id} className="flex items-center justify-between bg-white/3 rounded-xl px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-white">{tok.name}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {tok.tokenPrefix || '—'}…
                        {tok.expiresAt && (
                          <span className={`ml-2 ${new Date(tok.expiresAt) < new Date() ? 'text-red-400' : 'text-slate-600'}`}>
                            · exp. {new Date(tok.expiresAt).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {tok.lastUsed ? `Usado: ${new Date(tok.lastUsed).toLocaleDateString('pt-BR')}` : 'Nunca usado'}
                      </span>
                      <button onClick={() => setDeleteTokenTarget(tok)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10" style={{ color: '#ef4444' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Histórico */}
      {activeTab === 'timeline' && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity size={14} /> Histórico de Atividades
          </h2>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma atividade registrada.</p>
          ) : (
            <div className="space-y-2">
              {auditLogs.map(log => (
                <div key={log.id} className="flex items-start gap-3 py-2 border-b border-white/5">
                  <div className="w-2 h-2 rounded-full bg-[#C78C00] mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{log.action}</span>
                      <span className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                    {log.details && (
                      <div className="text-xs text-slate-500 mt-0.5 truncate">{JSON.stringify(log.details)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Revoke token confirm */}
      {deleteTokenTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <h3 className="font-semibold text-white mb-2">Revogar token?</h3>
            <p className="text-sm text-slate-400 mb-5">{deleteTokenTarget.name}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTokenTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid #2a2a2a', color: '#9ca3af' }}>Cancelar</button>
              <button onClick={() => revokeToken.mutate(deleteTokenTarget.id)} disabled={revokeToken.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50">
                {revokeToken.isPending ? '...' : 'Revogar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
