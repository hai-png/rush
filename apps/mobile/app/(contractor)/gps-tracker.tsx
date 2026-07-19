import { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { api } from '../../src/lib/api';

const GPS_TASK = 'addisride-gps-report';
const ACTIVE_SHUTTLE_KEY = 'addisride.activeShuttleId';

TaskManager.defineTask(GPS_TASK, async () => {
  const shuttleId = await getActiveShuttleId(); // reads from SecureStore, set when trip starts
  if (!shuttleId) return BackgroundFetch.BackgroundFetchResult.NoData;
  let loc;
  try {
    loc = await Location.getCurrentPositionAsync({});
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed; // next tick retries
  }
  await api.POST('/api/v1/shuttle-positions', {
    body: { shuttleId, lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading ?? undefined, speed: loc.coords.speed ?? undefined },
  }).catch(() => {}); // fail-soft; next tick retries
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

async function getActiveShuttleId() {
  return SecureStore.getItemAsync(ACTIVE_SHUTTLE_KEY);
}

// FIX (MOB-007): The previous implementation had no code path that wrote
// `addisride.activeShuttleId` to SecureStore — the comment said "set when
// trip starts" but `dashboard/contractor/page.tsx` (web) calls
// POST /api/v1/trips and never writes to SecureStore, and the mobile app
// has no equivalent trip-start screen. So `getActiveShuttleId()` always
// returned null, the background task always returned NoData, and NO GPS
// positions were ever reported to the server. Riders' live-trip screens
// never showed the shuttle moving. Exported here so a future mobile
// trip-start screen (or the contractor dashboard if rendered on mobile)
// can call `setActiveShuttleId(shuttleId)` after a successful
// POST /api/v1/trips, and `clearActiveShuttleId()` on trip complete.
export async function setActiveShuttleId(shuttleId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_SHUTTLE_KEY, shuttleId);
}
export async function clearActiveShuttleId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_SHUTTLE_KEY);
}

export default function ContractorGpsTrackerScreen() {
  const registered = useRef(false);

  useEffect(() => {
    (async () => {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted' || registered.current) return;
      // Foreground permission alone is not sufficient for a task that keeps running while
      // backgrounded or after the app is terminated (stopOnTerminate: false, startOnBoot:
      // true, below) — both iOS and Android require the separate "Always"/background location
      // grant for that. Without it, Location.getCurrentPositionAsync() inside the background
      // task will typically fail once the app is no longer in the foreground, silently
      // breaking live tracking for riders on the trip.
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') return;
      await BackgroundFetch.registerTaskAsync(GPS_TASK, { minimumInterval: 10, stopOnTerminate: false, startOnBoot: true });
      registered.current = true;
    })();
    // FIX (MOB-008): Do NOT unregister the task on unmount. The previous
    // cleanup called `unregisterTaskAsync`, which meant a contractor who
    // switched to another app tab lost GPS tracking for the rest of the
    // trip. The task should persist until the trip ends (clearActiveShuttleId
    // + unregisterTaskAsync from the trip-complete flow).
  }, []);

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-lg font-semibold">Trip in progress</Text>
      <Text className="text-sm text-muted-foreground mt-1 text-center">Your location is being shared with riders on this trip every 10 seconds.</Text>
    </View>
  );
}
