import { useState } from 'react';
import {
  Mail, Save, RefreshCw, Send, Server, Bell,
  CheckCircle, XCircle, Cloud, Link, Unlink, Info,
  UserPlus, KeyRound, LogIn, Smartphone, ShieldAlert, Eye,
} from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api.js';

const PROVIDERS = [
  {
    id: 'smtp',
    label: 'SMTP Personalizado',
    description: 'Qualquer servidor SMTP (Outlook, Postfix, etc.)',
    icon: Server,
  },
  {
    id: 'office365',
    label: 'Microsoft 365',
    description: 'Envio via OAuth2 com conta corporativa Microsoft',
    icon: Cloud,
  },
];

const NOTIFICATION_EVENTS = [
  {
    key: 'notifyNewUser',
    label: 'Novo usuário cadastrado',
    description: 'E-mail de boas-vindas com instruções de acesso.',
    icon: UserPlus,
  },
  {
    key: 'notifyPasswordReset',
    label: 'Redefinição de senha',
    description: 'Link de redefinição e confirmação da troca.',
    icon: KeyRound,
  },
  {
    key: 'notifyFailedLogin',
    label: 'Falha de login',
    description: 'Alerta ao usuário após tentativas malsucedidas.',
    icon: LogIn,
  },
  {
    key: 'notifyNewDevice',
    label: 'Novo dispositivo detectado',
    description: 'Notifica quando o acesso ocorre de dispositivo desconhecido.',
    icon: Smartphone,
  },
  {
    key: 'notifyAdminAlert',
    label: 'Alertas críticos do administrador',
    description: 'Eventos de segurança graves enviados ao admin.',
    icon: ShieldAlert,
  },
  {
    key: 'notifyCredentialView',
    label: 'Visualização de credencial sensível',
    description: 'Registra e notifica quando uma senha é revelada.',
    icon: Eye,
  },
];

