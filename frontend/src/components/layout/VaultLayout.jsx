import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shield, Vault, Users, FolderOpen, ScrollText, Palette, Server,
  LogOut, Key, ChevronDown, Menu, X, Settings, Globe,
  SlidersHorizontal, ShieldCheck, Mail, ChevronRight,
  Search, Upload, Download, Star,
} from 'lucide-react';
import { useAuthStore, useIsAdmin } from '../../stores/authStore.js';
import { useSettingsStore } from '../../stores/settingsStore.js';
import { SUPPORTED_LANGUAGES } from '../../i18n/index.js';

export default function VaultLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore(s => s.logout);
  const user = useAuthStore(s => s.user);
  const isAdmin = useIsAdmin();
  const settings = useSettingsStore(s => s.settings);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(
    () => location.pathname.startsWith('/admin/settings')
  );
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith('/admin/settings')) {
      setSettingsExpanded(true);
    }
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) || SUPPORTED_LANGUAGES[0];

  const userInitials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') || '?';

  const navItem = (to, icon, label, exact = false) => (
    <NavLink
      to={to}
      end={exact}
      title={!sidebarOpen ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
          isActive ? 'text-white' : 'hover:bg-white/5'
        }`
      }
      style={({ isActive }) =>
        isActive
          ? {
              background: `linear-gradient(135deg, ${settings.primaryColor}33, ${settings.accentColor}22)`,
              color: settings.primaryColor,
              boxShadow: `0 0 0 1px ${settings.primaryColor}33`,
            }
          : { color: 'var(--color-text-muted)' }
      }
    >
      <span className="flex-shrink-0">{icon}</span>
      {sidebarOpen && <span className="truncate">{label}</span>}
    </NavLink>
  );

  const settingsNavItem = (to, icon, label) => (
    <NavLink
      to={to}
      title={!sidebarOpen ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150 ${
          sidebarOpen ? 'px-3 py-2' : 'px-3 py-2.5'
        } ${isActive ? 'text-white' : 'hover:bg-white/5'}`
      }
      style={({ isActive }) =>
        isActive
          ? {
              background: `linear-gradient(135deg, ${settings.primaryColor}33, ${settings.accentColor}22)`,
              color: settings.primaryColor,
              boxShadow: `0 0 0 1px ${settings.primaryColor}33`,
            }
          : { color: 'var(--color-text-muted)' }
      }
    >
      <span className="flex-shrink-0">{icon}</span>
      {sidebarOpen && <span className="truncate">{label}</span>}
    </NavLink>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col transition-all duration-200 flex-shrink-0"
        style={{
          width: sidebarOpen ? '240px' : '68px',
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        {/* Logo / Header */}
        <div
          className="flex items-center gap-3 p-4 border-b flex-shrink-0"
          style={{ borderColor: 'var(--color-border)', minHeight: '65px' }}
        >
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={settings.siteName}
              className="h-8 object-contain flex-shrink-0"
              style={{ maxWidth: sidebarOpen ? '140px' : '36px' }}
            />
          ) : (
            <>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})`,
                }}
              >
                <Shield className="w-5 h-5 text-white" />
              </div>
              {sidebarOpen && (
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>
                    {settings.siteName}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {settings.siteSubtitle}
                  </div>
                </div>
              )}
            </>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-text-muted)', marginLeft: sidebarOpen ? 'auto' : undefined }}
            title={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {/* Main items */}
          {navItem('/', <Vault className="w-4 h-4" />, t('nav.vault'), true)}
          {navItem('/search', <Search className="w-4 h-4" />, 'Pesquisa')}
          {navItem('/favorites', <Star className="w-4 h-4" />, 'Favoritos')}

          {/* ── Ferramentas ── */}
          <div className="pt-5 pb-1">
            {sidebarOpen ? (
              <span className="text-xs font-semibold uppercase tracking-wider px-3" style={{ color: 'var(--color-muted)' }}>
                Ferramentas
              </span>
            ) : (
              <div className="border-t mx-2 my-1" style={{ borderColor: 'var(--color-border)' }} />
            )}
          </div>
          {navItem('/import', <Upload className="w-4 h-4" />, 'Importar')}
          {navItem('/export', <Download className="w-4 h-4" />, 'Exportar')}
          {navItem('/tokens', <Key className="w-4 h-4" />, t('nav.apiTokens'))}

          {isAdmin && (
            <>
              {/* ── Administração ── */}
              <div className="pt-5 pb-1">
                {sidebarOpen ? (
                  <span
                    className="text-xs font-semibold uppercase tracking-wider px-3"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {t('nav.admin')}
                  </span>
                ) : (
                  <div className="border-t mx-2 my-1" style={{ borderColor: 'var(--color-border)' }} />
                )}
              </div>

              {navItem('/admin/users', <Users className="w-4 h-4" />, t('nav.users'))}
              {navItem('/admin/folders', <FolderOpen className="w-4 h-4" />, t('nav.folders'))}
              {navItem('/admin/audit', <ScrollText className="w-4 h-4" />, t('nav.audit'))}

              {/* ── Configurações ── */}
              <div className="pt-5 pb-1">
                {sidebarOpen ? (
                  <button
                    onClick={() => setSettingsExpanded(v => !v)}
                    className="w-full flex items-center gap-2 px-3 py-1 rounded-lg hover:bg-white/5 transition-all"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    <Settings className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wider flex-1 text-left">
                      {t('nav.settings')}
                    </span>
                    <ChevronDown
                      className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
                      style={{ transform: settingsExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </button>
                ) : (
                  <button
                    onClick={() => { setSidebarOpen(true); setSettingsExpanded(true); }}
                    className="w-full flex items-center justify-center py-1 rounded-lg hover:bg-white/5 transition-all"
                    style={{ color: 'var(--color-muted)' }}
                    title={t('nav.settings')}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Settings sub-items */}
              {(settingsExpanded || !sidebarOpen) && (
                <div
                  className="space-y-0.5"
                  style={
                    sidebarOpen
                      ? {
                          marginLeft: '10px',
                          paddingLeft: '10px',
                          borderLeft: '1px solid var(--color-border)',
                        }
                      : {}
                  }
                >
                  {settingsNavItem(
                    '/admin/settings/appearance',
                    <Palette className="w-4 h-4" />,
                    'Aparência'
                  )}
                  {settingsNavItem(
                    '/admin/settings/ldap',
                    <Server className="w-4 h-4" />,
                    'Active Directory'
                  )}
                  {settingsNavItem(
                    '/admin/settings/general',
                    <SlidersHorizontal className="w-4 h-4" />,
                    'Geral'
                  )}
                  {settingsNavItem(
                    '/admin/settings/security',
                    <ShieldCheck className="w-4 h-4" />,
                    'Segurança'
                  )}
                  {settingsNavItem(
                    '/admin/settings/email',
                    <Mail className="w-4 h-4" />,
                    'E-mail'
                  )}
                </div>
              )}
            </>
          )}
        </nav>

        {/* Bottom: language + user + logout */}
        <div className="p-3 border-t space-y-0.5 flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          {/* Language selector */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-white/5 transition-all"
              style={{ color: 'var(--color-text-muted)' }}
              title={!sidebarOpen ? 'Idioma' : undefined}
            >
              <Globe className="w-4 h-4 flex-shrink-0" />
              {sidebarOpen && (
                <>
                  <span className="flex-1 text-left truncate">
                    {currentLang.flag} {currentLang.name.split(' ')[0]}
                  </span>
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                </>
              )}
            </button>
            {langOpen && (
              <div
                className="absolute bottom-full left-0 w-64 rounded-xl shadow-2xl overflow-y-auto mb-1 animate-fadeIn"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  maxHeight: '280px',
                  zIndex: 100,
                }}
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left"
                    style={{
                      color: lang.code === i18n.language ? settings.primaryColor : 'var(--color-text)',
                    }}
                  >
                    <span>{lang.flag}</span>
                    <span>{lang.name}</span>
                    {lang.code === i18n.language && (
                      <span className="ml-auto text-xs">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User profile */}
          <button
            onClick={() => navigate('/profile')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-all"
            title={!sidebarOpen ? `${user?.firstName} ${user?.lastName}` : undefined}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
              style={{
                background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})`,
              }}
            >
              {userInitials}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {t(`user.roles.${user?.role}`)}
                </div>
              </div>
            )}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-red-500/10 transition-all"
            style={{ color: '#ef4444' }}
            title={!sidebarOpen ? t('auth.logout') : undefined}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span>{t('auth.logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
