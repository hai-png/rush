import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { registerForPushNotifications, listenForNotifications } from '../../src/lib/push';

type Assignment = {
  id: string;
  route: { origin: string; destination: string; fareCents: number; pickups: any[] };
  contractor: { name: string };
  shuttle: { plate: string };
  status: string;
  seatsBooked: number;
  maxSeats: number;
};

export default function RiderDashboard() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [a, s] = await Promise.all([
        api.get<Assignment[]>('/assignments'),
        api.get<any[]>('/subscriptions'),
      ]);
      setAssignments(a || []);
      setSubs((s || []).filter((s: any) => s.status === 'active'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setAssignments([]);
      setSubs([]);
    }
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // register for push notifications on mount.
  useEffect(() => {
    registerForPushNotifications().catch(() => {});
    // Listen for incoming notifications while the app is foregrounded.
    const unsub = listenForNotifications();
    return unsub;
  }, []);

  const activeSub = subs[0];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      {activeSub && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{activeSub.plan?.name ?? 'Active'}</Text>
          <Text style={styles.cardSub}>{activeSub.ridesUsed}/{activeSub.plan?.ridesIncluded === -1 ? '∞' : activeSub.plan?.ridesIncluded} rides used</Text>
          <Text style={styles.cardSub}>Expires {new Date(activeSub.endDate).toLocaleDateString()}</Text>
        </View>
      )}
      <Text style={styles.sectionTitle}>Available Routes</Text>
      <FlatList
        data={assignments}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.routeCard} onPress={() => router.push(`/rider/trips?assignment=${item.id}`)}>
            <Text style={styles.routeTitle}>{item.route.origin} → {item.route.destination}</Text>
            <Text style={styles.routeSub}>{item.contractor.name} · {item.shuttle.plate}</Text>
            <Text style={styles.routeFare}>{item.route.fareCents / 100} ETB</Text>
            <Text style={styles.routePickups}>{item.route.pickups?.length || 0} pickup locations</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No routes available</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, fontWeight: 'bold', padding: 16, color: '#1a1a1a' },
  card: { backgroundColor: '#fff', margin: 16, padding: 16, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#2563eb' },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  cardSub: { fontSize: 14, color: '#666', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8, color: '#333' },
  routeCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 8 },
  routeTitle: { fontSize: 16, fontWeight: '600' },
  routeSub: { fontSize: 12, color: '#666', marginTop: 4 },
  routeFare: { fontSize: 14, fontWeight: '600', color: '#2563eb', marginTop: 4 },
  routePickups: { fontSize: 12, color: '#999', marginTop: 2 },
  empty: { textAlign: 'center', color: '#999', padding: 32 },
});
