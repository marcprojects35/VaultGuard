import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Eye, ExternalLink, Copy, Check, X, RefreshCw, Key } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { decryptPassword } from '../utils/crypto.js';

export default function SearchPage() {
  const settings = useSettingsStore(s => s.settings);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [copied, setCopied] = useState(null);
  const [debounceTimer, setDebounceTimer] = useState(null);

  const handleSearch = (val) => {
    setSearch(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => setDebouncedSearch(val), 400);
    setDebounceTimer(t);
  };

  const { data: results = [], isLoading, isFetching } = useQuery({
    queryKey: ['search', debouncedSearch],
    queryFn: () => debouncedSearch.trim().length >= 2
      ? api.get('/credentials', { params: { search: debouncedSearch } }).then(r => r.data)
      : Promise.resolve([]),
    enabled: debouncedSearch.trim().length >= 2,
  });

  const copyField = async (credId, field, plainValue) => {
    try {
      if (field === 'password') {
        const { data } = await api.get(`/credentials/${credId}`);
        const plain = await decryptPassword(data.encryptedPass, null);
        await navigator.clipboard.writeText(plain);
      } else {
        await navigator.clipboard.writeText(plainValue);
      }
      setCopied(`${credId}-${field}`);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const isEmpty = debouncedSearch.trim().length >= 2 && !isLoading && !isFetching && results.length === 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Search className="w-6 h-6" style={{ color: settings.primaryColor }} />
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Pesquisa</h1>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--color-muted)' }} />
        <input
          type="text"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Pesquisar por título, usuário, URL, descrição ou tag..."
          autoFocus
          className="w-full pl-12 pr-12 py-3.5 rounded-2xl text-sm outline-none"
          style={{
            background: 'var(--color-surface)',
            border: `1px solid ${search ? settings.primaryColor + '66' : 'var(--color-border)'}`,
            color: 'var(--color-text)',
            fontSize: '15px',
          }}
        />
        {search && (
          <button onClick={() => { setSearch(''); setDebouncedSearch(''); }}
            className="absolute right-4 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        )}
        {(isLoading || isFetching) && (
          <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: 'var(--color-muted)' }} />
        )}
      </div>

      {/* Status */}
      {debouncedSearch.trim().length > 0 && debouncedSearch.trim().length < 2 && (
        <p className="text-sm text-center mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Digite ao menos 2 caracteres para pesquisar.
        </p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {results.length} resultado{results.length !== 1 ? 's' : ''} para <strong style={{ color: 'var(--color-text)' }}>"{debouncedSearch}"</strong>
            </span>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Título', 'Usuário', 'Descrição', 'Tags', 'URL', 'Pasta', 'Ações'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map(cred => (
                  <tr key={cred.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {cred.url ? (
                          <img src={`https://www.google.com/s2/favicons?domain=${new URL(cred.url).hostname}&sz=16`}
                            className="w-4 h-4 flex-shrink-0"
                            onError={e => { e.target.style.display = 'none'; }} />
                        ) : <Key className="w-4 h-4 flex-shrink-0" style={{ color: settings.primaryColor }} />}
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{cred.title}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {cred.username ? (
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-mono" style={{ color: 'var(--color-text-muted)' }}>{cred.username}</span>
                          <button onClick={() => copyField(cred.id, 'username', cred.username)}
                            className="p-1 rounded hover:bg-white/5" style={{ color: copied === `${cred.id}-username` ? '#10b981' : 'var(--color-muted)' }}>
                            {copied === `${cred.id}-username` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>

                    <td className="px-4 py-3 max-w-[180px]">
                      <span className="text-sm truncate block" style={{ color: 'var(--color-text-muted)' }}>
                        {cred.notes ? cred.notes.slice(0, 60) + (cred.notes.length > 60 ? '…' : '') : '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {cred.tags?.length > 0
                          ? cred.tags.map(tag => (
                            <span key={tag} className="text-xs px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}>
                              #{tag}
                            </span>
                          ))
                          : <span className="text-slate-600">—</span>}
                      </div>
                    </td>

                    <td className="px-4 py-3 max-w-[160px]">
                      {cred.url ? (
                        <a href={cred.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm truncate block hover:underline"
                          style={{ color: settings.primaryColor }}>
                          {cred.url.replace(/^https?:\/\//, '')}
                        </a>
                      ) : <span className="text-slate-600">—</span>}
                    </td>

                    <td className="px-4 py-3">
                      {cred.folder && (
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: `${cred.folder.color || settings.primaryColor}22`, color: cred.folder.color || settings.primaryColor }}>
                          {cred.folder.name}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => copyField(cred.id, 'password', null)}
                          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-xs flex items-center gap-1"
                          style={{ color: copied === `${cred.id}-password` ? '#10b981' : 'var(--color-muted)' }}
                          title="Copiar senha">
                          {copied === `${cred.id}-password` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {cred.url && (
                          <a href={cred.url} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                            style={{ color: 'var(--color-muted)' }}
                            title="Abrir URL">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-text-muted)' }}>
          <Search className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-base">Nenhum resultado para <strong>"{debouncedSearch}"</strong></p>
          <p className="text-sm mt-1 opacity-70">Verifique a ortografia ou tente termos diferentes.</p>
        </div>
      )}

      {!debouncedSearch && (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-text-muted)' }}>
          <Search className="w-14 h-14 mb-4 opacity-15" />
          <p className="text-base">Pesquise por título, usuário, URL ou tag</p>
          <p className="text-sm mt-1 opacity-70">A pesquisa abrange todas as pastas que você tem acesso.</p>
        </div>
      )}
    </div>
  );
}
