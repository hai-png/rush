// FIX (MOB-001): MUST be imported before any code that uses crypto.randomUUID().
// React Native's default crypto global does NOT include randomUUID() — it
// requires the `react-native-get-random-values` polyfill. Without it, the
// first offline seat-claim attempt crashes with
// `TypeError: undefined is not a function`. The polyfill must run before
// the offline-queue module is loaded, hence the top-of-file import.
import 'react-native-get-random-values';

import { useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@addis/i18n';
import { useAuthStore } from '../src/lib/auth-store';
import { useSettingsStore } from '../src/lib/settings-store';
import { subscribeToConnectivity } from '../src/lib/offline-queue';
import { registerPushToken } from '../src/lib/push';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateSettings()]).then(() => setReady(true));
    const unsubscribe = subscribeToConnectivity();
    registerPushToken().catch(() => {});
    return unsubscribe;
  }, []);

  // FIX (MOB-005): Biometric gate bypass via deep links and notifications.
  // The previous implementation set `initialRouteName="(auth)/biometric-gate"`
  // which is only a HINT for the initial stack screen — it does NOT prevent
  // deep links (from push notifications, URL schemes) from routing directly
  // to /(rider)/dashboard or /(contractor)/gps-tracker, bypassing the
  // biometric gate entirely. A user who backgrounded the app with
  // biometricUnlock enabled could tap a notification and land in the rider
  // dashboard without authenticating.
  //
  // This AppState listener re-triggers the gate whenever the app returns to
  // the foreground ('active') AND the user has biometricUnlock enabled.
  // The gate itself (in (auth)/biometric-gate.tsx) handles the actual
  // LocalAuthentication.authenticateAsync() call; we just route there.
  const router = useRouter();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const { accessToken } = useAuthStore.getState();
      const { biometricUnlock } = useSettingsStore.getState();
      if (accessToken && biometricUnlock) {
        // Replace (not push) so the back button doesn't return to the
        // pre-gate screen.
        router.replace('/(auth)/biometric-gate');
      }
    });
    return () => sub.remove();
  }, [router]);

  if (!ready) return null;
  const locale = useSettingsStore.getState().locale ?? (Localization.getLocales()[0]?.languageCode === 'am' ? 'am' : 'en');

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale}>
        <Stack screenOptions={{ headerShown: false }} initialRouteName="(auth)/biometric-gate" />
      </I18nProvider>
    </QueryClientProvider>
  );
}
