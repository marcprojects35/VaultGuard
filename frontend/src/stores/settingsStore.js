import { create } from 'zustand';
import api from '../utils/api.js';

const DARK_VARS = {
  '--color-bg':            '#0C0C0C',
  '--color-bg-secondary':  '#111111',
  '--color-surface':       '#161616',
  '--color-surface-2':     '#1E1E1E',
  '--color-surface-hover': '#252525',
  '--color-border':        '#2A2A2A',
  '--color-text':          '#F0F0EE',
  '--color-text-muted':    '#A0A09E',
  '--color-muted':         '#636360',
  '--color-success':       '#22C55E',
  '--color-warning':       '#F59E0B',
  '--color-danger':        '#EF4444',
};

const LIGHT_VARS = {
  '--color-bg':            '#F5F4EF',
  '--color-bg-secondary':  '#EDECE7',
  '--color-surface':       '#FFFFFF',
  '--color-surface-2':     '#F8F7F3',
  '--color-surface-hover': '#F0EFE9',
  '--color-border':        '#E4E2DC',
  '--color-text':          '#1A1916',
  '--color-text-muted':    '#706F6A',
  '--color-muted':         '#9C9B97',
  '--color-success':       '#16A34A',
  '--color-warning':       '#D97706',
  '--color-danger':        '#DC2626',
};

const DEFAULT_PRIMARY = '#C78C00';
const DEFAULT_ACCENT = '#AD7B04';

// Aceita #rgb e #rrggbb (com ou sem alfa) e devolve [r, g, b]; cor inválida usa o padrão
function parseHex(hex, fallback) {
  let c = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(c)) c = c.slice(0, 3).split('').map(x => x + x).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return fallback ? parseHex(fallback) : [0, 0, 0];
  return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
}

const toHex = (rgb) => '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (rgb, target, amount) => rgb.map((v, i) => v + (target[i] - v) * amount);

// Luminância relativa (WCAG) para escolher texto claro ou escuro sobre a cor da marca
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function normalizeHex(hex, fallback) {
  return toHex(parseHex(hex, fallback));
}

export const useSettingsStore = create((set, get) => ({
  settings: {
    siteName: 'VaultGuard',
    siteSubtitle: 'Cofre de Senhas Corporativo',
    logoUrl: '/logo.png',
    faviconUrl: '/logo.png',
    primaryColor: DEFAULT_PRIMARY,
    accentColor: DEFAULT_ACCENT,
    loginBackgroundUrl: '',
    loginOverlay: 55,
    loginMessage: '',
    bgColor: '',
    surfaceColor: '',
    themeMode: 'dark',
    defaultLanguage: 'pt-BR',
  },
  loaded: false,

  loadSettings: async () => {
    try {
      const { data } = await api.get('/settings');
      const merged = {
        ...get().settings,
        ...data,
        logoUrl: data.logoUrl || '/logo.png',
        faviconUrl: data.faviconUrl || '/logo.png',
        primaryColor: normalizeHex(data.primaryColor, DEFAULT_PRIMARY),
        accentColor: normalizeHex(data.accentColor, DEFAULT_ACCENT),
        loginBackgroundUrl: data.loginBackgroundUrl || '',
        loginOverlay: Number.isFinite(data.loginOverlay) ? data.loginOverlay : 55,
        loginMessage: data.loginMessage || '',
        appBackgroundUrl: data.appBackgroundUrl || '',
        appOverlay: Number.isFinite(data.appOverlay) ? data.appOverlay : 80,
        themeMode: data.themeMode || 'dark',
        bgColor: data.bgColor || '',
        surfaceColor: data.surfaceColor || '',
      };
      set({ settings: merged, loaded: true });
      get().applyTheme(merged);
    } catch {
      set({ loaded: true });
      get().applyTheme(get().settings);
    }
  },

  applyTheme: (settings) => {
    const root = document.documentElement;
    const mode = settings.themeMode || 'dark';

    root.setAttribute('data-theme', mode);

    const themeVars = mode === 'light' ? LIGHT_VARS : DARK_VARS;
    Object.entries(themeVars).forEach(([k, v]) => root.style.setProperty(k, v));

    const primary = parseHex(settings.primaryColor, DEFAULT_PRIMARY);
    const accent = parseHex(settings.accentColor, DEFAULT_ACCENT);
    const white = [255, 255, 255];
    const vars = {
      '--color-primary': toHex(primary),
      '--color-accent': toHex(accent),
      '--color-primary-light': toHex(mix(primary, white, 0.18)),
      '--color-primary-hover': toHex(mix(primary, white, 0.32)),
      '--color-primary-rgb': primary.join(', '),
      '--color-accent-rgb': accent.join(', '),
      // Texto sobre botões/gradientes da marca: escuro em cores claras, branco nas escuras
      '--color-on-primary': luminance(primary) > 0.45 ? '#111111' : '#FFFFFF',
    };
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

    // Fundo/cartões personalizados: os tons vizinhos (barra lateral, campos, bordas)
    // saem das cores escolhidas, e o texto acompanha a claridade do fundo
    if (settings.bgColor || settings.surfaceColor) {
      const bg = parseHex(settings.bgColor || themeVars['--color-bg']);
      const lightBg = luminance(bg) > 0.4;
      const surface = parseHex(settings.surfaceColor || (lightBg ? '#FFFFFF' : toHex(mix(bg, [255, 255, 255], 0.05))));
      const shade = lightBg ? [0, 0, 0] : [255, 255, 255];
      const text = lightBg ? LIGHT_VARS : DARK_VARS;
      const custom = {
        '--color-bg': toHex(bg),
        '--color-bg-secondary': toHex(mix(bg, shade, 0.035)),
        '--color-surface': toHex(surface),
        '--color-surface-2': toHex(mix(surface, shade, lightBg ? 0.025 : 0.04)),
        '--color-surface-hover': toHex(mix(surface, shade, lightBg ? 0.05 : 0.08)),
        '--color-border': toHex(mix(surface, shade, lightBg ? 0.11 : 0.14)),
        '--color-text': text['--color-text'],
        '--color-text-muted': text['--color-text-muted'],
        '--color-muted': text['--color-muted'],
      };
      Object.entries(custom).forEach(([k, v]) => root.style.setProperty(k, v));
      // Regras do tema claro/escuro (index.css) seguem o fundo real
      root.setAttribute('data-theme', lightBg ? 'light' : 'dark');
    }

    // Canais do fundo final, para camadas translúcidas sobre a imagem de fundo
    root.style.setProperty('--app-bg-overlay', String(Math.min(95, Math.max(0, Number(settings.appOverlay ?? 80))) / 100));
    root.style.setProperty('--color-bg-rgb', parseHex(root.style.getPropertyValue('--color-bg'), '#0c0c0c').join(', '));

    const faviconHref = settings.faviconUrl || '/logo.png';
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      document.head.appendChild(link);
    }
    link.rel = 'icon';
    link.removeAttribute('type'); // o navegador detecta png/webp/ico pelo conteúdo
    link.href = faviconHref;

    if (settings.siteName) document.title = settings.siteName;
  },

  updateSettings: (updates) => {
    const next = { ...get().settings, ...updates };
    set({ settings: next });
    get().applyTheme(next);
  },
}));
