import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function ContractorTripsScreen() {
  const [trips, setTrips] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get<any[]>('/contractor/trips');
      setTrips(data || []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function startTrip(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/board`);
      alert('Trip started');
      load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  }

  async function completeTrip(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/complete`);
      alert('Trip completed');
      load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Trips</Text>
      {error && (
        <View style={{ backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: '#991b1b', textAlign: 'center', fontSize: 14 }}>Couldn't load — pull to retry</Text>
        </View>
      )}
<FlatList
        data={trips}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.route}>{item.route?.origin} → {item.route?.destination}</Text>
            <Text style={styles.sub}>{new Date(item.departureAt).toLocaleString()} · {item.shuttle?.plate}</Text>
            <Text style={styles.sub}>{item.seatsBooked}/{item.shuttle?.capacity} seats · {item.status}</Text>
            {item.status === 'scheduled' && (
              <TouchableOpacity style={styles.btn} onPress={() => startTrip(item.id)}>
                <Text style={styles.btnText}>Start Trip</Text>
              </TouchableOpacity>
            )}
            {item.status === 'in_transit' && (
              <TouchableOpacity style={[styles.btn, styles.btnComplete]} onPress={() => completeTrip(item.id)}>
                <Text style={styles.btnText}>Complete Trip</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No trips assigned</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  route: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  btn: { backgroundColor: '#2563eb', borderRadius: 6, padding: 10, marginTop: 8, alignItems: 'center' },
  btnComplete: { backgroundColor: '#16a34a' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
