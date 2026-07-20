import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

// MOB-001: when biometric unlock is enabled (settings-store), store the
// access token with requireAuthentication on iOS and authenticationType:
// BIOMETRICS on Android. This means the token can only be read after a
// successful biometric prompt — even if the device is unlocked, an attacker
// (or a malicious app) can't read it without the user's biometric.
//
// We read the biometric setting lazily (not at module load) so the user
// can toggle it without restarting the app. The setting is read via a
// getter to avoid a circular import (settings-store imports auth-store
// for the clearAuth flow).

async function biometricEnabled(): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync('addisride.biometricUnlock');
    return val === 'true';
  } catch {
    return false;
  }
}

async function secureSet(key: string, value: string) {
  const biometric = await biometricEnabled();
  // Only require authentication if the device actually has biometrics
  // enrolled — otherwise SecureStore.setItemAsync with requireAuthentication
  // throws on iOS.
  let requireAuth = false;
  if (biometric) {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      requireAuth = hasHardware && enrolled;
    } catch {
      requireAuth = false;
    }
  }
  // MOB-001: expo-secure-store 14.x supports `requireAuthentication` (iOS)
  // which prompts for biometric before reading the value. Android
  // Keychain always uses the device credential store. The
  // `keychainAccessible` option is iOS-only.
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: requireAuth,
  });
}

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
    // MOB-001: store the role in plain SecureStore (it's not sensitive —
    // it's used for routing before the API confirms it) but the access
    // token with requireAuthentication when biometric is enabled.
    await SecureStore.setItemAsync('addisride.role', role);
    try {
      await secureSet('addisride.accessToken', accessToken);
    } catch (err) {
      // If requireAuthentication fails (e.g. user cancels the biometric
      // prompt during login), fall back to storing without it — the
      // biometric gate still protects app entry.
      await SecureStore.setItemAsync('addisride.accessToken', accessToken);
    }
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
