import * as Notifications from 'expo-notifications';
import { api } from './api';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  try {
    await api.post('/devices', { pushToken: token, platform: Platform.OS });
  } catch {}
  return token;
}

// P1-45 / FE-022: listen for foreground notifications.
// Returns an unsubscribe function — callers should call it on unmount.
export function listenForNotifications(callback?: (title: string, body: string) => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(notification => {
    const title = notification.request.content.title ?? '';
    const body = notification.request.content.body ?? '';
    if (callback) callback(title, body);
  });
  return () => { Notifications.removeNotificationSubscription(sub); };
}
