import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

type AuthState = {
  accessToken: string | null; role: string | null;

  isGateSatisfied: boolean;
  setAuth: (token: string, role: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  hydrate: () => Promise<void>;
  setGateSatisfied: (v: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null, role: null, isGateSatisfied: false,
  setAuth: async (accessToken, role) => {
    await SecureStore.setItemAsync('addisride.accessToken', accessToken);
    await SecureStore.setItemAsync('addisride.role', role);

    set({ accessToken, role, isGateSatisfied: true });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('addisride.accessToken');
    await SecureStore.deleteItemAsync('addisride.role');
    set({ accessToken: null, role: null, isGateSatisfied: false });
  },
  hydrate: async () => {

    const accessToken = await SecureStore.getItemAsync('addisride.accessToken');
    const role = await SecureStore.getItemAsync('addisride.role');
    set({ accessToken, role });
  },
  setGateSatisfied: (v) => set({ isGateSatisfied: v }),
}));
