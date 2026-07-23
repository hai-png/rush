import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function TicketsScreen() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try { setTickets(await api.get('/tickets') || []); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Support Tickets</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/rider/ticket-new')}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>
      {error && (
        <View style={{ backgroundColor: '#fee2e2', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 }}>
          <Text style={{ color: '#991b1b', textAlign: 'center', fontSize: 14 }}>Couldn't load — pull to retry</Text>
        </View>
      )}
<FlatList
        data={tickets}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/rider/ticket-detail?id=${item.id}`)}>
            <View style={styles.row}>
              <Text style={styles.subject}>{item.subject}</Text>
              <Text style={[styles.status, item.status === 'resolved' && styles.statusResolved]}>{item.status}</Text>
            </View>
            <Text style={styles.sub}>{item.category} · {item.priority} · {item._count?.messages ?? 0} messages</Text>
            <Text style={styles.sub}>{new Date(item.updatedAt).toLocaleString()}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No tickets. Tap + New to create one.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: 'bold' },
  newBtn: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subject: { fontSize: 15, fontWeight: '600', flex: 1 },
  status: { fontSize: 12, color: '#999', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f0f0f0' },
  statusResolved: { color: '#16a34a', backgroundColor: '#dcfce7' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
