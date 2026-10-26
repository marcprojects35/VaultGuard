import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, RotateCcw, Search, KeyRound, FolderOpen, AlertTriangle, CheckSquare, Square, X, FileBadge } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useIsAdmin } from '../stores/authStore.js';

const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const inputStyle = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const keyOf = (i) => `${i.type}:${i.id}`;

function Person({ info, fallback = '—' }) {
  if (!info) return <span style={{ color: 'var(--color-muted)' }}>{fallback}</span>;
  return (
    <div>
      <div style={{ color: 'var(--color-text)' }}>{info.user?.name || 'Não registrado'}</div>
      <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{fmt(info.at)}</div>
    </div>
  );
}

function ConfirmModal({ title, text, confirmLabel, danger, onConfirm, onClose, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={cardStyle}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(var(--color-primary-rgb),0.13)' }}>
            {danger ? <AlertTriangle className="w-5 h-5" style={{ color: '#ef4444' }} /> : <RotateCcw className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />}
          </div>
          <div>
            <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{text}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
          <button onClick={onConfirm} disabled={busy} data-testid="confirm-action"
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: danger ? '#dc2626' : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}>
            {busy ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TrashPage() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [confirm, setConfirm] = useState(null); // { kind: 'purge'|'empty'|'restore', items }

  const { data = { items: [], retentionDays: 30 }, isLoading } = useQuery({
    queryKey: ['trash', type, search],
    queryFn: () => api.get('/trash', { params: { type: type || undefined, search: search || undefined } }).then(r => r.data),
  });
  const items = data.items;
  const chosen = items.filter(i => selected.has(keyOf(i)));

  const refresh = () => {
    setSelected(new Set());
    setConfirm(null);
    ['trash', 'credentials', 'folders', 'admin-folders'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  };
  const report = (done, failed, verb) => {
    if (done) toast.success(`${done} item(ns) ${verb}`);
    failed?.forEach(f => toast.error(f.error, { duration: 6000 }));
  };

  const restore = useMutation({
    mutationFn: (list) => api.post('/trash/restore', { items: list.map(i => ({ type: i.type, id: i.id })) }),
    onSuccess: ({ data }) => { report(data.restored, data.failed, 'restaurado(s)'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível restaurar'),
  });
  const purge = useMutation({
    mutationFn: (payload) => api.post('/trash/purge', payload),
    onSuccess: ({ data }) => { report(data.purged, data.failed, 'excluído(s) definitivamente'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível excluir'),
  });

  const toggle = (i) => setSelected(s => { const n = new Set(s); n.has(keyOf(i)) ? n.delete(keyOf(i)) : n.add(keyOf(i)); return n; });
  const allChecked = items.length > 0 && chosen.length === items.length;

  const runConfirm = () => {
    if (confirm.kind === 'restore') restore.mutate(confirm.items);
    else if (confirm.kind === 'empty') purge.mutate({ all: true });
    else purge.mutate({ items: confirm.items.map(i => ({ type: i.type, id: i.id })) });
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Trash2 className="w-6 h-6" style={{ color: 'var(--color-primary)' }} /> Lixeira
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {isAdmin
            ? 'Senhas e pastas excluídas de todo o sistema, com quem excluiu, quem criou e quem editou por último. Restaure ou exclua de vez — um item, vários ou todos.'
            : 'Senhas e pastas que você excluiu da sua pasta pessoal. Itens das pastas compartilhadas são recuperados pelo administrador.'}
          {' '}{data.retentionDays > 0
            ? `Itens ficam aqui por ${data.retentionDays} dia(s) e depois são apagados de vez automaticamente.`
            : 'Itens ficam aqui até alguém excluir de vez (sem prazo automático).'}
          {isAdmin && ' O prazo é definido em Configurações › Dados e retenção.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, usuário ou site"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} />
        </div>
        <select value={type} onChange={e => { setType(e.target.value); setSelected(new Set()); }} className="px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} data-testid="trash-type">
          <option value="">Senhas e pastas</option>
          <option value="credential">Só senhas</option>
          <option value="folder">Só pastas</option>
        </select>
        <button onClick={() => setConfirm({ kind: 'empty' })} disabled={!items.length} data-testid="empty-trash"
          className="px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40" style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}>
          Esvaziar lixeira
        </button>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(var(--color-primary-rgb),0.08)', border: '1px solid rgba(var(--color-primary-rgb),0.25)' }}>
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>{chosen.length} selecionado(s)</span>
          <button onClick={() => setConfirm({ kind: 'restore', items: chosen })} data-testid="restore-selected"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}>
            <RotateCcw className="w-3.5 h-3.5" /> Restaurar
          </button>
          <button onClick={() => setConfirm({ kind: 'purge', items: chosen })} data-testid="purge-selected"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}>
            <Trash2 className="w-3.5 h-3.5" /> Excluir definitivamente
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <X className="w-3.5 h-3.5" /> Limpar seleção
          </button>
        </div>
      )}

      <div className="rounded-2xl overflow-x-auto" style={cardStyle}>
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="p-3 w-10">
                <button onClick={() => setSelected(allChecked ? new Set() : new Set(items.map(keyOf)))} title="Marcar todos" data-testid="select-all"
                  style={{ color: 'var(--color-primary)' }}>
                  {allChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              </th>
              {['Item', 'Onde estava', 'Excluído por', 'Última edição', 'Criado por', 'Apagado de vez em', ''].map(h => (
                <th key={h} className="text-left p-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="p-8 text-center" style={{ color: 'var(--color-muted)' }}>Carregando...</td></tr>}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={8} className="p-10 text-center" style={{ color: 'var(--color-muted)' }}>A lixeira está vazia</td></tr>
            )}
            {items.map(i => {
              const Icon = i.type === 'folder' ? FolderOpen : i.kind === 'certificate' ? FileBadge : KeyRound;
              return (
                <tr key={keyOf(i)} style={{ borderBottom: '1px solid var(--color-border)' }} data-testid={`trash-row-${i.name}`}>
                  <td className="p-3">
                    <button onClick={() => toggle(i)} style={{ color: 'var(--color-primary)' }} data-testid="row-check">
                      {selected.has(keyOf(i)) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="flex items-start gap-2">
                      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
                      <div className="min-w-0">
                        <div className="font-medium truncate" style={{ color: 'var(--color-text)' }}>{i.name}</div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
                          {i.type === 'folder' ? `Pasta · ${i.contains} senha(s) dentro` : [i.username, i.url].filter(Boolean).join(' · ') || 'Senha'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3" style={{ color: 'var(--color-text-muted)' }}>
                    {i.location}
                    {i.folderInTrash && <div className="text-[11px]" style={{ color: 'var(--color-warning)' }}>a pasta também está na lixeira</div>}
                  </td>
                  <td className="p-3">
                    <Person info={{ user: i.deletedBy, at: i.deletedAt }} />
                    {i.deletedBy?.email && <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{i.deletedBy.email}</div>}
                  </td>
                  <td className="p-3"><Person info={i.lastEdit} fallback="Nunca editado" /></td>
                  <td className="p-3"><Person info={i.created} /></td>
                  <td className="p-3" style={{ color: 'var(--color-text-muted)' }}>{i.expiresAt ? fmt(i.expiresAt) : 'Sem prazo'}</td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => restore.mutate([i])} title="Restaurar" data-testid="restore-one"
                        className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)]" style={{ color: 'var(--color-primary)' }}>
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirm({ kind: 'purge', items: [i] })} title="Excluir definitivamente" data-testid="purge-one"
                        className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)]" style={{ color: '#ef4444' }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <ConfirmModal
          busy={restore.isPending || purge.isPending}
          danger={confirm.kind !== 'restore'}
          title={confirm.kind === 'restore' ? `Restaurar ${confirm.items.length} item(ns)?`
            : confirm.kind === 'empty' ? 'Esvaziar a lixeira?' : `Excluir ${confirm.items.length} item(ns) definitivamente?`}
          text={confirm.kind === 'restore'
            ? 'Os itens voltam para onde estavam, com o mesmo conteúdo. Pastas voltam com as subpastas e senhas que tinham.'
            : `${confirm.kind === 'empty' ? `Todos os ${items.length} item(ns) da lixeira serão apagados` : 'Os itens serão apagados'} para sempre, com anexos e histórico de versões. Não dá para desfazer.`}
          confirmLabel={confirm.kind === 'restore' ? 'Restaurar' : 'Excluir definitivamente'}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}
