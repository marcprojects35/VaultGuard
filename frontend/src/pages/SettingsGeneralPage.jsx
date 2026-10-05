import { useState } from 'react';
import { SlidersHorizontal, Save, Globe, Clock, Monitor, RefreshCw, Mail } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useSettingsStore } from '../stores/settingsStore.js';

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
    sessionTimeout: currentSettings.sessionTimeout || 480,
    supportEmail: currentSettings.supportEmail || '',
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: data => api.put('/settings/general', data),
    onSuccess: () => {
      updateSettings({
        siteName: form.siteName,
        siteSubtitle: form.siteSubtitle,
        defaultLanguage: form.defaultLanguage,
        sessionTimeout: form.sessionTimeout,
        supportEmail: form.supportEmail || null,
      });
      toast.success('Configurações gerais salvas!');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao salvar configurações.'),
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
        </Section>

        {/* Sessão */}
        <Section icon={Clock} title="Sessão">
          <div>
            <label className={labelClass} style={labelStyle}>Duração da sessão (minutos)</label>
            <input
              type="number"
              min={5}
              max={10080}
              className={inputClass}
              style={inputStyle}
              value={form.sessionTimeout}
              onChange={e => set('sessionTimeout', Number(e.target.value))}
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Depois desse tempo é preciso entrar de novo. O cofre também bloqueia ao recarregar a página.
            </p>
          </div>
        </Section>

        {/* Suporte */}
        <Section icon={Mail} title="Suporte">
          <div>
            <label className={labelClass} style={labelStyle}>E-mail de suporte</label>
            <input
              type="email"
              className={inputClass}
              style={inputStyle}
              value={form.supportEmail}
              onChange={e => set('supportEmail', e.target.value)}
              placeholder="ti@suaempresa.com"
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Aparece na tela de login e no botão "Suporte" do menu. Vazio = não exibe.
            </p>
          </div>
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
