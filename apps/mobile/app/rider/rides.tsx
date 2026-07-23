import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { api } from '../../src/lib/api';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/lib/theme';

export default function RidesScreen() {
  const [rides, setRides] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await api.get('/rides') || [];
      if (!isActive()) return;
      setRides(data);
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ride History</Text>
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
            <View style={styles.row}>
              <Text style={styles.route}>{item.trip?.route?.origin} → {item.trip?.route?.destination}</Text>
              <Text style={[styles.status, item.status === 'completed' && styles.statusOk, item.status === 'cancelled' && styles.statusFail]}>{item.status}</Text>
            </View>
            <Text style={styles.sub}>{new Date(item.trip?.departureAt).toLocaleString()} · {item.trip?.shuttle?.plate}</Text>
            {item.pickupLocation && <Text style={styles.sub}>Pickup: {item.pickupLocation.name} (~{item.pickupLocation.estimatedPickupTime})</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No rides yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, padding: spacing.md },
  card: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  route: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  status: { fontSize: fontSize.xs, color: colors.textLight, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.badgeBg },
  statusOk: { color: colors.success, backgroundColor: colors.successBg },
  statusFail: { color: colors.error, backgroundColor: colors.errorBg },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  empty: { textAlign: 'center', color: colors.textLight, padding: spacing.xl },
  errorBar: { backgroundColor: colors.errorBg, padding: 12, marginHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  errorText: { color: colors.errorText, textAlign: 'center', fontSize: fontSize.sm },
});
