import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download, Upload, Shield, FileText, Lock, Eye, EyeOff,
  CheckCircle, AlertTriangle, RefreshCw, Key, Paperclip,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { getMasterKey } from '../stores/authStore.js';
import { encryptVault, decryptVault, decryptPassword, encryptPassword } from '../utils/crypto.js';

// ────────────────────────────────────────────────────────────────────────────
// Encrypted Vault Export
// ────────────────────────────────────────────────────────────────────────────
function VaultExportSection({ settings }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (!passphrase) { toast.error('Informe uma senha para o arquivo'); return; }
    if (passphrase !== confirmPass) { toast.error('As senhas não coincidem'); return; }
    if (passphrase.length < 8) { toast.error('A senha deve ter no mínimo 8 caracteres'); return; }

    setLoading(true);
    try {
      const { data } = await api.get('/credentials/vault-export');
      const masterKey = getMasterKey();

      const plainCredentials = await Promise.all(
        data.credentials.map(async (cred) => {
          let plainPassword = '';
          try { plainPassword = await decryptPassword(cred.encryptedPass, masterKey); } catch { /* */ }
          const { encryptedPass, ...rest } = cred;
          return { ...rest, plainPassword };
        })
      );

      const vaultData = {
        version: 1,
        exportedAt: data.exportedAt,
        credentials: plainCredentials,
      };

      const encrypted = await encryptVault(vaultData, passphrase);
      const blob = new Blob([encrypted], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultguard-backup-${new Date().toISOString().split('T')[0]}.vaultguard`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Cofre exportado com sucesso! (${plainCredentials.length} credenciais)`);
      setPassphrase('');
      setConfirmPass('');
    } catch (err) {
      toast.error('Erro ao exportar: ' + (err.message || 'erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl p-6" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${settings.primaryColor}22` }}>
          <Lock className="w-5 h-5" style={{ color: settings.primaryColor }} />
        </div>
        <div>
          <h2 className="font-semibold">Exportar Cofre Criptografado</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Arquivo .vaultguard protegido por senha — use para backup offline ou migração
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            Senha de proteção do arquivo *
          </label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              className="w-full pl-3 pr-10 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Mínimo 8 caracteres"
            />
            <button type="button" onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            Confirmar senha *
          </label>
          <input
            type={showPass ? 'text' : 'password'}
            value={confirmPass}
            onChange={e => setConfirmPass(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{
              background: 'var(--color-surface-2)',
              border: `1px solid ${confirmPass && confirmPass !== passphrase ? '#ef4444' : 'var(--color-border)'}`,
              color: 'var(--color-text)'
            }}
            placeholder="Repita a senha"
          />
          {confirmPass && confirmPass !== passphrase && (
            <p className="text-xs mt-1 text-red-400">As senhas não coincidem</p>
          )}
        </div>
      </div>

      <div className="rounded-xl p-3 mb-5 flex items-start gap-2"
        style={{ background: `${settings.primaryColor}11`, border: `1px solid ${settings.primaryColor}33` }}>
        <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: settings.primaryColor }} />
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          As senhas são descriptografadas localmente no seu navegador e o arquivo é criptografado com
          AES-256-GCM + PBKDF2. O servidor não vê as senhas em texto claro.
          <strong className="block mt-1" style={{ color: 'var(--color-text)' }}>
            Guarde a senha do arquivo em local seguro — sem ela não é possível recuperar os dados.
          </strong>
        </p>
      </div>

      <button
        onClick={handleExport}
        disabled={loading || !passphrase || passphrase !== confirmPass}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {loading ? 'Exportando...' : 'Exportar Cofre'}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Encrypted Vault Import
// ────────────────────────────────────────────────────────────────────────────
function VaultImportSection({ settings }) {
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [targetFolderId, setTargetFolderId] = useState('');
  const fileRef = useRef(null);

  const { data: foldersRaw = { shared: [], personal: [] } } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get('/folders').then(r => r.data),
  });

  const folders = Array.isArray(foldersRaw) ? foldersRaw : [
    ...(foldersRaw.shared || []),
    ...(foldersRaw.personal || []),
  ];
  const allFolders = flattenFolders(folders);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) { setSelectedFile(file); setPreview(null); setResult(null); }
    e.target.value = '';
  };

  const handleDecrypt = async () => {
    if (!selectedFile || !passphrase) { toast.error('Selecione um arquivo e informe a senha'); return; }
    setLoading(true);
    try {
      const text = await selectedFile.text();
      const data = await decryptVault(text, passphrase);
      setPreview(data);
      toast.success(`Arquivo aberto! ${data.credentials?.length || 0} credenciais encontradas.`);
    } catch (err) {
      toast.error(err.message || 'Erro ao abrir arquivo');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview || !targetFolderId) { toast.error('Selecione uma pasta de destino'); return; }
    setImporting(true);
    try {
      const masterKey = getMasterKey();
      const rows = await Promise.all(
        (preview.credentials || []).map(async (cred) => {
          let encryptedPass = '';
          try { encryptedPass = await encryptPassword(cred.plainPassword || '', masterKey); } catch { encryptedPass = ''; }
          return {
            title: cred.title,
            username: cred.username,
            encryptedPass,
            url: cred.url,
            notes: cred.notes,
            tags: Array.isArray(cred.tags) ? cred.tags.join(';') : (cred.tags || ''),
            customFields: cred.customFields || [],
          };
        })
      );

      const { data } = await api.post('/credentials/import', { rows, folderId: targetFolderId });
      setResult(data);
      toast.success(`${data.imported} credenciais importadas!`);
      if (data.errors?.length) toast.error(`${data.errors.length} erros durante a importação`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao importar');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-2xl p-6" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#10b98122' }}>
          <Upload className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="font-semibold">Importar Cofre Criptografado</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Restaure um arquivo .vaultguard exportado anteriormente
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            Arquivo .vaultguard
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer hover:bg-white/5 transition-colors"
            style={{ border: '2px dashed var(--color-border)' }}>
            <Paperclip className="w-5 h-5" style={{ color: 'var(--color-muted)' }} />
            <span className="text-sm" style={{ color: selectedFile ? 'var(--color-text)' : 'var(--color-muted)' }}>
              {selectedFile ? selectedFile.name : 'Clique para selecionar o arquivo'}
            </span>
            <input ref={fileRef} type="file" accept=".vaultguard,.json" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            Senha do arquivo
          </label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              className="w-full pl-3 pr-10 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Senha usada na exportação"
            />
            <button type="button" onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={handleDecrypt}
          disabled={loading || !selectedFile || !passphrase}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
          {loading ? 'Abrindo arquivo...' : 'Abrir arquivo'}
        </button>
      </div>

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: '#10b98115', border: '1px solid #10b98133' }}>
            <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-400">Arquivo válido!</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {preview.credentials?.length || 0} credenciais •{' '}
                Exportado em {preview.exportedAt ? new Date(preview.exportedAt).toLocaleString('pt-BR') : '—'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Pasta de destino *
            </label>
            <select value={targetFolderId} onChange={e => setTargetFolderId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">Selecione uma pasta</option>
              {allFolders.map(f => (
                <option key={f.id} value={f.id}>{'  '.repeat(f.level)}{f.isPersonal ? '🔒 ' : ''}{f.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleImport}
            disabled={importing || !targetFolderId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? 'Importando...' : `Importar ${preview.credentials?.length || 0} credenciais`}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl p-3 space-y-1"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">{result.imported} importadas com sucesso</span>
          </div>
          {result.errors?.length > 0 && (
            <div className="flex items-start gap-2 mt-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-yellow-400">{result.errors.length} erros:</p>
                {result.errors.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Linha {e.row}: {e.error}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CSV Export
// ────────────────────────────────────────────────────────────────────────────
function CsvExportSection({ settings }) {
  const [loading, setLoading] = useState(false);

  const handleCsvExport = async () => {
    setLoading(true);
    try {
      const response = await api.get('/credentials/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultguard-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exportado (sem senhas)');
    } catch { toast.error('Erro ao exportar CSV'); }
    finally { setLoading(false); }
  };

  return (
    <div className="rounded-2xl p-6" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#f59e0b22' }}>
          <FileText className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="font-semibold">Exportar CSV</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Lista de credenciais sem senhas (para auditorias e relatórios)
          </p>
        </div>
      </div>

      <div className="rounded-xl p-3 mb-4 flex items-start gap-2"
        style={{ background: '#f59e0b11', border: '1px solid #f59e0b33' }}>
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          O CSV <strong>não contém senhas</strong>. Use o Exportar Cofre Criptografado para backup completo.
        </p>
      </div>

      <button
        onClick={handleCsvExport}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {loading ? 'Exportando...' : 'Baixar CSV'}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main Export Page
// ────────────────────────────────────────────────────────────────────────────
export default function ExportPage() {
  const settings = useSettingsStore(s => s.settings);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Exportar / Importar</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Faça backup do seu cofre ou restaure a partir de um arquivo criptografado.
        </p>
      </div>
      <VaultExportSection settings={settings} />
      <VaultImportSection settings={settings} />
      <CsvExportSection settings={settings} />
    </div>
  );
}

function flattenFolders(folders, level = 0) {
  const result = [];
  for (const f of folders) {
    result.push({ ...f, level });
    if (f.children?.length) result.push(...flattenFolders(f.children, level + 1));
  }
  return result;
}
