import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, usePathname } from 'expo-router';
import { useAuthStore } from '../../src/lib/auth-store';
import { useSettingsStore } from '../../src/lib/settings-store';

export default function BiometricGateScreen() {
  const [status, setStatus] = useState<'checking' | 'prompt' | 'failed'>('checking');
  const accessToken = useAuthStore((s) => s.accessToken);
  const setGateSatisfied = useAuthStore((s) => s.setGateSatisfied);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const biometricEnabled = useSettingsStore((s) => s.biometricUnlock);
  const pathname = usePathname();

  const satisfy = () => {
    setGateSatisfied(true);
    const { accessToken } = useAuthStore.getState();
    if (accessToken && pathname.startsWith('/(auth)')) {
      router.replace('/(rider)/dashboard');
    }
  };

  useEffect(() => {
    (async () => {

      if (!accessToken) { satisfy(); return; }

      if (!biometricEnabled) { satisfy(); return; }

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) { satisfy(); return; }

      setStatus('prompt');
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Addis Ride', fallbackLabel: 'Use passcode', cancelLabel: 'Cancel',
      });
      if (result.success) satisfy();
      else setStatus('failed');
    })();

  }, [accessToken, biometricEnabled]);

  if (status === 'checking') return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator /></View>;

  return (
    <View className="flex-1 items-center justify-center px-6 bg-background">
      <Text className="text-lg font-semibold mb-2 text-foreground">Unlock required</Text>
      <Text className="text-sm text-muted-foreground text-center mb-6">Authenticate with Face ID / fingerprint to continue.</Text>
      <Pressable
        onPress={async () => {
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Addis Ride' });
          if (result.success) satisfy();
        }}
        className="bg-foreground rounded-full px-6 py-3"
      >
        <Text className="text-background font-medium">Try again</Text>
      </Pressable>
      <Pressable onPress={async () => { await clearAuth(); router.replace('/(auth)/login'); }} className="mt-4">
        <Text className="text-destructive text-sm">Log out instead</Text>
      </Pressable>
    </View>
  );
}
