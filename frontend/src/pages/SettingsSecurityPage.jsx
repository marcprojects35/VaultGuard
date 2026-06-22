import { useState } from 'react';
import { ShieldCheck, Save, RefreshCw, Lock, AlertTriangle, Smartphone, Eye } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';

export default function SettingsSecurityPage() {
  const currentSettings = useSettingsStore(s => s.settings);
  const policy = currentSettings.passwordPolicy || {};

  const [form, setForm] = useState({
    minPasswordLength: policy.minLength || 10,
    requireUppercase: policy.requireUppercase ?? true,
    requireNumbers: policy.requireNumbers ?? true,
    requireSymbols: policy.requireSymbols ?? true,
    passwordExpireDays: policy.expireDays || 90,
    preventPasswordReuse: policy.preventReuse || 5,
    maxLoginAttempts: currentSettings.maxLoginAttempts || 5,
    lockoutDurationMin: policy.lockoutDurationMin || 15,
    require2FA: currentSettings.require2FA || false,
    allow2FARecovery: true,
    logFailedLogins: true,
    alertOnNewDevice: true,
    allowedIPs: '',
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: data => api.put('/settings/security', data),
    onSuccess: () => toast.success('Configurações de segurança salvas!'),
    onError: () => toast.error('Erro ao salvar configurações.'),
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const inputClass =
    'w-full px-3 py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus:ring-1';
  const inputStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };
  const labelClass = 'block text-sm font-medium mb-1.5';
  const labelStyle = { color: 'var(--color-text-muted)' };

  const Section = ({ icon: Icon, title, children, danger }) => (
    <div
      className="rounded-2xl p-6"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${danger ? '#ef444433' : 'var(--color-border)'}`,
      }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: danger ? '#ef444422' : 'var(--color-surface-2)' }}
        >
          <Icon className="w-5 h-5" style={{ color: danger ? '#ef4444' : 'var(--color-primary)' }} />
        </div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {title}
        </h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const Toggle = ({ label, description, value, onChange, warn }) => (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: warn ? '#f59e0b' : 'var(--color-text-muted)' }}>
            {description}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
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

  const strengthIndicator = () => {
    const len = form.minPasswordLength;
    const opts = [form.requireUppercase, form.requireNumbers, form.requireSymbols].filter(Boolean).length;
    const score = (len >= 12 ? 2 : len >= 8 ? 1 : 0) + opts;
    if (score >= 4) return { label: 'Forte', color: '#10b981' };
    if (score >= 2) return { label: 'Moderada', color: '#f59e0b' };
    return { label: 'Fraca', color: '#ef4444' };
  };
  const strength = strengthIndicator();

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <ShieldCheck className="w-6 h-6" style={{ color: 'var(--color-primary)' }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Segurança
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Políticas de acesso, senhas e autenticação
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Política de senhas */}
        <Section icon={Lock} title="Política de Senhas">
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Força da política atual
            </span>
            <span className="text-sm font-semibold" style={{ color: strength.color }}>
              {strength.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Comprimento mínimo</label>
              <input
                type="number"
                min={6}
                max={64}
                className={inputClass}
                style={inputStyle}
                value={form.minPasswordLength}
                onChange={e => set('minPasswordLength', Number(e.target.value))}
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Expirar após (dias)</label>
              <input
                type="number"
                min={0}
                max={365}
                className={inputClass}
                style={inputStyle}
                value={form.passwordExpireDays}
                onChange={e => set('passwordExpireDays', Number(e.target.value))}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>0 = nunca</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Toggle
              label="Exigir letra maiúscula"
              value={form.requireUppercase}
              onChange={v => set('requireUppercase', v)}
            />
            <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
            <Toggle
              label="Exigir número"
              value={form.requireNumbers}
              onChange={v => set('requireNumbers', v)}
            />
            <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
            <Toggle
              label="Exigir símbolo especial"
              value={form.requireSymbols}
              onChange={v => set('requireSymbols', v)}
            />
            <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>
              Impedir reutilização das últimas N senhas
            </label>
            <input
              type="number"
              min={0}
              max={24}
              className={inputClass}
              style={inputStyle}
              value={form.preventPasswordReuse}
              onChange={e => set('preventPasswordReuse', Number(e.target.value))}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>0 = sem restrição</p>
          </div>
        </Section>

        {/* Bloqueio de conta */}
        <Section icon={AlertTriangle} title="Proteção contra Força Bruta">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Máx. tentativas de login</label>
              <input
                type="number"
                min={1}
                max={20}
                className={inputClass}
                style={inputStyle}
                value={form.maxLoginAttempts}
                onChange={e => set('maxLoginAttempts', Number(e.target.value))}
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Duração do bloqueio (min)</label>
              <input
                type="number"
                min={1}
                max={1440}
                className={inputClass}
                style={inputStyle}
                value={form.lockoutDurationMin}
                onChange={e => set('lockoutDurationMin', Number(e.target.value))}
              />
            </div>
          </div>
          <Toggle
            label="Registrar logins com falha no audit log"
            value={form.logFailedLogins}
            onChange={v => set('logFailedLogins', v)}
          />
        </Section>

        {/* 2FA */}
        <Section icon={Smartphone} title="Autenticação em Dois Fatores (2FA)">
          <Toggle
            label="Exigir 2FA para todos os usuários"
            description="Usuários sem 2FA configurado serão redirecionados ao setup no próximo login."
            value={form.require2FA}
            onChange={v => set('require2FA', v)}
            warn
          />
          <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
          <Toggle
            label="Permitir códigos de recuperação"
            description="Usuários podem gerar códigos backup para acesso sem o app autenticador."
            value={form.allow2FARecovery}
            onChange={v => set('allow2FARecovery', v)}
          />
        </Section>

        {/* Monitoramento */}
        <Section icon={Eye} title="Monitoramento de Acesso">
          <Toggle
            label="Alertar ao detectar novo dispositivo"
            description="Envia notificação quando login ocorre de um dispositivo não reconhecido."
            value={form.alertOnNewDevice}
            onChange={v => set('alertOnNewDevice', v)}
          />
          <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
          <div>
            <label className={labelClass} style={labelStyle}>
              IPs permitidos (whitelist)
            </label>
            <textarea
              className={inputClass}
              style={{ ...inputStyle, resize: 'vertical', minHeight: '80px', fontFamily: 'monospace' }}
              value={form.allowedIPs}
              onChange={e => set('allowedIPs', e.target.value)}
              placeholder={'192.168.1.0/24\n10.0.0.0/8\n# Deixe vazio para permitir todos'}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Um IP ou bloco CIDR por linha. Vazio = sem restrição.
            </p>
          </div>
        </Section>
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={() => save(form)}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}
        >
          {isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configurações
        </button>
      </div>
    </div>
  );
}
