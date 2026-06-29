import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, RefreshCw, Shield, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

export default function ApiTokensPage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const settings = useSettingsStore(s => s.settings);
  const isAdmin = user?.role === 'ADMINISTRADOR';

  const [activeTab, setActiveTab] = useState('personal');
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [form, setForm] = useState({ name: '', expiresInDays: '' });
  const [copied, setCopied] = useState(false);

  /* ── Meus tokens (usuário atual) ── */
  const { data: myTokens = [], isLoading: myLoading } = useQuery({
    queryKey: ['api-tokens-personal'],
    queryFn: () => api.get('/tokens').then(r => r.data),
  });

  /* ── Todos os tokens (admin) ── */
  const { data: allTokens = [], isLoading: allLoading } = useQuery({
    queryKey: ['api-tokens-all'],
    queryFn: () => api.get('/tokens/all').then(r => r.data),
    enabled: isAdmin && activeTab === 'system',
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/tokens', {
      name: data.name,
      expiresAt: data.expiresInDays
        ? new Date(Date.now() + Number(data.expiresInDays) * 86400000).toISOString()
        : undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['api-tokens-personal'] });
      qc.invalidateQueries({ queryKey: ['api-tokens-all'] });
      setNewToken(res.data.token);
      setShowCreate(false);
      setForm({ name: '', expiresInDays: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao criar token'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id) => api.delete(`/tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens-personal'] });
      qc.invalidateQueries({ queryKey: ['api-tokens-all'] });
      toast.success('Token revogado!');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const copyToken = (token) => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Token copiado!');
  };

  const inputStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const tokens = activeTab === 'system' ? allTokens : myTokens;
  const isLoading = activeTab === 'system' ? allLoading : myLoading;

  const TABS = [
    { id: 'personal', label: 'Meus Tokens', icon: User },
    ...(isAdmin ? [{ id: 'system', label: 'Tokens do Sistema', icon: Shield }] : []),
  ];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Key className="w-6 h-6" style={{ color: settings.primaryColor }} />
            Tokens de API
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Gerencie tokens para a extensão Chrome e integrações externas
          </p>
        </div>
        {activeTab === 'personal' && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            <Plus className="w-4 h-4" /> Novo Token
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2"
              style={{
                color: activeTab === tab.id ? settings.primaryColor : 'var(--color-text-muted)',
                borderBottomColor: activeTab === tab.id ? settings.primaryColor : 'transparent',
              }}>
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Banner token recém-criado */}
      {newToken && (
        <div className="rounded-xl p-4" style={{ background: '#10b98115', border: '1px solid #10b98144' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-1" style={{ color: '#10b981' }}>
                Token criado — copie agora!
              </p>
              <p className="text-xs mb-3" style={{ color: '#10b98180' }}>
                Este token só é exibido uma vez. Guarde em local seguro.
              </p>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs break-all"
                style={{ background: 'rgba(0,0,0,0.3)', color: '#10b981' }}>
                <span className="flex-1">{newToken}</span>
                <button onClick={() => copyToken(newToken)}
                  className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => setNewToken(null)}
            className="mt-3 text-xs hover:underline" style={{ color: '#10b98180' }}>
            Dispensar
          </button>
        </div>
      )}

      {/* Tabela de tokens */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        {isLoading ? (
          <div className="py-8 text-center flex items-center justify-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
            <RefreshCw className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : tokens.length === 0 ? (
          <div className="py-12 text-center">
            <Key className="w-8 h-8 mx-auto mb-3 opacity-30" style={{ color: 'var(--color-text-muted)' }} />
            <p style={{ color: 'var(--color-text-muted)' }}>Nenhum token criado ainda.</p>
            {activeTab === 'personal' && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Crie um token para usar na extensão Chrome
              </p>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['Nome', ...(activeTab === 'system' ? ['Usuário'] : []), 'Prefixo', 'Criado em', 'Expira em', 'Último uso', 'Ações'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t.name}</td>
                  {activeTab === 'system' && (
                    <td className="py-3 px-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {t.user ? `${t.user.firstName} ${t.user.lastName}` : '—'}
                    </td>
                  )}
                  <td className="py-3 px-4 font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t.tokenPrefix || t.token?.slice(0, 8) || '—'}...
                  </td>
                  <td className="py-3 px-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(t.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {t.expiresAt ? (
                      <span style={{ color: new Date(t.expiresAt) < new Date() ? '#ef4444' : 'var(--color-text-muted)' }}>
                        {new Date(t.expiresAt).toLocaleDateString('pt-BR')}
                        {new Date(t.expiresAt) < new Date() && ' (expirado)'}
                      </span>
                    ) : <span style={{ color: 'var(--color-muted)' }}>Nunca</span>}
                  </td>
                  <td className="py-3 px-4 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t.lastUsedAt || t.lastUsed
                      ? new Date(t.lastUsedAt || t.lastUsed).toLocaleString('pt-BR')
                      : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => {
                        if (window.confirm(`Revogar token "${t.name}"?`)) {
                          revokeMutation.mutate(t.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      style={{ color: '#ef4444' }}
                      title="Revogar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Instruções */}
      {activeTab === 'personal' && (
        <div className="rounded-xl p-4" style={{ background: `${settings.primaryColor}08`, border: `1px solid ${settings.primaryColor}30` }}>
          <h3 className="text-sm font-semibold mb-2" style={{ color: settings.primaryColor }}>
            Como usar com a extensão Chrome
          </h3>
          <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: 'var(--color-text-muted)' }}>
            <li>Instale a extensão VaultGuard no Chrome</li>
            <li>Clique no ícone da extensão e acesse Configurações</li>
            <li>Informe a URL do servidor: <code className="px-1 rounded" style={{ background: 'var(--color-surface-2)', color: settings.primaryColor }}>http://IP_DO_SERVIDOR</code></li>
            <li>Cole o token de API gerado acima</li>
            <li>Pronto! A extensão buscará credenciais automaticamente ao visitar sites</li>
          </ol>
        </div>
      )}

      {activeTab === 'system' && isAdmin && (
        <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Esta aba exibe todos os tokens de API de todos os usuários do sistema. Administradores podem revogar qualquer token.
          </p>
        </div>
      )}

      {/* Modal criar token */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="w-full max-w-md rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              Novo Token de API
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  Nome do Token *
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}
                  placeholder="Ex: Extensão Chrome - Notebook"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  Expirar em (dias)
                </label>
                <input
                  type="number"
                  value={form.expiresInDays}
                  onChange={e => setForm({ ...form, expiresInDays: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}
                  placeholder="Deixe vazio para nunca expirar"
                  min="1"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreate(false); setForm({ name: '', expiresInDays: '' }); }}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5 transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cancelar
              </button>
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name || createMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                {createMutation.isPending ? 'Criando...' : 'Criar Token'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
