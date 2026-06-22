import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Eye, ExternalLink, Copy, Check, X, RefreshCw, Key,
  Tag, Clock, FolderOpen, AlertCircle, ChevronDown, Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { decryptPassword } from '../utils/crypto.js';
import { getMasterKey } from '../stores/authStore.js';
import { getStrengthColor } from '../utils/crypto.js';

function ExpiryBadge({ expiresAt }) {
  if (!expiresAt) return null;
  const now = new Date();
  const exp = new Date(expiresAt);
  const diff = exp - now;
  if (diff < 0) return <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: '#ef444422', color: '#ef4444' }}>Expirada</span>;
  if (diff < 7 * 24 * 60 * 60 * 1000) return <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: '#f9731622', color: '#f97316' }}>{exp.toLocaleDateString('pt-BR')}</span>;
  if (diff < 30 * 24 * 60 * 60 * 1000) return <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: '#f59e0b22', color: '#f59e0b' }}>{exp.toLocaleDateString('pt-BR')}</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: '#10b98122', color: '#10b981' }}>{exp.toLocaleDateString('pt-BR')}</span>;
}

export default function SearchPage() {
  const settings = useSettingsStore(s => s.settings);
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('q') || '');
  const [tag, setTag] = useState(searchParams.get('tag') || '');
  const [expiry, setExpiry] = useState(searchParams.get('expiry') || '');
  const [copied, setCopied] = useState(null);
  const [showFilters, setShowFilters] = useState(!!(searchParams.get('tag') || searchParams.get('expiry')));
  const [debounceTimer, setDebounceTimer] = useState(null);

  // Sync URL params
  useEffect(() => {
    const params = {};
    if (debouncedSearch) params.q = debouncedSearch;
    if (tag) params.tag = tag;
    if (expiry) params.expiry = expiry;
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, tag, expiry]);

  const handleSearch = (val) => {
    setSearch(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => setDebouncedSearch(val), 400);
    setDebounceTimer(t);
  };

  const hasFilters = debouncedSearch.trim().length >= 2 || tag || expiry;

  const { data: results = [], isLoading, isFetching } = useQuery({
    queryKey: ['search', debouncedSearch, tag, expiry],
    queryFn: () => {
      const params = {};
      if (debouncedSearch.trim().length >= 2) params.search = debouncedSearch;
      if (tag) params.tag = tag;
      if (expiry) params.expiry = expiry;
      return api.get('/credentials', { params }).then(r => r.data);
    },
    enabled: hasFilters,
  });

  // Get all tags for autocomplete
  const { data: allCreds = [] } = useQuery({
    queryKey: ['credentials-tags'],
    queryFn: () => api.get('/credentials').then(r => r.data),
    staleTime: 60_000,
  });
  const allTags = [...new Set(allCreds.flatMap(c => c.tags || []))].sort();

  const copyField = async (credId, field, plainValue) => {
    try {
      if (field === 'password') {
        const { data } = await api.get(`/credentials/${credId}`);
        const plain = await decryptPassword(data.encryptedPass, getMasterKey());
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

  const clearAll = () => {
    setSearch(''); setDebouncedSearch(''); setTag(''); setExpiry('');
    setSearchParams({});
  };

  const isEmpty = hasFilters && !isLoading && !isFetching && results.length === 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Search className="w-6 h-6" style={{ color: settings.primaryColor }} />
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Pesquisa Avançada</h1>
      </div>

      {/* Search input */}
      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--color-muted)' }} />
        <input
          type="text"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Pesquisar por título, usuário, URL, anotação..."
          autoFocus
          className="w-full pl-12 pr-28 py-3.5 rounded-2xl text-sm outline-none"
          style={{
            background: 'var(--color-surface)',
            border: `1px solid ${search ? settings.primaryColor + '66' : 'var(--color-border)'}`,
            color: 'var(--color-text)',
            fontSize: '15px',
          }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {(isLoading || isFetching) && <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--color-muted)' }} />}
          <button onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: showFilters || tag || expiry ? `${settings.primaryColor}22` : 'var(--color-surface-2)',
              color: showFilters || tag || expiry ? settings.primaryColor : 'var(--color-text-muted)',
            }}>
            <Filter className="w-3.5 h-3.5" />
            Filtros
            {(tag || expiry) && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="rounded-2xl p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-4"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {/* Tag filter */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
              <Tag className="w-3.5 h-3.5" /> Filtrar por Tag
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setTag('')}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: !tag ? `${settings.primaryColor}22` : 'var(--color-surface-2)',
                  color: !tag ? settings.primaryColor : 'var(--color-text-muted)',
                }}>
                Todas
              </button>
              {allTags.map(t => (
                <button key={t} onClick={() => setTag(tag === t ? '' : t)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: tag === t ? `${settings.primaryColor}22` : 'var(--color-surface-2)',
                    color: tag === t ? settings.primaryColor : 'var(--color-text-muted)',
                  }}>
                  #{t}
                </button>
              ))}
              {allTags.length === 0 && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Nenhuma tag cadastrada</span>
              )}
            </div>
          </div>

          {/* Expiry filter */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
              <Clock className="w-3.5 h-3.5" /> Filtrar por Expiração
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: '', label: 'Todas' },
                { value: 'expired', label: 'Expiradas', color: '#ef4444' },
                { value: 'expiring', label: 'Expirando em 30 dias', color: '#f59e0b' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setExpiry(opt.value)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: expiry === opt.value ? `${opt.color || settings.primaryColor}22` : 'var(--color-surface-2)',
                    color: expiry === opt.value ? (opt.color || settings.primaryColor) : 'var(--color-text-muted)',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Active filters display */}
      {(tag || expiry) && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Filtros ativos:</span>
          {tag && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
              #{tag}
              <button onClick={() => setTag('')}><X className="w-3 h-3" /></button>
            </span>
          )}
          {expiry && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#f59e0b22', color: '#f59e0b' }}>
              {expiry === 'expired' ? 'Expiradas' : 'Expirando em breve'}
              <button onClick={() => setExpiry('')}><X className="w-3 h-3" /></button>
            </span>
          )}
          <button onClick={clearAll} className="text-xs hover:underline" style={{ color: 'var(--color-muted)' }}>
            Limpar tudo
          </button>
        </div>
      )}

      {/* Status */}
      {debouncedSearch.trim().length > 0 && debouncedSearch.trim().length < 2 && !tag && !expiry && (
        <p className="text-sm text-center mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Digite ao menos 2 caracteres para pesquisar.
        </p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {results.length} resultado{results.length !== 1 ? 's' : ''}
              {debouncedSearch && <> para <strong style={{ color: 'var(--color-text)' }}>"{debouncedSearch}"</strong></>}
            </span>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Título', 'Usuário', 'Tags', 'URL', 'Pasta', 'Expira', 'Força', 'Ações'].map(h => (
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
                          <img src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(cred.url).hostname; } catch { return ''; } })()}&sz=16`}
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

                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {cred.tags?.length > 0
                          ? cred.tags.map(t => (
                            <button key={t} onClick={() => { setTag(t); setShowFilters(true); }}
                              className="text-xs px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                              style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                              #{t}
                            </button>
                          ))
                          : <span className="text-slate-600">—</span>}
                      </div>
                    </td>

                    <td className="px-4 py-3 max-w-[140px]">
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
                      <ExpiryBadge expiresAt={cred.expiresAt} />
                      {!cred.expiresAt && <span className="text-slate-600">—</span>}
                    </td>

                    <td className="px-4 py-3">
                      {cred.strength != null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${cred.strength}%`, background: getStrengthColor(cred.strength) }} />
                          </div>
                          <span className="text-xs" style={{ color: getStrengthColor(cred.strength) }}>{cred.strength}%</span>
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => copyField(cred.id, 'password', null)}
                          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
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
          <p className="text-base">Nenhum resultado encontrado</p>
          <p className="text-sm mt-1 opacity-70">Tente termos diferentes ou ajuste os filtros.</p>
          <button onClick={clearAll} className="mt-4 text-sm hover:underline" style={{ color: settings.primaryColor }}>
            Limpar filtros
          </button>
        </div>
      )}

      {!hasFilters && (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-text-muted)' }}>
          <Search className="w-14 h-14 mb-4 opacity-15" />
          <p className="text-base">Pesquise por título, usuário, URL ou tag</p>
          <p className="text-sm mt-1 opacity-70">Use os filtros para refinar por tags ou datas de expiração.</p>
        </div>
      )}
    </div>
  );
}
