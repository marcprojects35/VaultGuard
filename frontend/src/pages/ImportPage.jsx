import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, AlertTriangle, CheckCircle, Download, X, RefreshCw, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';

const CSV_TEMPLATE = `Título,Usuário,Senha,URL,Tags,Notas
Gmail Corporativo,usuario@empresa.com,SenhaSuperForte@123,https://gmail.com,"email;google","Conta corporativa principal"
VPN Empresa,admin,senha456,https://vpn.empresa.com.br,vpn,Acesso à rede interna
Servidor Linux,root,,192.168.1.10,servidor;"linux","SSH porta 22"
`;

const IMPORT_FORMATS = [
  { id: 'vaultguard', label: 'VaultGuard CSV', ext: '.csv', desc: 'Formato nativo do VaultGuard' },
  { id: 'lastpass', label: 'LastPass CSV', ext: '.csv', desc: 'Exportado do LastPass (Export > CSV)' },
  { id: 'bitwarden', label: 'Bitwarden JSON', ext: '.json', desc: 'Exportado do Bitwarden (Export > .json)' },
  { id: 'keepass', label: 'KeePass CSV', ext: '.csv', desc: 'Exportado do KeePass (File > Export > CSV)' },
  { id: 'chrome', label: 'Google Chrome CSV', ext: '.csv', desc: 'Exportado do Chrome (Passwords > Export)' },
  { id: '1password', label: '1Password CSV', ext: '.csv', desc: 'Exportado do 1Password (Export CSV)' },
];

function flattenFolders(folders, level = 0) {
  const result = [];
  for (const f of folders) {
    result.push({ ...f, level });
    if (f.children?.length) result.push(...flattenFolders(f.children, level + 1));
  }
  return result;
}

