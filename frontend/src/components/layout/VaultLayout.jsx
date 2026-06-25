import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shield, Vault, Users, FolderOpen, ScrollText, Palette, Server,
  LogOut, Key, ChevronDown, Settings, Globe,
  SlidersHorizontal, ShieldCheck, Mail, ChevronRight,
  Search, Upload, Download, Star, Inbox, HelpCircle, Send,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { useAuthStore, useIsAdmin } from '../../stores/authStore.js';
import { useSettingsStore } from '../../stores/settingsStore.js';
import { SUPPORTED_LANGUAGES } from '../../i18n/index.js';

/* ── Sidebar width constants ─────────────────── */
const W_OPEN   = 248;
const W_CLOSED = 64;

/* ── Single nav item ─────────────────────────── */
function NavItem({ to, icon, label, open, exact = false }) {
  return (
    <NavLink
      to={to}
      end={exact}
      title={!open ? label : undefined}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center',
        gap: open ? '9px' : 0,
        padding: open ? '7px 10px' : '9px 0',
        justifyContent: open ? 'flex-start' : 'center',
        borderRadius: '9px',
        fontSize: '0.875rem', fontWeight: 500,
        textDecoration: 'none',
        overflow: 'hidden', whiteSpace: 'nowrap',
        transition: 'color 150ms ease, background 150ms ease',
        color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
        background: isActive ? 'rgba(var(--color-primary-rgb),0.12)' : 'transparent',
      })}
      className={({ isActive }) => isActive ? '' : 'sidebar-hover-item'}
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
      {open && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
    </NavLink>
  );
}

/* ── Settings sub-item ───────────────────────── */
function SettingsItem({ to, icon, label, open }) {
  return (
    <NavLink
      to={to}
      title={!open ? label : undefined}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center',
        gap: open ? '8px' : 0,
        padding: open ? '6px 10px' : '8px 0',
        justifyContent: open ? 'flex-start' : 'center',
        borderRadius: '8px',
        fontSize: '0.8125rem', fontWeight: 500,
        textDecoration: 'none',
        overflow: 'hidden', whiteSpace: 'nowrap',
        transition: 'color 150ms ease, background 150ms ease',
        color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
        background: isActive ? 'rgba(var(--color-primary-rgb),0.12)' : 'transparent',
      })}
      className={({ isActive }) => isActive ? '' : 'sidebar-hover-item'}
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
      {open && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
    </NavLink>
  );
}

/* ── Section label ───────────────────────────── */
function SectionLabel({ label, open }) {
  if (!open) return (
    <div style={{ height: '1px', background: 'var(--color-border)', margin: '8px 10px' }} />
  );
  return (
    <div style={{
      fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.07em',
      textTransform: 'uppercase', color: 'var(--color-muted)',
      padding: '14px 10px 5px', userSelect: 'none',
    }}>
      {label}
    </div>
  );
}

