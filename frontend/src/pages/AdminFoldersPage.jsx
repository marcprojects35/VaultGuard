import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Folder, FolderOpen, Plus, Edit2, Trash2, Shield,
  ChevronRight, ChevronDown, Users, User, Check, X, Save
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

const ROLES = ['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA', 'ADMINISTRADOR'];

const ROLE_LABELS = {
  AUXILIAR: 'Auxiliar',
  ASSISTENTE: 'Assistente',
  ANALISTA: 'Analista',
  COORDENACAO: 'Coordenação',
  DIRETORIA: 'Diretoria',
  ADMINISTRADOR: 'Administrador',
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

function FolderNode({ node, depth = 0, onEdit, onDelete, onPermissions }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children?.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-white/5 group`}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <button onClick={() => setOpen(!open)} className="w-4 h-4 flex items-center justify-center text-slate-500">
          {hasChildren ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3" />}
        </button>
        {open && hasChildren ? <FolderOpen size={16} className="text-amber-400" /> : <Folder size={16} className="text-amber-400/70" />}
        <span className="flex-1 text-sm text-slate-200">{node.name}</span>
        {node.description && <span className="text-xs text-slate-500 truncate max-w-[200px]">{node.description}</span>}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          <button onClick={() => onPermissions(node)} className="p-1 rounded hover:bg-[#FFB400]/20 text-[#C78C00]" title="Permissões">
            <Shield size={14} />
          </button>
          <button onClick={() => onEdit(node)} className="p-1 rounded hover:bg-blue-500/20 text-blue-400" title="Editar">
            <Edit2 size={14} />
          </button>
          <button onClick={() => onDelete(node)} className="p-1 rounded hover:bg-red-500/20 text-red-400" title="Excluir">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {open && hasChildren && node.children.map(child => (
        <FolderNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} onPermissions={onPermissions} />
      ))}
    </div>
  );
}

export default function AdminFoldersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showPermModal, setShowPermModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [permFolder, setPermFolder] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', parentId: '' });
  const [permState, setPermState] = useState({});

  const { data: foldersRaw = [] } = useQuery({
    queryKey: ['folders-admin'],
    queryFn: () => api.get('/folders').then(r => {
      // flatten tree back to array for admin
      const flatten = (items) => items.flatMap(f => [f, ...flatten(f.children || [])]);
      return flatten(r.data);
    }),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data),
  });

  const { data: permData } = useQuery({
    queryKey: ['folder-perms', permFolder?.id],
    queryFn: () => api.get(`/folders/${permFolder.id}/permissions`).then(r => r.data),
    enabled: !!permFolder,
  });

  // Load permData into permState when it arrives
  useEffect(() => {
    if (!permData) return;
    const state = {};
    permData.forEach(p => {
      if (p.role) {
        state[`role_${p.role}`] = { canView: p.canView, canEdit: p.canEdit, canDelete: p.canDelete, canShare: p.canShare };
      }
      if (p.userId) {
        state[`user_${p.userId}`] = { canView: p.canView, canEdit: p.canEdit, canDelete: p.canDelete, canShare: p.canShare };
      }
    });
    setPermState(state);
  }, [permData]);

  const createMutation = useMutation({
    mutationFn: (data) => editing ? api.put(`/folders/${editing.id}`, data) : api.post('/folders', data),
    onSuccess: () => { qc.invalidateQueries(['folders-admin']); setShowModal(false); toast.success(editing ? 'Pasta atualizada!' : 'Pasta criada!'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/folders/${id}`),
    onSuccess: () => { qc.invalidateQueries(['folders-admin']); toast.success('Pasta excluída!'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao excluir'),
  });

  const savePermMutation = useMutation({
    mutationFn: (perms) => api.put(`/folders/${permFolder.id}/permissions`, { permissions: perms }),
    onSuccess: () => { toast.success('Permissões salvas!'); setShowPermModal(false); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const tree = buildTree(foldersRaw);

  const openCreate = () => { setEditing(null); setForm({ name: '', description: '', parentId: '' }); setShowModal(true); };
  const openEdit = (f) => { setEditing(f); setForm({ name: f.name, description: f.description || '', parentId: f.parentId || '' }); setShowModal(true); };
  const openPerms = (f) => { setPermFolder(f); setPermState({}); setShowPermModal(true); };
  const confirmDelete = (f) => { if (confirm(`Excluir "${f.name}"?`)) deleteMutation.mutate(f.id); };

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
      if (p && (p.canView || p.canEdit || p.canDelete || p.canShare)) {
        perms.push({ role, ...p });
      }
    });
    users.forEach(u => {
      const p = permState[`user_${u.id}`];
      if (p && (p.canView || p.canEdit || p.canDelete || p.canShare)) {
        perms.push({ userId: u.id, ...p });
      }
    });
    savePermMutation.mutate(perms);
  };

  const PermRow = ({ label, permKey, icon }) => {
    const p = permState[permKey] || {};
    return (
      <tr className="border-b border-white/5 hover:bg-white/3">
        <td className="py-2 px-3 text-sm text-slate-300 flex items-center gap-2">{icon}{label}</td>
        {['canView', 'canEdit', 'canDelete', 'canShare'].map(f => (
          <td key={f} className="py-2 px-3 text-center">
            <button onClick={() => togglePerm(permKey, f)}
              className={`w-6 h-6 rounded flex items-center justify-center mx-auto transition-colors ${p[f] ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-slate-600 hover:bg-white/10'}`}>
              {p[f] ? <Check size={12} /> : <X size={12} />}
            </button>
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gerenciar Pastas</h1>
          <p className="text-slate-400 text-sm mt-1">Organize a estrutura hierárquica e defina permissões por cargo</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#C78C00] hover:bg-[#FFB400] text-white rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> Nova Pasta
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        {tree.length === 0
          ? <div className="text-center py-12 text-slate-500">Nenhuma pasta criada ainda.</div>
          : tree.map(node => (
            <FolderNode key={node.id} node={node} onEdit={openEdit} onDelete={confirmDelete} onPermissions={openPerms} />
          ))}
      </div>

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-white mb-4">{editing ? 'Editar Pasta' : 'Nova Pasta'}</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Nome *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]" placeholder="Nome da pasta" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Descrição</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]" placeholder="Opcional" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Pasta Pai</label>
                <select value={form.parentId} onChange={e => setForm({ ...form, parentId: e.target.value })}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#C78C00]">
                  <option value="">— Raiz —</option>
                  {foldersRaw.filter(f => f.id !== editing?.id).map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 text-sm">Cancelar</button>
              <button onClick={() => createMutation.mutate(form)} disabled={!form.name}
                className="flex-1 py-2 rounded-lg bg-[#C78C00] hover:bg-[#FFB400] text-white text-sm font-medium disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Permissões */}
      {showPermModal && permFolder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Shield size={18} className="text-[#C78C00]" /> Permissões: {permFolder.name}
              </h2>
              <button onClick={() => setShowPermModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>

            <table className="w-full">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-white/10">
                  <th className="text-left py-2 px-3">Cargo / Usuário</th>
                  <th className="text-center py-2 px-3">Ver</th>
                  <th className="text-center py-2 px-3">Editar</th>
                  <th className="text-center py-2 px-3">Excluir</th>
                  <th className="text-center py-2 px-3">Compartilhar</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-white/3"><td colSpan={5} className="py-1 px-3 text-xs text-slate-500 font-semibold uppercase tracking-wider">Por Cargo</td></tr>
                {ROLES.map(role => (
                  <PermRow key={role} label={ROLE_LABELS[role]} permKey={`role_${role}`} icon={<Users size={12} className="text-slate-500" />} />
                ))}
                {users.length > 0 && <>
                  <tr className="bg-white/3"><td colSpan={5} className="py-1 px-3 text-xs text-slate-500 font-semibold uppercase tracking-wider">Por Usuário</td></tr>
                  {users.map(u => (
                    <PermRow key={u.id} label={`${u.firstName} ${u.lastName} (${u.email})`} permKey={`user_${u.id}`} icon={<User size={12} className="text-slate-500" />} />
                  ))}
                </>}
              </tbody>
            </table>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPermModal(false)} className="flex-1 py-2 rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 text-sm">Cancelar</button>
              <button onClick={savePerms} disabled={savePermMutation.isPending} className="flex-1 py-2 rounded-lg bg-[#C78C00] hover:bg-[#FFB400] text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                <Save size={14} /> {savePermMutation.isPending ? 'Salvando...' : 'Salvar Permissões'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
