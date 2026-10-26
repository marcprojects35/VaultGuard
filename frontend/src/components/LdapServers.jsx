import { useState } from 'react';
import { Server, Play, Loader, CheckCircle, X, Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, Star, Zap, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

// Cadastro dos servidores do Active Directory (vários, um em uso por vez)
const NEW_SERVER = { host: '', port: 389, useTLS: false, startTLS: false, verifyCert: true, domain: '', baseDn: '', bindDn: '', bindPassword: '' };
const inputCls = 'w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]';
const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : null;

function Switch({ checked, onChange, testId }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} data-testid={testId} aria-pressed={checked}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0"
      style={{ background: checked ? 'var(--color-primary)' : 'var(--color-surface-hover)' }}>
      <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform" style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

function StatusPill({ st }) {
  const map = {
    inUse: { label: 'Em uso agora', color: '#22c55e' },
    ok: { label: 'Reserva pronto', color: 'var(--color-primary)' },
    down: { label: 'Fora do ar', color: '#ef4444' },
    unknown: { label: 'Não verificado', color: 'var(--color-muted)' },
  };
  const key = st?.inUse && st.state !== 'down' ? 'inUse' : (st?.state || 'unknown');
  const m = map[key] || map.unknown;
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap" style={{ color: m.color, border: `1px solid ${m.color}` }} data-testid="server-state">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} /> {m.label}
    </span>
  );
}

