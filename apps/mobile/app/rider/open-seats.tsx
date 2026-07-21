import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

type Release = {
  id: string;
  trip: { route: { origin: string; destination: string; fareCents: number }; shuttle: { plate: string }; departureAt: string };
  window: string;
  expiresAt: string;
};

export default function OpenSeatsScreen() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.get<Release[]>('/marketplace/seat-releases');
      setReleases(data || []);
    } catch {}
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seat Marketplace</Text>
      <FlatList
        data={releases}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => api.post(`/marketplace/seat-releases/${item.id}/claim`, { paymentMethod: 'telebirr' })
              .then(r => { if (r?.checkout?.checkoutUrl) router.push(r.checkout.checkoutUrl); })
              .catch(() => alert('Claim failed'))}
          >
            <Text style={styles.route}>{item.trip.route.origin} → {item.trip.route.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip.departureAt).toLocaleString()} · {item.trip.shuttle.plate}</Text>
            <Text style={styles.fare}>{item.trip.route.fareCents / 100} ETB</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No open seats</Text>}
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
  fare: { fontSize: 14, fontWeight: '600', color: '#2563eb', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
