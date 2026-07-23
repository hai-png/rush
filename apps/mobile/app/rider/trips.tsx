import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

type Trip = { id: string; departureAt: string; window: string; seatsBooked: number; shuttle: { capacity: number; plate: string }; route: { origin: string; destination: string; fareCents: number } };

export default function TripsScreen() {
  const { assignment } = useLocalSearchParams<{ assignment?: string }>();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get<Trip[]>('/trips')
      .then(data => {
        if (!active) return;
        setTrips((data || []).filter((t: any) => !assignment || t.assignmentId === assignment));
      })
      .catch(() => { if (active) setTrips([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assignment]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Upcoming Trips</Text>
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const seatsLeft = item.shuttle.capacity - item.seatsBooked;
          return (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/rider/book?tripId=${item.id}`)} disabled={seatsLeft <= 0}>
              <Text style={styles.routeTitle}>{item.route.origin} → {item.route.destination}</Text>
              <Text style={styles.routeSub}>{new Date(item.departureAt).toLocaleString()} · {item.window}</Text>
              <Text style={styles.routeSub}>{item.shuttle.plate} · {seatsLeft > 0 ? `${seatsLeft} seats left` : 'Full'}</Text>
              <Text style={styles.fare}>{item.route.fareCents / 100} ETB</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming trips</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  routeTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  routeSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  fare: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary, marginTop: spacing.xs },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
});
