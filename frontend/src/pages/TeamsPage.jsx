import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users2, Plus, X, Check, Trash2, LogOut, UserPlus, Mail, Search, Crown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useAuthStore } from '../stores/authStore.js';

const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const inputStyle = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

function CreateTeamModal({ onClose }) {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/teams', { name, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Equipe criada!');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl p-6" style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Nova Equipe</h2>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Nome *</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Ex: Suporte N2" />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Descrição</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Opcional" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm hover:bg-[var(--color-surface-hover)]"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteUserBox({ teamId }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const { data: results = [] } = useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api.get('/users/search', { params: { q } }).then(r => r.data),
    enabled: q.trim().length >= 2,
  });

  const inviteMutation = useMutation({
    mutationFn: (userId) => api.post(`/teams/${teamId}/invite`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members', teamId] });
      toast.success('Convite enviado!');
      setQ('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao convidar'),
  });

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--color-muted)' }} />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="w-full pl-9 pr-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
      </div>
      {results.length > 0 && (
        <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {results.map(u => (
            <button key={u.id} onClick={() => inviteMutation.mutate(u.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-hover)]"
              style={{ color: 'var(--color-text)' }}>
              <UserPlus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />
              <span className="flex-1 truncate">{u.firstName} {u.lastName}</span>
              <span className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team, currentUserId, isAdmin }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const isOwner = team.owner?.id === currentUserId;

  const { data: members = [] } = useQuery({
    queryKey: ['team-members', team.id],
    queryFn: () => api.get(`/teams/${team.id}/members`).then(r => r.data),
    enabled: open,
  });

  const removeMutation = useMutation({
    mutationFn: (userId) => api.delete(`/teams/${team.id}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members', team.id] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Atualizado!');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${team.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); toast.success('Equipe excluída!'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  return (
    <div className="rounded-2xl overflow-hidden" style={cardStyle}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 p-4 text-left">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-surface-2)' }}>
          <Users2 className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{team.name}</div>
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {team.memberCount} membro{team.memberCount !== 1 ? 's' : ''} · dono: {team.owner?.firstName} {team.owner?.lastName}
          </div>
        </div>
        {(isOwner || isAdmin) && (
          <button onClick={e => { e.stopPropagation(); if (confirm(`Excluir a equipe "${team.name}"?`)) deleteMutation.mutate(); }}
            className="p-1.5 rounded hover:bg-red-500/20 flex-shrink-0" style={{ color: '#ef4444' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="pt-3 space-y-1">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
                {m.userId === team.owner?.id && <Crown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />}
                <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>
                  {m.user?.firstName} {m.user?.lastName}
                </span>
                {m.status === 'PENDING' && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f59e0b22', color: '#f59e0b' }}>convite pendente</span>
                )}
                {(isOwner || isAdmin || m.userId === currentUserId) && m.userId !== team.owner?.id && (
                  <button onClick={() => removeMutation.mutate(m.userId)}
                    className="p-1 rounded hover:bg-red-500/20" style={{ color: '#ef4444' }} title={m.userId === currentUserId ? 'Sair da equipe' : 'Remover'}>
                    {m.userId === currentUserId ? <LogOut className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            ))}
          </div>
          {(isOwner || isAdmin) && (
            <div>
              <p className="text-xs mb-1.5 font-medium" style={{ color: 'var(--color-text-muted)' }}>Convidar</p>
              <InviteUserBox teamId={team.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeamsPage() {
  const settings = useSettingsStore(s => s.settings);
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMINISTRADOR';
  const [showCreate, setShowCreate] = useState(false);

  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get('/teams').then(r => r.data),
  });

  const { data: invites = [] } = useQuery({
    queryKey: ['team-invites'],
    queryFn: () => api.get('/teams/invites').then(r => r.data),
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, accept }) => api.put(`/teams/invites/${id}`, { accept }),
    onSuccess: (_, { accept }) => {
      qc.invalidateQueries({ queryKey: ['team-invites'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success(accept ? 'Convite aceito!' : 'Convite recusado');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Equipes</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Crie equipes e convide colegas pra compartilhar pastas
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
          <Plus className="w-4 h-4" /> Nova Equipe
        </button>
      </div>

      {invites.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid #f59e0b44' }}>
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#f59e0b' }}>
            <Mail className="w-4 h-4" /> Convites Pendentes
          </p>
          {invites.map(inv => (
            <div key={inv.id} className="flex items-center gap-3 py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{inv.team?.name}</div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  convidado por {inv.invitedBy?.firstName} {inv.invitedBy?.lastName}
                </div>
              </div>
              <button onClick={() => respondMutation.mutate({ id: inv.id, accept: true })}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                style={{ background: '#10b981' }}>
                <Check className="w-3 h-3" /> Aceitar
              </button>
              <button onClick={() => respondMutation.mutate({ id: inv.id, accept: false })}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                <X className="w-3 h-3" /> Recusar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {teams.length === 0 ? (
          <div className="py-14 text-center rounded-2xl" style={{ ...cardStyle, borderStyle: 'dashed' }}>
            <Users2 className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-muted)', opacity: 0.4 }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Você ainda não faz parte de nenhuma equipe.</p>
          </div>
        ) : (
          teams.map(t => <TeamCard key={t.id} team={t} currentUserId={user?.id} isAdmin={isAdmin} />)
        )}
      </div>

      {showCreate && <CreateTeamModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
