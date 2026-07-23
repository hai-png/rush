// Auth store using Zustand for reactive state management across screens.
//
// (INC-06 — this is now the single source of truth for mobile auth. The old
// `auth.ts` plain-functions module was deleted; its `restoreSession()` helper
// is now `restore()` here, and `login()`/`logout()` were already identical.)
//
// `login()` throws on failure (instead of returning `false`) so that callers
// like the login screen can inspect the error message to detect the
// TWO_FACTOR_REQUIRED case. On success it returns the authenticated user.
import { create } from 'zustand';
import { api, setToken } from './api';
import * as SecureStore from 'expo-secure-store';

export type AuthUser = { id: string; phone: string; role: string; name: string };

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (phone: string, password: string, code?: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  restore: () => Promise<boolean>;
  // Set the user directly (used by signup, which performs its own token
  // exchange before populating the store).
  setUser: (user: AuthUser | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,

  setUser: (user) => set({ user }),

  login: async (phone, password, code) => {
    set({ loading: true });
    try {
      const result = await api.post<{ accessToken: string; user: AuthUser; requiresTosAcceptance?: boolean }>(
        '/auth/token',
        { phone, password, code }
      );
      setToken(result.accessToken);
      await SecureStore.setItemAsync('session', result.accessToken);
      set({ user: result.user, loading: false });
      return result.user;
    } catch (e) {
      set({ loading: false });
      // Re-throw so callers (e.g. login screen) can inspect the message to
      // detect 2FA-required vs. bad-credentials.
      throw e;
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
      const user = await api.get<AuthUser>('/auth/me');
      set({ user });
      return true;
    } catch {
      setToken(null);
      await SecureStore.deleteItemAsync('session');
      return false;
    }
  },
}));
