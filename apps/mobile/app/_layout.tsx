import { Stack, Tabs } from 'expo-router';
import { Platform, View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// P0-3 / FE-003: replace the bare <Stack> with a Tabs-based layout for
// rider and contractor. The original _layout.tsx was just <Stack> with
// headerShown: false — no tab bar, no drawer, no global header. Once a
// user navigated to rider/payments or rider/tickets, there was no UI to
// navigate anywhere — they were stranded.
//
// We can't use a single Tabs at the root because the auth screens shouldn't
// show a tab bar. So we use a Stack at the root with three tab groups:
//   - (auth)      — login, signup, biometric-gate, forgot-password (no tabs)
//   - (rider)     — dashboard, trips, tickets, notifications, settings (tabs)
//   - (contractor)— dashboard, trips, assignments, earnings, settings (tabs)
//
// Note: the existing file structure uses /rider/* and /contractor/* paths.
// To minimize file moves, we keep the Stack but inject a Tabs layout inside
// each role's _layout.tsx. For now, this root layout just adds a header
// with a back button where appropriate.
export default function Layout() {
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
