import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function ListSeatScreen() {
  const [rides, setRides] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const allRides = await api.get('/rides') || [];
      setRides(allRides.filter((r: any) => r.status === 'booked' && r.trip?.status === 'scheduled'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function listSeat(ride: any) {
    const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    try {
      await api.post('/marketplace/seat-releases', { tripId: ride.tripId, window: ride.trip?.window || 'morning', expiresAt });
      Alert.alert('Success', 'Seat listed on marketplace');
      router.replace('/rider/listings');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>List a Seat for Sale</Text>
      <Text style={styles.desc}>Can't make a trip? List your seat for another rider to claim.</Text>
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
            <Text style={styles.route}>{item.trip?.route?.origin} → {item.trip?.route?.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip?.departureAt).toLocaleString()} · {item.trip?.shuttle?.plate}</Text>
            <Text style={styles.fare}>{item.trip?.route?.fareCents / 100} ETB</Text>
            <TouchableOpacity style={styles.btn} onPress={() => listSeat(item)}>
              <Text style={styles.btnText}>List This Seat</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming booked rides to release.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  desc: { fontSize: 14, color: '#666', paddingHorizontal: 16, marginBottom: 8 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  route: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  fare: { fontSize: 14, fontWeight: '600', color: '#2563eb', marginTop: 4 },
  btn: { backgroundColor: '#2563eb', borderRadius: 6, padding: 10, marginTop: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
