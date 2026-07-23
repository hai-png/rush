import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function SubscriptionsScreen() {
  const [subs, setSubs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try { setSubs(await api.get('/subscriptions') || []); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Subscriptions</Text>
      {error && (
        <View style={{ backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: '#991b1b', textAlign: 'center', fontSize: 14 }}>Couldn't load — pull to retry</Text>
        </View>
      )}
<FlatList
        data={subs}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.planName}>{item.plan?.name}</Text>
              <Text style={[styles.badge, item.status === 'active' && styles.badgeActive]}>{item.status}</Text>
            </View>
            <Text style={styles.sub}>{new Date(item.startDate).toLocaleDateString()} – {new Date(item.endDate).toLocaleDateString()}</Text>
            <Text style={styles.sub}>Rides: {item.ridesUsed} / {item.plan?.ridesIncluded === -1 ? '∞' : item.plan?.ridesIncluded}</Text>
            {item.status === 'active' && (
              <TouchableOpacity onPress={() => api.post(`/subscriptions/${item.id}/renew`, { paymentMethod: 'telebirr' }).then(r => { if (r?.checkout?.checkoutUrl) router.push(r.checkout.checkoutUrl); }).catch(() => alert('Renew failed'))}>
                <Text style={styles.link}>Renew →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No subscriptions. <Text style={styles.link} onPress={() => router.push('/plans')}>Browse plans →</Text></Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { fontSize: 16, fontWeight: '600' },
  badge: { fontSize: 12, color: '#666', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f0f0f0' },
  badgeActive: { color: '#fff', backgroundColor: '#2563eb' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  link: { color: '#2563eb', fontSize: 14, marginTop: 8 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
