import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Eye, EyeOff, Copy, ExternalLink, Edit2, Trash2,
  Folder, FolderOpen, ChevronRight, ChevronDown, Key, Tag,
  RefreshCw, AlertTriangle, Shield, Wand2, X, Check, Star,
  History, ArrowLeft, Link, Bell, Clock, Globe, User,
  FileText, Lock, Paperclip, Upload, Download, PlusCircle, Minus,
  Share2, Users, CalendarClock, LayoutTemplate, CheckSquare, Square,
  AlertCircle, MoreVertical,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useAuthStore, getMasterKey } from '../stores/authStore.js';
import {
  encryptPassword, decryptPassword, calculateStrength,
  getStrengthColor, getStrengthLabel, generatePassword
} from '../utils/crypto.js';

// ── Palette constants ──────────────────────────────────────────────────────────
const FOLDER_BG      = '#111111';
const FOLDER_BORDER  = '#1E1E1E';
const GOLD           = '#C78C00';
const GOLD_DIM       = '#C78C0044';
const GOLD_TEXT      = '#E7A300';

// ────────────────────────────────────────────────────────────────────────────
// Folder Tree Item
// ────────────────────────────────────────────────────────────────────────────
function FolderItem({ folder, selectedId, onSelect, level = 0, onDelete, isAdmin }) {
  const [expanded, setExpanded] = useState(level === 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const hasChildren = folder.children?.length > 0;
  const isSelected = folder.id === selectedId;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div>
      <div className="relative group flex items-center">
        <button
          onClick={() => { onSelect(folder.id); if (hasChildren) setExpanded(!expanded); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all text-left"
          style={{
            paddingLeft: `${12 + level * 16}px`,
            background: isSelected ? `${GOLD}22` : 'transparent',
            color: isSelected ? GOLD_TEXT : '#A0A09E',
          }}
        >
          {hasChildren ? (
            expanded
              ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: GOLD_TEXT }} />
              : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: '#636360' }} />
          ) : <span className="w-3" />}
          <span className="text-base">{folder.isPersonal ? '🔒' : folder.icon === 'folder' ? '📁' : '📂'}</span>
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-xs" style={{ color: '#4A4A48' }}>
            {folder._count?.credentials || 0}
          </span>
        </button>

        {/* 3-dots menu (admin, non-personal folders) */}
        {isAdmin && !folder.isPersonal && (
          <div className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1 rounded hover:bg-white/10"
              style={{ color: '#636360' }}>
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 rounded-xl overflow-hidden z-30"
                style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(folder); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-red-500/10 transition-colors"
                  style={{ color: '#ef4444' }}>
                  <Trash2 className="w-3.5 h-3.5" /> Excluir pasta
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {folder.children.map(child => (
            <FolderItem key={child.id} folder={child} selectedId={selectedId}
              onSelect={onSelect} level={level + 1} onDelete={onDelete} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function getExpiryStatus(expiresAt) {
  if (!expiresAt) return null;
  const now = new Date();
  const exp = new Date(expiresAt);
  const diff = exp - now;
  if (diff < 0) return 'expired';
  if (diff < 7 * 24 * 60 * 60 * 1000) return 'critical';
  if (diff < 30 * 24 * 60 * 60 * 1000) return 'warning';
  return 'ok';
}

const CREDENTIAL_TEMPLATES = [
  { id: 'web', label: 'Website', fields: [] },
  { id: 'ssh', label: 'SSH', fields: [{ name: 'Porta', value: '22', fieldType: 'text' }, { name: 'Chave Privada', value: '', fieldType: 'password' }] },
  { id: 'db', label: 'Banco de Dados', fields: [{ name: 'Host', value: '', fieldType: 'text' }, { name: 'Porta', value: '5432', fieldType: 'text' }, { name: 'Database', value: '', fieldType: 'text' }] },
  { id: 'api', label: 'API / Token', fields: [{ name: 'API Key', value: '', fieldType: 'password' }, { name: 'Endpoint', value: '', fieldType: 'url' }] },
  { id: 'email', label: 'E-mail', fields: [{ name: 'Servidor SMTP', value: '', fieldType: 'text' }, { name: 'Porta', value: '587', fieldType: 'text' }] },
  { id: 'wifi', label: 'Wi-Fi', fields: [{ name: 'SSID', value: '', fieldType: 'text' }, { name: 'Segurança', value: 'WPA2', fieldType: 'text' }] },
];

// ────────────────────────────────────────────────────────────────────────────
// Credential Row
// ────────────────────────────────────────────────────────────────────────────
function CredentialRow({ cred, isSelected, onClick, settings, selected, onSelect }) {
  const expiryStatus = getExpiryStatus(cred.expiresAt);

  return (
    <div
      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all cursor-pointer"
      style={{
        background: isSelected ? `${settings.primaryColor}15` : 'transparent',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: isSelected ? `3px solid ${settings.primaryColor}` : '3px solid transparent',
      }}
      onClick={() => onClick(cred)}
    >
      {onSelect && (
        <button onClick={e => { e.stopPropagation(); onSelect(cred.id); }}
          className="flex-shrink-0 mr-0" style={{ color: selected ? settings.primaryColor : 'var(--color-muted)' }}>
          {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>
      )}
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--color-surface-2)' }}>
        {cred.url ? (
          <img src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(cred.url).hostname; } catch { return ''; } })()}&sz=16`}
            className="w-4 h-4"
            onError={e => { e.target.style.display = 'none'; }} />
        ) : null}
        <Key className="w-3.5 h-3.5" style={{ color: settings.primaryColor, display: cred.url ? 'none' : 'block' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{cred.title}</div>
        {cred.username && (
          <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{cred.username}</div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {expiryStatus === 'expired' && <AlertCircle className="w-3.5 h-3.5 text-red-400" title="Expirada" />}
        {expiryStatus === 'critical' && <AlertCircle className="w-3.5 h-3.5 text-orange-400" title="Expira em menos de 7 dias" />}
        {expiryStatus === 'warning' && <Clock className="w-3.5 h-3.5 text-yellow-400" title="Expira em menos de 30 dias" />}
        {cred.attachments?.length > 0 && <Paperclip className="w-3 h-3" style={{ color: 'var(--color-muted)' }} />}
        {cred.customFields?.length > 0 && (
          <span className="text-xs px-1 rounded" style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
            +{cred.customFields.length}
          </span>
        )}
        {cred.strength != null && (
          <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: `${cred.strength}%`, background: getStrengthColor(cred.strength) }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Credential Detail Panel
// ────────────────────────────────────────────────────────────────────────────
function CredentialDetail({ cred, onEdit, onDelete, onToggleFavorite, isFavorite, settings, onClose }) {
  const [passVisible, setPassVisible] = useState(false);
  const [decryptedPass, setDecryptedPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);
  const [activeView, setActiveView] = useState('detail');
  const [visibleCustomFields, setVisibleCustomFields] = useState({});
  const [visibleHistoryPass, setVisibleHistoryPass] = useState({});
  const [decryptedHistoryPass, setDecryptedHistoryPass] = useState({});
  const [showShareModal, setShowShareModal] = useState(false);

  const expiryStatus = getExpiryStatus(cred.expiresAt);

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['cred-history-versions', cred.id],
    queryFn: () => api.get(`/credentials/${cred.id}/history`).then(r => r.data),
    enabled: activeView === 'history',
  });

  const { data: shares = [], isLoading: sharesLoading, refetch: refetchShares } = useQuery({
    queryKey: ['cred-shares', cred.id],
    queryFn: () => api.get(`/credentials/${cred.id}/shares`).then(r => r.data),
    enabled: activeView === 'shares',
  });

  useEffect(() => {
    setPassVisible(false); setDecryptedPass(''); setVisibleCustomFields({});
    setVisibleHistoryPass({}); setDecryptedHistoryPass({}); setActiveView('detail');
  }, [cred.id]);

  const loadHistoryPass = async (entry) => {
    if (decryptedHistoryPass[entry.id]) {
      setVisibleHistoryPass(p => ({ ...p, [entry.id]: !p[entry.id] }));
      return;
    }
    try {
      const plain = await decryptPassword(entry.encryptedPass, getMasterKey());
      setDecryptedHistoryPass(p => ({ ...p, [entry.id]: plain }));
      setVisibleHistoryPass(p => ({ ...p, [entry.id]: true }));
    } catch { toast.error('Erro ao descriptografar'); }
  };

  const loadPassword = async () => {
    if (decryptedPass) { setPassVisible(!passVisible); return; }
    setLoading(true);
    try {
      const { data } = await api.get(`/credentials/${cred.id}`);
      const plain = await decryptPassword(data.encryptedPass, getMasterKey());
      setDecryptedPass(plain); setPassVisible(true);
    } catch { toast.error('Erro ao carregar senha'); }
    finally { setLoading(false); }
  };

  const copyField = async (field, value) => {
    try {
      if (field === 'password') {
        if (!decryptedPass) {
          const { data } = await api.get(`/credentials/${cred.id}`);
          const plain = await decryptPassword(data.encryptedPass, getMasterKey());
          await navigator.clipboard.writeText(plain);
        } else {
          await navigator.clipboard.writeText(decryptedPass);
        }
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch { toast.error('Erro ao copiar'); }
  };

  const downloadAttachment = async (att) => {
    try {
      const { data } = await api.get(`/attachments/${cred.id}/${att.id}/download`);
      const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: data.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = data.fileName; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Erro ao baixar anexo'); }
  };

  const CopyBtn = ({ field, value }) => (
    <button onClick={() => copyField(field, value)}
      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors flex-shrink-0"
      style={{ color: copied === field ? '#10b981' : 'var(--color-muted)' }} title="Copiar">
      {copied === field ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  const Field = ({ icon: Icon, label, children }) => (
    <div className="flex items-start py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-28 flex items-center gap-2 flex-shrink-0 pt-0.5">
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color: 'var(--color-muted)' }} />}
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--color-muted)' }}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{cred.title}</h2>
          {cred.folder && (
            <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--color-muted)' }}>
              <Folder className="w-3 h-3" /> {cred.folder.name}
            </div>
          )}
        </div>
        <button onClick={() => onToggleFavorite(cred.id)}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: isFavorite ? '#f59e0b' : 'var(--color-muted)' }}>
          <Star className="w-4 h-4" fill={isFavorite ? '#f59e0b' : 'none'} />
        </button>
      </div>

      {(expiryStatus === 'expired' || expiryStatus === 'critical') && (
        <div className="px-5 py-2 text-xs font-medium flex items-center gap-2"
          style={{ background: expiryStatus === 'expired' ? '#ef444422' : '#f9731622', color: expiryStatus === 'expired' ? '#ef4444' : '#f97316' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {expiryStatus === 'expired'
            ? `Senha expirada em ${new Date(cred.expiresAt).toLocaleDateString('pt-BR')}`
            : `Expira em ${new Date(cred.expiresAt).toLocaleDateString('pt-BR')} — atualize em breve`}
        </div>
      )}

      <div className="flex items-center gap-1 px-4 py-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        {[
          { icon: Edit2, label: 'Editar', action: () => onEdit(cred), color: 'var(--color-text-muted)' },
          { icon: Trash2, label: 'Excluir', action: () => onDelete(cred), color: '#ef4444' },
          { icon: Copy, label: 'Copiar', action: () => copyField('password', null), color: 'var(--color-text-muted)' },
          { icon: Share2, label: 'Compartilhar', action: () => { setActiveView('shares'); setShowShareModal(true); }, color: activeView === 'shares' ? settings.primaryColor : 'var(--color-text-muted)' },
          { icon: History, label: 'Versões', action: () => setActiveView(v => v === 'history' ? 'detail' : 'history'), color: activeView === 'history' ? settings.primaryColor : 'var(--color-text-muted)' },
        ].map(({ icon: Icon, label, action, color }) => (
          <button key={label} onClick={action}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs hover:bg-white/5 transition-colors whitespace-nowrap"
            style={{ color }}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {activeView === 'detail' ? (
          <>
            <div className="rounded-2xl overflow-hidden mb-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="px-5">
                <Field icon={Key} label="Senha">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono flex-1" style={{ color: 'var(--color-text)', letterSpacing: passVisible ? 'normal' : '3px' }}>
                      {passVisible ? decryptedPass : '★ ★ ★ ★ ★'}
                    </span>
                    <button onClick={loadPassword} disabled={loading}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors flex-shrink-0"
                      style={{ color: 'var(--color-muted)' }}>
                      {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : passVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <CopyBtn field="password" value={null} />
                  </div>
                </Field>
                {cred.username !== undefined && (
                  <Field icon={User} label="Conta">
                    <div className="flex items-center gap-2">
                      <span className="text-sm flex-1" style={{ color: cred.username ? 'var(--color-text)' : 'var(--color-muted)' }}>{cred.username || '—'}</span>
                      {cred.username && <CopyBtn field="username" value={cred.username} />}
                    </div>
                  </Field>
                )}
                <Field icon={Globe} label="URL">
                  {cred.url ? (
                    <div className="flex items-center gap-2">
                      <a href={cred.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm hover:underline flex-1 truncate" style={{ color: settings.primaryColor }}>{cred.url}</a>
                      <CopyBtn field="url" value={cred.url} />
                    </div>
                  ) : <span className="text-sm" style={{ color: 'var(--color-muted)' }}>—</span>}
                </Field>
                <Field icon={Tag} label="Tags">
                  {cred.tags?.length > 0 ? (
                    <div className="flex gap-1 flex-wrap">
                      {cred.tags.map(t => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>#{t}</span>
                      ))}
                    </div>
                  ) : <span className="text-sm" style={{ color: 'var(--color-muted)' }}>—</span>}
                </Field>
              </div>
            </div>

            {cred.customFields?.length > 0 && (
              <div className="rounded-2xl overflow-hidden mb-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Campos Personalizados</span>
                </div>
                <div className="px-5">
                  {cred.customFields.map(cf => (
                    <Field key={cf.id} icon={null} label={cf.name}>
                      <div className="flex items-center gap-2">
                        {cf.fieldType === 'password' ? (
                          <>
                            <span className="text-sm font-mono flex-1" style={{ color: 'var(--color-text)', letterSpacing: visibleCustomFields[cf.id] ? 'normal' : '3px' }}>
                              {visibleCustomFields[cf.id] ? cf.value : '★ ★ ★ ★ ★'}
                            </span>
                            <button onClick={() => setVisibleCustomFields(p => ({ ...p, [cf.id]: !p[cf.id] }))}
                              className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--color-muted)' }}>
                              {visibleCustomFields[cf.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        ) : cf.fieldType === 'url' ? (
                          <a href={cf.value} target="_blank" rel="noopener noreferrer"
                            className="text-sm hover:underline flex-1 truncate" style={{ color: settings.primaryColor }}>{cf.value}</a>
                        ) : (
                          <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{cf.value}</span>
                        )}
                        <CopyBtn field={`cf-${cf.id}`} value={cf.value} />
                      </div>
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {cred.notes && (
              <div className="rounded-2xl p-4 mb-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-3.5 h-3.5" style={{ color: 'var(--color-muted)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Anotações</span>
                </div>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{cred.notes}</p>
              </div>
            )}

            {cred.attachments?.length > 0 && (
              <div className="rounded-2xl overflow-hidden mb-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="px-4 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
                  <Paperclip className="w-3.5 h-3.5" style={{ color: 'var(--color-muted)' }} />
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Anexos ({cred.attachments.length})
                  </span>
                </div>
                <div className="p-2 space-y-1">
                  {cred.attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/5">
                      <Paperclip className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />
                      <span className="text-sm flex-1 truncate" style={{ color: 'var(--color-text)' }}>{att.fileName}</span>
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{(att.size / 1024).toFixed(1)} KB</span>
                      <button onClick={() => downloadAttachment(att)}
                        className="p-1.5 rounded-lg hover:bg-white/5 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cred.strength != null && (
              <div className="rounded-2xl p-4 mb-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Força da Senha</span>
                  <span className="text-xs font-semibold" style={{ color: getStrengthColor(cred.strength) }}>
                    {getStrengthLabel(cred.strength)} ({cred.strength}%)
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${cred.strength}%`, background: getStrengthColor(cred.strength) }} />
                </div>
              </div>
            )}

            {cred.expiresAt && (
              <div className="mt-4 text-xs flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{
                  background: expiryStatus === 'expired' ? '#ef444415' : expiryStatus === 'critical' ? '#f9731615' : expiryStatus === 'warning' ? '#f59e0b15' : '#10b98115',
                  color: expiryStatus === 'expired' ? '#ef4444' : expiryStatus === 'critical' ? '#f97316' : expiryStatus === 'warning' ? '#f59e0b' : '#10b981',
                }}>
                <CalendarClock className="w-3.5 h-3.5 flex-shrink-0" />
                Expira em: {new Date(cred.expiresAt).toLocaleDateString('pt-BR')}
                {expiryStatus === 'expired' && ' (EXPIRADA)'}
              </div>
            )}

            <div className="mt-3 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
              {cred.lastUsed && <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> Último uso: {new Date(cred.lastUsed).toLocaleString('pt-BR')}</div>}
              <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> Criado em: {new Date(cred.createdAt).toLocaleString('pt-BR')}</div>
            </div>
          </>
        ) : activeView === 'history' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <History className="w-4 h-4" style={{ color: settings.primaryColor }} /> Versões Anteriores de Senha
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                {history.length} versão(ões)
              </span>
            </div>
            {histLoading ? (
              <div className="flex items-center justify-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando...
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma versão anterior</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((entry, idx) => (
                  <div key={entry.id} className="rounded-xl p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                        Versão {history.length - idx}{entry.changedBy && ` • ${entry.changedBy.firstName} ${entry.changedBy.lastName}`}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{new Date(entry.changedAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono flex-1" style={{ color: 'var(--color-text)', letterSpacing: visibleHistoryPass[entry.id] ? 'normal' : '3px' }}>
                        {visibleHistoryPass[entry.id] ? (decryptedHistoryPass[entry.id] || '...') : '★ ★ ★ ★ ★'}
                      </span>
                      <button onClick={() => loadHistoryPass(entry)} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--color-muted)' }}>
                        {visibleHistoryPass[entry.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <SharesView credId={cred.id} shares={shares} sharesLoading={sharesLoading}
            refetchShares={refetchShares} settings={settings}
            showShareModal={showShareModal} setShowShareModal={setShowShareModal} />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shares View
// ────────────────────────────────────────────────────────────────────────────
function SharesView({ credId, shares, sharesLoading, refetchShares, settings, showShareModal, setShowShareModal }) {
  const qc = useQueryClient();
  const [canEdit, setCanEdit] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users').then(r => r.data),
    enabled: showShareModal,
  });

  const shareMutation = useMutation({
    mutationFn: () => api.post(`/credentials/${credId}/shares`, { sharedWithId: selectedUserId, canEdit }),
    onSuccess: () => {
      refetchShares(); qc.invalidateQueries({ queryKey: ['cred-shares', credId] });
      toast.success('Compartilhado!'); setSelectedUserId(''); setCanEdit(false); setShowShareModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao compartilhar'),
  });

  const removeMutation = useMutation({
    mutationFn: (shareId) => api.delete(`/credentials/${credId}/shares/${shareId}`),
    onSuccess: () => { refetchShares(); toast.success('Compartilhamento removido'); },
    onError: () => toast.error('Erro ao remover'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Users className="w-4 h-4" style={{ color: settings.primaryColor }} /> Compartilhado com
        </h3>
        <button onClick={() => setShowShareModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
          <Share2 className="w-3.5 h-3.5" /> Compartilhar
        </button>
      </div>

      {showShareModal && (
        <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--color-surface-2)', border: `1px solid ${settings.primaryColor}44` }}>
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--color-text)' }}>Compartilhar com usuário</p>
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-2"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <option value="">— Selecione um usuário —</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>)}
          </select>
          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={canEdit} onChange={e => setCanEdit(e.target.checked)} className="w-4 h-4" />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Permitir edição</span>
          </label>
          <div className="flex gap-2">
            <button onClick={() => setShowShareModal(false)}
              className="flex-1 py-1.5 rounded-lg text-xs hover:bg-white/5"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
            <button onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending || !selectedUserId}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
              {shareMutation.isPending ? '...' : 'Compartilhar'}
            </button>
          </div>
        </div>
      )}

      {sharesLoading ? (
        <div className="flex items-center justify-center py-8" style={{ color: 'var(--color-text-muted)' }}>
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando...
        </div>
      ) : shares.length === 0 ? (
        <div className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Não compartilhado individualmente</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shares.map(s => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                {s.sharedWith?.firstName?.[0]}{s.sharedWith?.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{s.sharedWith?.firstName} {s.sharedWith?.lastName}</p>
                <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {s.canEdit ? 'Leitura e edição' : 'Somente leitura'}
                </p>
              </div>
              <button onClick={() => removeMutation.mutate(s.id)}
                className="p-1.5 rounded-lg hover:bg-red-500/10 flex-shrink-0" style={{ color: '#ef4444' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Credential Form Modal
// ────────────────────────────────────────────────────────────────────────────
function CredentialModal({ credential, folders, onClose, defaultFolderId }) {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const isEdit = !!credential?.id;
  const fileInputRef = useRef(null);

  const [selectedTemplate, setSelectedTemplate] = useState('web');
  const [form, setForm] = useState({
    title: credential?.title || '',
    username: credential?.username || '',
    password: '',
    url: credential?.url || '',
    notes: credential?.notes || '',
    folderId: credential?.folderId || defaultFolderId || '',
    tags: credential?.tags?.join(', ') || '',
    strength: 0,
    expiresAt: credential?.expiresAt ? new Date(credential.expiresAt).toISOString().split('T')[0] : '',
  });

  const [customFields, setCustomFields] = useState(credential?.customFields?.map(cf => ({ ...cf })) || []);
  const [attachments, setAttachments] = useState(credential?.attachments?.map(a => ({ ...a, existing: true })) || []);
  const [newFiles, setNewFiles] = useState([]);
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState([]);
  const [showPass, setShowPass] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  const flatFolders = flattenFolders(folders?.shared || []).concat(
    flattenFolders(folders?.personal || []).map(f => ({ ...f, name: `🔒 ${f.name}` }))
  );

  const handlePassword = (val) => setForm(f => ({ ...f, password: val, strength: calculateStrength(val) }));
  const handleGenerate = () => { const p = generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true }); handlePassword(p); setShowPass(true); };

  const mutation = useMutation({
    mutationFn: async () => {
      const masterKey = getMasterKey();
      const encrypted = form.password ? await encryptPassword(form.password, masterKey) : null;
      const validCustomFields = customFields.filter(f => f.name.trim() && f.value.trim());
      const payload = {
        title: form.title, username: form.username || undefined,
        ...(encrypted && { encryptedPass: encrypted }),
        url: form.url || undefined, notes: form.notes || undefined,
        folderId: form.folderId,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        strength: form.strength, expiresAt: form.expiresAt || null,
        customFields: validCustomFields,
      };
      let credId;
      if (isEdit) {
        const { data } = await api.put(`/credentials/${credential.id}`, payload);
        credId = data.id;
      } else {
        const finalPayload = { ...payload, encryptedPass: payload.encryptedPass || await encryptPassword('', masterKey) };
        const { data } = await api.post('/credentials', finalPayload);
        credId = data.id;
      }
      for (const attId of deletedAttachmentIds) {
        await api.delete(`/attachments/${credId}/${attId}`).catch(() => {});
      }
      for (const file of newFiles) {
        await api.post(`/attachments/${credId}`, file).catch(err => {
          toast.error(`Erro ao enviar ${file.fileName}`);
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] });
      toast.success(isEdit ? 'Credencial atualizada!' : 'Credencial criada!');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Erro'),
  });

  const Tab = ({ id, label }) => (
    <button onClick={() => setActiveTab(id)}
      className="px-4 py-2 text-sm font-medium transition-colors rounded-lg"
      style={{ background: activeTab === id ? `${settings.primaryColor}22` : 'transparent', color: activeTab === id ? settings.primaryColor : 'var(--color-text-muted)' }}>
      {label}
    </button>
  );

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name}: máx 5MB`); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setNewFiles(prev => [...prev, { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, data: ev.target.result.split(',')[1] }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const inputStyle = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl rounded-2xl animate-fadeIn max-h-[90vh] flex flex-col"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-lg font-bold">{isEdit ? 'Editar Credencial' : 'Nova Credencial'}</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5" style={{ color: 'var(--color-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        {!isEdit && (
          <div className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <LayoutTemplate className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />
            {CREDENTIAL_TEMPLATES.map(tpl => (
              <button key={tpl.id} onClick={() => { setSelectedTemplate(tpl.id); setCustomFields(tpl.fields.length > 0 ? tpl.fields.map((f, i) => ({ ...f, sortOrder: i })) : []); }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
                style={{ background: selectedTemplate === tpl.id ? `${settings.primaryColor}22` : 'var(--color-surface-2)', color: selectedTemplate === tpl.id ? settings.primaryColor : 'var(--color-text-muted)', border: `1px solid ${selectedTemplate === tpl.id ? settings.primaryColor + '44' : 'var(--color-border)'}` }}>
                {tpl.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1 px-4 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <Tab id="basic" label="Básico" />
          <Tab id="custom" label={`Campos (${customFields.length})`} />
          <Tab id="attachments" label={`Anexos (${attachments.filter(a => !deletedAttachmentIds.includes(a.id)).length + newFiles.length})`} />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Título *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Ex: Gmail Corporativo" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pasta *</label>
                <select value={form.folderId} onChange={e => setForm(f => ({ ...f, folderId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle}>
                  <option value="">Selecione uma pasta</option>
                  {flatFolders.map(f => <option key={f.id} value={f.id}>{'  '.repeat(f.level)}{f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Usuário</label>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="usuario@empresa.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {isEdit ? 'Nova Senha (vazio = manter)' : 'Senha'}
                  </label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} value={form.password}
                      onChange={e => handlePassword(e.target.value)}
                      className="w-full pl-3 pr-16 py-2.5 rounded-xl text-sm outline-none font-mono" style={inputStyle} />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                      <button type="button" onClick={() => setShowPass(!showPass)} className="p-1 rounded" style={{ color: 'var(--color-muted)' }}>
                        {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button type="button" onClick={handleGenerate} className="p-1 rounded" style={{ color: settings.primaryColor }}>
                        <Wand2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {form.password && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${form.strength}%`, background: getStrengthColor(form.strength) }} />
                      </div>
                      <span className="text-xs" style={{ color: getStrengthColor(form.strength) }}>{form.strength}%</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>URL</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="https://exemplo.com.br" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Tags (separadas por vírgula)</label>
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="erp, financeiro, admin" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Anotações</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Data de Expiração</label>
                <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} />
                {form.expiresAt && (
                  <button onClick={() => setForm(f => ({ ...f, expiresAt: '' }))} className="text-xs mt-1 hover:underline" style={{ color: '#ef4444' }}>Remover</button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Campos extras como PIN, OTP, etc.</p>
                <button onClick={() => setCustomFields(prev => [...prev, { name: '', value: '', fieldType: 'text', sortOrder: prev.length }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
                  style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                  <PlusCircle className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>
              {customFields.length === 0 ? (
                <div className="text-center py-10 rounded-2xl" style={{ border: '2px dashed var(--color-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nenhum campo personalizado</p>
                </div>
              ) : customFields.map((cf, idx) => (
                <div key={idx} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <div className="flex gap-2">
                    <input value={cf.name} onChange={e => setCustomFields(prev => prev.map((f, i) => i === idx ? { ...f, name: e.target.value } : f))}
                      className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} placeholder="Nome do campo" />
                    <select value={cf.fieldType} onChange={e => setCustomFields(prev => prev.map((f, i) => i === idx ? { ...f, fieldType: e.target.value } : f))}
                      className="px-2 py-2 rounded-lg text-xs outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                      <option value="text">Texto</option>
                      <option value="password">Senha</option>
                      <option value="url">URL</option>
                    </select>
                    <button onClick={() => setCustomFields(prev => prev.filter((_, i) => i !== idx))} className="p-2 rounded-lg hover:bg-red-500/10" style={{ color: '#ef4444' }}>
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input value={cf.value} onChange={e => setCustomFields(prev => prev.map((f, i) => i === idx ? { ...f, value: e.target.value } : f))}
                    type={cf.fieldType === 'password' ? 'password' : 'text'}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} placeholder="Valor" />
                </div>
              ))}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Arquivos — máx. 5MB por arquivo.</p>
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
                  style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                  <Upload className="w-3.5 h-3.5" /> Enviar
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
              </div>
              {attachments.filter(a => !deletedAttachmentIds.includes(a.id)).map(att => (
                <div key={att.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <Paperclip className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{att.fileName}</div>
                    <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{(att.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button onClick={() => { setAttachments(prev => prev.filter(a => a.id !== att.id)); setDeletedAttachmentIds(prev => [...prev, att.id]); }}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 flex-shrink-0" style={{ color: '#ef4444' }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {newFiles.map((f, idx) => (
                <div key={idx} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: `${settings.primaryColor}11`, border: `1px solid ${settings.primaryColor}33` }}>
                  <Upload className="w-4 h-4 flex-shrink-0" style={{ color: settings.primaryColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{f.fileName}</div>
                    <div className="text-xs" style={{ color: settings.primaryColor }}>Novo • {(f.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button onClick={() => setNewFiles(prev => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 flex-shrink-0" style={{ color: '#ef4444' }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {attachments.filter(a => !deletedAttachmentIds.includes(a.id)).length === 0 && newFiles.length === 0 && (
                <div className="text-center py-10 rounded-2xl" style={{ border: '2px dashed var(--color-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nenhum anexo</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.title || !form.folderId}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// New Folder Modal — Visibilidade
// ────────────────────────────────────────────────────────────────────────────
function NewFolderModal({ onClose, isAdmin }) {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('personal'); // 'personal' | 'shared'

  const mutation = useMutation({
    mutationFn: () => api.post('/folders', {
      name,
      isPersonal: visibility === 'personal',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] });
      toast.success(visibility === 'personal' ? 'Pasta pessoal criada!' : 'Pasta compartilhada criada!');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Erro'),
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-base font-bold mb-4" style={{ color: 'var(--color-text)' }}>Nova Pasta</h2>

        <input value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          placeholder="Nome da pasta" autoFocus />

        <p className="text-xs mb-3 font-medium" style={{ color: 'var(--color-text-muted)' }}>Visibilidade</p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {[
            { id: 'personal', icon: '🔒', title: 'Somente para mim', desc: 'Só você verá esta pasta' },
            ...(isAdmin ? [{ id: 'shared', icon: '📁', title: 'Para todos', desc: 'Todos os usuários com permissão' }] : []),
          ].map(opt => (
            <button key={opt.id} onClick={() => setVisibility(opt.id)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-all"
              style={{
                background: visibility === opt.id ? `${settings.primaryColor}22` : 'var(--color-surface-2)',
                border: `1.5px solid ${visibility === opt.id ? settings.primaryColor : 'var(--color-border)'}`,
              }}>
              <span className="text-xl">{opt.icon}</span>
              <span className="text-xs font-semibold" style={{ color: visibility === opt.id ? settings.primaryColor : 'var(--color-text)' }}>{opt.title}</span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{opt.desc}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5 transition-colors"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? '...' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Personal Folder Rename Modal
// ────────────────────────────────────────────────────────────────────────────
function PersonalFolderRenameModal({ onClose, folder }) {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const [name, setName] = useState(folder.name);

  const mutation = useMutation({
    mutationFn: () => api.put(`/folders/${folder.id}`, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); toast.success('Pasta renomeada!'); onClose(); },
    onError: (err) => toast.error(err.response?.data?.error || 'Erro'),
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-base font-bold mb-4">Renomear Pasta</h2>
        <input value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          autoFocus />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? '...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main Vault Page
// ────────────────────────────────────────────────────────────────────────────
export default function VaultPage() {
  const settings = useSettingsStore(s => s.settings);
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'ADMINISTRADOR';
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [selectedCred, setSelectedCred] = useState(null);
  const [modalCred, setModalCred] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState(null);
  const [renamingPersonalFolder, setRenamingPersonalFolder] = useState(null);
  const [deletingPersonalFolder, setDeletingPersonalFolder] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const { data: foldersRaw = { shared: [], personal: [] } } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get('/folders').then(r => r.data),
  });

  const folders = Array.isArray(foldersRaw) ? { shared: foldersRaw, personal: [] } : foldersRaw;

  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ['credentials', selectedFolder, search],
    queryFn: () => api.get('/credentials', { params: { folderId: selectedFolder || undefined, search: search || undefined } }).then(r => r.data),
  });

  const { data: favoriteIds = [] } = useQuery({
    queryKey: ['favorite-ids'],
    queryFn: () => api.get('/favorites/ids').then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/credentials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Credencial excluída!');
      setDeleteTarget(null); setSelectedCred(null);
    },
    onError: () => toast.error('Erro ao excluir'),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id) => api.delete(`/folders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['credentials'] });
      toast.success('Pasta excluída!');
      setDeleteFolderTarget(null);
      setDeletingPersonalFolder(null);
      setSelectedFolder(prev => prev === deleteFolderTarget?.id ? null : prev);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Erro ao excluir pasta'),
  });

  const favMutation = useMutation({
    mutationFn: (credId) => {
      const isFav = favoriteIds.includes(credId);
      return isFav ? api.delete(`/favorites/${credId}`) : api.post(`/favorites/${credId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['favorite-ids'] }); qc.invalidateQueries({ queryKey: ['favorites'] }); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => { for (const id of ids) await api.delete(`/credentials/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] }); qc.invalidateQueries({ queryKey: ['folders'] });
      toast.success(`${selectedIds.size} credencial(is) excluída(s)!`);
      setSelectedIds(new Set()); setBulkMode(false); setBulkDeleteConfirm(false); setSelectedCred(null);
    },
    onError: () => toast.error('Erro ao excluir'),
  });

  const handleCredClick = (cred) => {
    if (bulkMode) { const next = new Set(selectedIds); if (next.has(cred.id)) next.delete(cred.id); else next.add(cred.id); setSelectedIds(next); return; }
    setSelectedCred(cred.id === selectedCred?.id ? null : cred);
  };

  useEffect(() => {
    if (selectedCred) {
      const updated = credentials.find(c => c.id === selectedCred.id);
      if (updated) setSelectedCred(updated);
    }
  }, [credentials]);

  const hasDetail = !!selectedCred;
  const selectedFolderObj = selectedFolder
    ? [...flattenFolders(folders.shared || []), ...flattenFolders(folders.personal || [])].find(f => f.id === selectedFolder)
    : null;

  return (
    <div className="flex h-full">
      {/* ── Folder sidebar ─────────────────────────────────────────────── */}
      <div className="w-56 flex-shrink-0 flex flex-col overflow-hidden"
        style={{ borderRight: `1px solid ${FOLDER_BORDER}`, background: FOLDER_BG }}>

        {/* "Todos" button */}
        <div style={{ padding: '10px 8px 4px' }}>
          <button
            onClick={() => { setSelectedFolder(null); setSelectedCred(null); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all"
            style={{
              background: !selectedFolder ? `${GOLD}22` : 'transparent',
              color: !selectedFolder ? GOLD_TEXT : '#7A7A77',
            }}>
            <Shield className="w-4 h-4" />
            <span>Todos</span>
            <span className="ml-auto text-xs" style={{ color: '#4A4A48' }}>{credentials.length}</span>
          </button>
        </div>

        {/* Shared folders */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 8px' }}>
          <div className="flex items-center justify-between px-3 py-2 mt-1 mb-0.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#4A4A48' }}>Pastas</span>
          </div>

          {(folders.shared || []).map(folder => (
            <FolderItem key={folder.id} folder={folder} selectedId={selectedFolder}
              onSelect={(id) => { setSelectedFolder(id); setSelectedCred(null); }}
              onDelete={(f) => setDeleteFolderTarget(f)}
              isAdmin={isAdmin} />
          ))}

          {/* Add shared folder button */}
          <button
            onClick={() => setShowNewFolderModal(true)}
            className="w-full text-left px-3 py-2 text-xs rounded-xl transition-all mt-1"
            style={{ color: '#3A3A38' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#6A6A67'; e.currentTarget.style.background = 'rgba(199,140,0,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#3A3A38'; e.currentTarget.style.background = 'transparent'; }}>
            + Criar nova pasta
          </button>

          {/* Personal folders */}
          <div className="flex items-center justify-between px-3 py-2 mt-3 mb-0.5">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1" style={{ color: '#4A4A48' }}>
              <Lock className="w-3 h-3" />Pessoal
            </span>
          </div>

          {(folders.personal || []).length === 0 ? (
            <button onClick={() => setShowNewFolderModal(true)}
              className="w-full text-left px-3 py-2 text-xs rounded-xl transition-all"
              style={{ color: '#3A3A38' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#6A6A67'; e.currentTarget.style.background = 'rgba(199,140,0,0.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#3A3A38'; e.currentTarget.style.background = 'transparent'; }}>
              + Criar pasta pessoal
            </button>
          ) : (folders.personal || []).map(folder => (
            <div key={folder.id} className="relative group">
              <FolderItem folder={folder} selectedId={selectedFolder}
                onSelect={(id) => { setSelectedFolder(id); setSelectedCred(null); }}
                onDelete={(f) => setDeletingPersonalFolder(f)}
                isAdmin={false} />
              <div className="absolute right-2 top-1 hidden group-hover:flex gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); setRenamingPersonalFolder(folder); }}
                  className="p-1 rounded hover:bg-white/10" style={{ color: '#636360' }}>
                  <Edit2 className="w-3 h-3" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); setDeletingPersonalFolder(folder); }}
                  className="p-1 rounded hover:bg-red-500/10" style={{ color: '#ef4444' }}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}

          {/* Add personal folder button */}
          {(folders.personal || []).length > 0 && (
            <button onClick={() => setShowNewFolderModal(true)}
              className="w-full text-left px-3 py-2 text-xs rounded-xl transition-all mt-0.5"
              style={{ color: '#3A3A38' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#6A6A67'; e.currentTarget.style.background = 'rgba(199,140,0,0.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#3A3A38'; e.currentTarget.style.background = 'transparent'; }}>
              + Nova pasta pessoal
            </button>
          )}
        </div>
      </div>

      {/* ── Credentials list ─────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 border-r flex flex-col overflow-hidden ${hasDetail ? 'w-64' : 'flex-1'}`}
        style={{ borderColor: 'var(--color-border)' }}>
        {/* Search + actions bar */}
        <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {!bulkMode ? (
            <>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--color-muted)' }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Pesquisar..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <button onClick={() => { setBulkMode(true); setSelectedCred(null); setSelectedIds(new Set()); }}
                className="p-2 rounded-xl hover:bg-white/5 flex-shrink-0 transition-colors"
                style={{ color: 'var(--color-muted)' }} title="Selecionar múltiplos">
                <CheckSquare className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setModalCred(null); setShowModal(true); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                <Plus className="w-3.5 h-3.5" />
                {!hasDetail && 'Novo'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { if (selectedIds.size === credentials.length) setSelectedIds(new Set()); else setSelectedIds(new Set(credentials.map(c => c.id))); }}
                className="p-1.5 rounded flex-shrink-0" style={{ color: settings.primaryColor }}>
                {selectedIds.size === credentials.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              </button>
              <span className="flex-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{selectedIds.size} selecionado(s)</span>
              {selectedIds.size > 0 && (
                <button onClick={() => setBulkDeleteConfirm(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: '#ef444422', color: '#ef4444' }}>
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              )}
              <button onClick={() => { setBulkMode(false); setSelectedIds(new Set()); }}
                className="p-1.5 rounded-lg hover:bg-white/5 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        <div className="px-4 py-1.5 text-xs" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
          {credentials.length} ite{credentials.length !== 1 ? 'ns' : 'm'}
          {bulkMode && selectedIds.size > 0 && ` • ${selectedIds.size} selecionado(s)`}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-20" style={{ color: 'var(--color-text-muted)' }}>
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
          ) : credentials.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 px-4" style={{ color: 'var(--color-text-muted)' }}>
              <Key className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs text-center">Nenhuma credencial</p>
            </div>
          ) : (
            credentials.map(cred => (
              <CredentialRow key={cred.id} cred={cred}
                isSelected={selectedCred?.id === cred.id}
                onClick={handleCredClick}
                settings={settings}
                selected={selectedIds.has(cred.id)}
                onSelect={bulkMode ? (id) => { const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else next.add(id); setSelectedIds(next); } : null} />
            ))
          )}
        </div>

        {/* [+] Nova senha dentro da pasta */}
        {selectedFolder && (
          <button
            onClick={() => { setModalCred(null); setShowModal(true); }}
            className="flex items-center justify-center gap-2 mx-3 mb-3 py-2 rounded-xl text-xs transition-all"
            style={{
              border: `1px dashed ${settings.primaryColor}55`,
              color: settings.primaryColor,
              background: `${settings.primaryColor}08`,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = settings.primaryColor; e.currentTarget.style.background = `${settings.primaryColor}15`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = `${settings.primaryColor}55`; e.currentTarget.style.background = `${settings.primaryColor}08`; }}>
            <Plus className="w-3.5 h-3.5" />
            Nova senha nesta pasta
          </button>
        )}
      </div>

      {/* ── Detail panel ─────────────────────────────────────────────────── */}
      {hasDetail && (
        <div className="flex-1 overflow-hidden">
          <CredentialDetail cred={selectedCred} settings={settings}
            isFavorite={favoriteIds.includes(selectedCred.id)}
            onEdit={(cred) => { setModalCred(cred); setShowModal(true); }}
            onDelete={(cred) => setDeleteTarget(cred)}
            onToggleFavorite={(id) => favMutation.mutate(id)}
            onClose={() => setSelectedCred(null)} />
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showModal && (
        <CredentialModal credential={modalCred} folders={folders}
          defaultFolderId={selectedFolder}
          onClose={() => { setShowModal(false); setModalCred(null); }} />
      )}

      {showNewFolderModal && (
        <NewFolderModal onClose={() => setShowNewFolderModal(false)} isAdmin={isAdmin} />
      )}

      {renamingPersonalFolder && (
        <PersonalFolderRenameModal folder={renamingPersonalFolder} onClose={() => setRenamingPersonalFolder(null)} />
      )}

      {/* Delete credential confirm */}
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
                <h3 className="font-semibold">Excluir credencial?</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deleteTarget.title}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {deleteMutation.isPending ? '...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete shared folder confirm (admin) */}
      {deleteFolderTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold">Excluir pasta?</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deleteFolderTarget.name}</p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
              Todas as credenciais desta pasta serão excluídas permanentemente.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteFolderTarget(null)} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
              <button onClick={() => deleteFolderMutation.mutate(deleteFolderTarget.id)} disabled={deleteFolderMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {deleteFolderMutation.isPending ? '...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete personal folder confirm */}
      {deletingPersonalFolder && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold">Excluir pasta pessoal?</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deletingPersonalFolder.name}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeletingPersonalFolder(null)} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
              <button onClick={() => deleteFolderMutation.mutate(deletingPersonalFolder.id)} disabled={deleteFolderMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {deleteFolderMutation.isPending ? '...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold">Excluir {selectedIds.size} credencial(is)?</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Esta ação não pode ser desfeita.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkDeleteConfirm(false)} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
              <button onClick={() => bulkDeleteMutation.mutate([...selectedIds])} disabled={bulkDeleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {bulkDeleteMutation.isPending ? 'Excluindo...' : 'Excluir tudo'}
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
