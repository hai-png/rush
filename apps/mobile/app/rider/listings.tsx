import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function ListingsScreen() {
  const [listings, setListings] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setListings(await api.get('/marketplace/my-releases') || []); } catch {}
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function cancel(id: string) {
    Alert.alert('Cancel listing?', 'The seat will no longer be available.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: async () => {
        try { await api.post(`/marketplace/seat-releases/${id}/cancel`); load(); }
        catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
      }},
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Seat Listings</Text>
      <FlatList
        data={listings}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.route}>{item.trip?.route?.origin} → {item.trip?.route?.destination}</Text>
            <Text style={styles.sub}>{new Date(item.trip?.departureAt).toLocaleString()} · {item.trip?.shuttle?.plate}</Text>
            <Text style={styles.sub}>Listed {new Date(item.createdAt).toLocaleDateString()} · expires {new Date(item.expiresAt).toLocaleString()}</Text>
            <View style={styles.row}>
              <Text style={[styles.status, item.status === 'open' && styles.statusOpen]}>{item.status}</Text>
              {item.status === 'open' && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => cancel(item.id)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No listings. <Text style={styles.link} onPress={() => router.push('/rider/list-seat')}>List a seat →</Text></Text>}
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  status: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f0f0f0', color: '#666' },
  statusOpen: { color: '#fff', backgroundColor: '#2563eb' },
  cancelBtn: { backgroundColor: '#fee2e2', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4 },
  cancelText: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
  link: { color: '#2563eb' },
});