export default function ImportPage() {
  const settings = useSettingsStore(s => s.settings);
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  const [selectedFolder, setSelectedFolder] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);
  const [fileName, setFileName] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [format, setFormat] = useState('vaultguard');

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get('/folders').then(r => r.data),
  });

  const flatFolders = flattenFolders(folders);

  const importMutation = useMutation({
    mutationFn: () => api.post('/credentials/import', {
      folderId: selectedFolder,
      rows: parsedRows,
    }),
    onSuccess: (res) => {
      setImportResult(res.data);
      qc.invalidateQueries({ queryKey: ['credentials'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      if (res.data.imported > 0) {
        toast.success(`${res.data.imported} credencial(is) importada(s)!`);
      }
      if (res.data.errors?.length > 0) {
        toast.error(`${res.data.errors.length} erro(s) durante importação`);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao importar'),
  });

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['Arquivo CSV vazio ou inválido'] };

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const rows = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0) continue;

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').replace(/^"|"$/g, '').trim();
      });

      const mapped = {
        title: row['título'] || row['title'] || row['label'] || '',
        username: row['usuário'] || row['usuario'] || row['username'] || row['login'] || '',
        password: row['senha'] || row['password'] || '',
        url: row['url'] || '',
        tags: row['tags'] || '',
        notes: row['notas'] || row['notes'] || row['description'] || row['descrição'] || '',
      };

      if (!mapped.title) {
        errors.push(`Linha ${i + 1}: título obrigatório`);
        continue;
      }

      rows.push({
        title: mapped.title,
        username: mapped.username || undefined,
        encryptedPass: mapped.password,
        url: mapped.url || undefined,
        tags: mapped.tags,
        notes: mapped.notes || undefined,
      });
    }

    return { rows, errors };
  };

  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  };

  const parseLastPassCSV = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['Arquivo vazio'] };
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').replace(/^"|"$/g, '').trim(); });
      if (!row.name && !row.url) continue;
      rows.push({
        title: row.name || row.url,
        username: row.username || row.login_username || '',
        encryptedPass: row.password || row.login_password || '',
        url: row.url || '',
        notes: row.extra || row.note || '',
        tags: row.grouping ? [row.grouping] : [],
      });
    }
    return { rows, errors: [] };
  };

  const parseBitwardenJSON = (text) => {
    try {
      const data = JSON.parse(text);
      const items = data.items || [];
      const rows = items
        .filter(item => item.type === 1) // Login type
        .map(item => ({
          title: item.name || 'Sem título',
          username: item.login?.username || '',
          encryptedPass: item.login?.password || '',
          url: item.login?.uris?.[0]?.uri || '',
          notes: item.notes || '',
          tags: item.collectionIds?.length > 0 ? ['bitwarden'] : [],
        }));
      return { rows, errors: [] };
    } catch {
      return { rows: [], errors: ['JSON inválido do Bitwarden'] };
    }
  };

  const parseKeePassCSV = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['Arquivo vazio'] };
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').replace(/^"|"$/g, '').trim(); });
      if (!row.title && !row.account) continue;
      rows.push({
        title: row.title || row.account || 'Sem título',
        username: row.username || row['login name'] || '',
        encryptedPass: row.password || '',
        url: row.url || row['web site'] || '',
        notes: row.notes || row.comment || '',
        tags: row.group ? [row.group] : [],
      });
    }
    return { rows, errors: [] };
  };

  const parseChromeCSV = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['Arquivo vazio'] };
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').replace(/^"|"$/g, '').trim(); });
      if (!row.name && !row.url) continue;
      rows.push({
        title: row.name || row.url,
        username: row.username || '',
        encryptedPass: row.password || '',
        url: row.url || '',
        notes: '',
        tags: [],
      });
    }
    return { rows, errors: [] };
  };

  const parse1PasswordCSV = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['Arquivo vazio'] };
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').replace(/^"|"$/g, '').trim(); });
      if (!row.title) continue;
      rows.push({
        title: row.title,
        username: row.username || '',
        encryptedPass: row.password || '',
        url: row.url || '',
        notes: row.notes || '',
        tags: row.tags ? row.tags.split(',').map(t => t.trim()) : [],
      });
    }
    return { rows, errors: [] };
  };

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      let result;
      switch (format) {
        case 'lastpass': result = parseLastPassCSV(text); break;
        case 'bitwarden': result = parseBitwardenJSON(text); break;
        case 'keepass': result = parseKeePassCSV(text); break;
        case 'chrome': result = parseChromeCSV(text); break;
        case '1password': result = parse1PasswordCSV(text); break;
        default: result = parseCSV(text);
      }
      setParsedRows(result.rows);
      setParseErrors(result.errors);
    };
    reader.readAsText(file, 'utf-8');
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-importacao-vaultguard.csv';
    a.click();
  };

  const reset = () => {
    setParsedRows([]);
    setParseErrors([]);
    setFileName('');
    setImportResult(null);
    setSelectedFolder('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Upload className="w-6 h-6" style={{ color: settings.primaryColor }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Importar</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Importe credenciais de um arquivo CSV
          </p>
        </div>
      </div>

      {/* Format selector */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Formato de origem</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {IMPORT_FORMATS.map(f => (
            <button key={f.id} onClick={() => { setFormat(f.id); reset(); }}
              className="p-3 rounded-xl text-left transition-all"
              style={{
                background: format === f.id ? `${settings.primaryColor}22` : 'var(--color-surface-2)',
                border: `1px solid ${format === f.id ? settings.primaryColor + '66' : 'var(--color-border)'}`,
              }}>
              <p className="text-sm font-medium" style={{ color: format === f.id ? settings.primaryColor : 'var(--color-text)' }}>{f.label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{f.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Template download (VaultGuard CSV only) */}
      {format === 'vaultguard' && (
        <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Modelo de importação</h2>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Baixe o modelo CSV e preencha com suas credenciais. Colunas: Título, Usuário, Senha, URL, Tags, Notas.
              </p>
            </div>
            <button onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <Download className="w-4 h-4" /> Baixar Modelo
            </button>
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>1. Selecione o arquivo CSV</h2>

        <div
          className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors"
          style={{ borderColor: 'var(--color-border)' }}
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = settings.primaryColor; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          onDrop={e => {
            e.preventDefault();
            e.currentTarget.style.borderColor = 'var(--color-border)';
            handleFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Arraste o arquivo CSV aqui ou <span style={{ color: settings.primaryColor }}>clique para selecionar</span>
          </p>
          <input ref={fileInputRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden"
            onChange={e => handleFile(e.target.files?.[0])} />
        </div>

        {fileName && (
          <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <FileText className="w-4 h-4" style={{ color: settings.primaryColor }} />
            <span>{fileName}</span>
            {parsedRows.length > 0 && (
              <span className="ml-1 text-xs px-2 py-0.5 rounded-full"
                style={{ background: `${settings.primaryColor}22`, color: settings.primaryColor }}>
                {parsedRows.length} linha{parsedRows.length !== 1 ? 's' : ''} válida{parsedRows.length !== 1 ? 's' : ''}
              </span>
            )}
            <button onClick={reset} className="ml-auto" style={{ color: 'var(--color-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {parseErrors.length > 0 && (
          <div className="mt-3 space-y-1">
            {parseErrors.map((err, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-red-400">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {err}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Folder selection */}
      {parsedRows.length > 0 && (
        <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>2. Selecione a pasta de destino</h2>
          <select value={selectedFolder} onChange={e => setSelectedFolder(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <option value="">— Selecione uma pasta —</option>
            {flatFolders.map(f => (
              <option key={f.id} value={f.id}>{'  '.repeat(f.level)}{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Preview */}
      {parsedRows.length > 0 && (
        <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
            3. Prévia ({parsedRows.length} ite{parsedRows.length !== 1 ? 'ns' : 'm'})
          </h2>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Título', 'Usuário', 'URL', 'Tags'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 10).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{row.title}</td>
                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--color-text-muted)' }}>{row.username || '—'}</td>
                    <td className="px-3 py-2 truncate max-w-[140px]" style={{ color: 'var(--color-text-muted)' }}>{row.url || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>{row.tags || '—'}</td>
                  </tr>
                ))}
                {parsedRows.length > 10 && (
                  <tr><td colSpan={4} className="px-3 py-2 text-center" style={{ color: 'var(--color-text-muted)' }}>
                    + {parsedRows.length - 10} linha{parsedRows.length - 10 !== 1 ? 's' : ''} adicionais
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending || !selectedFolder}
            className="mt-4 w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
            {importMutation.isPending
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Importando...</>
              : <><Upload className="w-4 h-4" /> Importar {parsedRows.length} Credencial{parsedRows.length !== 1 ? 'is' : ''}</>}
          </button>
          {!selectedFolder && (
            <p className="text-xs text-center mt-2" style={{ color: '#f59e0b' }}>Selecione uma pasta de destino para continuar.</p>
          )}
        </div>
      )}

      {/* Result */}
      {importResult && (
        <div className="rounded-2xl p-5" style={{
          background: importResult.imported > 0 ? '#10b98115' : '#ef444415',
          border: `1px solid ${importResult.imported > 0 ? '#10b98133' : '#ef444433'}`
        }}>
          <div className="flex items-center gap-3 mb-2">
            {importResult.imported > 0
              ? <CheckCircle className="w-5 h-5 text-green-400" />
              : <AlertTriangle className="w-5 h-5 text-red-400" />}
            <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
              {importResult.imported} credencial{importResult.imported !== 1 ? 'is' : ''} importada{importResult.imported !== 1 ? 's' : ''}
            </span>
          </div>
          {importResult.errors?.length > 0 && (
            <div className="mt-2 space-y-1">
              {importResult.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-400">Linha {e.row}: {e.error}</div>
              ))}
            </div>
          )}
          {importResult.imported > 0 && (
            <button onClick={reset} className="mt-3 text-sm" style={{ color: settings.primaryColor }}>
              Importar mais arquivos
            </button>
          )}
        </div>
      )}
    </div>
  );
}
