import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Network, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// "Onde vale este cargo": em quais grupos o cargo tem regra própria (ex.:
// Diretor no grupo Infra e Diretor no grupo RH), quais pastas do grupo vê e o
// que pode fazer nelas. Vale para os membros do grupo que têm esse cargo.
const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const inputStyle = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const PERMS = [['canEdit', 'Editar'], ['canDelete', 'Excluir'], ['canShare', 'Compartilhar']];

function Chip({ on, label, onClick, testId }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testId}
      className="text-xs px-2.5 py-1 rounded-full border"
      style={on
        ? { background: 'rgba(var(--color-primary-rgb),0.13)', borderColor: 'rgba(var(--color-primary-rgb),0.4)', color: 'var(--color-primary)' }
        : { borderColor: 'var(--color-border)', color: 'var(--color-muted)', textDecoration: 'line-through' }}>
      {label}
    </button>
  );
}

export default function RoleScopesModal({ role, onClose }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(null);
  const { data: saved, isLoading } = useQuery({ queryKey: ['role-scopes', role.key], queryFn: () => api.get(`/roles/${role.key}/scopes`).then(r => r.data) });
  const { data: teams = [] } = useQuery({ queryKey: ['admin-groups'], queryFn: () => api.get('/teams', { params: { all: 'true' } }).then(r => r.data) });
  const { data: folders = [] } = useQuery({
    queryKey: ['admin-all-folders'],
    queryFn: () => api.get('/folders/admin-all').then(r => {
      const flat = (list) => list.flatMap(f => [f, ...flat(f.children || [])]);
      return flat(r.data.shared || []);
    }),
  });
  useEffect(() => {
    if (saved && rows === null) setRows(saved.map(sc => ({ teamId: sc.teamId, folderIds: sc.folderIds, canEdit: sc.canEdit, canDelete: sc.canDelete, canShare: sc.canShare })));
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.put(`/roles/${role.key}/scopes`, { scopes: rows }),
    onSuccess: () => {
      toast.success('Onde o cargo vale foi salvo');
      qc.invalidateQueries({ queryKey: ['role-scopes', role.key] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível salvar'),
  });

  const list = rows || [];
  const update = (i, patch) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const freeTeams = teams.filter(t => !list.some(r => r.teamId === t.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto" style={cardStyle} data-testid="role-scopes-modal">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Network className="w-5 h-5" style={{ color: 'var(--color-primary)' }} /> Onde vale: {role.label}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Escolha os grupos em que o cargo tem regra própria. Ex.: {role.label} do grupo Infra vê todas as pastas e exclui; {role.label} do grupo RH vê só a pasta
          Contratos e só edita. Vale para quem tem esse cargo e é membro do grupo. Grupos fora da lista seguem o padrão do grupo. O ajuste individual de um membro
          (tela Grupos) e as permissões gerais do cargo continuam valendo por cima.
        </p>

        {isLoading || rows === null ? (
          <div className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}><Loader className="w-4 h-4 inline animate-spin" /> Carregando...</div>
        ) : (
          <div className="space-y-3">
            {list.length === 0 && <div className="text-sm py-4 text-center rounded-xl border border-dashed border-[var(--color-border)]" style={{ color: 'var(--color-muted)' }}>Nenhum grupo ainda</div>}
            {list.map((r, i) => {
              const team = teams.find(t => t.id === r.teamId);
              const teamFolders = folders.filter(f => f.teamId === r.teamId);
              return (
                <div key={r.teamId} className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)' }} data-testid={`scope-${team?.name}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{role.label} do grupo {team?.name || '—'}</div>
                    <button type="button" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} title="Tirar este grupo" style={{ color: '#ef4444' }}><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>O que pode fazer</div>
                    <div className="flex flex-wrap gap-2">
                      <Chip on label="Ver" onClick={() => {}} />
                      {PERMS.map(([k, label]) => <Chip key={k} on={r[k]} label={label} testId={`scope-${k}`} onClick={() => update(i, { [k]: !r[k] })} />)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Quais pastas do grupo vê</div>
                    {teamFolders.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>O grupo ainda não tem pastas (valerá para todas).</p> : (
                      <div className="flex flex-wrap gap-2">
                        <Chip on={r.folderIds.length === 0} label="Todas" onClick={() => update(i, { folderIds: [] })} />
                        {teamFolders.map(f => (
                          <Chip key={f.id} on={r.folderIds.includes(f.id)} label={f.name} testId={`scope-folder-${f.name}`}
                            onClick={() => update(i, { folderIds: r.folderIds.includes(f.id) ? r.folderIds.filter(x => x !== f.id) : [...r.folderIds, f.id] })} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {freeTeams.length > 0 && (
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                <select value="" onChange={e => e.target.value && setRows(rs => [...rs, { teamId: e.target.value, folderIds: [], canEdit: true, canDelete: false, canShare: false }])}
                  className="flex-1 px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} data-testid="scope-add-team">
                  <option value="">Adicionar grupo...</option>
                  {freeTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || rows === null} data-testid="scope-save"
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
            {save.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
