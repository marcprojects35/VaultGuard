import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Eye, EyeOff, Copy, ExternalLink, Edit2, Trash2,
  Folder, FolderOpen, ChevronRight, ChevronDown, Key, Tag,
  RefreshCw, AlertTriangle, Shield, Wand2, X, Check
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useAuthStore } from '../stores/authStore.js';
import {
  encryptPassword, decryptPassword, calculateStrength,
  getStrengthColor, getStrengthLabel, generatePassword
} from '../utils/crypto.js';

// ————— Credential Card —————
function CredentialCard({ cred, onEdit, onDelete, settings }) {
  const { t } = useTranslation();
  const [passVisible, setPassVisible] = useState(false);
  const [decryptedPass, setDecryptedPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);

  const loadPassword = async () => {
    if (decryptedPass) { setPassVisible(!passVisible); return; }
    setLoading(true);
    try {
      const { data } = await api.get(`/credentials/${cred.id}`);
      const plain = await decryptPassword(data.encryptedPass, null); // null = dev mode
      setDecryptedPass(plain);
      setPassVisible(true);
    } catch { toast.error('Erro ao carregar senha'); }
    finally { setLoading(false); }
  };

  const copyToClipboard = async (text, type) => {
    try {
      if (type === 'password' && !decryptedPass) {
        const { data } = await api.get(`/credentials/${cred.id}`);
        const plain = await decryptPassword(data.encryptedPass, null);
        await navigator.clipboard.writeText(plain);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch { toast.error('Erro ao copiar'); }
  };

  const strengthColor = cred.strength ? getStrengthColor(cred.strength) : '#6b7280';

  return (
    <div className="group rounded-xl p-4 transition-all hover:scale-[1.01]"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-3">
        {/* Favicon / Icon */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: 'var(--color-surface-2)' }}>
          {cred.url ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${new URL(cred.url).hostname}&sz=32`}
              className="w-5 h-5"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
            />
          ) : null}
          <Key className="w-4 h-4" style={{ color: settings.primaryColor, display: cred.url ? 'none' : 'block' }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{cred.title}</h3>
            {cred.strength !== undefined && (
              <div className="w-12 h-1 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--color-surface-2)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${cred.strength}%`, background: strengthColor }} />
              </div>
            )}
          </div>
          {cred.folder && (
            <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: `${cred.folder.color}22`, color: cred.folder.color }}>
              {cred.folder.name}
            </span>
          )}

          {/* Username */}
          {cred.username && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono truncate" style={{ color: 'var(--color-text-muted)' }}>
                {cred.username}
              </span>
              <button onClick={() => copyToClipboard(cred.username, 'username')}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                style={{ color: copied === 'username' ? '#10b981' : 'var(--color-muted)' }}>
                {copied === 'username' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}

          {/* Password row */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)', letterSpacing: passVisible ? 'normal' : '2px' }}>
              {passVisible ? decryptedPass : '••••••••••'}
            </span>
            <button onClick={loadPassword} disabled={loading}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
              style={{ color: 'var(--color-muted)' }}>
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : passVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
            <button onClick={() => copyToClipboard(null, 'password')}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
              style={{ color: copied === 'password' ? '#10b981' : 'var(--color-muted)' }}>
              {copied === 'password' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          {/* Tags */}
          {cred.tags?.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {cred.tags.map(tag => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {cred.url && (
            <a href={cred.url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              style={{ color: 'var(--color-muted)' }}>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button onClick={() => onEdit(cred)}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-muted)' }}>
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(cred)}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            style={{ color: '#ef4444' }}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ————— Folder Tree Item —————
function FolderItem({ folder, selectedId, onSelect, level = 0, settings }) {
  const [expanded, setExpanded] = useState(level === 0);
  const hasChildren = folder.children?.length > 0;
  const isSelected = folder.id === selectedId;

  return (
    <div>
      <button
        onClick={() => { onSelect(folder.id); if (hasChildren) setExpanded(!expanded); }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all"
        style={{
          paddingLeft: `${12 + level * 16}px`,
          background: isSelected ? `${settings.primaryColor}22` : 'transparent',
          color: isSelected ? settings.primaryColor : 'var(--color-text)',
        }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />
        ) : <span className="w-3" />}
        <span className="text-base">{folder.icon === 'folder' ? '📁' : '📂'}</span>
        <span className="truncate flex-1 text-left">{folder.name}</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {folder._count?.credentials || 0}
        </span>
      </button>
      {expanded && hasChildren && (
        <div>
          {folder.children.map(child => (
            <FolderItem key={child.id} folder={child} selectedId={selectedId} onSelect={onSelect} level={level + 1} settings={settings} />
          ))}
        </div>
      )}
    </div>
  );
}

// ————— Credential Form Modal —————
function CredentialModal({ credential, folders, onClose, onSaved }) {
  const { t } = useTranslation();
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const isEdit = !!credential?.id;

  const [form, setForm] = useState({
    title: credential?.title || '',
    username: credential?.username || '',
    password: '',
    url: credential?.url || '',
    notes: credential?.notes || '',
    folderId: credential?.folderId || '',
    tags: credential?.tags?.join(', ') || '',
    strength: 0,
  });
  const [showPass, setShowPass] = useState(false);
  const [genOptions, setGenOptions] = useState({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });

  const flatFolders = flattenFolders(folders || []);

  const handlePassword = (val) => {
    setForm(f => ({ ...f, password: val, strength: calculateStrength(val) }));
  };

  const handleGenerate = () => {
    const pass = generatePassword(genOptions);
    handlePassword(pass);
    setShowPass(true);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const encrypted = await encryptPassword(form.password, null);
      const payload = {
        title: form.title,
        username: form.username || undefined,
        encryptedPass: form.password ? encrypted : undefined,
        url: form.url || undefined,
        notes: form.notes || undefined,
        folderId: form.folderId,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        strength: form.strength,
      };
      if (isEdit) {
        return api.put(`/credentials/${credential.id}`, payload);
      }
      return api.post('/credentials', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] });
      toast.success(isEdit ? 'Credencial atualizada!' : 'Credencial criada!');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Erro')
  });

  const strengthColor = getStrengthColor(form.strength);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl p-6 animate-fadeIn max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">{isEdit ? t('vault.editCredential') : t('vault.addCredential')}</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 transition-colors" style={{ color: 'var(--color-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('common.required')} — Título
            </label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Ex: Gmail Corporativo" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pasta</label>
            <select value={form.folderId} onChange={e => setForm(f => ({ ...f, folderId: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">Selecione uma pasta</option>
              {flatFolders.map(f => (
                <option key={f.id} value={f.id}>{'  '.repeat(f.level)}{f.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Usuário</label>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                placeholder="usuario@empresa.com" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {isEdit ? 'Nova Senha (deixe vazio para manter)' : 'Senha'}
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => handlePassword(e.target.value)}
                  className="w-full pl-3 pr-16 py-2.5 rounded-xl text-sm outline-none font-mono"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="••••••••••" />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="p-1 rounded" style={{ color: 'var(--color-muted)' }}>
                    {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={handleGenerate}
                    className="p-1 rounded" style={{ color: settings.primaryColor }}>
                    <Wand2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {form.password && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${form.strength}%`, background: strengthColor }} />
                  </div>
                  <span className="text-xs" style={{ color: strengthColor }}>{form.strength}%</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>URL</label>
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="https://exemplo.com.br" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Tags (separadas por vírgula)</label>
            <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="erp, financeiro, admin" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Anotações</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Informações adicionais..." />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
            {t('common.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.title || !form.folderId}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ————— Main Vault Page —————
export default function VaultPage() {
  const { t } = useTranslation();
  const settings = useSettingsStore(s => s.settings);
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [modalCred, setModalCred] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get('/folders').then(r => r.data),
  });

  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ['credentials', selectedFolder, search],
    queryFn: () => api.get('/credentials', { params: { folderId: selectedFolder || undefined, search: search || undefined } }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/credentials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Credencial excluída!');
      setDeleteTarget(null);
    },
    onError: () => toast.error('Erro ao excluir'),
  });

  const totalFolderCount = credentials.length;

  return (
    <div className="flex h-full">
      {/* Folder sidebar */}
      <div className="w-64 flex-shrink-0 border-r p-3 overflow-y-auto" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between px-3 py-2 mb-1">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            {t('folder.title')}
          </span>
        </div>

        <button
          onClick={() => setSelectedFolder(null)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm mb-1 transition-all"
          style={{
            background: !selectedFolder ? `${settings.primaryColor}22` : 'transparent',
            color: !selectedFolder ? settings.primaryColor : 'var(--color-text-muted)',
          }}>
          <Shield className="w-4 h-4" />
          <span>{t('common.all')}</span>
          <span className="ml-auto text-xs">{credentials.length}</span>
        </button>

        {folders.map(folder => (
          <FolderItem key={folder.id} folder={folder} selectedId={selectedFolder} onSelect={setSelectedFolder} settings={settings} />
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-4 p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('vault.search')}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {credentials.length} {t('vault.totalCredentials')}
          </div>

          <button
            onClick={() => { setModalCred(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            <Plus className="w-4 h-4" />
            {t('vault.addCredential')}
          </button>
        </div>

        {/* Credentials grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-32" style={{ color: 'var(--color-text-muted)' }}>
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              {t('common.loading')}
            </div>
          ) : credentials.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64" style={{ color: 'var(--color-text-muted)' }}>
              <Key className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">{t('vault.noResults')}</p>
              <p className="text-xs mt-1">{t('vault.noResultsHint')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {credentials.map(cred => (
                <CredentialCard
                  key={cred.id}
                  cred={cred}
                  settings={settings}
                  onEdit={(c) => { setModalCred(c); setShowModal(true); }}
                  onDelete={(c) => setDeleteTarget(c)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Credential modal */}
      {showModal && (
        <CredentialModal
          credential={modalCred}
          folders={folders}
          onClose={() => { setShowModal(false); setModalCred(null); }}
          onSaved={() => {}}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold">{t('vault.deleteCredential')}</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deleteTarget.title}</p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
              {t('vault.deleteConfirm')}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5 transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                {t('common.cancel')}
              </button>
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50">
                {deleteMutation.isPending ? t('common.loading') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function flattenFolders(folders, level = 0) {
  const result = [];
  for (const f of folders) {
    result.push({ ...f, level });
    if (f.children?.length) result.push(...flattenFolders(f.children, level + 1));
  }
  return result;
}
