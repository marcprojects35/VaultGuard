import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Shield, AlertTriangle, FileText, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';

function flattenFolders(folders, level = 0) {
  const result = [];
  for (const f of folders) {
    result.push({ ...f, level });
    if (f.children?.length) result.push(...flattenFolders(f.children, level + 1));
  }
  return result;
}

export default function ExportPage() {
  const settings = useSettingsStore(s => s.settings);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [search, setSearch] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get('/folders').then(r => r.data),
  });

  const { data: previewData } = useQuery({
    queryKey: ['credentials-count', selectedFolder, search],
    queryFn: () => api.get('/credentials', {
      params: {
        folderId: selectedFolder || undefined,
        search: search || undefined,
      }
    }).then(r => r.data),
  });

  const flatFolders = flattenFolders(folders);
  const count = previewData?.length ?? 0;

  const handleExport = async () => {
    if (!confirmed) {
      toast.error('Confirme que entende os riscos antes de exportar.');
      return;
    }
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (selectedFolder) params.append('folderId', selectedFolder);
      if (search) params.append('search', search);

      const token = JSON.parse(localStorage.getItem('vaultguard-auth') || '{}')?.state?.token;
      const response = await fetch(`/api/credentials/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Erro ao exportar');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultguard-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${count} credencial(is) exportada(s)`);
    } catch (e) {
      toast.error('Erro ao exportar credenciais');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Download className="w-6 h-6" style={{ color: settings.primaryColor }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Exportar</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Exporte suas credenciais para um arquivo CSV
          </p>
        </div>
      </div>

      {/* Warning */}
      <div className="rounded-2xl p-4 mb-5 flex items-start gap-3"
        style={{ background: '#f59e0b15', border: '1px solid #f59e0b33' }}>
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-400">Atenção: Dados Sensíveis</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            O arquivo exportado contém senhas em texto simples. Mantenha-o protegido e exclua após o uso.
            Nunca compartilhe ou envie por e-mail sem criptografia.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Filter className="w-4 h-4" /> Filtros (opcional)
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pasta</label>
            <select value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">Todas as pastas</option>
              {flatFolders.map(f => (
                <option key={f.id} value={f.id}>{'  '.repeat(f.level)}{f.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pesquisa por título</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Filtrar por título..." />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5" style={{ color: settings.primaryColor }} />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {count} credencial{count !== 1 ? 'is' : ''} {count !== 1 ? 'serão' : 'será'} exportada{count !== 1 ? 's' : ''}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Formato CSV — sem senhas criptografadas (apenas metadados e senha em texto)
            </div>
          </div>
        </div>
      </div>

      {/* Confirm */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded" style={{ accentColor: settings.primaryColor }} />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Entendo que o arquivo exportado contém senhas em texto simples e é responsabilidade minha
            mantê-lo seguro. Farei a exclusão segura do arquivo após o uso.
          </span>
        </label>
      </div>

      {/* Export button */}
      <button
        onClick={handleExport}
        disabled={isExporting || count === 0 || !confirmed}
        className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
        <Download className="w-4 h-4" />
        {isExporting ? 'Exportando...' : `Exportar ${count} Credencial${count !== 1 ? 'is' : ''}`}
      </button>
    </div>
  );
}
