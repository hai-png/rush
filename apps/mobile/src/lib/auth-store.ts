import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

type AuthState = {
  accessToken: string | null; role: string | null;
  setAuth: (token: string, role: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null, role: null,
  setAuth: async (accessToken, role) => {
    await SecureStore.setItemAsync('addisride.accessToken', accessToken);
    await SecureStore.setItemAsync('addisride.role', role);
    set({ accessToken, role });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('addisride.accessToken');
    await SecureStore.deleteItemAsync('addisride.role');
    set({ accessToken: null, role: null });
  },
  hydrate: async () => {
    const accessToken = await SecureStore.getItemAsync('addisride.accessToken');
    const role = await SecureStore.getItemAsync('addisride.role');
    set({ accessToken, role });
  },
}));
