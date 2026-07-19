import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from './api';
import { Platform } from 'react-native';

export async function registerPushToken() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const { status: requested } = await Notifications.requestPermissionsAsync();
    status = requested;
  }
  if (status !== 'granted') return;

  // Pass projectId — required by EAS builds (SDK 49+). The previous
  // implementation omitted it, causing getExpoPushTokenAsync to throw.
  // The throw was swallowed by `.catch(() => {})` in _layout.tsx, so push
  // registration silently failed for every EAS-built app.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  await api.POST('/api/v1/devices', { body: { pushToken: tokenData.data, platform: Platform.OS } });
}

// Use a static import for expo-router — dynamic require() inside a
// notification listener may not work in production builds (Metro may not
// include expo-router in the listener's scope).
let router: any = null;
async function getRouter() {
  if (!router) {
    const mod = await import('expo-router');
    router = mod.router;
  }
  return router;
}

Notifications.addNotificationResponseReceivedListener(async (response) => {
  const link = response.notification.request.content.data?.link as string | undefined;
  if (!link) return;
  // Validate the link origin — the previous implementation did
  // `link.replace('addisride://', '/')` which left non-addisride URLs
  // untouched. A malicious notification with `link: 'https://evil.com'`
  // would call `router.push('https://evil.com')` — navigation hijack.
  // Now we only accept links that start with the app's deep-link scheme,
  // or relative paths starting with '/'.
  let path: string | null = null;
  if (link.startsWith('addisride://')) {
    path = link.slice('addisride://'.length);
    if (!path.startsWith('/')) path = '/' + path;
  } else if (link.startsWith('/')) {
    path = link;
  }
  if (!path) return; // reject external URLs
  try {
    const r = await getRouter();
    r.push(path);
  } catch (err) {
    console.warn('[push] failed to navigate', err);
  }
});

// Configure an Android notification channel — without one, notifications
// may not display on Android 8+.
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {});
}
