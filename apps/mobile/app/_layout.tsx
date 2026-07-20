import 'react-native-get-random-values';

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { AppState, Modal } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@addis/i18n';
import { useAuthStore } from '../src/lib/auth-store';
import { useSettingsStore } from '../src/lib/settings-store';
import { subscribeToConnectivity, subscribeToAuthFlush, onAuthRequiredForFlush } from '../src/lib/offline-queue';
import { registerPushToken } from '../src/lib/push';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';
import BiometricGateScreen from './(auth)/biometric-gate';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const isGateSatisfied = useAuthStore((s) => s.isGateSatisfied);
  const setGateSatisfied = useAuthStore((s) => s.setGateSatisfied);

  const [gateNonce, setGateNonce] = useState(0);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateSettings()]).then(() => setReady(true));
    const unsubscribe = subscribeToConnectivity();

    const unsubAuthFlush = subscribeToAuthFlush(useAuthStore.subscribe);
    const unsubAuthRequired = onAuthRequiredForFlush(() => {

      useAuthStore.getState().clearAuth().catch(() => {});
      setGateSatisfied(false);
      setGateNonce((n) => n + 1);
    });
    registerPushToken().catch(() => {});
    return () => { unsubscribe(); unsubAuthFlush(); unsubAuthRequired(); };
  }, [setGateSatisfied]);

  useEffect(() => {
    let lastBackgroundedAt: number | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        lastBackgroundedAt = Date.now();
        return;
      }
      if (state !== 'active') return;
      if (lastBackgroundedAt === null) return;
      const backgroundDuration = Date.now() - lastBackgroundedAt;
      lastBackgroundedAt = null;
      if (backgroundDuration < 30_000) return;
      const { accessToken } = useAuthStore.getState();
      const { biometricUnlock } = useSettingsStore.getState();
      if (accessToken && biometricUnlock) {

        setGateSatisfied(false);
        setGateNonce((n) => n + 1);
      }
    });
    return () => sub.remove();
  }, [setGateSatisfied]);

  if (!ready) return null;
  const locale = useSettingsStore.getState().locale ?? (Localization.getLocales()[0]?.languageCode === 'am' ? 'am' : 'en');

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale}>
        <Stack screenOptions={{ headerShown: false }} initialRouteName="(auth)/login" />
        {}
        <Modal
          visible={!isGateSatisfied}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => {  }}
        >
          <BiometricGateScreen key={gateNonce} />
        </Modal>
      </I18nProvider>
    </QueryClientProvider>
  );
}
