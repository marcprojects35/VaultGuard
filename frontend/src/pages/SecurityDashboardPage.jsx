import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, AlertTriangle, AlertCircle, Clock, Key,
  TrendingUp, Tag, Paperclip, RefreshCw, ExternalLink, ChevronRight,
  CheckCircle, Users, Inbox,
} from 'lucide-react';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useIsAdmin } from '../stores/authStore.js';
import { getStrengthColor } from '../utils/crypto.js';

function ScoreGauge({ score, settings }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Ótimo' : score >= 60 ? 'Regular' : 'Crítico';
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-surface-2)" strokeWidth="10" />
          <circle
            cx="60" cy="60" r="54" fill="none"
            stroke={color} strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>/ 100</span>
        </div>
      </div>
      <span className="mt-2 text-sm font-semibold" style={{ color }}>{label}</span>
      <span className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Pontuação de Segurança</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl p-5 text-left transition-all ${onClick ? 'hover:scale-[1.02] cursor-pointer' : 'cursor-default'}`}
      style={{ background: 'var(--color-surface)', border: `1px solid ${color}33` }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
          <p className="text-3xl font-bold" style={{ color }}>{value}</p>
          {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
    </button>
  );
}

function StrengthBar({ buckets, total }) {
  const segments = [
    { key: 'critical', label: 'Crítica', color: '#ef4444' },
    { key: 'weak', label: 'Fraca', color: '#f97316' },
    { key: 'fair', label: 'Regular', color: '#f59e0b' },
    { key: 'strong', label: 'Forte', color: '#10b981' },
    { key: 'veryStrong', label: 'Muito Forte', color: '#6366f1' },
  ];

  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {segments.map(s => {
          const pct = total > 0 ? (buckets[s.key] / total) * 100 : 0;
          return pct > 0 ? (
            <div key={s.key} style={{ width: `${pct}%`, background: s.color }} title={`${s.label}: ${buckets[s.key]}`} />
          ) : null;
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {s.label}: <strong style={{ color: 'var(--color-text)' }}>{buckets[s.key]}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CredentialList({ items, emptyMsg, type }) {
  const navigate = useNavigate();
  if (items.length === 0) {
    return (
      <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-20" />
        {emptyMsg}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map(c => (
        <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{c.title}</p>
            <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{c.folder?.name}</p>
          </div>
          {type === 'expired' || type === 'expiring' ? (
            <span className="text-xs flex-shrink-0 font-medium px-2 py-0.5 rounded-full"
              style={{
                background: type === 'expired' ? '#ef444422' : '#f59e0b22',
                color: type === 'expired' ? '#ef4444' : '#f59e0b'
              }}>
              {new Date(c.expiresAt).toLocaleDateString('pt-BR')}
            </span>
          ) : (
            <span className="text-xs flex-shrink-0 font-semibold" style={{ color: getStrengthColor(c.strength || 0) }}>
              {c.strength ?? 0}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function SecurityDashboardPage() {
  const settings = useSettingsStore(s => s.settings);
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['security-dashboard'],
    queryFn: () => api.get('/dashboard/security').then(r => r.data),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--color-text-muted)' }}>
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando dashboard...
      </div>
    );
  }

  const d = data || {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6" style={{ color: settings.primaryColor }} />
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Dashboard de Segurança</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Saúde geral do cofre de senhas</p>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm hover:bg-white/5 transition-colors"
          style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      </div>

      {/* Top row: score + main stats */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Score gauge */}
        <div className="lg:col-span-1 rounded-2xl"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <ScoreGauge score={d.score ?? 0} settings={settings} />
        </div>

        {/* Stat grid */}
        <div className="lg:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Key} label="Total de Senhas" value={d.total ?? 0}
            color={settings.primaryColor} />
          <StatCard icon={AlertCircle} label="Senhas Expiradas" value={d.expired ?? 0}
            color="#ef4444"
            sub={d.expiringCritical > 0 ? `+${d.expiringCritical} crítica(s) em 7 dias` : undefined}
            onClick={d.expired > 0 ? () => navigate('/search?expiry=expired') : undefined} />
          <StatCard icon={Clock} label="Expirando em 30 dias" value={d.expiringSoon ?? 0}
            color="#f59e0b"
            onClick={d.expiringSoon > 0 ? () => navigate('/search?expiry=expiring') : undefined} />
          <StatCard icon={AlertTriangle} label="Senhas Fracas" value={d.weakPasswords ?? 0}
            color="#f97316"
            sub="Força < 40%"
            onClick={d.weakPasswords > 0 ? () => navigate('/search') : undefined} />
        </div>
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={CheckCircle} label="Criadas (7 dias)" value={d.recentCreated ?? 0}
          color="#10b981" />
        <StatCard icon={Tag} label="Com Tags" value={d.withTags ?? 0}
          color="#6366f1"
          sub={`de ${d.total ?? 0} total`} />
        <StatCard icon={Paperclip} label="Com Anexos" value={d.withAttachments ?? 0}
          color="#8b5cf6" />
        {isAdmin && (
          <StatCard icon={Inbox} label="Pedidos Pendentes" value={d.pendingRequests ?? 0}
            color="#f59e0b"
            onClick={() => navigate('/admin/access-requests')} />
        )}
      </div>

      {/* Strength distribution */}
      {d.strengthBuckets && (
        <div className="rounded-2xl p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4" style={{ color: settings.primaryColor }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Distribuição de Força</h2>
          </div>
          <StrengthBar buckets={d.strengthBuckets} total={d.total ?? 0} />
        </div>
      )}

      {/* Lists: expired, expiring, weak */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid #ef444433' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Expiradas</h3>
            </div>
            {(d.lists?.expired?.length ?? 0) > 0 && (
              <button onClick={() => navigate('/search?expiry=expired')}
                className="text-xs flex items-center gap-1 hover:underline" style={{ color: settings.primaryColor }}>
                Ver todas <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          <CredentialList items={d.lists?.expired ?? []} emptyMsg="Nenhuma senha expirada" type="expired" />
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid #f59e0b33' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-400" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Expirando em Breve</h3>
            </div>
            {(d.lists?.expiringSoon?.length ?? 0) > 0 && (
              <button onClick={() => navigate('/search?expiry=expiring')}
                className="text-xs flex items-center gap-1 hover:underline" style={{ color: settings.primaryColor }}>
                Ver todas <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          <CredentialList items={d.lists?.expiringSoon ?? []} emptyMsg="Nenhuma expirando em breve" type="expiring" />
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid #f9731633' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Senhas Fracas</h3>
            </div>
          </div>
          <CredentialList items={d.lists?.weak ?? []} emptyMsg="Nenhuma senha fraca" type="weak" />
        </div>
      </div>
    </div>
  );
}