export default function VaultLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore(s => s.logout);
  const user = useAuthStore(s => s.user);
  const isAdmin = useIsAdmin();
  const settings = useSettingsStore(s => s.settings);

  const [open, setOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(
    () => location.pathname.startsWith('/admin/settings')
  );
  const [langOpen, setLangOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [contactSent, setContactSent] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith('/admin/settings')) setSettingsOpen(true);
  }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleContactSubmit = (e) => {
    e.preventDefault();
    const { name, email, subject, message } = contactForm;
    const body = `Nome: ${name}\nE-mail: ${email}\n\n${message}`;
    window.open(`mailto:VaultGuard2026@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
    setContactSent(true);
    setTimeout(() => {
      setContactOpen(false);
      setContactSent(false);
      setContactForm({ name: '', email: '', subject: '', message: '' });
    }, 2200);
  };

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) || SUPPORTED_LANGUAGES[0];
  const userInitials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('') || '?';
  const logoSrc = settings.logoUrl || '/logo.png';

  /* ── Sidebar background  ─────────────────────
     Always dark regardless of app theme so it
     contrasts with the content area.             */
  const sidebarBg     = '#0D0D0D';
  const sidebarBorder = '#1F1F1F';

  const iconSize = { width: '16px', height: '16px' };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-bg)' }}>

      {/* ═══════════ Sidebar ═══════════ */}
      <aside
        style={{
          width: open ? W_OPEN : W_CLOSED,
          minWidth: open ? W_OPEN : W_CLOSED,
          background: sidebarBg,
          borderRight: `1px solid ${sidebarBorder}`,
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 220ms cubic-bezier(0.4,0,0.2,1), min-width 220ms cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* ── Logo / Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: open ? '14px 14px 14px 14px' : '14px 0',
          justifyContent: open ? 'flex-start' : 'center',
          borderBottom: `1px solid ${sidebarBorder}`,
          minHeight: '62px', flexShrink: 0, gap: '10px',
        }}>
          <img
            src={logoSrc}
            alt="VaultGuard"
            style={{
              height: '30px', objectFit: 'contain', flexShrink: 0,
              maxWidth: open ? '120px' : '30px',
              filter: 'drop-shadow(0 0 6px rgba(199,140,0,0.30))',
            }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
          {open && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: '0.9rem', fontWeight: 800, color: '#F5F5F3',
                letterSpacing: '-0.025em', whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis',
                background: 'linear-gradient(90deg, #F5F5F3 0%, #C78C00 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                VaultGuard
              </div>
              <div style={{
                fontSize: '0.65rem', color: '#555552',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                marginTop: '1px', letterSpacing: '0.02em', textTransform: 'uppercase',
              }}>
                {settings.siteSubtitle || 'Cofre de Senhas'}
              </div>
            </div>
          )}

          {/* Collapse / expand toggle */}
          {open && (
            <button
              onClick={() => setOpen(false)}
              title="Recolher menu"
              style={{
                marginLeft: 'auto', flexShrink: 0,
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#636360', padding: '4px', borderRadius: '6px',
                display: 'flex', alignItems: 'center',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#A0A09E'}
              onMouseLeave={e => e.currentTarget.style.color = '#636360'}
            >
              <PanelLeftClose style={{ width: '15px', height: '15px' }} />
            </button>
          )}
        </div>

        {/* Expand button when collapsed */}
        {!open && (
          <button
            onClick={() => setOpen(true)}
            title="Expandir menu"
            style={{
              position: 'absolute', top: '14px', right: '-13px',
              width: '26px', height: '26px', borderRadius: '6px',
              background: '#1E1E1E', border: `1px solid #2A2A2A`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#A0A09E', zIndex: 20,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#F0F0EE'}
            onMouseLeave={e => e.currentTarget.style.color = '#A0A09E'}
          >
            <PanelLeftOpen style={{ width: '13px', height: '13px' }} />
          </button>
        )}

        {/* ── Navigation ── */}
        <nav style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: open ? '10px 10px' : '10px 8px',
          display: 'flex', flexDirection: 'column', gap: '2px',
        }}>
          {/* ─ Main ─ */}
          <NavItem to="/" icon={<Vault style={iconSize} />} label={t('nav.vault')} open={open} exact />
          <NavItem to="/search" icon={<Search style={iconSize} />} label="Pesquisa" open={open} />
          <NavItem to="/favorites" icon={<Star style={iconSize} />} label="Favoritos" open={open} />
          <NavItem to="/security" icon={<ShieldCheck style={iconSize} />} label="Segurança" open={open} />
          <NavItem to="/access-requests" icon={<Inbox style={iconSize} />} label="Acessos" open={open} />

          {/* ─ Ferramentas ─ */}
          <SectionLabel label="Ferramentas" open={open} />
          <NavItem to="/import" icon={<Upload style={iconSize} />} label="Importar" open={open} />
          <NavItem to="/export" icon={<Download style={iconSize} />} label="Exportar" open={open} />
          <NavItem to="/tokens" icon={<Key style={iconSize} />} label={t('nav.apiTokens')} open={open} />

          {/* ─ Admin ─ */}
          {isAdmin && (
            <>
              <SectionLabel label={t('nav.admin')} open={open} />
              <NavItem to="/admin/users" icon={<Users style={iconSize} />} label={t('nav.users')} open={open} />
              <NavItem to="/admin/folders" icon={<FolderOpen style={iconSize} />} label={t('nav.folders')} open={open} />
              <NavItem to="/admin/audit" icon={<ScrollText style={iconSize} />} label={t('nav.audit')} open={open} />

              {/* Settings group */}
              <SectionLabel label={t('nav.settings')} open={open} />

              {open ? (
                <>
                  <button
                    onClick={() => setSettingsOpen(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '9px',
                      padding: '7px 10px', borderRadius: '9px',
                      fontSize: '0.875rem', fontWeight: 500,
                      color: 'var(--color-text-muted)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      width: '100%', textAlign: 'left',
                      transition: 'color 150ms ease, background 150ms ease',
                    }}
                    className="sidebar-hover-item"
                  >
                    <Settings style={iconSize} />
                    <span style={{ flex: 1 }}>Configurações</span>
                    <ChevronDown style={{
                      width: '13px', height: '13px', flexShrink: 0,
                      transition: 'transform 200ms ease',
                      transform: settingsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }} />
                  </button>
                  {settingsOpen && (
                    <div style={{ paddingLeft: '14px', borderLeft: `1px solid #2A2A2A`, marginLeft: '18px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <SettingsItem to="/admin/settings/appearance" icon={<Palette style={iconSize} />} label="Aparência" open={open} />
                      <SettingsItem to="/admin/settings/ldap" icon={<Server style={iconSize} />} label="Active Directory" open={open} />
                      <SettingsItem to="/admin/settings/general" icon={<SlidersHorizontal style={iconSize} />} label="Geral" open={open} />
                      <SettingsItem to="/admin/settings/security" icon={<ShieldCheck style={iconSize} />} label="Segurança" open={open} />
                      <SettingsItem to="/admin/settings/email" icon={<Mail style={iconSize} />} label="E-mail" open={open} />
                    </div>
                  )}
                </>
              ) : (
                /* Collapsed: show all settings icons directly */
                <>
                  <SettingsItem to="/admin/settings/appearance" icon={<Palette style={iconSize} />} label="Aparência" open={false} />
                  <SettingsItem to="/admin/settings/ldap" icon={<Server style={iconSize} />} label="Active Directory" open={false} />
                  <SettingsItem to="/admin/settings/general" icon={<SlidersHorizontal style={iconSize} />} label="Geral" open={false} />
                  <SettingsItem to="/admin/settings/security" icon={<ShieldCheck style={iconSize} />} label="Segurança" open={false} />
                  <SettingsItem to="/admin/settings/email" icon={<Mail style={iconSize} />} label="E-mail" open={false} />
                </>
              )}
            </>
          )}
        </nav>

        {/* ── Bottom area ── */}
        <div style={{
          padding: open ? '8px 10px' : '8px',
          borderTop: `1px solid ${sidebarBorder}`,
          display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0,
        }}>
          {/* Language selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setLangOpen(v => !v)}
              title={!open ? 'Idioma' : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                gap: open ? '9px' : 0,
                padding: open ? '7px 10px' : '9px 0',
                justifyContent: open ? 'flex-start' : 'center',
                borderRadius: '9px', width: '100%',
                fontSize: '0.875rem', fontWeight: 500,
                color: 'var(--color-text-muted)',
                background: 'none', border: 'none', cursor: 'pointer',
                transition: 'color 150ms ease, background 150ms ease',
              }}
              className="sidebar-hover-item"
            >
              <Globe style={iconSize} />
              {open && (
                <>
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentLang.flag} {currentLang.name.split(' ')[0]}
                  </span>
                  <ChevronDown style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                </>
              )}
            </button>

            {langOpen && (
              <div
                className="animate-fadeInScale"
                style={{
                  position: 'absolute', bottom: 'calc(100% + 4px)',
                  left: 0, width: '220px',
                  background: '#1A1A1A', border: '1px solid #2A2A2A',
                  borderRadius: '12px',
                  maxHeight: '260px', overflowY: 'auto',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  zIndex: 50,
                }}
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      width: '100%', padding: '9px 14px',
                      fontSize: '0.8125rem', fontWeight: 500,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: lang.code === i18n.language ? 'var(--color-primary)' : '#A0A09E',
                      transition: 'color 100ms ease, background 100ms ease',
                      textAlign: 'left',
                    }}
                    className="sidebar-hover-item"
                  >
                    <span>{lang.flag}</span>
                    <span style={{ flex: 1 }}>{lang.name}</span>
                    {lang.code === i18n.language && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User profile */}
          <button
            onClick={() => navigate('/profile')}
            title={!open ? `${user?.firstName} ${user?.lastName}` : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              gap: open ? '9px' : 0,
              padding: open ? '7px 10px' : '9px 0',
              justifyContent: open ? 'flex-start' : 'center',
              borderRadius: '9px', width: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            className="sidebar-hover-item"
          >
            <div style={{
              width: '26px', height: '26px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${settings.primaryColor || '#C78C00'}, ${settings.accentColor || '#AD7B04'})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.6875rem', fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {userInitials}
            </div>
            {open && (
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{
                  fontSize: '0.8125rem', fontWeight: 600, color: '#F0F0EE',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {user?.firstName} {user?.lastName}
                </div>
                <div style={{
                  fontSize: '0.6875rem', color: '#636360',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px',
                }}>
                  {t(`user.roles.${user?.role}`)}
                </div>
              </div>
            )}
          </button>

          {/* Support */}
          <button
            onClick={() => setContactOpen(true)}
            title={!open ? 'Suporte' : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              gap: open ? '9px' : 0,
              padding: open ? '7px 10px' : '9px 0',
              justifyContent: open ? 'flex-start' : 'center',
              borderRadius: '9px', width: '100%',
              fontSize: '0.875rem', fontWeight: 500,
              color: '#636360',
              background: 'none', border: 'none', cursor: 'pointer',
              transition: 'color 150ms ease, background 150ms ease',
            }}
            className="sidebar-hover-item"
          >
            <HelpCircle style={iconSize} />
            {open && <span>Suporte</span>}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            title={!open ? t('auth.logout') : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              gap: open ? '9px' : 0,
              padding: open ? '7px 10px' : '9px 0',
              justifyContent: open ? 'flex-start' : 'center',
              borderRadius: '9px', width: '100%',
              fontSize: '0.875rem', fontWeight: 500,
              color: '#EF4444',
              background: 'none', border: 'none', cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.10)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <LogOut style={iconSize} />
            {open && <span>{t('auth.logout')}</span>}
          </button>
        </div>
      </aside>

      {/* ═══════════ Main Content ═══════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <main
          key={location.pathname}
          className="page-enter"
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        >
          <Outlet />
        </main>

        {/* Footer */}
        <footer style={{
          flexShrink: 0, padding: '7px 16px', textAlign: 'center',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
            Desenvolvido por{' '}
            <a
              href="https://www.linkedin.com/in/marcoaurelioprudencio/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontWeight: 600, color: 'var(--color-primary)',
                textDecoration: 'none', transition: 'opacity 150ms ease',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              Marco
            </a>
          </span>
        </footer>
      </div>

      {/* ═══════════ Contact Modal ═══════════ */}
      {contactOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(0,0,0,0.60)',
            backdropFilter: 'blur(6px)',
          }}
          onClick={e => { if (e.target === e.currentTarget) setContactOpen(false); }}
        >
          <div
            className="animate-fadeInScale"
            style={{
              width: '100%', maxWidth: '460px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '20px',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px',
              borderBottom: '1px solid var(--color-border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: `linear-gradient(135deg, ${settings.primaryColor || '#C78C00'}, ${settings.accentColor || '#AD7B04'})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <HelpCircle style={{ width: '18px', height: '18px', color: '#fff' }} />
                </div>
                <div>
                  <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>Fale Conosco</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '1px' }}>
                    Dúvidas ou bugs? Envie uma mensagem.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setContactOpen(false)}
                style={{
                  width: '30px', height: '30px', borderRadius: '8px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-text-muted)', fontSize: '1.125rem',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            {contactSent ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '3rem 1rem', gap: '12px',
              }}>
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  background: `rgba(var(--color-primary-rgb),0.12)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Send style={{ width: '24px', height: '24px', color: 'var(--color-primary)' }} />
                </div>
                <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                  Cliente de e-mail aberto!
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  Finalize o envio no seu e-mail.
                </div>
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {[
                    { key: 'name', label: 'Nome *', placeholder: 'Seu nome', type: 'text' },
                    { key: 'email', label: 'E-mail *', placeholder: 'seu@email.com', type: 'email' },
                  ].map(({ key, label, placeholder, type }) => (
                    <div key={key}>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)', marginBottom: '5px' }}>
                        {label}
                      </label>
                      <input
                        type={type}
                        required
                        value={contactForm[key]}
                        onChange={e => setContactForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={placeholder}
                        style={{
                          width: '100%', padding: '8px 10px', borderRadius: '8px',
                          fontSize: '0.8125rem', outline: 'none',
                          background: 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text)',
                          fontFamily: 'Outfit, sans-serif',
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)', marginBottom: '5px' }}>Assunto *</label>
                  <input
                    type="text" required
                    value={contactForm.subject}
                    onChange={e => setContactForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="Ex: Bug na exportação, dúvida sobre permissões..."
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: '8px',
                      fontSize: '0.8125rem', outline: 'none',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                      fontFamily: 'Outfit, sans-serif',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)', marginBottom: '5px' }}>Mensagem *</label>
                  <textarea
                    required rows={4}
                    value={contactForm.message}
                    onChange={e => setContactForm(f => ({ ...f, message: e.target.value }))}
                    placeholder="Descreva sua dúvida ou bug com o máximo de detalhes..."
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: '8px',
                      fontSize: '0.8125rem', outline: 'none', resize: 'none',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                      fontFamily: 'Outfit, sans-serif',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', paddingTop: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setContactOpen(false)}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '10px',
                      fontSize: '0.875rem', fontWeight: 500,
                      color: 'var(--color-text-muted)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      fontFamily: 'Outfit, sans-serif',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    style={{
                      flex: 1, padding: '10px', borderRadius: '10px',
                      fontSize: '0.875rem', fontWeight: 600, color: '#fff',
                      background: `linear-gradient(135deg, ${settings.primaryColor || '#C78C00'}, ${settings.accentColor || '#AD7B04'})`,
                      border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      fontFamily: 'Outfit, sans-serif',
                    }}
                  >
                    <Send style={{ width: '14px', height: '14px' }} />
                    Enviar
                  </button>
                </div>

                <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '-4px' }}>
                  Enviado para{' '}
                  <span style={{ fontWeight: 500, color: 'var(--color-primary)' }}>VaultGuard2026@outlook.com</span>
                </p>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Global hover style injected */}
      <style>{`
        .sidebar-hover-item:hover {
          background: rgba(199,140,0,0.08) !important;
          color: #F0F0EE !important;
        }
      `}</style>
    </div>
  );
}
