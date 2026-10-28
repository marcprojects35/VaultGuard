import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Activity, Search, Filter, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

// Descrição de cada ação registrada (o código continua no CSV e na busca)
const ACTION_LABELS = {
  'user.login': 'Entrou no sistema', 'user.logout': 'Saiu do sistema', 'user.login_failed': 'Tentativa de login falhou',
  'user.locked': 'Conta bloqueada por tentativas', 'user.new_device': 'Entrou de um dispositivo novo',
  'user.create': 'Criou usuário', 'user.update': 'Alterou usuário', 'user.delete': 'Excluiu usuário',
  'user.password_changed': 'Trocou a senha', 'user.password_reset': 'Senha redefinida pelo admin',
  'user.2fa_enabled': 'Ativou o 2FA', 'user.2fa_disabled': 'Desativou o 2FA', 'user.2fa_recovery_codes_generated': 'Gerou códigos de recuperação do 2FA',
  'credential.view': 'Visualizou senha', 'credential.autofill': 'Preencheu senha pela extensão', 'credential.compare': 'Extensão comparou senha digitada',
  'credential.create': 'Criou senha', 'credential.update': 'Alterou senha', 'credential.delete': 'Moveu senha para a lixeira',
  'credential.import': 'Importou senhas', 'credential.migrate': 'Migrou senha para a criptografia nova',
  'credential.share': 'Compartilhou senha', 'credential.unshare': 'Removeu compartilhamento',
  'attachment.upload': 'Anexou arquivo', 'attachment.download': 'Baixou anexo', 'attachment.delete': 'Excluiu anexo',
  'folder.create_corporate': 'Criou pasta corporativa', 'folder.create_personal': 'Criou pasta pessoal', 'folder.create_team': 'Criou pasta de grupo',
  'folder.delete': 'Moveu pasta para a lixeira', 'vault.export': 'Exportou o cofre',
  'trash.restore': 'Restaurou da lixeira', 'trash.purge': 'Excluiu de vez (lixeira)', 'trash.empty': 'Esvaziou a lixeira',
  'trash.auto_purge': 'Lixeira: exclusão automática pelo prazo', 'audit.purge': 'Auditoria: registros antigos sobrescritos (rotação) ou apagados',
  'role.scopes_updated': 'Alterou onde o cargo vale (grupos)', 'ldap.groups_imported': 'Importou/sincronizou grupos do AD',
  'settings.retention_updated': 'Alterou prazos de retenção',
  'team.create': 'Criou grupo', 'team.update': 'Alterou grupo', 'team.delete': 'Excluiu grupo',
  'team.invite': 'Convidou para grupo', 'team.invite_accept': 'Aceitou convite de grupo', 'team.invite_decline': 'Recusou convite de grupo',
  'team.member_add': 'Admin adicionou ao grupo', 'team.member_remove': 'Removeu do grupo', 'team.member_permissions': 'Ajustou permissões de membro',
  'role.create': 'Criou cargo', 'role.update': 'Alterou cargo/permissões', 'role.delete': 'Excluiu cargo',
  'api_token.create': 'Criou token de API', 'api_token.delete': 'Revogou token de API',
  'access_request.create': 'Pediu acesso a pasta',
  'settings.branding_updated': 'Alterou logo/fundos', 'settings.ldap_updated': 'Alterou Active Directory',
  'settings.office365_connected': 'Conectou Microsoft 365', 'settings.office365_revoked': 'Desconectou Microsoft 365',
  'ldap.sync_completed': 'Sincronizou com o AD', 'ldap.users_linked': 'Vinculou usuários do AD',
  'ldap.failover': 'AD: servidor caiu, reserva assumiu', 'ldap.failback': 'AD: voltou ao servidor preferido',
  'ldap.server_switched': 'AD: trocou o servidor manualmente',
  'keys.created': 'Gerou chaves de criptografia', 'keys.org_created': 'Gerou chave da organização', 'keys.folder_init': 'Gerou chave da pasta',
  'keys.folder_rotated': 'Trocou a chave da pasta', 'keys.granted': 'Liberou chave para membros', 'keys.reset': 'Gerou chaves novas (perdeu as antigas)',
  'keys.rewrapped': 'Protegeu chaves com a senha nova',
};
const RESOURCE_LABELS = { Audit: 'Auditoria', Settings: 'Configurações', Folder: 'Pasta', Credential: 'Senha', User: 'Usuário', Team: 'Grupo', Role: 'Cargo', Vault: 'Cofre', Attachment: 'Anexo', ApiToken: 'Token' };

