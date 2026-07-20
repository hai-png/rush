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

const TICK_COUNT_KEY = 'addisride.gpsTickCount';
const REVALIDATE_EVERY_N_TICKS = 6;

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

async function shuttleIdStillValid(shuttleId: string): Promise<boolean> {
  try {

    const res = await (api as any).GET('/api/v1/trips', {}) as any;
    if (res.error || !res.data) {

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

    return true;
  }
}

async function uploadWithRetry(body: {
  shuttleId: string; lat: number; lng: number; heading?: number; speed?: number;
}): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_UPLOAD_RETRIES; attempt++) {
    const res = await api.POST('/api/v1/shuttle-positions', { body } as any) as any;
    if (!res.error) return true;

    const status = res.response?.status ?? 0;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    if (attempt < MAX_UPLOAD_RETRIES - 1) {
      const backoffMs = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return false;
}

TaskManager.defineTask(GPS_TASK, async () => {
  const shuttleId = await getActiveShuttleId();
  if (!shuttleId) return BackgroundFetch.BackgroundFetchResult.NoData;

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
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  const body: { shuttleId: string; lat: number; lng: number; heading?: number; speed?: number } = {
    shuttleId,
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
  };
  if (loc.coords.heading != null) body.heading = loc.coords.heading;
  if (loc.coords.speed != null) body.speed = loc.coords.speed;
  const uploaded = await uploadWithRetry(body);

  return uploaded
    ? BackgroundFetch.BackgroundFetchResult.NewData
    : BackgroundFetch.BackgroundFetchResult.Failed;
});

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

  const [invalidated, setInvalidated] = useState(false);

  useEffect(() => {
    (async () => {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted' || registered.current) return;

      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') return;
      await BackgroundFetch.registerTaskAsync(GPS_TASK, { minimumInterval: 10, stopOnTerminate: false, startOnBoot: true });
      registered.current = true;
    })();

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
