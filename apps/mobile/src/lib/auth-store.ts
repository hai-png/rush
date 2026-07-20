import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

type AuthState = {
  accessToken: string | null; role: string | null;
  /** Session-scoped (NON-persisted) flag — true once the biometric gate has
   *  been satisfied for the current cold-start session. Reset to false on
   *  clearAuth / app kill. The Modal overlay in _layout.tsx reads this to
   *  decide whether to render the BiometricGateScreen on top of the Stack. */
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
    // FIX (FE-002): A fresh login satisfies the gate for the session —
    // the user just proved their identity via password (and 2FA if enabled),
    // so re-arming the biometric gate would be redundant friction.
    set({ accessToken, role, isGateSatisfied: true });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('addisride.accessToken');
    await SecureStore.deleteItemAsync('addisride.role');
    set({ accessToken: null, role: null, isGateSatisfied: false });
  },
  hydrate: async () => {
    // FIX (FE-002): isGateSatisfied is intentionally NOT restored here.
    // A cold-started app always re-arms the gate (when the user has a
    // session AND biometricUnlock is enabled). This prevents the previous
    // bypass where deep links / notifications could land on a protected
    // screen before the biometric prompt resolved — the gate was just an
    // `initialRouteName` and could be circumvented by any navigation event.
    const accessToken = await SecureStore.getItemAsync('addisride.accessToken');
    const role = await SecureStore.getItemAsync('addisride.role');
    set({ accessToken, role });
  },
  setGateSatisfied: (v) => set({ isGateSatisfied: v }),
}));
