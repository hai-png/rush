import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
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
