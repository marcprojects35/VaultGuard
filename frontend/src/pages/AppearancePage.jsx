import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Paintbrush, Save, RotateCcw, Image, Sun, Moon, Trash2, Upload, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useSettingsStore, normalizeHex } from '../stores/settingsStore';

const DEFAULT_COLORS = { primaryColor: '#c78c00', accentColor: '#ad7b04', bgColor: '', surfaceColor: '' };
const MAX_UPLOAD_MB = 10;

// Temas prontos: um clique preenche tema e cores (o administrador ainda ajusta e salva)
const PRESETS = [
  { name: 'Dourado', themeMode: 'dark', primaryColor: '#c78c00', accentColor: '#ad7b04', bgColor: '', surfaceColor: '' },
  { name: 'Azul e branco', themeMode: 'light', primaryColor: '#1d4ed8', accentColor: '#1e3a8a', bgColor: '#f1f5f9', surfaceColor: '#ffffff' },
  { name: 'Azul noturno', themeMode: 'dark', primaryColor: '#3b82f6', accentColor: '#1d4ed8', bgColor: '#0b1220', surfaceColor: '#111a2e' },
  { name: 'Verde e branco', themeMode: 'light', primaryColor: '#15803d', accentColor: '#14532d', bgColor: '#f0fdf4', surfaceColor: '#ffffff' },
  { name: 'Esmeralda', themeMode: 'dark', primaryColor: '#10b981', accentColor: '#047857', bgColor: '#07130f', surfaceColor: '#0d1f19' },
  { name: 'Vermelho e branco', themeMode: 'light', primaryColor: '#dc2626', accentColor: '#991b1b', bgColor: '#fafafa', surfaceColor: '#ffffff' },
  { name: 'Roxo', themeMode: 'dark', primaryColor: '#8b5cf6', accentColor: '#6d28d9', bgColor: '#0f0b1a', surfaceColor: '#17122a' },
  { name: 'Laranja', themeMode: 'light', primaryColor: '#ea580c', accentColor: '#9a3412', bgColor: '#fffaf5', surfaceColor: '#ffffff' },
  { name: 'Grafite', themeMode: 'light', primaryColor: '#334155', accentColor: '#0f172a', bgColor: '#f8fafc', surfaceColor: '#ffffff' },
  { name: 'Turquesa', themeMode: 'dark', primaryColor: '#06b6d4', accentColor: '#0e7490', bgColor: '#071417', surfaceColor: '#0c1f24' },
];
const PRESET_KEYS = ['themeMode', 'primaryColor', 'accentColor', 'bgColor', 'surfaceColor'];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Imagens enviadas por esta página: rota no backend e campo em settings
const IMAGES = {
  logo: { field: 'logoUrl', formField: 'logo', label: 'Logo', hint: 'PNG, SVG, JPG ou WEBP. Fundo transparente fica melhor.' },
  favicon: { field: 'faviconUrl', formField: 'favicon', label: 'Favicon', hint: 'ICO ou PNG quadrado (ícone da aba do navegador).' },
  'login-background': { field: 'loginBackgroundUrl', formField: 'image', label: 'Imagem de fundo do login', hint: 'JPG ou PNG em paisagem, de preferência 1920×1080 ou maior.' },
  'app-background': { field: 'appBackgroundUrl', formField: 'image', label: 'Imagem de fundo da aplicação', hint: 'Fica atrás das telas internas. Imagens suaves funcionam melhor.' },
};

const card = 'bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-5';
const input = 'w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]';

function pickForm(s) {
  return {
    siteName: s.siteName || 'VaultGuard',
    siteSubtitle: s.siteSubtitle || '',
    primaryColor: normalizeHex(s.primaryColor, DEFAULT_COLORS.primaryColor),
    accentColor: normalizeHex(s.accentColor, DEFAULT_COLORS.accentColor),
    bgColor: s.bgColor || '',
    surfaceColor: s.surfaceColor || '',
    themeMode: s.themeMode === 'light' ? 'light' : 'dark',
    loginOverlay: Number.isFinite(s.loginOverlay) ? s.loginOverlay : 55,
    loginMessage: s.loginMessage || '',
    appOverlay: Number.isFinite(s.appOverlay) ? s.appOverlay : 80,
  };
}

