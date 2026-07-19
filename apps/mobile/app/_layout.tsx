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

  // FIX (MOB-005 / UX-003): Biometric gate on app foreground. Deep links and
  // notifications can bypass `initialRouteName`. This listener re-triggers
  // the gate when the app returns to the foreground AND the user has
  // biometricUnlock enabled. UX-003 fix: only re-trigger if the app was
  // backgrounded for >30 seconds — avoids forcing biometric auth every time
  // the user briefly switches to SMS to copy an OTP.
  const router = useRouter();
  useEffect(() => {
    let lastBackgroundedAt: number | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        lastBackgroundedAt = Date.now();
        return;
      }
      if (state !== 'active') return;
      if (lastBackgroundedAt === null) return; // first foreground (app launch) — gate handles it
      const backgroundDuration = Date.now() - lastBackgroundedAt;
      lastBackgroundedAt = null;
      if (backgroundDuration < 30_000) return; // <30s background — don't re-prompt
      const { accessToken } = useAuthStore.getState();
      const { biometricUnlock } = useSettingsStore.getState();
      if (accessToken && biometricUnlock) {
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
