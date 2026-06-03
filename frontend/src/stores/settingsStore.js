import { create } from 'zustand';
import api from '../utils/api.js';

export const useSettingsStore = create((set, get) => ({
  settings: {
    siteName: 'VaultGuard',
    siteSubtitle: 'Cofre de Senhas Corporativo',
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#6366f1',
    accentColor: '#8b5cf6',
    bgColor: '#0f0f1a',
    surfaceColor: '#1a1a2e',
    defaultLanguage: 'pt-BR',
  },
  loaded: false,

  loadSettings: async () => {
    try {
      const { data } = await api.get('/settings');
      set({ settings: data, loaded: true });
      get().applyTheme(data);
    } catch (err) {
      set({ loaded: true });
    }
  },

  applyTheme: (settings) => {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', settings.primaryColor || '#6366f1');
    root.style.setProperty('--color-accent', settings.accentColor || '#8b5cf6');
    root.style.setProperty('--color-bg', settings.bgColor || '#0f0f1a');
    root.style.setProperty('--color-surface', settings.surfaceColor || '#1a1a2e');
    
    // Compute surface-2 as slightly lighter
    root.style.setProperty('--color-surface-2', adjustColor(settings.surfaceColor || '#1a1a2e', 15));
    root.style.setProperty('--color-border', hexToRgba(settings.primaryColor || '#6366f1', 0.12));

    // Update favicon
    if (settings.faviconUrl) {
      const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
      link.rel = 'icon';
      link.href = settings.faviconUrl;
      document.head.appendChild(link);
    }

    // Update title
    if (settings.siteName) {
      document.title = settings.siteName;
    }
  },

  updateSettings: (updates) => {
    set(state => ({ settings: { ...state.settings, ...updates } }));
    get().applyTheme({ ...get().settings, ...updates });
  },
}));

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgba(hex, alpha) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
