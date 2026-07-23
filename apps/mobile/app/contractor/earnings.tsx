import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function EarningsScreen() {
  const [trips, setTrips] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rides, setRides] = useState<any[]>([]);
  const [assignments, setAssignments] = useState(0);
  const [rating, setRating] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const allTrips = await api.get('/contractor/trips') || [];
      const allAssignments = (await api.get('/contractor/assignments') || []).filter((a: any) => a.status === 'active');
      const allRides = await api.get('/rides') || [];
      const me = await api.get('/auth/me');
      if (!isActive()) return;
      setTrips(allTrips.filter((t: any) => t.status === 'completed').length);
      setAssignments(allAssignments.length);
      setRides(allRides.filter((r: any) => r.status === 'completed'));
      setRating(me?.contractorProfile?.rating ?? 0);
    } catch (e) {
      if (!isActive()) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
    if (isActive()) setRefreshing(false);
  }, []);

  // (MOB-05e — active guard prevents stale setState on blur.)
  useFocusEffect(useCallback(() => {
    let active = true;
    load(() => active);
    return () => { active = false; };
  }, [load]));

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
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>Couldn't load — pull to retry</Text>
        </View>
      )}
      <FlatList
        data={rides}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
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
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  stat: { alignItems: 'center' },
  statVal: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  revenue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  route: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  fare: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary, marginTop: spacing.xs },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