const ACTION_COLORS = {
  CREATE: 'text-green-400 bg-green-500/10',
  UPDATE: 'text-blue-400 bg-blue-500/10',
  DELETE: 'text-red-400 bg-red-500/10',
  VIEW: 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)]',
  LOGIN: 'text-[var(--color-primary)] bg-[rgba(var(--color-primary-rgb),0.1)]',
  LOGOUT: 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)]',
  FAILED_LOGIN: 'text-orange-400 bg-orange-500/10',
};

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, search, actionFilter],
    queryFn: () => {
      // A busca também acha pelo texto mostrado ("Moveu senha para a lixeira")
      const term = search.trim().toLowerCase();
      const actions = term ? Object.keys(ACTION_LABELS).filter(k => ACTION_LABELS[k].toLowerCase().includes(term)).join(',') : '';
      return api.get('/audit', { params: { page, limit, search, actions: actions || undefined, action: actionFilter || undefined } }).then(r => r.data);
    },
    placeholderData: keepPreviousData,
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const exportCSV = () => {
    const rows = [['Data', 'Usuário', 'Ação', 'Recurso', 'Detalhes', 'IP']];
    logs.forEach(l => rows.push([
      new Date(l.createdAt).toLocaleString('pt-BR'),
      l.user?.name || l.userId,
      l.action,
      `${l.resourceType}:${l.resourceId || ''}`,
      l.details ? JSON.stringify(l.details) : '',
      l.ipAddress || '',
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'audit.csv'; a.click();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2"><Activity size={24} className="text-[var(--color-primary)]" /> Log de Auditoria</h1>
          <p className="text-[var(--color-text-muted)] text-sm mt-1">Histórico completo de ações no sistema</p>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text-muted)] rounded-lg text-sm transition-colors">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por pessoa, ação (ex.: lixeira, senha) ou IP..."
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-muted)] focus:outline-none focus:border-[var(--color-primary)]" />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg pl-9 pr-8 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]">
            <option value="">Todas as ações</option>
            {Object.keys(ACTION_LABELS).sort((a, b) => ACTION_LABELS[a].localeCompare(ACTION_LABELS[b])).map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted)] uppercase tracking-wider">
              <th className="text-left py-3 px-4">Data/Hora</th>
              <th className="text-left py-3 px-4">Usuário</th>
              <th className="text-left py-3 px-4">Ação</th>
              <th className="text-left py-3 px-4">Recurso</th>
              <th className="text-left py-3 px-4">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="py-8 text-center text-[var(--color-muted)]">Carregando...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-[var(--color-muted)]">Nenhum log encontrado.</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-sm">
                <td className="py-2.5 px-4 text-[var(--color-text-muted)] font-mono text-xs whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString('pt-BR')}
                </td>
                <td className="py-2.5 px-4 text-[var(--color-text)]">
                  {log.user ? `${log.user.firstName} ${log.user.lastName}` : <span className="text-[var(--color-muted)] italic">Sistema</span>}
                  {log.user?.email && <div className="text-xs text-[var(--color-muted)]">{log.user.email}</div>}
                </td>
                <td className="py-2.5 px-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] || 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)]'}`}>
                    <span title={log.action}>{ACTION_LABELS[log.action] || log.action}</span>
                  </span>
                </td>
                <td className="py-2.5 px-4 text-[var(--color-text-muted)] text-xs font-mono">
                  {RESOURCE_LABELS[log.resourceType] || log.resourceType}{log.resourceId ? ` #${log.resourceId.slice(0, 8)}` : ''}
                  {log.details && (
                    <div className="text-[var(--color-muted)] truncate max-w-[200px]" title={JSON.stringify(log.details)}>
                      {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-4 text-[var(--color-muted)] font-mono text-xs">{log.ipAddress || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-muted)]">{total} registros</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-40">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[var(--color-text-muted)] px-2">Página {page} de {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-40">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
