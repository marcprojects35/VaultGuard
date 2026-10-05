import axios from 'axios';
import toast from 'react-hot-toast';

// A sessão vive num cookie httpOnly (o JS nunca vê o JWT). O header
// X-Requested-With é exigido pelo backend em requests que alteram estado.
const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

// Response interceptor — handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth and redirect to login
      localStorage.removeItem('vaultguard-auth');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (error.response?.status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (window.location.pathname !== '/profile') {
        toast.error('Sua senha precisa ser trocada para continuar');
        window.location.href = '/profile?tab=security';
      }
    } else if (error.response?.status === 403 && error.response?.data?.code === 'IP_NOT_ALLOWED') {
      toast.error('Acesso não permitido a partir desta rede');
    } else if (error.response?.status === 403 && error.response?.data?.code === '2FA_REQUIRED') {
      if (window.location.pathname !== '/profile') {
        toast.error('Ative o 2FA para continuar usando o cofre');
        window.location.href = '/profile?tab=security';
      }
    } else if (error.response?.status === 403) {
      toast.error('Acesso negado');
    } else if (error.response?.status >= 500) {
      toast.error('Erro no servidor. Tente novamente.');
    }
    return Promise.reject(error);
  }
);

export default api;
