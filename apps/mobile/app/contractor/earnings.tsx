import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function EarningsScreen() {
  const [trips, setTrips] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rides, setRides] = useState<any[]>([]);
  const [assignments, setAssignments] = useState(0);
  const [rating, setRating] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const allTrips = await api.get('/contractor/trips') || [];
      setTrips(allTrips.filter((t: any) => t.status === 'completed').length);
      setAssignments((await api.get('/contractor/assignments') || []).filter((a: any) => a.status === 'active').length);
      const allRides = await api.get('/rides') || [];
      const completed = allRides.filter((r: any) => r.status === 'completed');
      setRides(completed);
      const me = await api.get('/auth/me');
      setRating(me?.contractorProfile?.rating ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalFare = rides.reduce((sum, r) => sum + (r.trip?.route?.fareCents || 0), 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Earnings & Performance</Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}><Text style={styles.statVal}>{trips}</Text><Text style={styles.statLabel}>Trips</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>{rides.length}</Text><Text style={styles.statLabel}>Rides</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>{assignments}</Text><Text style={styles.statLabel}>Active</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>{rating.toFixed(1)}</Text><Text style={styles.statLabel}>Rating</Text></View>
      </View>
      <Text style={styles.revenue}>Total fare: {totalFare / 100} ETB</Text>
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
            <Text style={styles.sub}>{new Date(item.createdAt).toLocaleString()}</Text>
            <Text style={styles.fare}>{item.trip?.route?.fareCents / 100} ETB</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No completed rides yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16, marginBottom: 8 },
  stat: { alignItems: 'center' },
  statVal: { fontSize: 24, fontWeight: 'bold', color: '#2563eb' },
  statLabel: { fontSize: 12, color: '#666' },
  revenue: { fontSize: 16, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  route: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 12, color: '#666', marginTop: 4 },
  fare: { fontSize: 14, fontWeight: '600', color: '#2563eb', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
