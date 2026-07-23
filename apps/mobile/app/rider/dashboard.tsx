import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { registerForPushNotifications, listenForNotifications } from '../../src/lib/push';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

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

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setRefreshing(true);
    setError(null);
    try {
      const [a, s] = await Promise.all([
        api.get<Assignment[]>('/assignments'),
        api.get<any[]>('/subscriptions'),
      ]);
      if (!isActive()) return;
      setAssignments(a || []);
      setSubs((s || []).filter((s: any) => s.status === 'active'));
    } catch (e) {
      if (!isActive()) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
      setAssignments([]);
      setSubs([]);
    }
    if (isActive()) setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    load(() => active);
    return () => { active = false; };
  }, [load]));

  useEffect(() => {
    registerForPushNotifications().catch(() => {});
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
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
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, padding: spacing.md, color: colors.text },
  card: { backgroundColor: colors.card, margin: spacing.md, padding: spacing.md, borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: colors.primary },
  cardTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  cardSub: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, paddingHorizontal: spacing.md, marginBottom: spacing.sm, color: colors.text },
  routeCard: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  routeTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  routeSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  routeFare: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary, marginTop: spacing.xs },
  routePickups: { fontSize: fontSize.xs, color: colors.textLight, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
});
