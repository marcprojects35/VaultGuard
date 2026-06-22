import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, FolderOpen, Clock, CheckCircle, XCircle, RefreshCw,
  Send, X, ChevronDown, MessageSquare, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useAuthStore, useIsAdmin } from '../stores/authStore.js';

function StatusBadge({ status }) {
  const map = {
    PENDING: { color: '#f59e0b', bg: '#f59e0b22', label: 'Pendente', icon: Clock },
    APPROVED: { color: '#10b981', bg: '#10b98122', label: 'Aprovado', icon: CheckCircle },
    REJECTED: { color: '#ef4444', bg: '#ef444422', label: 'Rejeitado', icon: XCircle },
  };
  const s = map[status] || map.PENDING;
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.color }}>
      <s.icon className="w-3 h-3" /> {s.label}
    </span>
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

function NewRequestModal({ onClose, settings }) {
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState('');
  const [message, setMessage] = useState('');

  const { data: folders = { shared: [], personal: [] } } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get('/folders').then(r => r.data),
  });

  const allFolders = flattenFolders(Array.isArray(folders) ? folders : (folders.shared || []));

  const mutation = useMutation({
    mutationFn: () => api.post('/access-requests', { folderId, message }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      toast.success('Solicitação enviada!');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao enviar'),
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl animate-fadeIn"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Solicitar Acesso a Pasta</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--color-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pasta *</label>
            <select value={folderId} onChange={e => setFolderId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">— Selecione uma pasta —</option>
              {allFolders.map(f => (
                <option key={f.id} value={f.id}>{'  '.repeat(f.level)}{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Justificativa <span style={{ color: 'var(--color-muted)' }}>(opcional)</span>
            </label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              rows={3} placeholder="Por que você precisa de acesso a esta pasta?"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm hover:bg-white/5 transition-colors"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
            Cancelar
          </button>
          <button onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !folderId}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewModal({ request, onClose, settings }) {
  const qc = useQueryClient();
  const [canEdit, setCanEdit] = useState(false);

  const mutation = useMutation({
    mutationFn: (status) => api.put(`/access-requests/${request.id}`, { status, canEdit }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      qc.invalidateQueries({ queryKey: ['security-dashboard'] });
      toast.success('Solicitação processada!');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl animate-fadeIn"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Revisar Solicitação</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--color-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {request.user?.firstName} {request.user?.lastName}
              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>({request.user?.email})</span>
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              solicita acesso à pasta <strong style={{ color: settings.primaryColor }}>{request.folder?.name}</strong>
            </p>
            {request.message && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-xs flex items-center gap-1 mb-1" style={{ color: 'var(--color-muted)' }}>
                  <MessageSquare className="w-3 h-3" /> Justificativa
                </p>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{request.message}</p>
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={canEdit} onChange={e => setCanEdit(e.target.checked)}
              className="w-4 h-4 rounded" />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Conceder permissão de edição</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Por padrão, apenas leitura é concedida</p>
            </div>
          </label>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={() => mutation.mutate('REJECTED')}
            disabled={mutation.isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            style={{ color: '#ef4444', border: '1px solid #ef444433' }}>
            <XCircle className="w-4 h-4" /> Rejeitar
          </button>
          <button onClick={() => mutation.mutate('APPROVED')}
            disabled={mutation.isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            <CheckCircle className="w-4 h-4" /> Aprovar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AccessRequestPage() {
  const settings = useSettingsStore(s => s.settings);
  const isAdmin = useIsAdmin();
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();
  const [showNewModal, setShowNewModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['access-requests', statusFilter],
    queryFn: () => api.get('/access-requests', { params: statusFilter ? { status: statusFilter } : {} }).then(r => r.data),
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => api.delete(`/access-requests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      toast.success('Solicitação cancelada.');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro'),
  });

  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Inbox className="w-6 h-6" style={{ color: settings.primaryColor }} />
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              {isAdmin ? 'Solicitações de Acesso' : 'Minhas Solicitações'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {isAdmin
                ? `${pendingCount} pedido(s) aguardando análise`
                : 'Solicite acesso a pastas compartilhadas'}
            </p>
          </div>
        </div>
        {!isAdmin && (
          <button onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            <Send className="w-4 h-4" /> Nova Solicitação
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['', 'PENDING', 'APPROVED', 'REJECTED'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: statusFilter === s ? `${settings.primaryColor}22` : 'var(--color-surface)',
              color: statusFilter === s ? settings.primaryColor : 'var(--color-text-muted)',
              border: `1px solid ${statusFilter === s ? settings.primaryColor + '44' : 'var(--color-border)'}`,
            }}>
            {s === '' ? 'Todos' : s === 'PENDING' ? 'Pendentes' : s === 'APPROVED' ? 'Aprovados' : 'Rejeitados'}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32" style={{ color: 'var(--color-text-muted)' }}>
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24" style={{ color: 'var(--color-text-muted)' }}>
          <Inbox className="w-14 h-14 mb-4 opacity-15" />
          <p className="text-base">Nenhuma solicitação encontrada</p>
          {!isAdmin && (
            <button onClick={() => setShowNewModal(true)}
              className="mt-4 text-sm hover:underline" style={{ color: settings.primaryColor }}>
              Criar primeira solicitação
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {requests.map((r, i) => (
            <div key={r.id}
              className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-white/5"
              style={{ borderBottom: i < requests.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${settings.primaryColor}22` }}>
                <FolderOpen className="w-4 h-4" style={{ color: settings.primaryColor }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {isAdmin && (
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {r.user?.firstName} {r.user?.lastName}
                        <span className="ml-1 text-xs font-normal" style={{ color: 'var(--color-muted)' }}>
                          {r.user?.email}
                        </span>
                      </p>
                    )}
                    <p className="text-sm" style={{ color: isAdmin ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                      Pasta: <strong style={{ color: settings.primaryColor }}>{r.folder?.name || r.folderId}</strong>
                    </p>
                    {r.message && (
                      <p className="text-xs mt-1 italic" style={{ color: 'var(--color-muted)' }}>"{r.message}"</p>
                    )}
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      {new Date(r.createdAt).toLocaleString('pt-BR')}
                      {r.reviewedBy && ` • Revisado por ${r.reviewedBy.firstName} ${r.reviewedBy.lastName}`}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {isAdmin && r.status === 'PENDING' && (
                  <button onClick={() => setReviewTarget(r)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                    Revisar
                  </button>
                )}
                {!isAdmin && r.status === 'PENDING' && (
                  <button onClick={() => cancelMutation.mutate(r.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                    style={{ color: '#ef4444' }}
                    title="Cancelar solicitação">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewModal && <NewRequestModal onClose={() => setShowNewModal(false)} settings={settings} />}
      {reviewTarget && <ReviewModal request={reviewTarget} onClose={() => setReviewTarget(null)} settings={settings} />}
    </div>
  );
}
