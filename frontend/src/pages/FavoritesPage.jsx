import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, Eye, EyeOff, Copy, Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { decryptPassword } from '../utils/crypto.js';

function FavoriteCard({ cred, onRemove, settings }) {
  const [passVisible, setPassVisible] = useState(false);
  const [decryptedPass, setDecryptedPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);

  const loadPassword = async () => {
    if (decryptedPass) { setPassVisible(!passVisible); return; }
    setLoading(true);
    try {
      const { data } = await api.get(`/credentials/${cred.id}`);
      const plain = await decryptPassword(data.encryptedPass, null);
      setDecryptedPass(plain);
      setPassVisible(true);
    } catch { toast.error('Erro ao carregar senha'); }
    finally { setLoading(false); }
  };

  const copyToClipboard = async (field) => {
    try {
      let text = field === 'password'
        ? decryptedPass || await api.get(`/credentials/${cred.id}`).then(async r => {
            const p = await decryptPassword(r.data.encryptedPass, null);
            return p;
          })
        : cred[field];
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch { toast.error('Erro ao copiar'); }
  };

  return (
    <div className="group rounded-xl p-4 transition-all hover:scale-[1.01]"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: `${settings.primaryColor}22` }}>
          {cred.url ? (
            <img src={`https://www.google.com/s2/favicons?domain=${new URL(cred.url).hostname}&sz=32`}
              className="w-5 h-5"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
          ) : null}
          <Star className="w-4 h-4" style={{ color: settings.primaryColor, display: cred.url ? 'none' : 'block' }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{cred.title}</h3>
          </div>
          {cred.folder && (
            <span className="text-xs px-1.5 py-0.5 rounded-md"
              style={{ background: `${cred.folder.color || settings.primaryColor}22`, color: cred.folder.color || settings.primaryColor }}>
              {cred.folder.name}
            </span>
          )}

          {cred.username && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono truncate" style={{ color: 'var(--color-text-muted)' }}>{cred.username}</span>
              <button onClick={() => copyToClipboard('username')}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                style={{ color: copied === 'username' ? '#10b981' : 'var(--color-muted)' }}>
                {copied === 'username' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)', letterSpacing: passVisible ? 'normal' : '2px' }}>
              {passVisible ? decryptedPass : '••••••••••'}
            </span>
            <button onClick={loadPassword} disabled={loading}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
              style={{ color: 'var(--color-muted)' }}>
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : passVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
            <button onClick={() => copyToClipboard('password')}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
              style={{ color: copied === 'password' ? '#10b981' : 'var(--color-muted)' }}>
              {copied === 'password' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          {cred.tags?.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {cred.tags.map(tag => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {cred.url && (
            <a href={cred.url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              style={{ color: 'var(--color-muted)' }}>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button onClick={() => onRemove(cred.id)}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            style={{ color: '#ef4444' }}
            title="Remover dos favoritos">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FavoritesPage() {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();

  const { data: favorites = [], isLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => api.get('/favorites').then(r => r.data),
  });

  const removeMutation = useMutation({
    mutationFn: (credId) => api.delete(`/favorites/${credId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites'] });
      toast.success('Removido dos favoritos!');
    },
    onError: () => toast.error('Erro ao remover'),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Star className="w-6 h-6" style={{ color: settings.primaryColor }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Favoritos</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Credenciais marcadas como favoritas para acesso rápido
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32" style={{ color: 'var(--color-text-muted)' }}>
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24" style={{ color: 'var(--color-text-muted)' }}>
          <Star className="w-14 h-14 mb-4 opacity-15" />
          <p className="text-base">Nenhum favorito ainda</p>
          <p className="text-sm mt-1 opacity-70">
            Abra uma credencial no Cofre e clique em ★ para adicioná-la aos favoritos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {favorites.map(cred => (
            <FavoriteCard
              key={cred.id}
              cred={cred}
              settings={settings}
              onRemove={(id) => removeMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
