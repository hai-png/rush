// FIX (MOB-001): MUST be imported before any code that uses crypto.randomUUID().
// React Native's default crypto global does NOT include randomUUID() — it
// requires the `react-native-get-random-values` polyfill. Without it, the
// first offline seat-claim attempt crashes with
// `TypeError: undefined is not a function`. The polyfill must run before
// the offline-queue module is loaded, hence the top-of-file import.
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
  // FE-002: gateNonce forces BiometricGateScreen to re-mount when the gate
  // is re-armed (e.g., after a 30s+ background→foreground transition). The
  // Modal's `visible` toggle alone doesn't unmount its children, so without
  // a key change the gate's biometric-prompt effect wouldn't re-run and the
  // user would see the stale "Try again" state from the previous session.
  const [gateNonce, setGateNonce] = useState(0);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateSettings()]).then(() => setReady(true));
    const unsubscribe = subscribeToConnectivity();
    // FE-005: auto-flush the offline queue when a fresh login lands
    // (covers the case where items queued while offline / while the
    // previous session was expired should be delivered under the new
    // session). Also wire onAuthRequiredForFlush → force re-login.
    const unsubAuthFlush = subscribeToAuthFlush(useAuthStore.subscribe);
    const unsubAuthRequired = onAuthRequiredForFlush(() => {
      // A queued mutation 401'd. Force a clean re-login so the queue can
      // be retried under the new session (auto-flush will fire when the
      // new token lands).
      useAuthStore.getState().clearAuth().catch(() => {});
      setGateSatisfied(false);
      setGateNonce((n) => n + 1);
    });
    registerPushToken().catch(() => {});
    return () => { unsubscribe(); unsubAuthFlush(); unsubAuthRequired(); };
  }, [setGateSatisfied]);

  // FIX (MOB-005 / UX-003 / FE-002): Biometric gate on app foreground.
  // Deep links and notifications could previously bypass the gate because
  // it was just an `initialRouteName` (a regular Stack screen). Now the
  // gate is a full-screen Modal overlay rendered on top of the Stack — it
  // blocks ALL underlying screens until isGateSatisfied === true.
  // UX-003: only re-arm the gate if the app was backgrounded for >30s —
  // avoids forcing biometric auth every time the user briefly switches to
  // SMS to copy an OTP.
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
        // Re-arm the gate — Modal will overlay whatever pathname the user
        // was on. Post-gate navigation in BiometricGateScreen uses
        // usePathname() so the rider returns to that same screen. Bump
        // gateNonce so BiometricGateScreen re-mounts and re-runs its
        // biometric-prompt effect.
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
        {/* FE-002: full-screen Modal overlay. Visible whenever the gate
            hasn't been satisfied for the current session. Blocks ALL
            underlying Stack screens — deep links / notifications cannot
            bypass it. */}
        <Modal
          visible={!isGateSatisfied}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => { /* swallow hardware-back — must authenticate or log out */ }}
        >
          <BiometricGateScreen key={gateNonce} />
        </Modal>
      </I18nProvider>
    </QueryClientProvider>
  );
}
