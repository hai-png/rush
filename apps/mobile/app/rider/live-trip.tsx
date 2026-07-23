import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

type ShuttlePos = { lat: number; lng: number; heading: number; speed: number; updatedAt: number };

// P2-35 / FE-040: live trip tracking with position polling.
// Previously this screen fetched the trip once and showed a static detail card
// — no map, no polling, no real-time position. Now polls /shuttle-positions
// every 5 seconds and shows the shuttle's live coordinates + speed + heading.
export default function LiveTripScreen() {
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<ShuttlePos[]>([]);

  // Fetch the active trip on focus.
  useFocusEffect(useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/dashboard/rider/active-trip')
      .then(d => { setTrip(d); })
      .catch(e => { setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => setLoading(false));
  }, []));

  // Poll shuttle positions every 5 seconds while the screen is focused.
  useEffect(() => {
    if (!trip) return;
    const poll = async () => {
      try {
        const data = await api.get<ShuttlePos[]>('/shuttle-positions');
        if (data && data.length > 0) {
          setPositions(data);
        }
      } catch { /* silent — position polling is best-effort */ }
    };
    poll(); // immediate first poll
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [trip]);

  // Find the most recent position (within last 5 minutes).
  const now = Date.now();
  const latestPos = positions
    .filter(p => now - p.updatedAt < 5 * 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live Trip</Text>
      <View style={styles.card}>
        <Text style={styles.route}>{trip.trip?.route?.origin} → {trip.trip?.route?.destination}</Text>
        <Text style={styles.sub}>Shuttle: {trip.trip?.shuttle?.plate}</Text>
        <Text style={styles.sub}>Departed: {new Date(trip.trip?.departureAt).toLocaleString()}</Text>
        <Text style={styles.status}>Status: {trip.status}</Text>
      </View>

      {/* Live shuttle position card */}
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
          <Text style={styles.noPos}>No live position available — shuttle may not be tracking yet.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  route: { fontSize: 18, fontWeight: '600' },
  sub: { fontSize: 14, color: '#666', marginTop: 4 },
  status: { fontSize: 14, color: '#2563eb', marginTop: 8, fontWeight: '600' },
  coord: { fontSize: 14, color: '#333', marginTop: 2 },
  updated: { fontSize: 12, color: '#999', marginTop: 4 },
  noPos: { fontSize: 14, color: '#999', fontStyle: 'italic' },
  empty: { fontSize: 16, color: '#999', marginBottom: 16 },
  link: { color: '#2563eb', fontSize: 16, marginTop: 8 },
  errorText: { color: '#dc2626', fontSize: 16, marginBottom: 16 },
});
