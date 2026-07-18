import { useEffect, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { api } from '../../src/lib/api';

const GPS_TASK = 'addisride-gps-report';

TaskManager.defineTask(GPS_TASK, async () => {
  const shuttleId = await getActiveShuttleId(); // reads from SecureStore, set when trip starts
  if (!shuttleId) return BackgroundFetch.BackgroundFetchResult.NoData;
  const loc = await Location.getCurrentPositionAsync({});
  await api.POST('/api/v1/shuttle-positions', {
    body: { shuttleId, lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading ?? undefined, speed: loc.coords.speed ?? undefined },
  }).catch(() => {}); // fail-soft; next tick retries
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

async function getActiveShuttleId() {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync('addisride.activeShuttleId');
}

export default function ContractorGpsTrackerScreen() {
  const registered = useRef(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || registered.current) return;
      await BackgroundFetch.registerTaskAsync(GPS_TASK, { minimumInterval: 10, stopOnTerminate: false, startOnBoot: true });
      registered.current = true;
    })();
    return () => { BackgroundFetch.unregisterTaskAsync(GPS_TASK).catch(() => {}); };
  }, []);

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-lg font-semibold">Trip in progress</Text>
      <Text className="text-sm text-muted-foreground mt-1 text-center">Your location is being shared with riders on this trip every 10 seconds.</Text>
    </View>
  );
}
