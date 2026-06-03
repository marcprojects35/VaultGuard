import { useState } from 'react';
import { SlidersHorizontal, Save, Globe, Clock, Monitor, RefreshCw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';

const TIMEZONES = [
  'America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'America/Belem',
  'America/Recife', 'America/Cuiaba', 'America/Porto_Velho', 'America/Boa_Vista',
  'America/Rio_Branco', 'America/Noronha',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Sydney',
  'UTC',
];

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
];

export default function SettingsGeneralPage() {
  const updateSettings = useSettingsStore(s => s.updateSettings);
  const currentSettings = useSettingsStore(s => s.settings);

  const [form, setForm] = useState({
    siteName: currentSettings.siteName || 'VaultGuard',
    siteSubtitle: currentSettings.siteSubtitle || 'Cofre de Senhas Corporativo',
    defaultLanguage: currentSettings.defaultLanguage || 'pt-BR',
    timezone: 'America/Sao_Paulo',
    sessionTimeout: 30,
    maxSessionAge: 8,
    maintenanceMode: false,
    allowSelfRegistration: false,
    requireEmailVerification: true,
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: data => api.put('/settings/general', data),
    onSuccess: () => {
      updateSettings({
        siteName: form.siteName,
        siteSubtitle: form.siteSubtitle,
        defaultLanguage: form.defaultLanguage,
      });
      toast.success('Configurações gerais salvas!');
    },
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

  const Section = ({ icon: Icon, title, children }) => (
    <div
      className="rounded-2xl p-6"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--color-surface-2)' }}
        >
          <Icon className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
        </div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {title}
        </h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const Toggle = ({ label, description, value, onChange }) => (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{description}</div>
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

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <SlidersHorizontal className="w-6 h-6" style={{ color: 'var(--color-primary)' }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Configurações Gerais
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Identidade e comportamento global do sistema
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Identidade */}
        <Section icon={Monitor} title="Identidade do Sistema">
          <div>
            <label className={labelClass} style={labelStyle}>Nome do Sistema</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={form.siteName}
              onChange={e => set('siteName', e.target.value)}
              placeholder="VaultGuard"
            />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>Subtítulo</label>
            <input
              className={inputClass}
              style={inputStyle}
              value={form.siteSubtitle}
              onChange={e => set('siteSubtitle', e.target.value)}
              placeholder="Cofre de Senhas Corporativo"
            />
          </div>
        </Section>

        {/* Localização */}
        <Section icon={Globe} title="Localização">
          <div>
            <label className={labelClass} style={labelStyle}>Idioma Padrão</label>
            <select
              className={inputClass}
              style={inputStyle}
              value={form.defaultLanguage}
              onChange={e => set('defaultLanguage', e.target.value)}
            >
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Idioma exibido para novos usuários. Cada usuário pode alterar individualmente.
            </p>
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>Fuso Horário</label>
            <select
              className={inputClass}
              style={inputStyle}
              value={form.timezone}
              onChange={e => set('timezone', e.target.value)}
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Usado para datas no log de auditoria e notificações.
            </p>
          </div>
        </Section>

        {/* Sessão */}
        <Section icon={Clock} title="Sessão">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={labelStyle}>Timeout por inatividade (min)</label>
              <input
                type="number"
                min={5}
                max={480}
                className={inputClass}
                style={inputStyle}
                value={form.sessionTimeout}
                onChange={e => set('sessionTimeout', Number(e.target.value))}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                Sessão encerrada após inatividade.
              </p>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Duração máxima (horas)</label>
              <input
                type="number"
                min={1}
                max={72}
                className={inputClass}
                style={inputStyle}
                value={form.maxSessionAge}
                onChange={e => set('maxSessionAge', Number(e.target.value))}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                Mesmo com atividade, requer novo login.
              </p>
            </div>
          </div>
        </Section>

        {/* Acesso */}
        <Section icon={RefreshCw} title="Acesso e Cadastro">
          <Toggle
            label="Permitir auto-cadastro"
            description="Usuários podem criar contas sem convite de administrador."
            value={form.allowSelfRegistration}
            onChange={v => set('allowSelfRegistration', v)}
          />
          <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
          <Toggle
            label="Exigir verificação de e-mail"
            description="Conta fica pendente até o usuário confirmar o e-mail."
            value={form.requireEmailVerification}
            onChange={v => set('requireEmailVerification', v)}
          />
          <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
          <Toggle
            label="Modo manutenção"
            description="Apenas administradores conseguem acessar o sistema."
            value={form.maintenanceMode}
            onChange={v => set('maintenanceMode', v)}
          />
        </Section>
      </div>

      {/* Save */}
      <div className="flex justify-end mt-6">
        <button
          onClick={() => save(form)}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: `linear-gradient(135deg, var(--color-primary), var(--color-accent))` }}
        >
          {isPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Salvar Configurações
        </button>
      </div>
    </div>
  );
}
