import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Server, Shield, Users, RefreshCw, Check, X, ChevronDown,
  Eye, EyeOff, Play, AlertCircle, CheckCircle, Loader, Plus, Trash2, Info,
  UserCheck, Search, UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

const ROLES = ['AUXILIAR', 'ASSISTENTE', 'ANALISTA', 'COORDENACAO', 'DIRETORIA', 'ADMINISTRADOR'];
const ROLE_LABELS = {
  AUXILIAR: 'Auxiliar', ASSISTENTE: 'Assistente', ANALISTA: 'Analista',
  COORDENACAO: 'Coordenação', DIRETORIA: 'Diretoria', ADMINISTRADOR: 'Administrador',
};

const ROLE_COLORS = {
  AUXILIAR: 'bg-slate-500/20 text-slate-300',
  ASSISTENTE: 'bg-blue-500/20 text-blue-300',
  ANALISTA: 'bg-cyan-500/20 text-cyan-300',
  COORDENACAO: 'bg-amber-500/20 text-amber-300',
  DIRETORIA: 'bg-orange-500/20 text-orange-300',
  ADMINISTRADOR: 'bg-red-500/20 text-red-300',
};

const DEFAULT_CONFIG = {
  host: '',
  port: 389,
  useTLS: false,
  verifyCert: true,
  domain: '',
  baseDn: '',
  bindDn: '',
  bindPassword: '',
  ldapOnly: false,
  syncGroups: true,
  defaultRole: 'AUXILIAR',
  userFilter: '',
  syncFilter: '',
  groupFilter: '',
  searchScope: 'sub',
  roleGroupMap: {},
  syncMaxUsers: 1000,
  timeout: 10,
};

