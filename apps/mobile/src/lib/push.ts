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

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  await api.POST('/api/v1/devices', { body: { pushToken: tokenData.data, platform: Platform.OS } });
}

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

  let path: string | null = null;
  if (link.startsWith('addisride://')) {
    path = link.slice('addisride://'.length);
    if (!path.startsWith('/')) path = '/' + path;
  } else if (link.startsWith('/')) {
    path = link;
  }
  if (!path) return;
  try {
    const r = await getRouter();
    r.push(path);
  } catch (err) {
    console.warn('[push] failed to navigate', err);
  }
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {});
}
