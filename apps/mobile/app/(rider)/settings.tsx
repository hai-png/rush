import { View, Text, Switch, useWindowDimensions } from 'react-native';
import { useSettingsStore } from '../../src/lib/settings-store';

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { biometricUnlock, setBiometricUnlock, locale, setLocale, theme, setTheme } = useSettingsStore();

  return (
    <View className={`flex-1 bg-background pt-16 ${isTablet ? 'flex-row px-16 gap-12' : 'px-5'}`}>
      <View className={isTablet ? 'w-64' : ''}>
        <Text className="text-xl font-semibold text-foreground mb-6">Settings</Text>
      </View>
      <View className="flex-1 gap-4">
        <Row label="Biometric unlock" value={<Switch value={biometricUnlock} onValueChange={setBiometricUnlock} />} />
        <Row label="Language" value={<Text onPress={() => setLocale(locale === 'en' ? 'am' : 'en')} className="text-accent">{locale === 'en' ? 'English' : 'አማርኛ'}</Text>} />
        <Row label="Theme" value={<Text onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="text-accent">{theme === 'dark' ? 'Dark' : 'Light'}</Text>} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between border-b border-border py-3">
      <Text className="text-foreground">{label}</Text>
      {value}
    </View>
  );
}
