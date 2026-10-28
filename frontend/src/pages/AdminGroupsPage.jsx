import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users2, Plus, X, Trash2, ChevronDown, ChevronRight, Crown, UserPlus, Search, Server, RefreshCw, KeyRound, Smartphone, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';

const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const inputStyle = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const primaryBtn = { background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' };

// Permissões dos membros nas pastas do grupo
const PERMS = [
  { key: 'canEdit', team: 'memberCanEdit', label: 'Editar' },
  { key: 'canDelete', team: 'memberCanDelete', label: 'Excluir' },
  { key: 'canShare', team: 'memberCanShare', label: 'Compartilhar' },
];

const fullName = (u) => u ? `${u.firstName} ${u.lastName}`.trim() || u.email : '—';

function Toggle({ on, onClick, label, testId, disabled, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} data-testid={testId} title={title}
      className="text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50"
      style={on
        ? { background: 'rgba(var(--color-primary-rgb),0.13)', borderColor: 'rgba(var(--color-primary-rgb),0.4)', color: 'var(--color-primary)' }
        : { borderColor: 'var(--color-border)', color: 'var(--color-muted)', textDecoration: 'line-through' }}>
      {label}
    </button>
  );
}

// Seleção de usuários com busca (lista vinda de /users, só ativos)
function UserPicker({ users, selected, onChange, exclude = [] }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const options = users.filter(u => !exclude.includes(u.id) && !selected.includes(u.id)
    && (!term || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(term))).slice(0, 8);
  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(id => {
            const u = users.find(x => x.id === id);
            return (
              <span key={id} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>
                {fullName(u)}
                <button type="button" onClick={() => onChange(selected.filter(x => x !== id))} style={{ color: 'var(--color-muted)' }}><X className="w-3 h-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar pessoa por nome ou e-mail"
          className="w-full pl-8 pr-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} data-testid="user-picker" />
      </div>
      {term && (
        <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {options.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>Ninguém encontrado</div>}
          {options.map(u => (
            <button key={u.id} type="button" onClick={() => { onChange([...selected, u.id]); setQ(''); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)]" style={{ color: 'var(--color-text)' }}>
              {fullName(u)} <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateGroupModal({ users, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', ownerId: '', memberIds: [], memberCanEdit: true, memberCanDelete: false, memberCanShare: false });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => api.post('/teams', { ...form, ownerId: form.ownerId || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
      toast.success('Grupo criado');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao criar o grupo'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl p-6 max-h-[90vh] overflow-y-auto" style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Novo grupo</h2>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Nome *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} autoFocus maxLength={100} data-testid="group-name"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Ex.: Financeiro" />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Descrição</label>
            <input value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} placeholder="Opcional" />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Responsável (dono)</label>
            <select value={form.ownerId} onChange={e => set('ownerId', e.target.value)} data-testid="group-owner"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle}>
              <option value="">Eu</option>
              {users.map(u => <option key={u.id} value={u.id}>{fullName(u)} — {u.email}</option>)}
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>O dono tem todas as permissões nas pastas do grupo.</p>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Membros (entram direto, sem convite)</label>
            <UserPicker users={users} selected={form.memberIds} onChange={v => set('memberIds', v)} exclude={[form.ownerId]} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>O que os membros podem fazer nas pastas do grupo</label>
            <div className="flex gap-2">
              {PERMS.map(p => <Toggle key={p.key} on={form[p.team]} label={p.label} onClick={() => set(p.team, !form[p.team])} />)}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
          <button onClick={() => create.mutate()} disabled={!form.name.trim() || create.isPending} data-testid="group-create"
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={primaryBtn}>
            {create.isPending ? 'Criando...' : 'Criar grupo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Política das senhas guardadas nas pastas do grupo (tamanho, complexidade, validade)
const POLICY_DEFAULT = { enabled: true, minLength: 12, requireUppercase: true, requireNumbers: true, requireSymbols: false, expireDays: 0, folderIds: [] };

function PolicyEditor({ team, folders, onSave, saving }) {
  const [p, setP] = useState(() => ({ ...POLICY_DEFAULT, ...(team.passwordPolicy || {}), enabled: !!team.passwordPolicy?.enabled }));
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const toggleFolder = (id) => set('folderIds', p.folderIds.includes(id) ? p.folderIds.filter(x => x !== id) : [...p.folderIds, id]);
  return (
    <div className="rounded-xl p-3 space-y-3" style={{ border: '1px solid var(--color-border)' }} data-testid="policy-editor">
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={p.enabled} onChange={e => set('enabled', e.target.checked)} data-testid="policy-enabled" className="w-4 h-4" />
        <KeyRound className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /> Política para as senhas guardadas nas pastas deste grupo
      </label>
      {p.enabled && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Tamanho mínimo (caracteres)
              <input type="number" min="4" max="128" value={p.minLength} onChange={e => set('minLength', Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} data-testid="policy-min" />
            </label>
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Trocar a cada (dias, 0 = não vence)
              <input type="number" min="0" max="3650" value={p.expireDays} onChange={e => set('expireDays', Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} data-testid="policy-expire" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {[['requireUppercase', 'Letra maiúscula'], ['requireNumbers', 'Número'], ['requireSymbols', 'Símbolo']].map(([k, label]) => (
              <Toggle key={k} on={p[k]} label={`Exigir ${label.toLowerCase()}`} onClick={() => set(k, !p[k])} />
            ))}
          </div>
          <div>
            <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Vale para quais pastas do grupo</div>
            {folders.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>O grupo ainda não tem pastas. A política vale para todas as que forem criadas.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Toggle on={p.folderIds.length === 0} label="Todas" onClick={() => set('folderIds', [])} />
                {folders.map(f => <Toggle key={f.id} on={p.folderIds.includes(f.id)} label={f.name} testId={`policy-folder-${f.name}`} onClick={() => toggleFolder(f.id)} />)}
              </div>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            O cofre não deixa salvar senha fora da regra e o gerador já cria no tamanho certo. Com prazo, a senha vence e aparece um aviso para gerar outra.
          </p>
        </>
      )}
      <button type="button" disabled={saving} data-testid="policy-save"
        onClick={() => onSave(p.enabled ? { ...p, enabled: true } : null)}
        className="px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
        Salvar política
      </button>
    </div>
  );
}

// Importar grupos do Active Directory (vira grupo com o mesmo nome e as pessoas de dentro)
function ImportAdModal({ onClose }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const [results, setResults] = useState(null);
  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['ad-groups'],
    queryFn: () => api.post('/ldap/groups', {}).then(r => r.data),
    retry: false,
  });
  const importMut = useMutation({
    mutationFn: () => api.post('/ldap/groups/import', { dns: [...selected] }),
    onSuccess: ({ data }) => { setResults(data.results); qc.invalidateQueries({ queryKey: ['admin-groups'] }); qc.invalidateQueries({ queryKey: ['ad-groups'] }); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível importar'),
  });
  const toggle = (dn) => setSelected(s => { const n = new Set(s); n.has(dn) ? n.delete(dn) : n.add(dn); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto" style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Server className="w-5 h-5" style={{ color: 'var(--color-primary)' }} /> Importar grupos do AD</h2>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Cada grupo escolhido vira um grupo aqui com o mesmo nome e as pessoas que estão nele no AD. Quem ainda não tem conta é cadastrado como usuário do AD.
          Ao sincronizar, quem entrar ou sair do grupo no AD entra ou sai daqui; quem você adicionar à mão continua. Defina o que cada cargo faz no grupo em Cargos e permissões.
        </p>
        {isLoading && <div className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}><Loader className="w-4 h-4 inline animate-spin" /> Buscando grupos no AD...</div>}
        {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>{error.response?.data?.error || 'Não foi possível ler os grupos do AD'}</div>}
        {results ? (
          <div className="space-y-2" data-testid="ad-import-results">
            {results.map(r => (
              <div key={r.dn} className="text-sm p-3 rounded-lg" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>
                <b>{r.name || r.dn}</b>{' — '}
                {r.error ? <span style={{ color: '#f87171' }}>{r.error}</span>
                  : `${r.created ? 'criado' : 'atualizado'}: ${r.members} pessoa(s)${r.added ? `, ${r.added} entraram` : ''}${r.removed ? `, ${r.removed} saíram` : ''}${r.skipped?.length ? `, ${r.skipped.length} ignorado(s) (grupos dentro do grupo ou sem e-mail)` : ''}`}
              </div>
            ))}
            <button onClick={onClose} className="mt-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Fechar</button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {groups.map(g => (
                <label key={g.dn} className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-[var(--color-surface-hover)]" data-testid={`ad-group-${g.cn}`}>
                  <input type="checkbox" checked={selected.has(g.dn)} onChange={() => toggle(g.dn)} className="w-4 h-4" />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm block truncate" style={{ color: 'var(--color-text)' }}>{g.cn}</span>
                    <span className="text-[11px] block truncate" style={{ color: 'var(--color-muted)' }}>{g.description || g.dn}</span>
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{g.memberCount} membro(s)</span>
                  {g.importedTeamId && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(var(--color-primary-rgb),0.13)', color: 'var(--color-primary)' }}>já importado</span>}
                </label>
              ))}
              {!isLoading && !error && groups.length === 0 && <div className="text-sm py-4 text-center" style={{ color: 'var(--color-muted)' }}>Nenhum grupo encontrado no AD</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
              <button onClick={() => importMut.mutate()} disabled={!selected.size || importMut.isPending} data-testid="ad-import"
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={primaryBtn}>
                {importMut.isPending ? 'Importando...' : `Importar ${selected.size || ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GroupRow({ team, users, roles, folders }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState([]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-groups'] });
    qc.invalidateQueries({ queryKey: ['admin-group-members', team.id] });
  };
  const onError = (e) => toast.error(e.response?.data?.error || 'Erro');

  const { data: members = [] } = useQuery({
    queryKey: ['admin-group-members', team.id],
    queryFn: () => api.get(`/teams/${team.id}/members`).then(r => r.data),
    enabled: open,
  });

  const update = useMutation({ mutationFn: (data) => api.put(`/teams/${team.id}`, data), onSuccess: () => { refresh(); toast.success('Grupo atualizado'); }, onError });
  const memberPerm = useMutation({
    mutationFn: ({ userId, data }) => api.put(`/teams/${team.id}/members/${userId}`, data),
    onSuccess: refresh, onError,
  });
  const addMembers = useMutation({
    mutationFn: () => api.post(`/teams/${team.id}/invite`, { userIds: adding }),
    onSuccess: ({ data }) => { setAdding([]); refresh(); toast.success(`${data.added} membro(s) adicionado(s)`); }, onError,
  });
  const removeMember = useMutation({ mutationFn: (userId) => api.delete(`/teams/${team.id}/members/${userId}`), onSuccess: () => { refresh(); toast.success('Removido do grupo'); }, onError });
  const removeGroup = useMutation({ mutationFn: () => api.delete(`/teams/${team.id}`), onSuccess: () => { refresh(); toast.success('Grupo excluído'); }, onError });

    // Sem ajuste: grava o contrário do padrão; com ajuste: volta ao padrão (null)
  const cycle = (m, key) => {
    const groupDefault = team[PERMS.find(p => p.key === key).team];
    const next = m[key] === null || m[key] === undefined ? !groupDefault : null;
    memberPerm.mutate({ userId: m.userId, data: { [key]: next } });
  };

  return (
    <div className="rounded-2xl" style={cardStyle} data-testid={`group-${team.name}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 p-4 text-left">
        {open ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--color-muted)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />}
        <Users2 className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            {team.name}
            {team.adGroupDn && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" title={team.adGroupDn} style={{ background: 'rgba(var(--color-primary-rgb),0.13)', color: 'var(--color-primary)' }}>AD</span>}
            {team.require2FA && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>2FA</span>}
            {team.passwordPolicy?.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}>política {team.passwordPolicy.minLength}+</span>}
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
            Dono: {fullName(team.owner)} · {team.memberCount} membro(s)
            {' · Membros: '}{PERMS.filter(p => team[p.team]).map(p => p.label.toLowerCase()).join(', ') || 'só visualizar'}
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="grid sm:grid-cols-2 gap-3 pt-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Nome</label>
              <input defaultValue={team.name} maxLength={100} onBlur={e => e.target.value.trim() && e.target.value !== team.name && update.mutate({ name: e.target.value.trim() })}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Dono</label>
              <select value={team.ownerId} onChange={e => update.mutate({ ownerId: e.target.value })} data-testid="group-owner-edit"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={inputStyle}>
                {users.map(u => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Padrão para os membros nas pastas do grupo</div>
            <div className="flex gap-2">
              {PERMS.map(p => <Toggle key={p.key} on={team[p.team]} label={p.label} testId={`default-${p.key}`}
                onClick={() => update.mutate({ [p.team]: !team[p.team] })} />)}
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
              Todos sempre podem ver. O cargo de cada pessoa também limita (Configurações › Cargos e permissões).
            </p>
          </div>

          <div className="flex items-start gap-3">
            <Toggle on={!!team.require2FA} testId="group-require-2fa" label={team.require2FA ? '2FA obrigatório' : '2FA opcional'}
              onClick={() => update.mutate({ require2FA: !team.require2FA })} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <Smartphone className="w-3.5 h-3.5 inline mr-1" />
              Obrigatório: todos os membros precisam usar app autenticador. O prazo e as instruções ficam em Configurações › Segurança.
            </p>
          </div>

          <PolicyEditor key={JSON.stringify(team.passwordPolicy || null)} team={team} folders={folders.filter(f => f.teamId === team.id)}
            saving={update.isPending} onSave={(passwordPolicy) => update.mutate({ passwordPolicy })} />

          <div>
            <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Membros — clique numa permissão para ajustar só aquela pessoa</div>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {members.map(m => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }} data-testid={`member-${m.user?.email}`}>
                  <div className="flex-1 min-w-[160px]">
                    <div className="text-sm flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      {m.isOwner && <Crown className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />}
                      {fullName(m.user)}
                      {m.status === 'PENDING' && <span className="text-[10px] px-1.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>convite pendente</span>}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {m.user?.email}{roles.find(r => r.key === m.user?.role) ? ` · ${roles.find(r => r.key === m.user?.role).label}` : ''}
                      {m.invitedById === 'ad-sync' && ' · veio do AD'}
                      {m.roleScope && ` · regra do cargo neste grupo${m.roleScope.folderIds.length ? ` (${m.roleScope.folderIds.length} pasta(s))` : ''}`}
                    </div>
                  </div>
                  {m.isOwner ? (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Dono: todas as permissões</span>
                  ) : (
                    <>
                      {PERMS.map(p => {
                        // O cargo é o teto: se ele não permite, o grupo não libera
                        const role = roles.find(r => r.key === m.user?.role);
                        const blocked = role && !role.isProtected && role[p.key] === false;
                        return (
                          <Toggle key={p.key} on={m.effective?.[p.key] && !blocked} testId={`member-${p.key}`}
                            label={`${p.label}${m[p.key] === null || m[p.key] === undefined ? '' : ' •'}${blocked ? ' (cargo)' : ''}`}
                            title={blocked ? `O cargo ${role.label} não permite ${p.label.toLowerCase()}. Mude em Cargos e permissões.` : undefined}
                            onClick={() => cycle(m, p.key)} />
                        );
                      })}
                      <button type="button" title="Remover do grupo" onClick={() => removeMember.mutate(m.userId)}
                        className="p-1.5 rounded hover:bg-[var(--color-surface-hover)]" style={{ color: '#ef4444' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
              “•” indica ajuste individual; clicar de novo volta ao padrão do grupo. “(cargo)” indica que o cargo da pessoa bloqueia — mude em Cargos e permissões.
            </p>
          </div>

          <div>
            <div className="text-xs mb-1.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><UserPlus className="w-3.5 h-3.5" /> Adicionar membros (entram direto)</div>
            <UserPicker users={users} selected={adding} onChange={setAdding} exclude={members.filter(m => m.status === 'ACTIVE').map(m => m.userId)} />
            {adding.length > 0 && (
              <button onClick={() => addMembers.mutate()} disabled={addMembers.isPending} data-testid="add-members"
                className="mt-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={primaryBtn}>
                Adicionar {adding.length}
              </button>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => window.confirm(`Excluir o grupo "${team.name}"?`) && removeGroup.mutate()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              <Trash2 className="w-3.5 h-3.5" /> Excluir grupo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminGroupsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: () => api.get('/teams', { params: { all: 'true' } }).then(r => r.data),
  });
  const [showImport, setShowImport] = useState(false);
  const qcPage = useQueryClient();
  const { data: folders = [] } = useQuery({
    queryKey: ['admin-all-folders'],
    // Árvore → lista (subpastas incluídas); só as compartilhadas interessam aqui
    queryFn: () => api.get('/folders/admin-all').then(r => {
      const flat = (list) => list.flatMap(f => [f, ...flat(f.children || [])]);
      return flat(r.data.shared || []);
    }),
  });
  const resync = useMutation({
    mutationFn: () => api.post('/ldap/groups/resync'),
    onSuccess: ({ data }) => { toast.success(`${data.results.length} grupo(s) do AD sincronizado(s)`); qcPage.invalidateQueries({ queryKey: ['admin-groups'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível sincronizar'),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then(r => r.data),
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => api.get('/users', { params: { status: 'ACTIVE' } }).then(r => r.data),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Users2 className="w-6 h-6" style={{ color: 'var(--color-primary)' }} /> Grupos
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Crie grupos, coloque as pessoas direto (sem convite) e defina o que cada um pode fazer nas pastas do grupo.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
        {teams.some(t => t.adGroupDn) && (
          <button onClick={() => resync.mutate()} disabled={resync.isPending} title="Atualiza os membros dos grupos que vieram do AD"
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border border-[var(--color-border)] text-[var(--color-text-muted)]">
            <RefreshCw className={`w-4 h-4 ${resync.isPending ? 'animate-spin' : ''}`} /> Sincronizar AD
          </button>
        )}
        <button onClick={() => setShowImport(true)} data-testid="import-ad-groups"
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border border-[var(--color-border)] text-[var(--color-text-muted)]">
          <Server className="w-4 h-4" /> Importar do AD
        </button>
        <button onClick={() => setShowCreate(true)} data-testid="new-group"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white flex-shrink-0" style={primaryBtn}>
          <Plus className="w-4 h-4" /> Novo grupo
        </button>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading && <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Carregando...</div>}
        {!isLoading && teams.length === 0 && (
          <div className="text-center py-12 rounded-2xl text-sm" style={{ ...cardStyle, color: 'var(--color-text-muted)' }}>Nenhum grupo ainda</div>
        )}
        {teams.map(t => <GroupRow key={t.id} team={t} users={users} roles={roles} folders={folders} />)}
      </div>

      {showCreate && <CreateGroupModal users={users} onClose={() => setShowCreate(false)} />}
      {showImport && <ImportAdModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
