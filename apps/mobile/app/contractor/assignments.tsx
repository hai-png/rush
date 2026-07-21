import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function ContractorAssignmentsScreen() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setAssignments(await api.get('/contractor/assignments') || []); } catch {}
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function accept(id: string) {
    try { await api.post(`/assignments/${id}/accept`); load(); }
    catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }

  async function reject(id: string) {
    Alert.alert('Reject assignment?', 'Provide a reason', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', onPress: async () => {
        try { await api.post(`/assignments/${id}/reject`, { reason: 'Rejected from mobile' }); load(); }
        catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
      }},
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Route Assignments</Text>
      <FlatList
        data={assignments}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => {
          const pattern = JSON.parse(item.schedulePattern);
          return (
            <View style={styles.card}>
              <Text style={styles.route}>{item.route?.origin} → {item.route?.destination}</Text>
              <Text style={styles.sub}>Shuttle: {item.shuttle?.plate} ({item.shuttle?.capacity} seats)</Text>
              <Text style={styles.sub}>Month: {new Date(item.monthStart).toLocaleDateString()} – {new Date(item.monthEnd).toLocaleDateString()}</Text>
              <Text style={styles.sub}>Schedule: {pattern.days?.join(', ')} · {pattern.windows?.join(', ')}</Text>
              <Text style={styles.sub}>{item._count?.trips ?? 0} trips · {item._count?.rides ?? 0} rides</Text>
              <View style={styles.row}>
                <Text style={[styles.status, item.status === 'active' && styles.statusActive]}>{item.status}</Text>
                {item.status === 'assigned' && (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.acceptBtn} onPress={() => accept(item.id)}><Text style={styles.acceptText}>Accept</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={() => reject(item.id)}><Text style={styles.rejectText}>Reject</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No assignments yet</Text>}
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
  statusActive: { color: '#fff', backgroundColor: '#16a34a' },
  actions: { flexDirection: 'row', gap: 8 },
  acceptBtn: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  acceptText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  rejectBtn: { backgroundColor: '#fee2e2', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 8 },
  rejectText: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
