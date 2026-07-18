import * as Notifications from 'expo-notifications';
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

  const tokenData = await Notifications.getExpoPushTokenAsync();
  await api.POST('/api/v1/devices', { body: { pushToken: tokenData.data, platform: Platform.OS } });
}

Notifications.addNotificationResponseReceivedListener((response) => {
  const link = response.notification.request.content.data?.link as string | undefined;
  if (link) {
    const { router } = require('expo-router');
    router.push(link.replace('addisride://', '/'));
  }
});
