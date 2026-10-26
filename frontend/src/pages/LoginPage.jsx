import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useVaultStore } from '../stores/vaultStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore(s => s.setAuth);
  const unlockVault = useVaultStore(s => s.unlock);
  const settings = useSettingsStore(s => s.settings);

  const [step, setStep] = useState('credentials');
  const [tempToken, setTempToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ login: '', password: '', totp: '' });
  // Sem acesso ao app autenticador: entra com um código de recuperação
  const [useRecovery, setUseRecovery] = useState(false);
  const codeReady = useRecovery ? form.totp.trim().length >= 10 : form.totp.length === 6;

  const logoSrc = settings.logoUrl || '/logo.png';
  // Fundo personalizado (Aparência): imagem da empresa com uma camada escura por cima para manter a leitura
  const bgImage = settings.loginBackgroundUrl;
  const overlay = Math.min(90, Math.max(0, Number(settings.loginOverlay ?? 55))) / 100;
  const headerText = bgImage ? '#FFFFFF' : 'var(--color-text)';
  const headerMuted = bgImage ? 'rgba(255,255,255,0.8)' : 'var(--color-muted)';

  const finishLogin = async (data) => {
    setAuth({ ...data.user, requires2FASetup: !!data.requires2FASetup, requiresPasswordChange: !!data.requiresPasswordChange });
    // Abre as chaves com a mesma senha; se falhar, a tela de desbloqueio continua dali
    if (!data.requires2FASetup) {
      await unlockVault(form.password).catch(() => {});
    }
    if (data.requiresPasswordChange) {
      toast('Sua senha expirou ou foi definida pelo administrador. Crie uma senha nova.', { icon: '🔑' });
      navigate('/profile?tab=security');
    } else if (data.requires2FASetup) {
      toast('A organização exige 2FA. Ative-o para continuar.', { icon: '🔐' });
      navigate('/profile?tab=security');
    } else {
      navigate('/');
    }
  };

  const handleCredentials = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { login: form.login, password: form.password });
      if (data.requires2FA) {
        setTempToken(data.tempToken);
        setStep('2fa');
      } else {
        await finishLogin(data);
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
      const { data } = await api.post('/auth/2fa/validate', useRecovery
        ? { recoveryCode: form.totp.trim(), tempToken }
        : { token: form.totp, tempToken });
      await finishLogin(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Código inválido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'Outfit, system-ui, sans-serif',
    }}>
      {bgImage && <>
        <div data-testid="login-bg" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `url(${JSON.stringify(bgImage)})`, backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `rgba(0,0,0,${overlay})` }} />
      </>}

      {/* Ambient glow top */}
      {!bgImage && <div style={{
        position: 'absolute', top: '-120px', left: '50%', transform: 'translateX(-50%)',
        width: '700px', height: '400px', borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, rgba(var(--color-primary-rgb),0.12) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />}

      {/* Ambient glow bottom-left */}
      {!bgImage && <div style={{
        position: 'absolute', bottom: '-80px', left: '-100px', pointerEvents: 'none',
        width: '400px', height: '300px', borderRadius: '50%',
        background: 'radial-gradient(ellipse at center, rgba(var(--color-primary-rgb),0.06) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />}

      {/* Fine grid overlay */}
      {!bgImage && <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: [
          'linear-gradient(rgba(var(--color-primary-rgb),0.03) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(var(--color-primary-rgb),0.03) 1px, transparent 1px)',
        ].join(','),
        backgroundSize: '48px 48px',
      }} />}

      {/* ── Brand header ── */}
      <div className="animate-slideUp" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', marginBottom: '32px', position: 'relative',
      }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '18px',
          background: 'linear-gradient(135deg, var(--color-surface-2) 0%, var(--color-bg-secondary) 100%)',
          border: '1px solid rgba(var(--color-primary-rgb),0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(var(--color-primary-rgb),0.15), 0 4px 20px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          <img
            src={logoSrc}
            alt={settings.siteName || 'VaultGuard'}
            style={{ width: '40px', height: '40px', objectFit: 'contain' }}
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextSibling.style.display = 'flex';
            }}
          />
          <ShieldCheck style={{ display: 'none', width: '28px', height: '28px', color: 'var(--color-primary)' }} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.035em',
            // backgroundImage (não o atalho background): o atalho com var() desfaz o clip no texto
            backgroundImage: `linear-gradient(135deg, ${headerText} 0%, var(--color-primary) 60%, var(--color-primary-light) 100%)`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
            lineHeight: 1.1,
          }}>
            {settings.siteName || 'VaultGuard'}
          </div>
          <div style={{
            fontSize: '0.75rem', color: headerMuted, marginTop: '4px',
            letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500,
          }}>
            {settings.siteSubtitle || 'Cofre de Senhas Corporativo'}
          </div>
          {settings.loginMessage && <div data-testid="login-message" style={{
            fontSize: '0.85rem', color: headerText, marginTop: '10px', maxWidth: '380px',
            whiteSpace: 'pre-line', opacity: 0.9,
          }}>
            {settings.loginMessage}
          </div>}
        </div>
      </div>

      {/* ── Login card ── */}
      <div
        className="animate-fadeInScale"
        style={{
          position: 'relative', width: '100%', maxWidth: '400px',
          background: 'var(--color-surface)',
          backdropFilter: 'blur(24px)',
          borderRadius: '20px', padding: '2rem',
          border: '1px solid rgba(var(--color-primary-rgb),0.12)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--color-primary-rgb),0.06)',
        }}
      >
        {/* Top gold accent line */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '60%', height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(var(--color-primary-rgb),0.5), transparent)',
        }} />

        {step === 'credentials' ? (
          <>
            <h1 style={{
              fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)',
              letterSpacing: '-0.025em', marginBottom: '4px',
              lineHeight: 1.2,
            }}>
              {t('auth.welcomeBack')}
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              {t('auth.loginSubtitle')}
            </p>

            <form onSubmit={handleCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {/* Username */}
              <div>
                <label style={{
                  display: 'block', fontSize: '0.75rem', fontWeight: 600,
                  color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.03em', textTransform: 'uppercase',
                }}>
                  {t('auth.username')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '14px', height: '14px', color: 'var(--color-muted)', pointerEvents: 'none',
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
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                      outline: 'none',
                      fontFamily: 'Outfit, system-ui, sans-serif',
                      transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = 'rgba(var(--color-primary-rgb),0.5)';
                      e.target.style.boxShadow = '0 0 0 3px rgba(var(--color-primary-rgb),0.08)';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = 'var(--color-surface-hover)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{
                  display: 'block', fontSize: '0.75rem', fontWeight: 600,
                  color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.03em', textTransform: 'uppercase',
                }}>
                  {t('auth.password')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '14px', height: '14px', color: 'var(--color-muted)', pointerEvents: 'none',
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
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                      outline: 'none',
                      fontFamily: showPass ? 'Outfit, system-ui, sans-serif' : 'monospace',
                      transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = 'rgba(var(--color-primary-rgb),0.5)';
                      e.target.style.boxShadow = '0 0 0 3px rgba(var(--color-primary-rgb),0.08)';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = 'var(--color-surface-hover)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    style={{
                      position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-muted)', padding: '4px', display: 'flex', alignItems: 'center',
                      transition: 'color 150ms ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-muted)'}
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
                  color: 'var(--color-on-primary)',
                  background: loading
                    ? 'rgba(var(--color-primary-rgb),0.4)'
                    : 'linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-primary) 50%, var(--color-accent) 100%)',
                  border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: loading ? 'none' : '0 4px 20px rgba(var(--color-primary-rgb),0.35)',
                  fontFamily: 'Outfit, sans-serif', letterSpacing: '0.01em',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 28px rgba(var(--color-primary-rgb),0.50)';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = loading ? 'none' : '0 4px 20px rgba(var(--color-primary-rgb),0.35)';
                }}
              >
                {loading && (
                  <span style={{
                    width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
                    border: '2px solid rgba(0,0,0,0.20)',
                    borderTop: '2px solid var(--color-bg-secondary)',
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
                background: 'rgba(var(--color-primary-rgb),0.08)',
                border: '1px solid rgba(var(--color-primary-rgb),0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <ShieldCheck style={{ width: '24px', height: '24px', color: 'var(--color-primary)' }} />
              </div>
              <h1 style={{
                fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)',
                letterSpacing: '-0.025em', marginBottom: '4px',
                lineHeight: 1.2,
              }}>
                {t('auth.twoFactor')}
              </h1>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.55 }}>
                {t('auth.twoFactorCode')}
              </p>
            </div>

            <form onSubmit={handle2FA} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <input
                type="text"
                value={form.totp}
                onChange={e => setForm(f => ({
                  ...f,
                  totp: useRecovery ? e.target.value.slice(0, 11) : e.target.value.replace(/\D/g, '').slice(0, 6),
                }))}
                placeholder={useRecovery ? 'xxxxx-xxxxx' : '000000'}
                maxLength={useRecovery ? 11 : 6}
                autoFocus
                required
                style={{
                  width: '100%',
                  padding: '0.875rem 1rem',
                  borderRadius: '10px',
                  textAlign: 'center',
                  fontSize: useRecovery ? '1.4rem' : '2rem',
                  letterSpacing: useRecovery ? '0.15em' : '0.45em',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 500,
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  outline: 'none',
                  transition: 'border-color 150ms ease, box-shadow 150ms ease',
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'rgba(var(--color-primary-rgb),0.5)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(var(--color-primary-rgb),0.08)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'var(--color-surface-hover)';
                  e.target.style.boxShadow = 'none';
                }}
              />

              <button
                type="submit"
                disabled={loading || !codeReady}
                style={{
                  width: '100%', padding: '0.85rem', borderRadius: '12px',
                  fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-on-primary)',
                  background: (loading || !codeReady)
                    ? 'rgba(var(--color-primary-rgb),0.3)'
                    : 'linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-primary) 50%, var(--color-accent) 100%)',
                  border: 'none',
                  cursor: (loading || !codeReady) ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 20px rgba(var(--color-primary-rgb),0.25)',
                  fontFamily: 'Outfit, sans-serif',
                  transition: 'opacity 150ms ease, box-shadow 150ms ease',
                }}
              >
                {loading ? t('common.loading') : t('common.confirm')}
              </button>

              <button
                type="button"
                onClick={() => { setUseRecovery(r => !r); setForm(f => ({ ...f, totp: '' })); }}
                style={{
                  width: '100%', padding: '0.4rem', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.8125rem', color: 'var(--color-primary)', fontFamily: 'Outfit, sans-serif',
                }}
              >
                {useRecovery ? 'Usar o código do app autenticador' : 'Sem acesso ao app? Usar código de recuperação'}
              </button>

              <button
                type="button"
                onClick={() => setStep('credentials')}
                style={{
                  width: '100%', padding: '0.625rem',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.8125rem', color: 'var(--color-muted)',
                  fontFamily: 'Outfit, sans-serif',
                  transition: 'color 150ms ease',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-muted)'}
              >
                ← {t('common.back')}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Footer: contato de suporte configurado em Configurações → Geral */}
      {settings.supportEmail && <p className="animate-slideUp delay-300" style={{
        position: 'relative', marginTop: '1.5rem',
        fontSize: '0.75rem', color: headerMuted, fontFamily: 'Outfit, sans-serif',
        textAlign: 'center',
      }}>
        Suporte:{' '}
        <a
          href={`mailto:${settings.supportEmail}`}
          style={{ color: headerMuted, textDecoration: 'underline', textUnderlineOffset: '3px', transition: 'color 150ms ease' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = headerMuted}
        >
          {settings.supportEmail}
        </a>
      </p>}
    </div>
  );
}
