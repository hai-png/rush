import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import MapViewBase, { Marker, Polyline } from 'react-native-maps';
// FOLLOW-UP 4: cast to any to work around React 19 / RN 0.76 component type
// mismatch (refs property). Runtime behavior is unchanged.
const MapView = MapViewBase as any;
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';

// FIX (FE-001): The previous implementation called
//   `new EventSource(url, { headers })`
// — but EventSource is a browser API that does NOT exist in React Native's
// runtime, and even in browsers it does NOT accept a `headers` option. The
// constructor threw on mount ("EventSource is not a constructor" under
// Hermes/RN), so the entire live-trip screen crashed and riders could not
// track their shuttle. We now poll the same SSE endpoint with plain
// `fetch()` every 5s, sending the bearer Authorization header the API
// requires. Visible error feedback is shown when the stream is unreachable
// so the rider knows their driver's location is stale instead of staring at
// an unmoving marker.
const POLL_INTERVAL_MS = 5_000;

type ShuttlePosition = { lat: number; lng: number };

async function fetchShuttlePosition(url: string, token: string, signal: AbortSignal): Promise<ShuttlePosition | null> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream, application/json',
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`shuttle-positions stream returned ${res.status}`);
  }
  // The endpoint serves SSE frames. A single short poll returns the most
  // recent `data:` line. Parse defensively: if the body happens to be a
  // bare JSON object (some server configs), accept that too.
  const text = await res.text();
  const dataLine = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)
    .pop();
  const raw = dataLine ?? text.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShuttlePosition;
  } catch {
    return null;
  }
}

export default function LiveTripScreen() {
  const { subscriptionId } = useLocalSearchParams<{ subscriptionId: string }>();
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: trip } = useQuery({
    queryKey: ['active-trip', subscriptionId],
    queryFn: async () => (await api.GET('/api/v1/dashboard/rider/active-trip', { params: { query: { subscriptionId } } })).data,
  });

  const shuttleId = (trip as any)?.shuttleId;

  useEffect(() => {
    if (!shuttleId) return;
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      setStreamError('You must be logged in to track the shuttle.');
      return;
    }
    const url = `${process.env.EXPO_PUBLIC_API_URL}/api/v1/shuttle-positions/stream?shuttleIds=${shuttleId}`;

    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
          const next = await fetchShuttlePosition(url, token, ctrl.signal);
          if (cancelled) return;
          if (next) {
            setPosition(next);
            setStreamError(null);
          }
        } catch (err) {
          if (cancelled) return;
          setStreamError(
            'Live location is unavailable right now. Retrying every 5s…',
          );
          // Visible error feedback — rider sees the marker may be stale.
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };
    loop();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [shuttleId]);

  if (!trip) return <View className="flex-1 items-center justify-center"><Text>Loading…</Text></View>;
  const t = trip as any;

  return (
    <View className="flex-1">
      <MapView style={{ flex: 1 }} initialRegion={{ latitude: 9.02, longitude: 38.75, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
        {t.polyline && <Polyline coordinates={t.polyline.map(([lat, lng]: number[]) => ({ latitude: lat, longitude: lng }))} strokeColor="#10b981" strokeWidth={4} />}
        {position && <Marker coordinate={{ latitude: position.lat, longitude: position.lng }} title={t.plateNumber} />}
      </MapView>

      {streamError && (
        <View className="absolute top-10 inset-x-4 bg-destructive/10 border border-destructive rounded-xl px-4 py-2">
          <Text className="text-destructive text-sm">{streamError}</Text>
        </View>
      )}

      <View className="absolute bottom-0 inset-x-0 bg-card rounded-t-3xl p-4 border-t border-border">
        <View className="flex-row justify-between mb-3">
          <Text className="text-muted-foreground text-sm">Arriving in</Text>
          <Text className="font-semibold text-lg">{t.etaMinutes} min</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="font-medium">{t.contractorName}</Text>
            <Text className="text-xs text-muted-foreground">{t.plateNumber} · ★ {t.contractorRating}</Text>
          </View>
          <Pressable onPress={() => Linking.openURL(`tel:${t.contractorPhone}`)} className="h-10 w-10 rounded-full bg-foreground items-center justify-center">
            <Text className="text-background">📞</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
