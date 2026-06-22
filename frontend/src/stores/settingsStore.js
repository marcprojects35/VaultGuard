import { create } from 'zustand';
import api from '../utils/api.js';

const DARK_VARS = {
  '--color-bg': '#0A0A0A',
  '--color-bg-secondary': '#121212',
  '--color-surface': '#181818',
  '--color-surface-2': '#222222',
  '--color-surface-hover': '#222222',
  '--color-border': '#2A2A2A',
  '--color-text': '#F5F5F5',
  '--color-text-muted': '#A8A8A8',
  '--color-muted': '#707070',
  '--color-success': '#22C55E',
  '--color-warning': '#F59E0B',
  '--color-danger': '#EF4444',
};

const LIGHT_VARS = {
  '--color-bg': '#FAFAFA',
  '--color-bg-secondary': '#F3F4F6',
  '--color-surface': '#FFFFFF',
  '--color-surface-2': '#F8F8F8',
  '--color-surface-hover': '#F8F8F8',
  '--color-border': '#E5E7EB',
  '--color-text': '#111827',
  '--color-text-muted': '#4B5563',
  '--color-muted': '#6B7280',
  '--color-success': '#16A34A',
  '--color-warning': '#D97706',
  '--color-danger': '#DC2626',
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
