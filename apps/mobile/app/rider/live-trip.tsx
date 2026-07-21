import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';

export default function LiveTripScreen() {
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/rider/active-trip').then(d => setTrip(d)).finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={styles.center}><Text>Loading…</Text></View>;
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16 },
  route: { fontSize: 18, fontWeight: '600' },
  sub: { fontSize: 14, color: '#666', marginTop: 4 },
  status: { fontSize: 14, color: '#2563eb', marginTop: 8, fontWeight: '600' },
  empty: { fontSize: 16, color: '#999', marginBottom: 16 },
  link: { color: '#2563eb', fontSize: 16 },
});
