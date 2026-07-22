import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Linking } from 'react-native';
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await api.get<Release[]>('/marketplace/seat-releases');
      setReleases(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setReleases([]);
    }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function claim(releaseId: string) {
    try {
      const r = await api.post<any>(`/marketplace/seat-releases/${releaseId}/claim`, { paymentMethod: 'telebirr' });
      const url = r?.checkout?.checkoutUrl;
      if (!url) {
        Alert.alert('Claim succeeded', 'Your seat claim was confirmed. Check your rides.');
        router.push('/rider/rides');
        return;
      }
      // P0-15: checkoutUrl is an EXTERNAL URL (Telebirr or /telebirr-stub).
      // Expo Router's router.push only handles internal routes — using it
      // throws "Could not find route" and silently fails the claim.
      // Use Linking.openURL for external URLs.
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Cannot open checkout', `URL: ${url}`);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Claim failed', e instanceof Error ? e.message : 'Please try again');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seat Marketplace</Text>
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={releases}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => claim(item.id)}>
            <Text style={styles.route}>{item.trip.route.origin} → {item.trip.route.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip.departureAt).toLocaleString()} · {item.trip.shuttle.plate}</Text>
            <Text style={styles.fare}>{item.trip.route.fareCents / 100} ETB</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{error ? '' : 'No open seats'}</Text>}
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
  errorBar: { backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 14 },
});
