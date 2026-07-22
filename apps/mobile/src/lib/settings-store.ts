import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'app-settings';

export type Settings = {
  language: 'en' | 'am';
  notificationEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

const defaults: Settings = {
  language: 'en',
  notificationEnabled: true,
  emailEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
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
