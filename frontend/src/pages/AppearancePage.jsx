import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paintbrush, Upload, Eye, Save, RotateCcw, Image, Sun, Moon } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useSettingsStore } from '../stores/settingsStore';

const DEFAULT_DARK = {
  primaryColor: '#C78C00',
  accentColor: '#AD7B04',
  bgColor: '',
  surfaceColor: '',
  themeMode: 'dark',
};

const DEFAULT_LIGHT = {
  primaryColor: '#C78C00',
  accentColor: '#AD7B04',
  bgColor: '',
  surfaceColor: '',
  themeMode: 'light',
};

export default function AppearancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { settings, loadSettings, applyTheme } = useSettingsStore();
  const logoRef = useRef();
  const faviconRef = useRef();

  const [form, setForm] = useState({
    siteName: settings?.siteName || 'VaultGuard',
    primaryColor: settings?.primaryColor || DEFAULT_DARK.primaryColor,
    accentColor: settings?.accentColor || DEFAULT_DARK.accentColor,
    bgColor: settings?.bgColor || '',
    surfaceColor: settings?.surfaceColor || '',
    themeMode: settings?.themeMode || 'dark',
  });

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings', form),
    onSuccess: () => {
      toast.success('Aparência salva com sucesso!');
      loadSettings();
      qc.invalidateQueries(['settings']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erro ao salvar'),
  });

  const uploadLogo = useMutation({
    mutationFn: (file) => {
      const fd = new FormData(); fd.append('logo', file);
      return api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { toast.success('Logo atualizado!'); loadSettings(); },
    onError: () => toast.error('Erro ao fazer upload do logo'),
  });

  const uploadFavicon = useMutation({
    mutationFn: (file) => {
      const fd = new FormData(); fd.append('favicon', file);
      return api.post('/settings/favicon', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { toast.success('Favicon atualizado!'); loadSettings(); },
    onError: () => toast.error('Erro ao fazer upload do favicon'),
  });

  const applyPreview = () => {
    applyTheme({ ...settings, ...form });
    toast.success('Preview ativo! Salve para tornar permanente.');
  };

  const resetDefaults = () => {
    const defaults = form.themeMode === 'light' ? DEFAULT_LIGHT : DEFAULT_DARK;
    const next = { ...form, ...defaults };
    setForm(next);
    applyTheme({ ...settings, ...next });
    toast('Cores redefinidas para o padrão VaultGuard');
  };

  const toggleTheme = (mode) => {
    const next = { ...form, themeMode: mode };
    setForm(next);
    applyTheme({ ...settings, ...next });
  };

  const ColorPicker = ({ label, field, description }) => (
    <div className="flex items-center justify-between py-3 border-b border-white/5">
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</div>
        {description && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{description}</div>}
      </div>
      <div className="flex items-center gap-3">
        <input type="text" value={form[field]}
          onChange={e => setForm({ ...form, [field]: e.target.value })}
          className="w-28 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-[#C78C00]"
          style={{ color: 'var(--color-text)' }} />
        <div className="relative w-10 h-10 rounded-lg border border-white/20 overflow-hidden cursor-pointer"
          style={{ backgroundColor: form[field] || 'var(--color-primary)' }}>
          <input type="color" value={form[field] || '#C78C00'}
            onChange={e => setForm({ ...form, [field]: e.target.value })}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Paintbrush size={24} style={{ color: 'var(--color-primary)' }} /> Aparência
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Personalize a identidade visual do sistema
        </p>
      </div>

      {/* Tema Claro / Escuro */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Tema
        </h2>
        <div className="flex gap-3">
          <button
            onClick={() => toggleTheme('dark')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
              form.themeMode === 'dark' ? 'border-[#C78C00]' : 'border-white/10 hover:border-white/20'
            }`}
            style={{
              background: form.themeMode === 'dark' ? 'rgba(199,140,0,0.10)' : 'transparent',
              color: form.themeMode === 'dark' ? '#C78C00' : 'var(--color-text-muted)',
            }}
          >
            <Moon size={16} /> Escuro
          </button>
          <button
            onClick={() => toggleTheme('light')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
              form.themeMode === 'light' ? 'border-[#C78C00]' : 'border-white/10 hover:border-white/20'
            }`}
            style={{
              background: form.themeMode === 'light' ? 'rgba(199,140,0,0.10)' : 'transparent',
              color: form.themeMode === 'light' ? '#C78C00' : 'var(--color-text-muted)',
            }}
          >
            <Sun size={16} /> Claro
          </button>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
          O dourado da marca permanece o mesmo nos dois temas
        </p>
      </div>

      {/* Identidade */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Identidade
        </h2>
        <div>
          <label className="text-sm mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>Nome do Sistema</label>
          <input value={form.siteName} onChange={e => setForm({ ...form, siteName: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#C78C00] max-w-xs"
            style={{ color: 'var(--color-text)' }}
            placeholder="VaultGuard" />
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Aparece na aba do navegador e no cabeçalho
          </p>
        </div>
      </div>

      {/* Logos */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Logos
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm mb-2 block" style={{ color: 'var(--color-text-muted)' }}>Logo Principal</label>
            <div className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-[#C78C00]/50 transition-colors cursor-pointer"
              onClick={() => logoRef.current?.click()}>
              {settings?.logoUrl
                ? <img src={settings.logoUrl} alt="logo" className="h-12 mx-auto object-contain mb-2" />
                : <Image size={32} className="mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />}
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>PNG, SVG, JPG — max 2MB</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-primary)' }}>Clique para trocar</p>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && uploadLogo.mutate(e.target.files[0])} />
          </div>
          <div>
            <label className="text-sm mb-2 block" style={{ color: 'var(--color-text-muted)' }}>Favicon</label>
            <div className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-[#C78C00]/50 transition-colors cursor-pointer"
              onClick={() => faviconRef.current?.click()}>
              {settings?.faviconUrl
                ? <img src={settings.faviconUrl} alt="favicon" className="h-12 mx-auto object-contain mb-2" />
                : <Image size={32} className="mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />}
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>ICO, PNG — 32x32px ideal</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-primary)' }}>Clique para trocar</p>
            </div>
            <input ref={faviconRef} type="file" accept="image/*,.ico" className="hidden"
              onChange={e => e.target.files?.[0] && uploadFavicon.mutate(e.target.files[0])} />
          </div>
        </div>
      </div>

      {/* Cores */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Paleta de Cores
          </h2>
          <button onClick={resetDefaults} className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity"
            style={{ color: 'var(--color-text-muted)' }}>
            <RotateCcw size={12} /> Restaurar padrão
          </button>
        </div>

        <ColorPicker label="Cor Primária (Dourado)" field="primaryColor" description="Botões, links, destaques" />
        <ColorPicker label="Cor de Acento (Dourado Escuro)" field="accentColor" description="Gradientes e bordas ativas" />

        {/* Preview */}
        <div className="mt-5 p-4 rounded-xl border border-white/10 bg-black/20">
          <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Preview dos elementos</p>
          <div className="flex gap-3 flex-wrap items-center">
            <button className="px-4 py-2 rounded-lg text-xs font-semibold"
              style={{ background: form.primaryColor, color: '#000' }}>
              Botão Primário
            </button>
            <button className="px-4 py-2 rounded-lg text-xs font-medium border"
              style={{ borderColor: form.primaryColor, color: form.primaryColor, background: 'transparent' }}>
              Outline
            </button>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: `${form.primaryColor}22`, color: form.primaryColor }}>
              Badge
            </span>
            <div className="px-3 py-1.5 rounded-lg text-xs border"
              style={{
                background: 'var(--color-surface)',
                borderColor: `${form.primaryColor}40`,
                color: 'var(--color-text)',
              }}>
              Card
            </div>
          </div>
          <div className="mt-3 h-1 rounded-full"
            style={{ background: `linear-gradient(135deg, ${form.accentColor}, ${form.primaryColor}, #FFB400)` }} />
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <button onClick={applyPreview}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--color-text-muted)' }}>
          <Eye size={14} /> Visualizar
        </button>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'var(--color-primary)', color: '#000' }}>
          <Save size={14} /> {saveMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
}
