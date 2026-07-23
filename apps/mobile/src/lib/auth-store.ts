import { create } from 'zustand';
import { api, setToken } from './api';
import * as SecureStore from 'expo-secure-store';

type User = { id: string; phone: string; role: string; name: string };

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (phone: string, password: string, code?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  restore: () => Promise<boolean>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,

  login: async (phone, password, code) => {
    set({ loading: true });
    try {
      const result = await api.post<{ accessToken: string; user: User }>('/auth/token', { phone, password, code });
      setToken(result.accessToken);
      await SecureStore.setItemAsync('session', result.accessToken);
      set({ user: result.user, loading: false });
      return true;
    } catch {
      set({ loading: false });
      return false;
    }
  },

  logout: async () => {
    try { await api.post('/auth/logout'); } catch {}
    setToken(null);
    await SecureStore.deleteItemAsync('session');
    set({ user: null });
  },

  restore: async () => {
    const token = await SecureStore.getItemAsync('session');
    if (!token) return false;
    setToken(token);
    try {
      const user = await api.get<User>('/auth/me');
      set({ user });
      return true;
    } catch {
      setToken(null);
      await SecureStore.deleteItemAsync('session');
      return false;
    }
  },
}));
