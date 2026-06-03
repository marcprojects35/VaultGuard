import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Key, Search, X, Shield, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';

const ROLES = ['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA', 'ADMINISTRADOR'];
const ROLE_COLORS = {
  AUXILIAR: '#64748b', ASSISTENTE: '#0ea5e9', ANALISTA: '#6366f1',
  COORDENACAO: '#8b5cf6', DIRETORIA: '#f59e0b', ADMINISTRADOR: '#ef4444',
};

function UserModal({ user: editUser, onClose }) {
  const { t } = useTranslation();
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const isEdit = !!editUser?.id;

  const [form, setForm] = useState({
    firstName: editUser?.firstName || '',
    lastName: editUser?.lastName || '',
    email: editUser?.email || '',
    username: editUser?.username || '',
    password: '',
    role: editUser?.role || 'AUXILIAR',
    status: editUser?.status || 'ACTIVE',
  });

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/users/${editUser.id}`, form)
      : api.post('/users', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(isEdit ? 'Usuário atualizado!' : 'Usuário criado!');
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Erro'),
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl p-6 animate-fadeIn"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">{isEdit ? t('user.editUser') : t('user.newUser')}</h2>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[['firstName', t('user.firstName')], ['lastName', t('user.lastName')]].map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
                <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </div>
            ))}
          </div>

          {[['email', t('user.email'), 'email'], ['username', t('user.username'), 'text']].map(([key, label, type]) => (
            <div key={key}>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
              <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                disabled={isEdit && key === 'email'}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none disabled:opacity-50"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </div>
          ))}

          {!isEdit && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('auth.password')}</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('user.role')}</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {ROLES.map(r => (
                  <option key={r} value={r}>{t(`user.roles.${r}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('user.status')}</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="ACTIVE">{t('user.active')}</option>
                <option value="INACTIVE">{t('user.inactive')}</option>
                <option value="PENDING">{t('user.pending')}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
            {t('common.cancel')}
          </button>
          <button onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', search, roleFilter],
    queryFn: () => api.get('/users', { params: { search: search || undefined, role: roleFilter || undefined } }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Usuário excluído!'); setDeleteTarget(null); },
    onError: err => toast.error(err.response?.data?.error || 'Erro'),
  });

  const resetPassMutation = useMutation({
    mutationFn: ({ id, password }) => api.post(`/users/${id}/reset-password`, { password }),
    onSuccess: () => toast.success('Senha redefinida!'),
    onError: () => toast.error('Erro ao redefinir senha'),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('user.title')}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {users.length} usuários cadastrados
          </p>
        </div>
        <button onClick={() => { setEditUser(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
          <Plus className="w-4 h-4" />
          {t('user.newUser')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar usuário..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <option value="">Todas as categorias</option>
          {ROLES.map(r => <option key={r} value={r}>{t(`user.roles.${r}`)}</option>)}
        </select>
      </div>

      {/* Users table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              {['Usuário', 'Categoria', 'Status', 'Último Acesso', 'Ações'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="transition-colors hover:bg-white/2"
                style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${ROLE_COLORS[u.role]}99, ${ROLE_COLORS[u.role]})` }}>
                      {u.firstName[0]}{u.lastName[0]}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{u.firstName} {u.lastName}</div>
                      <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ background: `${ROLE_COLORS[u.role]}22`, color: ROLE_COLORS[u.role] }}>
                    {t(`user.roles.${u.role}`)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : u.status === 'INACTIVE' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {t(`user.${u.status.toLowerCase()}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => { setEditUser(u); setShowModal(true); }}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--color-muted)' }}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => {
                      const pass = prompt('Nova senha para o usuário:');
                      if (pass && pass.length >= 8) resetPassMutation.mutate({ id: u.id, password: pass });
                      else if (pass) toast.error('Senha deve ter ao menos 8 caracteres');
                    }} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--color-muted)' }}>
                      <Key className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteTarget(u)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: '#ef4444' }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && !isLoading && (
          <div className="py-12 text-center" style={{ color: 'var(--color-text-muted)' }}>Nenhum usuário encontrado</div>
        )}
      </div>

      {showModal && <UserModal user={editUser} onClose={() => { setShowModal(false); setEditUser(null); }} />}

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
                <h3 className="font-semibold">{t('user.deleteUser')}</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deleteTarget.firstName} {deleteTarget.lastName}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                {t('common.cancel')}
              </button>
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600">
                {deleteMutation.isPending ? '...' : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
