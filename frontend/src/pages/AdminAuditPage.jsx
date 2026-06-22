import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Search, Filter, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

const ACTION_COLORS = {
  CREATE: 'text-green-400 bg-green-500/10',
  UPDATE: 'text-blue-400 bg-blue-500/10',
  DELETE: 'text-red-400 bg-red-500/10',
  VIEW: 'text-slate-400 bg-white/5',
  LOGIN: 'text-[#C78C00] bg-[#C78C00]/10',
  LOGOUT: 'text-slate-400 bg-white/5',
  FAILED_LOGIN: 'text-orange-400 bg-orange-500/10',
};

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, search, actionFilter],
    queryFn: () => api.get('/audit', { params: { page, limit, search, action: actionFilter || undefined } }).then(r => r.data),
    keepPreviousData: true,
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
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Activity size={24} className="text-[#C78C00]" /> Log de Auditoria</h1>
          <p className="text-slate-400 text-sm mt-1">Histórico completo de ações no sistema</p>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-sm transition-colors">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por usuário, ação, recurso..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#C78C00]" />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }}
            className="bg-slate-800 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-sm text-white focus:outline-none focus:border-[#C78C00]">
            <option value="">Todas as ações</option>
            {Object.keys(ACTION_COLORS).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left py-3 px-4">Data/Hora</th>
              <th className="text-left py-3 px-4">Usuário</th>
              <th className="text-left py-3 px-4">Ação</th>
              <th className="text-left py-3 px-4">Recurso</th>
              <th className="text-left py-3 px-4">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="py-8 text-center text-slate-500">Carregando...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-slate-500">Nenhum log encontrado.</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="border-b border-white/5 hover:bg-white/3 text-sm">
                <td className="py-2.5 px-4 text-slate-400 font-mono text-xs whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString('pt-BR')}
                </td>
                <td className="py-2.5 px-4 text-slate-200">
                  {log.user ? `${log.user.firstName} ${log.user.lastName}` : <span className="text-slate-500 italic">Sistema</span>}
                  {log.user?.email && <div className="text-xs text-slate-500">{log.user.email}</div>}
                </td>
                <td className="py-2.5 px-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] || 'text-slate-400 bg-white/5'}`}>
                    {log.action}
                  </span>
                </td>
                <td className="py-2.5 px-4 text-slate-400 text-xs font-mono">
                  {log.resourceType}{log.resourceId ? `#${log.resourceId.slice(0, 8)}` : ''}
                  {log.details && (
                    <div className="text-slate-600 truncate max-w-[200px]" title={JSON.stringify(log.details)}>
                      {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-4 text-slate-500 font-mono text-xs">{log.ipAddress || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} registros</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40">
              <ChevronLeft size={14} />
            </button>
            <span className="text-slate-300 px-2">Página {page} de {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded border border-white/10 text-slate-400 hover:bg-white/5 disabled:opacity-40">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
