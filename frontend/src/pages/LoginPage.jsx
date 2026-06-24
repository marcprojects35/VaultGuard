import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useAuthStore, deriveMasterKey } from '../stores/authStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';

const INPUT_BASE = {
  width: '100%',
  paddingTop: '0.75rem',
  paddingBottom: '0.75rem',
  paddingLeft: '2.75rem',
  paddingRight: '1rem',
  borderRadius: '10px',
  fontSize: '0.875rem',
  background: '#F9F8F4',
  border: '1.5px solid #E4E2DC',
  color: '#1A1916',
  outline: 'none',
  fontFamily: 'Outfit, system-ui, sans-serif',
  transition: 'border-color 150ms ease, box-shadow 150ms ease',
};

function onFocus(e) {
  e.target.style.borderColor = '#C78C00';
  e.target.style.boxShadow = '0 0 0 3px rgba(199,140,0,0.13)';
}
function onBlur(e) {
  e.target.style.borderColor = '#E4E2DC';
  e.target.style.boxShadow = 'none';
}

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore(s => s.setAuth);
  const settings = useSettingsStore(s => s.settings);

  const [step, setStep] = useState('credentials');
  const [tempToken, setTempToken] = useState('');
  const [pendingSalt, setPendingSalt] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ login: '', password: '', totp: '' });

  const handleCredentials = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { login: form.login, password: form.password });
      if (data.requires2FA) {
        setTempToken(data.tempToken);
        setPendingSalt(data.encryptionSalt || '');
        setStep('2fa');
      } else {
        await deriveMasterKey(form.password, data.user?.encryptionSalt);
        setAuth(data.user, data.token);
        navigate('/');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handle2FA = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/2fa/validate', { token: form.totp, tempToken });
      await deriveMasterKey(form.password, data.user?.encryptionSalt || pendingSalt);
      setAuth(data.user, data.token);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Código inválido');
    } finally {
      setLoading(false);
    }
  };

  const hasCustomLogo = settings.logoUrl && settings.logoUrl !== '/logo.png';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F5F4EF',
        backgroundImage: [
          'linear-gradient(rgba(0,0,0,0.055) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(0,0,0,0.055) 1px, transparent 1px)',
        ].join(','),
        backgroundSize: '40px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial accent */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: [
          'radial-gradient(ellipse 600px 400px at 50% 40%, rgba(199,140,0,0.055) 0%, transparent 70%)',
          'radial-gradient(ellipse 400px 300px at 80% 70%, rgba(199,140,0,0.03) 0%, transparent 60%)',
        ].join(','),
      }} />

      {/* Brand above card */}
      <div className="animate-slideUp" style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        marginBottom: '28px', position: 'relative',
      }}>
        {hasCustomLogo ? (
          <img src={settings.logoUrl} alt={settings.siteName} style={{ height: '36px', objectFit: 'contain' }} />
        ) : (
          <>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
              background: 'linear-gradient(135deg, #C78C00 0%, #AD7B04 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 10px rgba(199,140,0,0.32)',
            }}>
              <Shield style={{ width: '18px', height: '18px', color: '#fff' }} />
            </div>
            <span style={{
              fontSize: '1.0625rem', fontWeight: 700, color: '#1A1916',
              letterSpacing: '-0.02em', fontFamily: 'Outfit, sans-serif',
            }}>
              {settings.siteName || 'VaultGuard'}
            </span>
          </>
        )}
      </div>

      {/* Login card */}
      <div
        className="animate-fadeInScale"
        style={{
          position: 'relative', width: '100%', maxWidth: '400px',
          background: '#FFFFFF', borderRadius: '20px', padding: '2.5rem',
          boxShadow: '0 8px 40px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.05)',
        }}
      >
        {step === 'credentials' ? (
          <>
            <h1 style={{
              fontSize: '1.5rem', fontWeight: 700, color: '#1A1916',
              letterSpacing: '-0.025em', marginBottom: '6px', fontFamily: 'Outfit, sans-serif',
              lineHeight: 1.2,
            }}>
              {t('auth.welcomeBack')}
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#706F6A', marginBottom: '1.75rem', lineHeight: 1.55 }}>
              {settings.siteSubtitle || t('auth.loginSubtitle')}
            </p>

            <form onSubmit={handleCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Username / email */}
              <div>
                <label style={{
                  display: 'block', fontSize: '0.8125rem', fontWeight: 500,
                  color: '#4B4A47', marginBottom: '6px', fontFamily: 'Outfit, sans-serif',
                }}>
                  {t('auth.username')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '15px', height: '15px', color: '#B0AEA9', pointerEvents: 'none',
                  }} />
                  <input
                    type="text"
                    value={form.login}
                    onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                    placeholder="usuario@empresa.com"
                    required
                    autoFocus
                    style={INPUT_BASE}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{
                  display: 'block', fontSize: '0.8125rem', fontWeight: 500,
                  color: '#4B4A47', marginBottom: '6px', fontFamily: 'Outfit, sans-serif',
                }}>
                  {t('auth.password')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '15px', height: '15px', color: '#B0AEA9', pointerEvents: 'none',
                  }} />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    required
                    style={{
                      ...INPUT_BASE,
                      paddingRight: '3rem',
                      fontFamily: showPass ? 'Outfit, sans-serif' : 'monospace',
                    }}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    style={{
                      position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#B0AEA9', padding: '4px', display: 'flex', alignItems: 'center',
                    }}
                  >
                    {showPass
                      ? <EyeOff style={{ width: '15px', height: '15px' }} />
                      : <Eye style={{ width: '15px', height: '15px' }} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: '0.5rem', width: '100%', padding: '0.9rem',
                  borderRadius: '12px', fontWeight: 600, fontSize: '0.9375rem', color: '#fff',
                  background: 'linear-gradient(135deg, #C78C00 0%, #AD7B04 100%)',
                  border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.72 : 1,
                  boxShadow: loading ? 'none' : '0 4px 18px rgba(199,140,0,0.30)',
                  fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.01em',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 24px rgba(199,140,0,0.40)';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = loading ? 'none' : '0 4px 18px rgba(199,140,0,0.30)';
                }}
              >
                {loading && (
                  <span style={{
                    width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
                    border: '2px solid rgba(255,255,255,0.30)',
                    borderTop: '2px solid #fff',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                )}
                {loading ? t('common.loading') : t('auth.login')}
              </button>
            </form>
          </>
        ) : (
          /* ── 2FA Step ── */
          <>
            <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
              <div style={{
                width: '56px', height: '56px', borderRadius: '16px',
                background: 'rgba(199,140,0,0.09)', border: '1.5px solid rgba(199,140,0,0.20)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <Shield style={{ width: '26px', height: '26px', color: '#C78C00' }} />
              </div>
              <h1 style={{
                fontSize: '1.375rem', fontWeight: 700, color: '#1A1916',
                letterSpacing: '-0.025em', marginBottom: '6px',
                fontFamily: 'Outfit, sans-serif', lineHeight: 1.2,
              }}>
                {t('auth.twoFactor')}
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#706F6A', lineHeight: 1.55 }}>
                {t('auth.twoFactorCode')}
              </p>
            </div>

            <form onSubmit={handle2FA} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input
                type="text"
                value={form.totp}
                onChange={e => setForm(f => ({ ...f, totp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                placeholder="000000"
                maxLength={6}
                autoFocus
                required
                style={{
                  ...INPUT_BASE,
                  paddingLeft: '1rem',
                  textAlign: 'center',
                  fontSize: '1.875rem',
                  letterSpacing: '0.45em',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 500,
                }}
                onFocus={onFocus}
                onBlur={onBlur}
              />

              <button
                type="submit"
                disabled={loading || form.totp.length !== 6}
                style={{
                  width: '100%', padding: '0.9rem', borderRadius: '12px',
                  fontWeight: 600, fontSize: '0.9375rem', color: '#fff',
                  background: 'linear-gradient(135deg, #C78C00 0%, #AD7B04 100%)',
                  border: 'none',
                  cursor: (loading || form.totp.length !== 6) ? 'not-allowed' : 'pointer',
                  opacity: (loading || form.totp.length !== 6) ? 0.60 : 1,
                  boxShadow: '0 4px 18px rgba(199,140,0,0.25)',
                  fontFamily: 'Outfit, sans-serif',
                  transition: 'opacity 150ms ease',
                }}
              >
                {loading ? t('common.loading') : t('common.confirm')}
              </button>

              <button
                type="button"
                onClick={() => setStep('credentials')}
                style={{
                  width: '100%', padding: '0.625rem',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.875rem', color: '#706F6A',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                ← {t('common.back')}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Footer */}
      <p className="animate-slideUp delay-300" style={{
        position: 'relative', marginTop: '1.5rem',
        fontSize: '0.8125rem', color: '#9C9B97', fontFamily: 'Outfit, sans-serif',
      }}>
        Suporte:{' '}
        <a
          href="mailto:VaultGuard2026@outlook.com"
          style={{ color: '#706F6A', textDecoration: 'underline', textUnderlineOffset: '3px' }}
        >
          VaultGuard2026@outlook.com
        </a>
      </p>
    </div>
  );
}
