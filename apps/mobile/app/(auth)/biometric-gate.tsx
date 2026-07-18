import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/lib/auth-store';
import { useSettingsStore } from '../../src/lib/settings-store';

/** Shown on cold start when biometricUnlock is enabled and a valid session already exists.
 *  Falls through to dashboard automatically if biometrics unavailable or user opted out. */
export default function BiometricGateScreen() {
  const [status, setStatus] = useState<'checking' | 'prompt' | 'failed'>('checking');
  const accessToken = useAuthStore((s) => s.accessToken);
  const biometricEnabled = useSettingsStore((s) => s.biometricUnlock);

  useEffect(() => {
    (async () => {
      if (!accessToken) { router.replace('/(auth)/login'); return; }
      if (!biometricEnabled) { router.replace('/(rider)/dashboard'); return; }

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) { router.replace('/(rider)/dashboard'); return; }

      setStatus('prompt');
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Addis Ride', fallbackLabel: 'Use passcode', cancelLabel: 'Cancel',
      });
      if (result.success) router.replace('/(rider)/dashboard');
      else setStatus('failed');
    })();
  }, [accessToken, biometricEnabled]);

  if (status === 'checking') return <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>;

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-lg font-semibold mb-2">Unlock required</Text>
      <Text className="text-sm text-muted-foreground text-center mb-6">Authenticate with Face ID / fingerprint to continue.</Text>
      <Pressable
        onPress={async () => {
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Addis Ride' });
          if (result.success) router.replace('/(rider)/dashboard');
        }}
        className="bg-foreground rounded-full px-6 py-3"
      >
        <Text className="text-background font-medium">Try again</Text>
      </Pressable>
      <Pressable onPress={async () => { await useAuthStore.getState().clearAuth(); router.replace('/(auth)/login'); }} className="mt-4">
        <Text className="text-destructive text-sm">Log out instead</Text>
      </Pressable>
    </View>
  );
}