export default function SettingsEmailPage() {
  const [provider, setProvider] = useState('smtp');
  const [emailEnabled, setEmailEnabled] = useState(true);

  const [smtp, setSmtp] = useState({
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
  });

  const [office365, setOffice365] = useState({
    tenantId: '',
    clientId: '',
    clientSecret: '',
  });

  const [sender, setSender] = useState({
    fromName: 'VaultGuard',
    fromEmail: '',
  });

  const [notifications, setNotifications] = useState(
    Object.fromEntries(NOTIFICATION_EVENTS.map(e => [e.key, e.key !== 'notifyFailedLogin']))
  );

  const [testEmail, setTestEmail] = useState('');
  const [testStatus, setTestStatus] = useState(null);

  /* ── OAuth status (Office 365) ── */
  const { data: o365Status, refetch: refetchO365Status } = useQuery({
    queryKey: ['o365-status'],
    queryFn: () => api.get('/settings/email/office365/status').then(r => r.data),
    enabled: provider === 'office365',
    retry: false,
  });
  const o365Connected = o365Status?.connected === true;

  /* ── Mutations ── */
  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: data => api.put('/settings/email', data),
    onSuccess: () => toast.success('Configurações de e-mail salvas!'),
    onError: () => toast.error('Erro ao salvar configurações.'),
  });

  const { mutate: startOAuth, isPending: isAuthenticating } = useMutation({
    mutationFn: () =>
      api
        .post('/settings/email/office365/authorize', {
          tenantId: office365.tenantId,
          clientId: office365.clientId,
          clientSecret: office365.clientSecret,
        })
        .then(r => r.data),
    onSuccess: data => {
      if (data?.authUrl) window.open(data.authUrl, '_blank', 'width=600,height=700');
      // Poll for connection after user completes OAuth
      const poll = setInterval(async () => {
        const status = await api.get('/settings/email/office365/status').then(r => r.data);
        if (status?.connected) {
          clearInterval(poll);
          refetchO365Status();
          toast.success('Microsoft 365 conectado com sucesso!');
        }
      }, 2000);
      setTimeout(() => clearInterval(poll), 120000);
    },
    onError: () => toast.error('Erro ao iniciar autenticação. Verifique as credenciais.'),
  });

  const { mutate: revokeOAuth, isPending: isRevoking } = useMutation({
    mutationFn: () => api.delete('/settings/email/office365/revoke'),
    onSuccess: () => {
      refetchO365Status();
      toast.success('Conexão com Microsoft 365 revogada.');
    },
    onError: () => toast.error('Erro ao revogar conexão.'),
  });

  const { mutate: testConnection, isPending: isTesting } = useMutation({
    mutationFn: () => api.post('/settings/email/test', { to: testEmail }),
    onSuccess: () => {
      setTestStatus('success');
      toast.success('E-mail de teste enviado!');
    },
    onError: () => {
      setTestStatus('error');
      toast.error('Falha ao enviar e-mail de teste.');
    },
  });

  const handleSave = () => {
    save({
      emailEnabled,
      provider,
      smtp: provider === 'smtp' ? smtp : undefined,
      office365Credentials: provider === 'office365' ? office365 : undefined,
      ...sender,
      ...notifications,
    });
  };

  /* ── Shared styles ── */
  const inputClass =
    'w-full px-3 py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus:ring-1';
  const inputStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };
  const labelClass = 'block text-sm font-medium mb-1.5';
  const labelStyle = { color: 'var(--color-text-muted)' };

  /* ── Sub-components ── */
  const Section = ({ icon: Icon, title, children, faded }) => (
    <div
      className="rounded-2xl p-6 transition-opacity"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        opacity: faded ? 0.45 : 1,
        pointerEvents: faded ? 'none' : undefined,
      }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--color-surface-2)' }}>
          <Icon className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
        </div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {title}
        </h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const Toggle = ({ label, description, value, onChange, disabled }) => (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-40' : ''}`}>
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none"
        style={{ background: value ? 'var(--color-primary)' : 'var(--color-surface-2)' }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: value ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Mail className="w-6 h-6" style={{ color: 'var(--color-primary)' }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            E-mail / SMTP
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Servidor de envio e notificações automáticas do sistema
          </p>
        </div>
      </div>

      <div className="space-y-5">

        {/* ── Master toggle ── */}
        <div
          className="rounded-2xl p-5 flex items-center justify-between gap-6"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Habilitar envio de e-mails
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Quando desabilitado, o sistema não envia nenhum e-mail, independente das configurações abaixo.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEmailEnabled(v => !v)}
            className="relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none"
            style={{ background: emailEnabled ? 'var(--color-primary)' : 'var(--color-surface-2)' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: emailEnabled ? 'translateX(24px)' : 'translateX(0)' }}
            />
          </button>
        </div>

        {/* ── Provider selection ── */}
        <Section icon={Server} title="Provedor de E-mail" faded={!emailEnabled}>
          <div className="grid grid-cols-2 gap-3">
            {PROVIDERS.map(p => {
              const Icon = p.icon;
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className="flex items-start gap-3 p-4 rounded-xl text-left transition-all"
                  style={{
                    background: active ? `${getComputedStyle(document.documentElement).getPropertyValue('--color-primary') || '#6366f1'}22` : 'var(--color-surface-2)',
                    border: `1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  }}
                >
                  <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-muted)' }} />
                  <div>
                    <div className="text-sm font-medium" style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                      {p.label}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {p.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ── SMTP fields ── */}
        {provider === 'smtp' && (
          <Section icon={Server} title="Configuração SMTP" faded={!emailEnabled}>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className={labelClass} style={labelStyle}>Host SMTP</label>
                <input
                  className={inputClass} style={inputStyle}
                  value={smtp.host}
                  onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))}
                  placeholder="smtp.empresa.com"
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Porta</label>
                <input
                  type="number" className={inputClass} style={inputStyle}
                  value={smtp.port}
                  onChange={e => setSmtp(s => ({ ...s, port: Number(e.target.value) }))}
                  placeholder="587"
                />
              </div>
            </div>

            <Toggle
              label="TLS / STARTTLS"
              description="Recomendado para porta 587. Use 465 para SSL puro."
              value={smtp.secure}
              onChange={v => setSmtp(s => ({ ...s, secure: v }))}
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>Usuário SMTP</label>
                <input
                  className={inputClass} style={inputStyle}
                  value={smtp.user}
                  onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))}
                  placeholder="noreply@empresa.com"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Senha SMTP</label>
                <input
                  type="password" className={inputClass} style={inputStyle}
                  value={smtp.password}
                  onChange={e => setSmtp(s => ({ ...s, password: e.target.value }))}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            </div>
          </Section>
        )}

        {/* ── Office 365 OAuth2 ── */}
        {provider === 'office365' && (
          <Section icon={Cloud} title="Microsoft 365 — OAuth2" faded={!emailEnabled}>
            {/* Status badge */}
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{
                background: o365Connected ? '#10b98115' : 'var(--color-surface-2)',
                border: `1px solid ${o365Connected ? '#10b98144' : 'var(--color-border)'}`,
              }}
            >
              {o365Connected ? (
                <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#10b981' }} />
              ) : (
                <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: o365Connected ? '#10b981' : 'var(--color-text-muted)' }}>
                  {o365Connected
                    ? `Conectado como ${o365Status?.email || 'conta Microsoft'}`
                    : 'Não conectado'}
                </div>
                {o365Connected && o365Status?.expiresAt && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    Token válido até {new Date(o365Status.expiresAt).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
              {o365Connected && (
                <button
                  onClick={() => revokeOAuth()}
                  disabled={isRevoking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: '#ef444415', color: '#ef4444', border: '1px solid #ef444433' }}
                >
                  {isRevoking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                  Revogar
                </button>
              )}
            </div>

            {/* Info box */}
            <div
              className="flex gap-3 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary)' }} />
              <div className="space-y-1">
                <p>Registre um <strong style={{ color: 'var(--color-text)' }}>App no Azure AD</strong> com permissão <code className="px-1 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>Mail.Send</code> (Microsoft Graph).</p>
                <p>Na configuração do App, adicione o URI de redirecionamento:<br />
                  <code className="px-1 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
                    {window.location.origin}/api/settings/email/office365/callback
                  </code>
                </p>
              </div>
            </div>

            {/* Credentials */}
            <div>
              <label className={labelClass} style={labelStyle}>ID do Tenant (Directory ID)</label>
              <input
                className={inputClass} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}
                value={office365.tenantId}
                onChange={e => setOffice365(s => ({ ...s, tenantId: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>ID do Aplicativo (Client ID)</label>
              <input
                className={inputClass} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}
                value={office365.clientId}
                onChange={e => setOffice365(s => ({ ...s, clientId: e.target.value }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Client Secret</label>
              <input
                type="password"
                className={inputClass} style={inputStyle}
                value={office365.clientSecret}
                onChange={e => setOffice365(s => ({ ...s, clientSecret: e.target.value }))}
                placeholder="••••••••••••••••••••••••••••••"
                autoComplete="new-password"
              />
            </div>

            <button
              onClick={() => startOAuth()}
              disabled={isAuthenticating || !office365.tenantId || !office365.clientId || !office365.clientSecret}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #0078d4, #106ebe)',
                color: '#fff',
              }}
            >
              {isAuthenticating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Link className="w-4 h-4" />
              )}
              {o365Connected ? 'Reconectar com Microsoft' : 'Conectar com Microsoft 365'}
            </button>
          </Section>
        )}

        {/* ── Sender ── */}
        <Section icon={Mail} title="Remetente" faded={!emailEnabled}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Nome do Remetente</label>
              <input
                className={inputClass} style={inputStyle}
                value={sender.fromName}
                onChange={e => setSender(s => ({ ...s, fromName: e.target.value }))}
                placeholder="VaultGuard"
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>E-mail Remetente</label>
              <input
                type="email" className={inputClass} style={inputStyle}
                value={sender.fromEmail}
                onChange={e => setSender(s => ({ ...s, fromEmail: e.target.value }))}
                placeholder="noreply@empresa.com"
              />
            </div>
          </div>
        </Section>

        {/* ── Notifications ── */}
        <Section icon={Bell} title="Enviar E-mail nas Ações" faded={!emailEnabled}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Defina quais ações no sistema disparam envio automático de e-mail.
          </p>

          {NOTIFICATION_EVENTS.map((event, i) => {
            const Icon = event.icon;
            return (
              <div key={event.key}>
                {i > 0 && <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />}
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--color-surface-2)' }}
                    >
                      <Icon className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {event.label}
                      </div>
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {event.description}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setNotifications(n => ({ ...n, [event.key]: !n[event.key] }))
                    }
                    className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none"
                    style={{
                      background: notifications[event.key]
                        ? 'var(--color-primary)'
                        : 'var(--color-surface-2)',
                    }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                      style={{
                        transform: notifications[event.key]
                          ? 'translateX(20px)'
                          : 'translateX(0)',
                      }}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </Section>

        {/* ── Test ── */}
        <Section icon={Send} title="Testar Configuração" faded={!emailEnabled}>
          <div>
            <label className={labelClass} style={labelStyle}>Enviar e-mail de teste para</label>
            <div className="flex gap-2">
              <input
                type="email" className={inputClass} style={inputStyle}
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="seu@email.com"
              />
              <button
                onClick={() => { setTestStatus(null); testConnection(); }}
                disabled={isTesting || !testEmail}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all disabled:opacity-50"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Testar
              </button>
            </div>
          </div>

          {testStatus && (
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
              style={{
                background: testStatus === 'success' ? '#10b98115' : '#ef444415',
                border: `1px solid ${testStatus === 'success' ? '#10b98144' : '#ef444444'}`,
                color: testStatus === 'success' ? '#10b981' : '#ef4444',
              }}
            >
              {testStatus === 'success'
                ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
                : <XCircle className="w-4 h-4 flex-shrink-0" />}
              {testStatus === 'success'
                ? 'E-mail enviado com sucesso! Verifique a caixa de entrada.'
                : 'Falha no envio. Verifique as configurações do provedor.'}
            </div>
          )}
        </Section>
      </div>

      {/* Save */}
      <div className="flex justify-end mt-6">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configurações
        </button>
      </div>
    </div>
  );
}
