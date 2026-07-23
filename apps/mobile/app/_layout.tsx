import { Stack, Tabs } from 'expo-router';
import { Platform, View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { initConnectivity } from '../src/lib/offline-queue';

// Root layout: Stack at the root with auth (no tabs), rider (tab group),
// and contractor (tab group) screens. Each role's nested _layout.tsx
// renders the bottom tab bar.
export default function Layout() {
  // NetInfo listener — drains the offline queue when the device reconnects.
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
        {/* Rider tab group — declared here so the nested _layout.tsx in /rider
            can render the bottom tab bar. */}
        <Stack.Screen name="rider" options={{ headerShown: false }} />
        {/* Contractor tab group. */}
        <Stack.Screen name="contractor" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
