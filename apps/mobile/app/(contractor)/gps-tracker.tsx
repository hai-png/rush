import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../src/lib/api';

const GPS_TASK = 'addisride-gps-report';
const ACTIVE_SHUTTLE_KEY = 'addisride.activeShuttleId';
// FIX (FE-003): tick counter persisted in AsyncStorage (not SecureStore —
// it isn't a secret). The OS fires the background task roughly every
// `minimumInterval` (10s); every 6th tick (~60s) we re-validate the stored
// shuttleId against /api/v1/trips so a contractor whose trip was completed
// server-side (or whose shuttle was deactivated) stops uploading stale
// positions and is forced to start a fresh trip.
const TICK_COUNT_KEY = 'addisride.gpsTickCount';
const REVALIDATE_EVERY_N_TICKS = 6;
// FIX (FE-009): the previous task caught upload errors and silently
// returned NewData — the OS thought the task succeeded and waited the full
// minimumInterval (10s) before retrying. Now we retry up to 3 times with
// exponential backoff (1s, 2s, 4s); if all 3 fail, return
// BackgroundFetchResult.Failed so the OS retries sooner.
const MAX_UPLOAD_RETRIES = 3;

async function getActiveShuttleId() {
  return SecureStore.getItemAsync(ACTIVE_SHUTTLE_KEY);
}

async function getTickCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(TICK_COUNT_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

async function setTickCount(n: number): Promise<void> {
  await AsyncStorage.setItem(TICK_COUNT_KEY, String(n));
}

/** FE-003: re-validate the stored shuttleId against /api/v1/trips.
 *  Returns true if the shuttleId still corresponds to an in_transit trip
 *  owned by this contractor. On 403 (shuttle reassigned / contractor
 *  suspended) or mismatch, clears SecureStore so the next tick is a no-op
 *  and the contractor is forced to start a fresh trip. */
async function shuttleIdStillValid(shuttleId: string): Promise<boolean> {
  try {
    // `/api/v1/trips` isn't in the SDK's generated schema, so cast through
    // `any` to bypass the path-typed overload (matches the existing
    // `api.POST('/api/v1/shuttle-positions', ...)` pattern in this file).
    const res = await (api as any).GET('/api/v1/trips', {}) as any;
    if (res.error || !res.data) {
      // 401/403/5xx — treat as invalid to be safe (don't keep uploading
      // positions for a trip the contractor can no longer see).
      if (res.response?.status === 403) {
        await SecureStore.deleteItemAsync(ACTIVE_SHUTTLE_KEY);
      }
      return false;
    }
    const trips: Array<{ shuttleId?: string; status?: string }> = (res.data?.data ?? res.data ?? []) as any;
    const stillActive = trips.some(
      (t) => t.shuttleId === shuttleId && t.status === 'in_transit',
    );
    if (!stillActive) {
      await SecureStore.deleteItemAsync(ACTIVE_SHUTTLE_KEY);
    }
    return stillActive;
  } catch {
    // Network error — don't clear SecureStore on a transient failure; the
    // next re-validation tick will retry. The position upload itself
    // still proceeds (it has its own retry path).
    return true;
  }
}

/** FE-009: upload with up to 3 retries, exponential backoff (1s, 2s, 4s).
 *  Returns true on success, false if all retries failed. */
async function uploadWithRetry(body: {
  shuttleId: string; lat: number; lng: number; heading?: number; speed?: number;
}): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_UPLOAD_RETRIES; attempt++) {
    const res = await api.POST('/api/v1/shuttle-positions', { body } as any) as any;
    if (!res.error) return true;
    // 4xx (other than 408/429) — permanent rejection, don't retry.
    const status = res.response?.status ?? 0;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    if (attempt < MAX_UPLOAD_RETRIES - 1) {
      const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return false;
}

TaskManager.defineTask(GPS_TASK, async () => {
  const shuttleId = await getActiveShuttleId();
  if (!shuttleId) return BackgroundFetch.BackgroundFetchResult.NoData;

  // FE-003: every 6th tick (~60s at 10s intervals), re-validate the
  // shuttleId against /api/v1/trips. If the trip was completed server-side
  // or the shuttle was deactivated (403), stop uploading, clear
  // SecureStore, and require a fresh trip-start.
  const tick = (await getTickCount()) + 1;
  await setTickCount(tick);
  if (tick % REVALIDATE_EVERY_N_TICKS === 0) {
    const valid = await shuttleIdStillValid(shuttleId);
    if (!valid) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
  }

  let loc;
  try {
    loc = await Location.getCurrentPositionAsync({});
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed; // next tick retries
  }
  // Build the body conditionally so we don't pass `heading: undefined`
  // (forbidden by `exactOptionalPropertyTypes: true`).
  const body: { shuttleId: string; lat: number; lng: number; heading?: number; speed?: number } = {
    shuttleId,
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
  };
  if (loc.coords.heading != null) body.heading = loc.coords.heading;
  if (loc.coords.speed != null) body.speed = loc.coords.speed;
  const uploaded = await uploadWithRetry(body);
  // FE-009: Failed → OS retries sooner than minimumInterval.
  return uploaded
    ? BackgroundFetch.BackgroundFetchResult.NewData
    : BackgroundFetch.BackgroundFetchResult.Failed;
});

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
// FE-003: setActiveShuttleId also resets the tick counter so the first
// re-validation happens 60s into the new trip, not based on the previous
// trip's leftover count.
export async function setActiveShuttleId(shuttleId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_SHUTTLE_KEY, shuttleId);
  await setTickCount(0);
}
export async function clearActiveShuttleId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_SHUTTLE_KEY);
  await setTickCount(0);
}

export default function ContractorGpsTrackerScreen() {
  const registered = useRef(false);
  // FE-003: surface "trip ended" state in the UI so the contractor knows
  // their stored shuttleId was invalidated server-side and they need to
  // start a fresh trip.
  const [invalidated, setInvalidated] = useState(false);

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

    // FE-003: foreground mirror of the background re-validation. Polls
    // every 60s while the screen is mounted so the UI reflects
    // server-side trip completion / 403 immediately (the background task
    // only fires when the app is backgrounded).
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        const sid = await getActiveShuttleId();
        if (!sid) { setInvalidated(true); return; }
        const valid = await shuttleIdStillValid(sid);
        if (cancelled) return;
        if (!valid) { setInvalidated(true); return; }
        await new Promise((r) => setTimeout(r, 60_000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  return (
    <View className="flex-1 items-center justify-center px-6">
      {invalidated ? (
        <>
          <Text className="text-lg font-semibold">Trip ended</Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center">
            This trip is no longer active. Start a new trip to resume live tracking.
          </Text>
          <Pressable
            className="mt-8 px-6 py-3 rounded-xl bg-foreground"
            onPress={async () => {
              const { router } = await import('expo-router');
              await clearActiveShuttleId();
              router.replace('/(contractor)/start-trip');
            }}
          >
            <Text className="text-background font-medium">Start a new trip</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text className="text-lg font-semibold">Trip in progress</Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center">Your location is being shared with riders on this trip every 10 seconds.</Text>

          <Pressable
            className="mt-8 px-6 py-3 rounded-xl bg-destructive"
            onPress={async () => {
              const { router } = await import('expo-router');
              await clearActiveShuttleId();
              await BackgroundFetch.unregisterTaskAsync(GPS_TASK).catch(() => {});
              router.replace('/(contractor)/start-trip');
            }}
          >
            <Text className="text-destructive-foreground font-medium">End Trip</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
