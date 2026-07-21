import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setPayments(await api.get('/payments') || []); } catch {}
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Payment History</Text>
      <FlatList
        data={payments}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.ref}>{item.reference?.slice(0, 20)}…</Text>
              <Text style={styles.amount}>{item.amountCents / 100} ETB</Text>
            </View>
            <Text style={styles.sub}>{new Date(item.createdAt).toLocaleString()} · {item.method} · {item.subscription?.plan?.name ?? '—'}</Text>
            <Text style={[styles.status, item.status === 'completed' && styles.statusOk, item.status === 'failed' && styles.statusFail]}>{item.status}</Text>
            {item.refundAmountCents > 0 && <Text style={styles.refund}>Refunded: {item.refundAmountCents / 100} ETB</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No payments yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  ref: { fontSize: 12, fontFamily: 'monospace', color: '#666' },
  amount: { fontSize: 16, fontWeight: '600', color: '#2563eb' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  status: { fontSize: 12, marginTop: 4, color: '#999' },
  statusOk: { color: '#16a34a' },
  statusFail: { color: '#dc2626' },
  refund: { fontSize: 12, color: '#f59e0b', marginTop: 2 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
