import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'app-settings';

export type Settings = {
  language: 'en' | 'am';
  notificationEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  // when true, the biometric gate requires FaceID/TouchID/
  // fingerprint before restoring the session. Defaults to false so existing
  // users aren't locked out after upgrade.
  biometricsEnabled: boolean;
};

const defaults: Settings = {
  language: 'en',
  notificationEnabled: true,
  emailEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  biometricsEnabled: false,
};

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
}

export async function getBiometricsEnabled(): Promise<boolean> {
  const s = await getSettings();
  return s.biometricsEnabled === true;
}

export async function setBiometricsEnabled(enabled: boolean): Promise<void> {
  await saveSettings({ biometricsEnabled: enabled });
}
