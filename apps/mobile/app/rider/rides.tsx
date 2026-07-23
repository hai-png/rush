import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function RidesScreen() {
  const [rides, setRides] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try { setRides(await api.get('/rides') || []); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ride History</Text>
      {error && (
        <View style={{ backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: '#991b1b', textAlign: 'center', fontSize: 14 }}>Couldn't load — pull to retry</Text>
        </View>
      )}
<FlatList
        data={rides}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.route}>{item.trip?.route?.origin} → {item.trip?.route?.destination}</Text>
              <Text style={[styles.status, item.status === 'completed' && styles.statusOk, item.status === 'cancelled' && styles.statusFail]}>{item.status}</Text>
            </View>
            <Text style={styles.sub}>{new Date(item.trip?.departureAt).toLocaleString()} · {item.trip?.shuttle?.plate}</Text>
            {item.pickupLocation && <Text style={styles.sub}>Pickup: {item.pickupLocation.name} (~{item.pickupLocation.estimatedPickupTime})</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No rides yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  route: { fontSize: 16, fontWeight: '600' },
  status: { fontSize: 12, color: '#999', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f0f0f0' },
  statusOk: { color: '#16a34a', backgroundColor: '#dcfce7' },
  statusFail: { color: '#dc2626', backgroundColor: '#fee2e2' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
