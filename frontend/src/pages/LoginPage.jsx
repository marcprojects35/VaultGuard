import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Eye, EyeOff, Lock, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api.js';
import { useAuthStore, deriveMasterKey } from '../stores/authStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore(s => s.setAuth);
  const settings = useSettingsStore(s => s.settings);

  const [step, setStep] = useState('credentials'); // 'credentials' | '2fa'
  const [tempToken, setTempToken] = useState('');
  const [pendingSalt, setPendingSalt] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ login: '', password: '', totp: '' });

  const handleCredentials = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        login: form.login,
        password: form.password,
      });

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
      const { data } = await api.post('/auth/2fa/validate', {
        token: form.totp,
        tempToken,
      });
      // After 2FA we no longer have the raw password; use the salt from login step
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
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: `radial-gradient(ellipse at 20% 50%, ${settings.primaryColor}22 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, ${settings.accentColor}15 0%, transparent 50%), var(--color-bg)` }}
    >
      {/* Decorative grid */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        opacity: 0.4,
      }} />

      <div className="relative w-full max-w-md animate-fadeIn">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt={settings.siteName} className="h-12 mx-auto mb-4 object-contain" />
          ) : (
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})` }}>
                <Shield className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text)' }}>
                {settings.siteName}
              </span>
            </div>
          )}
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {settings.siteSubtitle}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8 glass">
          {step === 'credentials' ? (
            <>
              <h1 className="text-xl font-semibold mb-1">{t('auth.welcomeBack')}</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
                {t('auth.loginSubtitle')}
              </p>

              <form onSubmit={handleCredentials} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">{t('auth.username')}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-muted)' }} />
                    <input
                      type="text"
                      value={form.login}
                      onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                      placeholder="usuario@empresa.com"
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">{t('auth.password')}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-muted)' }} />
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full pl-10 pr-12 py-3 rounded-xl text-sm outline-none transition-all"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                        fontFamily: showPass ? 'inherit' : 'monospace',
                      }}
                      placeholder="••••••••••••"
                      required
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--color-muted)' }}>
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 mt-2"
                  style={{
                    background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})`,
                    color: 'white',
                    boxShadow: `0 4px 20px ${settings.primaryColor}40`,
                  }}
                >
                  {loading ? t('common.loading') : t('auth.login')}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: `${settings.primaryColor}20` }}>
                  <Shield className="w-6 h-6" style={{ color: settings.primaryColor }} />
                </div>
                <h1 className="text-xl font-semibold">{t('auth.twoFactor')}</h1>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('auth.twoFactorCode')}
                </p>
              </div>

              <form onSubmit={handle2FA} className="space-y-4">
                <input
                  type="text"
                  value={form.totp}
                  onChange={e => setForm(f => ({ ...f, totp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                  className="w-full text-center py-4 rounded-xl text-2xl tracking-[0.5em] font-mono outline-none"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                    letterSpacing: '0.5em',
                  }}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  required
                />

                <button type="submit" disabled={loading || form.totp.length !== 6}
                  className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.accentColor})`, color: 'white' }}>
                  {loading ? t('common.loading') : t('common.confirm')}
                </button>

                <button type="button" onClick={() => setStep('credentials')}
                  className="w-full text-sm py-2"
                  style={{ color: 'var(--color-text-muted)' }}>
                  ← {t('common.back')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
