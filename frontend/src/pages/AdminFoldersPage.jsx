import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Folder, FolderOpen, Plus, Edit2, Trash2, Shield, Lock,
  ChevronRight, ChevronDown, Users, User, Check, X, Save
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useSettingsStore } from '../stores/settingsStore';

const ROLES = ['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA', 'ADMINISTRADOR'];
const ROLE_LABELS = {
  AUXILIAR: 'Auxiliar', ASSISTENTE: 'Assistente', ANALISTA: 'Analista',
  COORDENACAO: 'Coordenação', DIRETORIA: 'Diretoria', ADMINISTRADOR: 'Administrador',
};

function buildTree(folders) {
  const map = {};
  const roots = [];
  folders.forEach(f => (map[f.id] = { ...f, children: [] }));
  folders.forEach(f => {
    if (f.parentId && map[f.parentId]) map[f.parentId].children.push(map[f.id]);
    else roots.push(map[f.id]);
  });
  return roots;
}

function flattenTree(tree) {
  const result = [];
  for (const node of tree) {
    result.push(node);
    if (node.children?.length) result.push(...flattenTree(node.children));
  }
  return result;
}

function FolderNode({ node, depth = 0, onEdit, onDelete, onPermissions, isPersonal }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children?.length > 0;
  const settings = useSettingsStore(s => s.settings);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-white/5 group"
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <button onClick={() => setOpen(!open)} className="w-4 h-4 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
          {hasChildren ? (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
        </button>
        {isPersonal ? (
          <Lock className="w-4 h-4 flex-shrink-0" style={{ color: '#8b5cf6' }} />
        ) : (
          open && hasChildren
            ? <FolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: settings.primaryColor }} />
            : <Folder className="w-4 h-4 flex-shrink-0" style={{ color: `${settings.primaryColor}90` }} />
        )}
        <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{node.name}</span>
        {node.description && (
          <span className="text-xs truncate max-w-[200px]" style={{ color: 'var(--color-muted)' }}>
            {node.description}
          </span>
        )}
        {isPersonal && (
          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#8b5cf622', color: '#8b5cf6' }}>
            pessoal
          </span>
        )}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          {!isPersonal && (
            <button onClick={() => onPermissions(node)}
              className="p-1 rounded hover:bg-white/10" title="Permissões"
              style={{ color: settings.primaryColor }}>
              <Shield className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => onEdit(node)}
            className="p-1 rounded hover:bg-white/10" title="Editar"
            style={{ color: '#60a5fa' }}>
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(node)}
            className="p-1 rounded hover:bg-red-500/20" title="Excluir"
            style={{ color: '#ef4444' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {open && hasChildren && node.children.map(child => (
        <FolderNode key={child.id} node={child} depth={depth + 1}
          onEdit={onEdit} onDelete={onDelete} onPermissions={onPermissions} isPersonal={isPersonal} />
      ))}
    </div>
  );
}

export default function AdminFoldersPage() {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showPermModal, setShowPermModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [permFolder, setPermFolder] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', parentId: '' });
  const [permState, setPermState] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeTab, setActiveTab] = useState('shared');

  const { data: foldersRaw = { shared: [], personal: [] } } = useQuery({
    queryKey: ['folders-admin'],
    queryFn: () => api.get('/folders/admin-all').then(r => r.data),
  });

  const foldersData = Array.isArray(foldersRaw)
    ? { shared: foldersRaw, personal: [] }
    : foldersRaw;

  const sharedFlat = flattenTree(foldersData.shared || []);
  const personalFlat = flattenTree(foldersData.personal || []);
  const allFlat = [...sharedFlat, ...personalFlat];

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data),
  });

  const { data: permData } = useQuery({
    queryKey: ['folder-perms', permFolder?.id],
    queryFn: () => api.get(`/folders/${permFolder.id}/permissions`).then(r => r.data),
    enabled: !!permFolder,
  });

  useEffect(() => {
    if (!permData) return;
    const state = {};
    permData.forEach(p => {
      if (p.role) state[`role_${p.role}`] = { canView: p.canView, canEdit: p.canEdit, canDelete: p.canDelete, canShare: p.canShare };
      if (p.userId) state[`user_${p.userId}`] = { canView: p.canView, canEdit: p.canEdit, canDelete: p.canDelete, canShare: p.canShare };
    });
    setPermState(state);
  }, [permData]);

  const createMutation = useMutation({
    mutationFn: (data) => editing ? api.put(`/folders/${editing.id}`, data) : api.post('/folders', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders-admin'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      setShowModal(false);
      toast.success(editing ? 'Pasta atualizada!' : 'Pasta criada!');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/folders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders-admin'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Pasta excluída!');
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao excluir'),
  });

  const savePermMutation = useMutation({
    mutationFn: (perms) => api.put(`/folders/${permFolder.id}/permissions`, { permissions: perms }),
    onSuccess: () => { toast.success('Permissões salvas!'); setShowPermModal(false); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const sharedTree = foldersData.shared || [];
  const personalTree = foldersData.personal || [];

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', parentId: '' });
    setShowModal(true);
  };
  const openEdit = (f) => {
    setEditing(f);
    setForm({ name: f.name, description: f.description || '', parentId: f.parentId || '' });
    setShowModal(true);
  };
  const openPerms = (f) => { setPermFolder(f); setPermState({}); setShowPermModal(true); };
  const confirmDelete = (f) => setDeleteTarget(f);

  const togglePerm = (key, field) => {
    setPermState(prev => ({
      ...prev,
      [key]: { canView: false, canEdit: false, canDelete: false, canShare: false, ...(prev[key] || {}), [field]: !(prev[key]?.[field]) }
    }));
  };

  const savePerms = () => {
    const perms = [];
    ROLES.forEach(role => {
      const p = permState[`role_${role}`];
      if (p && (p.canView || p.canEdit || p.canDelete || p.canShare)) perms.push({ role, ...p });
    });
    users.forEach(u => {
      const p = permState[`user_${u.id}`];
      if (p && (p.canView || p.canEdit || p.canDelete || p.canShare)) perms.push({ userId: u.id, ...p });
    });
    savePermMutation.mutate(perms);
  };

  const inputStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const PermRow = ({ label, permKey, icon }) => {
    const p = permState[permKey] || {};
    return (
      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
        <td className="py-2 px-3 text-sm flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>{icon}{label}</td>
        {['canView', 'canEdit', 'canDelete', 'canShare'].map(f => (
          <td key={f} className="py-2 px-3 text-center">
            <button onClick={() => togglePerm(permKey, f)}
              className="w-6 h-6 rounded flex items-center justify-center mx-auto transition-colors"
              style={{ background: p[f] ? '#10b98122' : 'var(--color-surface-2)', color: p[f] ? '#10b981' : 'var(--color-muted)' }}>
              {p[f] ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            </button>
          </td>
        ))}
      </tr>
    );
  };

  const TABS = [
    { id: 'shared', label: 'Pastas Compartilhadas' },
    { id: 'personal', label: 'Pastas Pessoais' },
  ];

  const currentTree = activeTab === 'shared' ? sharedTree : personalTree;
  const isEmpty = currentTree.length === 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Gerenciar Pastas</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Organize a estrutura hierárquica e defina permissões por cargo
          </p>
        </div>
        {activeTab === 'shared' && (
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            <Plus className="w-4 h-4" /> Nova Pasta
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2.5 text-sm font-medium transition-colors border-b-2"
            style={{
              color: activeTab === tab.id ? settings.primaryColor : 'var(--color-text-muted)',
              borderBottomColor: activeTab === tab.id ? settings.primaryColor : 'transparent',
            }}>
            {tab.label}
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>
              {activeTab === tab.id ? currentTree.length : (activeTab === 'shared' ? personalTree.length : sharedTree.length)}
            </span>
          </button>
        ))}
      </div>

      {/* Folder tree */}
      <div className="rounded-2xl p-4" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        {isEmpty ? (
          <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
            {activeTab === 'shared'
              ? 'Nenhuma pasta compartilhada criada ainda.'
              : 'Nenhuma pasta pessoal de usuários.'}
          </div>
        ) : (
          currentTree.map(node => (
            <FolderNode key={node.id} node={node}
              onEdit={openEdit}
              onDelete={confirmDelete}
              onPermissions={openPerms}
              isPersonal={activeTab === 'personal'} />
          ))
        )}
      </div>

      {/* Modal Criar/Editar pasta compartilhada */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="w-full max-w-md rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {editing ? 'Editar Pasta' : 'Nova Pasta Compartilhada'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Nome *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle} placeholder="Nome da pasta" />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Descrição</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle} placeholder="Opcional" />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pasta Pai</label>
                <select value={form.parentId} onChange={e => setForm({ ...form, parentId: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}>
                  <option value="">— Raiz —</option>
                  {sharedFlat.filter(f => f.id !== editing?.id).map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cancelar
              </button>
              <button onClick={() => createMutation.mutate(form)} disabled={!form.name || createMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                {createMutation.isPending ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>Excluir pasta?</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deleteTarget.name}</p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
              Esta ação excluirá a pasta e todas as credenciais dentro dela permanentemente.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cancelar
              </button>
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Permissões */}
      {showPermModal && permFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Shield className="w-5 h-5" style={{ color: settings.primaryColor }} />
                Permissões: {permFolder.name}
              </h2>
              <button onClick={() => setShowPermModal(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Cargo / Usuário</th>
                  {['Ver', 'Editar', 'Excluir', 'Compartilhar'].map(h => (
                    <th key={h} className="text-center py-2 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: 'var(--color-surface-2)' }}>
                  <td colSpan={5} className="py-1 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Por Cargo</td>
                </tr>
                {ROLES.map(role => (
                  <PermRow key={role} label={ROLE_LABELS[role]} permKey={`role_${role}`}
                    icon={<Users className="w-3 h-3 mr-1 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />} />
                ))}
                {users.length > 0 && (
                  <>
                    <tr style={{ background: 'var(--color-surface-2)' }}>
                      <td colSpan={5} className="py-1 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Por Usuário</td>
                    </tr>
                    {users.map(u => (
                      <PermRow key={u.id} label={`${u.firstName} ${u.lastName} (${u.email})`}
                        permKey={`user_${u.id}`}
                        icon={<User className="w-3 h-3 mr-1 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />} />
                    ))}
                  </>
                )}
              </tbody>
            </table>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPermModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cancelar
              </button>
              <button onClick={savePerms} disabled={savePermMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                <Save className="w-4 h-4" />
                {savePermMutation.isPending ? 'Salvando...' : 'Salvar Permissões'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
