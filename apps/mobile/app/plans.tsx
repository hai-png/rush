import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function PlansScreen() {
  const [plans, setPlans] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try { setPlans(await api.get('/plans') || []); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function subscribe(planId: string) {
    try {
      const res = await api.post('/subscriptions', { planId, paymentMethod: 'telebirr' });
      if (res?.checkout?.checkoutUrl) router.push(res.checkout.checkoutUrl);
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Subscription Plans</Text>
      {error && (
        <View style={{ backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: '#991b1b', textAlign: 'center', fontSize: 14 }}>Couldn't load — pull to retry</Text>
        </View>
      )}
<FlatList
        data={plans}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.planName}>{item.name}</Text>
            <Text style={styles.planDesc}>{item.description}</Text>
            <Text style={styles.price}>{item.priceCents === 0 ? 'Free' : `${item.priceCents / 100} ETB`}<Text style={styles.priceSub}> / {item.durationDays}d</Text></Text>
            <Text style={styles.rides}>{item.ridesIncluded === -1 ? 'Unlimited rides' : `${item.ridesIncluded} rides`}</Text>
            <TouchableOpacity style={styles.btn} onPress={() => subscribe(item.id)}>
              <Text style={styles.btnText}>Subscribe</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  planName: { fontSize: 18, fontWeight: '600' },
  planDesc: { fontSize: 14, color: '#666', marginTop: 4 },
  price: { fontSize: 24, fontWeight: 'bold', marginTop: 8, color: '#2563eb' },
  priceSub: { fontSize: 14, fontWeight: 'normal', color: '#999' },
  rides: { fontSize: 14, color: '#666', marginTop: 4 },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