// O formulário só nasce depois que as configurações chegam do servidor: com os
// valores padrão, um "Salvar" sobrescreveria a personalização existente
export default function AppearancePage() {
  const loaded = useSettingsStore(s => s.loaded);
  return loaded ? <AppearanceForm /> : null;
}

function AppearanceForm() {
  const { settings, loadSettings, applyTheme, updateSettings } = useSettingsStore();
  const [form, setForm] = useState(() => pickForm(settings));
  const fileRefs = { logo: useRef(), favicon: useRef(), 'login-background': useRef() };
  const saved = useRef(settings);
  saved.current = settings;

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));
  const colorsValid = ['primaryColor', 'accentColor', 'bgColor', 'surfaceColor']
    .every(k => form[k] === '' && (k === 'bgColor' || k === 'surfaceColor') || HEX.test(form[k]));

  // Pré-visualização ao vivo: aplica as cores enquanto edita (só cores válidas)
  useEffect(() => {
    if (colorsValid) applyTheme({ ...saved.current, ...form });
  }, [form.primaryColor, form.accentColor, form.bgColor, form.surfaceColor, form.themeMode, form.appOverlay, colorsValid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saiu sem salvar: volta ao tema salvo
  useEffect(() => () => applyTheme(saved.current), []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.put('/settings', {
      ...form,
      siteName: form.siteName.trim(),
      loginOverlay: Number(form.loginOverlay),
      appOverlay: Number(form.appOverlay),
    }),
    onSuccess: async ({ data }) => {
      setForm(pickForm(data));
      await loadSettings();
      toast.success('Aparência salva');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível salvar'),
  });

  const upload = useMutation({
    mutationFn: ({ kind, file }) => {
      const fd = new FormData();
      fd.append(IMAGES[kind].formField, file);
      return api.post(`/settings/${kind}`, fd, { timeout: 120000 });
    },
    onSuccess: ({ data }, { kind }) => {
      updateSettings(data);
      toast.success(`${IMAGES[kind].label} atualizado`);
    },
    onError: (e, { kind }) => toast.error(e.response?.data?.error || `Erro ao enviar ${IMAGES[kind].label.toLowerCase()}`),
  });

  const remove = useMutation({
    mutationFn: (kind) => api.delete(`/settings/${kind}`),
    onSuccess: async (_, kind) => {
      await loadSettings();
      toast.success(`${IMAGES[kind].label} removido`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Não foi possível remover'),
  });

  const onFile = (kind, e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite enviar o mesmo arquivo de novo
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. O limite é ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    upload.mutate({ kind, file });
  };

  const resetColors = () => setForm(f => ({ ...f, ...DEFAULT_COLORS }));

  const renderColor = ({ label, field, description, optional }) => {
    const valid = HEX.test(form[field]) || (optional && form[field] === '');
    const swatch = HEX.test(form[field]) ? normalizeHex(form[field]) : null;
    return (
      <div key={field} className="flex items-center justify-between gap-4 py-3 border-b border-[var(--color-border)] last:border-0">
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</div>
          <div className="text-xs mt-0.5" style={{ color: valid ? 'var(--color-muted)' : 'var(--color-danger)' }}>
            {valid ? description : 'Use o formato #RRGGBB'}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {optional && form[field] && (
            <button type="button" onClick={() => set(field, '')} className="text-xs hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Usar do tema
            </button>
          )}
          <input type="text" value={form[field]} placeholder={optional ? 'do tema' : '#RRGGBB'} data-testid={`color-${field}`}
            onChange={e => set(field, e.target.value.trim())}
            className="w-24 bg-[var(--color-surface)] border rounded px-2 py-1 text-xs font-mono focus:outline-none"
            style={{ color: 'var(--color-text)', borderColor: valid ? 'var(--color-border)' : 'var(--color-danger)' }} />
          <label className="relative w-9 h-9 rounded-lg border border-[var(--color-border)] overflow-hidden cursor-pointer"
            style={{ background: swatch || (field === 'bgColor' ? 'var(--color-bg)' : 'var(--color-surface)') }}>
            <input type="color" value={swatch || '#888888'} onChange={e => set(field, e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" aria-label={label} />
          </label>
        </div>
      </div>
    );
  };

  const renderImage = (kind, previewClass) => {
    const cfg = IMAGES[kind];
    const url = settings[cfg.field];
    const busy = (upload.isPending && upload.variables?.kind === kind) || (remove.isPending && remove.variables === kind);
    return (
      <div>
        <div className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>{cfg.label}</div>
        <button type="button" disabled={busy} onClick={() => fileRefs[kind].current?.click()}
          className="w-full border-2 border-dashed border-[var(--color-border)] rounded-xl p-4 text-center transition-colors hover:border-[var(--color-primary)] disabled:opacity-60">
          {url
            ? <img src={url} alt={cfg.label} className={`mx-auto mb-2 ${previewClass}`} />
            : <Image size={32} className="mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{cfg.hint} Até {MAX_UPLOAD_MB} MB.</p>
          <p className="text-xs mt-1 flex items-center justify-center gap-1" style={{ color: 'var(--color-primary)' }}>
            <Upload size={12} /> {busy ? 'Enviando...' : url ? 'Clique para trocar' : 'Clique para enviar'}
          </p>
        </button>
        <input ref={fileRefs[kind]} type="file" className="hidden" data-testid={`file-${kind}`}
          accept={kind === 'favicon' ? 'image/*,.ico' : 'image/*'} onChange={e => onFile(kind, e)} />
        {url && (
          <button type="button" disabled={busy} onClick={() => remove.mutate(kind)}
            className="mt-2 flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--color-text-muted)' }}>
            <Trash2 size={12} /> Voltar ao padrão
          </button>
        )}
      </div>
    );
  };

  const savedForm = pickForm(settings);
  const dirty = Object.keys(savedForm).some(k => String(savedForm[k]) !== String(form[k]));
  const overlay = Math.min(90, Math.max(0, Number(form.loginOverlay) || 0)) / 100;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Paintbrush size={24} style={{ color: 'var(--color-primary)' }} /> Aparência
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Identidade visual da empresa. As cores aparecem na hora para você conferir; salve para aplicar a todos.
        </p>
      </div>

      {/* Temas prontos */}
      <div className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>Temas prontos</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {PRESETS.map(p => {
            const active = PRESET_KEYS.every(k => (form[k] || '').toLowerCase() === p[k]);
            const bg = p.bgColor || (p.themeMode === 'light' ? '#f5f4ef' : '#0c0c0c');
            const surface = p.surfaceColor || (p.themeMode === 'light' ? '#ffffff' : '#161616');
            return (
              <button key={p.name} type="button" data-testid={`preset-${p.name}`}
                onClick={() => setForm(f => ({ ...f, ...Object.fromEntries(PRESET_KEYS.map(k => [k, p[k]])) }))}
                className="rounded-xl p-2 text-left border-2 transition-all hover:scale-[1.02]"
                style={{ borderColor: active ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="h-14 rounded-lg p-1.5 flex gap-1" style={{ background: bg }}>
                  <div className="w-3 rounded" style={{ background: surface }} />
                  <div className="flex-1 rounded p-1 flex flex-col justify-end gap-1" style={{ background: surface }}>
                    <div className="h-1.5 w-2/3 rounded" style={{ background: p.primaryColor, opacity: 0.35 }} />
                    <div className="h-2.5 rounded" style={{ background: `linear-gradient(135deg, ${p.primaryColor}, ${p.accentColor})` }} />
                  </div>
                </div>
                <div className="text-xs font-medium mt-1.5 truncate" style={{ color: 'var(--color-text)' }}>{p.name}</div>
              </button>
            );
          })}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>Clique para ver aplicado. Depois ajuste o que quiser e salve.</p>
      </div>

      {/* Tema */}
      <div className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>Tema</h2>
        <div className="flex gap-3">
          {[['dark', 'Escuro', Moon], ['light', 'Claro', Sun]].map(([mode, label, Icon]) => {
            const active = form.themeMode === mode;
            return (
              <button key={mode} type="button" onClick={() => set('themeMode', mode)} data-testid={`theme-${mode}`}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all"
                style={{
                  borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                  background: active ? 'rgba(var(--color-primary-rgb),0.10)' : 'transparent',
                  color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                }}>
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Identidade */}
      <div className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>Identidade</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>Nome do sistema</label>
            <input value={form.siteName} maxLength={100} onChange={e => set('siteName', e.target.value)}
              className={input} style={{ color: 'var(--color-text)' }} placeholder="VaultGuard" />
          </div>
          <div>
            <label className="text-sm mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>Subtítulo</label>
            <input value={form.siteSubtitle} maxLength={100} onChange={e => set('siteSubtitle', e.target.value)}
              className={input} style={{ color: 'var(--color-text)' }} placeholder="Cofre de Senhas Corporativo" />
          </div>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Aparecem na aba do navegador, no menu e na tela de login.</p>
        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          {renderImage('logo', 'h-12 object-contain')}
          {renderImage('favicon', 'h-10 w-10 object-contain')}
        </div>
      </div>

      {/* Tela de login */}
      <div className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
          <LogIn size={14} /> Tela de login
        </h2>
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-4">
            {renderImage('login-background', 'h-20 w-full object-cover rounded-lg')}
            <div>
              <label className="text-sm mb-1.5 flex justify-between" style={{ color: 'var(--color-text-muted)' }}>
                <span>Escurecer a imagem</span><span>{Math.round(overlay * 100)}%</span>
              </label>
              <input type="range" min="0" max="90" step="5" value={form.loginOverlay} data-testid="login-overlay"
                onChange={e => set('loginOverlay', Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--color-primary)' }} />
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Deixa o texto legível sobre fotos claras.</p>
            </div>
            <div>
              <label className="text-sm mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>Mensagem (opcional)</label>
              <textarea value={form.loginMessage} maxLength={300} rows={2} data-testid="login-message-input"
                onChange={e => set('loginMessage', e.target.value)} className={`${input} resize-none`}
                style={{ color: 'var(--color-text)' }} placeholder="Ex.: Use o mesmo usuário e senha do computador" />
            </div>
          </div>

          {/* Miniatura da tela de login */}
          <div className="relative rounded-xl overflow-hidden border border-[var(--color-border)] min-h-[220px] flex flex-col items-center justify-center p-4"
            style={{
              background: settings.loginBackgroundUrl
                ? `linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay})), center / cover no-repeat url(${JSON.stringify(settings.loginBackgroundUrl)})`
                : 'var(--color-bg)',
            }}>
            {settings.logoUrl && <img src={settings.logoUrl} alt="" className="h-8 object-contain mb-1" />}
            <div className="text-sm font-bold" style={{ color: settings.loginBackgroundUrl ? '#fff' : 'var(--color-text)' }}>{form.siteName || 'VaultGuard'}</div>
            {form.loginMessage && (
              <div className="text-[10px] mt-1 text-center whitespace-pre-line" style={{ color: settings.loginBackgroundUrl ? 'rgba(255,255,255,0.85)' : 'var(--color-text-muted)' }}>
                {form.loginMessage}
              </div>
            )}
            <div className="mt-3 w-36 rounded-lg p-2 space-y-1.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="h-3 rounded" style={{ background: 'var(--color-surface-2)' }} />
              <div className="h-3 rounded" style={{ background: 'var(--color-surface-2)' }} />
              <div className="h-4 rounded text-[8px] font-bold flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, var(--color-primary-light), var(--color-primary), var(--color-accent))', color: 'var(--color-on-primary)' }}>
                Entrar
              </div>
            </div>
            <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>Prévia</span>
          </div>
        </div>
      </div>

      {/* Fundo da aplicação */}
      <div className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>Fundo da aplicação</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-4">
            {renderImage('app-background', 'h-20 w-full object-cover rounded-lg')}
            <div>
              <label className="text-sm mb-1.5 flex justify-between" style={{ color: 'var(--color-text-muted)' }}>
                <span>Cor do tema sobre a imagem</span><span>{form.appOverlay}%</span>
              </label>
              <input type="range" min="0" max="95" step="5" value={form.appOverlay} data-testid="app-overlay"
                onChange={e => set('appOverlay', Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--color-primary)' }} />
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Quanto maior, mais discreta a imagem e mais fácil de ler. A mudança aparece atrás desta tela.
              </p>
            </div>
          </div>
          <div className="relative rounded-xl overflow-hidden border border-[var(--color-border)] min-h-[180px] flex"
            style={{ background: 'var(--color-bg)' }}>
            {settings.appBackgroundUrl && <div className="absolute inset-0" style={{ background: `center / cover no-repeat url(${JSON.stringify(settings.appBackgroundUrl)})` }} />}
            <div className="absolute inset-0" style={{ background: `rgba(var(--color-bg-rgb), ${settings.appBackgroundUrl ? form.appOverlay / 100 : 1})` }} />
            <div className="relative w-12 m-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
            <div className="relative flex-1 p-3 space-y-2">
              <div className="h-3 w-1/2 rounded" style={{ background: 'var(--color-text)', opacity: 0.6 }} />
              <div className="h-12 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
              <div className="h-12 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
            </div>
            <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>Prévia</span>
          </div>
        </div>
      </div>

      {/* Cores */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Cores</h2>
          <button type="button" onClick={resetColors} className="flex items-center gap-1.5 text-xs hover:opacity-80" style={{ color: 'var(--color-text-muted)' }}>
            <RotateCcw size={12} /> Restaurar padrão
          </button>
        </div>
        {renderColor({ label: 'Cor principal', field: 'primaryColor', description: 'Botões, links, ícones e destaques' })}
        {renderColor({ label: 'Cor secundária', field: 'accentColor', description: 'Gradientes e bordas ativas' })}
        {renderColor({ label: 'Fundo', field: 'bgColor', description: 'Vazio usa o fundo do tema', optional: true })}
        {renderColor({ label: 'Cartões e painéis', field: 'surfaceColor', description: 'Vazio usa a cor do tema', optional: true })}

        <div className="mt-4 p-4 rounded-xl border border-[var(--color-border)]" style={{ background: 'var(--color-bg)' }}>
          <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Prévia</p>
          <div className="flex gap-3 flex-wrap items-center">
            <span className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Botão</span>
            <span className="px-4 py-2 rounded-lg text-xs font-medium border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>Contorno</span>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(var(--color-primary-rgb),0.13)', color: 'var(--color-primary)' }}>Etiqueta</span>
            <span className="px-3 py-1.5 rounded-lg text-xs border" style={{ background: 'var(--color-surface)', borderColor: 'rgba(var(--color-primary-rgb),0.25)', color: 'var(--color-text)' }}>Cartão</span>
          </div>
          <div className="mt-3 h-1 rounded-full gradient-gold" />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-6 px-6 py-3 flex items-center gap-3 border-t border-[var(--color-border)]"
        style={{ background: 'var(--color-bg)' }}>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !colorsValid || !form.siteName.trim()}
          data-testid="save-appearance"
          className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          <Save size={14} /> {save.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
        <button type="button" onClick={() => { setForm(pickForm(settings)); loadSettings(); }}
          className="px-4 py-2 rounded-lg text-sm border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
          style={{ color: 'var(--color-text-muted)' }}>
          Descartar
        </button>
        {dirty && <span className="text-xs" style={{ color: 'var(--color-warning)' }}>Alterações não salvas</span>}
      </div>
    </div>
  );
}
