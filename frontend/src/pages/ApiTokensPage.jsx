import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2, Copy, Eye, EyeOff, AlertTriangle, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

export default function ApiTokensPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [form, setForm] = useState({ name: '', expiresInDays: '' });
  const [copied, setCopied] = useState(false);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get('/api-tokens').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/api-tokens', data),
    onSuccess: (res) => {
      qc.invalidateQueries(['api-tokens']);
      setNewToken(res.data.token);
      setShowCreate(false);
      setForm({ name: '', expiresInDays: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao criar token'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id) => api.delete(`/api-tokens/${id}`),
    onSuccess: () => { qc.invalidateQueries(['api-tokens']); toast.success('Token revogado!'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const copyToken = (token) => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Token copiado!');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Key size={24} className="text-indigo-400" /> Tokens de API
          </h1>
          <p className="text-slate-400 text-sm mt-1">Gerencie tokens para a extensão Chrome e integrações externas</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> Novo Token
        </button>
      </div>

      {/* Banner token recém-criado */}
      {newToken && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-green-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-300 mb-1">Token criado com sucesso — copie agora!</p>
              <p className="text-xs text-green-400/70 mb-3">Este token só é exibido uma vez. Guarde em local seguro.</p>
              <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 font-mono text-xs text-green-300 break-all">
                <span className="flex-1">{newToken}</span>
                <button onClick={() => copyToken(newToken)} className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors">
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => setNewToken(null)} className="mt-3 text-xs text-green-400/60 hover:text-green-300">Dispensar</button>
        </div>
      )}

      {/* Lista de tokens */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-8 text-center text-slate-500">Carregando...</div>
        ) : tokens.length === 0 ? (
          <div className="py-12 text-center">
            <Key size={32} className="mx-auto mb-3 text-slate-600" />
            <p className="text-slate-500">Nenhum token criado ainda.</p>
            <p className="text-xs text-slate-600 mt-1">Crie um token para usar na extensão Chrome</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-xs text-slate-500 uppercase tracking-wider">
                <th className="text-left py-3 px-4">Nome</th>
                <th className="text-left py-3 px-4">Prefixo</th>
                <th className="text-left py-3 px-4">Criado em</th>
                <th className="text-left py-3 px-4">Expira em</th>
                <th className="text-left py-3 px-4">Último uso</th>
                <th className="text-right py-3 px-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} className="border-b border-white/5 hover:bg-white/3 text-sm">
                  <td className="py-3 px-4 text-slate-200 font-medium">{t.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-400">{t.tokenPrefix}...</td>
                  <td className="py-3 px-4 text-slate-400 text-xs">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td className="py-3 px-4 text-xs">
                    {t.expiresAt ? (
                      <span className={new Date(t.expiresAt) < new Date() ? 'text-red-400' : 'text-slate-400'}>
                        {new Date(t.expiresAt).toLocaleDateString('pt-BR')}
                        {new Date(t.expiresAt) < new Date() && ' (expirado)'}
                      </span>
                    ) : <span className="text-slate-500">Nunca</span>}
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-xs">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => { if (confirm(`Revogar token "${t.name}"?`)) revokeMutation.mutate(t.id); }}
                      className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors" title="Revogar">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Instruções extensão */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-indigo-300 mb-2">Como usar com a extensão Chrome</h3>
        <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
          <li>Instale a extensão VaultGuard no Chrome</li>
          <li>Clique no ícone da extensão e acesse Configurações</li>
          <li>Informe a URL do servidor: <code className="bg-black/30 px-1 rounded">http://IP_DO_SERVIDOR</code></li>
          <li>Cole o token de API gerado acima</li>
          <li>Pronto! A extensão buscará credenciais automaticamente ao visitar sites</li>
        </ol>
      </div>

      {/* Modal criar */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Novo Token de API</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Nome do Token *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Ex: Extensão Chrome - Notebook" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Expirar em (dias)</label>
                <input type="number" value={form.expiresInDays} onChange={e => setForm({ ...form, expiresInDays: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Deixe vazio para nunca expirar" min="1" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 text-sm">Cancelar</button>
              <button onClick={() => createMutation.mutate(form)} disabled={!form.name}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
                Criar Token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
