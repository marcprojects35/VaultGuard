import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, Trash2, ScrollText, Save, AlertTriangle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';

const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const inputStyle = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const fmtDate = (d) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const fmtBytes = (b) => b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

const PRESETS = [
  { days: 7, label: '7 dias' }, { days: 30, label: '30 dias' }, { days: 90, label: '90 dias' },
  { days: 365, label: '1 ano' }, { days: 1825, label: '5 anos' }, { days: 0, label: 'Sem limite' },
];

function RetentionField({ label, description, value, onChange, testId, min = 1 }) {
  return (
    <div>
      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</div>
      <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--color-muted)' }}>{description}</p>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.filter(p => p.days === 0 || p.days >= min).map(p => (
          <button key={p.days} type="button" onClick={() => onChange(p.days)}
            className="text-xs px-3 py-1.5 rounded-full border"
            style={Number(value) === p.days
              ? { background: 'rgba(var(--color-primary-rgb),0.13)', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
              : { borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input type="number" min="0" max="3650" value={value} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-24 px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} data-testid={testId} />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>dias (0 = sem limite)</span>
        </div>
      </div>
    </div>
  );
}

export default function DataRetentionPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['data-overview'], queryFn: () => api.get('/data').then(r => r.data) });
  const [form, setForm] = useState({ trashRetentionDays: 30, auditRetentionDays: 0 });
  const [keepDays, setKeepDays] = useState(90);
  const [confirmPurge, setConfirmPurge] = useState(null); // 'older' | 'all'

  useEffect(() => {
    if (data) setForm({ trashRetentionDays: data.trashRetentionDays, auditRetentionDays: data.auditRetentionDays });
  }, [data?.trashRetentionDays, data?.auditRetentionDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.put('/data/retention', { trashRetentionDays: Number(form.trashRetentionDays), auditRetentionDays: Number(form.auditRetentionDays) }),
    onSuccess: () => { toast.success('Prazos salvos'); qc.invalidateQueries({ queryKey: ['data-overview'] }); qc.invalidateQueries({ queryKey: ['trash'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível salvar'),
  });
  const purge = useMutation({
    mutationFn: (payload) => api.post('/data/audit/purge', payload),
    onSuccess: ({ data }) => { toast.success(`${data.removed} registro(s) de auditoria apagado(s)`); setConfirmPurge(null); qc.invalidateQueries({ queryKey: ['data-overview'] }); qc.invalidateQueries({ queryKey: ['audit'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível apagar'),
  });

  const dirty = data && (Number(form.trashRetentionDays) !== data.trashRetentionDays || Number(form.auditRetentionDays) !== data.auditRetentionDays);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Database className="w-6 h-6" style={{ color: 'var(--color-primary)' }} /> Dados e retenção
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Por quanto tempo a plataforma guarda o que foi excluído e os registros de auditoria, quanto espaço eles ocupam no banco, e limpeza manual.
        </p>
      </div>

      {/* Prazos */}
      <div className="rounded-2xl p-5 space-y-6" style={cardStyle}>
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Prazos de retenção</h2>
        <RetentionField label="Lixeira" testId="trash-days" value={form.trashRetentionDays}
          onChange={v => setForm(f => ({ ...f, trashRetentionDays: v }))}
          description="Senhas e pastas excluídas ficam na Lixeira por este tempo, podendo ser restauradas. Depois disso são apagadas de vez do banco, com anexos e versões." />
        <RetentionField label="Registros de auditoria (logs)" testId="audit-days" value={form.auditRetentionDays} min={7}
          onChange={v => setForm(f => ({ ...f, auditRetentionDays: v }))}
          description="Quem entrou, viu, criou, editou ou excluiu cada item. Funciona como uma janela móvel: a plataforma guarda sempre os últimos dias definidos aqui e os registros mais antigos vão sendo sobrescritos pelos novos (padrão: 90 dias). Mínimo de 7 dias; 0 guarda tudo, sem sobrescrever." />
        <div className="flex items-center gap-3">
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="save-retention"
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
            <Save className="w-4 h-4" /> {save.isPending ? 'Salvando...' : 'Salvar prazos'}
          </button>
          {dirty && <span className="text-xs" style={{ color: 'var(--color-warning)' }}>Alterações não salvas</span>}
        </div>
        <p className="text-xs flex gap-1.5" style={{ color: 'var(--color-muted)' }}>
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          A rotação roda a cada hora. Diminuir um prazo faz a próxima rodada sobrescrever tudo que já passou do novo prazo; aumentar não traz de volta o que já foi sobrescrito.
        </p>
      </div>

      {/* Situação atual */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5" style={cardStyle}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}><Trash2 className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /> Lixeira</div>
          <div className="text-2xl font-bold mt-2" style={{ color: 'var(--color-text)' }}>{isLoading ? '…' : (data.trash.credentials + data.trash.folders)}</div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{data ? `${data.trash.credentials} senha(s), ${data.trash.folders} pasta(s)` : ''}</div>
          <Link to="/trash" className="text-xs mt-2 inline-block underline" style={{ color: 'var(--color-primary)' }}>Abrir a Lixeira</Link>
        </div>
        <div className="rounded-2xl p-5" style={cardStyle}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}><ScrollText className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /> Auditoria</div>
          <div className="text-2xl font-bold mt-2" style={{ color: 'var(--color-text)' }}>{isLoading ? '…' : data.audit.count.toLocaleString('pt-BR')}</div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{data?.audit.oldest ? `desde ${fmtDate(data.audit.oldest)}` : 'nenhum registro'}</div>
          <Link to="/admin/audit" className="text-xs mt-2 inline-block underline" style={{ color: 'var(--color-primary)' }}>Ver os registros</Link>
        </div>
        <div className="rounded-2xl p-5" style={cardStyle}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}><Database className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /> Banco de dados</div>
          <div className="text-2xl font-bold mt-2" style={{ color: 'var(--color-text)' }}>{isLoading ? '…' : fmtBytes(data.database.bytes)}</div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>espaço total ocupado</div>
        </div>
      </div>

      {data && (
        <div className="rounded-2xl p-5" style={cardStyle}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>Espaço por tipo de dado</h2>
          <div className="space-y-2">
            {data.database.tables.map(t => (
              <div key={t.key} className="flex items-center gap-3 text-sm">
                <span className="w-44 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t.label}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, (t.bytes / Math.max(...data.database.tables.map(x => x.bytes), 1)) * 100)}%`, background: 'var(--color-primary)' }} />
                </div>
                <span className="w-20 text-right" style={{ color: 'var(--color-text)' }}>{fmtBytes(t.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Limpeza manual dos logs */}
      <div className="rounded-2xl p-5 space-y-3" style={cardStyle}>
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Apagar registros de auditoria agora</h2>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Sem volta. Fica registrado na própria auditoria quem apagou, quando e quantos registros. Exporte antes em Auditoria › Exportar CSV se precisar guardar.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Manter só os últimos</span>
          <input type="number" min="1" max="3650" value={keepDays} onChange={e => setKeepDays(Number(e.target.value))}
            className="w-24 px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} data-testid="keep-days" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>dias</span>
          <button onClick={() => setConfirmPurge('older')} disabled={!(keepDays >= 1)} data-testid="purge-older"
            className="px-4 py-1.5 rounded-lg text-sm font-medium" style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}>
            Apagar os mais antigos
          </button>
          <button onClick={() => setConfirmPurge('all')} data-testid="purge-all-audit"
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-white" style={{ background: '#dc2626' }}>
            Apagar todos
          </button>
        </div>
      </div>

      {/* Réplicas e backup */}
      <div className="rounded-2xl p-5 text-xs space-y-1.5" style={{ ...cardStyle, color: 'var(--color-text-muted)' }}>
        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Info className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /> Cópias de segurança e réplicas</div>
        <p>Backup e réplica do banco são feitos no servidor, fora da plataforma (ex.: <code>pg_dump</code> agendado, réplica do PostgreSQL ou snapshot do volume do Docker). As senhas saem cifradas nessas cópias.</p>
        <p>Os prazos acima valem para o banco principal. Um backup antigo guarda o que existia na data dele — defina também por quanto tempo os backups são mantidos no servidor.</p>
      </div>

      {confirmPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-2xl p-6" style={cardStyle}>
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" style={{ color: '#ef4444' }} />
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>
                  {confirmPurge === 'all' ? 'Apagar todos os registros de auditoria?' : `Apagar registros com mais de ${keepDays} dia(s)?`}
                </h3>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Não dá para desfazer. Um novo registro informará quem fez a limpeza.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmPurge(null)} className="flex-1 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancelar</button>
              <button onClick={() => purge.mutate(confirmPurge === 'all' ? { all: true } : { olderThanDays: keepDays })} disabled={purge.isPending} data-testid="confirm-purge"
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
                {purge.isPending ? 'Apagando...' : 'Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
