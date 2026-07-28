import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Edit2, Trash2, X, Save, ArrowUp, ArrowDown, ShieldCheck, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useSettingsStore } from '../stores/settingsStore';

const COLOR_PALETTE = [
  '#64748b', '#0ea5e9', '#6366f1', '#8b5cf6',
  '#f59e0b', '#ef4444', '#10b981', '#ec4899',
];

export default function AdminRolesPage() {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ label: '', color: COLOR_PALETTE[0] });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reassignTo, setReassignTo] = useState('');

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then(r => r.data),
  });

  const inputStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const createMutation = useMutation({
    mutationFn: (data) => editing
      ? api.put(`/roles/${editing.key}`, data)
      : api.post('/roles', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setShowModal(false);
      toast.success(editing ? 'Classificação atualizada!' : 'Classificação criada!');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const priorityMutation = useMutation({
    mutationFn: ({ key, direction }) => api.put(`/roles/${key}/priority`, { direction }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ key, reassignTo }) => api.delete(`/roles/${key}`, { data: reassignTo ? { reassignTo } : {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Classificação excluída!');
      setDeleteTarget(null);
      setReassignTo('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao excluir'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ label: '', color: COLOR_PALETTE[0] });
    setShowModal(true);
  };
  const openEdit = (role) => {
    setEditing(role);
    setForm({ label: role.label, color: role.color || COLOR_PALETTE[0] });
    setShowModal(true);
  };
  const openDelete = (role) => {
    setDeleteTarget(role);
    setReassignTo('');
  };

  const nonProtectedOptions = roles.filter(r => r.key !== deleteTarget?.key);
  const usersInDeleteTarget = deleteTarget?._count?.users || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Classificações</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Crie, edite ou exclua os cargos disponíveis pra atribuir aos usuários
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
          <Plus className="w-4 h-4" /> Nova Classificação
        </button>
      </div>

      <div className="rounded-2xl p-2" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        {isLoading ? (
          <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>Carregando...</div>
        ) : (
          roles.map((role, idx) => (
            <div key={role.key}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ borderBottom: idx < roles.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: role.color || '#64748b' }} />
              <Tag className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{role.label}</span>
                  {role.isProtected && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                      <ShieldCheck className="w-3 h-3" /> Protegido
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{role.key}</span>
              </div>

              <div className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                <Users className="w-3.5 h-3.5" /> {role._count?.users ?? 0}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => priorityMutation.mutate({ key: role.key, direction: 'up' })}
                  disabled={role.isProtected || idx === 0 || roles[idx - 1]?.isProtected}
                  className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] disabled:opacity-20"
                  style={{ color: 'var(--color-muted)' }} title="Subir prioridade">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => priorityMutation.mutate({ key: role.key, direction: 'down' })}
                  disabled={role.isProtected || idx === roles.length - 1 || roles[idx + 1]?.isProtected}
                  className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] disabled:opacity-20"
                  style={{ color: 'var(--color-muted)' }} title="Descer prioridade">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                {!role.isProtected && (
                  <>
                    <button onClick={() => openEdit(role)}
                      className="p-1.5 rounded hover:bg-[var(--color-surface-hover)]" title="Editar"
                      style={{ color: '#60a5fa' }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => openDelete(role)}
                      className="p-1.5 rounded hover:bg-red-500/20" title="Excluir"
                      style={{ color: '#ef4444' }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="w-full max-w-md rounded-2xl p-6 animate-fadeIn"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
              {editing ? 'Editar Classificação' : 'Nova Classificação'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Nome *</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle} placeholder="Ex: Gerente de TI" />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLOR_PALETTE.map(c => (
                    <button key={c} onClick={() => setForm({ ...form, color: c })}
                      className="w-8 h-8 rounded-full flex-shrink-0 transition-transform"
                      style={{
                        background: c,
                        transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
                        outline: form.color === c ? `2px solid ${c}` : 'none',
                        outlineOffset: '2px',
                      }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-[var(--color-surface-hover)]"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cancelar
              </button>
              <button onClick={() => createMutation.mutate(form)} disabled={!form.label || createMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                <Save className="w-4 h-4" />
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
                <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>Excluir classificação?</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{deleteTarget.label}</p>
              </div>
            </div>

            {usersInDeleteTarget > 0 ? (
              <>
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-muted)' }}>
                  {usersInDeleteTarget} usuário{usersInDeleteTarget !== 1 ? 's' : ''} está{usersInDeleteTarget !== 1 ? 'ão' : ''} nesta
                  classificação. Escolha pra qual classificação eles devem ser movidos antes de excluir:
                </p>
                <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-5"
                  style={inputStyle}>
                  <option value="">— Selecione uma classificação —</option>
                  {nonProtectedOptions.map(r => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
                Esta ação não pode ser desfeita.
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm hover:bg-[var(--color-surface-hover)]"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate({ key: deleteTarget.key, reassignTo: reassignTo || undefined })}
                disabled={deleteMutation.isPending || (usersInDeleteTarget > 0 && !reassignTo)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