export default function LdapServers({ config, setConfig, status, savedIds, onTest, testing, testResults, onUse, using, onCheck, checking }) {
  const servers = config.servers || [];
  const [open, setOpen] = useState(() => (servers.length === 1 ? servers[0].id : null));
  const [showPass, setShowPass] = useState({});

  const update = (id, patch) => setConfig(c => ({ ...c, servers: c.servers.map(sv => sv.id === id ? { ...sv, ...patch } : sv) }));
  const add = () => {
    const id = `srv${Date.now().toString(36)}`;
    // O novo herda domínio, base e conta do primeiro: num domínio com 2 controladores muda só o endereço
    const first = servers[0] || {};
    const sv = { ...NEW_SERVER, id, name: `Servidor ${servers.length + 1}`, domain: first.domain || '', baseDn: first.baseDn || '', bindDn: first.bindDn || '' };
    setConfig(c => ({ ...c, servers: [...(c.servers || []), sv], activeServerId: c.activeServerId || id }));
    setOpen(id);
  };
  const remove = (id) => setConfig(c => {
    const rest = c.servers.filter(sv => sv.id !== id);
    return { ...c, servers: rest, activeServerId: c.activeServerId === id ? rest[0]?.id || null : c.activeServerId };
  });
  const move = (id, dir) => setConfig(c => {
    const list = [...c.servers];
    const i = list.findIndex(sv => sv.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return c;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...c, servers: list };
  });
  const statusOf = (id) => status?.servers?.find(s => s.id === id);
  const inUse = status?.servers?.find(s => s.inUse);

  return (
    <div className="space-y-4">
      {/* Resumo e troca automática */}
      <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Servidores do Active Directory</h2>
            <p className="text-xs text-[var(--color-muted)] mt-1 max-w-xl">
              Cadastre um ou mais servidores (ex.: dois controladores de domínio). Só um é usado por vez. O marcado com
              <Star className="inline w-3 h-3 mx-0.5" style={{ color: 'var(--color-primary)' }} /> é o preferido; use “Usar este” para trocar na hora.
            </p>
          </div>
          <button type="button" onClick={onCheck} disabled={checking || !savedIds.length} data-testid="check-servers"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Verificar todos agora
          </button>
        </div>

        {inUse && (
          <div className="text-xs px-3 py-2 rounded-lg" data-testid="in-use-banner"
            style={{ background: inUse.preferred ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.1)', border: `1px solid ${inUse.preferred ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.4)'}`, color: 'var(--color-text)' }}>
            Em uso agora: <b>{inUse.name}</b> ({inUse.host})
            {!inUse.preferred && ' — o preferido está fora do ar, então o reserva assumiu. Ele volta sozinho para o preferido quando este responder.'}
          </div>
        )}

        <label className="flex items-start gap-3">
          <Switch checked={config.autoFailover !== false} onChange={v => setConfig(c => ({ ...c, autoFailover: v }))} testId="auto-failover" />
          <span>
            <span className="text-sm text-[var(--color-text)] block">Troca automática</span>
            <span className="text-xs text-[var(--color-muted)]">
              Se o servidor em uso parar de responder, o próximo da lista assume na hora, sem ninguém precisar fazer nada.
              Desligado, só o preferido é usado e, se ele cair, o login pelo AD para até você trocar manualmente.
            </span>
          </span>
        </label>
      </div>

      {servers.length === 0 && (
        <div className="text-center text-sm py-8 rounded-xl border border-dashed border-[var(--color-border)] text-[var(--color-muted)]">Nenhum servidor cadastrado</div>
      )}

      {servers.map((sv, idx) => {
        const st = statusOf(sv.id);
        const preferred = config.activeServerId === sv.id;
        const saved = savedIds.includes(sv.id);
        const result = testResults[sv.id];
        const expanded = open === sv.id;
        return (
          <div key={sv.id} className="bg-[var(--color-surface-2)] border rounded-xl" data-testid={`server-${sv.name}`}
            style={{ borderColor: preferred ? 'var(--color-primary)' : 'var(--color-border)' }}>
            <div className="flex flex-wrap items-center gap-3 p-4">
              <button type="button" onClick={() => setOpen(expanded ? null : sv.id)} className="text-[var(--color-muted)]" aria-label="Abrir">
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <Server className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
              <div className="flex-1 min-w-[160px]">
                <div className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-1.5">
                  {preferred && <Star className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)', fill: 'var(--color-primary)' }} />}
                  {sv.name} <span className="text-xs font-normal text-[var(--color-muted)]">· {idx === 0 ? '1º' : `${idx + 1}º`} na ordem</span>
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {sv.host || 'sem endereço'}:{sv.port || (sv.useTLS ? 636 : 389)}{sv.useTLS ? ' · LDAPS' : sv.startTLS ? ' · StartTLS' : ''}
                  {st?.lastCheck && ` · verificado ${fmt(st.lastCheck)}`}
                </div>
                {st?.state === 'down' && st.lastError && <div className="text-[11px] mt-0.5" style={{ color: '#f87171' }}>Erro: {st.lastError}</div>}
              </div>
              {saved ? <StatusPill st={st} /> : <span className="text-[11px] text-[var(--color-warning)]">não salvo</span>}
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(sv.id, -1)} disabled={idx === 0} title="Subir na ordem de reserva" className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] disabled:opacity-20 text-[var(--color-muted)]"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => move(sv.id, 1)} disabled={idx === servers.length - 1} title="Descer na ordem de reserva" className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] disabled:opacity-20 text-[var(--color-muted)]"><ArrowDown className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => onTest(sv.id)} disabled={testing === sv.id || !sv.host} data-testid="test-server"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40">
                  {testing === sv.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Testar
                </button>
                {!(preferred && st?.inUse) && (
                  <button type="button" onClick={() => onUse(sv.id)} disabled={using === sv.id} data-testid="use-server"
                    title={saved ? 'Passa a usar este servidor agora' : 'Salva a configuração e passa a usar este servidor'}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
                    {using === sv.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Usar este
                  </button>
                )}
                <button type="button" onClick={() => remove(sv.id)} title="Remover" className="p-1.5 rounded hover:bg-[var(--color-surface-hover)]" style={{ color: '#ef4444' }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {result && (
              <div className={`mx-4 mb-3 flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${result.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`} data-testid="test-result">
                {result.success ? <CheckCircle className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />} {result.message}
              </div>
            )}

            {expanded && (
              <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-4">
                <label className="text-xs text-[var(--color-text-muted)]">Nome (para você identificar)
                  <input className={`${inputCls} mt-1`} value={sv.name} onChange={e => update(sv.id, { name: e.target.value })} placeholder="Ex.: DC Matriz" data-testid="server-name" />
                </label>
                <label className="text-xs text-[var(--color-text-muted)]">Servidor (IP ou nome)
                  <input className={`${inputCls} mt-1`} value={sv.host} onChange={e => update(sv.id, { host: e.target.value })} placeholder="192.168.0.10 ou dc1.empresa.local" data-testid="server-host" />
                </label>
                <label className="text-xs text-[var(--color-text-muted)]">Porta (389 LDAP · 636 LDAPS)
                  <input type="number" className={`${inputCls} mt-1`} value={sv.port} onChange={e => update(sv.id, { port: e.target.value })} data-testid="server-port" />
                </label>
                <div className="text-xs text-[var(--color-text-muted)] flex flex-wrap items-end gap-4 pb-2">
                  <label className="flex items-center gap-2"><Switch checked={!!sv.useTLS} onChange={v => update(sv.id, { useTLS: v, port: v ? 636 : 389 })} /> LDAPS</label>
                  {!sv.useTLS && <label className="flex items-center gap-2"><Switch checked={!!sv.startTLS} onChange={v => update(sv.id, { startTLS: v })} /> StartTLS</label>}
                  {(sv.useTLS || sv.startTLS) && <label className="flex items-center gap-2"><Switch checked={sv.verifyCert !== false} onChange={v => update(sv.id, { verifyCert: v })} /> Verificar certificado</label>}
                </div>
                {!sv.useTLS && !sv.startTLS && (
                  <div className="sm:col-span-2 p-2.5 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                    Sem criptografia: as senhas trafegam em texto puro na rede. Ative LDAPS (porta 636) ou StartTLS.
                  </div>
                )}
                <label className="text-xs text-[var(--color-text-muted)]">Domínio (opcional)
                  <input className={`${inputCls} mt-1`} value={sv.domain || ''} onChange={e => update(sv.id, { domain: e.target.value })} placeholder="empresa.local" />
                </label>
                <label className="text-xs text-[var(--color-text-muted)]">Base DN
                  <input className={`${inputCls} mt-1`} value={sv.baseDn || ''} onChange={e => update(sv.id, { baseDn: e.target.value })} placeholder="DC=empresa,DC=local" data-testid="server-basedn" />
                </label>
                <label className="text-xs text-[var(--color-text-muted)]">Conta de serviço (Bind DN)
                  <input className={`${inputCls} mt-1`} value={sv.bindDn || ''} onChange={e => update(sv.id, { bindDn: e.target.value })} placeholder="CN=vaultguard-svc,OU=Servicos,DC=empresa,DC=local ou empresa\vaultguard-svc" data-testid="server-binddn" />
                </label>
                <label className="text-xs text-[var(--color-text-muted)]">Senha da conta de serviço
                  <div className="relative mt-1">
                    <input type={showPass[sv.id] ? 'text' : 'password'} className={inputCls} value={sv.bindPassword || ''} onChange={e => update(sv.id, { bindPassword: e.target.value })} placeholder="••••••••" data-testid="server-password" />
                    <button type="button" onClick={() => setShowPass(p => ({ ...p, [sv.id]: !p[sv.id] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
                      {showPass[sv.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </label>
                <p className="sm:col-span-2 text-[11px] text-[var(--color-muted)]">
                  Use uma conta com permissão só de leitura no AD. Se os dois servidores forem do mesmo domínio, normalmente só o endereço muda.
                </p>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" onClick={add} data-testid="add-server"
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
        <Plus className="w-4 h-4" /> Adicionar servidor
      </button>
    </div>
  );
}
