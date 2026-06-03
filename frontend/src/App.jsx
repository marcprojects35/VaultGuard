import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './stores/authStore.js';
import { useSettingsStore } from './stores/settingsStore.js';
import LoginPage from './pages/LoginPage.jsx';
import VaultLayout from './components/layout/VaultLayout.jsx';
import VaultPage from './pages/VaultPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminFoldersPage from './pages/AdminFoldersPage.jsx';
import AdminAuditPage from './pages/AdminAuditPage.jsx';
import AppearancePage from './pages/AppearancePage.jsx';
import ApiTokensPage from './pages/ApiTokensPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import AdminLdapPage from './pages/AdminLdapPage.jsx';
import SettingsGeneralPage from './pages/SettingsGeneralPage.jsx';
import SettingsSecurityPage from './pages/SettingsSecurityPage.jsx';
import SettingsEmailPage from './pages/SettingsEmailPage.jsx';

function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMINISTRADOR') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { i18n } = useTranslation();
  const loadSettings = useSettingsStore(s => s.loadSettings);

  useEffect(() => { loadSettings(); }, []);

  useEffect(() => {
    const rtlLangs = ['ar', 'he', 'fa'];
    const isRtl = rtlLangs.some(l => i18n.language?.startsWith(l));
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', i18n.language || 'pt-BR');
  }, [i18n.language]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<PrivateRoute><VaultLayout /></PrivateRoute>}>
        <Route index element={<VaultPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="tokens" element={<ApiTokensPage />} />

        {/* Admin */}
        <Route path="admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
        <Route path="admin/folders" element={<AdminRoute><AdminFoldersPage /></AdminRoute>} />
        <Route path="admin/audit" element={<AdminRoute><AdminAuditPage /></AdminRoute>} />

        {/* Settings (under gear icon) */}
        <Route path="admin/settings/appearance" element={<AdminRoute><AppearancePage /></AdminRoute>} />
        <Route path="admin/settings/ldap" element={<AdminRoute><AdminLdapPage /></AdminRoute>} />
        <Route path="admin/settings/general" element={<AdminRoute><SettingsGeneralPage /></AdminRoute>} />
        <Route path="admin/settings/security" element={<AdminRoute><SettingsSecurityPage /></AdminRoute>} />
        <Route path="admin/settings/email" element={<AdminRoute><SettingsEmailPage /></AdminRoute>} />

        {/* Legacy redirects */}
        <Route path="admin/appearance" element={<Navigate to="/admin/settings/appearance" replace />} />
        <Route path="admin/ldap" element={<Navigate to="/admin/settings/ldap" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
