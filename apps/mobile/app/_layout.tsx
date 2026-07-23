import { Stack, Tabs } from 'expo-router';
import { Platform, View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { initConnectivity } from '../src/lib/offline-queue';

export default function Layout() {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    initConnectivity().then(u => { unsub = u; });
    return () => { if (unsub) unsub(); };
  }, []);

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/biometric-gate" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/signup" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="rider" options={{ headerShown: false }} />
        <Stack.Screen name="contractor" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