function Field({ label, description, children }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3 border-b border-white/5 items-start">
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {description && <div className="text-xs text-slate-500 mt-0.5">{description}</div>}
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, className = '', ...props }) {
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 ${className}`}
      {...props}
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-white/10'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

const VG_STATUS_BADGE = {
  NEW:      { label: 'Novo',      cls: 'bg-indigo-500/20 text-indigo-300' },
  ACTIVE:   { label: 'Vinculado', cls: 'bg-green-500/20 text-green-300' },
  INACTIVE: { label: 'Inativo',   cls: 'bg-amber-500/20 text-amber-300' },
  PENDING:  { label: 'Pendente',  cls: 'bg-slate-500/20 text-slate-400' },
};

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function AdminLdapPage() {
  const qc = useQueryClient();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [enabled, setEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [adGroups, setAdGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [section, setSection] = useState('connection');

  // ── Estado da aba Usuários ──────────────────────────────────────────────
  const [adUsers, setAdUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState(new Set());
  const [userSearch, setUserSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState(null);

  // ── Carregar config atual ───────────────────────────────────────────────
  const { isLoading } = useQuery({
    queryKey: ['ldap-config'],
    queryFn: () => api.get('/ldap/config').then(r => r.data),
    onSuccess: (data) => {
      setEnabled(data.enabled || false);
      setConfig({ ...DEFAULT_CONFIG, ...(data.config || {}) });
    },
  });

  // ── Sync status ─────────────────────────────────────────────────────────
  const { data: syncStatus } = useQuery({
    queryKey: ['ldap-sync-status'],
    queryFn: () => api.get('/ldap/sync/status').then(r => r.data),
    refetchInterval: syncStatus?.running ? 3000 : false,
  });

  const set = (field, value) => setConfig(prev => ({ ...prev, [field]: value }));

  // ── Salvar ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => api.put('/ldap/config', { enabled, config }),
    onSuccess: () => { toast.success('Configuração LDAP salva!'); qc.invalidateQueries(['ldap-config']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao salvar'),
  });

  // ── Testar conexão ──────────────────────────────────────────────────────
  const testMutation = useMutation({
    mutationFn: () => api.post('/ldap/test', { config }),
    onSuccess: (res) => { setTestResult(res.data); },
    onError: (e) => setTestResult({ success: false, message: e.response?.data?.error || 'Erro de conexão' }),
  });

  // ── Sincronizar usuários ────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: () => api.post('/ldap/sync'),
    onSuccess: () => { toast.success('Sincronização iniciada!'); qc.invalidateQueries(['ldap-sync-status']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao sincronizar'),
  });

  // ── Usuários do AD ──────────────────────────────────────────────────────
  const loadAdUsers = async () => {
    setLoadingUsers(true);
    setAdUsers([]);
    setSelectedEmails(new Set());
    setLinkResult(null);
    try {
      const { data } = await api.get('/ldap/users/preview');
      setAdUsers(data.users);
      toast.success(`${data.total} usuários carregados do AD`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao buscar usuários');
    }
    setLoadingUsers(false);
  };

  const linkUsers = async (emails) => {
    setLinking(true);
    try {
      const { data } = await api.post('/ldap/users/link', { emails });
      setLinkResult(data);
      toast.success(`${data.created + data.updated} usuário(s) vinculado(s)`);
      await loadAdUsers();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao vincular usuários');
    }
    setLinking(false);
  };

  const toggleSelectUser = (email) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const filteredUsers = adUsers.filter(u => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return (
      u.username.includes(q) ||
      u.email.includes(q) ||
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q)
    );
  });

  const newActiveUsers = adUsers.filter(u => u.vgStatus === 'NEW' && u.active);
  const selectableFiltered = filteredUsers.filter(u => u.vgStatus === 'NEW' && u.active);

  // ── Buscar grupos do AD ──────────────────────────────────────────────────
  const loadGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await api.get('/ldap/groups');
      setAdGroups(res.data);
      toast.success(`${res.data.length} grupos carregados`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao buscar grupos');
    }
    setLoadingGroups(false);
  };

  // ── Mapeamento de grupos ─────────────────────────────────────────────────
  const addGroupMapping = () => {
    const key = `grupo_ad_${Object.keys(config.roleGroupMap || {}).length + 1}`;
    set('roleGroupMap', { ...(config.roleGroupMap || {}), [key]: 'AUXILIAR' });
  };

  const updateGroupMapping = (oldKey, newKey, role) => {
    const map = { ...(config.roleGroupMap || {}) };
    delete map[oldKey];
    map[newKey] = role;
    set('roleGroupMap', map);
  };

  const removeGroupMapping = (key) => {
    const map = { ...(config.roleGroupMap || {}) };
    delete map[key];
    set('roleGroupMap', map);
  };

  const sections = [
    { id: 'connection', label: 'Conexão', icon: Server },
    { id: 'auth', label: 'Autenticação', icon: Shield },
    { id: 'sync', label: 'Sincronização', icon: RefreshCw },
    { id: 'roles', label: 'Grupos→Cargos', icon: Users },
    { id: 'users', label: 'Usuários', icon: UserCheck },
    { id: 'advanced', label: 'Avançado', icon: ChevronDown },
  ];

  if (isLoading) return <div className="p-6 text-slate-400">Carregando...</div>;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Server size={24} className="text-indigo-400" /> Active Directory / LDAP
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Autenticação centralizada via AD. Usuários do AD fazem login com as mesmas credenciais corporativas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">LDAP {enabled ? 'Ativo' : 'Inativo'}</span>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
      </div>

      {/* Banner quando desabilitado */}
      {!enabled && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">
            LDAP está <strong>desabilitado</strong>. Configure e ative para que usuários façam login com credenciais do AD.
          </p>
        </div>
      )}

      {/* Tabs de seção */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1">
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${section === s.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <s.icon size={13} /> <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      {/* ── SEÇÃO: CONEXÃO ──────────────────────────────────────────────────── */}
      {section === 'connection' && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Servidor LDAP / Active Directory</h2>

          <Field label="Servidor (Host)" description="IP ou hostname do controlador de domínio">
            <Input value={config.host} onChange={v => set('host', v)} placeholder="192.168.0.10 ou dc.empresa.local" />
          </Field>

          <Field label="Porta" description="389 padrão LDAP · 636 para LDAPS">
            <div className="flex gap-3">
              <Input value={config.port} onChange={v => set('port', v)} type="number" className="w-24" />
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <Toggle checked={config.useTLS} onChange={v => set('useTLS', v)} />
                LDAPS (TLS)
              </label>
              {config.useTLS && (
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <Toggle checked={config.verifyCert} onChange={v => set('verifyCert', v)} />
                  Verificar certificado
                </label>
              )}
            </div>
          </Field>

          <Field label="Domínio" description="Ex: empresa.local (opcional, usado para montar UPN)">
            <Input value={config.domain} onChange={v => set('domain', v)} placeholder="empresa.local" />
          </Field>

          <Field label="Base DN" description="Raiz de busca no diretório">
            <Input value={config.baseDn} onChange={v => set('baseDn', v)} placeholder="DC=empresa,DC=local" />
          </Field>

          {/* Botão testar */}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !config.host}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-40">
              {testMutation.isPending ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
              Testar Conexão
            </button>
            {testResult && (
              <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg ${testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {testResult.success ? <CheckCircle size={14} /> : <X size={14} />}
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SEÇÃO: AUTENTICAÇÃO ─────────────────────────────────────────────── */}
      {section === 'auth' && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Conta de Serviço (Service Account)</h2>

          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 mb-4 flex gap-2">
            <Info size={14} className="text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-300">
              O VaultGuard usa esta conta para buscar usuários no AD. Crie uma conta de serviço com permissão somente leitura
              (<code className="bg-black/20 px-1 rounded">Read Members</code> no AD).
            </p>
          </div>

          <Field label="Bind DN" description="DN da conta de serviço">
            <Input value={config.bindDn} onChange={v => set('bindDn', v)}
              placeholder="CN=vaultguard-svc,OU=ServiceAccounts,DC=empresa,DC=local" />
            <p className="text-xs text-slate-500 mt-1">Ou no formato: empresa\vaultguard-svc</p>
          </Field>

          <Field label="Senha do Bind" description="Senha da conta de serviço">
            <div className="relative">
              <Input value={config.bindPassword} onChange={v => set('bindPassword', v)}
                type={showPassword ? 'text' : 'password'} placeholder="••••••••" />
              <button onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <Field label="Modo de autenticação" description="Comportamento quando o AD está disponível">
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" checked={!config.ldapOnly} onChange={() => set('ldapOnly', false)}
                  className="text-indigo-600" />
                <div>
                  <div className="text-sm text-slate-200">LDAP + Fallback Local</div>
                  <div className="text-xs text-slate-500">Se o AD falhar, usuários locais ainda podem entrar</div>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" checked={config.ldapOnly} onChange={() => set('ldapOnly', true)}
                  className="text-indigo-600" />
                <div>
                  <div className="text-sm text-slate-200">Somente LDAP</div>
                  <div className="text-xs text-slate-500">Toda autenticação passa pelo AD (exceto admin de emergência)</div>
                </div>
              </label>
            </div>
          </Field>
        </div>
      )}

      {/* ── SEÇÃO: SINCRONIZAÇÃO ────────────────────────────────────────────── */}
      {section === 'sync' && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Configurações de Sincronização</h2>

            <Field label="Sincronizar grupos" description="Atualiza o cargo do usuário automaticamente pelo grupo do AD">
              <Toggle checked={config.syncGroups !== false} onChange={v => set('syncGroups', v)} />
            </Field>

            <Field label="Cargo padrão" description="Cargo atribuído a usuários novos sem grupo mapeado">
              <select value={config.defaultRole} onChange={e => set('defaultRole', e.target.value)}
                className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>

            <Field label="Filtro de usuários" description="Filtro LDAP para sincronização em massa (padrão busca contas ativas)">
              <Input value={config.syncFilter} onChange={v => set('syncFilter', v)}
                placeholder="(&(objectClass=user)(objectCategory=person))" />
            </Field>

            <Field label="Limite de usuários" description="Máximo de usuários importados por sincronização">
              <Input value={config.syncMaxUsers} onChange={v => set('syncMaxUsers', v)} type="number" className="w-28" />
            </Field>
          </div>

          {/* Painel de execução */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300">Sincronização Manual</h2>
              <button onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || syncStatus?.running || !enabled}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors">
                {syncStatus?.running
                  ? <><Loader size={14} className="animate-spin" /> Sincronizando...</>
                  : <><RefreshCw size={14} /> Sincronizar Agora</>}
              </button>
            </div>

            {syncStatus?.lastRun && (
              <div className={`rounded-lg p-4 text-sm ${syncStatus.lastResult?.error ? 'bg-red-500/10 border border-red-500/20' : 'bg-green-500/10 border border-green-500/20'}`}>
                <div className="font-medium text-slate-200 mb-2">
                  Última sincronização: {new Date(syncStatus.lastRun).toLocaleString('pt-BR')}
                </div>
                {syncStatus.lastResult?.error ? (
                  <p className="text-red-400">{syncStatus.lastResult.error}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center"><div className="text-2xl font-bold text-green-400">{syncStatus.lastResult?.created || 0}</div><div className="text-xs text-slate-400">Criados</div></div>
                    <div className="text-center"><div className="text-2xl font-bold text-blue-400">{syncStatus.lastResult?.updated || 0}</div><div className="text-xs text-slate-400">Atualizados</div></div>
                    <div className="text-center"><div className="text-2xl font-bold text-orange-400">{syncStatus.lastResult?.disabled || 0}</div><div className="text-xs text-slate-400">Desativados</div></div>
                  </div>
                )}
                {syncStatus.lastResult?.errors?.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-500 cursor-pointer">{syncStatus.lastResult.errors.length} erros</summary>
                    <div className="mt-1 space-y-1">
                      {syncStatus.lastResult.errors.map((e, i) => (
                        <div key={i} className="text-xs text-red-400 font-mono">{e.dn}: {e.error}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SEÇÃO: MAPEAMENTO DE GRUPOS ──────────────────────────────────────── */}
      {section === 'roles' && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-300">Grupos do AD → Cargos do VaultGuard</h2>
            <div className="flex gap-2">
              <button onClick={loadGroups} disabled={loadingGroups}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-xs transition-colors">
                {loadingGroups ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Carregar grupos do AD
              </button>
              <button onClick={addGroupMapping}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs transition-colors">
                <Plus size={12} /> Adicionar
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500 mb-4">
            Define qual cargo VaultGuard um usuário recebe com base no grupo do AD. Use o CN do grupo (nome, sem o OU/DC).
            Usuários em múltiplos grupos recebem o cargo de maior privilégio.
          </p>

          {Object.keys(config.roleGroupMap || {}).length === 0 ? (
            <div className="py-8 text-center text-slate-500 border-2 border-dashed border-white/10 rounded-xl">
              <Users size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhum mapeamento configurado.</p>
              <p className="text-xs mt-1">Clique em "Adicionar" para mapear um grupo do AD a um cargo.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(config.roleGroupMap || {}).map(([group, role], idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {adGroups.length > 0 ? (
                    <select value={group}
                      onChange={e => updateGroupMapping(group, e.target.value, role)}
                      className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">
                      {adGroups.map(g => <option key={g.dn} value={g.cn.toLowerCase()}>{g.cn}</option>)}
                    </select>
                  ) : (
                    <input value={group}
                      onChange={e => updateGroupMapping(group, e.target.value.toLowerCase(), role)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                      placeholder="nome_do_grupo_ad (CN, lowercase)" />
                  )}

                  <span className="text-slate-500">→</span>

                  <select value={role}
                    onChange={e => updateGroupMapping(group, group, e.target.value)}
                    className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>

                  <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${ROLE_COLORS[role]}`}>
                    {ROLE_LABELS[role]}
                  </span>

                  <button onClick={() => removeGroupMapping(group)}
                    className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Preview de grupos do AD carregados */}
          {adGroups.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
                {adGroups.length} grupos encontrados no AD
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {adGroups.map(g => (
                  <div key={g.dn} className="flex items-center gap-2 text-xs py-1">
                    <span className="font-mono text-indigo-300">{g.cn}</span>
                    {g.description && <span className="text-slate-500">— {g.description}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── SEÇÃO: USUÁRIOS ─────────────────────────────────────────────────── */}
      {section === 'users' && (
        <div className="space-y-4">
          {/* Barra de busca + botão buscar */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Filtrar por nome, usuário ou e-mail..."
                className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={loadAdUsers}
              disabled={loadingUsers || !enabled}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {loadingUsers ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Buscar do AD
            </button>
          </div>

          {!enabled && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle size={14} className="text-amber-400 shrink-0" />
              <p className="text-sm text-amber-300">Habilite o LDAP antes de buscar usuários.</p>
            </div>
          )}

          {/* Stats */}
          {adUsers.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Total" value={adUsers.length} color="text-white" />
              <StatCard label="Novos" value={newActiveUsers.length} color="text-indigo-400" />
              <StatCard label="Vinculados" value={adUsers.filter(u => u.vgStatus === 'ACTIVE').length} color="text-green-400" />
              <StatCard label="Inativos no AD" value={adUsers.filter(u => !u.active).length} color="text-red-400" />
            </div>
          )}

          {/* Resultado da vinculação */}
          {linkResult && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-sm flex items-start gap-3">
              <CheckCircle size={16} className="text-green-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-green-300 mb-0.5">Vinculação concluída</div>
                <div className="text-slate-300">
                  {linkResult.created} criados · {linkResult.updated} atualizados · {linkResult.disabled} desativados
                  {linkResult.errors?.length > 0 && (
                    <span className="text-red-400"> · {linkResult.errors.length} erros</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tabela de usuários */}
          {adUsers.length > 0 ? (
            <>
              {/* Barra de ações */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectableFiltered.length > 0 && selectableFiltered.every(u => selectedEmails.has(u.email))}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedEmails(new Set(selectableFiltered.map(u => u.email)));
                      } else {
                        setSelectedEmails(new Set());
                      }
                    }}
                    className="rounded border-white/20"
                  />
                  {selectedEmails.size > 0
                    ? `${selectedEmails.size} selecionado(s)`
                    : `${selectableFiltered.length} novos disponíveis`}
                </label>
                <div className="flex gap-2">
                  {selectedEmails.size > 0 && (
                    <button
                      onClick={() => linkUsers([...selectedEmails])}
                      disabled={linking}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                    >
                      {linking ? <Loader size={14} className="animate-spin" /> : <UserPlus size={14} />}
                      Vincular {selectedEmails.size} selecionados
                    </button>
                  )}
                  {newActiveUsers.length > 0 && (
                    <button
                      onClick={() => linkUsers(newActiveUsers.map(u => u.email))}
                      disabled={linking}
                      className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-sm disabled:opacity-40 transition-colors"
                    >
                      {linking ? <Loader size={14} className="animate-spin" /> : <Users size={14} />}
                      Vincular todos novos ({newActiveUsers.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Tabela */}
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-sm">
                      <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-white/10">
                        <th className="pl-4 py-3 w-8" />
                        <th className="py-3 px-3">Nome</th>
                        <th className="py-3 px-3 hidden md:table-cell">Usuário</th>
                        <th className="py-3 px-3 hidden lg:table-cell">E-mail</th>
                        <th className="py-3 px-3">Cargo</th>
                        <th className="py-3 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredUsers.map(user => {
                        const selectable = user.vgStatus === 'NEW' && user.active;
                        const selected = selectedEmails.has(user.email);
                        const badge = VG_STATUS_BADGE[user.vgStatus] || VG_STATUS_BADGE.NEW;
                        return (
                          <tr
                            key={user.email}
                            onClick={() => selectable && toggleSelectUser(user.email)}
                            className={`transition-colors ${selectable ? 'cursor-pointer hover:bg-white/5' : 'opacity-50'} ${selected ? 'bg-indigo-500/10' : ''}`}
                          >
                            <td className="pl-4 py-3">
                              {selectable && (
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleSelectUser(user.email)}
                                  onClick={e => e.stopPropagation()}
                                  className="rounded border-white/20"
                                />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs font-semibold text-indigo-300 shrink-0">
                                  {(user.firstName?.[0] || user.username?.[0] || '?').toUpperCase()}
                                </div>
                                <span className="font-medium text-white leading-tight">
                                  {user.firstName} {user.lastName}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-3 hidden md:table-cell text-slate-400 font-mono text-xs">{user.username}</td>
                            <td className="py-3 px-3 hidden lg:table-cell text-slate-400 text-xs truncate max-w-[180px]">{user.email}</td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${ROLE_COLORS[user.role] || 'bg-slate-500/20 text-slate-300'}`}>
                                {ROLE_LABELS[user.role] || user.role}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${badge.cls}`}>
                                {!user.active ? 'Desativ. no AD' : badge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            !loadingUsers && (
              <div className="py-14 text-center border-2 border-dashed border-white/10 rounded-xl">
                <UserCheck size={36} className="mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400 text-sm">Clique em "Buscar do AD" para listar os usuários</p>
                <p className="text-xs text-slate-600 mt-1">
                  O sistema mostrará todos os usuários do AD e o status de cada um na plataforma.
                </p>
              </div>
            )
          )}
        </div>
      )}

      {/* ── SEÇÃO: AVANÇADO ──────────────────────────────────────────────────── */}
      {section === 'advanced' && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Configurações Avançadas</h2>

          <Field label="Filtro de usuário" description="Usado na busca por login. {login} é substituído pelo valor digitado">
            <Input value={config.userFilter} onChange={v => set('userFilter', v)}
              placeholder="(|(sAMAccountName={login})(mail={login}))" />
          </Field>

          <Field label="Filtro de grupos" description="Para listagem de grupos disponíveis">
            <Input value={config.groupFilter} onChange={v => set('groupFilter', v)}
              placeholder="(objectClass=group)" />
          </Field>

          <Field label="Escopo de busca" description="sub = toda a árvore; one = apenas um nível abaixo">
            <select value={config.searchScope} onChange={e => set('searchScope', e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">
              <option value="sub">sub (padrão)</option>
              <option value="one">one</option>
              <option value="base">base</option>
            </select>
          </Field>

          <Field label="Timeout de conexão (s)" description="Tempo máximo para respostas do servidor LDAP">
            <Input value={config.timeout} onChange={v => set('timeout', v)} type="number" className="w-24" min="3" max="60" />
          </Field>
        </div>
      )}

      {/* ── Botões de ação ──────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {saveMutation.isPending ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
          Salvar Configuração
        </button>
        <button onClick={() => { testMutation.mutate(); setSection('connection'); }}
          disabled={testMutation.isPending || !config.host}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-40">
          <Play size={14} /> Testar Agora
        </button>
      </div>
    </div>
  );
}
