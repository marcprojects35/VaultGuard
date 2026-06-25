import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useAuthStore, deriveMasterKey } from '../stores/authStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';

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

  const logoSrc = settings.logoUrl || '/logo.png';

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

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080808',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'Outfit, system-ui, sans-serif',
    }}>
      {/* Ambient glow top */}
      <div style={{
        position: 'absolute', top: '-120px', left: '50%', transform: 'translateX(-50%)',
        width: '700px', height: '400px', borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, rgba(199,140,0,0.12) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />

      {/* Ambient glow bottom-left */}
      <div style={{
        position: 'absolute', bottom: '-80px', left: '-100px', pointerEvents: 'none',
        width: '400px', height: '300px', borderRadius: '50%',
        background: 'radial-gradient(ellipse at center, rgba(199,140,0,0.06) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />

      {/* Fine grid overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: [
          'linear-gradient(rgba(199,140,0,0.03) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(199,140,0,0.03) 1px, transparent 1px)',
        ].join(','),
        backgroundSize: '48px 48px',
      }} />

      {/* ── Brand header ── */}
      <div className="animate-slideUp" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', marginBottom: '32px', position: 'relative',
      }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '18px',
          background: 'linear-gradient(135deg, #1A1A1A 0%, #0D0D0D 100%)',
          border: '1px solid rgba(199,140,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(199,140,0,0.15), 0 4px 20px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          <img
            src={logoSrc}
            alt="VaultGuard"
            style={{ width: '40px', height: '40px', objectFit: 'contain' }}
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextSibling.style.display = 'flex';
            }}
          />
          <ShieldCheck style={{ display: 'none', width: '28px', height: '28px', color: '#C78C00' }} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.035em',
            background: 'linear-gradient(135deg, #FFFFFF 0%, #C78C00 60%, #E7A300 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            lineHeight: 1.1,
          }}>
            VaultGuard
          </div>
          <div style={{
            fontSize: '0.75rem', color: '#4A4A47', marginTop: '4px',
            letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500,
          }}>
            {settings.siteSubtitle || 'Cofre de Senhas Corporativo'}
          </div>
        </div>
      </div>

      {/* ── Login card ── */}
      <div
        className="animate-fadeInScale"
        style={{
          position: 'relative', width: '100%', maxWidth: '400px',
          background: 'rgba(14,14,14,0.95)',
          backdropFilter: 'blur(24px)',
          borderRadius: '20px', padding: '2rem',
          border: '1px solid rgba(199,140,0,0.12)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(199,140,0,0.06)',
        }}
      >
        {/* Top gold accent line */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '60%', height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(199,140,0,0.5), transparent)',
        }} />

        {step === 'credentials' ? (
          <>
            <h1 style={{
              fontSize: '1.25rem', fontWeight: 700, color: '#F0F0EE',
              letterSpacing: '-0.025em', marginBottom: '4px',
              lineHeight: 1.2,
            }}>
              {t('auth.welcomeBack')}
            </h1>
            <p style={{ fontSize: '0.8125rem', color: '#555552', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              {t('auth.loginSubtitle')}
            </p>

            <form onSubmit={handleCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {/* Username */}
              <div>
                <label style={{
                  display: 'block', fontSize: '0.75rem', fontWeight: 600,
                  color: '#6B6B68', marginBottom: '6px', letterSpacing: '0.03em', textTransform: 'uppercase',
                }}>
                  {t('auth.username')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '14px', height: '14px', color: '#4A4A47', pointerEvents: 'none',
                  }} />
                  <input
                    type="text"
                    value={form.login}
                    onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                    placeholder="usuario@empresa.com"
                    required
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '0.7rem 1rem 0.7rem 2.5rem',
                      borderRadius: '10px',
                      fontSize: '0.875rem',
                      background: '#111111',
                      border: '1px solid #222222',
                      color: '#F0F0EE',
                      outline: 'none',
                      fontFamily: 'Outfit, system-ui, sans-serif',
                      transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = 'rgba(199,140,0,0.5)';
                      e.target.style.boxShadow = '0 0 0 3px rgba(199,140,0,0.08)';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = '#222222';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{
                  display: 'block', fontSize: '0.75rem', fontWeight: 600,
                  color: '#6B6B68', marginBottom: '6px', letterSpacing: '0.03em', textTransform: 'uppercase',
                }}>
                  {t('auth.password')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '14px', height: '14px', color: '#4A4A47', pointerEvents: 'none',
                  }} />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    required
                    style={{
                      width: '100%',
                      padding: '0.7rem 3rem 0.7rem 2.5rem',
                      borderRadius: '10px',
                      fontSize: '0.875rem',
                      background: '#111111',
                      border: '1px solid #222222',
                      color: '#F0F0EE',
                      outline: 'none',
                      fontFamily: showPass ? 'Outfit, system-ui, sans-serif' : 'monospace',
                      transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = 'rgba(199,140,0,0.5)';
                      e.target.style.boxShadow = '0 0 0 3px rgba(199,140,0,0.08)';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = '#222222';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    style={{
                      position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#4A4A47', padding: '4px', display: 'flex', alignItems: 'center',
                      transition: 'color 150ms ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#C78C00'}
                    onMouseLeave={e => e.currentTarget.style.color = '#4A4A47'}
                  >
                    {showPass
                      ? <EyeOff style={{ width: '14px', height: '14px' }} />
                      : <Eye style={{ width: '14px', height: '14px' }} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: '0.25rem', width: '100%', padding: '0.85rem',
                  borderRadius: '12px', fontWeight: 700, fontSize: '0.9rem',
                  color: '#0D0D0D',
                  background: loading
                    ? 'rgba(199,140,0,0.4)'
                    : 'linear-gradient(135deg, #E7A300 0%, #C78C00 50%, #AD7B04 100%)',
                  border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: loading ? 'none' : '0 4px 20px rgba(199,140,0,0.35)',
                  fontFamily: 'Outfit, sans-serif', letterSpacing: '0.01em',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 28px rgba(199,140,0,0.50)';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = loading ? 'none' : '0 4px 20px rgba(199,140,0,0.35)';
                }}
              >
                {loading && (
                  <span style={{
                    width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
                    border: '2px solid rgba(0,0,0,0.20)',
                    borderTop: '2px solid #0D0D0D',
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
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{
                width: '52px', height: '52px', borderRadius: '14px',
                background: 'rgba(199,140,0,0.08)',
                border: '1px solid rgba(199,140,0,0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <ShieldCheck style={{ width: '24px', height: '24px', color: '#C78C00' }} />
              </div>
              <h1 style={{
                fontSize: '1.25rem', fontWeight: 700, color: '#F0F0EE',
                letterSpacing: '-0.025em', marginBottom: '4px',
                lineHeight: 1.2,
              }}>
                {t('auth.twoFactor')}
              </h1>
              <p style={{ fontSize: '0.8125rem', color: '#555552', lineHeight: 1.55 }}>
                {t('auth.twoFactorCode')}
              </p>
            </div>

            <form onSubmit={handle2FA} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <input
                type="text"
                value={form.totp}
                onChange={e => setForm(f => ({ ...f, totp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                placeholder="000000"
                maxLength={6}
                autoFocus
                required
                style={{
                  width: '100%',
                  padding: '0.875rem 1rem',
                  borderRadius: '10px',
                  textAlign: 'center',
                  fontSize: '2rem',
                  letterSpacing: '0.45em',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 500,
                  background: '#111111',
                  border: '1px solid #222222',
                  color: '#F0F0EE',
                  outline: 'none',
                  transition: 'border-color 150ms ease, box-shadow 150ms ease',
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'rgba(199,140,0,0.5)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(199,140,0,0.08)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#222222';
                  e.target.style.boxShadow = 'none';
                }}
              />

              <button
                type="submit"
                disabled={loading || form.totp.length !== 6}
                style={{
                  width: '100%', padding: '0.85rem', borderRadius: '12px',
                  fontWeight: 700, fontSize: '0.9rem', color: '#0D0D0D',
                  background: (loading || form.totp.length !== 6)
                    ? 'rgba(199,140,0,0.3)'
                    : 'linear-gradient(135deg, #E7A300 0%, #C78C00 50%, #AD7B04 100%)',
                  border: 'none',
                  cursor: (loading || form.totp.length !== 6) ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 20px rgba(199,140,0,0.25)',
                  fontFamily: 'Outfit, sans-serif',
                  transition: 'opacity 150ms ease, box-shadow 150ms ease',
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
                  fontSize: '0.8125rem', color: '#555552',
                  fontFamily: 'Outfit, sans-serif',
                  transition: 'color 150ms ease',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#A0A09E'}
                onMouseLeave={e => e.currentTarget.style.color = '#555552'}
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
        fontSize: '0.75rem', color: '#333330', fontFamily: 'Outfit, sans-serif',
        textAlign: 'center',
      }}>
        Suporte:{' '}
        <a
          href="mailto:VaultGuard2026@outlook.com"
          style={{ color: '#4A4A47', textDecoration: 'underline', textUnderlineOffset: '3px', transition: 'color 150ms ease' }}
          onMouseEnter={e => e.currentTarget.style.color = '#C78C00'}
          onMouseLeave={e => e.currentTarget.style.color = '#4A4A47'}
        >
          VaultGuard2026@outlook.com
        </a>
      </p>
    </div>
  );
}
