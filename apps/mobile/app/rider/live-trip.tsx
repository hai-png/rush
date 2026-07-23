import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

type ShuttlePos = { lat: number; lng: number; heading: number; speed: number; updatedAt: number };

// Lazy-load react-native-maps so the web target (where the native module is
// unavailable) doesn't crash at import time. We resolve it once on first
// render of a native device.
//
// We type the cached module loosely (`any`) because the react-native-maps
// typings use a default export + named exports and the require() pattern
// confuses TS when the module may be absent (web). Runtime correctness is
// what matters here.
let MapsModule: any = null;
function getMaps() {
  if (Platform.OS === 'web') return null;
  if (MapsModule) return MapsModule;
  try {
    // require() is synchronous and only runs on native — Metro tree-shakes
    // this branch out of the web bundle.
    MapsModule = require('react-native-maps');
    return MapsModule;
  } catch {
    return null;
  }
}

// live trip tracking with position polling.
// — no map, no polling, no real-time position. Now polls /shuttle-positions
// every 5 seconds, shows the shuttle's live coordinates + speed + heading,
// AND renders a real MapView with markers for the shuttle and the rider's
// pickup origin. Falls back to the text card on web (react-native-maps is
// native-only) or if the module fails to load.
export default function LiveTripScreen() {
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<ShuttlePos[]>([]);
  const mapRef = useRef<any>(null);

  // Fetch the active trip on focus.
  // (MOB-05e — active guard prevents setState after blur.)
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.get('/dashboard/rider/active-trip')
      .then(d => { if (active) setTrip(d); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []));

  // Poll shuttle positions every 5 seconds while the screen is focused.
  useEffect(() => {
    if (!trip) return;
    let active = true;
    const poll = async () => {
      try {
        const data = await api.get<ShuttlePos[]>('/shuttle-positions');
        if (active && data && data.length > 0) {
          setPositions(data);
        }
      } catch { /* silent — position polling is best-effort */ }
    };
    poll(); // immediate first poll
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [trip]);

  // Find the most recent position (within last 5 minutes).
  const now = Date.now();
  const latestPos = positions
    .filter(p => now - p.updatedAt < 5 * 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  // Rider's pickup origin (if the trip data includes one).
  const origin = trip?.trip?.route?.pickups?.find?.((p: any) => p.id === trip?.pickupLocationId)
    ?? trip?.trip?.route?.pickups?.[0]
    ?? null;
  const originLatLng = origin?.lat && origin?.lng ? { latitude: origin.lat, longitude: origin.lng } : null;

  // Re-center the map on each position update.
  useEffect(() => {
    if (!latestPos || !mapRef.current) return;
    try {
      mapRef.current.animateToRegion(
        { latitude: latestPos.lat, longitude: latestPos.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500,
      );
    } catch { /* animateToRegion may not exist on all platforms */ }
  }, [latestPos?.lat, latestPos?.lng]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (error) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
      <TouchableOpacity onPress={() => router.push('/rider/trips')}>
        <Text style={styles.link}>Browse trips</Text>
      </TouchableOpacity>
    </View>
  );
  if (!trip) return (
    <View style={styles.center}>
      <Text style={styles.empty}>No active trip</Text>
      <TouchableOpacity onPress={() => router.push('/rider/trips')}>
        <Text style={styles.link}>Browse trips</Text>
      </TouchableOpacity>
    </View>
  );

  const Maps = getMaps();
  // MapView is the default export; Marker is a named export.
  const MapView = Maps?.default ?? Maps?.MapView;
  const Marker = Maps?.Marker;
  const canShowMap = !!MapView && !!Marker && !!latestPos;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live Trip</Text>
      <View style={styles.card}>
        <Text style={styles.route}>{trip.trip?.route?.origin} → {trip.trip?.route?.destination}</Text>
        <Text style={styles.sub}>Shuttle: {trip.trip?.shuttle?.plate}</Text>
        <Text style={styles.sub}>Departed: {new Date(trip.trip?.departureAt).toLocaleString()}</Text>
        <Text style={styles.status}>Status: {trip.status}</Text>
      </View>

      {/* Live shuttle map (native only). On web or when no position data is
          available yet, we fall back to a text status. */}
      {canShowMap ? (
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: latestPos!.lat,
              longitude: latestPos!.lng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            showsUserLocation
          >
            <Marker
              coordinate={{ latitude: latestPos!.lat, longitude: latestPos!.lng }}
              title="Shuttle"
              description={trip.trip?.shuttle?.plate ?? 'Live shuttle position'}
              pinColor={colors.primary}
            />
            {originLatLng && (
              <Marker
                coordinate={originLatLng}
                title="Your pickup"
                description={origin?.name ?? 'Pickup location'}
                pinColor={colors.success}
              />
            )}
          </MapView>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shuttle Position</Text>
          {latestPos ? (
            <>
              <Text style={styles.coord}>Lat: {latestPos.lat.toFixed(4)}, Lng: {latestPos.lng.toFixed(4)}</Text>
              {latestPos.speed > 0 && <Text style={styles.coord}>Speed: {latestPos.speed} km/h</Text>}
              <Text style={styles.coord}>Heading: {Math.round(latestPos.heading)}°</Text>
              <Text style={styles.updated}>Updated {Math.round((now - latestPos.updatedAt) / 1000)}s ago</Text>
              {Platform.OS === 'web' && (
                <Text style={styles.noPos}>Map view is not available on web.</Text>
              )}
            </>
          ) : (
            <Text style={styles.noPos}>Waiting for shuttle position…</Text>
          )}
        </View>
      )}

      {/* Always show the textual status card beneath the map. */}
      {canShowMap && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shuttle Position</Text>
          {latestPos ? (
            <>
              <Text style={styles.coord}>Lat: {latestPos.lat.toFixed(4)}, Lng: {latestPos.lng.toFixed(4)}</Text>
              {latestPos.speed > 0 && <Text style={styles.coord}>Speed: {latestPos.speed} km/h</Text>}
              <Text style={styles.coord}>Heading: {Math.round(latestPos.heading)}°</Text>
              <Text style={styles.updated}>Updated {Math.round((now - latestPos.updatedAt) / 1000)}s ago</Text>
            </>
          ) : (
            <Text style={styles.noPos}>Waiting for shuttle position…</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, padding: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginBottom: spacing.md, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: 12 },
  cardTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, marginBottom: spacing.sm, color: colors.text },
  route: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text },
  sub: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  status: { fontSize: fontSize.sm, color: colors.primary, marginTop: spacing.sm, fontWeight: fontWeight.semibold },
  coord: { fontSize: fontSize.sm, color: colors.text, marginTop: 2 },
  updated: { fontSize: fontSize.xs, color: colors.textLight, marginTop: spacing.xs },
  noPos: { fontSize: fontSize.sm, color: colors.textLight, fontStyle: 'italic' },
  empty: { fontSize: fontSize.md, color: colors.textLight, marginBottom: spacing.md },
  link: { color: colors.primary, fontSize: fontSize.md, marginTop: spacing.sm },
  errorText: { color: colors.error, fontSize: fontSize.md, marginBottom: spacing.md },
  mapWrap: { backgroundColor: colors.card, borderRadius: radius.md, overflow: 'hidden', marginBottom: 12, height: 280 },
  map: { flex: 1 },
});
