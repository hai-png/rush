import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';

type Trip = { id: string; departureAt: string; window: string; seatsBooked: number; shuttle: { capacity: number; plate: string }; route: { origin: string; destination: string; fareCents: number } };

export default function TripsScreen() {
  const { assignment } = useLocalSearchParams<{ assignment?: string }>();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Trip[]>('/trips').then(data => {
      setTrips((data || []).filter((t: any) => !assignment || t.assignmentId === assignment));
    }).finally(() => setLoading(false));
  }, [assignment]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Upcoming Trips</Text>
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const seatsLeft = item.shuttle.capacity - item.seatsBooked;
          return (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/rider/book?tripId=${item.id}`)} disabled={seatsLeft <= 0}>
              <Text style={styles.routeTitle}>{item.route.origin} → {item.route.destination}</Text>
              <Text style={styles.routeSub}>{new Date(item.departureAt).toLocaleString()} · {item.window}</Text>
              <Text style={styles.routeSub}>{item.shuttle.plate} · {seatsLeft > 0 ? `${seatsLeft} seats left` : 'Full'}</Text>
              <Text style={styles.fare}>{item.route.fareCents / 100} ETB</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming trips</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  routeTitle: { fontSize: 16, fontWeight: '600' },
  routeSub: { fontSize: 12, color: '#666', marginTop: 4 },
  fare: { fontSize: 14, fontWeight: '600', color: '#2563eb', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
