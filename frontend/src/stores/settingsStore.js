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

export const useSettingsStore = create((set, get) => ({
  settings: {
    siteName: 'VaultGuard',
    siteSubtitle: 'Cofre de Senhas Corporativo',
    logoUrl: '/logo.png',
    faviconUrl: '/logo.png',
    primaryColor: '#C78C00',
    accentColor: '#AD7B04',
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
        themeMode: data.themeMode || 'dark',
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

    const primary = settings.primaryColor || '#C78C00';
    const accent = settings.accentColor || '#AD7B04';
    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-accent', accent);
    root.style.setProperty('--color-primary-hover', '#FFB400');
    root.style.setProperty('--color-primary-light', '#E7A300');
    root.style.setProperty('--color-primary-rgb', '199, 140, 0');

    if (settings.bgColor) root.style.setProperty('--color-bg', settings.bgColor);
    if (settings.surfaceColor) root.style.setProperty('--color-surface', settings.surfaceColor);

    const faviconHref = settings.faviconUrl || '/logo.png';
    const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = faviconHref;
    document.head.appendChild(link);

    if (settings.siteName) document.title = settings.siteName;
  },

  updateSettings: (updates) => {
    const next = { ...get().settings, ...updates };
    set({ settings: next });
    get().applyTheme(next);
  },
}));
