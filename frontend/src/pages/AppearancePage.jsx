import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paintbrush, Upload, Eye, Save, RotateCcw, Image } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useSettingsStore } from '../stores/settingsStore';

const DEFAULT_COLORS = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  accent: '#06b6d4',
  background: '#0f1117',
  surface: '#1a1d2e',
  text: '#e2e8f0',
};

export default function AppearancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { settings, loadSettings } = useSettingsStore();
  const logoRef = useRef();
  const faviconRef = useRef();

  const [form, setForm] = useState({
    siteName: settings?.siteName || 'VaultGuard',
    primaryColor: settings?.primaryColor || DEFAULT_COLORS.primary,
    secondaryColor: settings?.secondaryColor || DEFAULT_COLORS.secondary,
    accentColor: settings?.accentColor || DEFAULT_COLORS.accent,
    backgroundColor: settings?.backgroundColor || DEFAULT_COLORS.background,
    surfaceColor: settings?.surfaceColor || DEFAULT_COLORS.surface,
    textColor: settings?.textColor || DEFAULT_COLORS.text,
  });
  const [preview, setPreview] = useState(false);

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
    const root = document.documentElement;
    root.style.setProperty('--color-primary', form.primaryColor);
    root.style.setProperty('--color-secondary', form.secondaryColor);
    root.style.setProperty('--color-accent', form.accentColor);
    root.style.setProperty('--color-bg', form.backgroundColor);
    root.style.setProperty('--color-surface', form.surfaceColor);
    root.style.setProperty('--color-text', form.textColor);
    setPreview(true);
    toast.success('Preview ativo! Salve para tornar permanente.');
  };

  const resetDefaults = () => {
    setForm({ ...form, ...DEFAULT_COLORS });
    const root = document.documentElement;
    Object.entries(DEFAULT_COLORS).forEach(([k, v]) => {
      const cssVar = `--color-${k.replace('Color', '').toLowerCase()}`;
      root.style.setProperty(cssVar, v);
    });
    toast('Cores redefinidas para padrão');
  };

  const ColorPicker = ({ label, field, description }) => (
    <div className="flex items-center justify-between py-3 border-b border-white/5">
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {description && <div className="text-xs text-slate-500 mt-0.5">{description}</div>}
      </div>
      <div className="flex items-center gap-3">
        <input type="text" value={form[field]}
          onChange={e => setForm({ ...form, [field]: e.target.value })}
          className="w-28 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500" />
        <div className="relative w-10 h-10 rounded-lg border border-white/20 overflow-hidden cursor-pointer"
          style={{ backgroundColor: form[field] }}>
          <input type="color" value={form[field]}
            onChange={e => setForm({ ...form, [field]: e.target.value })}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Paintbrush size={24} className="text-indigo-400" /> Aparência
        </h1>
        <p className="text-slate-400 text-sm mt-1">Personalize a identidade visual do sistema</p>
      </div>

      {/* Nome do Sistema */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Identidade</h2>
        <div>
          <label className="text-sm text-slate-400 mb-1.5 block">Nome do Sistema</label>
          <input value={form.siteName} onChange={e => setForm({ ...form, siteName: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 max-w-xs" placeholder="VaultGuard" />
          <p className="text-xs text-slate-500 mt-1">Aparece na aba do navegador e no cabeçalho do sistema</p>
        </div>
      </div>

      {/* Logos */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Logos</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Logo Principal</label>
            <div className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-indigo-500/50 transition-colors cursor-pointer"
              onClick={() => logoRef.current?.click()}>
              {settings?.logoUrl
                ? <img src={settings.logoUrl} alt="logo" className="h-12 mx-auto object-contain mb-2" />
                : <Image size={32} className="mx-auto mb-2 text-slate-600" />}
              <p className="text-xs text-slate-500">PNG, SVG, JPG — max 2MB</p>
              <p className="text-xs text-indigo-400 mt-1">Clique para trocar</p>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && uploadLogo.mutate(e.target.files[0])} />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Favicon</label>
            <div className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-indigo-500/50 transition-colors cursor-pointer"
              onClick={() => faviconRef.current?.click()}>
              {settings?.faviconUrl
                ? <img src={settings.faviconUrl} alt="favicon" className="h-12 mx-auto object-contain mb-2" />
                : <Image size={32} className="mx-auto mb-2 text-slate-600" />}
              <p className="text-xs text-slate-500">ICO, PNG — 32x32px ideal</p>
              <p className="text-xs text-indigo-400 mt-1">Clique para trocar</p>
            </div>
            <input ref={faviconRef} type="file" accept="image/*,.ico" className="hidden"
              onChange={e => e.target.files?.[0] && uploadFavicon.mutate(e.target.files[0])} />
          </div>
        </div>
      </div>

      {/* Cores */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Paleta de Cores</h2>
          <button onClick={resetDefaults} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <RotateCcw size={12} /> Restaurar padrão
          </button>
        </div>

        <ColorPicker label="Cor Primária" field="primaryColor" description="Botões, links, destaques principais" />
        <ColorPicker label="Cor Secundária" field="secondaryColor" description="Gradientes e elementos secundários" />
        <ColorPicker label="Cor de Destaque" field="accentColor" description="Badges, status, indicadores" />
        <ColorPicker label="Cor de Fundo" field="backgroundColor" description="Background principal da página" />
        <ColorPicker label="Cor de Superfície" field="surfaceColor" description="Cards, modais, painéis" />
        <ColorPicker label="Cor do Texto" field="textColor" description="Texto principal" />

        {/* Preview visual */}
        <div className="mt-4 p-4 rounded-xl border border-white/10 bg-black/20">
          <p className="text-xs text-slate-500 mb-3">Preview dos elementos</p>
          <div className="flex gap-3 flex-wrap">
            <button className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: form.primaryColor }}>
              Botão Primário
            </button>
            <button className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: form.secondaryColor }}>
              Botão Secundário
            </button>
            <span className="px-2 py-0.5 rounded text-xs font-medium text-white" style={{ backgroundColor: form.accentColor }}>
              Badge
            </span>
            <div className="px-3 py-1.5 rounded-lg text-xs border" style={{ backgroundColor: form.surfaceColor, borderColor: `${form.primaryColor}40`, color: form.textColor }}>
              Card
            </div>
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <button onClick={applyPreview}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-lg text-sm transition-colors">
          <Eye size={14} /> Visualizar
        </button>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <Save size={14} /> {saveMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
}
