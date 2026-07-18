import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

type SettingsState = {
  biometricUnlock: boolean; locale: 'en' | 'am'; theme: 'dark' | 'light';
  setBiometricUnlock: (v: boolean) => Promise<void>;
  setLocale: (v: 'en' | 'am') => Promise<void>;
  setTheme: (v: 'dark' | 'light') => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  biometricUnlock: false, locale: 'en', theme: 'dark',
  setBiometricUnlock: async (v) => { await AsyncStorage.setItem('settings.biometric', String(v)); set({ biometricUnlock: v }); },
  setLocale: async (v) => { await AsyncStorage.setItem('settings.locale', v); set({ locale: v }); },
  setTheme: async (v) => { await AsyncStorage.setItem('settings.theme', v); set({ theme: v }); },
  hydrate: async () => {
    const [bio, locale, theme] = await Promise.all([
      AsyncStorage.getItem('settings.biometric'), AsyncStorage.getItem('settings.locale'), AsyncStorage.getItem('settings.theme'),
    ]);
    set({ biometricUnlock: bio === 'true', locale: (locale as any) ?? 'en', theme: (theme as any) ?? 'dark' });
  },
}));
