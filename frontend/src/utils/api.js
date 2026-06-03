import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Request interceptor — attach token
api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('vaultguard-auth');
  if (stored) {
    try {
      const { state } = JSON.parse(stored);
      if (state?.token) {
        config.headers.Authorization = `Bearer ${state.token}`;
      }
    } catch {}
  }
  return config;
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
    } else if (error.response?.status === 403) {
      toast.error('Acesso negado');
    } else if (error.response?.status >= 500) {
      toast.error('Erro no servidor. Tente novamente.');
    }
    return Promise.reject(error);
  }
);

export default api;
